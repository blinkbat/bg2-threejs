// =============================================================================
// FERAL HOUND LEAP BEHAVIOR - Leaping attack towards targets
// =============================================================================

import * as THREE from "three";
import type { Unit, UnitGroup, DamageText } from "../../core/types";
import { getUnitStats } from "../../game/units";
import { soundFns } from "../../audio";
import { setSkillCooldown } from "../../combat/combatMath";
import { COLORS } from "../../core/constants";
import { applyDamageToUnit, type DamageContext } from "../../combat/damageEffects";
import type { LeapContext } from "./types";

// =============================================================================
// STATE
// =============================================================================

interface ActiveLeap {
    unitId: number;
    startX: number;
    startZ: number;
    endX: number;
    endZ: number;
    elapsedTime: number;      // Accumulated leap time (pause-safe)
    lastUpdateTime: number;   // Last frame's timestamp for delta calculation
    duration: number;  // ms
    targetId: number;
    damage: [number, number];
}

const activeLeaps: ActiveLeap[] = [];
const LEAP_DURATION = 350;  // ms for the leap animation
const LEAP_HEIGHT = 2.5;    // Peak height of the arc

// =============================================================================
// LEAP INITIATION
// =============================================================================

/**
 * Try to leap to a target for an enemy with leapSkill capability.
 * @returns true if a leap was initiated
 */
export function tryLeapToTarget(ctx: LeapContext): boolean {
    const { unit, g, leapSkill, targetUnit, targetG, skillCooldowns, setSkillCooldowns, addLog, now } = ctx;

    const leapKey = `${unit.id}-leap`;
    const leapCooldownEnd = skillCooldowns[leapKey]?.end ?? 0;

    if (now < leapCooldownEnd) {
        return false;
    }

    // Check distance to target
    const dx = targetG.position.x - g.position.x;
    const dz = targetG.position.z - g.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    // Only leap if target is within the right range
    if (dist < leapSkill.minRange || dist > leapSkill.maxRange) {
        return false;
    }

    // Calculate landing position (slightly in front of target)
    const dirX = dx / dist;
    const dirZ = dz / dist;
    const landingDist = Math.max(1.2, dist - 1.0);  // Land close to target but not on them
    const endX = g.position.x + dirX * landingDist;
    const endZ = g.position.z + dirZ * landingDist;

    // Start the leap
    activeLeaps.push({
        unitId: unit.id,
        startX: g.position.x,
        startZ: g.position.z,
        endX,
        endZ,
        elapsedTime: 0,
        lastUpdateTime: now,
        duration: LEAP_DURATION,
        targetId: targetUnit.id,
        damage: leapSkill.damage
    });

    // Play a growl/bark sound
    soundFns.playBark();

    addLog(`Feral Hound leaps at ${targetUnit.team === "player" ? "the party" : "its target"}!`, "#cc6600");

    setSkillCooldown(setSkillCooldowns, leapKey, leapSkill.cooldown, now, unit);

    return true;
}

// =============================================================================
// LEAP STATE QUERIES
// =============================================================================

/**
 * Check if a unit is currently mid-leap.
 */
export function isUnitLeaping(unitId: number): boolean {
    return activeLeaps.some(leap => leap.unitId === unitId);
}

// =============================================================================
// LEAP UPDATE
// =============================================================================

/**
 * Update active leaps - animate positions and handle landing.
 */
export function updateLeaps(
    now: number,
    unitsRef: Record<number, UnitGroup>,
    unitsStateRef: React.RefObject<Unit[]>,
    setUnits: React.Dispatch<React.SetStateAction<Unit[]>>,
    hitFlashRef: React.RefObject<Record<number, number>>,
    addLog: (text: string, color?: string) => void,
    scene: THREE.Scene,
    damageTexts: DamageText[],
    defeatedThisFrame: Set<number>
): void {
    for (let i = activeLeaps.length - 1; i >= 0; i--) {
        const leap = activeLeaps[i];

        // Cap delta to prevent pause/unpause from causing instant leap completion
        const rawDelta = now - leap.lastUpdateTime;
        const delta = Math.min(rawDelta, 100); // Max 100ms per frame
        leap.elapsedTime += delta;
        leap.lastUpdateTime = now;

        const progress = Math.min(1, leap.elapsedTime / leap.duration);

        const g = unitsRef[leap.unitId];
        if (!g) {
            activeLeaps.splice(i, 1);
            continue;
        }

        // Interpolate position with arc
        const t = progress;
        const x = leap.startX + (leap.endX - leap.startX) * t;
        const z = leap.startZ + (leap.endZ - leap.startZ) * t;
        // Parabolic arc: peaks at t=0.5
        const arcY = LEAP_HEIGHT * 4 * t * (1 - t);

        g.position.set(x, arcY, z);

        // Keep shadow on ground by offsetting it down
        const shadow = g.children.find(child =>
            child instanceof THREE.Mesh &&
            (child as THREE.Mesh).geometry instanceof THREE.CircleGeometry
        );
        if (shadow) {
            shadow.position.y = 0.004 - arcY;
        }

        // Check if leap is complete
        if (progress >= 1) {
            // Land and deal damage
            g.position.y = 0;

            // Reset shadow position
            if (shadow) {
                shadow.position.y = 0.004;
            }

            // Update unit state position
            setUnits(prev => prev.map(u =>
                u.id === leap.unitId ? { ...u, x: leap.endX, z: leap.endZ } : u
            ));

            // Deal damage to target if they're still alive and nearby
            const targetG = unitsRef[leap.targetId];
            const targetUnit = unitsStateRef.current.find(u => u.id === leap.targetId);
            if (targetG && targetUnit && targetUnit.hp > 0 && !defeatedThisFrame.has(leap.targetId)) {
                const landDist = Math.hypot(
                    targetG.position.x - leap.endX,
                    targetG.position.z - leap.endZ
                );

                // Deal damage if close enough on landing
                if (landDist < 2.5) {
                    const damage = leap.damage[0] + Math.floor(Math.random() * (leap.damage[1] - leap.damage[0] + 1));
                    const targetData = getUnitStats(targetUnit);

                    const dmgCtx: DamageContext = {
                        scene, damageTexts, hitFlashRef: hitFlashRef.current, unitsRef, unitsStateRef,
                        setUnits, addLog, now, defeatedThisFrame
                    };
                    applyDamageToUnit(dmgCtx, leap.targetId, targetG, targetUnit.hp, damage, targetData.name, {
                        color: COLORS.damageEnemy,
                        hitMessage: { text: `Feral Hound's leap deals ${damage} damage!`, color: "#ff6600" },
                        targetUnit
                    });

                    soundFns.playHit();
                }
            }

            activeLeaps.splice(i, 1);
        }
    }
}

// =============================================================================
// CLEANUP
// =============================================================================

/**
 * Clear all active leaps (for game restart).
 */
export function clearLeaps(): void {
    activeLeaps.length = 0;
}
