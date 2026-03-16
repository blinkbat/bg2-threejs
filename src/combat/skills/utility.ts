// =============================================================================
// UTILITY SKILLS - Taunt, debuff, trap, and ground-targeted skill executors
// =============================================================================

import * as THREE from "three";
import type { Skill, StatusEffect, TrapProjectile, Unit, UnitGroup } from "../../core/types";
import {
    COLORS,
    BUFF_TICK_INTERVAL,
    DOOM_DURATION,
    TRAP_FLIGHT_DURATION,
    TRAP_ARC_HEIGHT,
    TRAP_MESH_SIZE,
    SANCTUARY_HEAL_PER_TICK,
    DEFAULT_TAUNT_CHANCE,
    DEFAULT_STUN_CHANCE,
    VISHAS_EYES_ORB_COUNT,
    VISHAS_EYES_ORB_DURATION,
    VISHAS_EYES_ORB_FLY_HEIGHT,
    BLOOD_MARK_LIFESTEAL,
    getSkillTextColor
} from "../../core/constants";
import { UNIT_DATA, ANCESTOR_SUMMON_ID, VISHAS_EYE_SUMMON_IDS, getEffectiveMaxHp } from "../../game/playerUnits";
import { getUnitStats } from "../../game/units";
import { rollChance, rollSkillHit, hasStatusEffect, logTaunt, logTauntMiss, logStunned, logTrapThrown, applyStatusEffect, checkEnemyDefenses, calculateStatBonus, getEffectiveArmor, calculateDamageWithCrit, logAoeHit, logAoeMiss, logCast } from "../combatMath";
import { ENEMY_STATS } from "../../game/enemyStats";
import { getUnitRadius, isInRange } from "../../rendering/range";
import { getAliveUnits } from "../../game/unitQuery";
import { soundFns } from "../../audio";
import { createAnimatedRing, applyDamageToUnit, type DamageContext } from "../damageEffects";
import { spawnSwingIndicator } from "../../gameLoop/swingAnimations";
import { createSanctuaryTile } from "../../gameLoop/sanctuaryTiles";
import { createSmokeTile } from "../../gameLoop/smokeTiles";
import { forEachTileInRadius } from "../../gameLoop/tileUtils";
import { findNearestPassable } from "../../ai/pathfinding";
import { getGameTime } from "../../core/gameClock";
import type { SkillExecutionContext } from "./types";
import { findAndValidateEnemyTarget, consumeSkill } from "./helpers";

// =============================================================================
// TAUNT SKILL (Warcry)
// =============================================================================

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
    const tauntChance = skill.tauntChance ?? DEFAULT_TAUNT_CHANCE;

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

    const skillLogColor = getSkillTextColor(skill.type, skill.damageType);
    if (tauntedCount > 0) {
        addLog(logTaunt(casterData.name, skill.name, tauntedCount), skillLogColor);
    } else {
        addLog(logTauntMiss(casterData.name, skill.name), COLORS.logNeutral);
    }

    return true;
}

// =============================================================================
// DEBUFF SKILL (Stunning Blow)
// =============================================================================

/**
 * Execute a debuff skill (like Stunning Blow) - applies a debuff to an enemy
 */
export function executeDebuffSkill(
    ctx: SkillExecutionContext,
    casterId: number,
    skill: Skill,
    targetX: number,
    targetZ: number,
    targetUnitId?: number
): boolean {
    const { scene, unitsRef, hitFlashRef, setUnits, addLog } = ctx;

    let targetEnemy: Unit | undefined;
    let targetG: UnitGroup | undefined;
    if (targetUnitId !== undefined) {
        targetEnemy = ctx.unitsStateRef.current.find(u => u.id === targetUnitId && u.team === "enemy" && u.hp > 0);
        targetG = unitsRef.current[targetUnitId];
        if (!targetEnemy || !targetG) return false;
    } else {
        // Find closest enemy to target position
        const target = findAndValidateEnemyTarget(ctx, casterId, targetX, targetZ);
        if (!target) return false;
        targetEnemy = target.unit;
        targetG = target.group;
    }
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
    createAnimatedRing(scene, casterG.position.x, casterG.position.z, "#9b59b6", {
        innerRadius: 0.14,
        outerRadius: 0.28,
        maxScale: 1.0,
        duration: 180
    });

    const casterData = UNIT_DATA[casterId];
    const skillLogColor = getSkillTextColor(skill.type, skill.damageType);
    const casterUnit = ctx.unitsStateRef.current.find(u => u.id === casterId);
    const targetData = getUnitStats(targetEnemy);
    const targetId = targetEnemy.id;

    // Check for front-shield block (debuffs are non-physical, skip block chance)
    if (targetEnemy.enemyType) {
        const enemyStats = ENEMY_STATS[targetEnemy.enemyType];
        if (checkEnemyDefenses(enemyStats, targetEnemy.facing, casterG.position.x, casterG.position.z, targetG.position.x, targetG.position.z) === "frontShield") {
            soundFns.playBlock();
            addLog(`${casterData.name}'s ${skill.name} is blocked by ${targetData.name}'s shield!`, COLORS.mana);
            createAnimatedRing(scene, targetG.position.x, targetG.position.z, "#4488ff", {
                innerRadius: 0.2,
                outerRadius: 0.4,
                maxScale: 1.2,
                duration: 220
            });
            return true;
        }
    }

    // Roll to hit
    if (rollSkillHit(skill, casterData.accuracy, casterUnit)) {
        // Roll for stun chance
        const stunChance = skill.stunChance ?? DEFAULT_STUN_CHANCE;
        if (rollChance(stunChance)) {
            const stunDuration = skill.duration!;  // Duration in ms

            // Apply stunned effect
            const stunnedEffect: StatusEffect = {
                type: "stunned",
                duration: stunDuration,
                tickInterval: BUFF_TICK_INTERVAL,
                timeSinceTick: 0,
                lastUpdateTime: now,
                damagePerTick: 0,
                sourceId: casterId
            };
            setUnits(prev => prev.map(u =>
                u.id === targetId ? { ...u, statusEffects: applyStatusEffect(u.statusEffects, stunnedEffect) } : u
            ));

            soundFns.playHit();
            addLog(`${casterData.name}'s ${skill.name} hits ${targetData.name}!`, skillLogColor);
            addLog(logStunned(targetData.name), COLORS.stunnedText);
            createAnimatedRing(scene, targetG.position.x, targetG.position.z, "#9b59b6", {
                innerRadius: 0.2,
                outerRadius: 0.45,
                maxScale: 1.4,
                duration: 320
            });

            // Visual effect - purple flash
            const mesh = ctx.unitMeshRef.current[targetId];
            if (targetG && mesh) {
                (mesh.material as THREE.MeshStandardMaterial).color.set("#9b59b6");
                hitFlashRef.current[targetId] = now;
            }
        } else {
            soundFns.playHit();
            addLog(`${casterData.name}'s ${skill.name} hits ${targetData.name}, but they resist the stun!`, skillLogColor);
            createAnimatedRing(scene, targetG.position.x, targetG.position.z, "#bbbbbb", {
                innerRadius: 0.12,
                outerRadius: 0.3,
                maxScale: 1.0,
                duration: 180
            });
        }
    } else {
        soundFns.playMiss();
        addLog(`${casterData.name}'s ${skill.name} misses ${targetData.name}!`, skillLogColor);
    }

    return true;
}

// =============================================================================
// BLOOD MARK SKILL (melee debuff: lifesteal on hit)
// =============================================================================

/**
 * Execute Blood Mark — brand an enemy with a crimson sigil.
 * Melee hits against the marked enemy heal the attacker.
 */
export function executeBloodMarkSkill(
    ctx: SkillExecutionContext,
    casterId: number,
    skill: Skill,
    targetX: number,
    targetZ: number,
    targetUnitId?: number
): boolean {
    const { scene, unitsRef, unitMeshRef, hitFlashRef, setUnits, addLog } = ctx;

    let targetEnemy: Unit | undefined;
    let targetG: UnitGroup | undefined;
    if (targetUnitId !== undefined) {
        targetEnemy = ctx.unitsStateRef.current.find(u => u.id === targetUnitId && u.team === "enemy" && u.hp > 0);
        targetG = unitsRef.current[targetUnitId];
        if (!targetEnemy || !targetG) return false;
    } else {
        const target = findAndValidateEnemyTarget(ctx, casterId, targetX, targetZ);
        if (!target) return false;
        targetEnemy = target.unit;
        targetG = target.group;
    }

    const casterG = unitsRef.current[casterId];
    if (!casterG) return false;

    const targetRadius = getUnitRadius(targetEnemy);
    if (!isInRange(casterG.position.x, casterG.position.z, targetG.position.x, targetG.position.z, targetRadius, skill.range + 0.5)) {
        addLog(`${UNIT_DATA[casterId].name}: Target out of range!`, COLORS.logNeutral);
        return false;
    }

    if (hasStatusEffect(targetEnemy, "blood_marked")) {
        addLog(`${UNIT_DATA[casterId].name}: Target is already marked!`, COLORS.logNeutral);
        return false;
    }

    consumeSkill(ctx, casterId, skill);

    const now = Date.now();
    const casterData = UNIT_DATA[casterId];
    const targetData = getUnitStats(targetEnemy);
    const targetId = targetEnemy.id;

    const bloodMarkEffect: StatusEffect = {
        type: "blood_marked",
        duration: skill.duration!,
        tickInterval: BUFF_TICK_INTERVAL,
        timeSinceTick: 0,
        lastUpdateTime: now,
        damagePerTick: 0,
        sourceId: casterId,
        lifestealPercent: BLOOD_MARK_LIFESTEAL
    };

    setUnits(prev => prev.map(u =>
        u.id === targetId ? { ...u, statusEffects: applyStatusEffect(u.statusEffects, bloodMarkEffect) } : u
    ));

    soundFns.playHit();
    addLog(`${casterData.name} brands ${targetData.name} with ${skill.name}!`, getSkillTextColor(skill.type, skill.damageType));

    // Visual: crimson ring on target
    createAnimatedRing(scene, targetG.position.x, targetG.position.z, COLORS.bloodMarkedText, {
        innerRadius: 0.2,
        outerRadius: 0.45,
        maxScale: 1.4,
        duration: 320
    });
    createAnimatedRing(scene, casterG.position.x, casterG.position.z, COLORS.bloodMarkedText, {
        innerRadius: 0.14,
        outerRadius: 0.28,
        maxScale: 1.0,
        duration: 180
    });

    const mesh = unitMeshRef.current[targetId];
    if (mesh) {
        (mesh.material as THREE.MeshStandardMaterial).color.set(COLORS.bloodMarkedText);
        hitFlashRef.current[targetId] = now;
    }

    return true;
}

// =============================================================================
// TRAP SKILL (Caltrops)
// =============================================================================

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
    const trapMaterial = new THREE.MeshPhongMaterial({
        color: "#8f8f8f",
        emissive: "#2c2c2c",
        emissiveIntensity: 0.32,
        shininess: 70,
        transparent: true,
        opacity: 0.95
    });
    const trapMesh = new THREE.Mesh(trapGeometry, trapMaterial);
    trapMesh.position.set(casterG.position.x, 0.5, casterG.position.z);
    trapMesh.rotation.z = Math.PI * 0.25;
    scene.add(trapMesh);

    // Create trap projectile with arc trajectory (pause-safe timing)
    const trapProjectile: TrapProjectile = {
        type: "trap",
        mesh: trapMesh,
        attackerId: casterId,
        speed: 0,  // Speed not used for arc trajectory
        targetPos: { x: targetX, z: targetZ },
        aoeRadius: skill.aoeRadius ?? 2,
        pinnedDuration: skill.duration!,
        trapDamage: skill.trapDamage,
        startX: casterG.position.x,
        startZ: casterG.position.z,
        elapsedTime: 0,
        lastUpdateTime: now,
        flightDuration: TRAP_FLIGHT_DURATION,
        arcHeight: TRAP_ARC_HEIGHT,
        isLanded: false
    };

    projectilesRef.current.push(trapProjectile);

    createAnimatedRing(scene, casterG.position.x, casterG.position.z, "#888888", {
        innerRadius: 0.16,
        outerRadius: 0.32,
        maxScale: 1.0,
        duration: 180
    });
    createAnimatedRing(scene, targetX, targetZ, COLORS.pinnedText, {
        innerRadius: 0.25,
        outerRadius: 0.45,
        maxScale: skill.aoeRadius ?? 2,
        duration: 420,
        initialOpacity: 0.45
    });

    addLog(logTrapThrown(casterData.name, skill.name), getSkillTextColor(skill.type, skill.damageType));
    soundFns.playAttack();  // Throwing sound

    return true;
}

// =============================================================================
// SANCTUARY SKILL
// =============================================================================

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
    const healPerTick = skill.healPerTick ?? SANCTUARY_HEAL_PER_TICK;

    // Create sanctuary tiles in radius, dispelling acid
    const centerX = Math.floor(targetX);
    const centerZ = Math.floor(targetZ);

    forEachTileInRadius(centerX, centerZ, radius, (x, z) => {
        createSanctuaryTile(
            scene,
            sanctuaryTilesRef.current,
            acidTilesRef.current,
            x, z,
            casterId,
            healPerTick,
            now
        );
    });

    // Create visual ring effect
    createAnimatedRing(scene, casterG.position.x, casterG.position.z, COLORS.sanctuary, {
        innerRadius: 0.2,
        outerRadius: 0.4,
        maxScale: 1.15,
        duration: 260
    });
    createAnimatedRing(scene, targetX, targetZ, COLORS.sanctuary, { maxScale: radius });

    addLog(`${casterData.name} casts ${skill.name}, consecrating the ground!`, getSkillTextColor(skill.type, skill.damageType));
    soundFns.playHeal();  // Holy sound

    return true;
}

// =============================================================================
// SUMMON SKILL (Summon Ancestor)
// =============================================================================

function findAncestorSummon(units: Unit[]): Unit | undefined {
    return units.find(u => u.team === "player" && u.summonType === "ancestor_warrior");
}

function findVishasEyeSummons(units: Unit[]): Unit[] {
    return units.filter(u => u.team === "player" && u.summonType === "vishas_eye_orb");
}

function getAncestorSpawnPosition(casterX: number, casterZ: number): { x: number; z: number } {
    const desiredX = casterX + 1.25;
    const desiredZ = casterZ + 0.6;
    return findNearestPassable(desiredX, desiredZ, 4) ?? { x: casterX, z: casterZ };
}

function getVishasEyeSpawnPositions(casterX: number, casterZ: number): { x: number; z: number }[] {
    const positions: { x: number; z: number }[] = [];
    const baseRadius = 1.35;
    const maxAttempts = 2;

    for (let i = 0; i < VISHAS_EYES_ORB_COUNT; i++) {
        const angle = (Math.PI * 2 * i) / VISHAS_EYES_ORB_COUNT;
        let chosen = { x: casterX, z: casterZ };

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const radius = baseRadius + attempt * 0.7;
            const desiredX = casterX + Math.cos(angle) * radius;
            const desiredZ = casterZ + Math.sin(angle) * radius;
            const candidate = findNearestPassable(desiredX, desiredZ, 4);
            if (candidate) {
                chosen = candidate;
                break;
            }
        }

        positions.push(chosen);
    }

    return positions;
}

function executeVishasEyesSkill(
    ctx: SkillExecutionContext,
    casterId: number,
    skill: Skill
): boolean {
    const { scene, unitsStateRef, unitsRef, setUnits, addLog } = ctx;
    const caster = unitsStateRef.current.find(u => u.id === casterId);
    const casterG = unitsRef.current[casterId];
    if (!caster || !casterG) return false;

    consumeSkill(ctx, casterId, skill);

    const orbLifetime = skill.duration ?? VISHAS_EYES_ORB_DURATION;
    const expireAt = getGameTime() + orbLifetime;
    const spawnPositions = getVishasEyeSpawnPositions(casterG.position.x, casterG.position.z);
    const existingOrbs = findVishasEyeSummons(unitsStateRef.current).filter(o => o.hp > 0);
    const orbMaxHp = getEffectiveMaxHp(VISHAS_EYE_SUMMON_IDS[0]);
    const summonIds = new Set<number>(VISHAS_EYE_SUMMON_IDS);

    const summonedOrbs: Unit[] = VISHAS_EYE_SUMMON_IDS.map((orbId, index) => {
        const spawnPos = spawnPositions[index] ?? { x: casterG.position.x, z: casterG.position.z };
        return {
            id: orbId,
            x: spawnPos.x,
            z: spawnPos.z,
            hp: orbMaxHp,
            mana: 0,
            team: "player",
            target: null,
            aiEnabled: true,
            statusEffects: undefined,
            holdPosition: false,
            summonType: "vishas_eye_orb",
            summonedBy: casterId,
            auraDamageBonus: 0,
            summonExpireAt: expireAt,
            flyHeight: VISHAS_EYES_ORB_FLY_HEIGHT
        };
    });

    setUnits(prev => {
        const withoutStaleOrbs = prev.filter(u => !(u.summonType === "vishas_eye_orb" && !summonIds.has(u.id)));
        const next = [...withoutStaleOrbs];

        for (const orb of summonedOrbs) {
            const existingIndex = next.findIndex(u => u.id === orb.id);
            if (existingIndex >= 0) {
                next[existingIndex] = { ...next[existingIndex], ...orb, id: orb.id };
            } else {
                next.push(orb);
            }
        }

        return next;
    });

    for (const orb of summonedOrbs) {
        const orbGroup = unitsRef.current[orb.id];
        if (!orbGroup) continue;
        orbGroup.visible = true;
        orbGroup.userData.flyHeight = orb.flyHeight ?? orbGroup.userData.flyHeight;
        orbGroup.position.set(orb.x, orbGroup.userData.flyHeight, orb.z);
        orbGroup.userData.targetX = orb.x;
        orbGroup.userData.targetZ = orb.z;
        orbGroup.userData.attackTarget = null;
    }

    createAnimatedRing(scene, casterG.position.x, casterG.position.z, COLORS.dmgHoly, {
        innerRadius: 0.16,
        outerRadius: 0.34,
        maxScale: 1.2,
        duration: 260
    });
    for (const orb of summonedOrbs) {
        createAnimatedRing(scene, orb.x, orb.z, COLORS.dmgHoly, {
            innerRadius: 0.12,
            outerRadius: 0.28,
            maxScale: 1.0,
            duration: 220
        });
    }
    soundFns.playHolyStrike();

    const casterData = UNIT_DATA[casterId];
    addLog(
        existingOrbs.length > 0
            ? `${casterData.name} renews ${skill.name}.`
            : `${casterData.name} summons ${skill.name}.`,
        getSkillTextColor(skill.type, skill.damageType)
    );

    return true;
}

/**
 * Execute Summon Ancestor - replaces any existing ancestor summon.
 */
export function executeSummonSkill(
    ctx: SkillExecutionContext,
    casterId: number,
    skill: Skill
): boolean {
    if (skill.name === "Visha's Eyes") {
        return executeVishasEyesSkill(ctx, casterId, skill);
    }

    const { scene, unitsStateRef, unitsRef, setUnits, addLog } = ctx;
    const caster = unitsStateRef.current.find(u => u.id === casterId);
    const casterG = unitsRef.current[casterId];
    if (!caster || !casterG) return false;

    consumeSkill(ctx, casterId, skill);

    const existingSummon = findAncestorSummon(unitsStateRef.current);
    const summonId = existingSummon?.id ?? ANCESTOR_SUMMON_ID;
    const spawnPos = getAncestorSpawnPosition(casterG.position.x, casterG.position.z);
    const summonHp = getEffectiveMaxHp(ANCESTOR_SUMMON_ID);

    const summonedUnit: Unit = {
        id: summonId,
        x: spawnPos.x,
        z: spawnPos.z,
        hp: summonHp,
        mana: 0,
        team: "player",
        target: null,
        aiEnabled: true,
        statusEffects: undefined,
        holdPosition: false,
        summonType: "ancestor_warrior",
        summonedBy: casterId,
        auraDamageBonus: 0
    };

    setUnits(prev => {
        const currentSummon = findAncestorSummon(prev);
        if (!currentSummon) {
            return [...prev, summonedUnit];
        }
        return prev.map(u => u.id === currentSummon.id
            ? {
                ...u,
                ...summonedUnit,
                id: currentSummon.id
            }
            : u
        );
    });

    const summonGroup = unitsRef.current[summonId];
    if (summonGroup) {
        summonGroup.visible = true;
        summonGroup.position.set(spawnPos.x, summonGroup.userData.flyHeight, spawnPos.z);
        summonGroup.userData.targetX = spawnPos.x;
        summonGroup.userData.targetZ = spawnPos.z;
        summonGroup.userData.attackTarget = null;
    }

    createAnimatedRing(scene, casterG.position.x, casterG.position.z, "#d7c09a", {
        innerRadius: 0.16,
        outerRadius: 0.34,
        maxScale: 1.1,
        duration: 230
    });
    createAnimatedRing(scene, spawnPos.x, spawnPos.z, "#d7c09a", {
        innerRadius: 0.4,
        outerRadius: 0.65,
        maxScale: 1.8
    });
    soundFns.playWarcry();

    const casterData = UNIT_DATA[casterId];
    addLog(
        existingSummon && existingSummon.hp > 0
            ? `${casterData.name} recalls and resummons an Ancestor.`
            : `${casterData.name} summons an Ancestor.`,
        getSkillTextColor(skill.type, skill.damageType)
    );
    return true;
}

// =============================================================================
// TURN UNDEAD SKILL (self-centered holy AoE: fear undead, damage all)
// =============================================================================

/**
 * Execute Turn Undead — holy burst centered on caster.
 * Undead enemies: full damage + feared status effect.
 * Non-undead enemies: half damage, no fear.
 */
export function executeTurnUndeadSkill(
    ctx: SkillExecutionContext,
    casterId: number,
    skill: Skill
): boolean {
    const { scene, unitsStateRef, unitsRef, setUnits, addLog, hitFlashRef, damageTexts, defeatedThisFrame } = ctx;

    const casterG = unitsRef.current[casterId];
    if (!casterG) return false;

    consumeSkill(ctx, casterId, skill);

    const casterData = UNIT_DATA[casterId];
    const now = Date.now();
    const aoeRadius = skill.range;
    const fearDuration = skill.duration ?? 6000;

    const enemies = getAliveUnits(unitsStateRef.current, "enemy");
    const enemiesInArea: { unit: Unit; group: UnitGroup; isUndead: boolean }[] = [];

    for (const enemy of enemies) {
        if (defeatedThisFrame.has(enemy.id)) continue;
        const enemyG = unitsRef.current[enemy.id];
        if (!enemyG) continue;
        if (isInRange(casterG.position.x, casterG.position.z, enemyG.position.x, enemyG.position.z, getUnitRadius(enemy), aoeRadius)) {
            const enemyStats = enemy.enemyType ? ENEMY_STATS[enemy.enemyType] : undefined;
            const isUndead = enemyStats?.monsterType === "undead";
            enemiesInArea.push({ unit: enemy, group: enemyG, isUndead });
        }
    }

    // Visual: holy burst from caster
    createAnimatedRing(scene, casterG.position.x, casterG.position.z, "#ffffaa", {
        innerRadius: 0.3,
        outerRadius: aoeRadius,
        maxScale: 1.0,
        duration: 400
    });
    createAnimatedRing(scene, casterG.position.x, casterG.position.z, "#ffdd66", {
        innerRadius: 0.15,
        outerRadius: 0.5,
        maxScale: 1.5,
        duration: 300
    });
    soundFns.playWarcry();

    const dmgCtx: DamageContext = {
        scene, damageTexts: damageTexts.current, hitFlashRef: hitFlashRef.current,
        unitsRef: unitsRef.current, unitsStateRef, setUnits, addLog, now, defeatedThisFrame
    };

    const casterUnit = unitsStateRef.current.find(u => u.id === casterId);
    const statBonus = calculateStatBonus(casterUnit, skill.damageType);
    const skillLogColor = getSkillTextColor(skill.type, skill.damageType);

    const fearedIds = new Set<number>();
    let hitCount = 0;
    let totalDamage = 0;

    for (const { unit: target, group: targetG, isUndead } of enemiesInArea) {
        if (defeatedThisFrame.has(target.id)) continue;
        const targetData = getUnitStats(target);

        if (!rollSkillHit(skill, casterData.accuracy, casterUnit)) continue;

        const minDmg = skill.damageRange![0] + statBonus;
        const maxDmg = skill.damageRange![1] + statBonus;
        const { damage: dmg, isCrit } = calculateDamageWithCrit(
            isUndead ? minDmg : Math.floor(minDmg / 2),
            isUndead ? maxDmg : Math.floor(maxDmg / 2),
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

        if (defeatedThisFrame.has(target.id)) continue;

        // Undead: apply feared
        if (isUndead && !hasStatusEffect(target, "feared")) {
            fearedIds.add(target.id);
        }
    }

    if (fearedIds.size > 0) {
        setUnits(prev => prev.map(unit => {
            if (!fearedIds.has(unit.id) || unit.hp <= 0) return unit;
            const fearedEffect: StatusEffect = {
                type: "feared",
                duration: fearDuration,
                tickInterval: BUFF_TICK_INTERVAL,
                timeSinceTick: 0,
                lastUpdateTime: now,
                damagePerTick: 0,
                sourceId: casterId,
                fearSourceX: casterG.position.x,
                fearSourceZ: casterG.position.z
            };
            return { ...unit, statusEffects: applyStatusEffect(unit.statusEffects, fearedEffect) };
        }));
    }

    const fearedCount = fearedIds.size;
    if (fearedCount > 0) {
        addLog(`${fearedCount} undead ${fearedCount === 1 ? "flees" : "flee"} in terror!`, skillLogColor);
    }

    if (hitCount > 0) {
        addLog(logAoeHit(casterData.name, skill.name, hitCount, totalDamage), skillLogColor);
    } else if (enemiesInArea.length > 0) {
        addLog(logAoeMiss(casterData.name, skill.name), COLORS.logNeutral);
    } else {
        addLog(logCast(casterData.name, skill.name), skillLogColor);
    }

    return true;
}

// =============================================================================
// ELORA'S GRASP SKILL (ground-targeted AoE: sleep)
// =============================================================================

/**
 * Execute Elora's Grasp — ground-targeted AoE that puts enemies to sleep.
 */
export function executeElorasGraspSkill(
    ctx: SkillExecutionContext,
    casterId: number,
    skill: Skill,
    targetX: number,
    targetZ: number
): boolean {
    const { scene, unitsStateRef, unitsRef, setUnits, addLog, defeatedThisFrame } = ctx;

    const casterG = unitsRef.current[casterId];
    if (!casterG) return false;

    consumeSkill(ctx, casterId, skill);

    const casterData = UNIT_DATA[casterId];
    const now = Date.now();
    const aoeRadius = skill.aoeRadius ?? 2;
    const sleepDuration = skill.duration ?? 8000;
    const sleepChance = skill.stunChance ?? 75;

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

    // Visual: green-gold vine ring
    createAnimatedRing(scene, targetX, targetZ, "#88aa44", {
        innerRadius: 0.3,
        outerRadius: aoeRadius,
        maxScale: 1.0,
        duration: 400
    });
    createAnimatedRing(scene, casterG.position.x, casterG.position.z, "#88aa44", {
        innerRadius: 0.15,
        outerRadius: 0.4,
        maxScale: 1.2,
        duration: 280
    });
    soundFns.playHeal();

    const sleepIds = new Set<number>();

    for (const { unit: target } of enemiesInArea) {
        if (hasStatusEffect(target, "sleep")) continue;
        if (rollChance(sleepChance)) {
            sleepIds.add(target.id);
        }
    }

    if (sleepIds.size > 0) {
        setUnits(prev => prev.map(unit => {
            if (!sleepIds.has(unit.id) || unit.hp <= 0) return unit;
            const sleepEffect: StatusEffect = {
                type: "sleep",
                duration: sleepDuration,
                tickInterval: BUFF_TICK_INTERVAL,
                timeSinceTick: 0,
                lastUpdateTime: now,
                damagePerTick: 0,
                sourceId: casterId
            };
            return { ...unit, statusEffects: applyStatusEffect(unit.statusEffects, sleepEffect) };
        }));
    }

    const skillLogColor = getSkillTextColor(skill.type, skill.damageType);
    if (sleepIds.size > 0) {
        addLog(`${casterData.name}'s ${skill.name} puts ${sleepIds.size} ${sleepIds.size === 1 ? "enemy" : "enemies"} to sleep!`, skillLogColor);
    } else if (enemiesInArea.length > 0) {
        addLog(`${casterData.name}'s ${skill.name} fails to take hold!`, COLORS.logNeutral);
    } else {
        addLog(logCast(casterData.name, skill.name), skillLogColor);
    }

    return true;
}

// =============================================================================
// SMOKE BOMB SKILL (ground-targeted AoE: creates persistent blind tiles)
// =============================================================================

/**
 * Execute Smoke Bomb — throw a smoke bomb that creates persistent smoke tiles.
 * Enemies standing in smoke are periodically blinded.
 */
export function executeSmokeBombSkill(
    ctx: SkillExecutionContext,
    casterId: number,
    skill: Skill,
    targetX: number,
    targetZ: number
): boolean {
    const { scene, unitsRef, smokeTilesRef, addLog } = ctx;

    if (!smokeTilesRef) {
        addLog("Smoke Bomb cannot be cast right now.", COLORS.logWarning);
        return false;
    }

    const casterG = unitsRef.current[casterId];
    if (!casterG) return false;

    consumeSkill(ctx, casterId, skill);

    const casterData = UNIT_DATA[casterId];
    const now = Date.now();
    const radius = skill.aoeRadius ?? 2.5;
    const blindChance = skill.blindChance ?? 70;
    const blindDuration = skill.blindDuration ?? 3000;

    const centerX = Math.floor(targetX);
    const centerZ = Math.floor(targetZ);

    forEachTileInRadius(centerX, centerZ, radius, (x, z) => {
        createSmokeTile(
            scene,
            smokeTilesRef.current,
            x, z,
            casterId,
            blindChance,
            blindDuration,
            now
        );
    });

    // Visual: dark expanding ring
    createAnimatedRing(scene, casterG.position.x, casterG.position.z, "#666677", {
        innerRadius: 0.14,
        outerRadius: 0.3,
        maxScale: 1.0,
        duration: 200
    });
    createAnimatedRing(scene, targetX, targetZ, "#555566", { maxScale: radius, duration: 350 });

    addLog(`${casterData.name} hurls a ${skill.name}!`, getSkillTextColor(skill.type, skill.damageType));
    soundFns.playAttack();

    return true;
}

// =============================================================================
// INTIMIDATE SKILL (AoE fear)
// =============================================================================

/**
 * Execute Intimidate — self-centered AoE that fears nearby enemies.
 */
export function executeIntimidateSkill(
    ctx: SkillExecutionContext,
    casterId: number,
    skill: Skill
): boolean {
    const { scene, unitsStateRef, unitsRef, setUnits, addLog } = ctx;

    const casterG = unitsRef.current[casterId];
    if (!casterG) return false;

    consumeSkill(ctx, casterId, skill);

    const casterData = UNIT_DATA[casterId];
    const now = Date.now();
    const fearDuration = skill.duration ?? 4000;
    const fearRange = skill.range;

    const enemies = getAliveUnits(unitsStateRef.current, "enemy");
    const fearedIds = new Set<number>();

    for (const enemy of enemies) {
        const enemyG = unitsRef.current[enemy.id];
        if (!enemyG) continue;
        const enemyRadius = getUnitRadius(enemy);
        if (!isInRange(casterG.position.x, casterG.position.z, enemyG.position.x, enemyG.position.z, enemyRadius, fearRange)) continue;
        if (hasStatusEffect(enemy, "feared")) continue;
        fearedIds.add(enemy.id);
    }

    if (fearedIds.size > 0) {
        setUnits(prev => prev.map(unit => {
            if (!fearedIds.has(unit.id) || unit.hp <= 0) return unit;
            const fearedEffect: StatusEffect = {
                type: "feared",
                duration: fearDuration,
                tickInterval: BUFF_TICK_INTERVAL,
                timeSinceTick: 0,
                lastUpdateTime: now,
                damagePerTick: 0,
                sourceId: casterId,
                fearSourceX: casterG.position.x,
                fearSourceZ: casterG.position.z
            };
            return { ...unit, statusEffects: applyStatusEffect(unit.statusEffects, fearedEffect) };
        }));
    }

    // Visual: expanding ring from caster
    createAnimatedRing(scene, casterG.position.x, casterG.position.z, COLORS.fearedText, {
        innerRadius: 0.5, outerRadius: 0.7, maxScale: fearRange, duration: 400
    });
    soundFns.playWarcry();

    const skillLogColor = getSkillTextColor(skill.type, skill.damageType);
    if (fearedIds.size > 0) {
        addLog(`${casterData.name}'s ${skill.name} sends ${fearedIds.size} ${fearedIds.size === 1 ? "enemy" : "enemies"} fleeing!`, skillLogColor);
    } else {
        addLog(`${casterData.name}'s ${skill.name} has no effect!`, COLORS.logNeutral);
    }

    return true;
}

// =============================================================================
// FIVE-POINT PALM SKILL (melee debuff: weakened + damage)
// =============================================================================

/**
 * Execute Five-Point Palm — melee strike that deals damage and applies weakened.
 */
export function executeFivePointPalmSkill(
    ctx: SkillExecutionContext,
    casterId: number,
    skill: Skill,
    targetX: number,
    targetZ: number,
    targetUnitId?: number
): boolean {
    const { scene, unitsStateRef, unitsRef, hitFlashRef, damageTexts, setUnits, addLog, defeatedThisFrame, swingAnimationsRef } = ctx;

    let targetEnemy: Unit | undefined;
    let targetG: UnitGroup | undefined;
    if (targetUnitId !== undefined) {
        targetEnemy = unitsStateRef.current.find(u => u.id === targetUnitId && u.team === "enemy" && u.hp > 0);
        targetG = unitsRef.current[targetUnitId];
        if (!targetEnemy || !targetG) return false;
    } else {
        const target = findAndValidateEnemyTarget(ctx, casterId, targetX, targetZ);
        if (!target) return false;
        targetEnemy = target.unit;
        targetG = target.group;
    }

    const casterG = unitsRef.current[casterId];
    if (!casterG) return false;

    const targetRadius = getUnitRadius(targetEnemy);
    if (!isInRange(casterG.position.x, casterG.position.z, targetG.position.x, targetG.position.z, targetRadius, skill.range + 0.5)) {
        addLog(`${UNIT_DATA[casterId].name}: Target out of range!`, COLORS.logNeutral);
        return false;
    }

    const now = Date.now();
    consumeSkill(ctx, casterId, skill);

    const casterData = UNIT_DATA[casterId];
    const casterUnit = unitsStateRef.current.find(u => u.id === casterId);
    const targetData = getUnitStats(targetEnemy);
    const targetId = targetEnemy.id;

    // Swing animation
    spawnSwingIndicator(scene, casterG, targetG, true, swingAnimationsRef.current, now);
    createAnimatedRing(scene, casterG.position.x, casterG.position.z, COLORS.weakenedText, {
        innerRadius: 0.14, outerRadius: 0.28, maxScale: 1.0, duration: 180
    });

    // Defense check
    if (targetEnemy.enemyType) {
        const enemyStats = ENEMY_STATS[targetEnemy.enemyType];
        const defense = checkEnemyDefenses(enemyStats, targetEnemy.facing, casterG.position.x, casterG.position.z, targetG.position.x, targetG.position.z, skill.damageType);
        if (defense !== "none") {
            soundFns.playBlock();
            addLog(defense === "frontShield"
                ? `${casterData.name}'s ${skill.name} is blocked by ${targetData.name}'s shield!`
                : `${targetData.name} blocks ${casterData.name}'s ${skill.name}!`,
                defense === "frontShield" ? COLORS.mana : COLORS.logNeutral);
            return true;
        }
    }

    // Hit resolution
    const skillLogColor = getSkillTextColor(skill.type, skill.damageType);
    if (rollSkillHit(skill, casterData.accuracy, casterUnit)) {
        // Deal damage
        const statBonus = calculateStatBonus(casterUnit, skill.damageType);
        const { damage: dmg, isCrit } = calculateDamageWithCrit(
            skill.damageRange![0] + statBonus, skill.damageRange![1] + statBonus,
            getEffectiveArmor(targetEnemy, targetData.armor), skill.damageType, casterUnit
        );

        const dmgCtx: DamageContext = {
            scene, damageTexts: damageTexts.current, hitFlashRef: hitFlashRef.current,
            unitsRef: unitsRef.current, unitsStateRef, setUnits, addLog, now, defeatedThisFrame
        };

        applyDamageToUnit(dmgCtx, targetId, targetG, dmg, targetData.name, {
            color: COLORS.damagePlayer,
            attackerName: casterData.name,
            targetUnit: targetEnemy,
            attackerPosition: { x: casterG.position.x, z: casterG.position.z },
            damageType: skill.damageType,
            isCrit,
            attackerId: casterId,
            isMeleeHit: true
        });

        soundFns.playHit();
        addLog(`${casterData.name}'s ${skill.name} strikes ${targetData.name} for ${dmg}!${isCrit ? " Critical hit!" : ""}`, skillLogColor);

        // Apply weakened if not already weakened and target survived
        if (!defeatedThisFrame.has(targetId) && !hasStatusEffect(targetEnemy, "weakened")) {
            const weakenedEffect: StatusEffect = {
                type: "weakened",
                duration: skill.duration!,
                tickInterval: BUFF_TICK_INTERVAL,
                timeSinceTick: 0,
                lastUpdateTime: now,
                damagePerTick: 0,
                sourceId: casterId
            };
            setUnits(prev => prev.map(u =>
                u.id === targetId ? { ...u, statusEffects: applyStatusEffect(u.statusEffects, weakenedEffect) } : u
            ));

            addLog(`${targetData.name}'s attacks are weakened!`, COLORS.weakenedText);

            // Visual: brown ring on target
            createAnimatedRing(scene, targetG.position.x, targetG.position.z, COLORS.weakenedText, {
                innerRadius: 0.2, outerRadius: 0.45, maxScale: 1.4, duration: 320
            });

            const mesh = ctx.unitMeshRef.current[targetId];
            if (mesh) {
                (mesh.material as THREE.MeshStandardMaterial).color.set(COLORS.weakenedText);
                hitFlashRef.current[targetId] = now;
            }
        }
    } else {
        soundFns.playMiss();
        addLog(`${casterData.name}'s ${skill.name} misses ${targetData.name}!`, COLORS.logNeutral);
    }

    return true;
}

// =============================================================================
// DIM MAK SKILL (melee cantrip: doom on hit)
// =============================================================================

const DIM_MAK_DOOM_CHANCE = 80; // 80% chance to inflict doom

/**
 * Execute Dim Mak — melee strike with high chance to inflict Doom.
 * Minibosses and bosses are immune to doom.
 */
export function executeDimMakSkill(
    ctx: SkillExecutionContext,
    casterId: number,
    skill: Skill,
    targetX: number,
    targetZ: number,
    targetUnitId?: number
): boolean {
    const { scene, unitsStateRef, unitsRef, hitFlashRef, damageTexts, setUnits, addLog, defeatedThisFrame, swingAnimationsRef } = ctx;

    let targetEnemy: Unit | undefined;
    let targetG: UnitGroup | undefined;
    if (targetUnitId !== undefined) {
        targetEnemy = unitsStateRef.current.find(u => u.id === targetUnitId && u.team === "enemy" && u.hp > 0);
        targetG = unitsRef.current[targetUnitId];
        if (!targetEnemy || !targetG) return false;
    } else {
        const target = findAndValidateEnemyTarget(ctx, casterId, targetX, targetZ);
        if (!target) return false;
        targetEnemy = target.unit;
        targetG = target.group;
    }

    const casterG = unitsRef.current[casterId];
    if (!casterG) return false;

    const targetRadius = getUnitRadius(targetEnemy);
    if (!isInRange(casterG.position.x, casterG.position.z, targetG.position.x, targetG.position.z, targetRadius, skill.range + 0.5)) {
        addLog(`${UNIT_DATA[casterId].name}: Target out of range!`, COLORS.logNeutral);
        return false;
    }

    // Check doom immunity (miniboss/boss)
    const enemyStats = targetEnemy.enemyType ? ENEMY_STATS[targetEnemy.enemyType] : undefined;
    if (enemyStats && (enemyStats.tier === "miniboss" || enemyStats.tier === "boss")) {
        addLog(`${UNIT_DATA[casterId].name}: ${getUnitStats(targetEnemy).name} is immune to Doom!`, COLORS.logNeutral);
        return false;
    }

    const now = Date.now();
    consumeSkill(ctx, casterId, skill);

    const casterData = UNIT_DATA[casterId];
    const casterUnit = unitsStateRef.current.find(u => u.id === casterId);
    const targetData = getUnitStats(targetEnemy);
    const targetId = targetEnemy.id;

    // Swing animation
    spawnSwingIndicator(scene, casterG, targetG, true, swingAnimationsRef.current, now);
    createAnimatedRing(scene, casterG.position.x, casterG.position.z, COLORS.doomText, {
        innerRadius: 0.14, outerRadius: 0.28, maxScale: 1.0, duration: 180
    });

    // Defense check
    if (enemyStats) {
        const defense = checkEnemyDefenses(enemyStats, targetEnemy.facing, casterG.position.x, casterG.position.z, targetG.position.x, targetG.position.z, skill.damageType);
        if (defense !== "none") {
            soundFns.playBlock();
            addLog(defense === "frontShield"
                ? `${casterData.name}'s ${skill.name} is blocked by ${targetData.name}'s shield!`
                : `${targetData.name} blocks ${casterData.name}'s ${skill.name}!`,
                defense === "frontShield" ? COLORS.mana : COLORS.logNeutral);
            return true;
        }
    }

    const skillLogColor = getSkillTextColor(skill.type, skill.damageType);

    if (rollSkillHit(skill, casterData.accuracy, casterUnit)) {
        // Deal minor damage
        const statBonus = calculateStatBonus(casterUnit, skill.damageType);
        const { damage: dmg, isCrit } = calculateDamageWithCrit(
            skill.damageRange![0] + statBonus, skill.damageRange![1] + statBonus,
            getEffectiveArmor(targetEnemy, targetData.armor), skill.damageType, casterUnit
        );

        const dmgCtx: DamageContext = {
            scene, damageTexts: damageTexts.current, hitFlashRef: hitFlashRef.current,
            unitsRef: unitsRef.current, unitsStateRef, setUnits, addLog, now, defeatedThisFrame
        };

        applyDamageToUnit(dmgCtx, targetId, targetG, dmg, targetData.name, {
            color: COLORS.damagePlayer,
            attackerName: casterData.name,
            targetUnit: targetEnemy,
            attackerPosition: { x: casterG.position.x, z: casterG.position.z },
            damageType: skill.damageType,
            isCrit,
            attackerId: casterId,
            isMeleeHit: true
        });

        soundFns.playHit();

        // Roll doom
        if (!defeatedThisFrame.has(targetId) && rollChance(DIM_MAK_DOOM_CHANCE) && !hasStatusEffect(targetEnemy, "doom")) {
            const doomEffect: StatusEffect = {
                type: "doom",
                duration: DOOM_DURATION,
                tickInterval: BUFF_TICK_INTERVAL,
                timeSinceTick: 0,
                lastUpdateTime: now,
                damagePerTick: 0,
                sourceId: casterId
            };
            setUnits(prev => prev.map(u =>
                u.id === targetId ? { ...u, statusEffects: applyStatusEffect(u.statusEffects, doomEffect) } : u
            ));

            addLog(`${casterData.name}'s ${skill.name} marks ${targetData.name} with Doom!`, COLORS.doomText);

            createAnimatedRing(scene, targetG.position.x, targetG.position.z, COLORS.doomText, {
                innerRadius: 0.2, outerRadius: 0.5, maxScale: 1.6, duration: 360
            });

            const mesh = ctx.unitMeshRef.current[targetId];
            if (mesh) {
                (mesh.material as THREE.MeshStandardMaterial).color.set(COLORS.doomText);
                hitFlashRef.current[targetId] = now;
            }
        } else if (!defeatedThisFrame.has(targetId)) {
            addLog(`${casterData.name}'s ${skill.name} strikes ${targetData.name}, but fails to inflict Doom.`, skillLogColor);
        }
    } else {
        soundFns.playMiss();
        addLog(`${casterData.name}'s ${skill.name} misses ${targetData.name}!`, COLORS.logNeutral);
    }

    return true;
}
