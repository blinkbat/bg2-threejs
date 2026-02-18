// =============================================================================
// UTILITY SKILLS - Taunt, debuff, trap, and ground-targeted skill executors
// =============================================================================

import * as THREE from "three";
import type { Skill, StatusEffect, TrapProjectile, Unit, UnitGroup } from "../../core/types";
import {
    COLORS,
    BUFF_TICK_INTERVAL,
    TRAP_FLIGHT_DURATION,
    TRAP_ARC_HEIGHT,
    TRAP_MESH_SIZE,
    SANCTUARY_HEAL_PER_TICK,
    DEFAULT_TAUNT_CHANCE,
    DEFAULT_STUN_CHANCE,
    VISHAS_EYES_ORB_COUNT,
    VISHAS_EYES_ORB_DURATION,
    VISHAS_EYES_ORB_FLY_HEIGHT,
    getSkillTextColor
} from "../../core/constants";
import { UNIT_DATA, ANCESTOR_SUMMON_ID, VISHAS_EYE_SUMMON_IDS, getEffectiveMaxHp } from "../../game/playerUnits";
import { getUnitStats } from "../../game/units";
import { rollChance, rollSkillHit, hasStatusEffect, logTaunt, logTauntMiss, logStunned, logTrapThrown, applyStatusEffect, checkEnemyDefenses } from "../combatMath";
import { ENEMY_STATS } from "../../game/enemyStats";
import { getUnitRadius, isInRange } from "../../rendering/range";
import { getAliveUnits } from "../../game/unitQuery";
import { soundFns } from "../../audio";
import { createAnimatedRing } from "../damageEffects";
import { createSanctuaryTile } from "../../gameLoop/sanctuaryTiles";
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
