// =============================================================================
// DAMAGE SKILLS - Offensive skill executors
// =============================================================================

import * as THREE from "three";
import type { Unit, Skill, UnitGroup, BasicProjectile } from "../../core/types";
import { COLORS, SUN_STANCE_BONUS_DAMAGE, getDamageTypeColor, getSkillTextColor } from "../../core/constants";
import { UNIT_DATA, getEffectiveUnitData } from "../../game/playerUnits";
import { CRIT_MULTIPLIER } from "../../game/statBonuses";
import { getUnitStats, getEnemyUnitStats } from "../../game/units";
import { rollChance, rollDamage, calculateDamageWithCrit, rollSkillHit, getEffectiveArmor, logHit, logMiss, logPoisoned, logBurning, logCast, logAoeHit, calculateSkillStatBonusBudget, checkEnemyDefenses, hasStatusEffect, getDistributedStatBonus, applyArmor } from "../combatMath";
import { getUnitRadius, isInRange } from "../../rendering/range";
import { getAliveUnits } from "../../game/unitQuery";
import { findNearestPassable } from "../../ai/pathfinding";
import { soundFns } from "../../audio";
import { createProjectile, getProjectileSpeed, applyDamageToUnit, createAnimatedRing, createLightningPillar, type DamageContext } from "../damageEffects";
import { spawnSwingIndicator } from "../../gameLoop/swingAnimations";
import { createFireTile } from "../../gameLoop/fireTiles";
import { updateUnitWith } from "../../core/stateUtils";
import { getGameTime } from "../../core/gameClock";
import { scheduleEffectAnimation } from "../../core/effectScheduler";
import type { SkillExecutionContext } from "./types";
import { findAndValidateEnemyTarget, consumeSkill } from "./helpers";

const CHAIN_LIGHTNING_CHAIN_COUNT = 3;
const CHAIN_LIGHTNING_BOUNCE_RANGE = 5.5;
const LIGHTNING_BEAM_UP = new THREE.Vector3(0, 1, 0);

function createLightningBeam(
    scene: THREE.Scene,
    fromX: number,
    fromZ: number,
    toX: number,
    toZ: number,
    duration: number = 280
): void {
    const from = new THREE.Vector3(fromX, 0.85, fromZ);
    const to = new THREE.Vector3(toX, 0.85, toZ);
    const direction = new THREE.Vector3().subVectors(to, from);
    const beamLength = direction.length();
    if (beamLength < 0.05) return;

    direction.normalize();

    const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.055, 0.055, beamLength, 10, 1, true),
        new THREE.MeshBasicMaterial({ color: "#d9f2ff", transparent: true, opacity: 0.9 })
    );
    beam.position.copy(from).add(to).multiplyScalar(0.5);
    beam.quaternion.setFromUnitVectors(LIGHTNING_BEAM_UP, direction);
    scene.add(beam);

    const startTime = getGameTime();
    const material = beam.material as THREE.MeshBasicMaterial;

    scheduleEffectAnimation((gameNow) => {
        const elapsed = gameNow - startTime;
        const t = Math.min(1, elapsed / duration);

        material.opacity = 0.9 * (1 - t);
        const pulseScale = 1 + Math.sin(t * Math.PI) * 0.4;
        beam.scale.set(pulseScale, 1, pulseScale);

        if (t < 1) return false;

        scene.remove(beam);
        beam.geometry.dispose();
        material.dispose();
        return true;
    });
}

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

    const { aoeRadius, damageRange } = skill;
    if (!aoeRadius || !damageRange) return;

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
        aoeRadius,
        damage: damageRange,
        damageType: skill.damageType,
        targetPos: { x: targetX, z: targetZ }
    });

    addLog(logCast(UNIT_DATA[casterId].name, skill.name), getSkillTextColor(skill.type, skill.damageType));
    soundFns.playFireball();
}

// =============================================================================
// DELIVERY TYPES FOR TARGETED DAMAGE SKILLS
// =============================================================================

type DamageDelivery =
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
function executeTargetedDamageSkill(
    ctx: SkillExecutionContext,
    casterId: number,
    skill: Skill,
    targetX: number,
    targetZ: number,
    delivery: DamageDelivery,
    targetUnitId?: number
): boolean {
    const { scene, unitsStateRef, unitsRef, hitFlashRef, damageTexts, setUnits, addLog, defeatedThisFrame, swingAnimationsRef, projectilesRef } = ctx;

    const { damageRange } = skill;
    if (!damageRange) return false;

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
    const casterUnit = unitsStateRef.current.find(u => u.id === casterId);

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

        // Route all ranged attacks through the same runtime damage pipeline so
        // equipment/attribute scaling stays consistent (including basic attacks).
        if (skill.damageRange) {
            basicProjectile.skillName = skill.name;
            basicProjectile.skillDamage = skill.damageRange;
            basicProjectile.skillDamageType = skill.damageType;
            if (skill.hitChance !== undefined) {
                basicProjectile.skillHitChanceOverride = skill.hitChance;
            }
            if (skill.critChanceOverride !== undefined) {
                basicProjectile.skillCritChanceOverride = skill.critChanceOverride;
            }
            if (skill.onHitEffect) {
                basicProjectile.skillOnHitEffect = skill.onHitEffect;
            }
            if (skill.burnChance) {
                basicProjectile.skillBurnChance = skill.burnChance;
                basicProjectile.skillBurnDamagePerTick = skill.burnDamagePerTick;
                basicProjectile.skillBurnDuration = skill.burnDuration;
            }
        }

        projectilesRef.current.push(basicProjectile);
        soundFns.playAttack();
        return true;
    }

    // Melee: swing animation
    if (delivery.mode === "melee") {
        spawnSwingIndicator(scene, casterG, targetG, true, swingAnimationsRef.current, getGameTime());
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
        const enemyStats = getEnemyUnitStats(targetEnemy);
        if (delivery.mode === "melee") {
            // Full defense check: front shield + block chance
            const defense = checkEnemyDefenses(enemyStats, targetEnemy.facing, casterG.position.x, casterG.position.z, targetG.position.x, targetG.position.z, skill.damageType);
            if (defense !== "none") {
                soundFns.playBlock();
                addLog(defense === "frontShield"
                    ? `${casterData.name}'s ${skill.name} is blocked by ${targetData.name}'s shield!`
                    : `${targetData.name} blocks ${casterData.name}'s ${skill.name}!`,
                    defense === "frontShield" ? COLORS.mana : COLORS.logNeutral);
                return true;
            }
        } else {
            // Smite: front-shield only (non-physical, skip block chance)
            const defense = checkEnemyDefenses(enemyStats, targetEnemy.facing, casterG.position.x, casterG.position.z, targetG.position.x, targetG.position.z);
            if (defense === "frontShield") {
                soundFns.playBlock();
                addLog(`${casterData.name}'s ${skill.name} is blocked by ${targetData.name}'s shield!`, COLORS.mana);
                return true;
            }
        }
    }

    // --- Phase 6: Hit resolution ---
    if (rollSkillHit(skill, casterData.accuracy, casterUnit)) {
        const statBonus = calculateSkillStatBonusBudget(casterUnit, skill.damageType, skill);
        const { damage: dmg, isCrit } = calculateDamageWithCrit(
            damageRange[0] + statBonus, damageRange[1] + statBonus,
            getEffectiveArmor(targetEnemy, targetData.armor), skill.damageType, casterUnit
        );
        const willPoison = delivery.mode === "melee" && skill.poisonChance ? rollChance(skill.poisonChance) : false;
        const willBurn = skill.burnChance ? rollChance(skill.burnChance) : false;
        const damageColor = getDamageTypeColor(skill.damageType);

        const dmgCtx: DamageContext = {
            scene, damageTexts: damageTexts.current, hitFlashRef: hitFlashRef.current,
            unitsRef: unitsRef.current, unitsStateRef, setUnits, addLog, now, defeatedThisFrame
        };
        applyDamageToUnit(dmgCtx, targetId, targetG, dmg, targetData.name, {
            color: damageColor,
            poison: willPoison ? { sourceId: casterId } : undefined,
            burn: willBurn ? { sourceId: casterId, damagePerTick: skill.burnDamagePerTick, duration: skill.burnDuration } : undefined,
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
        if (willBurn) {
            const updatedTarget = unitsStateRef.current.find(u => u.id === targetId);
            if (updatedTarget?.statusEffects?.some(effect => effect.type === "burn")) {
                createAnimatedRing(scene, targetG.position.x, targetG.position.z, COLORS.burnText, {
                    innerRadius: 0.16,
                    outerRadius: 0.34,
                    maxScale: 1.25,
                    duration: 260
                });
                addLog(logBurning(targetData.name), COLORS.burnText);
            }
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

/**
 * Execute Chain Lightning - heavy initial lightning hit that bounces to up to 3 additional nearby enemies.
 */
export function executeChainLightningSkill(
    ctx: SkillExecutionContext,
    casterId: number,
    skill: Skill,
    targetX: number,
    targetZ: number,
    targetUnitId?: number
): boolean {
    const { scene, unitsStateRef, unitsRef, setUnits, addLog, hitFlashRef, damageTexts, defeatedThisFrame } = ctx;

    const { damageRange } = skill;
    if (!damageRange) return false;

    let primaryTarget: Unit | undefined;
    let primaryGroup: UnitGroup | undefined;
    if (targetUnitId !== undefined) {
        primaryTarget = unitsStateRef.current.find(u => u.id === targetUnitId && u.team === "enemy" && u.hp > 0);
        primaryGroup = unitsRef.current[targetUnitId];
        if (!primaryTarget || !primaryGroup) return false;
    } else {
        const closest = findAndValidateEnemyTarget(ctx, casterId, targetX, targetZ);
        if (!closest) return false;
        primaryTarget = closest.unit;
        primaryGroup = closest.group;
    }

    const casterG = unitsRef.current[casterId];
    if (!casterG) return false;

    const primaryRadius = getUnitRadius(primaryTarget);
    if (!isInRange(casterG.position.x, casterG.position.z, primaryGroup.position.x, primaryGroup.position.z, primaryRadius, skill.range + 0.5)) {
        addLog(`${UNIT_DATA[casterId].name}: Target out of range!`, COLORS.logNeutral);
        return false;
    }

    consumeSkill(ctx, casterId, skill);

    const casterData = UNIT_DATA[casterId];
    const now = Date.now();
    const dmgCtx: DamageContext = {
        scene, damageTexts: damageTexts.current, hitFlashRef: hitFlashRef.current,
        unitsRef: unitsRef.current, unitsStateRef, setUnits, addLog, now, defeatedThisFrame
    };

    const casterUnit = unitsStateRef.current.find(u => u.id === casterId);
    const totalStatBonus = calculateSkillStatBonusBudget(casterUnit, skill.damageType, skill);
    const skillLogColor = getSkillTextColor(skill.type, skill.damageType);
    const struckIds = new Set<number>();

    let sourceX = casterG.position.x;
    let sourceZ = casterG.position.z;
    let currentTarget: Unit | undefined = primaryTarget;
    let currentGroup: UnitGroup | undefined = primaryGroup;
    let currentBaseDamage = 0;
    let currentDamage = 0;

    let hitCount = 0;
    let totalDamage = 0;
    let crits = 0;

    for (let chainIndex = 0; chainIndex <= CHAIN_LIGHTNING_CHAIN_COUNT; chainIndex++) {
        if (!currentTarget || !currentGroup) break;
        if (defeatedThisFrame.has(currentTarget.id)) break;

        const targetData = getUnitStats(currentTarget);
        createLightningBeam(scene, sourceX, sourceZ, currentGroup.position.x, currentGroup.position.z, chainIndex === 0 ? 300 : 240);
        createAnimatedRing(scene, currentGroup.position.x, currentGroup.position.z, COLORS.dmgLightning, {
            innerRadius: 0.16,
            outerRadius: 0.38,
            maxScale: 1.5,
            duration: 260
        });

        if (chainIndex === 0) {
            if (!rollSkillHit(skill, casterData.accuracy, casterUnit)) {
                addLog(logMiss(casterData.name, skill.name, targetData.name), COLORS.logNeutral);
                return true;
            }
            const initialStatBonus = getDistributedStatBonus(totalStatBonus, chainIndex, CHAIN_LIGHTNING_CHAIN_COUNT + 1);
            const armor = getEffectiveArmor(currentTarget, targetData.armor);
            const rawDamage = rollDamage(damageRange[0], damageRange[1]);
            const result = calculateDamageWithCrit(
                rawDamage + initialStatBonus,
                rawDamage + initialStatBonus,
                armor,
                skill.damageType,
                casterUnit
            );
            currentBaseDamage = applyArmor(
                result.isCrit ? Math.floor(rawDamage * CRIT_MULTIPLIER) : rawDamage,
                armor,
                skill.damageType
            );
            currentDamage = result.damage;
            if (result.isCrit) crits++;
        } else {
            const bounceStatBonus = getDistributedStatBonus(totalStatBonus, chainIndex, CHAIN_LIGHTNING_CHAIN_COUNT + 1);
            currentBaseDamage = Math.max(1, Math.floor(currentBaseDamage * 0.5));
            currentDamage = currentBaseDamage + bounceStatBonus;
        }

        applyDamageToUnit(dmgCtx, currentTarget.id, currentGroup, currentDamage, targetData.name, {
            color: COLORS.dmgLightning,
            attackerName: casterData.name,
            targetUnit: currentTarget,
            attackerPosition: { x: sourceX, z: sourceZ },
            damageType: skill.damageType
        });
        struckIds.add(currentTarget.id);
        hitCount++;
        totalDamage += currentDamage;

        sourceX = currentGroup.position.x;
        sourceZ = currentGroup.position.z;

        if (chainIndex >= CHAIN_LIGHTNING_CHAIN_COUNT) break;
        if (currentDamage <= 1) break;

        let nextTarget: Unit | undefined;
        let nextGroup: UnitGroup | undefined;
        let bestDist = Infinity;

        for (const candidate of unitsStateRef.current) {
            if (candidate.team !== "enemy" || candidate.hp <= 0) continue;
            if (struckIds.has(candidate.id) || defeatedThisFrame.has(candidate.id)) continue;

            const candidateGroup = unitsRef.current[candidate.id];
            if (!candidateGroup) continue;

            const candidateRadius = getUnitRadius(candidate);
            if (!isInRange(
                sourceX,
                sourceZ,
                candidateGroup.position.x,
                candidateGroup.position.z,
                candidateRadius,
                CHAIN_LIGHTNING_BOUNCE_RANGE
            )) {
                continue;
            }

            const dist = Math.hypot(candidateGroup.position.x - sourceX, candidateGroup.position.z - sourceZ);
            if (dist < bestDist) {
                bestDist = dist;
                nextTarget = candidate;
                nextGroup = candidateGroup;
            }
        }

        currentTarget = nextTarget;
        currentGroup = nextGroup;
    }

    soundFns.playThunder();

    if (hitCount > 0) {
        const critText = crits > 0 ? ` (${crits} critical!)` : "";
        addLog(`${casterData.name}'s ${skill.name} chains through ${hitCount} foe${hitCount === 1 ? "" : "s"} for ${totalDamage} damage${critText}.`, skillLogColor);
    } else {
        addLog(logCast(casterData.name, skill.name), skillLogColor);
    }

    return true;
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

export {
    executeFlurrySkill,
    executeMagicWaveSkill,
    executeHolyCrossSkill,
    executeForcePushSkill,
    executeWellOfGravitySkill,
    executeHolyStrikeSkill,
    executeGlacialWhorlSkill,
} from "./damageArea";

// =============================================================================
// CLEAVE SKILL (frontal arc melee AoE)
// =============================================================================

/**
 * Execute Cleave — melee frontal arc that hits all enemies in a cone in front of the caster.
 * Uses the caster's current facing (toward their attack target or last movement direction).
 */
export function executeCleaveSkill(
    ctx: SkillExecutionContext,
    casterId: number,
    skill: Skill
): boolean {
    const { scene, unitsStateRef, unitsRef, hitFlashRef, damageTexts, setUnits, addLog, defeatedThisFrame, swingAnimationsRef } = ctx;

    const { damageRange } = skill;
    if (!damageRange) return false;

    const casterG = unitsRef.current[casterId];
    if (!casterG) return false;
    const casterUnit = unitsStateRef.current.find(u => u.id === casterId);

    // Find all enemies within melee arc range
    const enemies = getAliveUnits(unitsStateRef.current, "enemy");
    const cleaveRange = skill.range;

    // Get facing direction: toward current target or last movement direction
    const target = casterUnit?.target;
    let facingX = 0;
    let facingZ = -1;
    if (target !== null && target !== undefined) {
        const targetG = unitsRef.current[target];
        if (targetG) {
            facingX = targetG.position.x - casterG.position.x;
            facingZ = targetG.position.z - casterG.position.z;
            const len = Math.hypot(facingX, facingZ);
            if (len > 0) { facingX /= len; facingZ /= len; }
        }
    }

    const coneHalfAngle = Math.PI * 0.55; // ~100° half-angle = 200° total arc
    const enemiesInArc: { unit: Unit; group: UnitGroup }[] = [];

    for (const enemy of enemies) {
        if (defeatedThisFrame.has(enemy.id)) continue;
        const enemyG = unitsRef.current[enemy.id];
        if (!enemyG) continue;
        const enemyRadius = getUnitRadius(enemy);
        if (!isInRange(casterG.position.x, casterG.position.z, enemyG.position.x, enemyG.position.z, enemyRadius, cleaveRange)) continue;

        // Check angle
        const dx = enemyG.position.x - casterG.position.x;
        const dz = enemyG.position.z - casterG.position.z;
        const dot = facingX * dx + facingZ * dz;
        const dist = Math.hypot(dx, dz);
        if (dist === 0 || Math.acos(Math.min(1, Math.max(-1, dot / dist))) <= coneHalfAngle) {
            enemiesInArc.push({ unit: enemy, group: enemyG });
        }
    }

    if (enemiesInArc.length === 0) {
        addLog(`${UNIT_DATA[casterId].name}: No enemies in range!`, COLORS.logNeutral);
        return false;
    }

    consumeSkill(ctx, casterId, skill);

    const casterData = UNIT_DATA[casterId];
    const now = Date.now();
    const statBonus = calculateSkillStatBonusBudget(casterUnit, skill.damageType, skill);

    const dmgCtx: DamageContext = {
        scene, damageTexts: damageTexts.current, hitFlashRef: hitFlashRef.current,
        unitsRef: unitsRef.current, unitsStateRef, setUnits, addLog, now, defeatedThisFrame
    };

    let hitCount = 0;
    let missCount = 0;
    let totalDamage = 0;

    // Swing animation toward first enemy
    if (enemiesInArc.length > 0) {
        spawnSwingIndicator(scene, casterG, enemiesInArc[0].group, true, swingAnimationsRef.current, getGameTime());
    }

    for (const { unit: enemy, group: enemyG } of enemiesInArc) {
        if (defeatedThisFrame.has(enemy.id)) continue;
        const targetData = getUnitStats(enemy);

        if (!rollSkillHit(skill, casterData.accuracy, casterUnit)) {
            missCount++;
            continue;
        }

        const { damage: dmg, isCrit } = calculateDamageWithCrit(
            damageRange[0] + statBonus, damageRange[1] + statBonus,
            getEffectiveArmor(enemy, targetData.armor), skill.damageType, casterUnit
        );

        applyDamageToUnit(dmgCtx, enemy.id, enemyG, dmg, targetData.name, {
            color: COLORS.damagePlayer,
            attackerName: casterData.name,
            targetUnit: enemy,
            attackerPosition: { x: casterG.position.x, z: casterG.position.z },
            damageType: skill.damageType,
            isCrit,
            attackerId: casterId,
            isMeleeHit: true
        });

        hitCount++;
        totalDamage += dmg;
    }

    // Visual: wide arc ring
    createAnimatedRing(scene, casterG.position.x, casterG.position.z, COLORS.damagePlayer, {
        innerRadius: 0.4,
        outerRadius: cleaveRange,
        maxScale: 1.0,
        duration: 300
    });
    soundFns.playHit();

    const skillLogColor = getSkillTextColor(skill.type, skill.damageType);
    if (hitCount > 0) {
        addLog(logAoeHit(casterData.name, skill.name, hitCount, totalDamage), skillLogColor);
    }
    if (missCount > 0) {
        addLog(`${casterData.name}'s ${skill.name} misses ${missCount} target${missCount > 1 ? "s" : ""}.`, COLORS.logNeutral);
    }

    return true;
}

// =============================================================================
// SMITE STRIKE SKILL (melee holy damage, bonus vs undead/demon)
// =============================================================================

/**
 * Execute Smite — melee strike that deals bonus damage to undead and demon enemies.
 * Wraps the standard melee pipeline with a follow-up bonus holy hit.
 */
export function executeSmiteStrikeSkill(
    ctx: SkillExecutionContext,
    casterId: number,
    skill: Skill,
    targetX: number,
    targetZ: number,
    targetUnitId?: number
): boolean {
    const { scene, unitsStateRef, unitsRef, hitFlashRef, damageTexts, setUnits, addLog, defeatedThisFrame, swingAnimationsRef } = ctx;

    const { damageRange } = skill;
    if (!damageRange) return false;

    // --- Find target ---
    let targetEnemy: Unit | undefined;
    let targetG: UnitGroup | undefined;

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

    const targetRadius = getUnitRadius(targetEnemy);
    if (!isInRange(casterG.position.x, casterG.position.z, targetG.position.x, targetG.position.z, targetRadius, skill.range + 0.5)) {
        addLog(`${UNIT_DATA[casterId].name}: Target out of range!`, COLORS.logNeutral);
        return false;
    }

    const now = Date.now();
    consumeSkill(ctx, casterId, skill);

    const casterData = UNIT_DATA[casterId];
    const targetData = getUnitStats(targetEnemy);
    const casterUnit = unitsStateRef.current.find(u => u.id === casterId);
    const targetId = targetEnemy.id;

    // Swing animation
    spawnSwingIndicator(scene, casterG, targetG, true, swingAnimationsRef.current, getGameTime());
    createAnimatedRing(scene, casterG.position.x, casterG.position.z, COLORS.dmgHoly, {
        innerRadius: 0.14,
        outerRadius: 0.3,
        maxScale: 1.0,
        duration: 180
    });

    // Defense check
    if (targetEnemy.enemyType) {
        const enemyStats = getEnemyUnitStats(targetEnemy);
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
    if (rollSkillHit(skill, casterData.accuracy, casterUnit)) {
        const statBonus = calculateSkillStatBonusBudget(casterUnit, skill.damageType, skill);

        // Check if target is undead or demon for bonus damage
        const enemyStats = targetEnemy.enemyType ? getEnemyUnitStats(targetEnemy) : undefined;
        const isBonusTarget = enemyStats?.monsterType === "undead" || enemyStats?.monsterType === "demon";
        const bonusMultiplier = isBonusTarget ? 1.5 : 1.0;

        const minDmg = Math.floor((damageRange[0] + statBonus) * bonusMultiplier);
        const maxDmg = Math.floor((damageRange[1] + statBonus) * bonusMultiplier);

        const { damage: dmg, isCrit } = calculateDamageWithCrit(
            minDmg, maxDmg,
            getEffectiveArmor(targetEnemy, targetData.armor), skill.damageType, casterUnit
        );

        const dmgCtx: DamageContext = {
            scene, damageTexts: damageTexts.current, hitFlashRef: hitFlashRef.current,
            unitsRef: unitsRef.current, unitsStateRef, setUnits, addLog, now, defeatedThisFrame
        };

        const hitMsg = isBonusTarget
            ? `${casterData.name}'s ${skill.name} sears ${targetData.name} for ${dmg}!${isCrit ? " Critical hit!" : ""}`
            : logHit(casterData.name, skill.name, targetData.name, dmg) + (isCrit ? " Critical hit!" : "");

        applyDamageToUnit(dmgCtx, targetId, targetG, dmg, targetData.name, {
            color: COLORS.dmgHoly,
            attackerName: casterData.name,
            hitMessage: { text: hitMsg, color: isCrit ? COLORS.damageCrit : COLORS.dmgHoly },
            targetUnit: targetEnemy,
            attackerPosition: { x: casterG.position.x, z: casterG.position.z },
            damageType: skill.damageType,
            isCrit,
            attackerId: casterId,
            isMeleeHit: true
        });

        // Holy flash on target
        createAnimatedRing(scene, targetG.position.x, targetG.position.z, COLORS.dmgHoly, {
            innerRadius: 0.2,
            outerRadius: 0.45,
            maxScale: isBonusTarget ? 1.8 : 1.3,
            duration: isBonusTarget ? 350 : 260
        });

        soundFns.playHit();
    } else {
        soundFns.playMiss();
        addLog(logMiss(casterData.name, skill.name, targetData.name), COLORS.logNeutral);
    }

    return true;
}

// =============================================================================
// LEAP STRIKE SKILL (Flying Kick - dash to enemy + damage)
// =============================================================================

/**
 * Execute Flying Kick — leap to a distant enemy, striking on arrival.
 */
export function executeLeapStrikeSkill(
    ctx: SkillExecutionContext,
    casterId: number,
    skill: Skill,
    targetX: number,
    targetZ: number,
    targetUnitId?: number
): boolean {
    const { scene, unitsStateRef, unitsRef, hitFlashRef, damageTexts, setUnits, addLog, defeatedThisFrame, swingAnimationsRef } = ctx;

    const { damageRange } = skill;
    if (!damageRange) return false;

    // --- Find target ---
    let targetEnemy: Unit | undefined;
    let targetG: UnitGroup | undefined;

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

    const targetRadius = getUnitRadius(targetEnemy);
    if (!isInRange(casterG.position.x, casterG.position.z, targetG.position.x, targetG.position.z, targetRadius, skill.range + 0.5)) {
        addLog(`${UNIT_DATA[casterId].name}: Target out of range!`, COLORS.logNeutral);
        return false;
    }

    const originX = casterG.position.x;
    const originZ = casterG.position.z;

    consumeSkill(ctx, casterId, skill);

    const casterData = UNIT_DATA[casterId];
    const targetData = getUnitStats(targetEnemy);
    const casterUnit = unitsStateRef.current.find(u => u.id === casterId);
    const targetId = targetEnemy.id;
    const now = Date.now();

    // Move caster to melee range of target
    const dx = targetG.position.x - originX;
    const dz = targetG.position.z - originZ;
    const dist = Math.hypot(dx, dz);
    const landingOffset = 1.4; // Land just outside melee range
    const landX = dist > landingOffset ? targetG.position.x - (dx / dist) * landingOffset : originX;
    const landZ = dist > landingOffset ? targetG.position.z - (dz / dist) * landingOffset : originZ;

    // Find nearest passable cell at landing position
    const passableLanding = findNearestPassable(landX, landZ, 3);
    const finalX = passableLanding?.x ?? landX;
    const finalZ = passableLanding?.z ?? landZ;

    // Update logical position
    updateUnitWith(setUnits, casterId, () => ({ x: finalX, z: finalZ }));

    // Set 3D position
    casterG.userData.targetX = finalX;
    casterG.userData.targetZ = finalZ;
    casterG.userData.attackTarget = targetId;

    // Animate dash
    const flyHeight = casterG.userData.flyHeight ?? 0;
    const startTime = getGameTime();
    const dashDuration = 250;

    scheduleEffectAnimation((gameNow: number) => {
        const elapsed = gameNow - startTime;
        const t = Math.min(1, elapsed / dashDuration);
        const eased = 1 - (1 - t) * (1 - t);

        const x = originX + (finalX - originX) * eased;
        const z = originZ + (finalZ - originZ) * eased;
        // Arc height during leap
        const arcHeight = Math.sin(t * Math.PI) * 1.5;
        casterG.position.set(x, flyHeight + arcHeight, z);

        if (t < 1) return false;
        casterG.position.set(finalX, flyHeight, finalZ);
        return true;
    });

    // Trail rings along path
    for (let i = 1; i <= 3; i++) {
        const frac = i / 4;
        createAnimatedRing(scene, originX + (finalX - originX) * frac, originZ + (finalZ - originZ) * frac, "#ff9933", {
            innerRadius: 0.1, outerRadius: 0.25, maxScale: 1.0, duration: 200
        });
    }

    // Landing ring
    createAnimatedRing(scene, finalX, finalZ, "#ff6600", {
        innerRadius: 0.3, outerRadius: 0.6, maxScale: 1.5, duration: 300
    });

    // Swing animation
    spawnSwingIndicator(scene, casterG, targetG, true, swingAnimationsRef.current, getGameTime());

    // Hit resolution
    if (rollSkillHit(skill, casterData.accuracy, casterUnit)) {
        const statBonus = calculateSkillStatBonusBudget(casterUnit, skill.damageType, skill);
        const { damage: dmg, isCrit } = calculateDamageWithCrit(
            damageRange[0] + statBonus, damageRange[1] + statBonus,
            getEffectiveArmor(targetEnemy, targetData.armor), skill.damageType, casterUnit
        );

        const dmgCtx: DamageContext = {
            scene, damageTexts: damageTexts.current, hitFlashRef: hitFlashRef.current,
            unitsRef: unitsRef.current, unitsStateRef, setUnits, addLog, now, defeatedThisFrame
        };

        applyDamageToUnit(dmgCtx, targetId, targetG, dmg, targetData.name, {
            color: COLORS.damagePlayer,
            attackerName: casterData.name,
            hitMessage: { text: logHit(casterData.name, skill.name, targetData.name, dmg) + (isCrit ? " Critical hit!" : ""), color: isCrit ? COLORS.damageCrit : COLORS.damagePlayer },
            targetUnit: targetEnemy,
            attackerPosition: { x: finalX, z: finalZ },
            damageType: skill.damageType,
            isCrit,
            attackerId: casterId,
            isMeleeHit: true
        });

        soundFns.playHit();
    } else {
        soundFns.playMiss();
        addLog(logMiss(casterData.name, skill.name, targetData.name), COLORS.logNeutral);
    }

    return true;
}

// =============================================================================
// WALL OF FIRE - Drag-line ground tile skill
// =============================================================================

/**
 * Execute Wall of Fire — create fire tiles along a line of grid cells.
 * The tile positions are computed by the input handler from the drag gesture.
 */
export function executeWallOfFireSkill(
    ctx: SkillExecutionContext,
    casterId: number,
    skill: Skill,
    tilePositions: { x: number; z: number }[]
): boolean {
    const { scene, unitsRef, fireTilesRef, addLog } = ctx;

    if (!fireTilesRef) {
        addLog("Wall of Fire cannot be cast right now.", COLORS.logWarning);
        return false;
    }

    const casterG = unitsRef.current[casterId];
    if (!casterG) return false;

    if (tilePositions.length === 0) {
        addLog(`${UNIT_DATA[casterId].name}: No tiles selected!`, COLORS.logNeutral);
        return false;
    }

    consumeSkill(ctx, casterId, skill);

    const casterData = UNIT_DATA[casterId];
    const now = Date.now();
    const damagePerTick = skill.damagePerTick ?? 3;
    const duration = skill.duration ?? 10000;

    for (const pos of tilePositions) {
        createFireTile(
            scene,
            fireTilesRef.current,
            pos.x, pos.z,
            casterId,
            damagePerTick,
            now,
            duration
        );
    }

    // Visual: expanding ring at center of the line
    const midIdx = Math.floor(tilePositions.length / 2);
    const midPos = tilePositions[midIdx];
    createAnimatedRing(scene, midPos.x + 0.5, midPos.z + 0.5, COLORS.dmgFire, {
        innerRadius: 0.2,
        outerRadius: 0.4,
        maxScale: tilePositions.length * 0.6,
        duration: 300,
        initialOpacity: 0.6
    });

    addLog(logCast(casterData.name, skill.name), getSkillTextColor(skill.type, skill.damageType));
    soundFns.playAttack();

    return true;
}

