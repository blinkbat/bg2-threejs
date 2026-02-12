// =============================================================================
// VISUAL EFFECTS - Damage texts, hit flash, poison visuals, fog of war
// =============================================================================

import * as THREE from "three";
import type { Unit, DamageText, UnitGroup, FogTexture } from "../core/types";
import { FOG_SCALE, FLASH_DURATION, COLORS, POISON_TINT_STRENGTH, SUN_STANCE_TINT_STRENGTH, CHILLED_TINT_STRENGTH } from "../core/constants";
import { hasStatusEffect } from "../combat/combatMath";
import { updateVisibility } from "../ai/pathfinding";
import { getCurrentArea } from "../game/areas";
import { isKrakenFullySubmerged } from "./enemyBehaviors";
import { getUnitById } from "../game/unitQuery";
import { recycleDamageNumber } from "../combat/damageEffects";

// =============================================================================
// DAMAGE TEXT UPDATE
// =============================================================================

export function updateDamageTexts(
    damageTexts: DamageText[],
    camera: THREE.OrthographicCamera,
    scene: THREE.Scene,
    paused: boolean
): DamageText[] {
    return damageTexts.filter(dt => {
        dt.mesh.quaternion.copy(camera.quaternion);
        if (!paused) {
            dt.mesh.position.y += 0.02;
            dt.life -= 16;
            (dt.mesh.material as THREE.MeshBasicMaterial).opacity = dt.life / 1000;
            if (dt.life <= 0) {
                recycleDamageNumber(scene, dt.mesh);
                return false;
            }
        }
        return true;
    });
}

// =============================================================================
// HIT FLASH EFFECT
// =============================================================================

// Pre-allocated color objects to avoid allocations every frame
const _flashWhite = new THREE.Color(1, 1, 1);
const _tempColor = new THREE.Color();
const _targetColor = new THREE.Color();
const _poisonColor = new THREE.Color(COLORS.poison);
const _sunStanceColor = new THREE.Color(COLORS.sunStance);
const _chilledColor = new THREE.Color(COLORS.chilled);

export function updateHitFlash(
    hitFlashRef: Record<number, number>,
    unitMeshRef: Record<number, THREE.Mesh>,
    unitOriginalColorRef: Record<number, THREE.Color>,
    now: number
): void {
    Object.entries(hitFlashRef).forEach(([id, hitTime]) => {
        const mesh = unitMeshRef[Number(id)];
        const originalColor = unitOriginalColorRef[Number(id)];
        if (!mesh || !originalColor) return;
        const elapsed = now - hitTime;

        // Get the target color (original or status-tinted) - reuse _targetColor
        const unit = getUnitById(Number(id));
        const isPoisoned = unit ? hasStatusEffect(unit, "poison") : false;
        const hasSunStance = unit ? hasStatusEffect(unit, "sun_stance") : false;
        const isChilled = unit ? hasStatusEffect(unit, "chilled") : false;
        if (hasSunStance) {
            _targetColor.copy(originalColor).lerp(_sunStanceColor, SUN_STANCE_TINT_STRENGTH);
        } else if (isChilled) {
            _targetColor.copy(originalColor).lerp(_chilledColor, CHILLED_TINT_STRENGTH);
        } else if (isPoisoned) {
            _targetColor.copy(originalColor).lerp(_poisonColor, POISON_TINT_STRENGTH);
        } else {
            _targetColor.copy(originalColor);
        }

        if (elapsed > FLASH_DURATION) {
            (mesh.material as THREE.MeshStandardMaterial).color.copy(_targetColor);
            delete hitFlashRef[Number(id)];
        } else {
            const t = elapsed / FLASH_DURATION;
            // Reuse _tempColor: start with white, lerp to target
            _tempColor.copy(_flashWhite).lerp(_targetColor, t);
            (mesh.material as THREE.MeshStandardMaterial).color.copy(_tempColor);
        }
    });
}

export function updatePoisonVisuals(
    unitsState: Unit[],
    unitMeshRef: Record<number, THREE.Mesh>,
    unitOriginalColorRef: Record<number, THREE.Color>,
    hitFlashRef: Record<number, number>
): void {
    for (const unit of unitsState) {
        const mesh = unitMeshRef[unit.id];
        const originalColor = unitOriginalColorRef[unit.id];
        if (!mesh || !originalColor) continue;

        // Skip if currently flashing (hit flash will handle the color)
        if (hitFlashRef[unit.id] !== undefined) continue;

        const isPoisoned = hasStatusEffect(unit, "poison");
        const hasSunStance = hasStatusEffect(unit, "sun_stance");
        const isChilled = hasStatusEffect(unit, "chilled");

        if (hasSunStance) {
            // Apply orange sun stance tint (takes priority over poison/chill)
            _tempColor.copy(originalColor).lerp(_sunStanceColor, SUN_STANCE_TINT_STRENGTH);
            (mesh.material as THREE.MeshStandardMaterial).color.copy(_tempColor);
        } else if (isChilled) {
            // Apply ice blue chilled tint
            _tempColor.copy(originalColor).lerp(_chilledColor, CHILLED_TINT_STRENGTH);
            (mesh.material as THREE.MeshStandardMaterial).color.copy(_tempColor);
        } else if (isPoisoned) {
            // Apply green poison tint - reuse _tempColor
            _tempColor.copy(originalColor).lerp(_poisonColor, POISON_TINT_STRENGTH);
            (mesh.material as THREE.MeshStandardMaterial).color.copy(_tempColor);
        } else {
            // Restore original color
            (mesh.material as THREE.MeshStandardMaterial).color.copy(originalColor);
        }
    }
}

// =============================================================================
// ENERGY SHIELD BUBBLE VISUAL
// =============================================================================

const ENERGY_SHIELD_BUBBLE_NAME = "energyShieldBubble";

export function updateEnergyShieldVisuals(
    unitsState: Unit[],
    unitsRef: Record<number, UnitGroup>,
    now: number
): void {
    for (const unit of unitsState) {
        const unitGroup = unitsRef[unit.id];
        if (!unitGroup) continue;

        const hasShield = hasStatusEffect(unit, "energyShield");
        const existingBubble = unitGroup.getObjectByName(ENERGY_SHIELD_BUBBLE_NAME) as THREE.Mesh | undefined;

        if (hasShield && !existingBubble) {
            // Create bubble
            const bubbleGeometry = new THREE.SphereGeometry(0.7, 24, 16);
            const bubbleMaterial = new THREE.MeshBasicMaterial({
                color: 0x66ccff,
                transparent: true,
                opacity: 0.25,
                side: THREE.DoubleSide,
                depthWrite: false
            });
            const bubble = new THREE.Mesh(bubbleGeometry, bubbleMaterial);
            bubble.name = ENERGY_SHIELD_BUBBLE_NAME;
            bubble.position.y = 0.5;  // Center on unit
            unitGroup.add(bubble);
        } else if (!hasShield && existingBubble) {
            // Remove bubble
            unitGroup.remove(existingBubble);
            existingBubble.geometry.dispose();
            (existingBubble.material as THREE.MeshBasicMaterial).dispose();
        } else if (hasShield && existingBubble) {
            // Animate bubble - subtle pulse
            const pulse = Math.sin(now * 0.003) * 0.05 + 1;
            existingBubble.scale.setScalar(pulse);
            // Subtle rotation
            existingBubble.rotation.y += 0.01;
        }
    }
}

// =============================================================================
// FOG OF WAR UPDATE
// =============================================================================

// Cache for fog change detection - simple hash of visible cells
let lastFogHash = 0;

/**
 * Reset fog hash cache (call on game restart).
 */
export function resetFogCache(): void {
    lastFogHash = 0;
}

export function updateFogOfWar(
    visibility: number[][],
    playerUnits: Unit[],
    unitsRef: Record<number, UnitGroup>,
    fogTexture: FogTexture,
    unitsState: Unit[],
    fogMesh: THREE.Mesh
): void {
    const area = getCurrentArea();

    // If area doesn't have fog of war, clear and hide it
    if (!area.hasFogOfWar) {
        fogMesh.visible = false;
        // Make all enemies visible (except submerged krakens)
        unitsState.filter(u => u.team === "enemy").forEach(u => {
            const g = unitsRef[u.id];
            if (g) g.visible = u.hp > 0 && !isKrakenFullySubmerged(u.id);
        });
        return;
    }

    // Ensure fog mesh is visible for areas with fog
    fogMesh.visible = true;

    updateVisibility(visibility, playerUnits, { current: unitsRef });

    // Quick hash to detect visibility changes (sum of visible cell coords)
    let fogHash = 0;
    for (let x = 0; x < area.gridWidth; x++) {
        for (let z = 0; z < area.gridHeight; z++) {
            if (visibility[x]?.[z] === 2) fogHash += x * 100 + z;
        }
    }

    // Only redraw fog texture if visibility changed
    if (fogHash !== lastFogHash) {
        lastFogHash = fogHash;

        const { ctx, texture } = fogTexture;

        ctx.clearRect(0, 0, area.gridWidth * FOG_SCALE, area.gridHeight * FOG_SCALE);

        // Simple fog rendering without expensive distance calculations
        // Use fixed alpha values - the texture filtering provides some softness
        for (let x = 0; x < area.gridWidth; x++) {
            for (let z = 0; z < area.gridHeight; z++) {
                const vis = visibility[x][z];
                if (vis === 2) continue;  // Visible - no fog

                // Simple alpha: seen = 0.4, unexplored = 1.0
                ctx.fillStyle = vis === 1 ? "rgba(0,0,0,0.4)" : "rgba(0,0,0,1)";
                ctx.fillRect(x * FOG_SCALE, z * FOG_SCALE, FOG_SCALE, FOG_SCALE);
            }
        }

        texture.needsUpdate = true;
    }

    // Hide enemies in fog (always check this) - also hide submerged krakens
    unitsState.filter(u => u.team === "enemy").forEach(u => {
        const g = unitsRef[u.id];
        if (!g) return;
        const cx = Math.floor(g.position.x), cz = Math.floor(g.position.z);
        const vis = visibility[cx]?.[cz] ?? 0;
        g.visible = u.hp > 0 && vis === 2 && !isKrakenFullySubmerged(u.id);
    });
}

// =============================================================================
// SPRITE FACING DIRECTION
// =============================================================================

// Track previous X position and last flip time per unit
const prevX = new Map<number, number>();
const prevZ = new Map<number, number>();
const lastFlipTime = new Map<number, number>();

const FACING_MOVE_THRESHOLD = 0.01;
const FACING_FLIP_COOLDOWN = 300; // ms — prevent jittery flips

/**
 * Update facingRight on each UnitGroup based on movement direction or attack target position.
 * Movement takes priority; when idle, face toward attack target.
 * Facing changes are rate-limited to prevent jitter.
 */
export function updateSpriteFacing(
    unitsState: Unit[],
    unitsRef: Record<number, UnitGroup>
): void {
    const now = Date.now();

    for (const unit of unitsState) {
        if (unit.hp <= 0) continue;
        const g = unitsRef[unit.id];
        if (!g) continue;

        const curX = g.position.x;
        const lastX = prevX.get(unit.id);
        prevX.set(unit.id, curX);

        let wantRight: boolean | undefined;

        if (lastX !== undefined) {
            const dx = curX - lastX;
            const dz = g.position.z - (prevZ.get(unit.id) ?? g.position.z);
            // Project onto iso camera right vector (+X, -Z)
            const screenDx = dx - dz;
            if (Math.abs(screenDx) > FACING_MOVE_THRESHOLD) {
                wantRight = screenDx > 0;
            }
        }
        prevZ.set(unit.id, g.position.z);

        // Not moving — face attack target if any
        if (wantRight === undefined && g.userData.attackTarget !== null) {
            const targetG = unitsRef[g.userData.attackTarget];
            if (targetG) {
                const dx = targetG.position.x - curX;
                const dz = targetG.position.z - g.position.z;
                const screenDx = dx - dz;
                if (Math.abs(screenDx) > 0.1) {
                    wantRight = screenDx > 0;
                }
            }
        }

        // Apply with cooldown
        if (wantRight !== undefined && wantRight !== g.userData.facingRight) {
            const last = lastFlipTime.get(unit.id) ?? 0;
            if (now - last >= FACING_FLIP_COOLDOWN) {
                g.userData.facingRight = wantRight;
                lastFlipTime.set(unit.id, now);
            }
        }
    }
}

/**
 * Clear cached previous positions (call on area transition / game restart).
 */
export function resetSpriteFacing(): void {
    prevX.clear();
    prevZ.clear();
    lastFlipTime.clear();
}
