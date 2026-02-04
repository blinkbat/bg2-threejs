// =============================================================================
// VISUAL EFFECTS - Damage texts, hit flash, poison visuals, fog of war
// =============================================================================

import * as THREE from "three";
import type { Unit, DamageText, UnitGroup, FogTexture } from "../core/types";
import { FOG_SCALE, FLASH_DURATION, COLORS, POISON_TINT_STRENGTH } from "../core/constants";
import { hasStatusEffect } from "../combat/combatMath";
import { updateVisibility } from "../ai/pathfinding";
import { getCurrentArea } from "../game/areas";
import { disposeTexturedMesh } from "../rendering/disposal";
import { isKrakenFullySubmerged } from "./enemyBehaviors";

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
                disposeTexturedMesh(scene, dt.mesh);
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

export function updateHitFlash(
    hitFlashRef: Record<number, number>,
    unitMeshRef: Record<number, THREE.Mesh>,
    unitOriginalColorRef: Record<number, THREE.Color>,
    unitsState: Unit[],
    now: number
): void {
    Object.entries(hitFlashRef).forEach(([id, hitTime]) => {
        const mesh = unitMeshRef[Number(id)];
        const originalColor = unitOriginalColorRef[Number(id)];
        if (!mesh || !originalColor) return;
        const elapsed = now - hitTime;

        // Get the target color (original or poison-tinted) - reuse _targetColor
        const unit = unitsState.find(u => u.id === Number(id));
        const isPoisoned = unit ? hasStatusEffect(unit, "poison") : false;
        if (isPoisoned) {
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

        if (isPoisoned) {
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
