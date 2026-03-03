// =============================================================================
// BABY KRAKEN SUBMERGE BEHAVIOR - Underwater evasion mechanic
// =============================================================================

import * as THREE from "three";
import type { Unit, UnitGroup } from "../../core/types";
import { ENEMY_STATS } from "../../game/enemyStats";
import { soundFns } from "../../audio";
import { getUnitById } from "../../game/unitQuery";

// =============================================================================
// STATE
// =============================================================================

interface SubmergedKraken {
    unitId: number;
    submergeEndTime: number;
    // Animation states
    isSubmerging: boolean;      // True while sinking animation is playing
    isSurfacing: boolean;       // True while rising animation is playing
    animationStartTime: number; // When the current animation started
}

const submergedKrakens: SubmergedKraken[] = [];
const KRAKEN_SUBMERGE_DURATION = 10000;  // 10 seconds underwater
const KRAKEN_HP_THRESHOLDS = [0.75, 0.5, 0.25];  // Submerge at 75%, 50%, 25% HP
const KRAKEN_SUBMERGE_ANIM_DURATION = 800;  // ms for submerge/surface animation
const KRAKEN_SUBMERGE_DEPTH = -3.0;  // How far below ground kraken sinks

// Track which thresholds each kraken has already used (persists after resurface)
const krakenUsedThresholds: Map<number, number[]> = new Map();

// =============================================================================
// SUBMERGE INITIATION
// =============================================================================

/**
 * Check if kraken should submerge based on HP thresholds.
 * Called when kraken takes damage.
 */
export function trySubmergeKraken(
    unit: Unit,
    _unitsRef: Record<number, UnitGroup>,
    addLog: (text: string, color?: string) => void,
    now: number
): void {
    if (unit.enemyType !== "baby_kraken") return;

    // Already submerged?
    if (submergedKrakens.some(sk => sk.unitId === unit.id)) return;

    const maxHp = ENEMY_STATS.baby_kraken.maxHp;
    const hpPercent = unit.hp / maxHp;

    // Get thresholds this kraken has already used
    const usedThresholds = krakenUsedThresholds.get(unit.id) ?? [];

    // Find the highest threshold we've crossed that hasn't been used
    let triggeredThreshold = -1;
    for (const threshold of KRAKEN_HP_THRESHOLDS) {
        if (hpPercent <= threshold && !usedThresholds.includes(threshold)) {
            triggeredThreshold = threshold;
            break;
        }
    }

    if (triggeredThreshold < 0) return;

    // Mark this threshold as used
    krakenUsedThresholds.set(unit.id, [...usedThresholds, triggeredThreshold]);

    // Start submerge animation
    submergedKrakens.push({
        unitId: unit.id,
        submergeEndTime: now + KRAKEN_SUBMERGE_ANIM_DURATION + KRAKEN_SUBMERGE_DURATION,
        isSubmerging: true,
        isSurfacing: false,
        animationStartTime: now
    });

    addLog("The Kraken Nymph submerges beneath the waves!", "#6b3fa0");
    soundFns.playSplash();
}

// =============================================================================
// STATE QUERIES
// =============================================================================

/**
 * Check if a kraken is currently submerged (including during animations).
 * Use this for targeting checks - kraken is invulnerable from moment it starts sinking.
 */
export function isKrakenSubmerged(unitId: number): boolean {
    return submergedKrakens.some(sk => sk.unitId === unitId);
}

/**
 * Check if a kraken is fully submerged (not animating).
 * Use this for visibility checks - kraken is visible while animating.
 */
export function isKrakenFullySubmerged(unitId: number): boolean {
    const sk = submergedKrakens.find(s => s.unitId === unitId);
    if (!sk) return false;
    // Fully submerged = not in either animation state
    return !sk.isSubmerging && !sk.isSurfacing;
}

// =============================================================================
// SUBMERGE UPDATE
// =============================================================================

/**
 * Update submerged krakens - handle submerge/surface animations and resurfacing.
 */
export function updateSubmergedKrakens(
    now: number,
    unitsRef: Record<number, UnitGroup>,
    addLog: (text: string, color?: string) => void
): void {
    for (let i = submergedKrakens.length - 1; i >= 0; i--) {
        const sk = submergedKrakens[i];

        // Check if kraken is still alive
        const krakenCandidate = getUnitById(sk.unitId);
        const krakenUnit = krakenCandidate && krakenCandidate.hp > 0 ? krakenCandidate : undefined;
        if (!krakenUnit) {
            submergedKrakens.splice(i, 1);
            continue;
        }

        const krakenG = unitsRef[sk.unitId];
        if (!krakenG) continue;

        // Find the shadow mesh to keep it on the ground during animation
        const shadow = krakenG.children.find(child =>
            child instanceof THREE.Mesh &&
            (child as THREE.Mesh).geometry instanceof THREE.CircleGeometry
        );

        // Handle submerging animation (sinking below ground)
        if (sk.isSubmerging) {
            const elapsed = now - sk.animationStartTime;
            const progress = Math.min(1, elapsed / KRAKEN_SUBMERGE_ANIM_DURATION);
            // Ease in - accelerate as it sinks
            const easedProgress = progress * progress;
            const newY = KRAKEN_SUBMERGE_DEPTH * easedProgress;
            krakenG.position.y = newY;

            // Keep shadow on ground by offsetting it relative to group position
            if (shadow) {
                shadow.position.y = 0.004 - newY;
            }

            if (progress >= 1) {
                // Submerge animation complete - now fully underwater
                sk.isSubmerging = false;
                krakenG.position.y = KRAKEN_SUBMERGE_DEPTH;
                // Keep shadow visible as underwater silhouette, maintain offset
                if (shadow) {
                    shadow.position.y = 0.004 - KRAKEN_SUBMERGE_DEPTH;
                    // Darken shadow to indicate underwater presence
                    const shadowMesh = shadow as THREE.Mesh;
                    if (shadowMesh.material instanceof THREE.MeshBasicMaterial) {
                        shadowMesh.material.opacity = 0.25;
                    }
                }
            }
            continue;
        }

        // Handle surfacing animation (rising from ground)
        if (sk.isSurfacing) {
            const elapsed = now - sk.animationStartTime;
            const progress = Math.min(1, elapsed / KRAKEN_SUBMERGE_ANIM_DURATION);
            // Ease out - decelerate as it surfaces
            const easedProgress = 1 - Math.pow(1 - progress, 2);
            const newY = KRAKEN_SUBMERGE_DEPTH + (0 - KRAKEN_SUBMERGE_DEPTH) * easedProgress;
            krakenG.position.y = newY;

            // Offset shadow as kraken rises and restore opacity
            if (shadow) {
                shadow.position.y = 0.004 - newY;
                // Gradually restore shadow opacity as it surfaces
                const shadowMesh = shadow as THREE.Mesh;
                if (shadowMesh.material instanceof THREE.MeshBasicMaterial) {
                    shadowMesh.material.opacity = 0.25 + (0.35 * easedProgress);
                }
            }

            if (progress >= 1) {
                // Surface animation complete - fully emerged
                krakenG.position.y = 0;
                if (shadow) {
                    shadow.position.y = 0.004;
                    // Restore full shadow opacity
                    const shadowMesh = shadow as THREE.Mesh;
                    if (shadowMesh.material instanceof THREE.MeshBasicMaterial) {
                        shadowMesh.material.opacity = 0.6;
                    }
                }
                submergedKrakens.splice(i, 1);
            }
            continue;
        }

        // Check if it's time to start surfacing (submerge duration expired)
        if (now >= sk.submergeEndTime) {
            sk.isSurfacing = true;
            sk.animationStartTime = now;
            // Extend end time to include surface animation
            sk.submergeEndTime = now + KRAKEN_SUBMERGE_ANIM_DURATION;
            addLog("The Kraken Nymph resurfaces!", "#6b3fa0");
            soundFns.playSplash();
        }
    }
}

// =============================================================================
// CLEANUP
// =============================================================================

/**
 * Clear submerged krakens state (for game restart).
 */
export function clearSubmergedKrakens(): void {
    submergedKrakens.length = 0;
    krakenUsedThresholds.clear();
}
