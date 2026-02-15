// =============================================================================
// DAMAGE SKILLS - Offensive skill executors
// =============================================================================

import * as THREE from "three";
import type { Unit, Skill, UnitGroup, BasicProjectile, MagicMissileProjectile, PiercingProjectile } from "../../core/types";
import { COLORS, SUN_STANCE_BONUS_DAMAGE, MAGIC_MISSILE_START_OFFSET, MAGIC_MISSILE_SPEED, MAGIC_MISSILE_ZIGZAG_PHASE_STEP, GLACIAL_WHORL_SPEED, GLACIAL_WHORL_MAX_DISTANCE } from "../../core/constants";
import { UNIT_DATA, getEffectiveUnitData } from "../../game/playerUnits";
import { getUnitStats } from "../../game/units";
import { rollChance, rollDamage, calculateDamageWithCrit, rollHit, getEffectiveArmor, logHit, logMiss, logPoisoned, logCast, logAoeHit, logAoeMiss, calculateStatBonus, checkEnemyDefenses, hasStatusEffect } from "../combatMath";
import { ENEMY_STATS } from "../../game/enemyStats";
import { getUnitRadius, isInRange } from "../../rendering/range";
import { isPointInRectangle } from "../../game/geometry";
import { getAliveUnits } from "../../game/unitQuery";
import { soundFns } from "../../audio";
import { createProjectile, getProjectileSpeed, applyDamageToUnit, createAnimatedRing, createLightningPillar, animateExpandingMesh, type DamageContext } from "../damageEffects";
import { spawnSwingIndicator } from "../../gameLoop/swingAnimations";
import type { SkillExecutionContext } from "./types";
import { findAndValidateEnemyTarget, consumeSkill } from "./helpers";

const GLACIAL_WHORL_GEOMETRY = new THREE.IcosahedronGeometry(0.26, 1);
const MAGIC_MISSILE_GEOMETRY = new THREE.IcosahedronGeometry(0.11, 0);

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

    createAnimatedRing(scene, casterG.position.x, casterG.position.z, skill.projectileColor ?? COLORS.dmgFire, {
        innerRadius: 0.15,
        outerRadius: 0.35,
        maxScale: 1.1,
        duration: 220
    });

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

    // Target lock by ID: never retarget to a different unit if an explicit target was provided.
    if (targetUnitId !== undefined) {
        targetEnemy = unitsStateRef.current.find(u => u.id === targetUnitId && u.team === "enemy" && u.hp > 0);
        targetG = unitsRef.current[targetUnitId];
        if (!targetEnemy || !targetG) return false;
    } else {
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
        const projectileColor = skill.projectileColor ?? effectiveData.projectileColor;
        const projectile = createProjectile(scene, "ranged", casterG.position.x, casterG.position.z, projectileColor);

        const basicProjectile: BasicProjectile = {
            type: "basic",
            mesh: projectile,
            attackerId: casterId,
            targetId: targetEnemy.id,
            speed: getProjectileSpeed("ranged")
        };

        // Preserve existing basic-attack projectile behavior unless this is a named skill shot.
        if (skill.name !== "Attack" && skill.damageRange) {
            basicProjectile.skillName = skill.name;
            basicProjectile.skillDamage = skill.damageRange;
            basicProjectile.skillDamageType = skill.damageType;
            if (skill.critChanceOverride !== undefined) {
                basicProjectile.skillCritChanceOverride = skill.critChanceOverride;
            }
            if (skill.onHitEffect) {
                basicProjectile.skillOnHitEffect = skill.onHitEffect;
            }
        }

        projectilesRef.current.push(basicProjectile);
        soundFns.playAttack();
        return true;
    }

    // Melee: swing animation
    if (delivery.mode === "melee") {
        spawnSwingIndicator(scene, casterG, targetG, true, swingAnimationsRef.current, now);
        if (skill.name !== "Attack") {
            createAnimatedRing(scene, casterG.position.x, casterG.position.z, COLORS.damagePlayer, {
                innerRadius: 0.14,
                outerRadius: 0.3,
                maxScale: 1.0,
                duration: 180
            });
        }
    }

    // Smite: lightning pillar
    if (delivery.mode === "smite") {
        createLightningPillar(scene, targetG.position.x, targetG.position.z);
        createAnimatedRing(scene, casterG.position.x, casterG.position.z, COLORS.dmgLightning, {
            innerRadius: 0.16,
            outerRadius: 0.34,
            maxScale: 1.15,
            duration: 230
        });
        createAnimatedRing(scene, targetG.position.x, targetG.position.z, COLORS.dmgLightning, {
            innerRadius: 0.22,
            outerRadius: 0.44,
            maxScale: 1.9,
            duration: 260
        });
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
        const damageColor = skill.damageType === "holy" ? COLORS.dmgHoly : COLORS.damagePlayer;

        const dmgCtx: DamageContext = {
            scene, damageTexts: damageTexts.current, hitFlashRef: hitFlashRef.current,
            unitsRef: unitsRef.current, unitsStateRef, setUnits, addLog, now, defeatedThisFrame
        };
        applyDamageToUnit(dmgCtx, targetId, targetG, dmg, targetData.name, {
            color: damageColor,
            poison: willPoison ? { sourceId: casterId } : undefined,
            attackerName: casterData.name,
            hitMessage: { text: logHit(casterData.name, skill.name, targetData.name, dmg) + (isCrit ? " Critical hit!" : ""), color: isCrit ? COLORS.damageCrit : damageColor },
            targetUnit: targetEnemy,
            attackerPosition: { x: casterG.position.x, z: casterG.position.z },
            damageType: skill.damageType,
            isCrit,
            attackerId: casterId,
            isMeleeHit: delivery.mode === "melee"
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

        if (skill.name === "Poison Dagger" && willPoison) {
            createAnimatedRing(scene, targetG.position.x, targetG.position.z, COLORS.poisonText, {
                innerRadius: 0.16,
                outerRadius: 0.34,
                maxScale: 1.25,
                duration: 260
            });
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
export function executeMeleeSkill(
    ctx: SkillExecutionContext,
    casterId: number,
    skill: Skill,
    targetX: number,
    targetZ: number,
    targetUnitId?: number
): boolean {
    return executeTargetedDamageSkill(ctx, casterId, skill, targetX, targetZ, { mode: "melee" }, targetUnitId);
}

/** Execute a smite skill (like Thunder) - instant-hit ranged damage with lightning pillar */
export function executeSmiteSkill(ctx: SkillExecutionContext, casterId: number, skill: Skill, targetX: number, targetZ: number, targetUnitId?: number): boolean {
    return executeTargetedDamageSkill(ctx, casterId, skill, targetX, targetZ, { mode: "smite" }, targetUnitId);
}

/** Execute a ranged single-target damage skill (basic attack for ranged units) */
export function executeRangedSkill(
    ctx: SkillExecutionContext,
    casterId: number,
    skill: Skill,
    targetX: number,
    targetZ: number,
    targetUnitId?: number
): boolean {
    return executeTargetedDamageSkill(ctx, casterId, skill, targetX, targetZ, { mode: "ranged" }, targetUnitId);
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
                isCrit,
                attackerId: casterId,
                isMeleeHit: true
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
 * Execute Magic Wave skill - launches a coherent wave front of arcane bolts.
 * Missiles travel forward in lanes and strike enemies they pass through.
 */
export function executeMagicWaveSkill(
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
    const missileCount = skill.hitCount ?? 8;
    const aoeRadius = skill.aoeRadius ?? 3;
    const waveDistance = Math.max(1.5, skill.range);

    createAnimatedRing(scene, casterG.position.x, casterG.position.z, skill.projectileColor ?? COLORS.dmgChaos, {
        innerRadius: 0.2,
        outerRadius: 0.42,
        maxScale: 1.3,
        duration: 260
    });
    createAnimatedRing(scene, targetX, targetZ, skill.projectileColor ?? COLORS.dmgChaos, {
        innerRadius: 0.2,
        outerRadius: 0.5,
        maxScale: aoeRadius,
        duration: 300
    });

    // Calculate wave direction from caster to clicked location.
    const toTargetX = targetX - casterG.position.x;
    const toTargetZ = targetZ - casterG.position.z;
    const toTargetLen = Math.hypot(toTargetX, toTargetZ);
    const waveDirX = toTargetLen > 0.01 ? toTargetX / toTargetLen : 1;
    const waveDirZ = toTargetLen > 0.01 ? toTargetZ / toTargetLen : 0;
    const wavePerpX = -waveDirZ;
    const wavePerpZ = waveDirX;
    const waveEndX = casterG.position.x + waveDirX * waveDistance;
    const waveEndZ = casterG.position.z + waveDirZ * waveDistance;
    const waveWidth = Math.max(1.8, aoeRadius * 1.8);
    const laneScaleNearCaster = 0.42;
    const baseFacing = Math.atan2(waveDirX, waveDirZ);

    // Generate unique volley ID for tracking hits across all missiles in this cast
    const volleyId = Date.now() + Math.random();

    // Create missiles in a lateral line; each one becomes a lane in the wave.
    for (let i = 0; i < missileCount; i++) {
        const normalizedPos = missileCount > 1 ? i / (missileCount - 1) : 0.5;
        const laneOffset = (normalizedPos - 0.5) * waveWidth;

        // Create magic missile projectile mesh
        const missile = new THREE.Mesh(
            MAGIC_MISSILE_GEOMETRY,
            new THREE.MeshPhongMaterial({
                color: skill.projectileColor ?? "#9966ff",
                emissive: "#6a3faf",
                emissiveIntensity: 0.5,
                specular: new THREE.Color("#e8d8ff"),
                shininess: 85,
                transparent: true,
                opacity: 0.95
            })
        );
        missile.userData.visualPhase = i * 0.45 + Math.random() * 0.2;
        missile.userData.sharedGeometry = true;
        missile.rotation.y = baseFacing;
        // Start slightly forward from caster with compressed lateral spread.
        const startOffset = MAGIC_MISSILE_START_OFFSET;
        const startX = casterG.position.x + waveDirX * startOffset + wavePerpX * laneOffset * laneScaleNearCaster;
        const startZ = casterG.position.z + waveDirZ * startOffset + wavePerpZ * laneOffset * laneScaleNearCaster;
        missile.position.set(
            startX,
            0.6,
            startZ
        );
        scene.add(missile);

        // Create a wave-lane projectile (no per-missile homing target).
        const magicMissile: MagicMissileProjectile = {
            type: "magic_missile",
            mesh: missile,
            attackerId: casterId,
            targetId: -1,
            targetPos: { x: waveEndX, z: waveEndZ },
            speed: MAGIC_MISSILE_SPEED,
            damage: skill.damageRange!,
            damageType: skill.damageType ?? "chaos",
            zigzagOffset: 0,
            zigzagDirection: i % 2 === 0 ? 1 : -1,
            zigzagPhase: i * MAGIC_MISSILE_ZIGZAG_PHASE_STEP + Math.random() * 0.2,
            fanAngle: normalizedPos - 0.5,
            startX,
            startZ,
            waveDirX,
            waveDirZ,
            wavePerpX,
            wavePerpZ,
            waveLaneOffset: laneOffset,
            waveMaxDistance: waveDistance + 0.6,
            hitUnits: new Set<number>(),
            volleyId,
            missileIndex: i,
            totalMissiles: missileCount
        };

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
    const endX = casterG.position.x + Math.cos(facingAngle) * length;
    const endZ = casterG.position.z + Math.sin(facingAngle) * length;
    const midX = (casterG.position.x + endX) * 0.5;
    const midZ = (casterG.position.z + endZ) * 0.5;

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
    createAnimatedRing(scene, endX, endZ, COLORS.dmgHoly, {
        innerRadius: 0.25,
        outerRadius: 0.5,
        maxScale: 1.7,
        duration: 320
    });
    createLightningPillar(scene, midX, midZ, {
        color: "#ffe8b8",
        duration: 220,
        radius: 0.12,
        height: 5
    });
    createLightningPillar(scene, endX, endZ, {
        color: "#fff4d1",
        duration: 280,
        radius: 0.16,
        height: 6
    });

    soundFns.playHolyStrike();

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
                color: COLORS.dmgHoly,
                attackerName: casterData.name,
                targetUnit: target,
                attackerPosition: { x: casterG.position.x, z: casterG.position.z },
                damageType: skill.damageType,
                isCrit
            });
            createLightningPillar(scene, tg.position.x, tg.position.z, {
                color: isCrit ? "#fff9e8" : "#ffe7b0",
                duration: isCrit ? 260 : 200,
                radius: isCrit ? 0.14 : 0.1,
                height: isCrit ? 5.5 : 4
            });

            hitCount++;
            totalDamage += dmg;
            if (isCrit) totalCrits++;
        }
    }

    if (hitCount > 0) {
        const critText = totalCrits > 0 ? ` (${totalCrits} critical!)` : "";
        addLog(logAoeHit(casterData.name, skill.name, hitCount, totalDamage) + critText, COLORS.dmgHoly);
    } else if (enemiesInLine.length > 0) {
        addLog(logAoeMiss(casterData.name, skill.name), COLORS.logNeutral);
    } else {
        addLog(logCast(casterData.name, skill.name), COLORS.dmgHoly);
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
    createAnimatedRing(scene, casterG.position.x, casterG.position.z, COLORS.dmgCold, {
        innerRadius: 0.18,
        outerRadius: 0.4,
        maxScale: 1.25,
        duration: 240
    });
    createAnimatedRing(scene, casterG.position.x, casterG.position.z, COLORS.chilledText, {
        innerRadius: 0.1,
        outerRadius: 0.22,
        maxScale: 1.5,
        duration: 280,
        initialOpacity: 0.55,
        y: 0.12
    });

    const casterData = UNIT_DATA[casterId];

    // Compute direction from caster to click
    const dx = targetX - casterG.position.x;
    const dz = targetZ - casterG.position.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.01) return true;  // Click on self — skill consumed but no projectile
    const dirX = dx / len;
    const dirZ = dz / len;

    // Create projectile mesh: crystalline shard with a soft emissive glow.
    const mesh = new THREE.Mesh(
        GLACIAL_WHORL_GEOMETRY,
        new THREE.MeshPhongMaterial({
            color: skill.projectileColor ?? "#5dade2",
            emissive: COLORS.chilledText,
            emissiveIntensity: 0.5,
            specular: new THREE.Color("#dff6ff"),
            shininess: 95,
            transparent: true,
            opacity: 0.92
        })
    );
    mesh.scale.set(2.15, 0.74, 0.94);
    mesh.rotation.y = Math.atan2(dirX, dirZ);
    mesh.position.set(casterG.position.x + dirX * 0.45, 0.5, casterG.position.z + dirZ * 0.45);
    mesh.userData.sharedGeometry = true;
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
        attackerTeam: "player",
        baseScaleX: 2.15,
        baseScaleY: 0.74,
        baseScaleZ: 0.94,
        visualPhase: Math.random() * Math.PI * 2,
        spinSpeed: 0.1,
        trailIntervalMs: 120,
        nextTrailAt: Date.now() + 40
    };

    projectilesRef.current.push(piercingProj);

    addLog(logCast(casterData.name, skill.name), COLORS.dmgCold);
    soundFns.playAttack();

    return true;
}
