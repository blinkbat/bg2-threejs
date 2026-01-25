// =============================================================================
// UNIT AI - Modular AI phases for unit behavior
// =============================================================================

import {
    MOVE_SPEED,
    AVOIDANCE_RANGE_MULTIPLIER, AVOIDANCE_OVERLAP_STRENGTH,
    AVOIDANCE_STEER_THRESHOLD, AVOIDANCE_STEER_STRENGTH,
    MOVEMENT_MIN_DIST, MOVEMENT_MIN_MAGNITUDE
} from "../core/constants";
import { blocked } from "../game/dungeon";
import { findPath } from "./pathfinding";
import {
    canScanForTargets, recordTargetScan, getBlockedTargets,
    recentlyGaveUp, checkPathNeedsRecalc, createPathToTarget,
    hasReachedWaypoint, checkIfStuck, handleGiveUp, clearJitterTracking
} from "./movement";
import { getUnitRadius } from "../rendering/range";
import { clampToGrid, distanceBetween } from "../game/geometry";
import { getAttackRange, ENEMY_STATS } from "../game/units";
import type { Unit, UnitGroup } from "../core/types";

// =============================================================================
// UNIT LOOKUP CACHE - O(1) unit lookups by ID
// =============================================================================

// Module-level cache for fast unit lookups - updated once per frame
let unitsByIdCache: Map<number, Unit> = new Map();

/**
 * Update the unit lookup cache. Call this once per frame before AI updates.
 */
export function updateUnitCache(unitsState: Unit[]): void {
    unitsByIdCache.clear();
    for (const unit of unitsState) {
        unitsByIdCache.set(unit.id, unit);
    }
}

/**
 * Get a unit by ID from the cache - O(1) lookup.
 */
function getUnitById(id: number): Unit | undefined {
    return unitsByIdCache.get(id);
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

    const mother = unitsState.find(u => u.id === unit.spawnedBy);
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
}

/**
 * Check if the current attack target is still valid (alive and not defeated).
 */
export function validateCurrentTarget(
    currentTarget: number | null | undefined,
    unitsState: Unit[],
    defeatedThisFrame: Set<number>
): { valid: boolean; targetUnit: Unit | undefined } {
    if (currentTarget === null || currentTarget === undefined) {
        return { valid: false, targetUnit: undefined };
    }
    const targetUnit = unitsState.find(u => u.id === currentTarget);
    const valid = targetUnit !== undefined && targetUnit.hp > 0 && !defeatedThisFrame.has(currentTarget);
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
        if (defeatedThisFrame.has(enemy.id)) continue;
        if (blockedTargets.includes(enemy.id)) continue;

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

    g.userData.attackTarget = targetId;
    const targetG = unitsRef[targetId];

    if (targetG) {
        // Check if already in attack range (no path needed)
        const dist = distanceBetween(g.position, targetG.position);
        const attackRange = getAttackRange(unit);
        if (dist < attackRange) {
            // Already in attack range, no path needed
            pathsRef[unit.id] = [];
            return true;
        }

        const path = findPath(g.position.x, g.position.z, targetG.position.x, targetG.position.z);
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
    } else {
        pathsRef[unit.id] = [];
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
    const shouldAutoTarget = isPlayer ? unit.aiEnabled : true;

    // Check if enemy is alerted (was hit by a player)
    const isAlerted = !isPlayer && g.userData.alerted === true;

    // Check if current target is still valid
    const { valid: targetStillValid } = validateCurrentTarget(
        g.userData.attackTarget,
        ctx.unitsState,
        ctx.defeatedThisFrame
    );

    if (!targetStillValid) {
        g.userData.attackTarget = null;
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

    // Front-shielded enemies (like Undead Knight) are aggressive about targeting
    // They're slow to turn so they need to lock onto attackers ASAP
    if (hasFrontShield && !isPlayer) {
        // ALWAYS check for recent damage source - switch targets if someone hit us
        // This helps the knight respond to flankers
        const damageSourceTarget = findRecentDamageSource(ctx);
        if (damageSourceTarget !== null && damageSourceTarget !== g.userData.attackTarget) {
            // Switch to whoever is attacking us
            acquireTarget(ctx, damageSourceTarget);
            recordTargetScan(unit.id, now);
            return;
        }

        // If we don't have a valid target, find one immediately (bypass scan cooldown)
        if (!targetStillValid && !recentlyGaveUp(unit.id, now)) {
            const nearest = findNearestTarget(ctx);
            if (nearest !== null) {
                acquireTarget(ctx, nearest);
                recordTargetScan(unit.id, now);
                return;
            }
        }
    }

    // Determine if we should look for a new target
    const hasActivePath = pathsRef[unit.id]?.length > 0;
    const isExecutingMoveCommand = hasActivePath && g.userData.attackTarget === null;
    const canAutoTarget = shouldAutoTarget && !targetStillValid && !isExecutingMoveCommand;
    const canScan = canScanForTargets(unit.id, now);

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
    const { unit, g, unitsRef, unitsState, pathsRef } = ctx;

    // Priority 1: If we have an attack target, move toward it
    if (g.userData.attackTarget !== null && g.userData.attackTarget !== undefined) {
        const targetG = unitsRef[g.userData.attackTarget];
        const targetU = unitsState.find(u => u.id === g.userData.attackTarget);

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

/**
 * Run the path following phase - advance along path, handle stuck detection.
 * Returns the current movement target position.
 */
export function runPathFollowingPhase(ctx: PathContext): { targetX: number; targetZ: number } {
    const { unit, g, pathsRef, moveStartRef, now, isPlayer } = ctx;
    const path = pathsRef[unit.id];

    let targetX = g.position.x;
    let targetZ = g.position.z;

    if (path && path.length > 0) {
        targetX = path[0].x;
        targetZ = path[0].z;

        // Check if we've reached the current waypoint
        if (hasReachedWaypoint(g.position.x, g.position.z, targetX, targetZ)) {
            path.shift();
            moveStartRef[unit.id] = { time: now, x: g.position.x, z: g.position.z };
        }

        // Stuck detection - give up if barely moving or jittering
        const moveStart = moveStartRef[unit.id];
        const stuckResult = checkIfStuck(unit.id, g.position.x, g.position.z, moveStart, now);

        if (stuckResult.isReallyStuck || stuckResult.isStuck || stuckResult.isJittering) {
            pathsRef[unit.id] = [];
            delete moveStartRef[unit.id];

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

/**
 * Calculate avoidance vector from nearby units.
 */
export function calculateAvoidance(ctx: MovementContext, desiredX: number, desiredZ: number): { avoidX: number; avoidZ: number } {
    const { unit, g, unitsRef } = ctx;
    const myRadius = getUnitRadius(unit);
    let avoidX = 0, avoidZ = 0;

    for (const [otherId, otherG] of Object.entries(unitsRef)) {
        if (String(unit.id) === otherId) continue;

        // O(1) lookup instead of O(n) .find()
        const otherU = getUnitById(Number(otherId));
        if (!otherU || otherU.hp <= 0) continue;

        const otherRadius = getUnitRadius(otherU);
        const combinedRadius = myRadius + otherRadius;
        const ox = otherG.position.x - g.position.x;
        const oz = otherG.position.z - g.position.z;
        const oDist = Math.hypot(ox, oz);

        if (oDist < combinedRadius * AVOIDANCE_RANGE_MULTIPLIER && oDist > MOVEMENT_MIN_MAGNITUDE) {
            const dot = (ox * desiredX + oz * desiredZ) / oDist;

            // Hard separation when overlapping - push directly away
            if (oDist < combinedRadius) {
                const sepStrength = (combinedRadius - oDist) / combinedRadius;
                avoidX -= (ox / oDist) * sepStrength * AVOIDANCE_OVERLAP_STRENGTH;
                avoidZ -= (oz / oDist) * sepStrength * AVOIDANCE_OVERLAP_STRENGTH;
            }
            // Steering when unit is ahead and close
            else if (dot > AVOIDANCE_STEER_THRESHOLD) {
                const steerStrength = (combinedRadius * AVOIDANCE_RANGE_MULTIPLIER - oDist) / (combinedRadius * AVOIDANCE_STEER_STRENGTH);
                // Use XOR of unit IDs to determine which unit steers which way
                const steerRight = (unit.id ^ Number(otherId)) % 2 === 0;
                const perpX = steerRight ? -desiredZ : desiredZ;
                const perpZ = steerRight ? desiredX : -desiredX;
                avoidX += perpX * steerStrength * AVOIDANCE_STEER_STRENGTH;
                avoidZ += perpZ * steerStrength * AVOIDANCE_STEER_STRENGTH;
            }
        }
    }

    return { avoidX, avoidZ };
}

/**
 * Try to move with wall sliding - if direct movement blocked, try sliding along walls.
 */
export function applyWallSliding(g: UnitGroup, moveX: number, moveZ: number): void {
    const newX = g.position.x + moveX;
    const newZ = g.position.z + moveZ;
    const cellX = Math.floor(newX);
    const cellZ = Math.floor(newZ);

    if (!blocked[cellX]?.[cellZ]) {
        // Direct movement is valid
        g.position.x = clampToGrid(newX);
        g.position.z = clampToGrid(newZ);
    } else {
        // Try wall sliding - move along one axis if the other is blocked
        const xOnlyX = g.position.x + moveX;
        const xOnlyCellX = Math.floor(xOnlyX);
        const xOnlyCellZ = Math.floor(g.position.z);
        const canMoveX = !blocked[xOnlyCellX]?.[xOnlyCellZ];

        const zOnlyZ = g.position.z + moveZ;
        const zOnlyCellX = Math.floor(g.position.x);
        const zOnlyCellZ = Math.floor(zOnlyZ);
        const canMoveZ = !blocked[zOnlyCellX]?.[zOnlyCellZ];

        if (canMoveX && Math.abs(moveX) > Math.abs(moveZ)) {
            g.position.x = clampToGrid(xOnlyX);
        } else if (canMoveZ) {
            g.position.z = clampToGrid(zOnlyZ);
        } else if (canMoveX) {
            g.position.x = clampToGrid(xOnlyX);
        }
        // If neither axis is valid, unit doesn't move (stuck against corner)
    }
}

/**
 * Run the movement phase - move towards target with avoidance and wall sliding.
 */
export function runMovementPhase(ctx: MovementContext): void {
    const { g, targetX, targetZ, speedMultiplier = 1.0 } = ctx;

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
        const speed = MOVE_SPEED * speedMultiplier;
        moveX = (moveX / moveMag) * speed;
        moveZ = (moveZ / moveMag) * speed;

        // Apply movement with wall sliding
        applyWallSliding(g, moveX, moveZ);
    }
}

// =============================================================================
// PATH RECALCULATION
// =============================================================================

/**
 * Recalculate path to target if needed (target moved, unit deviated, etc).
 */
export function recalculatePathIfNeeded(
    unitId: number,
    g: UnitGroup,
    targetX: number,
    targetZ: number,
    pathsRef: Record<number, { x: number; z: number }[]>,
    moveStartRef: Record<number, { time: number; x: number; z: number }>,
    now: number
): void {
    if (recentlyGaveUp(unitId, now)) return;

    const { needsNewPath } = checkPathNeedsRecalc(
        pathsRef[unitId],
        targetX,
        targetZ,
        g.position.x,
        g.position.z
    );

    if (needsNewPath) {
        const result = createPathToTarget(g.position.x, g.position.z, targetX, targetZ);
        pathsRef[unitId] = result.path;
        if (result.success) {
            moveStartRef[unitId] = { time: now, x: g.position.x, z: g.position.z };
            clearJitterTracking(unitId);  // Reset jitter detection for new path
        }
    }
}
