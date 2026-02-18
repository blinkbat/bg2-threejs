// =============================================================================
// GAME LOOP - Main entry point, imports from gameLoop/* modules
// =============================================================================

import * as THREE from "three";
import type { Unit, UnitGroup, DamageText, Projectile, FogTexture, SwingAnimation, EnemyStats } from "../core/types";
import { SKILL_SINGLE_TARGET_CHANCE, FORMATION_SLOW_SPEED, BUFF_TICK_INTERVAL } from "../core/constants";
import { getUnitRadius, isInRange } from "../rendering/range";
import { tryKite, type KiteContext } from "../ai/targeting";
import {
    runTargetingPhase, runPathFollowingPhase, runMovementPhase, recalculatePathIfNeeded,
    type TargetingContext, type PathContext, type MovementContext
} from "../ai/unitAI";
import { getUnitStats, getAttackRange } from "../game/units";
import { getUnitById } from "../game/unitQuery";
import { createPathToTarget, clearJitterTracking } from "../ai/movement";
import { getBasicAttackSkill } from "../game/playerUnits";
import type { ActionQueue } from "../input";
import { hasStatusEffect, isUnitAlive, getCooldownMultiplier, setSkillCooldown, isCooldownReady, getEffectiveSpeedMultiplier, applyStatusEffect } from "../combat/combatMath";
import { getAliveUnitsInRange } from "../combat/damageEffects";
import { isEnemyKiting, clearEnemyKiting } from "../game/enemyState";

// Re-export from split modules
export { updateDamageTexts, updateHitFlash, updatePoisonVisuals, updateEnergyShieldVisuals, updateFogOfWar, resetFogCache, updateSpriteFacing, updateAncestorGhostVisuals, resetSpriteFacing } from "./visuals";
export { processStatusEffects } from "./statusEffects";
export { updateProjectiles } from "./projectiles";
export { spawnSwingIndicator, updateSwingAnimations } from "./swingAnimations";
export { processAcidTiles, createAcidTile, createAcidPool, clearAcidTiles } from "./acidTiles";
export { processSanctuaryTiles, createSanctuaryTile, clearSanctuaryTiles } from "./sanctuaryTiles";
export { processHolyTiles, createHolyTile, createHolyCross, clearHolyTiles } from "./holyTiles";
export { processChargeAttacks, clearChargeAttacks, isUnitCharging } from "./constructCharge";
export { processFireBreaths, clearFireBreaths, isUnitBreathing } from "./fireBreath";
export { processCurses, clearCurses } from "./necromancerCurse";
import { executeEnemySwipe, executeEnemyHeal } from "./enemySkills";
import { executeEnemyBasicAttack } from "./enemyAttack";
import { isUnitCharging } from "./constructCharge";
import { isUnitBreathing, startFireBreath } from "./fireBreath";
import { tryStartChargeAttack, tryLeapToTarget, isUnitLeaping, tryVinesSkill, tryAcidSlugPatrol, processAcidTrailAndAura, runPreAttackBehaviors, isShadePhased } from "./enemyBehaviors";
export { clearLeaps, updateLeaps, isUnitLeaping, updateTentacles, clearTentacles, trySubmergeKraken, isKrakenSubmerged, isKrakenFullySubmerged, updateSubmergedKrakens, processGlares, clearGlares, processShadePhases, clearShadePhases, isShadePhased } from "./enemyBehaviors";
export { spawnLootBag, removeLootBag, clearAllLootBags, resetLootBagIds } from "./lootBags";

// Re-export unit ID utilities for backwards compatibility
export { getNextUnitId, initializeUnitIdCounter } from "../core/unitIds";

// =============================================================================
// TYPES
// =============================================================================

export interface GameLoopRefs {
    unitsRef: React.RefObject<Record<number, UnitGroup>>;
    pathsRef: React.MutableRefObject<Record<number, { x: number; z: number }[]>>;
    visibilityRef: React.MutableRefObject<number[][]>;
    actionCooldownRef: React.MutableRefObject<Record<number, number>>;
    damageTexts: React.MutableRefObject<DamageText[]>;
    hitFlashRef: React.MutableRefObject<Record<number, number>>;
    unitMeshRef: React.RefObject<Record<number, THREE.Mesh>>;
    unitOriginalColorRef: React.RefObject<Record<number, THREE.Color>>;
    moveStartRef: React.MutableRefObject<Record<number, { time: number; x: number; z: number }>>;
    projectilesRef: React.MutableRefObject<Projectile[]>;
    fogTextureRef: React.RefObject<FogTexture | null>;
    moveMarkerRef: React.RefObject<THREE.Mesh | null>;
}

export interface GameLoopState {
    unitsStateRef: React.RefObject<Unit[]>;
    pausedRef: React.MutableRefObject<boolean>;
}

// =============================================================================
// UNIT AI & MOVEMENT
// =============================================================================

export function updateUnitAI(
    unit: Unit,
    g: UnitGroup,
    unitsRef: Record<number, UnitGroup>,
    unitsState: Unit[],
    visibility: number[][],
    pathsRef: Record<number, { x: number; z: number }[]>,
    actionCooldownRef: Record<number, number>,
    hitFlashRef: Record<number, number>,
    projectilesRef: Projectile[],
    damageTexts: DamageText[],
    swingAnimations: SwingAnimation[],
    moveStartRef: Record<number, { time: number; x: number; z: number }>,
    scene: THREE.Scene,
    setUnits: React.Dispatch<React.SetStateAction<Unit[]>>,
    addLog: (text: string, color?: string) => void,
    now: number,
    defeatedThisFrame: Set<number>,
    // Skill cooldowns - shared by players and enemies
    skillCooldowns: Record<string, { end: number; duration: number }>,
    setSkillCooldowns: React.Dispatch<React.SetStateAction<Record<string, { end: number; duration: number }>>>,
    // For player AI auto-queueing attacks
    actionQueueRef?: ActionQueue,
    setQueuedActions?: React.Dispatch<React.SetStateAction<{ unitId: number; skillName: string }[]>>,
    // For acid slug enemies
    acidTilesRef?: Map<string, import("../core/types").AcidTile>
): void {
    const isPlayer = unit.team === "player";
    const data = getUnitStats(unit);

    // Enrage trigger: apply "enraged" status when HP drops below threshold
    if (!isPlayer && "enrage" in data && data.enrage && !hasStatusEffect(unit, "enraged")) {
        if (unit.hp / data.maxHp <= data.enrage.hpThreshold) {
            setUnits(prev => prev.map(u =>
                u.id === unit.id
                    ? { ...u, statusEffects: applyStatusEffect(u.statusEffects, {
                        type: "enraged",
                        duration: Number.MAX_SAFE_INTEGER,
                        tickInterval: BUFF_TICK_INTERVAL,
                        timeSinceTick: 0,
                        lastUpdateTime: now,
                        damagePerTick: 0,
                        sourceId: unit.id,
                    }) }
                    : u
            ));
            addLog(`${data.name} becomes enraged!`, "#cc3300");
        }
    }

    // Skip all actions if stunned or asleep - unit cannot move or attack
    if (hasStatusEffect(unit, "stunned") || hasStatusEffect(unit, "sleep")) {
        return;
    }

    const hasDivineLattice = hasStatusEffect(unit, "divine_lattice");

    // Divine Lattice: cannot use skills/attacks, but can still move.
    if (hasDivineLattice) {
        g.userData.attackTarget = null;
        if (actionQueueRef && actionQueueRef[unit.id]?.type === "skill") {
            delete actionQueueRef[unit.id];
            setQueuedActions?.(prev => prev.filter(q => q.unitId !== unit.id));
        }
    }

    // Skip all actions if unit is charging or breathing fire
    if (!isPlayer && (isUnitCharging(unit.id) || isUnitBreathing(unit.id))) {
        return;
    }

    // Wandering Shade phase state: invisible/untargetable and not taking actions.
    if (!isPlayer && isShadePhased(unit.id)) {
        g.userData.attackTarget = null;
        pathsRef[unit.id] = [];
        return;
    }

    // Check if enemy is actively kiting - skip targeting and continue retreat
    if (!isPlayer && isEnemyKiting(unit.id, now)) {
        // Check if kite path is complete
        const kitePath = pathsRef[unit.id];
        if (!kitePath || kitePath.length === 0) {
            // Kiting complete - clear state and allow normal behavior
            clearEnemyKiting(unit.id);
        } else {
            // Still kiting - just do path following and movement
            const pathCtx: PathContext = { unit, g, pathsRef, moveStartRef, now, isPlayer };
            const pathResult = runPathFollowingPhase(pathCtx);
            const movementCtx: MovementContext = { unit, g, unitsRef, unitsState, targetX: pathResult.targetX, targetZ: pathResult.targetZ, speedMultiplier: getEffectiveSpeedMultiplier(unit, data) };
            runMovementPhase(movementCtx);
            return;
        }
    }

    // Phase 1: Targeting - find and validate targets
    const aggroRange = isPlayer ? 12 : (data as { aggroRange: number }).aggroRange;
    const hasFrontShield = !isPlayer && (data as EnemyStats).frontShield === true;
    const hasAggressiveTargeting = !isPlayer && (data as EnemyStats).aggressiveTargeting === true;
    const targetingCtx: TargetingContext = {
        unit, g, unitsRef, unitsState, visibility, pathsRef, moveStartRef,
        now, defeatedThisFrame, aggroRange, hasFrontShield, hasAggressiveTargeting
    };
    runTargetingPhase(targetingCtx);

    // Phase 1.5: Kiting - ranged enemies retreat when players get too close
    const enemyData = !isPlayer ? data as EnemyStats : null;
    if (enemyData) {
        const kiteCtx: KiteContext = { unit, g, unitsRef, unitsState, pathsRef, moveStartRef, now };
        const kiteResult = tryKite(kiteCtx, enemyData);
        if (kiteResult.isKiting) {
            // Jump directly to path following and movement
            const pathCtx: PathContext = { unit, g, pathsRef, moveStartRef, now, isPlayer };
            const pathResult = runPathFollowingPhase(pathCtx);
            const movementCtx: MovementContext = { unit, g, unitsRef, unitsState, targetX: pathResult.targetX, targetZ: pathResult.targetZ, speedMultiplier: getEffectiveSpeedMultiplier(unit, enemyData) };
            runMovementPhase(movementCtx);
            return;
        }
    }

    // Phase 1.55: Acid slug patrol - circle around players spreading acid instead of attacking
    if (!isPlayer && !hasDivineLattice && unit.enemyType === "acid_slug" && acidTilesRef) {
        if (tryAcidSlugPatrol({
            unit, g, slugData: data as EnemyStats, unitsState, unitsRef, pathsRef, moveStartRef,
            scene, skillCooldowns, setSkillCooldowns, acidTilesRef, now
        })) {
            return;
        }
    }

    // Phase 1.6: Enemy heal check - healer enemies try to heal injured allies
    if (!isPlayer && !hasDivineLattice && 'healSkill' in data && data.healSkill) {
        const healSkill = data.healSkill;
        if (isCooldownReady(skillCooldowns, unit.id, healSkill.name, now)) {
            const executed = executeEnemyHeal(
                unit, g, healSkill, data as EnemyStats,
                unitsRef, unitsState, scene, damageTexts,
                setUnits, addLog
            );
            if (executed) {
                setSkillCooldown(setSkillCooldowns, `${unit.id}-${healSkill.name}`, healSkill.cooldown, now, unit);
                actionCooldownRef[unit.id] = now + data.attackCooldown * getCooldownMultiplier(unit);
                return;
            }
        }
    }

    // Phase 1.7-1.86: Fire-and-forget pre-attack behaviors (spawn, raise, tentacle, curse, glare)
    if (!isPlayer && !hasDivineLattice) {
        runPreAttackBehaviors({
            unit, g, enemyStats: data as EnemyStats, unitsState, unitsRef,
            scene, setUnits, skillCooldowns, setSkillCooldowns, addLog, now,
            damageTexts, hitFlashRef, unitsStateRef: { current: unitsState } as React.RefObject<Unit[]>, defeatedThisFrame
        });

        // Shade might have just phase-shifted during pre-attack behavior dispatch.
        if (isShadePhased(unit.id)) {
            g.userData.attackTarget = null;
            pathsRef[unit.id] = [];
            return;
        }
    }

    let targetX = g.position.x, targetZ = g.position.z;

    if (g.userData.attackTarget && !hasDivineLattice) {
        const targetG = unitsRef[g.userData.attackTarget];
        const targetU = getUnitById(g.userData.attackTarget);

        if (targetG && targetU && isUnitAlive(targetU, defeatedThisFrame)) {
            targetX = targetG.position.x;
            targetZ = targetG.position.z;

            // Check if we can cast vines to immobilize target (checked before attack range)
            if (!isPlayer && 'vinesSkill' in data && data.vinesSkill) {
                const unitsStateRef = { current: unitsState } as React.RefObject<Unit[]>;
                tryVinesSkill({
                    unit, g, enemyStats: data as EnemyStats, vinesSkill: data.vinesSkill,
                    targetUnit: targetU, targetG, scene,
                    skillCooldowns, setSkillCooldowns, setUnits, addLog, now,
                    damageTexts, hitFlashRef, unitsRef, unitsStateRef, defeatedThisFrame
                });
                // Don't return - druid can still attack/move after casting vines
            }

            const unitRange = getAttackRange(unit);

            // Use hitbox-aware range: if closest edge of target is in range, we can attack
            const targetRadius = getUnitRadius(targetU);
            const inAttackRange = isInRange(g.position.x, g.position.z, targetX, targetZ, targetRadius, unitRange);

            if (inAttackRange && pathsRef[unit.id]?.length > 0) {
                pathsRef[unit.id] = [];
            }

            if (inAttackRange) {
                const cooldownEnd = actionCooldownRef[unit.id] || 0;

                // Acid slugs prioritize acid aura over attacking - check if aura is ready
                let skipAttackForAcidAura = false;
                if (!isPlayer && 'acidAura' in data && data.acidAura) {
                    const auraCooldownKey = `${unit.id}-acidAura`;
                    const auraCooldownEnd = skillCooldowns[auraCooldownKey]?.end || 0;
                    if (now >= auraCooldownEnd) {
                        skipAttackForAcidAura = true;
                    }
                }

                if (now >= cooldownEnd && !skipAttackForAcidAura) {
                    // Check if enemy has a breath skill and it's ready (cone-only attacker)
                    if (!isPlayer && 'breathSkill' in data && data.breathSkill) {
                        const breathSkill = data.breathSkill;
                        if (isCooldownReady(skillCooldowns, unit.id, breathSkill.name, now)) {
                            startFireBreath(scene, unit, g, breathSkill, targetU.id, targetG, now, setSkillCooldowns, addLog);
                            return;
                        }
                    }

                    // Check if enemy has a charge attack and it's ready
                    if (!isPlayer && 'chargeAttack' in data && data.chargeAttack) {
                        if (tryStartChargeAttack({
                            unit, g, enemyStats: data as EnemyStats, chargeAttack: data.chargeAttack, scene,
                            skillCooldowns, setSkillCooldowns, addLog, now
                        })) {
                            return;
                        }
                    }

                    // Check if enemy has a skill and it's ready
                    if (!isPlayer && 'skill' in data && data.skill) {
                        const skill = data.skill;
                        const enemySkillKey = `${unit.id}-${skill.name}`;
                        const skillCooldownEnd = skillCooldowns[enemySkillKey]?.end || 0;

                        // Use skill if: cooldown ready AND targets in range (hitbox-aware)
                        const inSkillRange = isInRange(g.position.x, g.position.z, targetX, targetZ, targetRadius, skill.range);
                        if (now >= skillCooldownEnd && inSkillRange) {
                            // Count potential targets (using hitbox-aware range)
                            const potentialTargets = getAliveUnitsInRange(unitsState, unitsRef, "player", g.position.x, g.position.z, skill.range, defeatedThisFrame);

                            // Use skill if there are 2+ targets, or randomly with 1 target
                            if (potentialTargets.length >= 2 || (potentialTargets.length === 1 && Math.random() < SKILL_SINGLE_TARGET_CHANCE)) {
                                const executed = executeEnemySwipe(
                                    unit, g, skill, data as EnemyStats,
                                    unitsRef, unitsState, scene, damageTexts,
                                    hitFlashRef, setUnits, addLog, now, defeatedThisFrame
                                );
                                if (executed) {
                                    setSkillCooldown(setSkillCooldowns, enemySkillKey, skill.cooldown, now, unit);
                                    actionCooldownRef[unit.id] = now + data.attackCooldown * getCooldownMultiplier(unit);
                                    return;
                                }
                            }
                        }
                    }

                    // Player units: queue attack skill (processed by action queue)
                    // AI enabled = auto-queue attacks, AI disabled = only manual attacks (already in queue)
                    if (isPlayer) {
                        if (unit.aiEnabled && actionQueueRef && setQueuedActions) {
                            // Auto-queue if not already queued
                            if (!actionQueueRef[unit.id]) {
                                const basicAttack = getBasicAttackSkill(unit.id);
                                actionQueueRef[unit.id] = {
                                    type: "skill",
                                    skill: basicAttack,
                                    targetX: targetG.position.x,
                                    targetZ: targetG.position.z,
                                    targetId: targetU.id
                                };
                                setQueuedActions(prev => [
                                    ...prev.filter(q => q.unitId !== unit.id),
                                    { unitId: unit.id, skillName: basicAttack.name }
                                ]);
                            }
                        }
                        // Player attacks always go through skill queue - don't execute directly
                        return;
                    }

                    // Enemy units: execute attack directly (they don't use player skill queue)
                    const cooldownMult = getCooldownMultiplier(unit);
                    const attackCooldownEnd = now + data.attackCooldown * cooldownMult;
                    actionCooldownRef[unit.id] = attackCooldownEnd;

                    // Execute enemy basic attack (ranged or melee)
                    const unitsStateRef = { current: unitsState } as React.RefObject<Unit[]>;
                    executeEnemyBasicAttack({
                        scene, attacker: unit, attackerG: g, target: targetU, targetG,
                        attackerStats: data as EnemyStats, damageTexts, hitFlashRef, unitsRef,
                        unitsStateRef, setUnits, addLog, now, defeatedThisFrame, swingAnimations, projectilesRef
                    });
                }
                return;
            } else {
                // Hold position: drop target instead of chasing
                if (isPlayer && unit.holdPosition) {
                    g.userData.attackTarget = null;
                    if (actionQueueRef && actionQueueRef[unit.id]) {
                        delete actionQueueRef[unit.id];
                        setQueuedActions?.(prev => prev.filter(q => q.unitId !== unit.id));
                    }
                    return;
                }

                // Not in attack range - check if we can leap to close distance
                if (!isPlayer && 'leapSkill' in data && data.leapSkill && !isUnitLeaping(unit.id)) {
                    const leapSkill = data.leapSkill;
                    if (tryLeapToTarget({
                        unit, g, enemyStats: data as EnemyStats, leapSkill,
                        targetUnit: targetU, targetG, scene,
                        skillCooldowns, setSkillCooldowns, setUnits, addLog, now
                    })) {
                        return;  // Leaping - don't path or move
                    }
                }

                // Recalculate path if needed (but not if we recently gave up)
                recalculatePathIfNeeded(unit, g, targetX, targetZ, pathsRef, moveStartRef, now);
            }
        } else {
            g.userData.attackTarget = null;
            // Clear any queued attack action since target is no longer valid
            if (isPlayer && actionQueueRef && actionQueueRef[unit.id]) {
                delete actionQueueRef[unit.id];
                setQueuedActions?.(prev => prev.filter(q => q.unitId !== unit.id));
            }
            // Attack-move: resume path to original destination after target dies
            if (isPlayer && g.userData.attackMoveTarget) {
                const dest = g.userData.attackMoveTarget;
                const result = createPathToTarget(g.position.x, g.position.z, dest.x, dest.z);
                if (result.success) {
                    pathsRef[unit.id] = result.path;
                    moveStartRef[unit.id] = { time: now, x: g.position.x, z: g.position.z };
                    g.userData.moveTarget = { x: dest.x, z: dest.z };
                    delete g.userData.formationRegroupAttempted;
                    clearJitterTracking(unit.id);
                }
            }
        }
    }

    // Skip movement phases if unit is currently leaping
    if (isUnitLeaping(unit.id)) {
        return;
    }

    // Phase 3: Path following - advance waypoints and handle stuck detection
    const pathCtx: PathContext = { unit, g, pathsRef, moveStartRef, now, isPlayer };
    const pathResult = runPathFollowingPhase(pathCtx);
    targetX = pathResult.targetX;
    targetZ = pathResult.targetZ;

    // Track old position for acid trail (before movement)
    const oldGridX = Math.floor(g.position.x);
    const oldGridZ = Math.floor(g.position.z);

    // Phase 4: Movement - move toward target with avoidance and wall sliding
    // Pinned units cannot move (speed = 0), slowed units move at half speed
    let speedMult = getEffectiveSpeedMultiplier(unit, data);
    // Formation: smoothly throttle until the row ahead has opened enough space.
    const ramp = isPlayer ? g.userData.formationRamp : undefined;
    if (ramp) {
        const recentlyDamaged = g.userData.lastHitTime && (now - g.userData.lastHitTime) < 500;
        if (recentlyDamaged) {
            // Took damage recently — break formation, move at full speed
            delete g.userData.formationRamp;
        } else {
            const aheadG = unitsRef[ramp.leaderId];
            if (!aheadG) {
                delete g.userData.formationRamp;
            } else {
                const aheadRemain = Math.hypot(ramp.leaderTargetX - aheadG.position.x, ramp.leaderTargetZ - aheadG.position.z);
                const myRemain = Math.hypot(targetX - g.position.x, targetZ - g.position.z);
                const leaderStartDist = Math.max(ramp.leaderStartDist ?? aheadRemain, 0.001);
                const myStartDist = Math.max(ramp.myStartDist ?? myRemain, 0.001);
                const aheadProgress = 1 - Math.min(1, aheadRemain / leaderStartDist);
                const myProgress = 1 - Math.min(1, myRemain / myStartDist);
                const progressGap = aheadProgress - myProgress;
                if (myRemain < 0.15 || aheadProgress > 0.98) {
                    // Row ahead is further along — full speed, done with ramp
                    delete g.userData.formationRamp;
                } else {
                    // Row ahead is behind us or even — crawl
                    const blend = Math.max(0, Math.min(1, (progressGap + 0.2) / 0.4));
                    const minFormationSpeed = Math.max(FORMATION_SLOW_SPEED, 0.62);
                    const formationSpeed = minFormationSpeed + (1 - minFormationSpeed) * blend;
                    speedMult *= formationSpeed;
                }
            }
        }
    }
    const movementCtx: MovementContext = { unit, g, unitsRef, unitsState, targetX, targetZ, speedMultiplier: speedMult };
    runMovementPhase(movementCtx);

    // Phase 5: Acid slug - create acid trail when moving, aura when stationary
    if (!isPlayer && acidTilesRef && !hasDivineLattice) {
        const newGridX = Math.floor(g.position.x);
        const newGridZ = Math.floor(g.position.z);
        processAcidTrailAndAura(data as EnemyStats, scene, acidTilesRef, skillCooldowns, setSkillCooldowns, unit.id, oldGridX, oldGridZ, newGridX, newGridZ, now);
    }
}

// =============================================================================
// HP BAR POSITIONS
// =============================================================================

// Reusable vector for HP bar position calculations
const _hpWorldPos = new THREE.Vector3();

export function updateHpBarPositions(
    unitsState: Unit[],
    unitsRef: Record<number, UnitGroup>,
    camera: THREE.OrthographicCamera,
    rendererRect: DOMRect,
    zoomLevel: number
): { positions: Record<number, { x: number; y: number; visible: boolean }>; scale: number } {
    const positions: Record<number, { x: number; y: number; visible: boolean }> = {};
    const halfWidth = rendererRect.width * 0.5;
    const halfHeight = rendererRect.height * 0.5;

    for (const u of unitsState) {
        const g = unitsRef[u.id];
        if (!g) continue;
        const isPlayer = u.team === "player";
        const data = getUnitStats(u);
        const size = (!isPlayer && 'size' in data && data.size) ? data.size : 1;
        const boxH = isPlayer ? 1.8 : (size > 1 ? 1.8 : 0.6);
        _hpWorldPos.set(g.position.x, boxH + 0.4, g.position.z);
        _hpWorldPos.project(camera);
        positions[u.id] = {
            x: (_hpWorldPos.x + 1) * halfWidth,
            y: (-_hpWorldPos.y + 1) * halfHeight,
            visible: g.visible && u.hp > 0
        };
    }

    return { positions, scale: 10 / zoomLevel };
}

// =============================================================================
// SHIELD FACING UPDATE
// =============================================================================

// Turn speed in radians per frame (at 60fps)
const TURN_SPEED_STATIONARY = 0.35;  // Fast turn when standing still
const TURN_SPEED_MOVING = 0.10;      // Slower turn when moving
const DAMAGE_SOURCE_PRIORITY_TIME = 2000;  // ms - prioritize damage source for 2 seconds
// Only sync facing to React state when visual differs from committed state by this much
const FACING_REACT_THRESHOLD = 0.05;  // ~3 degrees

/**
 * Update shield facing for front-shielded enemies.
 * They rotate toward damage sources (when hit recently) or their target.
 * Turn speed is faster when stationary, slower when moving.
 * Visual mesh updates every frame; React state only syncs when change exceeds threshold.
 */
export function updateShieldFacing(
    unitsState: Unit[],
    unitsRef: Record<number, UnitGroup>,
    shieldIndicators: Record<number, THREE.Mesh>,
    setUnits: React.Dispatch<React.SetStateAction<Unit[]>>
): void {
    const facingUpdates = new Map<number, number>();
    const now = Date.now();

    for (const unit of unitsState) {
        if (unit.team === "player" || unit.hp <= 0) continue;

        const data = getUnitStats(unit) as EnemyStats;
        if (!data.frontShield) continue;

        const g = unitsRef[unit.id];
        const shieldMesh = shieldIndicators[unit.id];
        if (!g || !shieldMesh) continue;

        // Use visual facing for smooth per-frame tracking (independent of React state)
        let currentFacing: number = g.userData.visualFacing ?? (unit.facing ?? 0);

        // Determine target position - prioritize recent damage source
        let targetX: number | undefined;
        let targetZ: number | undefined;
        const damageSource = g.userData.lastDamageSource;

        if (damageSource && (now - damageSource.time) < DAMAGE_SOURCE_PRIORITY_TIME) {
            targetX = damageSource.x;
            targetZ = damageSource.z;
        } else if (g.userData.attackTarget !== null) {
            const targetG = unitsRef[g.userData.attackTarget];
            if (targetG) {
                targetX = targetG.position.x;
                targetZ = targetG.position.z;
            } else if (g.userData.targetX !== undefined && g.userData.targetZ !== undefined) {
                targetX = g.userData.targetX;
                targetZ = g.userData.targetZ;
            }
        } else if (g.userData.targetX !== undefined && g.userData.targetZ !== undefined) {
            targetX = g.userData.targetX;
            targetZ = g.userData.targetZ;
        }

        if (targetX === undefined || targetZ === undefined) {
            continue;
        }

        const dx = targetX - g.position.x;
        const dz = targetZ - g.position.z;
        const dist = Math.hypot(dx, dz);

        if (dist > 0.1) {
            const targetAngle = Math.atan2(dx, dz);
            let angleDiff = targetAngle - currentFacing;

            while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
            while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

            const moveDistX = Math.abs(g.userData.targetX - g.position.x);
            const moveDistZ = Math.abs(g.userData.targetZ - g.position.z);
            const isMoving = moveDistX > 0.2 || moveDistZ > 0.2;

            const baseTurnSpeed = isMoving ? TURN_SPEED_MOVING : TURN_SPEED_STATIONARY;
            const turnSpeed = baseTurnSpeed * (data.turnSpeed ?? 1);

            if (Math.abs(angleDiff) < turnSpeed) {
                currentFacing = targetAngle;
            } else {
                currentFacing += turnSpeed * Math.sign(angleDiff);
            }

            while (currentFacing > Math.PI) currentFacing -= Math.PI * 2;
            while (currentFacing < -Math.PI) currentFacing += Math.PI * 2;
        }

        // Always update the visual (smooth every frame)
        g.userData.visualFacing = currentFacing;
        shieldMesh.rotation.z = currentFacing - Math.PI / 2;

        // Only queue React update when visual drifts far enough from committed state
        const reactFacing = unit.facing ?? 0;
        let reactDiff = currentFacing - reactFacing;
        while (reactDiff > Math.PI) reactDiff -= Math.PI * 2;
        while (reactDiff < -Math.PI) reactDiff += Math.PI * 2;
        if (Math.abs(reactDiff) > FACING_REACT_THRESHOLD) {
            facingUpdates.set(unit.id, currentFacing);
        }
    }

    // Batch update unit facing values (Map.get is O(1) vs .find O(n))
    if (facingUpdates.size > 0) {
        setUnits(prev => prev.map(u => {
            const facing = facingUpdates.get(u.id);
            return facing !== undefined ? { ...u, facing } : u;
        }));
    }
}
