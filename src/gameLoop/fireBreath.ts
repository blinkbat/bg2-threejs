// =============================================================================
// FIRE BREATH - Sustained channeled cone attack that locks caster in place
// =============================================================================

import * as THREE from "three";
import type { Unit, UnitGroup, DamageText, EnemyStats, EnemyBreathSkill } from "../core/types";
import { COLORS, FIRE_BREATH_BASE_OPACITY, FIRE_BREATH_OPACITY_AMPLITUDE, FIRE_BREATH_PULSE_SPEED } from "../core/constants";
import { getUnitStats } from "../game/units";
import { getGameTime, accumulateDelta } from "../core/gameClock";
import { calculateDamageWithCrit, rollHit, getEffectiveArmor, isUnitAlive, setSkillCooldown } from "../combat/combatMath";
import { applyDamageToUnit, buildDamageContext } from "../combat/damageEffects";
import { soundFns } from "../audio";
import { disposeBasicMesh } from "../rendering/disposal";
import { isPointInCone } from "../game/geometry";

// =============================================================================
// TYPES
// =============================================================================

interface BreathState {
    casterId: number;
    skill: EnemyBreathSkill;
    coneOriginX: number;
    coneOriginZ: number;
    facingAngle: number;
    targetId: number;
    elapsedTime: number;
    lastUpdateTime: number;
    timeSinceTick: number;
    coneMesh: THREE.Mesh;
    stopScratchSound: () => void;
    // Cooldown setter stored so we can set cooldown when channel ends
    setSkillCooldowns: React.Dispatch<React.SetStateAction<Record<string, { end: number; duration: number }>>>;
}

// =============================================================================
// STATE
// =============================================================================

const activeBreaths = new Map<number, BreathState>();

// =============================================================================
// CONE MESH
// =============================================================================

function createBreathConeMesh(
    scene: THREE.Scene,
    originX: number,
    originZ: number,
    facingAngle: number,
    coneAngle: number,
    coneDistance: number
): THREE.Mesh {
    const geometry = new THREE.RingGeometry(0.3, coneDistance, 32, 1, -coneAngle, coneAngle * 2);
    const material = new THREE.MeshBasicMaterial({
        color: COLORS.fireBreath,
        transparent: true,
        opacity: 0.4,
        side: THREE.DoubleSide
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(originX, 0.05, originZ);
    mesh.rotation.z = -facingAngle;
    mesh.name = "fire-breath-cone";
    scene.add(mesh);
    return mesh;
}

// =============================================================================
// LIFECYCLE
// =============================================================================

export function startFireBreath(
    scene: THREE.Scene,
    unit: Unit,
    g: UnitGroup,
    skill: EnemyBreathSkill,
    targetId: number,
    targetG: UnitGroup,
    now: number,
    setSkillCooldowns: React.Dispatch<React.SetStateAction<Record<string, { end: number; duration: number }>>>,
    addLog: (text: string, color?: string) => void
): void {
    if (activeBreaths.has(unit.id)) return;

    const facingAngle = Math.atan2(
        targetG.position.z - g.position.z,
        targetG.position.x - g.position.x
    );

    const coneMesh = createBreathConeMesh(
        scene, g.position.x, g.position.z,
        facingAngle, skill.coneAngle, skill.coneDistance
    );
    const stopScratchSound = soundFns.startFireBreathScratch();

    activeBreaths.set(unit.id, {
        casterId: unit.id,
        skill,
        coneOriginX: g.position.x,
        coneOriginZ: g.position.z,
        facingAngle,
        targetId,
        elapsedTime: 0,
        lastUpdateTime: now,
        timeSinceTick: 0,
        coneMesh,
        stopScratchSound,
        setSkillCooldowns
    });

    const enemyData = getUnitStats(unit) as EnemyStats;
    addLog(`${enemyData.name} breathes fire!`, COLORS.fireBreath);
}

export function isUnitBreathing(unitId: number): boolean {
    return activeBreaths.has(unitId);
}

// =============================================================================
// PER-FRAME PROCESSING
// =============================================================================

export function processFireBreaths(
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

    activeBreaths.forEach((breath, unitId) => {
        const unit = unitsState.find(u => u.id === unitId);
        const casterG = unitsRef[unitId];

        // Cancel if caster died
        if (!unit || unit.hp <= 0 || !casterG) {
            cleanupBreath(scene, breath);
            toRemove.push(unitId);
            return;
        }

        // Accumulate elapsed time (pause-safe, capped delta)
        const delta = accumulateDelta(breath, now);
        breath.timeSinceTick += delta;

        // Check if channel ended
        if (breath.elapsedTime >= breath.skill.duration) {
            cleanupBreath(scene, breath);
            // Set cooldown now that channel is complete
            const cooldownKey = `${unitId}-${breath.skill.name}`;
            setSkillCooldown(breath.setSkillCooldowns, cooldownKey, breath.skill.cooldown, now, unit);
            toRemove.push(unitId);
            return;
        }

        // Aim at current target — retarget if needed
        let targetG = unitsRef[breath.targetId];
        let targetUnit = unitsState.find(u => u.id === breath.targetId);

        // If current target is dead/gone, find nearest alive player
        if (!targetUnit || targetUnit.hp <= 0 || !targetG) {
            let bestDist = Infinity;
            for (const u of unitsState) {
                if (u.team !== "player" || !isUnitAlive(u, defeatedThisFrame)) continue;
                const ug = unitsRef[u.id];
                if (!ug) continue;
                const d = Math.hypot(ug.position.x - casterG.position.x, ug.position.z - casterG.position.z);
                if (d < bestDist) {
                    bestDist = d;
                    breath.targetId = u.id;
                    targetG = ug;
                    targetUnit = u;
                }
            }
        }

        // Update facing to track target
        if (targetG) {
            breath.facingAngle = Math.atan2(
                targetG.position.z - casterG.position.z,
                targetG.position.x - casterG.position.x
            );
        }

        // Update cone mesh position and rotation
        breath.coneOriginX = casterG.position.x;
        breath.coneOriginZ = casterG.position.z;
        breath.coneMesh.position.set(casterG.position.x, 0.05, casterG.position.z);
        breath.coneMesh.rotation.z = -breath.facingAngle;

        // Pulse opacity for visual effect
        const gameTime = getGameTime();
        const pulse = FIRE_BREATH_BASE_OPACITY + FIRE_BREATH_OPACITY_AMPLITUDE * Math.sin(gameTime * FIRE_BREATH_PULSE_SPEED);
        (breath.coneMesh.material as THREE.MeshBasicMaterial).opacity = pulse;

        // Damage tick
        if (breath.timeSinceTick >= breath.skill.tickInterval) {
            breath.timeSinceTick = 0;

            const casterStats = getUnitStats(unit) as EnemyStats;
            const dmgCtx = buildDamageContext(scene, damageTexts, hitFlashRef, unitsRef, unitsState, setUnits, addLog, now, defeatedThisFrame);

            for (const target of unitsState) {
                if (target.team !== "player") continue;
                if (target.hp <= 0 || defeatedThisFrame.has(target.id)) continue;
                const tg = unitsRef[target.id];
                if (!tg) continue;

                if (!isPointInCone(
                    tg.position.x, tg.position.z,
                    breath.coneOriginX, breath.coneOriginZ,
                    breath.facingAngle, breath.skill.coneAngle, breath.skill.coneDistance
                )) continue;

                if (rollHit(casterStats.accuracy)) {
                    const targetData = getUnitStats(target);
                    const { damage: dmg, isCrit } = calculateDamageWithCrit(
                        breath.skill.damage[0], breath.skill.damage[1],
                        getEffectiveArmor(target, targetData.armor),
                        breath.skill.damageType, unit
                    );

                    applyDamageToUnit(dmgCtx, target.id, tg, dmg, targetData.name, {
                        color: COLORS.damageEnemy,
                        targetUnit: target,
                        isCrit
                    });
                }
            }
        }
    });

    toRemove.forEach(id => activeBreaths.delete(id));
}

// =============================================================================
// CLEANUP
// =============================================================================

function cleanupBreath(scene: THREE.Scene | undefined, breath: BreathState): void {
    breath.stopScratchSound();
    if (scene) {
        disposeBasicMesh(scene, breath.coneMesh);
    }
}

export function clearFireBreaths(scene?: THREE.Scene): void {
    activeBreaths.forEach(breath => cleanupBreath(scene, breath));
    activeBreaths.clear();
}
