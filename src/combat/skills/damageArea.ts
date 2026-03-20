// =============================================================================
// DAMAGE AOE/PROJECTILE SKILLS - Extracted offensive skill executors
// =============================================================================

import * as THREE from "three";
import type { Unit, Skill, UnitGroup, MagicMissileProjectile, PiercingProjectile, StatusEffect } from "../../core/types";
import {
    COLORS,
    BUFF_TICK_INTERVAL,
    MAGIC_MISSILE_START_OFFSET,
    MAGIC_MISSILE_SPEED,
    MAGIC_MISSILE_ZIGZAG_PHASE_STEP,
    GLACIAL_WHORL_SPEED,
    GLACIAL_WHORL_MAX_DISTANCE,
    HOLY_DAMAGE_PER_TICK,
    getSkillTextColor,
} from "../../core/constants";
import { UNIT_DATA } from "../../game/playerUnits";
import { getUnitStats } from "../../game/units";
import {
    rollChance,
    calculateDamageWithCrit,
    rollSkillHit,
    getEffectiveArmor,
    logCast,
    logAoeHit,
    logAoeMiss,
    calculateSkillStatBonusBudget,
    checkEnemyDefenses,
    hasStatusEffect,
    applyStatusEffect,
    getDistributedStatBonus,
} from "../combatMath";
import { ENEMY_STATS } from "../../game/enemyStats";
import { getUnitRadius, isInRange } from "../../rendering/range";
import { isPointInRectangle } from "../../game/geometry";
import { getAliveUnits } from "../../game/unitQuery";
import { findNearestPassable } from "../../ai/pathfinding";
import { soundFns } from "../../audio";
import {
    applyDamageToUnit,
    createAnimatedRing,
    createLightningPillar,
    animateExpandingMesh,
    type DamageContext,
} from "../damageEffects";
import { createHolyCross } from "../../gameLoop/holyTiles";
import type { SkillExecutionContext } from "./types";
import { consumeSkill } from "./helpers";

const GLACIAL_WHORL_GEOMETRY = new THREE.IcosahedronGeometry(0.26, 1);
const MAGIC_MISSILE_GEOMETRY = new THREE.IcosahedronGeometry(0.11, 0);

function isPointInCross(
    px: number,
    pz: number,
    centerX: number,
    centerZ: number,
    armLength: number,
    halfWidth: number
): boolean {
    const dx = Math.abs(px - centerX);
    const dz = Math.abs(pz - centerZ);
    const onHorizontalArm = dx <= armLength && dz <= halfWidth;
    const onVerticalArm = dz <= armLength && dx <= halfWidth;
    return onHorizontalArm || onVerticalArm;
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

    const { damageRange } = skill;
    if (!damageRange) return false;

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
    const skillLogColor = getSkillTextColor(skill.type, skill.damageType);

    const casterUnit = unitsStateRef.current.find(u => u.id === casterId);
    const totalStatBonus = calculateSkillStatBonusBudget(casterUnit, skill.damageType, skill);

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

        if (rollSkillHit(skill, casterData.accuracy, casterUnit)) {
            const hitStatBonus = getDistributedStatBonus(totalStatBonus, i, hitCount);
            const { damage: dmg, isCrit } = calculateDamageWithCrit(damageRange[0] + hitStatBonus, damageRange[1] + hitStatBonus, getEffectiveArmor(target, targetData.armor), skill.damageType, casterUnit);

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
        addLog(`${casterData.name}'s ${skill.name} lands ${totalHits} hits for ${totalDamage} total damage!${critText}`, skillLogColor);
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

    const { damageRange } = skill;
    if (!damageRange) return false;

    const casterG = unitsRef.current[casterId];
    if (!casterG) return false;

    consumeSkill(ctx, casterId, skill);
    const casterData = UNIT_DATA[casterId];
    const casterUnit = ctx.unitsStateRef.current.find(u => u.id === casterId);
    const totalStatBonus = calculateSkillStatBonusBudget(casterUnit, skill.damageType, skill);
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
            attackerName: casterData.name,
            targetId: -1,
            targetPos: { x: waveEndX, z: waveEndZ },
            speed: MAGIC_MISSILE_SPEED,
            damage: damageRange,
            damageType: skill.damageType ?? "chaos",
            statBonus: getDistributedStatBonus(totalStatBonus, i, missileCount),
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

    addLog(logCast(casterData.name, skill.name), getSkillTextColor(skill.type, skill.damageType));
    soundFns.playMagicWave();

    return true;
}

// =============================================================================
// HOLY CROSS SKILL (cross-shaped detonation + holy ground)
// =============================================================================

/**
 * Execute Holy Cross — instant cross-shaped holy detonation that leaves smiting ground.
 */
export function executeHolyCrossSkill(
    ctx: SkillExecutionContext,
    casterId: number,
    skill: Skill,
    targetX: number,
    targetZ: number
): boolean {
    const { scene, unitsStateRef, unitsRef, setUnits, addLog, hitFlashRef, damageTexts, defeatedThisFrame, holyTilesRef } = ctx;
    if (!holyTilesRef) {
        addLog("Holy Cross cannot be cast right now.", COLORS.logWarning);
        return false;
    }

    const { damageRange } = skill;
    if (!damageRange) return false;

    const casterG = unitsRef.current[casterId];
    if (!casterG) return false;

    consumeSkill(ctx, casterId, skill);

    const casterData = UNIT_DATA[casterId];
    const now = Date.now();
    const armLengthTiles = Math.max(1, Math.round(skill.aoeRadius ?? 4));
    const armWidthTiles = 2;
    const armLength = armLengthTiles;
    const crossWidth = armWidthTiles;
    const halfWidth = crossWidth * 0.5;
    const crossLength = armLengthTiles * 2 + armWidthTiles;
    const snappedOriginX = Math.floor(targetX - (armWidthTiles - 1) * 0.5);
    const snappedOriginZ = Math.floor(targetZ - (armWidthTiles - 1) * 0.5);
    const crossCenterX = snappedOriginX + armWidthTiles * 0.5;
    const crossCenterZ = snappedOriginZ + armWidthTiles * 0.5;

    // Find enemies in cross
    const enemies = getAliveUnits(unitsStateRef.current, "enemy");
    const enemiesInCross: { unit: Unit; group: UnitGroup }[] = [];
    for (const enemy of enemies) {
        if (defeatedThisFrame.has(enemy.id)) continue;
        const enemyG = unitsRef.current[enemy.id];
        if (!enemyG) continue;
        if (isPointInCross(enemyG.position.x, enemyG.position.z, crossCenterX, crossCenterZ, armLength, halfWidth)) {
            enemiesInCross.push({ unit: enemy, group: enemyG });
        }
    }

    // Visual: two crossing rectangles centered on the target
    const horizontalMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(crossLength, crossWidth),
        new THREE.MeshBasicMaterial({ color: COLORS.dmgHoly, transparent: true, opacity: 0.62, side: THREE.DoubleSide })
    );
    horizontalMesh.rotation.x = -Math.PI / 2;
    horizontalMesh.position.set(crossCenterX, 0.2, crossCenterZ);
    scene.add(horizontalMesh);

    const verticalMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(crossWidth, crossLength),
        new THREE.MeshBasicMaterial({ color: COLORS.dmgHoly, transparent: true, opacity: 0.62, side: THREE.DoubleSide })
    );
    verticalMesh.rotation.x = -Math.PI / 2;
    verticalMesh.position.set(crossCenterX, 0.2, crossCenterZ);
    scene.add(verticalMesh);

    animateExpandingMesh(scene, horizontalMesh, {
        duration: 320,
        initialOpacity: 0.62,
        maxScale: 1.2,
        baseRadius: 1
    });
    animateExpandingMesh(scene, verticalMesh, {
        duration: 320,
        initialOpacity: 0.62,
        maxScale: 1.2,
        baseRadius: 1
    });

    createAnimatedRing(scene, casterG.position.x, casterG.position.z, COLORS.dmgHoly, {
        innerRadius: 0.2,
        outerRadius: 0.4,
        maxScale: 1.2,
        duration: 250
    });
    createAnimatedRing(scene, crossCenterX, crossCenterZ, COLORS.dmgHoly, {
        innerRadius: 0.25,
        outerRadius: 0.55,
        maxScale: armLength + 0.5,
        duration: 340
    });
    createLightningPillar(scene, crossCenterX, crossCenterZ, {
        color: "#fff4cf",
        duration: 260,
        radius: 0.14,
        height: 6
    });
    soundFns.playHolyStrike();

    // Deal detonation damage
    const dmgCtx: DamageContext = {
        scene, damageTexts: damageTexts.current, hitFlashRef: hitFlashRef.current,
        unitsRef: unitsRef.current, unitsStateRef, setUnits, addLog, now, defeatedThisFrame
    };

    let hitCount = 0;
    let totalDamage = 0;
    let totalCrits = 0;
    const skillLogColor = getSkillTextColor(skill.type, skill.damageType);

    const casterUnit = unitsStateRef.current.find(u => u.id === casterId);
    const statBonus = calculateSkillStatBonusBudget(casterUnit, skill.damageType, skill);

    for (const { unit: target, group: targetG } of enemiesInCross) {
        if (defeatedThisFrame.has(target.id)) continue;
        const targetData = getUnitStats(target);

        if (!rollSkillHit(skill, casterData.accuracy, casterUnit)) continue;

        const { damage: dmg, isCrit } = calculateDamageWithCrit(
            damageRange[0] + statBonus,
            damageRange[1] + statBonus,
            getEffectiveArmor(target, targetData.armor),
            skill.damageType,
            casterUnit
        );

        applyDamageToUnit(dmgCtx, target.id, targetG, dmg, targetData.name, {
            color: COLORS.dmgHoly,
            attackerName: casterData.name,
            targetUnit: target,
            attackerPosition: { x: casterG.position.x, z: casterG.position.z },
            damageType: skill.damageType,
            isCrit
        });

        hitCount++;
        totalDamage += dmg;
        if (isCrit) totalCrits++;
    }

    // Leave smiting ground in a cross pattern
    const armLengthCells = armLengthTiles;
    const armWidthCells = armWidthTiles;
    const tileDuration = skill.duration ?? 12000;
    const tileDamage = Math.max(1, (skill.damagePerTick ?? HOLY_DAMAGE_PER_TICK) + statBonus);
    const tilesTouched = createHolyCross(
        scene,
        holyTilesRef.current,
        crossCenterX,
        crossCenterZ,
        casterId,
        tileDamage,
        now,
        armLengthCells,
        armWidthCells,
        tileDuration
    );

    if (hitCount > 0) {
        const critText = totalCrits > 0 ? ` (${totalCrits} critical!)` : "";
        addLog(logAoeHit(casterData.name, skill.name, hitCount, totalDamage) + critText, skillLogColor);
    } else if (enemiesInCross.length > 0) {
        addLog(logAoeMiss(casterData.name, skill.name), COLORS.logNeutral);
    } else {
        addLog(logCast(casterData.name, skill.name), skillLogColor);
    }

    if (tilesTouched > 0) {
        addLog(`${casterData.name}'s ${skill.name} leaves smiting ground.`, COLORS.holyGroundText);
    }

    return true;
}

// =============================================================================
// FORCE PUSH SKILL (wave damage + knockback + stun chance)
// =============================================================================

/**
 * Execute Force Push — line-wave physical damage that knocks enemies back and may stun.
 */
export function executeForcePushSkill(
    ctx: SkillExecutionContext,
    casterId: number,
    skill: Skill,
    targetX: number,
    targetZ: number
): boolean {
    const { scene, unitsStateRef, unitsRef, setUnits, addLog, hitFlashRef, damageTexts, defeatedThisFrame } = ctx;

    const { damageRange } = skill;
    if (!damageRange) return false;

    const casterG = unitsRef.current[casterId];
    if (!casterG) return false;

    consumeSkill(ctx, casterId, skill);

    const casterData = UNIT_DATA[casterId];
    const now = Date.now();
    const facingAngle = Math.atan2(targetZ - casterG.position.z, targetX - casterG.position.x);
    const length = skill.range;
    const lineWidth = skill.lineWidth ?? 2;
    const halfWidth = lineWidth * 0.5;
    const endX = casterG.position.x + Math.cos(facingAngle) * length;
    const endZ = casterG.position.z + Math.sin(facingAngle) * length;

    const enemies = getAliveUnits(unitsStateRef.current, "enemy");
    const enemiesInWave: { unit: Unit; group: UnitGroup }[] = [];

    for (const enemy of enemies) {
        if (defeatedThisFrame.has(enemy.id)) continue;
        const enemyG = unitsRef.current[enemy.id];
        if (!enemyG) continue;
        if (isPointInRectangle(enemyG.position.x, enemyG.position.z, casterG.position.x, casterG.position.z, facingAngle, length, halfWidth)) {
            enemiesInWave.push({ unit: enemy, group: enemyG });
        }
    }

    // Visual wave
    const waveGeo = new THREE.PlaneGeometry(length, lineWidth);
    waveGeo.translate(length * 0.5, 0, 0);
    const waveMesh = new THREE.Mesh(
        waveGeo,
        new THREE.MeshBasicMaterial({ color: "#cfe8dc", transparent: true, opacity: 0.58, side: THREE.DoubleSide })
    );
    waveMesh.rotation.x = -Math.PI / 2;
    waveMesh.rotation.z = -facingAngle;
    waveMesh.position.set(casterG.position.x, 0.2, casterG.position.z);
    scene.add(waveMesh);

    animateExpandingMesh(scene, waveMesh, {
        duration: 280,
        initialOpacity: 0.58,
        maxScale: 1.2,
        baseRadius: 1
    });
    createAnimatedRing(scene, casterG.position.x, casterG.position.z, "#cfe8dc", {
        innerRadius: 0.2,
        outerRadius: 0.4,
        maxScale: 1.2,
        duration: 220
    });
    createAnimatedRing(scene, endX, endZ, "#cfe8dc", {
        innerRadius: 0.2,
        outerRadius: 0.45,
        maxScale: 1.6,
        duration: 260
    });
    soundFns.playWarcry();

    const dmgCtx: DamageContext = {
        scene, damageTexts: damageTexts.current, hitFlashRef: hitFlashRef.current,
        unitsRef: unitsRef.current, unitsStateRef, setUnits, addLog, now, defeatedThisFrame
    };

    const casterUnit = unitsStateRef.current.find(u => u.id === casterId);
    const statBonus = calculateSkillStatBonusBudget(casterUnit, skill.damageType, skill);
    const skillLogColor = getSkillTextColor(skill.type, skill.damageType);
    const knockbackDistance = skill.knockbackDistance ?? 1.8;
    const stunChance = skill.stunChance ?? 0;
    const stunDuration = skill.duration ?? 1500;

    const knockbackById = new Map<number, { x: number; z: number }>();
    const stunnedIds = new Set<number>();

    let hitCount = 0;
    let totalDamage = 0;
    let totalCrits = 0;
    let pushedCount = 0;

    for (const { unit: target, group: targetG } of enemiesInWave) {
        if (defeatedThisFrame.has(target.id)) continue;
        const targetData = getUnitStats(target);

        if (target.enemyType) {
            const enemyStats = ENEMY_STATS[target.enemyType];
            if (checkEnemyDefenses(
                enemyStats,
                target.facing,
                casterG.position.x,
                casterG.position.z,
                targetG.position.x,
                targetG.position.z
            ) === "frontShield") {
                soundFns.playBlock();
                continue;
            }
        }

        if (!rollSkillHit(skill, casterData.accuracy, casterUnit)) continue;

        const { damage: dmg, isCrit } = calculateDamageWithCrit(
            damageRange[0] + statBonus,
            damageRange[1] + statBonus,
            getEffectiveArmor(target, targetData.armor),
            skill.damageType,
            casterUnit
        );

        applyDamageToUnit(dmgCtx, target.id, targetG, dmg, targetData.name, {
            color: COLORS.damagePlayer,
            attackerName: casterData.name,
            targetUnit: target,
            attackerPosition: { x: casterG.position.x, z: casterG.position.z },
            damageType: skill.damageType,
            isCrit,
            attackerId: casterId,
            isMeleeHit: true
        });

        hitCount++;
        totalDamage += dmg;
        if (isCrit) totalCrits++;

        if (defeatedThisFrame.has(target.id)) continue;

        const awayX = targetG.position.x - casterG.position.x;
        const awayZ = targetG.position.z - casterG.position.z;
        const awayLen = Math.hypot(awayX, awayZ);
        if (awayLen > 0.001) {
            const desiredX = targetG.position.x + (awayX / awayLen) * knockbackDistance;
            const desiredZ = targetG.position.z + (awayZ / awayLen) * knockbackDistance;
            const safePos = findNearestPassable(
                desiredX,
                desiredZ,
                Math.max(1, Math.ceil(knockbackDistance))
            );
            if (safePos) {
                knockbackById.set(target.id, safePos);
                targetG.position.x = safePos.x;
                targetG.position.z = safePos.z;
                targetG.userData.targetX = safePos.x;
                targetG.userData.targetZ = safePos.z;
                pushedCount++;
            }
        }

        if (stunChance > 0 && !hasStatusEffect(target, "stunned") && rollChance(stunChance)) {
            stunnedIds.add(target.id);
            createAnimatedRing(scene, targetG.position.x, targetG.position.z, COLORS.stunnedText, {
                innerRadius: 0.14,
                outerRadius: 0.34,
                maxScale: 1.1,
                duration: 240
            });
        }
    }

    if (knockbackById.size > 0 || stunnedIds.size > 0) {
        setUnits(prev => prev.map(unit => {
            let next = unit;
            const knockback = knockbackById.get(unit.id);
            if (knockback) {
                next = { ...next, x: knockback.x, z: knockback.z };
            }

            if (stunnedIds.has(unit.id) && next.hp > 0) {
                const stunnedEffect: StatusEffect = {
                    type: "stunned",
                    duration: stunDuration,
                    tickInterval: BUFF_TICK_INTERVAL,
                    timeSinceTick: 0,
                    lastUpdateTime: now,
                    damagePerTick: 0,
                    sourceId: casterId
                };
                next = { ...next, statusEffects: applyStatusEffect(next.statusEffects, stunnedEffect) };
            }

            return next;
        }));
    }

    const stunnedCount = stunnedIds.size;
    if (stunnedCount > 0) {
        addLog(`${stunnedCount} foe${stunnedCount === 1 ? "" : "s"} ${stunnedCount === 1 ? "is" : "are"} stunned!`, COLORS.stunnedText);
    }

    if (hitCount > 0) {
        const critText = totalCrits > 0 ? ` (${totalCrits} critical!)` : "";
        addLog(logAoeHit(casterData.name, skill.name, hitCount, totalDamage) + critText, skillLogColor);
    } else if (enemiesInWave.length > 0) {
        addLog(logAoeMiss(casterData.name, skill.name), COLORS.logNeutral);
    } else {
        addLog(logCast(casterData.name, skill.name), skillLogColor);
    }

    if (pushedCount > 0) {
        addLog(`${pushedCount} foe${pushedCount === 1 ? "" : "s"} hurled backward.`, skillLogColor);
    }

    return true;
}

// =============================================================================
// WELL OF GRAVITY SKILL (circular AoE pull + stun)
// =============================================================================

/**
 * Execute Well of Gravity — circular AoE that pulls enemies toward center and may stun.
 */
export function executeWellOfGravitySkill(
    ctx: SkillExecutionContext,
    casterId: number,
    skill: Skill,
    targetX: number,
    targetZ: number
): boolean {
    const { scene, unitsStateRef, unitsRef, setUnits, addLog, hitFlashRef, damageTexts, defeatedThisFrame } = ctx;

    const { damageRange } = skill;
    if (!damageRange) return false;

    const casterG = unitsRef.current[casterId];
    if (!casterG) return false;

    consumeSkill(ctx, casterId, skill);

    const casterData = UNIT_DATA[casterId];
    const now = Date.now();
    const aoeRadius = skill.aoeRadius ?? 3;

    const enemies = getAliveUnits(unitsStateRef.current, "enemy");
    const enemiesInArea: { unit: Unit; group: UnitGroup }[] = [];

    for (const enemy of enemies) {
        if (defeatedThisFrame.has(enemy.id)) continue;
        const enemyG = unitsRef.current[enemy.id];
        if (!enemyG) continue;
        if (isInRange(targetX, targetZ, enemyG.position.x, enemyG.position.z, getUnitRadius(enemy), aoeRadius)) {
            enemiesInArea.push({ unit: enemy, group: enemyG });
        }
    }

    // Visual: dark ring expanding at target point
    createAnimatedRing(scene, targetX, targetZ, "#6633aa", {
        innerRadius: 0.3,
        outerRadius: aoeRadius,
        maxScale: 1.0,
        duration: 400
    });
    createAnimatedRing(scene, targetX, targetZ, "#9966ff", {
        innerRadius: 0.1,
        outerRadius: 0.4,
        maxScale: 1.3,
        duration: 300
    });
    createAnimatedRing(scene, casterG.position.x, casterG.position.z, "#9966ff", {
        innerRadius: 0.15,
        outerRadius: 0.35,
        maxScale: 1.1,
        duration: 220
    });
    soundFns.playWarcry();

    const dmgCtx: DamageContext = {
        scene, damageTexts: damageTexts.current, hitFlashRef: hitFlashRef.current,
        unitsRef: unitsRef.current, unitsStateRef, setUnits, addLog, now, defeatedThisFrame
    };

    const casterUnit = unitsStateRef.current.find(u => u.id === casterId);
    const statBonus = calculateSkillStatBonusBudget(casterUnit, skill.damageType, skill);
    const skillLogColor = getSkillTextColor(skill.type, skill.damageType);
    const pullDist = skill.pullDistance ?? 2.5;
    const stunChance = skill.stunChance ?? 0;
    const stunDuration = skill.duration ?? 2500;

    const pullById = new Map<number, { x: number; z: number }>();
    const stunnedIds = new Set<number>();

    let hitCount = 0;
    let totalDamage = 0;
    let totalCrits = 0;
    let pulledCount = 0;

    for (const { unit: target, group: targetG } of enemiesInArea) {
        if (defeatedThisFrame.has(target.id)) continue;
        const targetData = getUnitStats(target);

        if (target.enemyType) {
            const enemyStats = ENEMY_STATS[target.enemyType];
            if (checkEnemyDefenses(
                enemyStats,
                target.facing,
                casterG.position.x,
                casterG.position.z,
                targetG.position.x,
                targetG.position.z
            ) === "frontShield") {
                soundFns.playBlock();
                continue;
            }
        }

        if (!rollSkillHit(skill, casterData.accuracy, casterUnit)) continue;

        const { damage: dmg, isCrit } = calculateDamageWithCrit(
            damageRange[0] + statBonus,
            damageRange[1] + statBonus,
            getEffectiveArmor(target, targetData.armor),
            skill.damageType,
            casterUnit
        );

        applyDamageToUnit(dmgCtx, target.id, targetG, dmg, targetData.name, {
            color: COLORS.damagePlayer,
            attackerName: casterData.name,
            targetUnit: target,
            attackerPosition: { x: casterG.position.x, z: casterG.position.z },
            damageType: skill.damageType,
            isCrit,
            attackerId: casterId,
            isMeleeHit: false
        });

        hitCount++;
        totalDamage += dmg;
        if (isCrit) totalCrits++;

        if (defeatedThisFrame.has(target.id)) continue;

        // Pull toward AoE center (inverse of knockback)
        const towardX = targetX - targetG.position.x;
        const towardZ = targetZ - targetG.position.z;
        const towardLen = Math.hypot(towardX, towardZ);
        if (towardLen > 0.001) {
            const actualPull = Math.min(pullDist, towardLen);
            const desiredX = targetG.position.x + (towardX / towardLen) * actualPull;
            const desiredZ = targetG.position.z + (towardZ / towardLen) * actualPull;
            const safePos = findNearestPassable(
                desiredX,
                desiredZ,
                Math.max(1, Math.ceil(pullDist))
            );
            if (safePos) {
                pullById.set(target.id, safePos);
                targetG.position.x = safePos.x;
                targetG.position.z = safePos.z;
                targetG.userData.targetX = safePos.x;
                targetG.userData.targetZ = safePos.z;
                pulledCount++;
            }
        }

        if (stunChance > 0 && !hasStatusEffect(target, "stunned") && rollChance(stunChance)) {
            stunnedIds.add(target.id);
            createAnimatedRing(scene, targetG.position.x, targetG.position.z, COLORS.stunnedText, {
                innerRadius: 0.14,
                outerRadius: 0.34,
                maxScale: 1.1,
                duration: 240
            });
        }
    }

    if (pullById.size > 0 || stunnedIds.size > 0) {
        setUnits(prev => prev.map(unit => {
            let next = unit;
            const pull = pullById.get(unit.id);
            if (pull) {
                next = { ...next, x: pull.x, z: pull.z };
            }

            if (stunnedIds.has(unit.id) && next.hp > 0) {
                const stunnedEffect: StatusEffect = {
                    type: "stunned",
                    duration: stunDuration,
                    tickInterval: BUFF_TICK_INTERVAL,
                    timeSinceTick: 0,
                    lastUpdateTime: now,
                    damagePerTick: 0,
                    sourceId: casterId
                };
                next = { ...next, statusEffects: applyStatusEffect(next.statusEffects, stunnedEffect) };
            }

            return next;
        }));
    }

    const stunnedCount = stunnedIds.size;
    if (stunnedCount > 0) {
        addLog(`${stunnedCount} foe${stunnedCount === 1 ? "" : "s"} ${stunnedCount === 1 ? "is" : "are"} stunned!`, COLORS.stunnedText);
    }

    if (hitCount > 0) {
        const critText = totalCrits > 0 ? ` (${totalCrits} critical!)` : "";
        addLog(logAoeHit(casterData.name, skill.name, hitCount, totalDamage) + critText, skillLogColor);
    } else if (enemiesInArea.length > 0) {
        addLog(logAoeMiss(casterData.name, skill.name), COLORS.logNeutral);
    } else {
        addLog(logCast(casterData.name, skill.name), skillLogColor);
    }

    if (pulledCount > 0) {
        addLog(`${pulledCount} foe${pulledCount === 1 ? "" : "s"} dragged inward.`, skillLogColor);
    }

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

    const { damageRange } = skill;
    if (!damageRange) return false;

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
    const skillLogColor = getSkillTextColor(skill.type, skill.damageType);

    const casterUnit = unitsStateRef.current.find(u => u.id === casterId);
    const statBonus = calculateSkillStatBonusBudget(casterUnit, skill.damageType, skill);

    for (const { unit: target, group: tg } of enemiesInLine) {
        if (defeatedThisFrame.has(target.id)) continue;
        const targetData = getUnitStats(target);

        if (rollSkillHit(skill, casterData.accuracy, casterUnit)) {
            const { damage: dmg, isCrit } = calculateDamageWithCrit(
                damageRange[0] + statBonus, damageRange[1] + statBonus,
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
        addLog(logAoeHit(casterData.name, skill.name, hitCount, totalDamage) + critText, skillLogColor);
    } else if (enemiesInLine.length > 0) {
        addLog(logAoeMiss(casterData.name, skill.name), COLORS.logNeutral);
    } else {
        addLog(logCast(casterData.name, skill.name), skillLogColor);
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

    const { damageRange } = skill;
    if (!damageRange) return false;

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
        damage: damageRange,
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

    addLog(logCast(casterData.name, skill.name), getSkillTextColor(skill.type, skill.damageType));
    soundFns.playAttack();

    return true;
}


