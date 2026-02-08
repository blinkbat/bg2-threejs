// =============================================================================
// BASILISK GLARE - Telegraphed cone AoE that stuns targets
// =============================================================================

import * as THREE from "three";
import type { Unit, UnitGroup, DamageText, EnemyStats, DamageType, StatusEffect } from "../../core/types";
import { BUFF_TICK_INTERVAL, COLORS } from "../../core/constants";
import { getUnitStats } from "../../game/units";
import { getGameTime } from "../../core/gameClock";
import { calculateDamageWithCrit, rollHit, getEffectiveArmor, logAoeHit, isUnitAlive, applyStatusEffect, setSkillCooldown } from "../../combat/combatMath";
import { applyDamageToUnit, buildDamageContext } from "../../combat/damageEffects";
import { soundFns } from "../../audio";
import { disposeBasicMesh } from "../../rendering/disposal";
import type { GlareContext } from "./types";

// =============================================================================
// TYPES
// =============================================================================

interface GlareState {
    casterId: number;
    elapsedTime: number;       // Accumulated time (pause-safe)
    lastUpdateTime: number;    // Last frame timestamp for delta calculation
    delay: number;             // Total delay before detonation
    damage: [number, number];
    damageType: DamageType;
    stunDuration: number;
    coneOriginX: number;
    coneOriginZ: number;
    coneAngle: number;         // Half-angle in radians
    coneDistance: number;
    facingAngle: number;       // Direction basilisk is facing when casting
    meshes: THREE.Mesh[];
    skillName: string;
}

// =============================================================================
// STATE
// =============================================================================

let nextGlareId = 0;
const activeGlares = new Map<number, GlareState>();

// =============================================================================
// VISUAL CREATION
// =============================================================================

/**
 * Create a cone-shaped ground warning mesh using RingGeometry.
 */
function createConeMesh(
    scene: THREE.Scene,
    originX: number,
    originZ: number,
    facingAngle: number,
    coneAngle: number,
    coneDistance: number
): THREE.Mesh {
    // RingGeometry(innerRadius, outerRadius, thetaSegments, phiSegments, thetaStart, thetaLength)
    // thetaStart/thetaLength are relative to the mesh's local space
    const geometry = new THREE.RingGeometry(0.3, coneDistance, 32, 1, -coneAngle, coneAngle * 2);
    const material = new THREE.MeshBasicMaterial({
        color: "#88aa22",
        transparent: true,
        opacity: 0.1,
        side: THREE.DoubleSide
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(originX, 0.05, originZ);
    // Rotate to face the target direction
    // After rotation.x=-PI/2, rotation.z rotates from +X toward -Z, so negate to match atan2
    mesh.rotation.z = -facingAngle;
    mesh.name = "glare-cone";
    scene.add(mesh);
    return mesh;
}

// =============================================================================
// GLARE LIFECYCLE
// =============================================================================

/**
 * Try to start a basilisk glare aimed at a target.
 * @returns true if the glare was started
 */
export function tryBasiliskGlare(ctx: GlareContext): boolean {
    const {
        unit, g, enemyStats, glareSkill, unitsState, unitsRef, scene,
        skillCooldowns, setSkillCooldowns, addLog, now
    } = ctx;

    const glareKey = `${unit.id}-${glareSkill.name}`;
    const glareCooldownEnd = skillCooldowns[glareKey]?.end ?? 0;

    if (now < glareCooldownEnd) {
        return false;
    }

    // Don't start another glare if already active
    for (const glare of activeGlares.values()) {
        if (glare.casterId === unit.id) return false;
    }

    // Find player targets within cone distance
    const targets: { unit: Unit; group: UnitGroup; angle: number }[] = [];
    for (const target of unitsState) {
        if (target.team !== "player" || !isUnitAlive(target, new Set())) continue;
        const tg = unitsRef[target.id];
        if (!tg) continue;
        const dx = tg.position.x - g.position.x;
        const dz = tg.position.z - g.position.z;
        const dist = Math.hypot(dx, dz);
        if (dist <= glareSkill.coneDistance && dist > 0.1) {
            targets.push({ unit: target, group: tg, angle: Math.atan2(dz, dx) });
        }
    }

    if (targets.length === 0) return false;

    // Find the facing angle that hits the most targets
    // Test each target angle AND midpoints between pairs for better coverage
    const candidateAngles: number[] = targets.map(t => t.angle);
    for (let i = 0; i < targets.length; i++) {
        for (let j = i + 1; j < targets.length; j++) {
            let diff = targets[j].angle - targets[i].angle;
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;
            candidateAngles.push(targets[i].angle + diff / 2);
        }
    }

    let bestAngle = targets[0].angle;
    let bestCount = 1;
    for (const angle of candidateAngles) {
        let count = 0;
        for (const other of targets) {
            let diff = other.angle - angle;
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;
            if (Math.abs(diff) <= glareSkill.coneAngle) count++;
        }
        if (count > bestCount) {
            bestCount = count;
            bestAngle = angle;
        }
    }

    // Prefer multi-target: 3+ always fires, 2 fires 50%, 1 fires 25%
    if (bestCount < 3 && Math.random() > bestCount * 0.25) return false;

    const facingAngle = bestAngle;

    // Create visual warning cone
    const mesh = createConeMesh(scene, g.position.x, g.position.z, facingAngle, glareSkill.coneAngle, glareSkill.coneDistance);

    const glareId = nextGlareId++;
    activeGlares.set(glareId, {
        casterId: unit.id,
        elapsedTime: 0,
        lastUpdateTime: now,
        delay: glareSkill.delay,
        damage: glareSkill.damage,
        damageType: glareSkill.damageType,
        stunDuration: glareSkill.stunDuration,
        coneOriginX: g.position.x,
        coneOriginZ: g.position.z,
        coneAngle: glareSkill.coneAngle,
        coneDistance: glareSkill.coneDistance,
        facingAngle,
        meshes: [mesh],
        skillName: glareSkill.name
    });

    // Set cooldown
    setSkillCooldown(setSkillCooldowns, glareKey, glareSkill.cooldown, now, unit);

    addLog(`${enemyStats.name} begins ${glareSkill.name}!`, "#88aa22");
    soundFns.playHit();

    return true;
}

// =============================================================================
// GLARE PROCESSING
// =============================================================================

/**
 * Process all active glares. Called every frame from the game loop.
 */
export function processGlares(
    scene: THREE.Scene,
    unitsState: Unit[],
    unitsRef: Record<number, UnitGroup>,
    damageTexts: DamageText[],
    hitFlashRef: Record<number, number>,
    setUnits: React.Dispatch<React.SetStateAction<Unit[]>>,
    addLog: (text: string, color?: string) => void,
    now: number,
    defeatedThisFrame: Set<number>
): void {
    const toRemove: number[] = [];

    activeGlares.forEach((glare, glareId) => {
        const unit = unitsState.find(u => u.id === glare.casterId);

        // Cancel glare if caster is dead
        if (!unit || unit.hp <= 0) {
            cleanupGlare(scene, glare);
            toRemove.push(glareId);
            return;
        }

        // Accumulate elapsed time (pause-safe)
        const rawDelta = now - glare.lastUpdateTime;
        const delta = Math.min(rawDelta, 100); // Max 100ms per frame
        glare.elapsedTime += delta;
        glare.lastUpdateTime = now;

        const progress = Math.min(glare.elapsedTime / glare.delay, 1);

        // Update visual intensity
        updateGlareVisuals(glare, progress);

        // Check if glare should detonate
        if (glare.elapsedTime >= glare.delay) {
            executeGlare(
                scene, unit, glare, unitsState, unitsRef,
                damageTexts, hitFlashRef, setUnits, addLog, now, defeatedThisFrame
            );

            cleanupGlare(scene, glare);
            toRemove.push(glareId);
        }
    });

    toRemove.forEach(id => activeGlares.delete(id));
}

/**
 * Update visual intensity of glare cone based on progress.
 */
function updateGlareVisuals(glare: GlareState, progress: number): void {
    // Opacity ramps from 0.1 to 0.7
    const opacity = 0.1 + progress * 0.6;

    // Color shifts from yellow-green to bright green
    const r = 0.5 - progress * 0.2;
    const g = 0.7 + progress * 0.3;
    const b = 0.1;

    glare.meshes.forEach(mesh => {
        const material = mesh.material as THREE.MeshBasicMaterial;
        material.opacity = opacity;
        material.color.setRGB(r, g, b);

        // Pulsing in final 25%
        if (progress > 0.75) {
            const pulsePhase = (progress - 0.75) * 4;
            const pulse = Math.sin(pulsePhase * Math.PI * 8) * 0.15;
            material.opacity = Math.min(1, opacity + pulse);
        }
    });
}

/**
 * Execute the glare detonation — deal damage and stun units in the cone.
 */
function executeGlare(
    scene: THREE.Scene,
    caster: Unit,
    glare: GlareState,
    unitsState: Unit[],
    unitsRef: Record<number, UnitGroup>,
    damageTexts: DamageText[],
    hitFlashRef: Record<number, number>,
    setUnits: React.Dispatch<React.SetStateAction<Unit[]>>,
    addLog: (text: string, color?: string) => void,
    now: number,
    defeatedThisFrame: Set<number>
): void {
    const casterStats = getUnitStats(caster) as EnemyStats;
    const dmgCtx = buildDamageContext(scene, damageTexts, hitFlashRef, unitsRef, unitsState, setUnits, addLog, now, defeatedThisFrame);

    let hitCount = 0;
    let totalDamage = 0;

    unitsState.forEach(target => {
        if (target.team !== "player" || !isUnitAlive(target, defeatedThisFrame)) return;

        const tg = unitsRef[target.id];
        if (!tg) return;

        // Cone hit test
        if (!isInCone(tg.position.x, tg.position.z, glare)) return;

        const targetData = getUnitStats(target);

        if (rollHit(casterStats.accuracy)) {
            const { damage: dmg } = calculateDamageWithCrit(
                glare.damage[0], glare.damage[1],
                getEffectiveArmor(target, targetData.armor),
                glare.damageType, caster
            );

            applyDamageToUnit(dmgCtx, target.id, tg, target.hp, dmg, targetData.name, {
                color: COLORS.damageEnemy,
                targetUnit: target
            });

            hitCount++;
            totalDamage += dmg;

            // Apply stunned status effect to surviving targets
            const stunnedEffect: StatusEffect = {
                type: "stunned",
                duration: glare.stunDuration,
                tickInterval: BUFF_TICK_INTERVAL,
                timeSinceTick: 0,
                lastUpdateTime: now,
                damagePerTick: 0,
                sourceId: glare.casterId
            };
            setUnits(prev => prev.map(u => {
                if (u.id !== target.id || u.hp <= 0) return u;
                return { ...u, statusEffects: applyStatusEffect(u.statusEffects, stunnedEffect) };
            }));
        }
    });

    // Flash visual effect
    createGlareFlash(scene, glare);

    soundFns.playHit();
    if (hitCount > 0) {
        addLog(logAoeHit(casterStats.name, glare.skillName, hitCount, totalDamage), COLORS.damageEnemy);
        addLog(`Targets are stunned!`, COLORS.stunnedText);
    } else {
        addLog(`${casterStats.name}'s ${glare.skillName} hits nothing!`, COLORS.logNeutral);
    }
}

// =============================================================================
// CONE HIT TEST
// =============================================================================

/**
 * Check if a point (x, z) is within the glare cone.
 */
function isInCone(x: number, z: number, glare: GlareState): boolean {
    const dx = x - glare.coneOriginX;
    const dz = z - glare.coneOriginZ;
    const dist = Math.hypot(dx, dz);

    // Check distance
    if (dist > glare.coneDistance || dist < 0.1) return false;

    // Check angle — angle from origin to point vs facing angle
    const angleToPoint = Math.atan2(dz, dx);
    let angleDiff = angleToPoint - glare.facingAngle;

    // Normalize to [-PI, PI]
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

    return Math.abs(angleDiff) <= glare.coneAngle;
}

// =============================================================================
// VISUAL EFFECTS
// =============================================================================

/**
 * Create a flash effect when the glare detonates.
 */
function createGlareFlash(scene: THREE.Scene, glare: GlareState): void {
    const geometry = new THREE.RingGeometry(0.3, glare.coneDistance, 32, 1, -glare.coneAngle, glare.coneAngle * 2);
    const material = new THREE.MeshBasicMaterial({
        color: "#ccff44",
        transparent: true,
        opacity: 0.8,
        side: THREE.DoubleSide
    });
    const ring = new THREE.Mesh(geometry, material);
    ring.rotation.x = -Math.PI / 2;
    ring.rotation.z = -glare.facingAngle;
    ring.position.set(glare.coneOriginX, 0.3, glare.coneOriginZ);
    scene.add(ring);

    const startTime = getGameTime();
    const duration = 400;

    function animate(): void {
        const elapsed = getGameTime() - startTime;
        const progress = elapsed / duration;

        if (progress >= 1) {
            disposeBasicMesh(scene, ring);
            return;
        }

        const scale = 1 + progress * 1.5;
        ring.scale.set(scale, scale, scale);
        material.opacity = 0.8 * (1 - progress);

        requestAnimationFrame(animate);
    }
    animate();
}

// =============================================================================
// CLEANUP
// =============================================================================

/**
 * Cleanup a glare and remove its visual meshes.
 */
function cleanupGlare(scene: THREE.Scene, glare: GlareState): void {
    glare.meshes.forEach(mesh => {
        disposeBasicMesh(scene, mesh);
    });
}

/**
 * Clear all active glares (for area transitions).
 */
export function clearGlares(scene?: THREE.Scene): void {
    if (scene) {
        activeGlares.forEach(glare => {
            cleanupGlare(scene, glare);
        });
    }
    activeGlares.clear();
    nextGlareId = 0;
}
