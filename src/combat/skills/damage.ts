// =============================================================================
// DAMAGE SKILLS - Offensive skill executors
// =============================================================================

import * as THREE from "three";
import type { Unit, Skill, UnitGroup, MagicMissileProjectile } from "../../core/types";
import { COLORS } from "../../core/constants";
import { UNIT_DATA, getUnitStats, getEffectiveUnitData } from "../../game/units";
import { rollChance, calculateDamageWithCrit, rollHit, getEffectiveArmor, logHit, logMiss, logPoisoned, logCast, calculateStatBonus, checkEnemyDefenses, createHpTracker } from "../combatMath";
import { ENEMY_STATS } from "../../game/units";
import { getUnitRadius, isInRange } from "../../rendering/range";
import { distanceToPoint } from "../../game/geometry";
import { getAliveUnits } from "../../game/unitQuery";
import { soundFns } from "../../audio";
import { createProjectile, getProjectileSpeed, applyDamageToUnit, createAnimatedRing, createLightningPillar, type DamageContext } from "../damageEffects";
import { spawnSwingIndicator } from "../../gameLoop/swingAnimations";
import type { SkillExecutionContext } from "./types";
import { findClosestTargetByTeam, consumeSkill } from "./helpers";

// =============================================================================
// AOE DAMAGE SKILL (e.g. Fireball)
// =============================================================================

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
        damage: skill.damageRange!,
        damageType: skill.damageType,
        targetPos: { x: targetX, z: targetZ }
    });

    addLog(logCast(UNIT_DATA[casterId].name, skill.name), COLORS.damageNeutral);
    soundFns.playFireball();
}

// =============================================================================
// MELEE SKILL (e.g. Poison Dagger)
// =============================================================================

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
    const { scene, unitsStateRef, unitsRef, hitFlashRef, damageTexts, setUnits, addLog, defeatedThisFrame, swingAnimationsRef } = ctx;

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

    // Spawn swing animation for melee attacks
    spawnSwingIndicator(scene, casterG, targetG, true, swingAnimationsRef.current, now);

    const casterData = UNIT_DATA[casterId];
    const targetData = getUnitStats(targetEnemy);
    const targetId = targetEnemy.id;

    // Check for enemy defensive abilities
    if (targetEnemy.enemyType) {
        const enemyStats = ENEMY_STATS[targetEnemy.enemyType];
        const defense = checkEnemyDefenses(enemyStats, targetEnemy.facing, casterG.position.x, casterG.position.z, targetG.position.x, targetG.position.z, skill.damageType);
        if (defense !== "none") {
            soundFns.playBlock();
            addLog(defense === "frontShield"
                ? `${casterData.name}'s ${skill.name} is blocked by ${targetData.name}'s shield!`
                : `${targetData.name} blocks ${casterData.name}'s ${skill.name}!`,
                defense === "frontShield" ? "#4488ff" : "#aaaaaa");
            return true;
        }
    }

    // Roll to hit
    if (rollHit(casterData.accuracy)) {
        const casterUnit = unitsStateRef.current.find(u => u.id === casterId);
        const statBonus = calculateStatBonus(casterUnit, skill.damageType);
        const { damage: dmg, isCrit } = calculateDamageWithCrit(skill.damageRange![0] + statBonus, skill.damageRange![1] + statBonus, getEffectiveArmor(targetEnemy, targetData.armor), skill.damageType, casterUnit);
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
            unitsRef: unitsRef.current, unitsStateRef, setUnits, addLog, now, defeatedThisFrame
        };
        applyDamageToUnit(dmgCtx, targetId, targetG, currentHp, dmg, targetData.name, {
            color: COLORS.damagePlayer,
            poison: willPoison ? { sourceId: casterId } : undefined,
            attackerName: casterData.name,
            hitMessage: { text: logHit(casterData.name, skill.name, targetData.name, dmg) + (isCrit ? " Critical hit!" : ""), color: isCrit ? COLORS.damageCrit : COLORS.damagePlayer },
            targetUnit: targetEnemy,
            attackerPosition: { x: casterG.position.x, z: casterG.position.z },
            isCrit
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

// =============================================================================
// SMITE SKILL (e.g. Thunder)
// =============================================================================

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
    soundFns.playThunder();

    // Check for front-shield block (smite is non-physical, skip block chance)
    if (targetEnemy.enemyType) {
        const enemyStats = ENEMY_STATS[targetEnemy.enemyType];
        const defense = checkEnemyDefenses(enemyStats, targetEnemy.facing, casterG.position.x, casterG.position.z, targetG.position.x, targetG.position.z);
        if (defense === "frontShield") {
            soundFns.playBlock();
            addLog(`${casterData.name}'s ${skill.name} is blocked by ${targetData.name}'s shield!`, "#4488ff");
            return true;
        }
    }

    // Roll to hit
    if (rollHit(casterData.accuracy)) {
        const casterUnit = unitsStateRef.current.find(u => u.id === casterId);
        const statBonus = calculateStatBonus(casterUnit, skill.damageType);
        const { damage: dmg, isCrit } = calculateDamageWithCrit(skill.damageRange![0] + statBonus, skill.damageRange![1] + statBonus, getEffectiveArmor(targetEnemy, targetData.armor), skill.damageType, casterUnit);

        // Read fresh HP from current state
        const freshTarget = unitsStateRef.current.find(u => u.id === targetId);
        const currentHp = freshTarget?.hp ?? targetEnemy.hp;

        // Skip if target was already defeated this frame
        if (currentHp <= 0 || defeatedThisFrame.has(targetId)) {
            return true;
        }

        const dmgCtx: DamageContext = {
            scene, damageTexts: damageTexts.current, hitFlashRef: hitFlashRef.current,
            unitsRef: unitsRef.current, unitsStateRef, setUnits, addLog, now, defeatedThisFrame
        };
        applyDamageToUnit(dmgCtx, targetId, targetG, currentHp, dmg, targetData.name, {
            color: COLORS.damagePlayer,
            attackerName: casterData.name,
            hitMessage: { text: logHit(casterData.name, skill.name, targetData.name, dmg) + (isCrit ? " Critical hit!" : ""), color: isCrit ? COLORS.damageCrit : COLORS.damagePlayer },
            targetUnit: targetEnemy,
            attackerPosition: { x: casterG.position.x, z: casterG.position.z },
            isCrit
        });
    } else {
        soundFns.playMiss();
        addLog(logMiss(casterData.name, skill.name, targetData.name), COLORS.logNeutral);
    }

    return true;
}

// =============================================================================
// RANGED SKILL (basic ranged attack)
// =============================================================================

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

// =============================================================================
// FLURRY SKILL (multiple rapid hits)
// =============================================================================

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
    const hpTracker = createHpTracker(enemiesInRange.map(e => e.unit));

    // Use shared defeatedThisFrame from context to prevent hitting dead enemies
    const dmgCtx: DamageContext = {
        scene, damageTexts: damageTexts.current, hitFlashRef: hitFlashRef.current,
        unitsRef: unitsRef.current, unitsStateRef, setUnits, addLog, now, defeatedThisFrame
    };

    let totalHits = 0;
    let totalDamage = 0;
    let totalCrits = 0;

    const casterUnit = unitsStateRef.current.find(u => u.id === casterId);
    const statBonus = calculateStatBonus(casterUnit, skill.damageType);

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
            if (checkEnemyDefenses(enemyStats, target.facing, casterG.position.x, casterG.position.z, targetG.position.x, targetG.position.z) === "frontShield") {
                soundFns.playBlock();
                continue;  // Skip this hit - blocked by shield
            }
        }

        if (rollHit(casterData.accuracy)) {
            const { damage: dmg, isCrit } = calculateDamageWithCrit(skill.damageRange![0] + statBonus, skill.damageRange![1] + statBonus, getEffectiveArmor(target, targetData.armor), skill.damageType, casterUnit);

            // Use tracked HP, not stale snapshot
            const currentHp = hpTracker[target.id];
            applyDamageToUnit(dmgCtx, target.id, targetG, currentHp, dmg, targetData.name, {
                color: COLORS.damagePlayer,
                attackerName: casterData.name,
                targetUnit: target,
                attackerPosition: { x: casterG.position.x, z: casterG.position.z },
                isCrit
            });

            // Update local HP tracker
            hpTracker[target.id] = Math.max(0, currentHp - dmg);

            totalHits++;
            totalDamage += dmg;
            if (isCrit) totalCrits++;
        }
    }

    soundFns.playAttack();

    // Visual effect - rapid green pulses
    createAnimatedRing(scene, casterG.position.x, casterG.position.z, "#27ae60", {
        innerRadius: 0.3, outerRadius: 0.5, maxScale: skill.range, duration: 200
    });

    if (totalHits > 0) {
        const critText = totalCrits > 0 ? ` (${totalCrits} critical!)` : "";
        addLog(`${casterData.name}'s ${skill.name} lands ${totalHits} hits for ${totalDamage} total damage!${critText}`, COLORS.damagePlayer);
    } else {
        addLog(`${casterData.name}'s ${skill.name} misses all targets!`, COLORS.logNeutral);
    }

    return true;
}

// =============================================================================
// MAGIC WAVE SKILL (multi-target zig-zag projectiles)
// =============================================================================

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
            damage: skill.damageRange!,
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
