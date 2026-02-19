// =============================================================================
// UNIT AI - Modular AI phases for unit behavior
// =============================================================================

import {
    MOVE_SPEED,
    getDebugSpeedMultiplier,
    AVOIDANCE_RANGE_MULTIPLIER, AVOIDANCE_OVERLAP_STRENGTH,
    AVOIDANCE_STEER_THRESHOLD, AVOIDANCE_STEER_STRENGTH,
    MOVEMENT_MIN_DIST, MOVEMENT_MIN_MAGNITUDE,
    PLAYER_MOVE_TIMEOUT_MS,
    DEFAULT_UNIT_RADIUS
} from "../core/constants";
import { findPath, isPassable } from "./pathfinding";
import {
    canScanForTargets, recordTargetScan, getBlockedTargets,
    recentlyGaveUp, checkPathNeedsRecalc, createPathToTarget,
    hasReachedWaypoint, checkIfStuck, handleGiveUp, clearJitterTracking,
    canRecalculatePath, recordPathRecalculation
} from "./movement";
import { getUnitRadius } from "../rendering/range";
import { clampToGrid, distanceBetween } from "../game/geometry";
import { getAttackRange } from "../game/units";
import { ENEMY_STATS } from "../game/enemyStats";
import { hasStatusEffect, isUnitAlive } from "../combat/combatMath";
import { isEnemyUntargetable } from "../gameLoop/enemyBehaviors";
import { getUnitById } from "../game/unitQuery";
import type { Unit, UnitGroup } from "../core/types";

function getMovementFlags(unit: Unit): { isFlying: boolean; canTraverseWaterTerrain: boolean } {
    const enemyType = unit.team === "enemy" ? unit.enemyType : undefined;
    return {
        isFlying: !!(enemyType && ENEMY_STATS[enemyType]?.flying === true),
        canTraverseWaterTerrain: enemyType === "baby_kraken"
    };
}

/**
 * Check if a broodling's mother can see any player.
 * Returns the nearest player to the broodling if mother can see ANY player.
 * Broodlings act like guided missiles while their mother lives.
 */
function getMothersSightTarget(
    unit: Unit,
    unitsState: Unit[],
    unitsRef: Record<number, UnitGroup>,
    defeatedThisFrame: Set<number>
): { targetId: number; dist: number } | null {
    // Only applies to broodlings with a living mother
    if (unit.enemyType !== "broodling" || !unit.spawnedBy) return null;

    const mother = getUnitById(unit.spawnedBy!);
    if (!mother || mother.hp <= 0) return null;

    const motherG = unitsRef[mother.id];
    if (!motherG) return null;

    const broodlingG = unitsRef[unit.id];
    if (!broodlingG) return null;

    // Check if mother can see ANY player (use mother's aggro range)
    const motherStats = ENEMY_STATS.brood_mother;
    let motherCanSeeAnyPlayer = false;

    for (const player of unitsState) {
        if (player.team !== "player" || player.hp <= 0) continue;
        if (hasStatusEffect(player, "divine_lattice")) continue;
        if (defeatedThisFrame.has(player.id)) continue;

        const playerG = unitsRef[player.id];
        if (!playerG) continue;

        // Distance from MOTHER to player
        const motherToPlayer = Math.hypot(
            motherG.position.x - playerG.position.x,
            motherG.position.z - playerG.position.z
        );

        if (motherToPlayer <= motherStats.aggroRange) {
            motherCanSeeAnyPlayer = true;
            break;
        }
    }

    // If mother can't see anyone, broodling relies on its own limited sight
    if (!motherCanSeeAnyPlayer) return null;

    // Mother can see players - broodling targets the NEAREST player to itself
    // This makes broodlings act like guided missiles
    let nearestTarget: { targetId: number; dist: number } | null = null;

    for (const player of unitsState) {
        if (player.team !== "player" || player.hp <= 0) continue;
        if (hasStatusEffect(player, "divine_lattice")) continue;
        if (defeatedThisFrame.has(player.id)) continue;

        const playerG = unitsRef[player.id];
        if (!playerG) continue;

        const broodlingToPlayer = Math.hypot(
            broodlingG.position.x - playerG.position.x,
            broodlingG.position.z - playerG.position.z
        );

        if (!nearestTarget || broodlingToPlayer < nearestTarget.dist) {
            nearestTarget = { targetId: player.id, dist: broodlingToPlayer };
        }
    }

    return nearestTarget;
}

// =============================================================================
// TARGETING PHASE
// =============================================================================

export interface TargetingContext {
    unit: Unit;
    g: UnitGroup;
    unitsRef: Record<number, UnitGroup>;
    unitsState: Unit[];
    visibility: number[][];
    pathsRef: Record<number, { x: number; z: number }[]>;
    moveStartRef: Record<number, { time: number; x: number; z: number }>;
    now: number;
    defeatedThisFrame: Set<number>;
    aggroRange: number;
    hasFrontShield?: boolean;  // Front-shielded enemies reacquire targets immediately
    hasAggressiveTargeting?: boolean;  // Boss enemies that aggressively retarget
    hasFastRetargeting?: boolean;  // Medium+ or slow enemies retarget more aggressively
}

const FAST_RETARGET_SCAN_INTERVAL = 250;

/**
 * Check if the current attack target is still valid (alive, not defeated, not untargetable).
 */
export function validateCurrentTarget(
    currentTarget: number | null | undefined,
    defeatedThisFrame: Set<number>
): { valid: boolean; targetUnit: Unit | undefined } {
    if (currentTarget === null || currentTarget === undefined) {
        return { valid: false, targetUnit: undefined };
    }
    const targetUnit = getUnitById(currentTarget);
    // Invalid if dead, defeated this frame, or currently untargetable.
    const valid = targetUnit !== undefined &&
        isUnitAlive(targetUnit, defeatedThisFrame) &&
        !isEnemyUntargetable(currentTarget);
    return { valid, targetUnit };
}

/**
 * Find the nearest valid enemy target within aggro range.
 * If alerted is true, ignores aggro range and searches entire map.
 * Broodlings can also see through their mother's eyes if she's alive.
 */
export function findNearestTarget(ctx: TargetingContext, alerted: boolean = false): number | null {
    const { unit, g, unitsRef, unitsState, visibility, now, defeatedThisFrame, aggroRange } = ctx;
    const isPlayer = unit.team === "player";
    const enemyTeam = isPlayer ? "enemy" : "player";

    // For enemies, get list of targets they recently couldn't reach
    const blockedTargets = !isPlayer ? getBlockedTargets(unit.id, now) : [];

    let nearest: number | null = null;
    // Alerted enemies search the whole map, otherwise use aggro range
    let nearestDist = alerted ? Infinity : aggroRange;

    // Broodlings can see through their mother's eyes - they act as guided missiles
    // If mother can see ANY player, broodling targets the nearest player to itself
    // regardless of the broodling's own limited aggro range
    if (!isPlayer && unit.enemyType === "broodling") {
        const motherTarget = getMothersSightTarget(unit, unitsState, unitsRef, defeatedThisFrame);
        if (motherTarget && !blockedTargets.includes(motherTarget.targetId)) {
            // Mother can see a player - broodling ALWAYS targets them (missile behavior)
            // Set this as the target and use its distance as the reference
            nearest = motherTarget.targetId;
            nearestDist = motherTarget.dist;
            // Return early - broodlings with mother sight don't need to check their own limited range
            return nearest;
        }
    }

    for (const enemy of unitsState) {
        if (enemy.team !== enemyTeam || enemy.hp <= 0) continue;
        if (hasStatusEffect(enemy, "divine_lattice")) continue;
        if (defeatedThisFrame.has(enemy.id)) continue;
        if (blockedTargets.includes(enemy.id)) continue;
        // Skip untargetable enemies.
        if (isEnemyUntargetable(enemy.id)) continue;

        const eg = unitsRef[enemy.id];
        if (!eg) continue;

        // Players need line of sight, enemies see all
        if (isPlayer) {
            const enemyX = Math.floor(eg.position.x);
            const enemyZ = Math.floor(eg.position.z);
            if (visibility[enemyX]?.[enemyZ] !== 2) continue;
        }

        const d = distanceBetween(g.position, eg.position);
        if (d < nearestDist) {
            nearestDist = d;
            nearest = enemy.id;
        }
    }

    return nearest;
}

/**
 * Acquire a new target and calculate path to it.
 * Returns true if path was found or unit is already in range, false if target is unreachable.
 */
export function acquireTarget(ctx: TargetingContext, targetId: number): boolean {
    const { unit, g, unitsRef, pathsRef, moveStartRef, now } = ctx;
    const isPlayer = unit.team === "player";

    const targetG = unitsRef[targetId];
    if (!targetG) {
        pathsRef[unit.id] = [];
        return false;
    }

    const dist = distanceBetween(g.position, targetG.position);
    const attackRange = getAttackRange(unit);

    // Hold position: only engage targets already in range
    if (isPlayer && unit.holdPosition) {
        if (dist < attackRange) {
            g.userData.attackTarget = targetId;
            pathsRef[unit.id] = [];
            return true;
        }
        return false;
    }

    g.userData.attackTarget = targetId;

    if (dist < attackRange) {
        // Already in attack range, no path needed
        pathsRef[unit.id] = [];
        return true;
    }

    const { isFlying, canTraverseWaterTerrain } = getMovementFlags(unit);
    const path = findPath(
        g.position.x,
        g.position.z,
        targetG.position.x,
        targetG.position.z,
        0,
        isFlying,
        canTraverseWaterTerrain
    );
    if (path && path.length > 0) {
        pathsRef[unit.id] = path.slice(1);
        moveStartRef[unit.id] = { time: now, x: g.position.x, z: g.position.z };
        clearJitterTracking(unit.id);  // Reset jitter detection for new path
        return true;
    } else {
        // No path found and not in range - mark as unreachable for enemies
        pathsRef[unit.id] = [];
        if (!isPlayer) {
            handleGiveUp(unit.id, isPlayer, targetId, now);
            g.userData.attackTarget = null;
        }
        return false;
    }
}

/**
 * Find the unit that recently damaged this enemy (for front-shielded enemies).
 * Returns the unit ID if they're still alive and in aggro range.
 */
function findRecentDamageSource(ctx: TargetingContext): number | null {
    const { g, unitsRef, unitsState, defeatedThisFrame, aggroRange, now } = ctx;
    const damageSource = g.userData.lastDamageSource;

    // Only consider damage from last 2 seconds (recent attack)
    if (!damageSource || (now - damageSource.time) > 2000) {
        return null;
    }

    // Find the player closest to the damage source position
    // (Since we track position, not ID, find closest player to that spot)
    // Use larger radius since players move around while attacking
    let closestId: number | null = null;
    let closestDist = 4.0;  // Must be within 4 units of the tracked position

    for (const player of unitsState) {
        if (player.team !== "player" || player.hp <= 0) continue;
        if (hasStatusEffect(player, "divine_lattice")) continue;
        if (defeatedThisFrame.has(player.id)) continue;

        const pg = unitsRef[player.id];
        if (!pg) continue;

        // Check if this player is near the damage source position
        const distToSource = Math.hypot(
            pg.position.x - damageSource.x,
            pg.position.z - damageSource.z
        );

        // And also in aggro range from the enemy (extended for flankers)
        const distToEnemy = Math.hypot(
            pg.position.x - g.position.x,
            pg.position.z - g.position.z
        );

        if (distToSource < closestDist && distToEnemy <= aggroRange * 2) {
            closestDist = distToSource;
            closestId = player.id;
        }
    }

    return closestId;
}

/**
 * Run the targeting phase - validate current target or find a new one.
 */
export function runTargetingPhase(ctx: TargetingContext): void {
    const { unit, g, pathsRef, now, hasFrontShield } = ctx;
    const isPlayer = unit.team === "player";
    const usesFastRetargeting = !isPlayer && ctx.hasFastRetargeting === true;
    if (hasStatusEffect(unit, "divine_lattice")) {
        g.userData.attackTarget = null;
        return;
    }
    const shouldAutoTarget = isPlayer ? unit.aiEnabled : true;

    // Check if enemy is alerted (was hit by a player)
    const isAlerted = !isPlayer && g.userData.alerted === true;

    // Check if current target is still valid
    let { valid: targetStillValid } = validateCurrentTarget(
        g.userData.attackTarget,
        ctx.defeatedThisFrame
    );
    let targetProtectedByLattice = false;
    if (targetStillValid && g.userData.attackTarget !== null) {
        const protectedTarget = getUnitById(g.userData.attackTarget);
        if (protectedTarget && hasStatusEffect(protectedTarget, "divine_lattice")) {
            targetStillValid = false;
            targetProtectedByLattice = true;
        }
    }

    if (!targetStillValid) {
        g.userData.attackTarget = null;
        if (!isPlayer && targetProtectedByLattice) {
            pathsRef[unit.id] = [];
        }
    }

    // Alerted enemies immediately search for nearest target, ignoring normal constraints
    if (isAlerted && !targetStillValid) {
        const nearest = findNearestTarget(ctx, true);
        if (nearest !== null) {
            acquireTarget(ctx, nearest);
        }
        // Clear alerted flag once they've acquired a target (or tried to)
        g.userData.alerted = false;
        return;
    }

    // Aggressive damage-source retargeting for shielded enemies and explicit boss configs.
    const shouldRetargetToDamageSource = (hasFrontShield || ctx.hasAggressiveTargeting) && !isPlayer;
    if (shouldRetargetToDamageSource) {
        // ALWAYS check for recent damage source - switch targets if someone hit us
        const damageSourceTarget = findRecentDamageSource(ctx);
        if (damageSourceTarget !== null && damageSourceTarget !== g.userData.attackTarget) {
            // Switch to whoever is attacking us
            acquireTarget(ctx, damageSourceTarget);
            recordTargetScan(unit.id, now);
            return;
        }
    }

    // Fast-retarget units (medium+ or slow movers) bypass scan cooldown when target is lost.
    if (!isPlayer && (shouldRetargetToDamageSource || usesFastRetargeting) && !targetStillValid && !recentlyGaveUp(unit.id, now)) {
        const nearest = findNearestTarget(ctx);
        if (nearest !== null) {
            acquireTarget(ctx, nearest);
            recordTargetScan(unit.id, now);
            return;
        }
    }

    // Determine if we should look for a new target
    const hasActivePath = pathsRef[unit.id]?.length > 0;
    const isAttackMoving = isPlayer && g.userData.attackMoveTarget !== undefined;
    const isExecutingMoveCommand = (hasActivePath || g.userData.pendingMove) && g.userData.attackTarget === null && !isAttackMoving;
    const canAutoTarget = shouldAutoTarget && !targetStillValid && !isExecutingMoveCommand;
    const canScan = usesFastRetargeting
        ? canScanForTargets(unit.id, now, FAST_RETARGET_SCAN_INTERVAL)
        : canScanForTargets(unit.id, now);

    if (canAutoTarget && canScan) {
        recordTargetScan(unit.id, now);

        // Don't start new path if we recently gave up (prevents jitter)
        if (!recentlyGaveUp(unit.id, now)) {
            const nearest = findNearestTarget(ctx);
            if (nearest !== null) {
                acquireTarget(ctx, nearest);
            }
        }
    }
}

// =============================================================================
// MOVEMENT TARGET - Single source of truth for where a unit should move
// =============================================================================

export interface MovementTargetContext {
    unit: Unit;
    g: UnitGroup;
    unitsRef: Record<number, UnitGroup>;
    unitsState: Unit[];
    pathsRef: Record<number, { x: number; z: number }[]>;
}

/**
 * Get the movement target for a unit - single source of truth.
 * Priority: attack target position > path waypoint > current position (idle)
 */
export function getMovementTarget(ctx: MovementTargetContext): { x: number; z: number; hasTarget: boolean } {
    const { unit, g, unitsRef, pathsRef } = ctx;

    // Priority 1: If we have an attack target, move toward it
    if (g.userData.attackTarget !== null && g.userData.attackTarget !== undefined) {
        const targetG = unitsRef[g.userData.attackTarget];
        const targetU = getUnitById(g.userData.attackTarget);

        if (targetG && targetU && targetU.hp > 0) {
            return { x: targetG.position.x, z: targetG.position.z, hasTarget: true };
        }
    }

    // Priority 2: If we have a path, follow it
    const path = pathsRef[unit.id];
    if (path && path.length > 0) {
        return { x: path[0].x, z: path[0].z, hasTarget: true };
    }

    // No target - idle at current position
    return { x: g.position.x, z: g.position.z, hasTarget: false };
}

// =============================================================================
// PATH FOLLOWING PHASE
// =============================================================================

export interface PathContext {
    unit: Unit;
    g: UnitGroup;
    pathsRef: Record<number, { x: number; z: number }[]>;
    moveStartRef: Record<number, { time: number; x: number; z: number }>;
    now: number;
    isPlayer: boolean;
}

const PATH_SHORTCUT_MAX_LOOKAHEAD = 4;
const PATH_SHORTCUT_SAMPLE_STEP = 0.35;
const LOCAL_DETOUR_DISTANCE = 1.15;
const LOCAL_DETOUR_ANGLE_OFFSETS = [Math.PI / 2, -Math.PI / 2, Math.PI / 4, -Math.PI / 4, (Math.PI * 3) / 4, -(Math.PI * 3) / 4];

function hasPassableSegment(
    startX: number,
    startZ: number,
    endX: number,
    endZ: number,
    flying: boolean,
    canTraverseWaterTerrain: boolean
): boolean {
    const dx = endX - startX;
    const dz = endZ - startZ;
    const dist = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.ceil(dist / PATH_SHORTCUT_SAMPLE_STEP));
    for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const sampleX = startX + dx * t;
        const sampleZ = startZ + dz * t;
        if (!isPassable(Math.floor(sampleX), Math.floor(sampleZ), flying, canTraverseWaterTerrain)) {
            return false;
        }
    }
    return true;
}

function tryBuildLocalDetourPath(
    currentX: number,
    currentZ: number,
    towardX: number,
    towardZ: number,
    finalGoalX: number,
    finalGoalZ: number,
    flying: boolean,
    canTraverseWaterTerrain: boolean
): { x: number; z: number }[] | null {
    const baseAngle = Math.atan2(towardZ - currentZ, towardX - currentX);

    for (const offset of LOCAL_DETOUR_ANGLE_OFFSETS) {
        const angle = baseAngle + offset;
        const detourX = currentX + Math.cos(angle) * LOCAL_DETOUR_DISTANCE;
        const detourZ = currentZ + Math.sin(angle) * LOCAL_DETOUR_DISTANCE;

        if (!isPassable(Math.floor(detourX), Math.floor(detourZ), flying, canTraverseWaterTerrain)) {
            continue;
        }

        const toDetour = createPathToTarget(
            currentX,
            currentZ,
            detourX,
            detourZ,
            flying,
            canTraverseWaterTerrain
        );
        if (!toDetour.success || toDetour.path.length === 0) {
            continue;
        }

        const toGoal = createPathToTarget(
            detourX,
            detourZ,
            finalGoalX,
            finalGoalZ,
            flying,
            canTraverseWaterTerrain
        );
        if (toGoal.success && toGoal.path.length > 0) {
            return [...toDetour.path, ...toGoal.path];
        }

        return toDetour.path;
    }

    return null;
}

/**
 * Run the path following phase - advance along path, handle stuck detection.
 * Returns the current movement target position.
 */
export function runPathFollowingPhase(ctx: PathContext): { targetX: number; targetZ: number } {
    const { unit, g, pathsRef, moveStartRef, now, isPlayer } = ctx;
    const path = pathsRef[unit.id];
    const isPlayerMoveCommand = isPlayer && g.userData.attackTarget === null;

    let targetX = g.position.x;
    let targetZ = g.position.z;

    if (path && path.length > 0) {
        targetX = path[0].x;
        targetZ = path[0].z;
        const { isFlying, canTraverseWaterTerrain } = getMovementFlags(unit);

        // Try to skip near-term waypoints when a direct segment is clear.
        if (path.length > 1) {
            const maxLookahead = Math.min(PATH_SHORTCUT_MAX_LOOKAHEAD, path.length - 1);
            for (let i = maxLookahead; i >= 1; i--) {
                const candidate = path[i];
                if (hasPassableSegment(
                    g.position.x,
                    g.position.z,
                    candidate.x,
                    candidate.z,
                    isFlying,
                    canTraverseWaterTerrain
                )) {
                    path.splice(0, i);
                    targetX = path[0].x;
                    targetZ = path[0].z;
                    break;
                }
            }
        }

        // Check if we've reached the current waypoint
        if (hasReachedWaypoint(g.position.x, g.position.z, targetX, targetZ)) {
            path.shift();
            moveStartRef[unit.id] = { time: now, x: g.position.x, z: g.position.z };
            if (path.length === 0 && isPlayerMoveCommand) {
                delete moveStartRef[unit.id];
                delete g.userData.moveTarget;
                delete g.userData.formationRegroupAttempted;
                delete g.userData.formationRamp;
            }
        }

        // Stuck detection - give up if barely moving or jittering
        // Player move commands use a longer absolute timeout to avoid
        // giving up too quickly during crowded formation movement
        const moveStart = moveStartRef[unit.id];
        const stuckResult = isPlayerMoveCommand
            ? { isStuck: false, isReallyStuck: !!(moveStart && (now - moveStart.time) > PLAYER_MOVE_TIMEOUT_MS), isJittering: false }
            : checkIfStuck(unit.id, g.position.x, g.position.z, moveStart, now);

        if (stuckResult.isReallyStuck || stuckResult.isStuck || stuckResult.isJittering) {
            // Player formation commands get one forced repath before giving up.
            const shouldRegroup = isPlayerMoveCommand && stuckResult.isReallyStuck && !g.userData.formationRegroupAttempted;
            if (shouldRegroup) {
                const regroupTarget = g.userData.moveTarget ?? path[path.length - 1] ?? { x: targetX, z: targetZ };
                const regroupPath = createPathToTarget(g.position.x, g.position.z, regroupTarget.x, regroupTarget.z);
                if (regroupPath.success && regroupPath.path.length > 0) {
                    pathsRef[unit.id] = regroupPath.path;
                    moveStartRef[unit.id] = { time: now, x: g.position.x, z: g.position.z };
                    g.userData.formationRegroupAttempted = true;
                    clearJitterTracking(unit.id);
                    const nextWaypoint = pathsRef[unit.id][0];
                    if (nextWaypoint) {
                        return { targetX: nextWaypoint.x, targetZ: nextWaypoint.z };
                    }
                }
            }

            // All units: try one local sidestep route around corners/crowds before giving up.
            const finalGoal = g.userData.moveTarget ?? path[path.length - 1] ?? { x: targetX, z: targetZ };
            const detourPath = tryBuildLocalDetourPath(
                g.position.x,
                g.position.z,
                targetX,
                targetZ,
                finalGoal.x,
                finalGoal.z,
                isFlying,
                canTraverseWaterTerrain
            );
            if (detourPath && detourPath.length > 0) {
                pathsRef[unit.id] = detourPath;
                moveStartRef[unit.id] = { time: now, x: g.position.x, z: g.position.z };
                clearJitterTracking(unit.id);
                return { targetX: detourPath[0].x, targetZ: detourPath[0].z };
            }

            pathsRef[unit.id] = [];
            delete moveStartRef[unit.id];
            if (isPlayerMoveCommand) {
                delete g.userData.moveTarget;
                delete g.userData.formationRegroupAttempted;
                delete g.userData.formationRamp;
            }

            // Handle give up - updates internal state and returns info about cleared target
            const giveUpResult = handleGiveUp(unit.id, isPlayer, g.userData.attackTarget, now);
            if (giveUpResult.clearedTarget) {
                g.userData.attackTarget = null;
            }
        }
    }

    return { targetX, targetZ };
}

// =============================================================================
// MOVEMENT PHASE
// =============================================================================

export interface MovementContext {
    unit: Unit;
    g: UnitGroup;
    unitsRef: Record<number, UnitGroup>;
    unitsState: Unit[];
    targetX: number;
    targetZ: number;
    speedMultiplier?: number;  // Optional movement speed multiplier (default 1.0)
}

interface AvoidanceBucketEntry {
    unit: Unit;
    group: UnitGroup;
}

const AVOIDANCE_CELL_SIZE = 2;
const avoidanceBuckets = new Map<string, AvoidanceBucketEntry[]>();
let maxAvoidanceRadius = DEFAULT_UNIT_RADIUS;

function getAvoidanceBucketKey(cellX: number, cellZ: number): string {
    return `${cellX},${cellZ}`;
}

function getAvoidanceCell(coord: number): number {
    return Math.floor(coord / AVOIDANCE_CELL_SIZE);
}

/**
 * Build a lightweight spatial hash once per frame so local avoidance
 * checks don't scan every unit for every mover.
 */
export function updateAvoidanceCache(
    unitsState: Unit[],
    unitsRef: Record<number, UnitGroup>
): void {
    avoidanceBuckets.clear();
    maxAvoidanceRadius = DEFAULT_UNIT_RADIUS;

    for (const unit of unitsState) {
        if (unit.hp <= 0) continue;
        const group = unitsRef[unit.id];
        if (!group) continue;

        const unitRadius = getUnitRadius(unit);
        if (unitRadius > maxAvoidanceRadius) {
            maxAvoidanceRadius = unitRadius;
        }

        const cellX = getAvoidanceCell(group.position.x);
        const cellZ = getAvoidanceCell(group.position.z);
        const key = getAvoidanceBucketKey(cellX, cellZ);
        const bucket = avoidanceBuckets.get(key);
        if (bucket) {
            bucket.push({ unit, group });
        } else {
            avoidanceBuckets.set(key, [{ unit, group }]);
        }
    }
}

function getNearbyAvoidanceEntries(group: UnitGroup, myRadius: number): AvoidanceBucketEntry[] {
    const entries: AvoidanceBucketEntry[] = [];
    const centerX = getAvoidanceCell(group.position.x);
    const centerZ = getAvoidanceCell(group.position.z);
    const maxInteractionDist = (myRadius + maxAvoidanceRadius) * AVOIDANCE_RANGE_MULTIPLIER;
    const neighborRadius = Math.max(1, Math.ceil(maxInteractionDist / AVOIDANCE_CELL_SIZE));

    for (let dx = -neighborRadius; dx <= neighborRadius; dx++) {
        for (let dz = -neighborRadius; dz <= neighborRadius; dz++) {
            const bucket = avoidanceBuckets.get(getAvoidanceBucketKey(centerX + dx, centerZ + dz));
            if (!bucket) continue;
            entries.push(...bucket);
        }
    }

    return entries;
}

/**
 * Calculate avoidance vector from nearby units.
 * Player formation moves keep steering at reduced strength for cohesion.
 */
export function calculateAvoidance(ctx: MovementContext, desiredX: number, desiredZ: number): { avoidX: number; avoidZ: number } {
    const { unit, g } = ctx;

    // Player formation movement keeps steering mild instead of fully disabled.
    const formationMove = unit.team === "player" && g.userData.attackTarget === null;
    const steeringScale = formationMove ? 0.35 : 1.0;

    const myRadius = getUnitRadius(unit);
    let avoidX = 0, avoidZ = 0;

    for (const entry of getNearbyAvoidanceEntries(g, myRadius)) {
        const otherU = entry.unit;
        if (otherU.id === unit.id || otherU.hp <= 0) continue;
        const otherG = entry.group;

        const otherRadius = getUnitRadius(otherU);
        const combinedRadius = myRadius + otherRadius;
        const ox = otherG.position.x - g.position.x;
        const oz = otherG.position.z - g.position.z;
        const oDist = Math.hypot(ox, oz);

        if (oDist < combinedRadius * AVOIDANCE_RANGE_MULTIPLIER && oDist > MOVEMENT_MIN_MAGNITUDE) {
            // Hard separation when overlapping - push directly away
            if (oDist < combinedRadius) {
                const sepStrength = (combinedRadius - oDist) / combinedRadius;
                avoidX -= (ox / oDist) * sepStrength * AVOIDANCE_OVERLAP_STRENGTH;
                avoidZ -= (oz / oDist) * sepStrength * AVOIDANCE_OVERLAP_STRENGTH;
            }
            // Steering when unit is ahead and close
            else {
                const dot = (ox * desiredX + oz * desiredZ) / oDist;
                if (dot > AVOIDANCE_STEER_THRESHOLD) {
                    const steerStrength = (combinedRadius * AVOIDANCE_RANGE_MULTIPLIER - oDist) / (combinedRadius * AVOIDANCE_STEER_STRENGTH);
                    // Use XOR of unit IDs to determine which unit steers which way
                    const steerRight = (unit.id ^ otherU.id) % 2 === 0;
                    const perpX = steerRight ? -desiredZ : desiredZ;
                    const perpZ = steerRight ? desiredX : -desiredX;
                    avoidX += perpX * steerStrength * AVOIDANCE_STEER_STRENGTH * steeringScale;
                    avoidZ += perpZ * steerStrength * AVOIDANCE_STEER_STRENGTH * steeringScale;
                }
            }
        }
    }

    return { avoidX, avoidZ };
}

/**
 * Try to move with wall sliding - if direct movement blocked, try sliding along walls.
 */
export function applyWallSliding(
    g: UnitGroup,
    moveX: number,
    moveZ: number,
    flying: boolean = false,
    canTraverseWaterTerrain: boolean = false
): void {
    const newX = g.position.x + moveX;
    const newZ = g.position.z + moveZ;
    const cellX = Math.floor(newX);
    const cellZ = Math.floor(newZ);

    if (isPassable(cellX, cellZ, flying, canTraverseWaterTerrain)) {
        // Direct movement is valid
        g.position.x = clampToGrid(newX, 0.5, "x");
        g.position.z = clampToGrid(newZ, 0.5, "z");
    } else {
        // Try wall sliding - move along one axis if the other is blocked
        const xOnlyX = g.position.x + moveX;
        const xOnlyCellX = Math.floor(xOnlyX);
        const xOnlyCellZ = Math.floor(g.position.z);
        const canMoveX = isPassable(xOnlyCellX, xOnlyCellZ, flying, canTraverseWaterTerrain);

        const zOnlyZ = g.position.z + moveZ;
        const zOnlyCellX = Math.floor(g.position.x);
        const zOnlyCellZ = Math.floor(zOnlyZ);
        const canMoveZ = isPassable(zOnlyCellX, zOnlyCellZ, flying, canTraverseWaterTerrain);

        if (canMoveX && Math.abs(moveX) > Math.abs(moveZ)) {
            g.position.x = clampToGrid(xOnlyX, 0.5, "x");
        } else if (canMoveZ) {
            g.position.z = clampToGrid(zOnlyZ, 0.5, "z");
        } else if (canMoveX) {
            g.position.x = clampToGrid(xOnlyX, 0.5, "x");
        }
        // If neither axis is valid, unit doesn't move (stuck against corner)
    }
}

/**
 * Run the movement phase - move towards target with avoidance and wall sliding.
 */
export function runMovementPhase(ctx: MovementContext): void {
    const { unit, g, targetX, targetZ, speedMultiplier = 1.0 } = ctx;

    const dx = targetX - g.position.x;
    const dz = targetZ - g.position.z;
    const distToTarget = Math.hypot(dx, dz);

    if (distToTarget <= MOVEMENT_MIN_DIST) return;

    // Calculate desired direction
    const desiredX = dx / distToTarget;
    const desiredZ = dz / distToTarget;

    // Calculate avoidance from other units
    const { avoidX, avoidZ } = calculateAvoidance(ctx, desiredX, desiredZ);

    // Combine desired direction with avoidance
    let moveX = desiredX + avoidX;
    let moveZ = desiredZ + avoidZ;
    const moveMag = Math.hypot(moveX, moveZ);

    if (moveMag > MOVEMENT_MIN_MAGNITUDE) {
        // Normalize and apply speed (with optional multiplier for faster/slower enemies)
        const speed = MOVE_SPEED * speedMultiplier * getDebugSpeedMultiplier();
        moveX = (moveX / moveMag) * speed;
        moveZ = (moveZ / moveMag) * speed;

        const { isFlying, canTraverseWaterTerrain } = getMovementFlags(unit);
        // Apply movement with wall sliding
        applyWallSliding(g, moveX, moveZ, isFlying, canTraverseWaterTerrain);
    }
}

// =============================================================================
// PATH RECALCULATION
// =============================================================================

/**
 * Recalculate path to target if needed (target moved, unit deviated, etc).
 */
export function recalculatePathIfNeeded(
    unit: Unit,
    g: UnitGroup,
    targetX: number,
    targetZ: number,
    pathsRef: Record<number, { x: number; z: number }[]>,
    moveStartRef: Record<number, { time: number; x: number; z: number }>,
    now: number
): void {
    if (recentlyGaveUp(unit.id, now)) return;

    const { needsNewPath, reason } = checkPathNeedsRecalc(
        pathsRef[unit.id],
        targetX,
        targetZ,
        g.position.x,
        g.position.z
    );

    if (!needsNewPath) return;
    if (!canRecalculatePath(unit.id, now)) return;

    const { isFlying, canTraverseWaterTerrain } = getMovementFlags(unit);
    const result = createPathToTarget(
        g.position.x,
        g.position.z,
        targetX,
        targetZ,
        isFlying,
        canTraverseWaterTerrain
    );
    recordPathRecalculation(unit.id, reason, now);
    pathsRef[unit.id] = result.path;
    if (result.success) {
        moveStartRef[unit.id] = { time: now, x: g.position.x, z: g.position.z };
        clearJitterTracking(unit.id);  // Reset jitter detection for new path
    }
}
