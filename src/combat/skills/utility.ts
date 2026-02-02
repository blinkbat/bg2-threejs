// =============================================================================
// UTILITY SKILLS - Taunt, debuff, trap, and ground-targeted skill executors
// =============================================================================

import * as THREE from "three";
import type { Skill, StatusEffect, TrapProjectile } from "../../core/types";
import { COLORS, BUFF_TICK_INTERVAL, TRAP_FLIGHT_DURATION, TRAP_ARC_HEIGHT, TRAP_MESH_SIZE, SANCTUARY_HEAL_PER_TICK } from "../../core/constants";
import { UNIT_DATA, getUnitStats } from "../../game/units";
import { rollChance, rollHit, hasStatusEffect, logTaunt, logTauntMiss, logStunned, logTrapThrown, applyStatusEffect, checkFrontShieldBlock } from "../combatMath";
import { ENEMY_STATS } from "../../game/units";
import { getUnitRadius, isInRange } from "../../rendering/range";
import { getAliveUnits } from "../../game/unitQuery";
import { soundFns } from "../../audio";
import { createAnimatedRing } from "../damageEffects";
import { createSanctuaryTile } from "../../gameLoop/sanctuaryTiles";
import type { SkillExecutionContext } from "./types";
import { findClosestTargetByTeam, consumeSkill } from "./helpers";

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
    const tauntChance = skill.tauntChance ?? 80;  // Taunt chance percentage

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
        if (checkFrontShieldBlock(enemyStats, targetEnemy.facing, casterG.position.x, casterG.position.z, targetG.position.x, targetG.position.z)) {
            soundFns.playBlock();
            addLog(`${casterData.name}'s ${skill.name} is blocked by ${targetData.name}'s shield!`, "#4488ff");
            return true;
        }
    }

    // Roll to hit
    if (rollHit(casterData.accuracy)) {
        // Roll for stun chance
        const stunChance = skill.stunChance ?? 75;
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
        addLog(`${casterData.name}'s ${skill.name} misses ${targetData.name}!`, COLORS.logNeutral);
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

    addLog(logTrapThrown(casterData.name, skill.name), "#888888");
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
