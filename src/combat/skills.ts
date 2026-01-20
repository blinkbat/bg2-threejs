// =============================================================================
// SKILL EXECUTION & TARGETING
// =============================================================================

import * as THREE from "three";
import type { Unit, Skill, UnitGroup, Projectile, StatusEffect } from "../core/types";
import { COLORS, BUFF_TICK_INTERVAL } from "../core/constants";
import { UNIT_DATA, getUnitStats } from "../game/units";
import { rollDamage, rollChance, calculateDamage, rollHit, getEffectiveArmor, hasShieldedEffect, hasStunnedEffect, hasPoisonEffect, logHit, logMiss, logHeal, logPoisoned, logCast, logTaunt, logTauntMiss, logBuff, logStunned, logCleanse } from "./combatMath";
import { getUnitRadius, isInRange } from "../rendering/range";
import { soundFns } from "../audio/sound";
import { createProjectile, getProjectileSpeed, applyDamageToUnit, animateExpandingMesh, type DamageContext } from "./combat";

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
        const d = Math.hypot(g.position.x - targetX, g.position.z - targetZ);
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
    const { unitsStateRef, actionCooldownRef, setSkillCooldowns, setUnits } = ctx;
    const now = Date.now();

    // Check if caster is shielded - doubles cooldowns
    const caster = unitsStateRef.current.find(u => u.id === casterId);
    const cooldownMultiplier = caster && hasShieldedEffect(caster) ? 2 : 1;

    const effectiveCooldown = skill.cooldown * cooldownMultiplier;
    const cooldownEnd = now + effectiveCooldown;

    // Set internal cooldown ref (unit-level lock)
    actionCooldownRef.current[casterId] = cooldownEnd;

    // Set UI cooldown ONLY for the skill that was used
    setSkillCooldowns(prev => ({
        ...prev,
        [`${casterId}-${skill.name}`]: { end: cooldownEnd, duration: effectiveCooldown }
    }));

    // Deduct mana
    setUnits(prev => prev.map(u => u.id === casterId ? { ...u, mana: (u.mana ?? 0) - skill.manaCost } : u));
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
    if (targetAlly.hp >= UNIT_DATA[targetAlly.id].maxHp) {
        addLog(`${UNIT_DATA[casterId].name}: ${UNIT_DATA[targetAlly.id].name} is at full health!`, COLORS.logNeutral);
        return false;
    }

    consumeSkill(ctx, casterId, skill);

    // Apply heal
    const healAmount = rollDamage(skill.value[0], skill.value[1]);
    const targetData = UNIT_DATA[targetAlly.id];
    const healTargetId = targetAlly.id;
    setUnits(prev => prev.map(u => u.id === healTargetId ? { ...u, hp: Math.min(targetData.maxHp, u.hp + healAmount) } : u));

    addLog(logHeal(UNIT_DATA[casterId].name, skill.name, targetData.name, healAmount), COLORS.hpHigh);
    soundFns.playHeal();

    // Visual effect - green flash (use hitFlashRef system with green start color)
    const mesh = unitMeshRef.current[healTargetId];
    if (targetG && mesh) {
        (mesh.material as THREE.MeshStandardMaterial).color.set("#22ff22");
        hitFlashRef.current[healTargetId] = Date.now();
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
    const { scene, unitsStateRef, unitsRef, hitFlashRef, damageTexts, setUnits, addLog } = ctx;

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

    // Roll to hit
    if (rollHit(casterData.accuracy)) {
        const dmg = calculateDamage(skill.value[0], skill.value[1], getEffectiveArmor(targetEnemy, targetData.armor));
        const willPoison = skill.poisonChance ? rollChance(skill.poisonChance) : false;

        const dmgCtx: DamageContext = {
            scene, damageTexts: damageTexts.current, hitFlashRef: hitFlashRef.current,
            unitsRef: unitsRef.current, setUnits, addLog, now
        };
        applyDamageToUnit(dmgCtx, targetId, targetG, targetEnemy.hp, dmg, targetData.name, {
            color: COLORS.damagePlayer,
            poison: willPoison ? { sourceId: casterId } : undefined
        });

        soundFns.playHit();
        addLog(logHit(casterData.name, skill.name, targetData.name, dmg), COLORS.damagePlayer);

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
    const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.5, 0.7, 32),
        new THREE.MeshBasicMaterial({ color: "#c0392b", transparent: true, opacity: 0.8, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(casterG.position.x, 0.1, casterG.position.z);
    scene.add(ring);

    animateExpandingMesh(scene, ring, { maxScale: skill.range, baseRadius: 0.6 });

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
            lastTick: now,
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
    const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.3, 0.5, 32),
        new THREE.MeshBasicMaterial({ color: "#f1c40f", transparent: true, opacity: 0.8, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(casterG.position.x, 0.1, casterG.position.z);
    scene.add(ring);

    animateExpandingMesh(scene, ring, { maxScale: 1.5, baseRadius: 0.4, duration: 300 });

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
    const hasPoisonNow = hasPoisonEffect(targetAlly);
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
            lastTick: now,
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
    addLog(logCleanse(casterData.name, skill.name), "#ecf0f1");

    // Visual effect - white/silver glow ring
    const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.3, 0.5, 32),
        new THREE.MeshBasicMaterial({ color: "#ecf0f1", transparent: true, opacity: 0.8, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(targetG.position.x, 0.1, targetG.position.z);
    scene.add(ring);

    animateExpandingMesh(scene, ring, { maxScale: 1.5, baseRadius: 0.4, duration: 300 });

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
    const { scene, unitsStateRef, unitsRef, setUnits, addLog, hitFlashRef, damageTexts } = ctx;

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
    let totalHits = 0;
    let totalDamage = 0;

    for (let i = 0; i < hitCount; i++) {
        const targetIdx = i % enemiesInRange.length;
        const { unit: target, group: targetG } = enemiesInRange[targetIdx];
        const targetData = getUnitStats(target);

        if (rollHit(casterData.accuracy)) {
            const dmg = calculateDamage(skill.value[0], skill.value[1], getEffectiveArmor(target, targetData.armor));

            const dmgCtx: DamageContext = {
                scene, damageTexts: damageTexts.current, hitFlashRef: hitFlashRef.current,
                unitsRef: unitsRef.current, setUnits, addLog, now
            };
            applyDamageToUnit(dmgCtx, target.id, targetG, target.hp, dmg, targetData.name, {
                color: COLORS.damagePlayer
            });

            totalHits++;
            totalDamage += dmg;
        }
    }

    soundFns.playAttack();

    // Visual effect - rapid green pulses
    const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.3, 0.5, 32),
        new THREE.MeshBasicMaterial({ color: "#27ae60", transparent: true, opacity: 0.8, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(casterG.position.x, 0.1, casterG.position.z);
    scene.add(ring);

    animateExpandingMesh(scene, ring, { maxScale: skill.range, baseRadius: 0.4, duration: 200 });

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

    const casterData = UNIT_DATA[casterId];

    // Create projectile toward target
    const projectile = createProjectile(scene, "ranged", casterG.position.x, casterG.position.z, casterData.projectileColor);

    projectilesRef.current.push({
        type: "basic",
        mesh: projectile,
        attackerId: casterId,
        targetId: targetEnemy.id,
        speed: getProjectileSpeed("ranged")
    });

    addLog(`${casterData.name} shoots at ${getUnitStats(targetEnemy).name}!`, COLORS.damageNeutral);
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
    if (hasStunnedEffect(targetEnemy)) {
        addLog(`${UNIT_DATA[casterId].name}: Target is already stunned!`, COLORS.logNeutral);
        return false;
    }

    const now = Date.now();
    consumeSkill(ctx, casterId, skill);

    const casterData = UNIT_DATA[casterId];
    const targetData = getUnitStats(targetEnemy);
    const targetId = targetEnemy.id;

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
                    lastTick: now,
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
 * Execute a skill based on its type
 */
export function executeSkill(
    ctx: SkillExecutionContext,
    casterId: number,
    skill: Skill,
    targetX: number,
    targetZ: number
): boolean {
    const caster = ctx.unitsStateRef.current.find(u => u.id === casterId);
    const casterG = ctx.unitsRef.current[casterId];

    if (!caster || !casterG || caster.hp <= 0) return false;
    if ((caster.mana ?? 0) < skill.manaCost) {
        ctx.addLog(`${UNIT_DATA[casterId].name}: Not enough mana!`, COLORS.logNeutral);
        return false;
    }

    if (skill.type === "damage" && skill.targetType === "aoe") {
        executeAoeSkill(ctx, casterId, skill, targetX, targetZ);
        return true;
    } else if (skill.type === "heal" && skill.targetType === "ally") {
        return executeHealSkill(ctx, casterId, skill, targetX, targetZ);
    } else if (skill.type === "damage" && skill.targetType === "enemy") {
        // Check if this is a ranged skill (basic attack for ranged units)
        // Melee range is typically <= 2, ranged is > 2
        const casterData = UNIT_DATA[casterId];
        const isRanged = casterData.range && casterData.range > 2;

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
