// =============================================================================
// CONSTRUCT CHARGE ATTACK - Cross-shaped AoE with charge-up visual
// =============================================================================

import * as THREE from "three";
import type { Unit, UnitGroup, DamageText, EnemyChargeAttack, EnemyStats, DamageType } from "../core/types";
import { COLORS } from "../core/constants";
import { getUnitStats } from "../game/units";
import { calculateDamageWithCrit, rollHit, getEffectiveArmor, logAoeHit, isUnitAlive } from "../combat/combatMath";
import { applyDamageToUnit, type DamageContext } from "../combat/damageEffects";
import { soundFns } from "../audio";
import { disposeBasicMesh } from "../rendering/disposal";

// =============================================================================
// TYPES
// =============================================================================

interface ChargeState {
    unitId: number;
    elapsedTime: number;      // Accumulated charge time (pause-safe)
    lastUpdateTime: number;   // Last frame's timestamp for delta calculation
    chargeTime: number;
    damage: [number, number];
    damageType: DamageType;
    crossWidth: number;
    crossLength: number;
    centerX: number;
    centerZ: number;
    meshes: THREE.Mesh[];
    skillName: string;
}

// =============================================================================
// STATE
// =============================================================================

const activeCharges = new Map<number, ChargeState>();

// =============================================================================
// VISUAL CREATION
// =============================================================================

/**
 * Create the cross-shaped warning indicator meshes.
 * Returns an array of meshes that form the cross pattern.
 */
function createCrossMeshes(
    scene: THREE.Scene,
    centerX: number,
    centerZ: number,
    crossWidth: number,
    crossLength: number
): THREE.Mesh[] {
    const meshes: THREE.Mesh[] = [];
    const halfWidth = Math.floor(crossWidth / 2);

    // Create tiles for the cross pattern
    // Horizontal arm (along X axis)
    for (let dx = -crossLength; dx <= crossLength; dx++) {
        for (let dz = -halfWidth; dz <= halfWidth; dz++) {
            const mesh = createChargeTile(scene, centerX + dx, centerZ + dz);
            meshes.push(mesh);
        }
    }

    // Vertical arm (along Z axis) - skip center to avoid overlap
    for (let dz = -crossLength; dz <= crossLength; dz++) {
        if (Math.abs(dz) <= halfWidth) continue; // Already covered by horizontal arm
        for (let dx = -halfWidth; dx <= halfWidth; dx++) {
            const mesh = createChargeTile(scene, centerX + dx, centerZ + dz);
            meshes.push(mesh);
        }
    }

    return meshes;
}

/**
 * Create a single charge warning tile.
 */
function createChargeTile(scene: THREE.Scene, x: number, z: number): THREE.Mesh {
    const geometry = new THREE.PlaneGeometry(0.9, 0.9);
    const material = new THREE.MeshBasicMaterial({
        color: "#ff2200",
        transparent: true,
        opacity: 0.1,
        side: THREE.DoubleSide
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x + 0.5, 0.05, z + 0.5);
    mesh.name = "charge-tile";
    scene.add(mesh);
    return mesh;
}

// =============================================================================
// CHARGE LIFECYCLE
// =============================================================================

/**
 * Start a charge attack for a unit.
 */
export function startChargeAttack(
    scene: THREE.Scene,
    unit: Unit,
    g: UnitGroup,
    chargeAttack: EnemyChargeAttack,
    now: number,
    addLog: (text: string, color?: string) => void
): void {
    // Don't start if already charging
    if (activeCharges.has(unit.id)) return;

    const centerX = Math.floor(g.position.x);
    const centerZ = Math.floor(g.position.z);

    // Create visual warning
    const meshes = createCrossMeshes(
        scene,
        centerX,
        centerZ,
        chargeAttack.crossWidth,
        chargeAttack.crossLength
    );

    // Store charge state
    activeCharges.set(unit.id, {
        unitId: unit.id,
        elapsedTime: 0,
        lastUpdateTime: now,
        chargeTime: chargeAttack.chargeTime,
        damage: chargeAttack.damage,
        damageType: chargeAttack.damageType,
        crossWidth: chargeAttack.crossWidth,
        crossLength: chargeAttack.crossLength,
        centerX,
        centerZ,
        meshes,
        skillName: chargeAttack.name
    });

    const enemyData = getUnitStats(unit) as EnemyStats;
    addLog(`${enemyData.name} begins charging ${chargeAttack.name}!`, "#ff6600");
    soundFns.playHit(); // Charge start sound
}

/**
 * Check if a unit is currently charging.
 */
export function isUnitCharging(unitId: number): boolean {
    return activeCharges.has(unitId);
}

/**
 * Process all active charge attacks.
 * Updates visuals and triggers damage when charge completes.
 */
export function processChargeAttacks(
    scene: THREE.Scene,
    unitsState: Unit[],
    unitsRef: Record<number, UnitGroup>,
    damageTexts: DamageText[],
    hitFlashRef: Record<number, number>,
    setUnits: React.Dispatch<React.SetStateAction<Unit[]>>,
    addLog: (text: string, color?: string) => void,
    now: number,
    defeatedThisFrame: Set<number>
): void {
    const toRemove: number[] = [];

    activeCharges.forEach((charge, unitId) => {
        const unit = unitsState.find(u => u.id === unitId);

        // Cancel charge if unit is dead
        if (!unit || unit.hp <= 0) {
            cleanupCharge(scene, charge);
            toRemove.push(unitId);
            return;
        }

        // Accumulate elapsed time using delta (pause-safe)
        // Cap delta to prevent pause/unpause from causing instant charge completion
        const rawDelta = now - charge.lastUpdateTime;
        const delta = Math.min(rawDelta, 100); // Max 100ms per frame (~10fps minimum)
        charge.elapsedTime += delta;
        charge.lastUpdateTime = now;

        const progress = Math.min(charge.elapsedTime / charge.chargeTime, 1);

        // Update visual intensity based on progress
        updateChargeVisuals(charge, progress);

        // Check if charge is complete
        if (charge.elapsedTime >= charge.chargeTime) {
            // Execute the attack
            executeChargeAttack(
                scene, unit, charge, unitsState, unitsRef,
                damageTexts, hitFlashRef, setUnits, addLog, now, defeatedThisFrame
            );

            // Cleanup
            cleanupCharge(scene, charge);
            toRemove.push(unitId);
        }
    });

    // Remove completed charges
    toRemove.forEach(id => activeCharges.delete(id));
}

/**
 * Update the visual intensity of charge tiles based on progress.
 */
function updateChargeVisuals(charge: ChargeState, progress: number): void {
    // Opacity ramps up from 0.1 to 0.8
    const opacity = 0.1 + progress * 0.7;

    // Color shifts from orange to bright red
    const r = 1;
    const g = Math.max(0, 0.3 - progress * 0.3);
    const b = 0;

    charge.meshes.forEach(mesh => {
        const material = mesh.material as THREE.MeshBasicMaterial;
        material.opacity = opacity;
        material.color.setRGB(r, g, b);

        // Add pulsing effect in final 25%
        if (progress > 0.75) {
            const pulsePhase = (progress - 0.75) * 4; // 0-1 in final 25%
            const pulse = Math.sin(pulsePhase * Math.PI * 8) * 0.15;
            material.opacity = Math.min(1, opacity + pulse);
        }
    });
}

/**
 * Execute the charge attack, dealing damage to all units in the cross area.
 */
function executeChargeAttack(
    scene: THREE.Scene,
    unit: Unit,
    charge: ChargeState,
    unitsState: Unit[],
    unitsRef: Record<number, UnitGroup>,
    damageTexts: DamageText[],
    hitFlashRef: Record<number, number>,
    setUnits: React.Dispatch<React.SetStateAction<Unit[]>>,
    addLog: (text: string, color?: string) => void,
    now: number,
    defeatedThisFrame: Set<number>
): void {
    const enemyData = getUnitStats(unit) as EnemyStats;
    const unitsStateRef = { current: unitsState } as React.RefObject<Unit[]>;
    const dmgCtx: DamageContext = { scene, damageTexts, hitFlashRef, unitsRef, unitsStateRef, setUnits, addLog, now, defeatedThisFrame };

    // Find all player units in the cross area
    const halfWidth = Math.floor(charge.crossWidth / 2);
    let hitCount = 0;
    let totalDamage = 0;

    unitsState.forEach(target => {
        if (target.team !== "player" || !isUnitAlive(target, defeatedThisFrame)) return;

        const tg = unitsRef[target.id];
        if (!tg) return;

        const tx = Math.floor(tg.position.x);
        const tz = Math.floor(tg.position.z);

        // Check if target is in the cross
        const inHorizontalArm = Math.abs(tz - charge.centerZ) <= halfWidth &&
                                Math.abs(tx - charge.centerX) <= charge.crossLength;
        const inVerticalArm = Math.abs(tx - charge.centerX) <= halfWidth &&
                              Math.abs(tz - charge.centerZ) <= charge.crossLength;

        if (inHorizontalArm || inVerticalArm) {
            const targetData = getUnitStats(target);

            if (rollHit(enemyData.accuracy)) {
                const { damage: dmg } = calculateDamageWithCrit(charge.damage[0], charge.damage[1], getEffectiveArmor(target, targetData.armor), charge.damageType, unit);
                applyDamageToUnit(dmgCtx, target.id, tg, target.hp, dmg, targetData.name, {
                    color: COLORS.damageEnemy,
                    targetUnit: target
                });
                hitCount++;
                totalDamage += dmg;
            }
        }
    });

    // Create explosion visual effect
    createExplosionEffect(scene, charge.centerX, charge.centerZ);

    // Play sound and log
    soundFns.playHit();
    if (hitCount > 0) {
        addLog(logAoeHit(enemyData.name, charge.skillName, hitCount, totalDamage), COLORS.damageEnemy);
    } else {
        addLog(`${enemyData.name}'s ${charge.skillName} hits nothing!`, COLORS.logNeutral);
    }
}

/**
 * Create a visual explosion effect when the charge attack fires.
 */
function createExplosionEffect(scene: THREE.Scene, centerX: number, centerZ: number): void {
    const geometry = new THREE.RingGeometry(0.5, 3, 32);
    const material = new THREE.MeshBasicMaterial({
        color: "#ff4400",
        transparent: true,
        opacity: 0.8,
        side: THREE.DoubleSide
    });
    const ring = new THREE.Mesh(geometry, material);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(centerX + 0.5, 0.3, centerZ + 0.5);
    scene.add(ring);

    // Animate expansion and fade
    const startTime = Date.now();
    const duration = 400;

    function animate(): void {
        const elapsed = Date.now() - startTime;
        const progress = elapsed / duration;

        if (progress >= 1) {
            disposeBasicMesh(scene, ring);
            return;
        }

        const scale = 1 + progress * 2;
        ring.scale.set(scale, scale, scale);
        material.opacity = 0.8 * (1 - progress);

        requestAnimationFrame(animate);
    }
    animate();
}

/**
 * Cleanup a charge state and remove its visual meshes.
 */
function cleanupCharge(scene: THREE.Scene, charge: ChargeState): void {
    charge.meshes.forEach(mesh => {
        disposeBasicMesh(scene, mesh);
    });
}

/**
 * Clear all active charges (for area transitions).
 * If scene is provided, properly dispose meshes. Otherwise just clear the map.
 */
export function clearChargeAttacks(scene?: THREE.Scene): void {
    if (scene) {
        activeCharges.forEach(charge => {
            cleanupCharge(scene, charge);
        });
    }
    activeCharges.clear();
}

/**
 * Cancel a specific unit's charge attack.
 */
export function cancelChargeAttack(scene: THREE.Scene, unitId: number): void {
    const charge = activeCharges.get(unitId);
    if (charge) {
        cleanupCharge(scene, charge);
        activeCharges.delete(unitId);
    }
}
