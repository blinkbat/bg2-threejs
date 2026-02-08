// =============================================================================
// SUPPORT SKILLS - Healing, buffs, and defensive skill executors
// =============================================================================

import * as THREE from "three";
import type { Skill, StatusEffect } from "../../core/types";
import { COLORS, BUFF_TICK_INTERVAL, QI_DRAIN_DURATION, QI_DRAIN_TICK_INTERVAL, POISON_TICK_INTERVAL } from "../../core/constants";
import { UNIT_DATA, getEffectiveMaxHp } from "../../game/units";
import { getFaithHealingBonus } from "../../game/statBonuses";
import { rollDamage, hasStatusEffect, logHeal, logBuff, logCleanse, applyStatusEffect } from "../combatMath";
import { tryHealBark } from "../barks";
import { getUnitRadius, isInRange } from "../../rendering/range";
import { soundFns } from "../../audio";
import { createAnimatedRing, createLightningPillar } from "../damageEffects";
import { updateUnitWith } from "../../core/stateUtils";
import type { SkillExecutionContext } from "./types";
import { findClosestTargetByTeam, consumeSkill } from "./helpers";

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
    targetZ: number
): boolean {
    const { unitsStateRef, unitsRef, unitMeshRef, hitFlashRef, setUnits, addLog } = ctx;

    // Find closest ally to target position
    const closest = findClosestTargetByTeam(unitsStateRef.current, unitsRef.current, "player", targetX, targetZ);

    if (!closest) {
        addLog(`${UNIT_DATA[casterId].name}: No ally at that location!`, COLORS.logNeutral);
        return false;
    }

    const { unit: targetAlly, group: targetG } = closest;
    const casterUnit = unitsStateRef.current.find(u => u.id === casterId);
    const targetMaxHp = getEffectiveMaxHp(targetAlly.id, targetAlly);
    if (targetAlly.hp >= targetMaxHp) {
        addLog(`${UNIT_DATA[casterId].name}: ${UNIT_DATA[targetAlly.id].name} is at full health!`, COLORS.logNeutral);
        return false;
    }

    consumeSkill(ctx, casterId, skill);

    // Apply heal with faith bonus
    const faithBonus = casterUnit ? getFaithHealingBonus(casterUnit) : 0;
    const healAmount = rollDamage(skill.healRange![0], skill.healRange![1]) + faithBonus;
    const targetData = UNIT_DATA[targetAlly.id];
    const healTargetId = targetAlly.id;
    updateUnitWith(setUnits, healTargetId, u => ({ hp: Math.min(targetMaxHp, u.hp + healAmount) }));

    addLog(logHeal(UNIT_DATA[casterId].name, skill.name, targetData.name, healAmount), COLORS.hpHigh);
    soundFns.playHeal();
    tryHealBark(targetData.name, addLog);

    // Visual effect - green flash (use hitFlashRef system with green start color)
    const mesh = unitMeshRef.current[healTargetId];
    if (targetG && mesh) {
        (mesh.material as THREE.MeshStandardMaterial).color.set("#22ff22");
        hitFlashRef.current[healTargetId] = Date.now();
    }

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
    targetZ: number
): boolean {
    const { unitsStateRef, unitsRef, unitMeshRef, hitFlashRef, setUnits, addLog } = ctx;

    // Find closest ally to target position
    const closest = findClosestTargetByTeam(unitsStateRef.current, unitsRef.current, "player", targetX, targetZ);

    if (!closest) {
        addLog(`${UNIT_DATA[casterId].name}: No ally at that location!`, COLORS.logNeutral);
        return false;
    }

    const { unit: targetAlly, group: targetG } = closest;
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
    if ((targetAlly.mana ?? 0) >= (targetData.maxMana ?? 0)) {
        addLog(`${UNIT_DATA[casterId].name}: ${targetData.name} is at full mana!`, COLORS.logNeutral);
        return false;
    }

    // Check if caster has enough HP for the self-damage (minimum: low end of damage range)
    const selfDamageMin = skill.selfDamage?.[0] ?? 20;
    if (caster.hp <= selfDamageMin) {
        addLog(`${UNIT_DATA[casterId].name}: Not enough life force!`, COLORS.logNeutral);
        return false;
    }

    consumeSkill(ctx, casterId, skill);

    const now = Date.now();
    const casterData = UNIT_DATA[casterId];

    // Give mana to ally
    const manaAmount = rollDamage(skill.manaRange![0], skill.manaRange![1]);
    const actualMana = Math.min(manaAmount, (targetData.maxMana ?? 0) - (targetAlly.mana ?? 0));
    const healTargetId = targetAlly.id;

    // Calculate self-damage (total damage over the duration)
    const totalSelfDamage = rollDamage(skill.selfDamage?.[0] ?? 20, skill.selfDamage?.[1] ?? 30);
    const damagePerTick = Math.ceil(totalSelfDamage / (QI_DRAIN_DURATION / QI_DRAIN_TICK_INTERVAL));

    // Apply mana to target and qi_drain effect to caster
    setUnits(prev => prev.map(u => {
        if (u.id === healTargetId) {
            return { ...u, mana: Math.min(targetData.maxMana ?? 0, (u.mana ?? 0) + actualMana) };
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

    addLog(`${casterData.name}'s ${skill.name} restores ${actualMana} mana to ${targetData.name}!`, COLORS.mana);
    soundFns.playHeal();

    // Visual effect - blue flash on target (mana color)
    const mesh = unitMeshRef.current[healTargetId];
    if (targetG && mesh) {
        (mesh.material as THREE.MeshStandardMaterial).color.set("#3498db");
        hitFlashRef.current[healTargetId] = now;
    }

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
    const { scene, unitsRef, setUnits, addLog } = ctx;

    const casterG = unitsRef.current[casterId];
    if (!casterG) return false;

    consumeSkill(ctx, casterId, skill);

    const casterData = UNIT_DATA[casterId];
    const duration = skill.duration!;  // Duration in ms
    const now = Date.now();

    // Apply the buff as a status effect
    const shieldedEffect: StatusEffect = {
        type: "shielded",
        duration,
        tickInterval: BUFF_TICK_INTERVAL,
        timeSinceTick: 0,
        lastUpdateTime: now,
        damagePerTick: 0,
        sourceId: casterId
    };
    setUnits(prev => prev.map(u =>
        u.id === casterId ? { ...u, statusEffects: applyStatusEffect(u.statusEffects, shieldedEffect) } : u
    ));

    // Play sound and log
    soundFns.playHeal();  // Reuse heal sound for buff activation
    addLog(logBuff(casterData.name, skill.name), "#f1c40f");

    // Visual effect - golden glow ring
    createAnimatedRing(scene, casterG.position.x, casterG.position.z, "#f1c40f", {
        innerRadius: 0.3, outerRadius: 0.5, maxScale: 1.5, duration: 300
    });

    return true;
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
    const { scene, unitsStateRef, unitsRef, setUnits, addLog } = ctx;

    const casterG = unitsRef.current[casterId];
    if (!casterG) return false;

    consumeSkill(ctx, casterId, skill);

    const casterData = UNIT_DATA[casterId];
    const duration = skill.duration!;  // Duration in ms
    const now = Date.now();

    // Find all player allies within range FIRST (outside setUnits)
    const allies = unitsStateRef.current.filter(u => u.team === "player" && u.hp > 0);
    const alliesInRange: number[] = [];

    allies.forEach(ally => {
        const allyG = unitsRef.current[ally.id];
        if (!allyG) return;

        // Check if ally is within range (using hitbox-aware range check)
        const allyRadius = getUnitRadius(ally);
        if (isInRange(casterG.position.x, casterG.position.z, allyG.position.x, allyG.position.z, allyRadius, skill.range)) {
            alliesInRange.push(ally.id);
        }
    });

    // Apply buff to all allies in range
    const defianceEffect: StatusEffect = {
        type: "defiance",
        duration,
        tickInterval: BUFF_TICK_INTERVAL,
        timeSinceTick: 0,
        lastUpdateTime: now,
        damagePerTick: 0,
        sourceId: casterId
    };
    setUnits(prev => prev.map(u =>
        alliesInRange.includes(u.id) ? { ...u, statusEffects: applyStatusEffect(u.statusEffects, defianceEffect) } : u
    ));

    // Play sound and log
    soundFns.playWarcry();  // Use warcry sound for battle cry
    addLog(`${casterData.name} rallies ${alliesInRange.length} allies with ${skill.name}!`, "#c0392b");

    // Visual effect - red battle cry ring expanding outward
    createAnimatedRing(scene, casterG.position.x, casterG.position.z, "#c0392b", {
        innerRadius: 0.5, outerRadius: skill.range, maxScale: 2, duration: 400
    });

    return true;
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
    const { scene, unitsRef, setUnits, addLog } = ctx;

    const casterG = unitsRef.current[casterId];
    if (!casterG) return false;

    consumeSkill(ctx, casterId, skill);

    const casterData = UNIT_DATA[casterId];
    const shieldAmount = skill.shieldAmount!;  // Max shield HP
    const duration = skill.duration!;          // Duration in ms
    const now = Date.now();

    // Apply the energy shield as a status effect
    const shieldEffect: StatusEffect = {
        type: "energyShield",
        duration,
        tickInterval: BUFF_TICK_INTERVAL,
        timeSinceTick: 0,
        lastUpdateTime: now,
        damagePerTick: 0,
        sourceId: casterId,
        shieldAmount
    };
    setUnits(prev => prev.map(u =>
        u.id === casterId ? { ...u, statusEffects: applyStatusEffect(u.statusEffects, shieldEffect) } : u
    ));

    // Play whoosh sound and log
    soundFns.playEnergyShield();
    addLog(`${casterData.name} conjures an Energy Shield!`, "#9b59b6");

    // Visual effect - expanding cyan ring
    createAnimatedRing(scene, casterG.position.x, casterG.position.z, "#66ccff", {
        innerRadius: 0.2, outerRadius: 0.6, maxScale: 1.8, duration: 350
    });

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
    targetZ: number
): boolean {
    const { scene, unitsStateRef, unitsRef, unitMeshRef, hitFlashRef, setUnits, addLog } = ctx;

    // Find closest ally to target position
    const closest = findClosestTargetByTeam(unitsStateRef.current, unitsRef.current, "player", targetX, targetZ);

    if (!closest) {
        addLog(`${UNIT_DATA[casterId].name}: No ally at that location!`, COLORS.logNeutral);
        return false;
    }

    const { unit: targetAlly, group: targetG } = closest;
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
    const duration = skill.duration!;  // Duration in ms (30 seconds)

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
    addLog(logCleanse(casterData.name, targetData.name), "#ecf0f1");

    // Visual effect - white/silver glow ring
    createAnimatedRing(scene, targetG.position.x, targetG.position.z, "#ecf0f1", {
        innerRadius: 0.3, outerRadius: 0.5, maxScale: 1.5, duration: 300
    });

    // Visual effect - white flash on target
    const mesh = unitMeshRef.current[targetId];
    if (targetG && mesh) {
        (mesh.material as THREE.MeshStandardMaterial).color.set("#ffffff");
        hitFlashRef.current[targetId] = now;
    }

    return true;
}

// =============================================================================
// RESTORATION SKILL
// =============================================================================

/**
 * Execute Restoration skill - removes doom, poison, and slow, then applies regen HoT.
 */
export function executeRestorationSkill(
    ctx: SkillExecutionContext,
    casterId: number,
    skill: Skill,
    targetX: number,
    targetZ: number
): boolean {
    const { scene, unitsStateRef, unitsRef, unitMeshRef, hitFlashRef, setUnits, addLog } = ctx;

    // Find closest ally to target position
    const closest = findClosestTargetByTeam(unitsStateRef.current, unitsRef.current, "player", targetX, targetZ);

    if (!closest) {
        addLog(`${UNIT_DATA[casterId].name}: No ally at that location!`, COLORS.logNeutral);
        return false;
    }

    const { unit: targetAlly, group: targetG } = closest;
    const targetData = UNIT_DATA[targetAlly.id];
    const targetId = targetAlly.id;

    // Check if target actually needs restoration (has doom, poison, slow, or is not at full HP)
    const hasDoom = hasStatusEffect(targetAlly, "doom");
    const hasPoison = hasStatusEffect(targetAlly, "poison");
    const hasSlow = hasStatusEffect(targetAlly, "slowed");
    const targetMaxHp = getEffectiveMaxHp(targetAlly.id, targetAlly);
    const needsHealing = targetAlly.hp < targetMaxHp;

    if (!hasDoom && !hasPoison && !hasSlow && !needsHealing) {
        addLog(`${UNIT_DATA[casterId].name}: ${targetData.name} doesn't need restoration!`, COLORS.logNeutral);
        return false;
    }

    consumeSkill(ctx, casterId, skill);

    const casterData = UNIT_DATA[casterId];
    const now = Date.now();
    const duration = skill.duration!;
    const healPerTick = skill.healPerTick!;

    // Remove doom, poison, slow and apply regen
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
        // Remove doom, poison, slow
        const cleansedEffects = (u.statusEffects ?? []).filter(
            e => e.type !== "doom" && e.type !== "poison" && e.type !== "slowed"
        );
        return { ...u, statusEffects: applyStatusEffect(cleansedEffects, regenEffect) };
    }));

    // Log what was removed
    const removedEffects: string[] = [];
    if (hasDoom) removedEffects.push("Doom");
    if (hasPoison) removedEffects.push("Poison");
    if (hasSlow) removedEffects.push("Slow");

    soundFns.playHeal();
    if (removedEffects.length > 0) {
        addLog(`${casterData.name}'s ${skill.name} purges ${removedEffects.join(", ")} from ${targetData.name}!`, "#ecf0f1");
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
        hitFlashRef.current[targetId] = now;
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
    targetZ: number
): boolean {
    const { scene, unitsStateRef, unitsRef, unitMeshRef, hitFlashRef, setUnits, addLog } = ctx;

    // Find closest DEAD ally to target position
    const deadAllies = unitsStateRef.current.filter(u => u.team === "player" && u.hp <= 0);
    if (deadAllies.length === 0) {
        addLog(`${UNIT_DATA[casterId].name}: No fallen allies!`, COLORS.logNeutral);
        return false;
    }

    // Find the dead ally closest to the click position
    let closestDead: { unit: typeof deadAllies[0]; dist: number } | null = null;
    for (const dead of deadAllies) {
        const dg = unitsRef.current[dead.id];
        if (!dg) continue;
        const dx = dg.position.x - targetX;
        const dz = dg.position.z - targetZ;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (!closestDead || dist < closestDead.dist) {
            closestDead = { unit: dead, dist };
        }
    }

    if (!closestDead) {
        addLog(`${UNIT_DATA[casterId].name}: No fallen ally at that location!`, COLORS.logNeutral);
        return false;
    }

    consumeSkill(ctx, casterId, skill);

    const casterData = UNIT_DATA[casterId];
    const targetData = UNIT_DATA[closestDead.unit.id];
    const reviveId = closestDead.unit.id;
    const casterG = unitsRef.current[casterId];
    const now = Date.now();

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
    addLog(`${casterData.name}'s ${skill.name} revives ${targetData.name}!`, "#ffd700");

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
        hitFlashRef.current[reviveId] = now;
    }

    return true;
}
