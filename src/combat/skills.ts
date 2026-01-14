// =============================================================================
// SKILL EXECUTION & TARGETING
// =============================================================================

import * as THREE from "three";
import type { Unit, Skill, UnitGroup, Projectile } from "../core/types";
import { COLORS } from "../core/constants";
import { UNIT_DATA, getUnitStats, getAllSkills } from "../game/units";
import { rollDamage, rollHit, applyPoison, logHit, logMiss, logHeal, logPoisoned, logCast, logTaunt, logTauntMiss } from "./combatMath";
import { getUnitRadius, isInRange } from "../rendering/range";
import { soundFns } from "../audio/sound";
import { spawnDamageNumber, handleUnitDefeat } from "./combat";

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

/**
 * Consume skill resources: set global cooldown for ALL skills and deduct mana.
 * Call this at the START of every skill execution (after validation, before effects).
 */
function consumeSkill(ctx: SkillExecutionContext, casterId: number, skill: Skill): void {
    const { actionCooldownRef, setSkillCooldowns, setUnits } = ctx;
    const now = Date.now();
    const cooldownEnd = now + skill.cooldown;
    const cooldownData = { end: cooldownEnd, duration: skill.cooldown };

    // Set internal cooldown ref
    actionCooldownRef.current[casterId] = cooldownEnd;

    // Set UI cooldown for ALL skills of this unit
    const allSkills = getAllSkills(casterId);
    setSkillCooldowns(prev => {
        const updated = { ...prev };
        allSkills.forEach(s => {
            updated[`${casterId}-${s.name}`] = cooldownData;
        });
        return updated;
    });

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
    const projectile = new THREE.Mesh(
        new THREE.SphereGeometry(0.2, 12, 12),
        new THREE.MeshBasicMaterial({ color: skill.projectileColor || "#ff4400" })
    );
    projectile.position.set(casterG.position.x, 0.8, casterG.position.z);
    scene.add(projectile);

    projectilesRef.current.push({
        type: "aoe",
        mesh: projectile,
        attackerId: casterId,
        speed: 0.25,
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
    const { unitsStateRef, unitsRef, unitMeshRef, unitOriginalColorRef, setUnits, addLog } = ctx;

    // Find closest ally to target position
    const allies = getAliveUnits(unitsStateRef.current, "player");
    const closest = findClosestUnit(allies, unitsRef.current, targetX, targetZ);

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

    // Visual effect - green flash
    const mesh = unitMeshRef.current[healTargetId];
    if (targetG && mesh) {
        (mesh.material as THREE.MeshStandardMaterial).color.set("#22ff22");
        setTimeout(() => {
            // Guard against mesh being disposed or removed after unmount
            const currentMesh = unitMeshRef.current[healTargetId];
            const orig = unitOriginalColorRef.current[healTargetId];
            if (currentMesh && orig && currentMesh.material) {
                (currentMesh.material as THREE.MeshStandardMaterial).color.copy(orig);
            }
        }, 200);
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
    const enemies = getAliveUnits(unitsStateRef.current, "enemy");
    const closest = findClosestUnit(enemies, unitsRef.current, targetX, targetZ);

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
        const rawDmg = rollDamage(skill.value[0], skill.value[1]);
        const dmg = Math.max(1, rawDmg - targetData.armor);
        const newHp = Math.max(0, targetEnemy.hp - dmg);

        // Check if poison should be applied (roll now, apply in single setUnits)
        const shouldPoison = skill.poisonChance && Math.random() * 100 < skill.poisonChance;

        // Single setUnits call to avoid stale state issues
        setUnits(prev => prev.map(u => {
            if (u.id !== targetId) return u;
            let updatedUnit = { ...u, hp: newHp };
            if (shouldPoison) {
                updatedUnit = applyPoison(updatedUnit, casterId, now);
            }
            return updatedUnit;
        }));

        hitFlashRef.current[targetId] = now;
        soundFns.playHit();
        addLog(logHit(casterData.name, skill.name, targetData.name, dmg), COLORS.damagePlayer);
        spawnDamageNumber(scene, targetG.position.x, targetG.position.z, dmg, COLORS.damagePlayer, damageTexts.current);

        if (shouldPoison) {
            addLog(logPoisoned(targetData.name), COLORS.poisonText);
        }

        // Check for defeat
        if (newHp <= 0) {
            handleUnitDefeat(targetId, targetG, unitsRef.current, addLog, targetData.name);
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
            if (Math.random() * 100 < tauntChance) {
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

    // Animate the ring expanding
    const startTime = Date.now();
    const expandDuration = 400;
    const maxRadius = skill.range;

    const animateRing = () => {
        const elapsed = Date.now() - startTime;
        const t = Math.min(1, elapsed / expandDuration);
        const currentRadius = 0.5 + (maxRadius - 0.5) * t;
        ring.scale.set(currentRadius / 0.6, currentRadius / 0.6, 1);
        (ring.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - t);

        if (t < 1) {
            requestAnimationFrame(animateRing);
        } else {
            scene.remove(ring);
            ring.geometry.dispose();
            (ring.material as THREE.MeshBasicMaterial).dispose();
        }
    };
    requestAnimationFrame(animateRing);

    if (tauntedCount > 0) {
        addLog(logTaunt(casterData.name, skill.name, tauntedCount), "#c0392b");
    } else {
        addLog(logTauntMiss(casterData.name, skill.name), COLORS.logNeutral);
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
    const enemies = getAliveUnits(unitsStateRef.current, "enemy");
    const closest = findClosestUnit(enemies, unitsRef.current, targetX, targetZ);

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
    const projectile = new THREE.Mesh(
        new THREE.SphereGeometry(0.15, 8, 8),
        new THREE.MeshBasicMaterial({ color: casterData.projectileColor || "#a0522d" })
    );
    projectile.position.set(casterG.position.x, 0.6, casterG.position.z);
    scene.add(projectile);

    projectilesRef.current.push({
        type: "basic",
        mesh: projectile,
        attackerId: casterId,
        targetId: targetEnemy.id,
        speed: 0.3
    });

    addLog(`${casterData.name} shoots at ${getUnitStats(targetEnemy).name}!`, COLORS.damageNeutral);
    soundFns.playAttack();

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
