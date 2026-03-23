// =============================================================================
// SUPPORT SKILLS - Healing, buffs, and defensive skill executors
// =============================================================================

import * as THREE from "three";
import type { Skill, StatusEffect, StatusEffectType, Unit, UnitGroup } from "../../core/types";
import {
    COLORS,
    BUFF_TICK_INTERVAL,
    BLIND_DURATION,
    QI_DRAIN_DURATION,
    QI_DRAIN_TICK_INTERVAL,
    POISON_TICK_INTERVAL,
    HIGHLAND_DEFENSE_INTERCEPT_CAP,
    getSkillTextColor
} from "../../core/constants";
import { UNIT_DATA, getEffectiveMaxHp, getEffectiveMaxMana } from "../../game/playerUnits";
import { getFaithHealingBonus } from "../../game/statBonuses";
import { rollDamage, hasStatusEffect, logHeal, logBuff, logCleanse, applyStatusEffect } from "../combatMath";
import { tryHealBark } from "../barks";
import { getUnitRadius, isInRange } from "../../rendering/range";
import { soundFns } from "../../audio";
import { createAnimatedRing, createLightningPillar } from "../damageEffects";
import { updateUnitWith } from "../../core/stateUtils";
import { getGameTime } from "../../core/gameClock";
import { scheduleEffectAnimation } from "../../core/effectScheduler";
import type { SkillExecutionContext } from "./types";
import { findAndValidateAllyTarget, findClosestUnit, consumeSkill } from "./helpers";

const UP_AXIS = new THREE.Vector3(0, 1, 0);

function resolveLivingAllyTarget(
    ctx: SkillExecutionContext,
    casterId: number,
    targetX: number,
    targetZ: number,
    targetUnitId?: number
): { unit: Unit; group: UnitGroup } | null {
    if (targetUnitId !== undefined) {
        const lockedUnit = ctx.unitsStateRef.current.find(u => u.id === targetUnitId && u.team === "player" && u.hp > 0);
        const lockedGroup = ctx.unitsRef.current[targetUnitId];
        if (!lockedUnit || !lockedGroup) return null;
        return { unit: lockedUnit, group: lockedGroup };
    }
    return findAndValidateAllyTarget(ctx, casterId, targetX, targetZ);
}

function resolveDeadAllyTarget(
    ctx: SkillExecutionContext,
    casterId: number,
    targetX: number,
    targetZ: number,
    targetUnitId?: number
): { unit: Unit; group?: UnitGroup; x: number; z: number } | null {
    const deadAllies = ctx.unitsStateRef.current.filter(u => u.team === "player" && u.hp <= 0);
    if (deadAllies.length === 0) {
        ctx.addLog(`${UNIT_DATA[casterId].name}: No fallen allies!`, COLORS.logNeutral);
        return null;
    }

    if (targetUnitId !== undefined) {
        const lockedUnit = deadAllies.find(u => u.id === targetUnitId);
        if (!lockedUnit) return null;
        const lockedGroup = ctx.unitsRef.current[lockedUnit.id];
        return {
            unit: lockedUnit,
            group: lockedGroup,
            x: lockedGroup ? lockedGroup.position.x : lockedUnit.x,
            z: lockedGroup ? lockedGroup.position.z : lockedUnit.z
        };
    }

    let closestDead: { unit: Unit; group?: UnitGroup; x: number; z: number; dist: number } | null = null;
    for (const dead of deadAllies) {
        const deadGroup = ctx.unitsRef.current[dead.id];
        const deadX = deadGroup ? deadGroup.position.x : dead.x;
        const deadZ = deadGroup ? deadGroup.position.z : dead.z;
        const dx = deadX - targetX;
        const dz = deadZ - targetZ;
        const dist = Math.hypot(dx, dz);
        if (!closestDead || dist < closestDead.dist) {
            closestDead = { unit: dead, group: deadGroup, x: deadX, z: deadZ, dist };
        }
    }

    if (!closestDead) {
        ctx.addLog(`${UNIT_DATA[casterId].name}: No fallen ally at that location!`, COLORS.logNeutral);
        return null;
    }
    return { unit: closestDead.unit, group: closestDead.group, x: closestDead.x, z: closestDead.z };
}

function createPulseBeam(
    scene: THREE.Scene,
    fromX: number,
    fromZ: number,
    toX: number,
    toZ: number,
    color: string,
    duration: number = 300
): void {
    const from = new THREE.Vector3(fromX, 0.85, fromZ);
    const to = new THREE.Vector3(toX, 0.85, toZ);
    const direction = new THREE.Vector3().subVectors(to, from);
    const beamLength = direction.length();
    if (beamLength < 0.05) return;

    direction.normalize();

    const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.045, 0.045, beamLength, 10, 1, true),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 })
    );
    beam.position.copy(from).add(to).multiplyScalar(0.5);
    beam.quaternion.setFromUnitVectors(UP_AXIS, direction);
    scene.add(beam);

    const startTime = getGameTime();
    const material = beam.material as THREE.MeshBasicMaterial;

    scheduleEffectAnimation((gameNow) => {
        const elapsed = gameNow - startTime;
        const t = Math.min(1, elapsed / duration);

        material.opacity = 0.85 * (1 - t);
        const pulseScale = 1 + Math.sin(t * Math.PI) * 0.35;
        beam.scale.set(pulseScale, 1, pulseScale);

        if (t < 1) {
            return false;
        }

        scene.remove(beam);
        beam.geometry.dispose();
        material.dispose();
        return true;
    });
}

// =============================================================================
// MASS HEAL SKILL (self-centered AoE)
// =============================================================================

/**
 * Execute Mass Heal — self-centered AoE that heals all player allies within radius.
 */
export function executeMassHealSkill(
    ctx: SkillExecutionContext,
    casterId: number,
    skill: Skill
): boolean {
    const { scene, unitsStateRef, unitsRef, unitMeshRef, hitFlashRef, setUnits, addLog } = ctx;

    const casterG = unitsRef.current[casterId];
    if (!casterG) return false;

    const casterUnit = unitsStateRef.current.find(u => u.id === casterId);
    const faithBonus = casterUnit ? getFaithHealingBonus(casterUnit) : 0;

    // Find all living player allies within range
    const allies = unitsStateRef.current.filter(u => u.team === "player" && u.hp > 0);
    const alliesInRange: Array<{ unit: typeof allies[0]; group: THREE.Group }> = [];
    for (const ally of allies) {
        const allyG = unitsRef.current[ally.id];
        if (!allyG) continue;
        const allyRadius = getUnitRadius(ally);
        if (isInRange(casterG.position.x, casterG.position.z, allyG.position.x, allyG.position.z, allyRadius, skill.range)) {
            alliesInRange.push({ unit: ally, group: allyG });
        }
    }

    // Check if anyone actually needs healing
    const needsHealing = alliesInRange.filter(a => {
        const maxHp = getEffectiveMaxHp(a.unit.id, a.unit);
        return a.unit.hp < maxHp;
    });

    if (needsHealing.length === 0) {
        addLog(`${UNIT_DATA[casterId].name}: All nearby allies are at full health!`, COLORS.logNeutral);
        return false;
    }

    const { healRange } = skill;
    if (!healRange) return false;

    consumeSkill(ctx, casterId, skill);

    const healAmount = rollDamage(healRange[0], healRange[1]) + faithBonus;

    // Apply heal to all allies in range
    const healTargetIds = new Set(alliesInRange.map(a => a.unit.id));
    setUnits(prev => prev.map(u => {
        if (!healTargetIds.has(u.id) || u.hp <= 0) return u;
        const maxHp = getEffectiveMaxHp(u.id, u);
        if (u.hp >= maxHp) return u;
        const actual = Math.min(healAmount, maxHp - u.hp);
        return { ...u, hp: u.hp + actual };
    }));

    addLog(`${UNIT_DATA[casterId].name}'s ${skill.name} heals ${needsHealing.length} allies for ${healAmount}!`, getSkillTextColor(skill.type, skill.damageType));
    soundFns.playHeal();
    tryHealBark(UNIT_DATA[casterId].name, addLog);

    // Visual: expanding ring from caster
    createAnimatedRing(scene, casterG.position.x, casterG.position.z, COLORS.logHeal, {
        innerRadius: 0.5,
        outerRadius: skill.range,
        maxScale: 2.0,
        duration: 400
    });

    // Visual: green flash + small ring on each healed ally
    for (const { unit: ally, group: allyG } of alliesInRange) {
        const maxHp = getEffectiveMaxHp(ally.id, ally);
        if (ally.hp >= maxHp) continue;

        const mesh = unitMeshRef.current[ally.id];
        if (mesh) {
            (mesh.material as THREE.MeshStandardMaterial).color.set("#22ff22");
            hitFlashRef.current[ally.id] = getGameTime();
        }
        createAnimatedRing(scene, allyG.position.x, allyG.position.z, COLORS.logHeal, {
            innerRadius: 0.15,
            outerRadius: 0.35,
            maxScale: 1.4,
            duration: 280
        });
    }

    return true;
}

// =============================================================================
// HEAL SKILL (single ally)
// =============================================================================

/**
 * Execute an ally-targeted heal skill
 */
export function executeHealSkill(
    ctx: SkillExecutionContext,
    casterId: number,
    skill: Skill,
    targetX: number,
    targetZ: number,
    targetUnitId?: number
): boolean {
    const { scene, unitsStateRef, unitsRef, unitMeshRef, hitFlashRef, setUnits, addLog } = ctx;

    const target = resolveLivingAllyTarget(ctx, casterId, targetX, targetZ, targetUnitId);
    if (!target) return false;

    const { unit: targetAlly, group: targetG } = target;
    const casterUnit = unitsStateRef.current.find(u => u.id === casterId);
    const targetMaxHp = getEffectiveMaxHp(targetAlly.id, targetAlly);
    const casterG = unitsRef.current[casterId];
    if (!casterG) return false;

    const targetRadius = getUnitRadius(targetAlly);
    if (!isInRange(casterG.position.x, casterG.position.z, targetG.position.x, targetG.position.z, targetRadius, skill.range)) {
        addLog(`${UNIT_DATA[casterId].name}: Target out of range!`, COLORS.logNeutral);
        return false;
    }

    if (targetAlly.hp >= targetMaxHp) {
        addLog(`${UNIT_DATA[casterId].name}: ${UNIT_DATA[targetAlly.id].name} is at full health!`, COLORS.logNeutral);
        return false;
    }

    const { healRange } = skill;
    if (!healRange) return false;

    consumeSkill(ctx, casterId, skill);

    // Apply heal with faith bonus
    const faithBonus = casterUnit ? getFaithHealingBonus(casterUnit) : 0;
    const healAmount = rollDamage(healRange[0], healRange[1]) + faithBonus;
    const targetData = UNIT_DATA[targetAlly.id];
    const healTargetId = targetAlly.id;
    updateUnitWith(setUnits, healTargetId, u => ({ hp: Math.min(targetMaxHp, u.hp + healAmount) }));

    addLog(logHeal(UNIT_DATA[casterId].name, skill.name, targetData.name, healAmount), getSkillTextColor(skill.type, skill.damageType));
    soundFns.playHeal();
    tryHealBark(targetData.name, addLog);

    // Visual effect - green flash (use hitFlashRef system with green start color)
    const mesh = unitMeshRef.current[healTargetId];
    if (targetG && mesh) {
        (mesh.material as THREE.MeshStandardMaterial).color.set("#22ff22");
        hitFlashRef.current[healTargetId] = getGameTime();
    }

    createAnimatedRing(scene, targetG.position.x, targetG.position.z, COLORS.logHeal, {
        innerRadius: 0.2,
        outerRadius: 0.45,
        maxScale: 1.8,
        duration: 320
    });
    createAnimatedRing(scene, casterG.position.x, casterG.position.z, "#b6f7c1", {
        innerRadius: 0.16,
        outerRadius: 0.34,
        maxScale: 1.05,
        duration: 240
    });
    createPulseBeam(
        scene,
        casterG.position.x,
        casterG.position.z,
        targetG.position.x,
        targetG.position.z,
        COLORS.logHeal,
        280
    );

    return true;
}

// =============================================================================
// MANA TRANSFER SKILL (Qi Focus)
// =============================================================================

/**
 * Execute a mana transfer skill (like Qi Focus) - give mana to ally, take self-damage over time
 */
export function executeManaTransferSkill(
    ctx: SkillExecutionContext,
    casterId: number,
    skill: Skill,
    targetX: number,
    targetZ: number,
    targetUnitId?: number
): boolean {
    const { scene, unitsStateRef, unitsRef, unitMeshRef, hitFlashRef, setUnits, addLog } = ctx;

    const target = resolveLivingAllyTarget(ctx, casterId, targetX, targetZ, targetUnitId);
    if (!target) return false;

    const { unit: targetAlly, group: targetG } = target;
    const casterG = unitsRef.current[casterId];
    const caster = unitsStateRef.current.find(u => u.id === casterId);

    if (!casterG || !caster) return false;

    // Check range
    if (!isInRange(casterG.position.x, casterG.position.z, targetG.position.x, targetG.position.z, 0, skill.range + 0.5)) {
        addLog(`${UNIT_DATA[casterId].name}: Target out of range!`, COLORS.logNeutral);
        return false;
    }

    // Check if target is at full mana
    const targetData = UNIT_DATA[targetAlly.id];
    const targetMaxMana = getEffectiveMaxMana(targetAlly.id, targetAlly);
    if ((targetAlly.mana ?? 0) >= targetMaxMana) {
        addLog(`${UNIT_DATA[casterId].name}: ${targetData.name} is at full mana!`, COLORS.logNeutral);
        return false;
    }

    // Check if caster has enough HP for the self-damage (minimum: low end of damage range)
    const selfDamageMin = skill.selfDamage?.[0] ?? 20;
    if (caster.hp <= selfDamageMin) {
        addLog(`${UNIT_DATA[casterId].name}: Not enough life force!`, COLORS.logNeutral);
        return false;
    }

    const { manaRange } = skill;
    if (!manaRange) return false;

    consumeSkill(ctx, casterId, skill);

    const now = Date.now();
    const casterData = UNIT_DATA[casterId];

    // Give mana to ally
    const manaAmount = rollDamage(manaRange[0], manaRange[1]);
    const actualMana = Math.min(manaAmount, targetMaxMana - (targetAlly.mana ?? 0));
    const healTargetId = targetAlly.id;

    // Calculate self-damage (total damage over the duration)
    const totalSelfDamage = rollDamage(skill.selfDamage?.[0] ?? 20, skill.selfDamage?.[1] ?? 30);
    const damagePerTick = Math.ceil(totalSelfDamage / (QI_DRAIN_DURATION / QI_DRAIN_TICK_INTERVAL));

    // Apply mana to target and qi_drain effect to caster
    setUnits(prev => prev.map(u => {
        if (u.id === healTargetId) {
            const maxMana = getEffectiveMaxMana(u.id, u);
            return { ...u, mana: Math.min(maxMana, (u.mana ?? 0) + actualMana) };
        }
        if (u.id === casterId) {
            const existingEffects = u.statusEffects || [];
            const qiDrainEffect: StatusEffect = {
                type: "qi_drain",
                duration: QI_DRAIN_DURATION,
                tickInterval: QI_DRAIN_TICK_INTERVAL,
                timeSinceTick: 0,
                lastUpdateTime: now,
                damagePerTick: damagePerTick,
                sourceId: casterId
            };
            return { ...u, statusEffects: [...existingEffects, qiDrainEffect] };
        }
        return u;
    }));

    addLog(`${casterData.name}'s ${skill.name} restores ${actualMana} mana to ${targetData.name}!`, getSkillTextColor(skill.type, skill.damageType));
    soundFns.playHeal();

    // Visual effect - blue flash on target (mana color)
    const mesh = unitMeshRef.current[healTargetId];
    if (targetG && mesh) {
        (mesh.material as THREE.MeshStandardMaterial).color.set("#3498db");
        hitFlashRef.current[healTargetId] = getGameTime();
    }

    const casterMesh = unitMeshRef.current[casterId];
    if (casterMesh) {
        (casterMesh.material as THREE.MeshStandardMaterial).color.set("#e74c3c");
        hitFlashRef.current[casterId] = getGameTime();
    }

    createAnimatedRing(scene, casterG.position.x, casterG.position.z, "#e74c3c", {
        innerRadius: 0.25,
        outerRadius: 0.45,
        maxScale: 1.3,
        duration: 300
    });
    createAnimatedRing(scene, targetG.position.x, targetG.position.z, COLORS.mana, {
        innerRadius: 0.2,
        outerRadius: 0.42,
        maxScale: 1.6,
        duration: 300
    });
    createPulseBeam(
        scene,
        casterG.position.x,
        casterG.position.z,
        targetG.position.x,
        targetG.position.z,
        COLORS.mana,
        320
    );

    return true;
}

// =============================================================================
// BUFF TEMPLATE SYSTEM
// =============================================================================

interface BuffTemplate {
    effectType: StatusEffectType;
    ringColor: string;
    ringOpts: { innerRadius?: number; outerRadius?: number; maxScale: number; duration?: number };
    sound: () => void;
    logMessage: (casterName: string, skillName: string, allyCount?: number) => string;
    logColor?: string;
    extraEffectFields?: Partial<StatusEffect>;
    aoe?: boolean;
}

/**
 * Shared buff application: consumeSkill → build effect → apply to targets → sound + log + ring.
 * Handles both self-buffs and AoE buffs via the `aoe` flag on the template.
 */
function applyBuffFromTemplate(
    ctx: SkillExecutionContext,
    casterId: number,
    skill: Skill,
    template: BuffTemplate
): boolean {
    const { scene, unitsStateRef, unitsRef, setUnits, addLog } = ctx;

    const casterG = unitsRef.current[casterId];
    if (!casterG) return false;

    const { duration } = skill;
    if (!duration) return false;

    consumeSkill(ctx, casterId, skill);

    const casterData = UNIT_DATA[casterId];
    const now = Date.now();
    const skillLogColor = template.logColor ?? getSkillTextColor(skill.type, skill.damageType);

    const effect: StatusEffect = {
        type: template.effectType,
        duration,
        tickInterval: BUFF_TICK_INTERVAL,
        timeSinceTick: 0,
        lastUpdateTime: now,
        damagePerTick: 0,
        sourceId: casterId,
        ...template.extraEffectFields
    };

    if (template.aoe) {
        // Find all player allies within range
        const allies = unitsStateRef.current.filter(u => u.team === "player" && u.hp > 0);
        const alliesInRange: number[] = [];
        for (const ally of allies) {
            const allyG = unitsRef.current[ally.id];
            if (!allyG) continue;
            const allyRadius = getUnitRadius(ally);
            if (isInRange(casterG.position.x, casterG.position.z, allyG.position.x, allyG.position.z, allyRadius, skill.range)) {
                alliesInRange.push(ally.id);
            }
        }

        setUnits(prev => prev.map(u =>
            alliesInRange.includes(u.id) ? { ...u, statusEffects: applyStatusEffect(u.statusEffects, effect) } : u
        ));
        for (const allyId of alliesInRange) {
            const allyG = unitsRef.current[allyId];
            if (!allyG) continue;
            createAnimatedRing(scene, allyG.position.x, allyG.position.z, template.ringColor, {
                innerRadius: 0.14,
                outerRadius: 0.28,
                maxScale: 1.0,
                duration: Math.max(180, Math.floor((template.ringOpts.duration ?? 260) * 0.8))
            });
        }

        template.sound();
        addLog(template.logMessage(casterData.name, skill.name, alliesInRange.length), skillLogColor);
    } else {
        setUnits(prev => prev.map(u =>
            u.id === casterId ? { ...u, statusEffects: applyStatusEffect(u.statusEffects, effect) } : u
        ));

        template.sound();
        addLog(template.logMessage(casterData.name, skill.name), skillLogColor);
    }

    createAnimatedRing(scene, casterG.position.x, casterG.position.z, template.ringColor, template.ringOpts);

    return true;
}

// =============================================================================
// BUFF SKILL (self-buff like Raise Shield)
// =============================================================================

/**
 * Execute a self-buff skill (like Raise Shield)
 */
export function executeBuffSkill(
    ctx: SkillExecutionContext,
    casterId: number,
    skill: Skill
): boolean {
    return applyBuffFromTemplate(ctx, casterId, skill, {
        effectType: "shielded",
        ringColor: "#f1c40f",
        ringOpts: { innerRadius: 0.3, outerRadius: 0.5, maxScale: 1.5, duration: 300 },
        sound: soundFns.playHeal,
        logMessage: (name, skillName) => logBuff(name, skillName),
        logColor: getSkillTextColor(skill.type, skill.damageType),
    });
}

// =============================================================================
// AOE BUFF SKILL (Defiance)
// =============================================================================

/**
 * Execute AOE Buff skill (like Defiance) - applies a buff to all allies within range
 */
export function executeAoeBuffSkill(
    ctx: SkillExecutionContext,
    casterId: number,
    skill: Skill
): boolean {
    return applyBuffFromTemplate(ctx, casterId, skill, {
        effectType: "defiance",
        ringColor: "#c0392b",
        ringOpts: { innerRadius: 0.5, outerRadius: skill.range, maxScale: 2, duration: 400 },
        sound: soundFns.playWarcry,
        logMessage: (name, skillName, count) => `${name} rallies ${count} allies with ${skillName}!`,
        logColor: getSkillTextColor(skill.type, skill.damageType),
        aoe: true,
    });
}

// =============================================================================
// ENERGY SHIELD SKILL
// =============================================================================

/**
 * Execute Energy Shield skill - creates a damage-absorbing barrier
 */
export function executeEnergyShieldSkill(
    ctx: SkillExecutionContext,
    casterId: number,
    skill: Skill
): boolean {
    const { shieldAmount } = skill;
    if (!shieldAmount) return false;

    return applyBuffFromTemplate(ctx, casterId, skill, {
        effectType: "energy_shield",
        ringColor: "#66ccff",
        ringOpts: { innerRadius: 0.2, outerRadius: 0.6, maxScale: 1.8, duration: 350 },
        sound: soundFns.playEnergyShield,
        logMessage: (name) => `${name} conjures an Energy Shield!`,
        logColor: getSkillTextColor(skill.type, skill.damageType),
        extraEffectFields: { shieldAmount },
    });
}

// =============================================================================
// DIVINE LATTICE SKILL
// =============================================================================

/**
 * Execute Divine Lattice - target any unit (ally or enemy):
 * impervious to all damage, cannot act, and enemies stop targeting them.
 */
export function executeDivineLatticeSkill(
    ctx: SkillExecutionContext,
    casterId: number,
    skill: Skill,
    targetX: number,
    targetZ: number,
    targetUnitId?: number
): boolean {
    const { scene, unitsStateRef, unitsRef, unitMeshRef, hitFlashRef, setUnits, addLog } = ctx;

    const livingUnits = unitsStateRef.current.filter(u => u.hp > 0);
    if (livingUnits.length === 0) {
        addLog(`${UNIT_DATA[casterId].name}: No valid target!`, COLORS.logNeutral);
        return false;
    }

    let target = targetUnitId !== undefined
        ? livingUnits.find(u => u.id === targetUnitId)
        : undefined;
    let targetG = target ? unitsRef.current[target.id] : undefined;

    if (!target || !targetG) {
        if (targetUnitId !== undefined) return false;
        const closest = findClosestUnit(livingUnits, unitsRef.current, targetX, targetZ, 2.2);
        if (!closest) {
            addLog(`${UNIT_DATA[casterId].name}: No target at that location!`, COLORS.logNeutral);
            return false;
        }
        target = closest.unit;
        targetG = closest.group;
    }

    const casterG = unitsRef.current[casterId];
    if (!casterG) return false;
    const targetRadius = getUnitRadius(target);
    if (!isInRange(casterG.position.x, casterG.position.z, targetG.position.x, targetG.position.z, targetRadius, skill.range)) {
        addLog(`${UNIT_DATA[casterId].name}: Target out of range!`, COLORS.logNeutral);
        return false;
    }

    const targetName = target.team === "player"
        ? UNIT_DATA[target.id].name
        : `the ${target.enemyType?.replace(/_/g, " ") ?? "enemy"}`;

    if (hasStatusEffect(target, "divine_lattice")) {
        addLog(`${UNIT_DATA[casterId].name}: ${targetName} is already in Divine Lattice!`, COLORS.logNeutral);
        return false;
    }

    const { duration } = skill;
    if (!duration) return false;

    consumeSkill(ctx, casterId, skill);

    const now = Date.now();
    const latticeEffect: StatusEffect = {
        type: "divine_lattice",
        duration,
        tickInterval: BUFF_TICK_INTERVAL,
        timeSinceTick: 0,
        lastUpdateTime: now,
        damagePerTick: 0,
        sourceId: casterId
    };

    setUnits(prev => prev.map(u => {
        if (u.id !== target!.id) return u;
        return {
            ...u,
            target: null,
            statusEffects: applyStatusEffect(u.statusEffects, latticeEffect)
        };
    }));

    targetG.userData.attackTarget = null;

    createAnimatedRing(scene, targetG.position.x, targetG.position.z, COLORS.divineLatticeText, {
        innerRadius: 0.25,
        outerRadius: 0.62,
        maxScale: 1.9,
        duration: 360
    });
    soundFns.playEnergyShield();

    const mesh = unitMeshRef.current[target.id];
    if (mesh) {
        (mesh.material as THREE.MeshStandardMaterial).color.set("#ffffff");
        hitFlashRef.current[target.id] = getGameTime();
    }

    addLog(`${UNIT_DATA[casterId].name} seals ${targetName} in Divine Lattice.`, getSkillTextColor(skill.type, skill.damageType));
    return true;
}

// =============================================================================
// CLEANSE SKILL
// =============================================================================

/**
 * Execute a cleanse skill (remove poison and grant poison immunity to an ally)
 */
export function executeCleanseSkill(
    ctx: SkillExecutionContext,
    casterId: number,
    skill: Skill,
    targetX: number,
    targetZ: number,
    targetUnitId?: number
): boolean {
    const { scene, unitsRef, unitMeshRef, hitFlashRef, setUnits, addLog } = ctx;

    const allyTarget = resolveLivingAllyTarget(ctx, casterId, targetX, targetZ, targetUnitId);
    if (!allyTarget) return false;

    const { unit: targetAlly, group: targetG } = allyTarget;
    const casterG = unitsRef.current[casterId];
    if (!casterG) return false;

    const targetRadius = getUnitRadius(targetAlly);
    if (!isInRange(casterG.position.x, casterG.position.z, targetG.position.x, targetG.position.z, targetRadius, skill.range)) {
        addLog(`${UNIT_DATA[casterId].name}: Target out of range!`, COLORS.logNeutral);
        return false;
    }

    const targetData = UNIT_DATA[targetAlly.id];
    const targetId = targetAlly.id;
    const now = Date.now();

    // Check if ally actually needs cleansing (has poison or no immunity yet)
    const hasPoisonNow = hasStatusEffect(targetAlly, "poison");
    const alreadyCleansed = targetAlly.statusEffects?.some(e => e.type === "cleansed") ?? false;

    if (!hasPoisonNow && alreadyCleansed) {
        addLog(`${UNIT_DATA[casterId].name}: ${targetData.name} is already protected!`, COLORS.logNeutral);
        return false;
    }

    consumeSkill(ctx, casterId, skill);

    const casterData = UNIT_DATA[casterId];
    const { duration } = skill;
    if (!duration) return false;

    // Apply cleanse: remove poison and add cleansed (immunity) effect
    const cleansedEffect: StatusEffect = {
        type: "cleansed",
        duration,
        tickInterval: BUFF_TICK_INTERVAL,
        timeSinceTick: 0,
        lastUpdateTime: now,
        damagePerTick: 0,
        sourceId: casterId
    };
    setUnits(prev => prev.map(u => {
        if (u.id !== targetId) return u;
        // First remove poison, then apply cleansed effect (which replaces existing cleansed)
        const withoutPoison = (u.statusEffects || []).filter(e => e.type !== "poison");
        return { ...u, statusEffects: applyStatusEffect(withoutPoison, cleansedEffect) };
    }));

    // Play sound and log
    soundFns.playHeal();
    addLog(logCleanse(casterData.name, targetData.name), getSkillTextColor(skill.type, skill.damageType));

    // Visual effect - white/silver glow ring
    createAnimatedRing(scene, targetG.position.x, targetG.position.z, "#ecf0f1", {
        innerRadius: 0.3, outerRadius: 0.5, maxScale: 1.5, duration: 300
    });

    // Visual effect - white flash on target
    const mesh = unitMeshRef.current[targetId];
    if (targetG && mesh) {
        (mesh.material as THREE.MeshStandardMaterial).color.set("#ffffff");
        hitFlashRef.current[targetId] = getGameTime();
    }

    return true;
}

// =============================================================================
// RESTORATION SKILL
// =============================================================================

/**
 * Execute Restoration skill - removes doom, poison, burn, movement/attack debuffs, and sleep, then applies regen HoT.
 */
export function executeRestorationSkill(
    ctx: SkillExecutionContext,
    casterId: number,
    skill: Skill,
    targetX: number,
    targetZ: number,
    targetUnitId?: number
): boolean {
    const { scene, unitsRef, unitMeshRef, hitFlashRef, setUnits, addLog } = ctx;

    const allyTarget = resolveLivingAllyTarget(ctx, casterId, targetX, targetZ, targetUnitId);
    if (!allyTarget) return false;

    const { unit: targetAlly, group: targetG } = allyTarget;
    const casterG = unitsRef.current[casterId];
    if (!casterG) return false;

    const targetRadius = getUnitRadius(targetAlly);
    if (!isInRange(casterG.position.x, casterG.position.z, targetG.position.x, targetG.position.z, targetRadius, skill.range)) {
        addLog(`${UNIT_DATA[casterId].name}: Target out of range!`, COLORS.logNeutral);
        return false;
    }

    const targetData = UNIT_DATA[targetAlly.id];
    const targetId = targetAlly.id;

    // Check if target actually needs restoration (has harmful effects or is not at full HP)
    const hasDoom = hasStatusEffect(targetAlly, "doom");
    const hasPoison = hasStatusEffect(targetAlly, "poison");
    const hasBurn = hasStatusEffect(targetAlly, "burn");
    const hasSlow = hasStatusEffect(targetAlly, "slowed");
    const hasHamstrung = hasStatusEffect(targetAlly, "hamstrung");
    const hasWeakened = hasStatusEffect(targetAlly, "weakened");
    const hasSleep = hasStatusEffect(targetAlly, "sleep");
    const targetMaxHp = getEffectiveMaxHp(targetAlly.id, targetAlly);
    const needsHealing = targetAlly.hp < targetMaxHp;

    if (!hasDoom && !hasPoison && !hasBurn && !hasSlow && !hasHamstrung && !hasWeakened && !hasSleep && !needsHealing) {
        addLog(`${UNIT_DATA[casterId].name}: ${targetData.name} doesn't need restoration!`, COLORS.logNeutral);
        return false;
    }

    consumeSkill(ctx, casterId, skill);

    const casterData = UNIT_DATA[casterId];
    const now = Date.now();
    const { duration, healPerTick } = skill;
    if (!duration || !healPerTick) return false;

    // Remove harmful effects and apply regen
    const regenEffect: StatusEffect = {
        type: "regen",
        duration,
        tickInterval: POISON_TICK_INTERVAL,  // 1s ticks (same interval as poison)
        timeSinceTick: 0,
        lastUpdateTime: now,
        damagePerTick: 0,  // Regen heals, not damages (handled specially in status processing)
        sourceId: casterId,
        shieldAmount: healPerTick  // Reuse shieldAmount field to store heal-per-tick
    };

    setUnits(prev => prev.map(u => {
        if (u.id !== targetId) return u;
        // Remove doom, poison, burn, movement/attack debuffs, and sleep
        const cleansedEffects = (u.statusEffects ?? []).filter(
            e => e.type !== "doom"
                && e.type !== "poison"
                && e.type !== "burn"
                && e.type !== "slowed"
                && e.type !== "hamstrung"
                && e.type !== "weakened"
                && e.type !== "sleep"
        );
        return { ...u, statusEffects: applyStatusEffect(cleansedEffects, regenEffect) };
    }));

    // Log what was removed
    const removedEffects: string[] = [];
    if (hasDoom) removedEffects.push("Doom");
    if (hasPoison) removedEffects.push("Poison");
    if (hasBurn) removedEffects.push("Burn");
    if (hasSlow) removedEffects.push("Slow");
    if (hasHamstrung) removedEffects.push("Hamstrung");
    if (hasWeakened) removedEffects.push("Weakened");
    if (hasSleep) removedEffects.push("Sleep");

    soundFns.playHeal();
    if (removedEffects.length > 0) {
        addLog(`${casterData.name}'s ${skill.name} purges ${removedEffects.join(", ")} from ${targetData.name}!`, getSkillTextColor(skill.type, skill.damageType));
    }
    addLog(`${targetData.name} is restored, healing over time.`, COLORS.logHeal);

    // Visual effect - golden glow ring
    createAnimatedRing(scene, targetG.position.x, targetG.position.z, "#ffd700", {
        innerRadius: 0.3, outerRadius: 0.5, maxScale: 1.5, duration: 300
    });

    // Visual effect - golden flash on target
    const meshRef = unitMeshRef.current[targetId];
    if (targetG && meshRef) {
        (meshRef.material as THREE.MeshStandardMaterial).color.set("#ffd700");
        hitFlashRef.current[targetId] = getGameTime();
    }

    return true;
}

// =============================================================================
// REVIVE SKILL (Ankh)
// =============================================================================

/**
 * Execute Revive skill - revive a downed ally to 1 HP, placed next to the caster.
 */
export function executeReviveSkill(
    ctx: SkillExecutionContext,
    casterId: number,
    skill: Skill,
    targetX: number,
    targetZ: number,
    targetUnitId?: number
): boolean {
    const { scene, unitsRef, unitMeshRef, hitFlashRef, setUnits, addLog } = ctx;

    const reviveTarget = resolveDeadAllyTarget(ctx, casterId, targetX, targetZ, targetUnitId);
    if (!reviveTarget) return false;
    const { unit: deadAlly, x: deadX, z: deadZ } = reviveTarget;

    const casterG = unitsRef.current[casterId];
    if (!casterG) return false;
    const targetRadius = getUnitRadius(deadAlly);
    if (!isInRange(casterG.position.x, casterG.position.z, deadX, deadZ, targetRadius, skill.range)) {
        addLog(`${UNIT_DATA[casterId].name}: Target out of range!`, COLORS.logNeutral);
        return false;
    }

    consumeSkill(ctx, casterId, skill);

    const casterData = UNIT_DATA[casterId];
    const targetData = UNIT_DATA[deadAlly.id];
    const reviveId = deadAlly.id;

    // Place revived unit next to caster
    const reviveAngle = Math.random() * Math.PI * 2;
    const reviveX = casterG ? casterG.position.x + Math.cos(reviveAngle) * 1.5 : targetX;
    const reviveZ = casterG ? casterG.position.z + Math.sin(reviveAngle) * 1.5 : targetZ;

    // Revive to 1 HP, clear status effects, move to caster
    setUnits(prev => prev.map(u => {
        if (u.id !== reviveId) return u;
        return { ...u, hp: 1, x: reviveX, z: reviveZ, statusEffects: undefined, target: null };
    }));

    // Make the unit visible again and update position
    const reviveG = unitsRef.current[reviveId];
    if (reviveG) {
        reviveG.visible = true;
        reviveG.position.set(reviveX, reviveG.userData.flyHeight, reviveZ);
        reviveG.userData.targetX = reviveX;
        reviveG.userData.targetZ = reviveZ;
    }

    soundFns.playHeal();
    addLog(`${casterData.name}'s ${skill.name} revives ${targetData.name}!`, getSkillTextColor(skill.type, skill.damageType));

    if (casterG) {
        createAnimatedRing(scene, casterG.position.x, casterG.position.z, "#ffd700", {
            innerRadius: 0.2,
            outerRadius: 0.4,
            maxScale: 1.15,
            duration: 260
        });
        createPulseBeam(scene, casterG.position.x, casterG.position.z, reviveX, reviveZ, "#ffd700", 320);
    }

    // Visual effect - golden lightning pillar at revive location
    createLightningPillar(scene, reviveX, reviveZ, {
        color: "#ffd700",
        duration: 600,
        radius: 0.3,
        height: 10
    });

    // Visual effect - golden flash on revived unit
    const meshRef = unitMeshRef.current[reviveId];
    if (meshRef) {
        (meshRef.material as THREE.MeshStandardMaterial).color.set("#ffd700");
        hitFlashRef.current[reviveId] = getGameTime();
    }

    return true;
}

// =============================================================================
// SUN STANCE SKILL (self-buff + small heal)
// =============================================================================

/**
 * Execute Sun Stance — self-buff that adds fire damage to attacks + small instant heal.
 */
export function executeSunStanceSkill(
    ctx: SkillExecutionContext,
    casterId: number,
    skill: Skill
): boolean {
    const { unitMeshRef, hitFlashRef, setUnits } = ctx;

    // Apply buff via template
    const success = applyBuffFromTemplate(ctx, casterId, skill, {
        effectType: "sun_stance",
        ringColor: "#ff6b35",
        ringOpts: { innerRadius: 0.3, outerRadius: 0.5, maxScale: 1.5, duration: 300 },
        sound: soundFns.playHeal,
        logMessage: (name, skillName) => logBuff(name, skillName),
        logColor: getSkillTextColor(skill.type, skill.damageType),
    });

    if (success && skill.healRange) {
        // Small immediate heal
        const healAmount = rollDamage(skill.healRange[0], skill.healRange[1]);
        updateUnitWith(setUnits, casterId, u => ({ hp: Math.min(getEffectiveMaxHp(u.id, u), u.hp + healAmount) }));

        // Orange flash
        const mesh = unitMeshRef.current[casterId];
        if (mesh) {
            (mesh.material as THREE.MeshStandardMaterial).color.set("#ff6b35");
            hitFlashRef.current[casterId] = getGameTime();
        }
    }

    return success;
}

// =============================================================================
// PANGOLIN STANCE SKILL (self-buff thorns)
// =============================================================================

/**
 * Execute Pangolin Stance - self-buff that reflects melee damage back to attackers.
 */
export function executePangolinStanceSkill(
    ctx: SkillExecutionContext,
    casterId: number,
    skill: Skill
): boolean {
    const thornsDamage = skill.damageRange
        ? rollDamage(skill.damageRange[0], skill.damageRange[1])
        : 2;

    return applyBuffFromTemplate(ctx, casterId, skill, {
        effectType: "thorns",
        ringColor: "#c8da4b",
        ringOpts: { innerRadius: 0.35, outerRadius: 0.55, maxScale: 1.6, duration: 320 },
        sound: soundFns.playHeal,
        logMessage: (name, skillName) => `${name} assumes ${skillName}!`,
        logColor: getSkillTextColor(skill.type, skill.damageType),
        extraEffectFields: { thornsDamage },
    });
}

// =============================================================================
// HIGHLAND DEFENSE SKILL (self-buff ally intercept)
// =============================================================================

/**
 * Execute Highland Defense - redirects nearby ally damage to the barbarian.
 */
export function executeHighlandDefenseSkill(
    ctx: SkillExecutionContext,
    casterId: number,
    skill: Skill
): boolean {
    return applyBuffFromTemplate(ctx, casterId, skill, {
        effectType: "highland_defense",
        ringColor: COLORS.highlandDefenseText,
        ringOpts: { innerRadius: 0.35, outerRadius: 0.6, maxScale: 1.8, duration: 360 },
        sound: soundFns.playWarcry,
        logMessage: (name, skillName) => `${name} channels ${skillName}!`,
        logColor: COLORS.highlandDefenseText,
        extraEffectFields: { interceptRemaining: HIGHLAND_DEFENSE_INTERCEPT_CAP, interceptCooldownEnd: 0 },
    });
}

// =============================================================================
// VANQUISHING LIGHT SKILL (holy damage aura + blind chance)
// =============================================================================

/**
 * Execute Vanquishing Light - self aura that periodically damages nearby enemies and can blind.
 */
export function executeVanquishingLightSkill(
    ctx: SkillExecutionContext,
    casterId: number,
    skill: Skill
): boolean {
    const tickInterval = skill.tickInterval ?? 1000;
    const damagePerTick = skill.damagePerTick ?? 3;
    const blindChance = skill.blindChance ?? 30;
    const blindDuration = skill.blindDuration ?? BLIND_DURATION;

    return applyBuffFromTemplate(ctx, casterId, skill, {
        effectType: "vanquishing_light",
        ringColor: COLORS.dmgHoly,
        ringOpts: { innerRadius: 0.4, outerRadius: 0.7, maxScale: skill.range + 0.9, duration: 380 },
        sound: soundFns.playHolyStrike,
        logMessage: (name, skillName) => `${name} invokes ${skillName}!`,
        logColor: COLORS.dmgHoly,
        extraEffectFields: {
            tickInterval,
            damagePerTick,
            auraRadius: skill.range,
            blindChance,
            blindDuration,
            auraDamageType: "holy"
        },
    });
}
