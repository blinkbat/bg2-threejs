// =============================================================================
// DAMAGE SKILLS - Offensive skill executors
// =============================================================================

import * as THREE from "three";
import type { Unit, Skill, UnitGroup, MagicMissileProjectile, PiercingProjectile } from "../../core/types";
import { COLORS, SUN_STANCE_BONUS_DAMAGE, MAGIC_WAVE_TARGETING_BUFFER, MAGIC_WAVE_FAN_SPREAD, MAGIC_MISSILE_START_OFFSET, MAGIC_MISSILE_SPEED, MAGIC_MISSILE_ZIGZAG_PHASE_STEP, GLACIAL_WHORL_SPEED, GLACIAL_WHORL_MAX_DISTANCE } from "../../core/constants";
import { UNIT_DATA, getEffectiveUnitData } from "../../game/playerUnits";
import { getUnitStats } from "../../game/units";
import { rollChance, rollDamage, calculateDamageWithCrit, rollHit, getEffectiveArmor, logHit, logMiss, logPoisoned, logCast, logAoeHit, logAoeMiss, calculateStatBonus, checkEnemyDefenses, hasStatusEffect } from "../combatMath";
import { ENEMY_STATS } from "../../game/enemyStats";
import { getUnitRadius, isInRange } from "../../rendering/range";
import { distanceToPoint, isPointInRectangle } from "../../game/geometry";
import { getAliveUnits } from "../../game/unitQuery";
import { soundFns } from "../../audio";
import { createProjectile, getProjectileSpeed, applyDamageToUnit, createAnimatedRing, createLightningPillar, animateExpandingMesh, type DamageContext } from "../damageEffects";
import { spawnSwingIndicator } from "../../gameLoop/swingAnimations";
import type { SkillExecutionContext } from "./types";
import { findAndValidateEnemyTarget, consumeSkill } from "./helpers";

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
// DELIVERY TYPES FOR TARGETED DAMAGE SKILLS
// =============================================================================

export type DamageDelivery =
    | { mode: "melee" }
    | { mode: "ranged" }
    | { mode: "smite" };

// =============================================================================
// UNIFIED TARGETED DAMAGE SKILL
// =============================================================================

/**
 * Execute a targeted single-enemy damage skill.
 * Handles the shared pipeline: find target → range check → consume → delivery-specific effects.
 *
 * Delivery modes:
 * - melee: swing animation, full defense check (shield + block), hit roll + damage
 * - smite: lightning pillar, front-shield-only defense check, hit roll + damage
 * - ranged: spawns projectile (hit resolved on impact, no roll here)
 */
export function executeTargetedDamageSkill(
    ctx: SkillExecutionContext,
    casterId: number,
    skill: Skill,
    targetX: number,
    targetZ: number,
    delivery: DamageDelivery,
    targetUnitId?: number
): boolean {
    const { scene, unitsStateRef, unitsRef, hitFlashRef, damageTexts, setUnits, addLog, defeatedThisFrame, swingAnimationsRef, projectilesRef } = ctx;

    // --- Phase 1: Find target ---
    let targetEnemy: Unit | undefined;
    let targetG: UnitGroup | undefined;

    // Smite can track by unit ID (moving targets)
    if (targetUnitId !== undefined) {
        targetEnemy = unitsStateRef.current.find(u => u.id === targetUnitId && u.team === "enemy");
        targetG = unitsRef.current[targetUnitId];
    }

    // Fall back to position-based search
    if (!targetEnemy || !targetG) {
        const closest = findAndValidateEnemyTarget(ctx, casterId, targetX, targetZ);
        if (!closest) return false;
        targetEnemy = closest.unit;
        targetG = closest.group;
    }

    const casterG = unitsRef.current[casterId];
    if (!casterG) return false;

    // --- Phase 2: Range check ---
    const targetRadius = getUnitRadius(targetEnemy);
    if (!isInRange(casterG.position.x, casterG.position.z, targetG.position.x, targetG.position.z, targetRadius, skill.range + 0.5)) {
        addLog(`${UNIT_DATA[casterId].name}: Target out of range!`, COLORS.logNeutral);
        return false;
    }

    // --- Phase 3: Consume skill ---
    const now = Date.now();
    consumeSkill(ctx, casterId, skill);

    const casterData = UNIT_DATA[casterId];
    const targetData = getUnitStats(targetEnemy);
    const targetId = targetEnemy.id;

    // --- Phase 4: Delivery-specific effects ---

    // Ranged: spawn projectile and return (no hit roll here)
    if (delivery.mode === "ranged") {
        const effectiveData = getEffectiveUnitData(casterId);
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

    // Melee: swing animation
    if (delivery.mode === "melee") {
        spawnSwingIndicator(scene, casterG, targetG, true, swingAnimationsRef.current, now);
    }

    // Smite: lightning pillar
    if (delivery.mode === "smite") {
        createLightningPillar(scene, targetG.position.x, targetG.position.z);
        soundFns.playThunder();
    }

    // --- Phase 5: Defense check ---
    if (targetEnemy.enemyType) {
        const enemyStats = ENEMY_STATS[targetEnemy.enemyType];
        if (delivery.mode === "melee") {
            // Full defense check: front shield + block chance
            const defense = checkEnemyDefenses(enemyStats, targetEnemy.facing, casterG.position.x, casterG.position.z, targetG.position.x, targetG.position.z, skill.damageType);
            if (defense !== "none") {
                soundFns.playBlock();
                addLog(defense === "frontShield"
                    ? `${casterData.name}'s ${skill.name} is blocked by ${targetData.name}'s shield!`
                    : `${targetData.name} blocks ${casterData.name}'s ${skill.name}!`,
                    defense === "frontShield" ? "#4488ff" : "#aaaaaa");
                return true;
            }
        } else {
            // Smite: front-shield only (non-physical, skip block chance)
            const defense = checkEnemyDefenses(enemyStats, targetEnemy.facing, casterG.position.x, casterG.position.z, targetG.position.x, targetG.position.z);
            if (defense === "frontShield") {
                soundFns.playBlock();
                addLog(`${casterData.name}'s ${skill.name} is blocked by ${targetData.name}'s shield!`, "#4488ff");
                return true;
            }
        }
    }

    // --- Phase 6: Hit resolution ---
    if (rollHit(casterData.accuracy)) {
        const casterUnit = unitsStateRef.current.find(u => u.id === casterId);
        const statBonus = calculateStatBonus(casterUnit, skill.damageType);
        const { damage: dmg, isCrit } = calculateDamageWithCrit(
            skill.damageRange![0] + statBonus, skill.damageRange![1] + statBonus,
            getEffectiveArmor(targetEnemy, targetData.armor), skill.damageType, casterUnit
        );
        const willPoison = delivery.mode === "melee" && skill.poisonChance ? rollChance(skill.poisonChance) : false;

        const dmgCtx: DamageContext = {
            scene, damageTexts: damageTexts.current, hitFlashRef: hitFlashRef.current,
            unitsRef: unitsRef.current, unitsStateRef, setUnits, addLog, now, defeatedThisFrame
        };
        applyDamageToUnit(dmgCtx, targetId, targetG, dmg, targetData.name, {
            color: COLORS.damagePlayer,
            poison: willPoison ? { sourceId: casterId } : undefined,
            attackerName: casterData.name,
            hitMessage: { text: logHit(casterData.name, skill.name, targetData.name, dmg) + (isCrit ? " Critical hit!" : ""), color: isCrit ? COLORS.damageCrit : COLORS.damagePlayer },
            targetUnit: targetEnemy,
            attackerPosition: { x: casterG.position.x, z: casterG.position.z },
            isCrit
        });

        // Sun Stance: bonus fire damage on hit
        if (casterUnit && hasStatusEffect(casterUnit, "sun_stance")) {
            const fireDmg = rollDamage(SUN_STANCE_BONUS_DAMAGE[0], SUN_STANCE_BONUS_DAMAGE[1]);
            applyDamageToUnit(dmgCtx, targetId, targetG, fireDmg, targetData.name, {
                color: COLORS.dmgFire,
            });
        }

        if (delivery.mode === "melee") {
            soundFns.playHit();
        }

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
// THIN WRAPPERS - Preserve existing API surface
// =============================================================================

/** Execute a melee single-target damage skill (like Poison Dagger) */
export function executeMeleeSkill(ctx: SkillExecutionContext, casterId: number, skill: Skill, targetX: number, targetZ: number): boolean {
    return executeTargetedDamageSkill(ctx, casterId, skill, targetX, targetZ, { mode: "melee" });
}

/** Execute a smite skill (like Thunder) - instant-hit ranged damage with lightning pillar */
export function executeSmiteSkill(ctx: SkillExecutionContext, casterId: number, skill: Skill, targetX: number, targetZ: number, targetUnitId?: number): boolean {
    return executeTargetedDamageSkill(ctx, casterId, skill, targetX, targetZ, { mode: "smite" }, targetUnitId);
}

/** Execute a ranged single-target damage skill (basic attack for ranged units) */
export function executeRangedSkill(ctx: SkillExecutionContext, casterId: number, skill: Skill, targetX: number, targetZ: number): boolean {
    return executeTargetedDamageSkill(ctx, casterId, skill, targetX, targetZ, { mode: "ranged" });
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
    // defeatedThisFrame prevents hitting dead enemies (updated internally by applyDamageToUnit)
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

        // Skip if already defeated this frame
        if (defeatedThisFrame.has(target.id)) continue;

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

            applyDamageToUnit(dmgCtx, target.id, targetG, dmg, targetData.name, {
                color: COLORS.damagePlayer,
                attackerName: casterData.name,
                targetUnit: target,
                attackerPosition: { x: casterG.position.x, z: casterG.position.z },
                isCrit
            });

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
        if (distToTarget <= aoeRadius + MAGIC_WAVE_TARGETING_BUFFER) {  // Slight buffer for targeting
            enemiesNearTarget.push({ unit: enemy, group: enemyG, dist: distToTarget });
        }
    });

    // Sort by distance to target click
    enemiesNearTarget.sort((a, b) => a.dist - b.dist);

    // Calculate base direction towards target click for fan-out
    const baseAngle = Math.atan2(targetZ - casterG.position.z, targetX - casterG.position.x);
    const fanSpread = MAGIC_WAVE_FAN_SPREAD;  // 90 degree total spread

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
        const startOffset = MAGIC_MISSILE_START_OFFSET;
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
            speed: MAGIC_MISSILE_SPEED,
            damage: skill.damageRange!,
            damageType: skill.damageType ?? "chaos",
            zigzagOffset: 0,
            zigzagDirection: i % 2 === 0 ? 1 : -1,
            zigzagPhase: i * MAGIC_MISSILE_ZIGZAG_PHASE_STEP + Math.random() * 0.2,
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

// =============================================================================
// HOLY STRIKE SKILL (line-shaped AOE)
// =============================================================================

/**
 * Execute Holy Strike — rectangle AOE aimed at click target.
 * Instant damage to all enemies in the line, golden rectangle visual.
 */
export function executeHolyStrikeSkill(
    ctx: SkillExecutionContext,
    casterId: number,
    skill: Skill,
    targetX: number,
    targetZ: number
): boolean {
    const { scene, unitsStateRef, unitsRef, setUnits, addLog, hitFlashRef, damageTexts, defeatedThisFrame } = ctx;

    const casterG = unitsRef.current[casterId];
    if (!casterG) return false;

    consumeSkill(ctx, casterId, skill);

    const casterData = UNIT_DATA[casterId];
    const now = Date.now();
    const facingAngle = Math.atan2(targetZ - casterG.position.z, targetX - casterG.position.x);
    const length = skill.range;
    const lineWidth = skill.lineWidth ?? 1.5;
    const halfWidth = lineWidth / 2;

    // Find all enemies in the rectangle
    const enemies = getAliveUnits(unitsStateRef.current, "enemy");
    const enemiesInLine: { unit: Unit; group: UnitGroup }[] = [];

    for (const enemy of enemies) {
        if (defeatedThisFrame.has(enemy.id)) continue;
        const enemyG = unitsRef.current[enemy.id];
        if (!enemyG) continue;

        if (isPointInRectangle(
            enemyG.position.x, enemyG.position.z,
            casterG.position.x, casterG.position.z,
            facingAngle, length, halfWidth
        )) {
            enemiesInLine.push({ unit: enemy, group: enemyG });
        }
    }

    // Visual — golden rectangle extending from caster
    const rectGeo = new THREE.PlaneGeometry(length, lineWidth);
    rectGeo.translate(length / 2, 0, 0);
    const rectMesh = new THREE.Mesh(
        rectGeo,
        new THREE.MeshBasicMaterial({ color: "#ffd700", transparent: true, opacity: 0.7, side: THREE.DoubleSide })
    );
    rectMesh.rotation.x = -Math.PI / 2;
    rectMesh.rotation.z = -facingAngle;
    rectMesh.position.set(casterG.position.x, 0.2, casterG.position.z);
    scene.add(rectMesh);

    animateExpandingMesh(scene, rectMesh, {
        duration: 300,
        initialOpacity: 0.7,
        maxScale: 1.2,
        baseRadius: 1
    });

    soundFns.playHit();

    // Deal damage
    const dmgCtx: DamageContext = {
        scene, damageTexts: damageTexts.current, hitFlashRef: hitFlashRef.current,
        unitsRef: unitsRef.current, unitsStateRef, setUnits, addLog, now, defeatedThisFrame
    };

    let hitCount = 0;
    let totalDamage = 0;
    let totalCrits = 0;

    const casterUnit = unitsStateRef.current.find(u => u.id === casterId);
    const statBonus = calculateStatBonus(casterUnit, skill.damageType);

    for (const { unit: target, group: tg } of enemiesInLine) {
        if (defeatedThisFrame.has(target.id)) continue;
        const targetData = getUnitStats(target);

        if (rollHit(casterData.accuracy)) {
            const { damage: dmg, isCrit } = calculateDamageWithCrit(
                skill.damageRange![0] + statBonus, skill.damageRange![1] + statBonus,
                getEffectiveArmor(target, targetData.armor), skill.damageType, casterUnit
            );

            applyDamageToUnit(dmgCtx, target.id, tg, dmg, targetData.name, {
                color: COLORS.damagePlayer,
                attackerName: casterData.name,
                targetUnit: target,
                attackerPosition: { x: casterG.position.x, z: casterG.position.z },
                isCrit
            });

            hitCount++;
            totalDamage += dmg;
            if (isCrit) totalCrits++;
        }
    }

    if (hitCount > 0) {
        const critText = totalCrits > 0 ? ` (${totalCrits} critical!)` : "";
        addLog(logAoeHit(casterData.name, skill.name, hitCount, totalDamage) + critText, COLORS.damagePlayer);
    } else if (enemiesInLine.length > 0) {
        addLog(logAoeMiss(casterData.name, skill.name), COLORS.logNeutral);
    } else {
        addLog(logCast(casterData.name, skill.name), "#ffd700");
    }

    return true;
}

// =============================================================================
// GLACIAL WHORL SKILL (piercing projectile)
// =============================================================================

/**
 * Execute Glacial Whorl — a slow piercing projectile that passes through all enemies,
 * dealing cold damage and potentially applying chilled.
 */
export function executeGlacialWhorlSkill(
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

    // Compute direction from caster to click
    const dx = targetX - casterG.position.x;
    const dz = targetZ - casterG.position.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.01) return true;  // Click on self — skill consumed but no projectile
    const dirX = dx / len;
    const dirZ = dz / len;

    // Create projectile mesh (ice shard)
    const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.25, 10, 10),
        new THREE.MeshBasicMaterial({ color: skill.projectileColor ?? "#5dade2" })
    );
    mesh.position.set(casterG.position.x + dirX * 0.3, 0.5, casterG.position.z + dirZ * 0.3);
    scene.add(mesh);

    const piercingProj: PiercingProjectile = {
        type: "piercing",
        mesh,
        attackerId: casterId,
        speed: GLACIAL_WHORL_SPEED,
        damage: skill.damageRange!,
        damageType: skill.damageType ?? "cold",
        startX: mesh.position.x,
        startZ: mesh.position.z,
        directionX: dirX,
        directionZ: dirZ,
        maxDistance: GLACIAL_WHORL_MAX_DISTANCE,
        hitUnits: new Set<number>(),
        chillChance: skill.chillChance ?? 60,
        attackerTeam: "player"
    };

    projectilesRef.current.push(piercingProj);

    addLog(logCast(casterData.name, skill.name), COLORS.dmgCold);
    soundFns.playAttack();

    return true;
}
