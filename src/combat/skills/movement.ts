// =============================================================================
// MOVEMENT SKILLS - Dodge and other positional cantrips
// =============================================================================

import type { Skill, StatusEffect } from "../../core/types";
import { BUFF_TICK_INTERVAL, COLORS } from "../../core/constants";
import { UNIT_DATA } from "../../game/playerUnits";
import { getUnitStats } from "../../game/units";
import { getUnitRadius, isInRange } from "../../rendering/range";
import { applyStatusEffect } from "../combatMath";
import { soundFns } from "../../audio";
import { createAnimatedRing } from "../damageEffects";
import { updateUnitWith } from "../../core/stateUtils";
import { getGameTime } from "../../core/gameClock";
import type { SkillExecutionContext } from "./types";
import { consumeSkill, findClosestUnit } from "./helpers";

// =============================================================================
// DODGE ANIMATION
// =============================================================================

const DODGE_DASH_DURATION = 200; // ms for the dash animation

/**
 * Animate a smooth dash from origin to target over DODGE_DASH_DURATION ms.
 * Creates a trail of fading afterimages along the path.
 */
function animateDodgeDash(
    casterG: import("../../core/types").UnitGroup,
    originX: number,
    originZ: number,
    targetX: number,
    targetZ: number,
    scene: import("three").Scene
): void {
    const flyHeight = casterG.userData.flyHeight ?? 0;
    const startTime = getGameTime();

    const animate = () => {
        const elapsed = getGameTime() - startTime;
        const t = Math.min(1, elapsed / DODGE_DASH_DURATION);

        // Ease-out for snappy feel
        const eased = 1 - (1 - t) * (1 - t);

        const x = originX + (targetX - originX) * eased;
        const z = originZ + (targetZ - originZ) * eased;
        casterG.position.set(x, flyHeight, z);

        if (t < 1) {
            requestAnimationFrame(animate);
        } else {
            // Ensure final position is exact
            casterG.position.set(targetX, flyHeight, targetZ);
        }
    };

    requestAnimationFrame(animate);

    // Spawn trail rings along the path
    const trailCount = 3;
    for (let i = 1; i <= trailCount; i++) {
        const frac = i / (trailCount + 1);
        const tx = originX + (targetX - originX) * frac;
        const tz = originZ + (targetZ - originZ) * frac;
        createAnimatedRing(scene, tx, tz, "#8e44ad", {
            innerRadius: 0.1, outerRadius: 0.25, maxScale: 1.0, duration: 200
        });
    }
}

// =============================================================================
// DODGE SKILL
// =============================================================================

/**
 * Execute Dodge cantrip — dash to target location and gain brief invulnerability.
 * Invul applies immediately so the unit is protected during and after the dash.
 */
export function executeDodgeSkill(
    ctx: SkillExecutionContext,
    casterId: number,
    skill: Skill,
    targetX: number,
    targetZ: number
): boolean {
    const { scene, unitsStateRef, unitsRef, setUnits } = ctx;

    const caster = unitsStateRef.current.find(u => u.id === casterId);
    const casterG = unitsRef.current[casterId];
    if (!caster || !casterG || caster.hp <= 0) return false;

    // Check cantrip uses
    if ((caster.cantripUses?.[skill.name] ?? 0) <= 0) {
        ctx.addLog(`${UNIT_DATA[casterId].name}: No uses remaining!`, COLORS.logNeutral);
        return false;
    }

    // Save origin before any mutations
    const originX = casterG.position.x;
    const originZ = casterG.position.z;

    // Clamp target to max range
    const dx = targetX - originX;
    const dz = targetZ - originZ;
    const dist = Math.hypot(dx, dz);
    if (dist > skill.range) {
        const scale = skill.range / dist;
        targetX = originX + dx * scale;
        targetZ = originZ + dz * scale;
    }

    // Consume skill (deducts mana, decrements uses, sets brief lockout)
    consumeSkill(ctx, casterId, skill);

    const now = Date.now();
    const casterData = UNIT_DATA[casterId];

    // Apply invul status + update logical position immediately
    const invulEffect: StatusEffect = {
        type: "invul",
        duration: skill.duration!,
        tickInterval: BUFF_TICK_INTERVAL,
        timeSinceTick: 0,
        lastUpdateTime: now,
        damagePerTick: 0,
        sourceId: casterId
    };
    updateUnitWith(setUnits, casterId, u => ({
        x: targetX,
        z: targetZ,
        statusEffects: applyStatusEffect(u.statusEffects, invulEffect)
    }));

    // Set 3D target position (AI/movement system uses these)
    casterG.userData.targetX = targetX;
    casterG.userData.targetZ = targetZ;
    casterG.userData.attackTarget = null; // Clear attack target on dodge

    // Animate the 3D mesh smoothly from origin to target
    animateDodgeDash(casterG, originX, originZ, targetX, targetZ, scene);

    // Visual: ring at origin and destination
    createAnimatedRing(scene, originX, originZ, "#8e44ad", {
        innerRadius: 0.2, outerRadius: 0.4, maxScale: 1.5, duration: 250
    });
    createAnimatedRing(scene, targetX, targetZ, "#8e44ad", {
        innerRadius: 0.2, outerRadius: 0.4, maxScale: 1.5, duration: 250
    });

    soundFns.playMiss(); // Reuse whoosh sound
    ctx.addLog(`${casterData.name} dodges!`, "#8e44ad");

    return true;
}

// =============================================================================
// BODY SWAP SKILL
// =============================================================================

/**
 * Execute Body Swap cantrip — instantly swap places with a targeted unit (ally or enemy).
 */
export function executeBodySwapSkill(
    ctx: SkillExecutionContext,
    casterId: number,
    skill: Skill,
    targetX: number,
    targetZ: number,
    targetUnitId?: number
): boolean {
    const { scene, unitsStateRef, unitsRef, setUnits } = ctx;

    const caster = unitsStateRef.current.find(u => u.id === casterId);
    const casterG = unitsRef.current[casterId];
    if (!caster || !casterG || caster.hp <= 0) return false;

    if ((caster.cantripUses?.[skill.name] ?? 0) <= 0) {
        ctx.addLog(`${UNIT_DATA[casterId].name}: No uses remaining!`, COLORS.logNeutral);
        return false;
    }

    const otherLivingUnits = unitsStateRef.current.filter(u => u.id !== casterId && u.hp > 0);
    if (otherLivingUnits.length === 0) {
        ctx.addLog(`${UNIT_DATA[casterId].name}: No valid swap target!`, COLORS.logNeutral);
        return false;
    }

    let target = targetUnitId !== undefined
        ? otherLivingUnits.find(u => u.id === targetUnitId)
        : undefined;
    let targetG = target ? unitsRef.current[target.id] : undefined;

    if (!target || !targetG) {
        const closest = findClosestUnit(otherLivingUnits, unitsRef.current, targetX, targetZ, 2.2);
        if (!closest) {
            ctx.addLog(`${UNIT_DATA[casterId].name}: No target at that location!`, COLORS.logNeutral);
            return false;
        }
        target = closest.unit;
        targetG = closest.group;
    }

    const targetRadius = getUnitRadius(target);
    if (!isInRange(casterG.position.x, casterG.position.z, targetG.position.x, targetG.position.z, targetRadius, skill.range + 0.4)) {
        ctx.addLog(`${UNIT_DATA[casterId].name}: Target out of range!`, COLORS.logNeutral);
        return false;
    }

    const casterPos = { x: casterG.position.x, z: casterG.position.z };
    const targetPos = { x: targetG.position.x, z: targetG.position.z };

    consumeSkill(ctx, casterId, skill);

    setUnits(prev => prev.map(u => {
        if (u.id === casterId) return { ...u, x: targetPos.x, z: targetPos.z };
        if (u.id === target!.id) return { ...u, x: casterPos.x, z: casterPos.z };
        return u;
    }));

    // Teleport both groups instantly and reset their immediate movement targets.
    casterG.position.set(targetPos.x, casterG.userData.flyHeight ?? 0, targetPos.z);
    casterG.userData.targetX = targetPos.x;
    casterG.userData.targetZ = targetPos.z;
    casterG.userData.attackTarget = null;

    targetG.position.set(casterPos.x, targetG.userData.flyHeight ?? 0, casterPos.z);
    targetG.userData.targetX = casterPos.x;
    targetG.userData.targetZ = casterPos.z;
    targetG.userData.attackTarget = null;

    createAnimatedRing(scene, casterPos.x, casterPos.z, "#8e44ad", {
        innerRadius: 0.2, outerRadius: 0.45, maxScale: 1.3, duration: 260
    });
    createAnimatedRing(scene, targetPos.x, targetPos.z, "#8e44ad", {
        innerRadius: 0.2, outerRadius: 0.45, maxScale: 1.3, duration: 260
    });

    const targetData = getUnitStats(target);
    soundFns.playMagicWave();
    ctx.addLog(`${UNIT_DATA[casterId].name} swaps places with ${targetData.name}!`, "#8e44ad");

    return true;
}
