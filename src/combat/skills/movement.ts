// =============================================================================
// MOVEMENT SKILLS - Dodge and other positional cantrips
// =============================================================================

import * as THREE from "three";
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
const UP_AXIS = new THREE.Vector3(0, 1, 0);

function createSwapBeam(
    scene: THREE.Scene,
    fromX: number,
    fromZ: number,
    toX: number,
    toZ: number,
    color: string,
    duration: number = 260
): void {
    const from = new THREE.Vector3(fromX, 0.85, fromZ);
    const to = new THREE.Vector3(toX, 0.85, toZ);
    const dir = new THREE.Vector3().subVectors(to, from);
    const beamLength = dir.length();
    if (beamLength < 0.05) return;

    dir.normalize();

    const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.04, 0.04, beamLength, 10, 1, true),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.82 })
    );
    beam.position.copy(from).add(to).multiplyScalar(0.5);
    beam.quaternion.setFromUnitVectors(UP_AXIS, dir);
    scene.add(beam);

    const startTime = getGameTime();
    const animate = () => {
        const elapsed = getGameTime() - startTime;
        const t = Math.min(1, elapsed / duration);
        const material = beam.material as THREE.MeshBasicMaterial;
        material.opacity = 0.82 * (1 - t);
        const pulseScale = 1 + Math.sin(t * Math.PI) * 0.25;
        beam.scale.set(pulseScale, 1, pulseScale);

        if (t < 1) {
            requestAnimationFrame(animate);
            return;
        }

        scene.remove(beam);
        beam.geometry.dispose();
        material.dispose();
    };
    requestAnimationFrame(animate);
}

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
    createAnimatedRing(scene, (originX + targetX) * 0.5, (originZ + targetZ) * 0.5, "#b06ad9", {
        innerRadius: 0.1, outerRadius: 0.25, maxScale: 1.1, duration: 180
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
    const { scene, unitsStateRef, unitsRef, unitMeshRef, hitFlashRef, setUnits } = ctx;

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
    createSwapBeam(scene, casterPos.x, casterPos.z, targetPos.x, targetPos.z, COLORS.dmgChaos);
    createAnimatedRing(scene, casterPos.x, casterPos.z, COLORS.dmgChaos, {
        innerRadius: 0.12, outerRadius: 0.28, maxScale: 1.0, duration: 200
    });
    createAnimatedRing(scene, targetPos.x, targetPos.z, COLORS.dmgChaos, {
        innerRadius: 0.12, outerRadius: 0.28, maxScale: 1.0, duration: 200
    });

    const casterMesh = unitMeshRef.current[casterId];
    if (casterMesh) {
        (casterMesh.material as THREE.MeshStandardMaterial).color.set(COLORS.dmgChaos);
        hitFlashRef.current[casterId] = Date.now();
    }
    const targetMesh = unitMeshRef.current[target.id];
    if (targetMesh) {
        (targetMesh.material as THREE.MeshStandardMaterial).color.set(COLORS.dmgChaos);
        hitFlashRef.current[target.id] = Date.now();
    }

    const targetData = getUnitStats(target);
    soundFns.playMagicWave();
    ctx.addLog(`${UNIT_DATA[casterId].name} swaps places with ${targetData.name}!`, "#8e44ad");

    return true;
}
