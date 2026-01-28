// =============================================================================
// SKILL EXECUTION & TARGETING
// =============================================================================

import * as THREE from "three";
import type { Unit, Skill, UnitGroup, Projectile, StatusEffect, MagicMissileProjectile, TrapProjectile, SanctuaryTile, AcidTile } from "../core/types";
import { COLORS, BUFF_TICK_INTERVAL, TRAP_FLIGHT_DURATION, TRAP_ARC_HEIGHT, TRAP_MESH_SIZE, SANCTUARY_HEAL_PER_TICK, QI_DRAIN_DURATION, QI_DRAIN_TICK_INTERVAL } from "../core/constants";
import { UNIT_DATA, getUnitStats, getEffectiveUnitData, getEffectiveMaxHp } from "../game/units";
import { getFaithHealingBonus, getStrengthDamageBonus, getIntelligenceMagicDamageBonus, getFaithHolyDamageBonus } from "../game/statBonuses";
import { rollDamage, rollChance, calculateDamage, rollHit, getEffectiveArmor, hasStatusEffect, logHit, logMiss, logHeal, logPoisoned, logCast, logTaunt, logTauntMiss, logBuff, logStunned, logCleanse, logTrapThrown, isBlockedByFrontShield } from "./combatMath";
import { ENEMY_STATS } from "../game/units";
import { tryHealBark, trySpellBark } from "./barks";
import { getUnitRadius, isInRange } from "../rendering/range";
import { distanceToPoint } from "../game/geometry";
import { soundFns } from "../audio/sound";
import { createProjectile, getProjectileSpeed, applyDamageToUnit, createAnimatedRing, createLightningPillar, type DamageContext } from "./combat";
import { createSanctuaryTile } from "../gameLoop/sanctuaryTiles";
import { updateUnitWith } from "../core/stateUtils";

export interface SkillExecutionContext {
    scene: THREE.Scene;
    unitsStateRef: React.RefObject<Unit[]>;
    unitsRef: React.RefObject<Record<number, UnitGroup>>;
    actionCooldownRef: React.MutableRefObject<Record<number, number>>;
    projectilesRef: React.MutableRefObject<Projectile[]>;
    hitFlashRef: React.MutableRefObject<Record<number, number>>;
    damageTexts: React.MutableRefObject<{ mesh: THREE.Mesh; life: number }[]>;
    unitMeshRef: React.RefObject<Record<number, THREE.Mesh>>;
    unitOriginalColorRef: React.RefObject<Record<number, THREE.Color>>;
    setUnits: React.Dispatch<React.SetStateAction<Unit[]>>;
    setSkillCooldowns: React.Dispatch<React.SetStateAction<Record<string, { end: number; duration: number }>>>;
    addLog: (text: string, color?: string) => void;
    defeatedThisFrame: Set<number>;  // Shared set to track units defeated this frame
    // Optional tile refs for skills that interact with ground tiles
    sanctuaryTilesRef?: React.MutableRefObject<Map<string, SanctuaryTile>>;
    acidTilesRef?: React.MutableRefObject<Map<string, AcidTile>>;
}

// =============================================================================
// HELPERS - Reusable functions to avoid duplication
// =============================================================================

/** Get all alive units of a specific team */
function getAliveUnits(units: Unit[], team: "player" | "enemy"): Unit[] {
    return units.filter(u => u.team === team && u.hp > 0);
}

/** Find the closest unit to a target position (within maxDist) */
function findClosestUnit(
    units: Unit[],
    unitsRef: Record<number, UnitGroup>,
    targetX: number,
    targetZ: number,
    maxDist: number = 2
): { unit: Unit; group: UnitGroup } | null {
    let closest: { unit: Unit; group: UnitGroup } | null = null;
    let closestDist = maxDist;

    for (const unit of units) {
        const g = unitsRef[unit.id];
        if (!g) continue;
        const d = distanceToPoint(g.position, targetX, targetZ);
        if (d < closestDist) {
            closestDist = d;
            closest = { unit, group: g };
        }
    }
    return closest;
}

/** Find closest unit of a specific team to target position - combines getAliveUnits + findClosestUnit */
function findClosestTargetByTeam(
    units: Unit[],
    unitsRef: Record<number, UnitGroup>,
    team: "player" | "enemy",
    targetX: number,
    targetZ: number,
    maxDist: number = 2
): { unit: Unit; group: UnitGroup } | null {
    const aliveUnits = getAliveUnits(units, team);
    return findClosestUnit(aliveUnits, unitsRef, targetX, targetZ, maxDist);
}

/**
 * Consume skill resources: set cooldown for the used skill and deduct mana.
 * Call this at the START of every skill execution (after validation, before effects).
 * If the caster has shielded effect, cooldowns are doubled.
 *
 * Note: actionCooldownRef tracks when the UNIT can act again (blocks all actions).
 * skillCooldowns tracks per-skill UI animation (only the used skill shows cooldown bar).
 */
function consumeSkill(ctx: SkillExecutionContext, casterId: number, skill: Skill): void {
    const { unitsStateRef, actionCooldownRef, setSkillCooldowns, setUnits, addLog } = ctx;
    const now = Date.now();

    // Check if caster is shielded - doubles cooldowns
    const caster = unitsStateRef.current.find(u => u.id === casterId);
    const cooldownMultiplier = caster && hasStatusEffect(caster, "shielded") ? 2 : 1;

    const effectiveCooldown = skill.cooldown * cooldownMultiplier;
    const cooldownEnd = now + effectiveCooldown;

    // Set internal cooldown ref (unit-level lock)
    actionCooldownRef.current[casterId] = cooldownEnd;

    // Set UI cooldown ONLY for the skill that was used
    setSkillCooldowns(prev => ({
        ...prev,
        [`${casterId}-${skill.name}`]: { end: cooldownEnd, duration: effectiveCooldown }
    }));

    // Deduct mana (clamped to 0 minimum)
    updateUnitWith(setUnits, casterId, u => ({ mana: Math.max(0, (u.mana ?? 0) - skill.manaCost) }));

    // Bark on mana-costing spell (damage spells only)
    if (skill.manaCost > 0 && skill.type === "damage") {
        trySpellBark(UNIT_DATA[casterId].name, addLog);
    }
}

/**
 * Execute an AOE damage skill (like Fireball)
 */
export function executeAoeSkill(
    ctx: SkillExecutionContext,
    casterId: number,
    skill: Skill,
    targetX: number,
    targetZ: number
): void {
    const { scene, unitsRef, projectilesRef, addLog } = ctx;
    const casterG = unitsRef.current[casterId];
    if (!casterG) return;

    consumeSkill(ctx, casterId, skill);

    // Create projectile toward target location
    const projectile = createProjectile(scene, "aoe", casterG.position.x, casterG.position.z, skill.projectileColor);

    projectilesRef.current.push({
        type: "aoe",
        mesh: projectile,
        attackerId: casterId,
        speed: getProjectileSpeed("aoe"),
        aoeRadius: skill.aoeRadius!,
        damage: skill.value,
        damageType: skill.damageType,
        targetPos: { x: targetX, z: targetZ }
    });

    addLog(logCast(UNIT_DATA[casterId].name, skill.name), COLORS.damageNeutral);
    soundFns.playFireball();
}

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
    const healAmount = rollDamage(skill.value[0], skill.value[1]) + faithBonus;
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
    const manaAmount = rollDamage(skill.value[0], skill.value[1]);
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

/**
 * Execute a melee single-target enemy skill (like Poison Dagger)
 */
export function executeMeleeSkill(
    ctx: SkillExecutionContext,
    casterId: number,
    skill: Skill,
    targetX: number,
    targetZ: number
): boolean {
    const { scene, unitsStateRef, unitsRef, hitFlashRef, damageTexts, setUnits, addLog, defeatedThisFrame } = ctx;

    // Find closest enemy to target position
    const closest = findClosestTargetByTeam(unitsStateRef.current, unitsRef.current, "enemy", targetX, targetZ);

    if (!closest) {
        addLog(`${UNIT_DATA[casterId].name}: No enemy at that location!`, COLORS.logNeutral);
        return false;
    }

    const { unit: targetEnemy, group: targetG } = closest;
    const casterG = unitsRef.current[casterId];

    if (!casterG) return false;

    // Check if in melee range (hitbox-aware)
    const targetRadius = getUnitRadius(targetEnemy);
    if (!isInRange(casterG.position.x, casterG.position.z, targetG.position.x, targetG.position.z, targetRadius, skill.range + 0.5)) {
        addLog(`${UNIT_DATA[casterId].name}: Target out of range!`, COLORS.logNeutral);
        return false;
    }

    const now = Date.now();
    consumeSkill(ctx, casterId, skill);

    const casterData = UNIT_DATA[casterId];
    const targetData = getUnitStats(targetEnemy);
    const targetId = targetEnemy.id;

    // Check for front-shield block (undead knight etc.)
    if (targetEnemy.enemyType) {
        const enemyStats = ENEMY_STATS[targetEnemy.enemyType];
        if (enemyStats.frontShield && targetEnemy.facing !== undefined) {
            if (isBlockedByFrontShield(casterG.position.x, casterG.position.z, targetG.position.x, targetG.position.z, targetEnemy.facing)) {
                soundFns.playMiss();
                addLog(`${casterData.name}'s ${skill.name} is blocked by ${targetData.name}'s shield!`, "#4488ff");
                return true;
            }
        }
    }

    // Roll to hit
    if (rollHit(casterData.accuracy)) {
        // Apply stat bonuses based on damage type
        const casterUnit = unitsStateRef.current.find(u => u.id === casterId);
        let statBonus = 0;
        if (casterUnit) {
            if (skill.damageType === "physical") {
                statBonus = getStrengthDamageBonus(casterUnit);
            } else if (skill.damageType === "fire" || skill.damageType === "cold" || skill.damageType === "lightning" || skill.damageType === "chaos") {
                statBonus = getIntelligenceMagicDamageBonus(casterUnit);
            } else if (skill.damageType === "holy") {
                statBonus = getFaithHolyDamageBonus(casterUnit);
            }
        }
        const dmg = calculateDamage(skill.value[0] + statBonus, skill.value[1] + statBonus, getEffectiveArmor(targetEnemy, targetData.armor), skill.damageType);
        const willPoison = skill.poisonChance ? rollChance(skill.poisonChance) : false;

        // Read fresh HP from current state to avoid stale data race condition
        const freshTarget = unitsStateRef.current.find(u => u.id === targetId);
        const currentHp = freshTarget?.hp ?? targetEnemy.hp;

        // Skip if target was already defeated this frame
        if (currentHp <= 0 || defeatedThisFrame.has(targetId)) {
            return true; // Skill consumed but target already dead
        }

        // Use shared defeatedThisFrame from context
        const dmgCtx: DamageContext = {
            scene, damageTexts: damageTexts.current, hitFlashRef: hitFlashRef.current,
            unitsRef: unitsRef.current, setUnits, addLog, now, defeatedThisFrame
        };
        applyDamageToUnit(dmgCtx, targetId, targetG, currentHp, dmg, targetData.name, {
            color: COLORS.damagePlayer,
            poison: willPoison ? { sourceId: casterId } : undefined,
            attackerName: casterData.name,
            hitMessage: { text: logHit(casterData.name, skill.name, targetData.name, dmg), color: COLORS.damagePlayer },
            targetUnit: targetEnemy,
            attackerPosition: { x: casterG.position.x, z: casterG.position.z }
        });

        soundFns.playHit();

        if (willPoison) {
            addLog(logPoisoned(targetData.name), COLORS.poisonText);
        }
    } else {
        soundFns.playMiss();
        addLog(logMiss(casterData.name, skill.name, targetData.name), COLORS.logNeutral);
    }

    return true;
}

/**
 * Execute a smite skill (like Thunder) - instant-hit ranged damage with visual effect
 * @param targetUnitId Optional target unit ID - if provided, tracks enemy by ID even if they move
 */
export function executeSmiteSkill(
    ctx: SkillExecutionContext,
    casterId: number,
    skill: Skill,
    targetX: number,
    targetZ: number,
    targetUnitId?: number
): boolean {
    const { scene, unitsStateRef, unitsRef, hitFlashRef, damageTexts, setUnits, addLog, defeatedThisFrame } = ctx;

    let targetEnemy: Unit | undefined;
    let targetG: UnitGroup | undefined;

    // If we have a specific target ID, find that enemy (tracks moving targets)
    if (targetUnitId !== undefined) {
        targetEnemy = unitsStateRef.current.find(u => u.id === targetUnitId && u.team === "enemy");
        targetG = unitsRef.current[targetUnitId];
    }

    // Fall back to position-based search if no target ID or target not found
    if (!targetEnemy || !targetG) {
        const closest = findClosestTargetByTeam(unitsStateRef.current, unitsRef.current, "enemy", targetX, targetZ);
        if (!closest) {
            addLog(`${UNIT_DATA[casterId].name}: No enemy at that location!`, COLORS.logNeutral);
            return false;
        }
        targetEnemy = closest.unit;
        targetG = closest.group;
    }

    const casterG = unitsRef.current[casterId];

    if (!casterG) return false;

    // Check if in range (hitbox-aware)
    const targetRadius = getUnitRadius(targetEnemy);
    if (!isInRange(casterG.position.x, casterG.position.z, targetG.position.x, targetG.position.z, targetRadius, skill.range + 0.5)) {
        addLog(`${UNIT_DATA[casterId].name}: Target out of range!`, COLORS.logNeutral);
        return false;
    }

    const now = Date.now();
    consumeSkill(ctx, casterId, skill);

    const casterData = UNIT_DATA[casterId];
    const targetData = getUnitStats(targetEnemy);
    const targetId = targetEnemy.id;

    // Create lightning pillar visual at target location
    createLightningPillar(scene, targetG.position.x, targetG.position.z);
    soundFns.playHit();

    // Check for front-shield block (undead knight etc.)
    if (targetEnemy.enemyType) {
        const enemyStats = ENEMY_STATS[targetEnemy.enemyType];
        if (enemyStats.frontShield && targetEnemy.facing !== undefined) {
            if (isBlockedByFrontShield(casterG.position.x, casterG.position.z, targetG.position.x, targetG.position.z, targetEnemy.facing)) {
                soundFns.playMiss();
                addLog(`${casterData.name}'s ${skill.name} is blocked by ${targetData.name}'s shield!`, "#4488ff");
                return true;
            }
        }
    }

    // Roll to hit
    if (rollHit(casterData.accuracy)) {
        // Apply stat bonuses based on damage type
        const casterUnit = unitsStateRef.current.find(u => u.id === casterId);
        let statBonus = 0;
        if (casterUnit) {
            if (skill.damageType === "lightning") {
                statBonus = getIntelligenceMagicDamageBonus(casterUnit);
            } else if (skill.damageType === "holy") {
                statBonus = getFaithHolyDamageBonus(casterUnit);
            }
        }
        const dmg = calculateDamage(skill.value[0] + statBonus, skill.value[1] + statBonus, getEffectiveArmor(targetEnemy, targetData.armor), skill.damageType);

        // Read fresh HP from current state
        const freshTarget = unitsStateRef.current.find(u => u.id === targetId);
        const currentHp = freshTarget?.hp ?? targetEnemy.hp;

        // Skip if target was already defeated this frame
        if (currentHp <= 0 || defeatedThisFrame.has(targetId)) {
            return true;
        }

        const dmgCtx: DamageContext = {
            scene, damageTexts: damageTexts.current, hitFlashRef: hitFlashRef.current,
            unitsRef: unitsRef.current, setUnits, addLog, now, defeatedThisFrame
        };
        applyDamageToUnit(dmgCtx, targetId, targetG, currentHp, dmg, targetData.name, {
            color: COLORS.damagePlayer,
            attackerName: casterData.name,
            hitMessage: { text: logHit(casterData.name, skill.name, targetData.name, dmg), color: COLORS.damagePlayer },
            targetUnit: targetEnemy,
            attackerPosition: { x: casterG.position.x, z: casterG.position.z }
        });
    } else {
        soundFns.playMiss();
        addLog(logMiss(casterData.name, skill.name, targetData.name), COLORS.logNeutral);
    }

    return true;
}

/**
 * Execute a taunt skill (like Warcry) - forces nearby enemies to target caster
 */
export function executeTauntSkill(
    ctx: SkillExecutionContext,
    casterId: number,
    skill: Skill
): boolean {
    const { scene, unitsStateRef, unitsRef, addLog } = ctx;

    const casterG = unitsRef.current[casterId];
    if (!casterG) return false;

    consumeSkill(ctx, casterId, skill);

    const casterData = UNIT_DATA[casterId];
    const tauntChance = skill.value[0];  // Use first value as taunt chance percentage

    // Find all enemies within range
    const enemies = getAliveUnits(unitsStateRef.current, "enemy");
    let tauntedCount = 0;

    enemies.forEach(enemy => {
        const enemyG = unitsRef.current[enemy.id];
        if (!enemyG) return;

        // Use hitbox-aware range
        const enemyRadius = getUnitRadius(enemy);
        if (isInRange(casterG.position.x, casterG.position.z, enemyG.position.x, enemyG.position.z, enemyRadius, skill.range)) {
            // Roll to taunt
            if (rollChance(tauntChance)) {
                // Force this enemy to target the caster
                enemyG.userData.attackTarget = casterId;
                tauntedCount++;
            }
        }
    });

    // Play sound and log result
    soundFns.playWarcry();

    // Visual effect - expanding ring
    createAnimatedRing(scene, casterG.position.x, casterG.position.z, "#c0392b", {
        innerRadius: 0.5, outerRadius: 0.7, maxScale: skill.range
    });

    if (tauntedCount > 0) {
        addLog(logTaunt(casterData.name, skill.name, tauntedCount), "#c0392b");
    } else {
        addLog(logTauntMiss(casterData.name, skill.name), COLORS.logNeutral);
    }

    return true;
}

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
    const duration = skill.value[0];  // Duration in ms
    const now = Date.now();

    // Apply the buff as a status effect
    setUnits(prev => prev.map(u => {
        if (u.id !== casterId) return u;

        const existingEffects = u.statusEffects || [];
        // Remove existing shielded effect if any (refresh)
        const filteredEffects = existingEffects.filter(e => e.type !== "shielded");

        const shieldedEffect: StatusEffect = {
            type: "shielded",
            duration,
            tickInterval: BUFF_TICK_INTERVAL,
            timeSinceTick: 0,
            lastUpdateTime: now,
            damagePerTick: 0,
            sourceId: casterId
        };

        return {
            ...u,
            statusEffects: [...filteredEffects, shieldedEffect]
        };
    }));

    // Play sound and log
    soundFns.playHeal();  // Reuse heal sound for buff activation
    addLog(logBuff(casterData.name, skill.name), "#f1c40f");

    // Visual effect - golden glow ring
    createAnimatedRing(scene, casterG.position.x, casterG.position.z, "#f1c40f", {
        innerRadius: 0.3, outerRadius: 0.5, maxScale: 1.5, duration: 300
    });

    return true;
}

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
    const duration = skill.value[0];  // Duration in ms (30 seconds)

    // Apply cleanse: remove poison and add cleansed (immunity) effect
    setUnits(prev => prev.map(u => {
        if (u.id !== targetId) return u;

        const existingEffects = u.statusEffects || [];
        // Remove poison effect
        const withoutPoison = existingEffects.filter(e => e.type !== "poison");
        // Remove existing cleansed effect if any (refresh)
        const filteredEffects = withoutPoison.filter(e => e.type !== "cleansed");

        const cleansedEffect: StatusEffect = {
            type: "cleansed",
            duration,
            tickInterval: BUFF_TICK_INTERVAL,
            timeSinceTick: 0,
            lastUpdateTime: now,
            damagePerTick: 0,
            sourceId: casterId
        };

        return {
            ...u,
            statusEffects: [...filteredEffects, cleansedEffect]
        };
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

/**
 * Execute a flurry skill (multiple rapid hits on nearby enemies)
 */
export function executeFlurrySkill(
    ctx: SkillExecutionContext,
    casterId: number,
    skill: Skill
): boolean {
    const { scene, unitsStateRef, unitsRef, setUnits, addLog, hitFlashRef, damageTexts, defeatedThisFrame } = ctx;

    const casterG = unitsRef.current[casterId];
    if (!casterG) return false;

    consumeSkill(ctx, casterId, skill);

    const casterData = UNIT_DATA[casterId];
    const hitCount = skill.hitCount ?? 5;
    const now = Date.now();

    // Find all enemies within range
    const enemies = getAliveUnits(unitsStateRef.current, "enemy");
    const enemiesInRange: { unit: Unit; group: UnitGroup }[] = [];

    enemies.forEach(enemy => {
        const enemyG = unitsRef.current[enemy.id];
        if (!enemyG) return;

        const enemyRadius = getUnitRadius(enemy);
        if (isInRange(casterG.position.x, casterG.position.z, enemyG.position.x, enemyG.position.z, enemyRadius, skill.range)) {
            enemiesInRange.push({ unit: enemy, group: enemyG });
        }
    });

    if (enemiesInRange.length === 0) {
        addLog(`${casterData.name}: No enemies in range!`, COLORS.logNeutral);
        return true; // Still consumed mana/cooldown
    }

    // Distribute hits across enemies (round-robin)
    // Track HP locally since state updates are batched
    const hpTracker: Record<number, number> = {};
    enemiesInRange.forEach(({ unit }) => { hpTracker[unit.id] = unit.hp; });

    // Use shared defeatedThisFrame from context to prevent hitting dead enemies
    const dmgCtx: DamageContext = {
        scene, damageTexts: damageTexts.current, hitFlashRef: hitFlashRef.current,
        unitsRef: unitsRef.current, setUnits, addLog, now, defeatedThisFrame
    };

    let totalHits = 0;
    let totalDamage = 0;

    // Calculate stat bonus for damage
    const casterUnit = unitsStateRef.current.find(u => u.id === casterId);
    let statBonus = 0;
    if (casterUnit) {
        if (skill.damageType === "physical") {
            statBonus = getStrengthDamageBonus(casterUnit);
        } else if (skill.damageType === "fire" || skill.damageType === "cold" || skill.damageType === "lightning" || skill.damageType === "chaos") {
            statBonus = getIntelligenceMagicDamageBonus(casterUnit);
        } else if (skill.damageType === "holy") {
            statBonus = getFaithHolyDamageBonus(casterUnit);
        }
    }

    for (let i = 0; i < hitCount; i++) {
        const targetIdx = i % enemiesInRange.length;
        const { unit: target, group: targetG } = enemiesInRange[targetIdx];

        // Skip if already defeated this frame or HP already at 0 in tracker
        if (defeatedThisFrame.has(target.id)) continue;
        if (hpTracker[target.id] <= 0) continue;

        const targetData = getUnitStats(target);

        // Check for front-shield block
        if (target.enemyType) {
            const enemyStats = ENEMY_STATS[target.enemyType];
            if (enemyStats.frontShield && target.facing !== undefined) {
                if (isBlockedByFrontShield(casterG.position.x, casterG.position.z, targetG.position.x, targetG.position.z, target.facing)) {
                    continue;  // Skip this hit - blocked by shield
                }
            }
        }

        if (rollHit(casterData.accuracy)) {
            const dmg = calculateDamage(skill.value[0] + statBonus, skill.value[1] + statBonus, getEffectiveArmor(target, targetData.armor), skill.damageType);

            // Use tracked HP, not stale snapshot
            const currentHp = hpTracker[target.id];
            applyDamageToUnit(dmgCtx, target.id, targetG, currentHp, dmg, targetData.name, {
                color: COLORS.damagePlayer,
                attackerName: casterData.name,
                targetUnit: target,
                attackerPosition: { x: casterG.position.x, z: casterG.position.z }
            });

            // Update local HP tracker
            hpTracker[target.id] = Math.max(0, currentHp - dmg);

            totalHits++;
            totalDamage += dmg;
        }
    }

    soundFns.playAttack();

    // Visual effect - rapid green pulses
    createAnimatedRing(scene, casterG.position.x, casterG.position.z, "#27ae60", {
        innerRadius: 0.3, outerRadius: 0.5, maxScale: skill.range, duration: 200
    });

    if (totalHits > 0) {
        addLog(`${casterData.name}'s ${skill.name} lands ${totalHits} hits for ${totalDamage} total damage!`, COLORS.damagePlayer);
    } else {
        addLog(`${casterData.name}'s ${skill.name} misses all targets!`, COLORS.logNeutral);
    }

    return true;
}

/**
 * Execute a ranged single-target damage skill (basic attack for ranged units)
 */
export function executeRangedSkill(
    ctx: SkillExecutionContext,
    casterId: number,
    skill: Skill,
    targetX: number,
    targetZ: number
): boolean {
    const { scene, unitsStateRef, unitsRef, projectilesRef, addLog } = ctx;

    // Find closest enemy to target position
    const closest = findClosestTargetByTeam(unitsStateRef.current, unitsRef.current, "enemy", targetX, targetZ);

    if (!closest) {
        addLog(`${UNIT_DATA[casterId].name}: No enemy at that location!`, COLORS.logNeutral);
        return false;
    }

    const { unit: targetEnemy, group: targetG } = closest;
    const casterG = unitsRef.current[casterId];

    if (!casterG) return false;

    // Check if in range (hitbox-aware)
    const targetRadius = getUnitRadius(targetEnemy);
    if (!isInRange(casterG.position.x, casterG.position.z, targetG.position.x, targetG.position.z, targetRadius, skill.range + 0.5)) {
        addLog(`${UNIT_DATA[casterId].name}: Target out of range!`, COLORS.logNeutral);
        return false;
    }

    consumeSkill(ctx, casterId, skill);

    // Use effective data to get equipment-derived projectile color
    const effectiveData = getEffectiveUnitData(casterId);

    // Create projectile toward target
    const projectile = createProjectile(scene, "ranged", casterG.position.x, casterG.position.z, effectiveData.projectileColor);

    projectilesRef.current.push({
        type: "basic",
        mesh: projectile,
        attackerId: casterId,
        targetId: targetEnemy.id,
        speed: getProjectileSpeed("ranged")
    });

    soundFns.playAttack();

    return true;
}

/**
 * Execute a debuff skill (like Stunning Blow) - applies a debuff to an enemy
 */
export function executeDebuffSkill(
    ctx: SkillExecutionContext,
    casterId: number,
    skill: Skill,
    targetX: number,
    targetZ: number
): boolean {
    const { unitsStateRef, unitsRef, hitFlashRef, setUnits, addLog } = ctx;

    // Find closest enemy to target position
    const closest = findClosestTargetByTeam(unitsStateRef.current, unitsRef.current, "enemy", targetX, targetZ);

    if (!closest) {
        addLog(`${UNIT_DATA[casterId].name}: No enemy at that location!`, COLORS.logNeutral);
        return false;
    }

    const { unit: targetEnemy, group: targetG } = closest;
    const casterG = unitsRef.current[casterId];

    if (!casterG) return false;

    // Check if in melee range (hitbox-aware)
    const targetRadius = getUnitRadius(targetEnemy);
    if (!isInRange(casterG.position.x, casterG.position.z, targetG.position.x, targetG.position.z, targetRadius, skill.range + 0.5)) {
        addLog(`${UNIT_DATA[casterId].name}: Target out of range!`, COLORS.logNeutral);
        return false;
    }

    // Check if target is already stunned
    if (hasStatusEffect(targetEnemy, "stunned")) {
        addLog(`${UNIT_DATA[casterId].name}: Target is already stunned!`, COLORS.logNeutral);
        return false;
    }

    const now = Date.now();
    consumeSkill(ctx, casterId, skill);

    const casterData = UNIT_DATA[casterId];
    const targetData = getUnitStats(targetEnemy);
    const targetId = targetEnemy.id;

    // Check for front-shield block
    if (targetEnemy.enemyType) {
        const enemyStats = ENEMY_STATS[targetEnemy.enemyType];
        if (enemyStats.frontShield && targetEnemy.facing !== undefined) {
            if (isBlockedByFrontShield(casterG.position.x, casterG.position.z, targetG.position.x, targetG.position.z, targetEnemy.facing)) {
                soundFns.playMiss();
                addLog(`${casterData.name}'s ${skill.name} is blocked by ${targetData.name}'s shield!`, "#4488ff");
                return true;
            }
        }
    }

    // Roll to hit
    if (rollHit(casterData.accuracy)) {
        // Roll for stun chance
        const stunChance = skill.stunChance ?? 75;
        if (rollChance(stunChance)) {
            const stunDuration = skill.value[0];  // Duration in ms

            // Apply stunned effect
            setUnits(prev => prev.map(u => {
                if (u.id !== targetId) return u;

                const existingEffects = u.statusEffects || [];
                // Remove existing stunned effect if any (refresh)
                const filteredEffects = existingEffects.filter(e => e.type !== "stunned");

                const stunnedEffect: StatusEffect = {
                    type: "stunned",
                    duration: stunDuration,
                    tickInterval: BUFF_TICK_INTERVAL,
                    timeSinceTick: 0,
                    lastUpdateTime: now,
                    damagePerTick: 0,
                    sourceId: casterId
                };

                return {
                    ...u,
                    statusEffects: [...filteredEffects, stunnedEffect]
                };
            }));

            soundFns.playHit();
            addLog(`${casterData.name}'s ${skill.name} hits ${targetData.name}!`, COLORS.damagePlayer);
            addLog(logStunned(targetData.name), "#9b59b6");

            // Visual effect - purple flash
            const mesh = ctx.unitMeshRef.current[targetId];
            if (targetG && mesh) {
                (mesh.material as THREE.MeshStandardMaterial).color.set("#9b59b6");
                hitFlashRef.current[targetId] = now;
            }
        } else {
            soundFns.playHit();
            addLog(`${casterData.name}'s ${skill.name} hits ${targetData.name}, but they resist the stun!`, COLORS.logNeutral);
        }
    } else {
        soundFns.playMiss();
        addLog(logMiss(casterData.name, skill.name, targetData.name), COLORS.logNeutral);
    }

    return true;
}

/**
 * Execute Magic Wave skill - fires 8 zig-zagging projectiles that fan out towards a target area
 * Can be targeted arbitrarily like fireball - missiles seek enemies near the target position
 */
export function executeMagicWaveSkill(
    ctx: SkillExecutionContext,
    casterId: number,
    skill: Skill,
    targetX: number,
    targetZ: number
): boolean {
    const { scene, unitsStateRef, unitsRef, projectilesRef, addLog } = ctx;

    const casterG = unitsRef.current[casterId];
    if (!casterG) return false;

    consumeSkill(ctx, casterId, skill);

    const casterData = UNIT_DATA[casterId];
    const missileCount = skill.hitCount ?? 8;
    const aoeRadius = skill.aoeRadius ?? 3;

    // Find enemies near the target position (within aoe radius)
    const enemies = getAliveUnits(unitsStateRef.current, "enemy");
    const enemiesNearTarget: { unit: Unit; group: UnitGroup; dist: number }[] = [];

    enemies.forEach(enemy => {
        const enemyG = unitsRef.current[enemy.id];
        if (!enemyG) return;

        // Distance from target click position
        const distToTarget = distanceToPoint(enemyG.position, targetX, targetZ);
        if (distToTarget <= aoeRadius + 1) {  // Slight buffer for targeting
            enemiesNearTarget.push({ unit: enemy, group: enemyG, dist: distToTarget });
        }
    });

    // Sort by distance to target click
    enemiesNearTarget.sort((a, b) => a.dist - b.dist);

    // Calculate base direction towards target click for fan-out
    const baseAngle = Math.atan2(targetZ - casterG.position.z, targetX - casterG.position.x);
    const fanSpread = Math.PI * 0.5;  // 90 degree total spread

    // Generate unique volley ID for tracking hits across all missiles in this cast
    const volleyId = Date.now() + Math.random();

    // Create missiles
    for (let i = 0; i < missileCount; i++) {
        // Calculate fan-out angle for this missile (handle single missile case to avoid divide-by-zero)
        const normalizedPos = missileCount > 1 ? i / (missileCount - 1) : 0.5;
        const fanOffset = (normalizedPos - 0.5) * fanSpread;
        const startAngle = baseAngle + fanOffset;

        // Create magic missile projectile mesh
        const missile = new THREE.Mesh(
            new THREE.SphereGeometry(0.10, 8, 8),
            new THREE.MeshBasicMaterial({ color: skill.projectileColor ?? "#9966ff" })
        );
        // Start position offset slightly in the fan direction
        const startOffset = 0.3;
        missile.position.set(
            casterG.position.x + Math.cos(startAngle) * startOffset,
            0.6,
            casterG.position.z + Math.sin(startAngle) * startOffset
        );
        scene.add(missile);

        // Assign target: distribute among enemies if any, otherwise all go to click position
        let targetId: number;
        if (enemiesNearTarget.length > 0) {
            const targetIdx = i % enemiesNearTarget.length;
            targetId = enemiesNearTarget[targetIdx].unit.id;
        } else {
            // No enemies - missiles will fly towards target position and fizzle
            // Use -1 as a sentinel for "no target, go to position"
            targetId = -1;
        }

        // Create magic missile projectile with zig-zag and fan-out properties
        const magicMissile: MagicMissileProjectile = {
            type: "magic_missile",
            mesh: missile,
            attackerId: casterId,
            targetId: targetId,
            speed: 0.07,
            damage: skill.value,
            damageType: skill.damageType ?? "chaos",
            zigzagOffset: 0,
            zigzagDirection: i % 2 === 0 ? 1 : -1,
            zigzagPhase: i * 0.25 + Math.random() * 0.2,
            // Fan-out: store normalized angle offset (-0.5 to 0.5) for lateral drift
            fanAngle: normalizedPos - 0.5,
            startX: missile.position.x,
            startZ: missile.position.z,
            // Volley tracking for aggregated damage logging
            volleyId,
            missileIndex: i,
            totalMissiles: missileCount
        };

        // Store target position for missiles without enemy target
        if (targetId === -1) {
            (magicMissile as MagicMissileProjectile & { targetPos?: { x: number; z: number } }).targetPos = { x: targetX, z: targetZ };
        }

        projectilesRef.current.push(magicMissile);
    }

    addLog(logCast(casterData.name, skill.name), "#9966ff");
    soundFns.playMagicWave();

    return true;
}

/**
 * Execute a trap skill (like Caltrops) - throws a trap that lands and waits for enemies
 */
export function executeTrapSkill(
    ctx: SkillExecutionContext,
    casterId: number,
    skill: Skill,
    targetX: number,
    targetZ: number
): boolean {
    const { scene, unitsRef, projectilesRef, addLog } = ctx;

    const casterG = unitsRef.current[casterId];
    if (!casterG) return false;

    consumeSkill(ctx, casterId, skill);

    const casterData = UNIT_DATA[casterId];
    const now = Date.now();

    // Create trap projectile mesh (spiky appearance)
    const trapGeometry = new THREE.OctahedronGeometry(TRAP_MESH_SIZE, 0);
    const trapMaterial = new THREE.MeshBasicMaterial({ color: "#888888" });
    const trapMesh = new THREE.Mesh(trapGeometry, trapMaterial);
    trapMesh.position.set(casterG.position.x, 0.5, casterG.position.z);
    scene.add(trapMesh);

    // Create trap projectile with arc trajectory (pause-safe timing)
    const trapProjectile: TrapProjectile = {
        type: "trap",
        mesh: trapMesh,
        attackerId: casterId,
        speed: 0,  // Speed not used for arc trajectory
        targetPos: { x: targetX, z: targetZ },
        aoeRadius: skill.aoeRadius ?? 2,
        pinnedDuration: skill.value[0],
        startX: casterG.position.x,
        startZ: casterG.position.z,
        elapsedTime: 0,
        lastUpdateTime: now,
        flightDuration: TRAP_FLIGHT_DURATION,
        arcHeight: TRAP_ARC_HEIGHT,
        isLanded: false
    };

    projectilesRef.current.push(trapProjectile);

    addLog(logTrapThrown(casterData.name, skill.name), "#888888");
    soundFns.playAttack();  // Throwing sound

    return true;
}

/**
 * Execute Sanctuary skill - creates healing tiles and dispels acid
 */
export function executeSanctuarySkill(
    ctx: SkillExecutionContext,
    casterId: number,
    skill: Skill,
    targetX: number,
    targetZ: number
): boolean {
    const { scene, unitsRef, sanctuaryTilesRef, acidTilesRef, addLog } = ctx;

    // Sanctuary requires tile refs to function
    if (!sanctuaryTilesRef || !acidTilesRef) {
        addLog("Sanctuary cannot be cast right now.", COLORS.logWarning);
        return false;
    }

    const casterG = unitsRef.current[casterId];
    if (!casterG) return false;

    consumeSkill(ctx, casterId, skill);

    const casterData = UNIT_DATA[casterId];
    const now = Date.now();
    const radius = skill.aoeRadius ?? 2.5;
    const healPerTick = skill.value[0] ?? SANCTUARY_HEAL_PER_TICK;

    // Create sanctuary tiles in radius, dispelling acid
    const centerX = Math.floor(targetX);
    const centerZ = Math.floor(targetZ);
    const radiusCells = Math.ceil(radius);
    let tilesCreated = 0;

    for (let dx = -radiusCells; dx <= radiusCells; dx++) {
        for (let dz = -radiusCells; dz <= radiusCells; dz++) {
            const dist = Math.sqrt(dx * dx + dz * dz);
            if (dist <= radius) {
                const tile = createSanctuaryTile(
                    scene,
                    sanctuaryTilesRef.current,
                    acidTilesRef.current,
                    centerX + dx,
                    centerZ + dz,
                    casterId,
                    healPerTick,
                    now
                );
                if (tile) tilesCreated++;
            }
        }
    }

    // Create visual ring effect
    createAnimatedRing(scene, targetX, targetZ, COLORS.sanctuary, { maxScale: radius });

    addLog(`${casterData.name} casts ${skill.name}, consecrating the ground!`, COLORS.sanctuaryText);
    soundFns.playHeal();  // Holy sound

    return true;
}

/**
 * Execute a skill based on its type
 * @param targetId Optional target unit ID for enemy-targeted skills (tracks moving targets)
 */
export function executeSkill(
    ctx: SkillExecutionContext,
    casterId: number,
    skill: Skill,
    targetX: number,
    targetZ: number,
    targetId?: number
): boolean {
    const caster = ctx.unitsStateRef.current.find(u => u.id === casterId);
    const casterG = ctx.unitsRef.current[casterId];

    if (!caster || !casterG || caster.hp <= 0) return false;
    if ((caster.mana ?? 0) < skill.manaCost) {
        ctx.addLog(`${UNIT_DATA[casterId].name}: Not enough mana!`, COLORS.logNeutral);
        return false;
    }

    if (skill.type === "damage" && skill.targetType === "aoe") {
        // Magic Wave - multi-target zig-zag projectiles that fan out
        if (skill.name === "Magic Wave") {
            return executeMagicWaveSkill(ctx, casterId, skill, targetX, targetZ);
        }
        // Standard AOE like Fireball
        executeAoeSkill(ctx, casterId, skill, targetX, targetZ);
        return true;
    } else if (skill.type === "heal" && skill.targetType === "ally") {
        return executeHealSkill(ctx, casterId, skill, targetX, targetZ);
    } else if (skill.type === "damage" && skill.targetType === "enemy") {
        // Check if this is a ranged skill (basic attack for ranged units)
        // Melee range is typically <= 2, ranged is > 2
        // Use effective stats to get equipment-derived range
        const effectiveData = getEffectiveUnitData(casterId);
        const isRanged = effectiveData.range && effectiveData.range > 2;

        // For basic attacks (name === "Attack"), use ranged if unit has range
        if (skill.name === "Attack" && isRanged) {
            return executeRangedSkill(ctx, casterId, skill, targetX, targetZ);
        }
        return executeMeleeSkill(ctx, casterId, skill, targetX, targetZ);
    } else if (skill.type === "taunt" && skill.targetType === "self") {
        return executeTauntSkill(ctx, casterId, skill);
    } else if (skill.type === "buff" && skill.targetType === "self") {
        return executeBuffSkill(ctx, casterId, skill);
    } else if (skill.type === "buff" && skill.targetType === "ally") {
        return executeCleanseSkill(ctx, casterId, skill, targetX, targetZ);
    } else if (skill.type === "flurry" && skill.targetType === "self") {
        return executeFlurrySkill(ctx, casterId, skill);
    } else if (skill.type === "debuff" && skill.targetType === "enemy") {
        return executeDebuffSkill(ctx, casterId, skill, targetX, targetZ);
    } else if (skill.type === "trap" && skill.targetType === "aoe") {
        return executeTrapSkill(ctx, casterId, skill, targetX, targetZ);
    } else if (skill.type === "sanctuary" && skill.targetType === "aoe") {
        return executeSanctuarySkill(ctx, casterId, skill, targetX, targetZ);
    } else if (skill.type === "mana_transfer" && skill.targetType === "ally") {
        return executeManaTransferSkill(ctx, casterId, skill, targetX, targetZ);
    } else if (skill.type === "smite" && skill.targetType === "enemy") {
        return executeSmiteSkill(ctx, casterId, skill, targetX, targetZ, targetId);
    }

    return false;
}

/**
 * Clear targeting mode and hide indicators
 */
export function clearTargetingMode(
    setTargetingMode: React.Dispatch<React.SetStateAction<{ casterId: number; skill: Skill } | null>>,
    rangeIndicatorRef: React.RefObject<THREE.Mesh | null>,
    aoeIndicatorRef: React.RefObject<THREE.Mesh | null>
): void {
    setTargetingMode(null);
    if (rangeIndicatorRef.current) rangeIndicatorRef.current.visible = false;
    if (aoeIndicatorRef.current) aoeIndicatorRef.current.visible = false;
}
