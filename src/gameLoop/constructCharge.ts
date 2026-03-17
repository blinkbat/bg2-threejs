// =============================================================================
// CONSTRUCT CHARGE ATTACK - Cross-shaped AoE with charge-up visual
// =============================================================================

import * as THREE from "three";
import type { Unit, UnitGroup, DamageText, EnemyChargeAttack, DamageType } from "../core/types";
import { COLORS } from "../core/constants";
import { getUnitStats, getEnemyUnitStats } from "../game/units";
import { accumulateDelta, getGameTime } from "../core/gameClock";
import { calculateDamageWithCrit, rollHit, getEffectiveArmor, logAoeHit } from "../combat/combatMath";
import { applyDamageToUnit, buildDamageContext, createAnimatedRing } from "../combat/damageEffects";
import { soundFns } from "../audio";
import { disposeBasicMesh } from "../rendering/disposal";
import { createGroundWarningTile } from "./tileUtils";
import { getUnitById } from "../game/unitQuery";

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
            const mesh = createGroundWarningTile(scene, centerX + dx, centerZ + dz, "#ff2200", "charge-tile");
            meshes.push(mesh);
        }
    }

    // Vertical arm (along Z axis) - skip center to avoid overlap
    for (let dz = -crossLength; dz <= crossLength; dz++) {
        if (Math.abs(dz) <= halfWidth) continue; // Already covered by horizontal arm
        for (let dx = -halfWidth; dx <= halfWidth; dx++) {
            const mesh = createGroundWarningTile(scene, centerX + dx, centerZ + dz, "#ff2200", "charge-tile");
            meshes.push(mesh);
        }
    }

    return meshes;
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

    // Store charge state (use getGameTime for pause-safe timing)
    activeCharges.set(unit.id, {
        unitId: unit.id,
        elapsedTime: 0,
        lastUpdateTime: getGameTime(),
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

    const enemyData = getEnemyUnitStats(unit);
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
        const unit = getUnitById(unitId);

        // Cancel charge if unit is dead
        if (!unit || unit.hp <= 0) {
            cleanupCharge(scene, charge);
            toRemove.push(unitId);
            return;
        }

        // Accumulate elapsed time (pause-safe via getGameTime)
        accumulateDelta(charge, getGameTime());

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
    const enemyData = getEnemyUnitStats(unit);
    const dmgCtx = buildDamageContext(scene, damageTexts, hitFlashRef, unitsRef, unitsState, setUnits, addLog, now, defeatedThisFrame);

    // Find all player units in the cross area
    const halfWidth = Math.floor(charge.crossWidth / 2);
    let hitCount = 0;
    let totalDamage = 0;

    unitsState.forEach(target => {
        if (target.team !== "player") return;
        if (target.hp <= 0 || defeatedThisFrame.has(target.id)) return;

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

            if (rollHit(enemyData.accuracy, unit)) {
                const { damage: dmg } = calculateDamageWithCrit(charge.damage[0], charge.damage[1], getEffectiveArmor(target, targetData.armor), charge.damageType, unit);
                applyDamageToUnit(dmgCtx, target.id, tg, dmg, targetData.name, {
                    color: COLORS.damageEnemy,
                    targetUnit: target
                });
                hitCount++;
                totalDamage += dmg;
            }
        }
    });

    // Create explosion visual effect
    createAnimatedRing(scene, charge.centerX + 0.5, charge.centerZ + 0.5, "#ff4400", {
        innerRadius: 0.5, outerRadius: 3, maxScale: 3, duration: 400, y: 0.3
    });

    // Play sound and log
    soundFns.playHit();
    if (hitCount > 0) {
        addLog(logAoeHit(enemyData.name, charge.skillName, hitCount, totalDamage), COLORS.damageEnemy);
    } else {
        addLog(`${enemyData.name}'s ${charge.skillName} hits nothing!`, COLORS.logNeutral);
    }
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

