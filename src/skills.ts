// =============================================================================
// SKILL EXECUTION & TARGETING
// =============================================================================

import * as THREE from "three";
import type { Unit, Skill, UnitGroup, Projectile } from "./types";
import { UNIT_DATA, rollDamage } from "./units";
import { soundFns } from "./sound";

export interface SkillExecutionContext {
    scene: THREE.Scene;
    unitsStateRef: React.RefObject<Unit[]>;
    unitsRef: React.RefObject<Record<number, UnitGroup>>;
    actionCooldownRef: React.MutableRefObject<Record<number, number>>;
    projectilesRef: React.MutableRefObject<Projectile[]>;
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
                const orig = unitOriginalColorRef.current[healTargetId];
                if (orig) (mesh.material as THREE.MeshStandardMaterial).color.copy(orig);
            }, 200);
        }
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
