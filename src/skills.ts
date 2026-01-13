// =============================================================================
// SKILL EXECUTION & TARGETING
// =============================================================================

import * as THREE from "three";
import type { Unit, Skill, UnitGroup, Projectile, StatusEffect } from "./types";
import { UNIT_DATA, rollDamage, rollHit, getUnitStats } from "./units";
import { soundFns } from "./sound";
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
    const { scene, unitsRef, actionCooldownRef, projectilesRef, setUnits, setSkillCooldowns, addLog } = ctx;
    const casterG = unitsRef.current[casterId];
    if (!casterG) return;

    const now = Date.now();

    // Set global cooldown and skill-specific cooldown
    actionCooldownRef.current[casterId] = now + skill.cooldown;

    // Deduct mana and set cooldown for UI
    setUnits(prev => prev.map(u => u.id === casterId ? { ...u, mana: (u.mana ?? 0) - skill.manaCost } : u));
    const cooldownData = { end: now + skill.cooldown, duration: skill.cooldown };
    setSkillCooldowns(prev => ({
        ...prev,
        [`${casterId}-${skill.name}`]: cooldownData,
        [`${casterId}-Attack`]: cooldownData
    }));

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

    addLog(`${UNIT_DATA[casterId].name} casts ${skill.name}!`, "#ff6600");
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
    const { unitsStateRef, unitsRef, actionCooldownRef, unitMeshRef, unitOriginalColorRef, setUnits, setSkillCooldowns, addLog } = ctx;

    // Find closest ally to target position
    const allies = unitsStateRef.current.filter(u => u.team === "player" && u.hp > 0);
    let closestAllyId: number | null = null;
    let closestDist = 2;

    allies.forEach(ally => {
        const ag = unitsRef.current[ally.id];
        if (!ag) return;
        const d = Math.hypot(ag.position.x - targetX, ag.position.z - targetZ);
        if (d < closestDist) {
            closestDist = d;
            closestAllyId = ally.id;
        }
    });

    if (closestAllyId === null) {
        addLog(`${UNIT_DATA[casterId].name}: No ally at that location!`, "#888");
        return false;
    }

    const targetAlly = unitsStateRef.current.find(u => u.id === closestAllyId);
    if (targetAlly && targetAlly.hp >= UNIT_DATA[targetAlly.id].maxHp) {
        addLog(`${UNIT_DATA[casterId].name}: ${UNIT_DATA[closestAllyId].name} is at full health!`, "#888");
        return false;
    }

    const now = Date.now();

    // Set global cooldown and skill-specific cooldown
    actionCooldownRef.current[casterId] = now + skill.cooldown;

    // Deduct mana and set cooldown for UI
    setUnits(prev => prev.map(u => u.id === casterId ? { ...u, mana: (u.mana ?? 0) - skill.manaCost } : u));
    const cooldownData = { end: now + skill.cooldown, duration: skill.cooldown };
    setSkillCooldowns(prev => ({
        ...prev,
        [`${casterId}-${skill.name}`]: cooldownData,
        [`${casterId}-Attack`]: cooldownData
    }));

    // Apply heal
    const healAmount = rollDamage(skill.value[0], skill.value[1]);
    const targetData = UNIT_DATA[closestAllyId];
    const healTargetId = closestAllyId;
    setUnits(prev => prev.map(u => u.id === healTargetId ? { ...u, hp: Math.min(targetData.maxHp, u.hp + healAmount) } : u));

    addLog(`${UNIT_DATA[casterId].name} heals ${targetData.name} for ${healAmount}!`, "#22c55e");
    soundFns.playHeal();

    // Visual effect - green flash
    const targetG = unitsRef.current[closestAllyId];
    if (targetG) {
        const mesh = unitMeshRef.current[closestAllyId];
        if (mesh) {
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
    }

    return true;
}

// Poison constants (must match gameLoop.ts)
const POISON_DURATION = 8000;
const POISON_TICK_INTERVAL = 1000;
const POISON_DAMAGE_PER_TICK = 2;

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
    const { scene, unitsStateRef, unitsRef, actionCooldownRef, hitFlashRef, damageTexts, setUnits, setSkillCooldowns, addLog } = ctx;

    // Find closest enemy to target position
    const enemies = unitsStateRef.current.filter(u => u.team === "enemy" && u.hp > 0);
    let closestEnemyId: number | null = null;
    let closestDist = 2;

    enemies.forEach(enemy => {
        const eg = unitsRef.current[enemy.id];
        if (!eg) return;
        const d = Math.hypot(eg.position.x - targetX, eg.position.z - targetZ);
        if (d < closestDist) {
            closestDist = d;
            closestEnemyId = enemy.id;
        }
    });

    if (closestEnemyId === null) {
        addLog(`${UNIT_DATA[casterId].name}: No enemy at that location!`, "#888");
        return false;
    }

    const casterG = unitsRef.current[casterId];
    const targetG = unitsRef.current[closestEnemyId];
    const targetEnemy = unitsStateRef.current.find(u => u.id === closestEnemyId);

    if (!casterG || !targetG || !targetEnemy) return false;

    // Check if in melee range
    const dist = Math.hypot(casterG.position.x - targetG.position.x, casterG.position.z - targetG.position.z);
    if (dist > skill.range + 0.5) {
        addLog(`${UNIT_DATA[casterId].name}: Target out of range!`, "#888");
        return false;
    }

    const now = Date.now();

    // Set global cooldown and skill-specific cooldown
    actionCooldownRef.current[casterId] = now + skill.cooldown;

    // Deduct mana and set cooldown for UI
    setUnits(prev => prev.map(u => u.id === casterId ? { ...u, mana: (u.mana ?? 0) - skill.manaCost } : u));
    const cooldownData = { end: now + skill.cooldown, duration: skill.cooldown };
    setSkillCooldowns(prev => ({
        ...prev,
        [`${casterId}-${skill.name}`]: cooldownData,
        [`${casterId}-Attack`]: cooldownData
    }));

    const casterData = UNIT_DATA[casterId];
    const targetData = getUnitStats(targetEnemy);

    // Roll to hit
    if (rollHit(casterData.accuracy)) {
        const rawDmg = rollDamage(skill.value[0], skill.value[1]);
        const dmg = Math.max(1, rawDmg - targetData.armor);

        setUnits(prev => prev.map(u => u.id === closestEnemyId ? { ...u, hp: u.hp - dmg } : u));
        hitFlashRef.current[closestEnemyId] = now;
        soundFns.playHit();
        addLog(`${casterData.name}'s ${skill.name} hits ${targetData.name} for ${dmg} damage!`, "#4ade80");
        spawnDamageNumber(scene, targetG.position.x, targetG.position.z, dmg, "#4ade80", damageTexts.current);

        // Try to apply poison if skill has poisonChance
        if (skill.poisonChance && Math.random() * 100 < skill.poisonChance) {
            setUnits(prev => prev.map(u => {
                if (u.id !== closestEnemyId) return u;

                const existingEffects = u.statusEffects || [];
                const existingPoison = existingEffects.find(e => e.type === "poison");

                if (existingPoison) {
                    // Refresh duration
                    return {
                        ...u,
                        statusEffects: existingEffects.map(e =>
                            e.type === "poison"
                                ? { ...e, duration: POISON_DURATION, lastTick: now }
                                : e
                        )
                    };
                }

                // Apply new poison
                const newPoison: StatusEffect = {
                    type: "poison",
                    duration: POISON_DURATION,
                    tickInterval: POISON_TICK_INTERVAL,
                    lastTick: now,
                    damagePerTick: POISON_DAMAGE_PER_TICK,
                    sourceId: casterId
                };

                return {
                    ...u,
                    statusEffects: [...existingEffects, newPoison]
                };
            }));

            addLog(`${targetData.name} is poisoned!`, "#7cba7c");
        }

        // Check for defeat
        const newHp = Math.max(0, targetEnemy.hp - dmg);
        if (newHp <= 0) {
            handleUnitDefeat(closestEnemyId, targetG, unitsRef.current, addLog, targetData.name);
        }
    } else {
        soundFns.playMiss();
        addLog(`${casterData.name}'s ${skill.name} misses ${targetData.name}.`, "#888");
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
    const { scene, unitsStateRef, unitsRef, actionCooldownRef, setUnits, setSkillCooldowns, addLog } = ctx;

    const casterG = unitsRef.current[casterId];
    if (!casterG) return false;

    const now = Date.now();

    // Set global cooldown and skill-specific cooldown
    actionCooldownRef.current[casterId] = now + skill.cooldown;

    // Deduct mana and set cooldown for UI
    setUnits(prev => prev.map(u => u.id === casterId ? { ...u, mana: (u.mana ?? 0) - skill.manaCost } : u));
    const cooldownData = { end: now + skill.cooldown, duration: skill.cooldown };
    setSkillCooldowns(prev => ({
        ...prev,
        [`${casterId}-${skill.name}`]: cooldownData,
        [`${casterId}-Attack`]: cooldownData
    }));

    const casterData = UNIT_DATA[casterId];
    const tauntChance = skill.value[0];  // Use first value as taunt chance percentage

    // Find all enemies within range
    const enemies = unitsStateRef.current.filter(u => u.team === "enemy" && u.hp > 0);
    let tauntedCount = 0;

    enemies.forEach(enemy => {
        const enemyG = unitsRef.current[enemy.id];
        if (!enemyG) return;

        const dist = Math.hypot(casterG.position.x - enemyG.position.x, casterG.position.z - enemyG.position.z);
        if (dist <= skill.range) {
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
        addLog(`${casterData.name}'s ${skill.name} taunts ${tauntedCount} enemies!`, "#c0392b");
    } else {
        addLog(`${casterData.name}'s ${skill.name} echoes... but no enemies are affected.`, "#888");
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
        ctx.addLog(`${UNIT_DATA[casterId].name}: Not enough mana!`, "#888");
        return false;
    }

    if (skill.type === "damage" && skill.targetType === "aoe") {
        executeAoeSkill(ctx, casterId, skill, targetX, targetZ);
        return true;
    } else if (skill.type === "heal" && skill.targetType === "ally") {
        return executeHealSkill(ctx, casterId, skill, targetX, targetZ);
    } else if (skill.type === "damage" && skill.targetType === "enemy") {
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
