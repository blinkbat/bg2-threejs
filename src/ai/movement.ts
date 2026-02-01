// =============================================================================
// MOVEMENT SYSTEM - Consolidated path state, stuck detection, and movement
// =============================================================================

import {
    STUCK_REALLY_STUCK_MS, STUCK_REALLY_STUCK_DIST, STUCK_MS, STUCK_DIST,
    STUCK_RECOVERY_COOLDOWN, PATH_WAYPOINT_REACH_DIST, PATH_MAX_DEVIATION,
    UNREACHABLE_COOLDOWN, TARGET_SCAN_INTERVAL, JITTER_DETECTION_MS, JITTER_DIRECTION_CHANGES
} from "../core/constants";
import { findPath } from "./pathfinding";

// =============================================================================
// PATH STATE - Module-level state for path management
// =============================================================================

// Track when units gave up on a path to prevent immediate retry
const gaveUpUntil: Record<number, number> = {};

// Throttle target acquisition - don't scan for targets every frame
const lastTargetScan: Record<number, number> = {};

// Track targets that enemies couldn't reach (to avoid repeatedly targeting them)
const unreachableTargets: Record<number, { targetId: number; until: number }[]> = {};

// Track jitter detection - stores recent movement directions
interface JitterState {
    startTime: number;
    lastX: number;
    lastZ: number;
    lastDirX: number;
    lastDirZ: number;
    directionChanges: number;
}
const jitterTracking: Record<number, JitterState> = {};

// =============================================================================
// STUCK DETECTION
// =============================================================================

export interface MoveStart {
    time: number;
    x: number;
    z: number;
}

export interface StuckResult {
    isStuck: boolean;
    isReallyStuck: boolean;
    isJittering: boolean;
}

// Pre-compute squared distance thresholds for fast comparison
const STUCK_REALLY_STUCK_DIST_SQ = STUCK_REALLY_STUCK_DIST * STUCK_REALLY_STUCK_DIST;
const STUCK_DIST_SQ = STUCK_DIST * STUCK_DIST;

/**
 * Check if a unit is stuck based on time and distance moved.
 * Uses squared distances to avoid sqrt calls.
 */
export function checkIfStuck(
    unitId: number,
    currentX: number,
    currentZ: number,
    moveStart: MoveStart | undefined,
    now: number
): StuckResult {
    if (!moveStart) {
        return { isStuck: false, isReallyStuck: false, isJittering: false };
    }

    const timeSinceStart = now - moveStart.time;
    const dx = currentX - moveStart.x;
    const dz = currentZ - moveStart.z;
    const movedDistSq = dx * dx + dz * dz;

    // Give up faster if really stuck (using squared distance comparison)
    const isReallyStuck = timeSinceStart > STUCK_REALLY_STUCK_MS && movedDistSq < STUCK_REALLY_STUCK_DIST_SQ;
    const isStuck = timeSinceStart > STUCK_MS && movedDistSq < STUCK_DIST_SQ;

    // Check for jittering (rapid direction changes)
    const isJittering = checkJitter(unitId, currentX, currentZ, now);

    return { isStuck, isReallyStuck, isJittering };
}

// Squared threshold for movement detection (0.01^2)
const JITTER_MOVE_THRESHOLD_SQ = 0.0001;

/**
 * Track movement direction and detect jittering (rapid oscillation).
 * Returns true if unit has been jittering for longer than JITTER_DETECTION_MS.
 * Uses squared distances to avoid sqrt where possible.
 */
function checkJitter(unitId: number, currentX: number, currentZ: number, now: number): boolean {
    const state = jitterTracking[unitId];

    if (!state) {
        // Initialize tracking
        jitterTracking[unitId] = {
            startTime: now,
            lastX: currentX,
            lastZ: currentZ,
            lastDirX: 0,
            lastDirZ: 0,
            directionChanges: 0
        };
        return false;
    }

    // Calculate movement delta
    const dx = currentX - state.lastX;
    const dz = currentZ - state.lastZ;
    const moveDistSq = dx * dx + dz * dz;

    // Only track direction if we actually moved (using squared comparison)
    if (moveDistSq > JITTER_MOVE_THRESHOLD_SQ) {
        // Only compute sqrt when we need the actual distance for normalization
        const moveDist = Math.sqrt(moveDistSq);
        const dirX = dx / moveDist;
        const dirZ = dz / moveDist;

        // Check if direction reversed (dot product < 0 means opposite direction)
        if (state.lastDirX !== 0 || state.lastDirZ !== 0) {
            const dot = dirX * state.lastDirX + dirZ * state.lastDirZ;
            if (dot < -0.5) {
                // Direction reversed
                state.directionChanges++;
            }
        }

        state.lastDirX = dirX;
        state.lastDirZ = dirZ;
    }

    state.lastX = currentX;
    state.lastZ = currentZ;

    // Check if jittering: enough direction changes within the time window
    if (state.directionChanges >= JITTER_DIRECTION_CHANGES) {
        const elapsed = now - state.startTime;
        if (elapsed <= JITTER_DETECTION_MS) {
            return true;
        }
        // Reset if time window passed without triggering
        state.startTime = now;
        state.directionChanges = 0;
    }

    return false;
}

/**
 * Clear jitter tracking for a unit (call when path changes or unit gives up).
 */
export function clearJitterTracking(unitId: number): void {
    delete jitterTracking[unitId];
}

/**
 * Handle a unit giving up on its path due to being stuck.
 * Clears path, updates state, and marks target as unreachable for enemies.
 */
export function handleGiveUp(
    unitId: number,
    isPlayer: boolean,
    attackTarget: number | null,
    now: number
): { clearedTarget: boolean; failedTargetId: number | null } {
    // Prevent immediate path recalculation
    gaveUpUntil[unitId] = now + STUCK_RECOVERY_COOLDOWN;

    // Clear jitter tracking when giving up
    clearJitterTracking(unitId);

    let clearedTarget = false;
    let failedTargetId: number | null = null;

    // For enemies: clear current target and mark it as unreachable
    if (!isPlayer && attackTarget !== null) {
        failedTargetId = attackTarget;
        clearedTarget = true;

        // Mark this target as unreachable for a while
        if (!unreachableTargets[unitId]) {
            unreachableTargets[unitId] = [];
        }
        // Clean up expired entries and add new one
        unreachableTargets[unitId] = unreachableTargets[unitId]
            .filter(entry => entry.until > now);
        unreachableTargets[unitId].push({
            targetId: failedTargetId,
            until: now + UNREACHABLE_COOLDOWN
        });

        // Allow immediate target re-scan to find closer target
        lastTargetScan[unitId] = 0;
    }

    return { clearedTarget, failedTargetId };
}

/**
 * Check if unit recently gave up and should not recalculate path.
 */
export function recentlyGaveUp(unitId: number, now: number): boolean {
    return gaveUpUntil[unitId] !== undefined && now < gaveUpUntil[unitId];
}

// =============================================================================
// TARGET SCANNING
// =============================================================================

/**
 * Check if enough time has passed to scan for targets again.
 */
export function canScanForTargets(unitId: number, now: number): boolean {
    const lastScan = lastTargetScan[unitId] || 0;
    return now - lastScan >= TARGET_SCAN_INTERVAL;
}

/**
 * Record that a target scan was performed.
 */
export function recordTargetScan(unitId: number, now: number): void {
    lastTargetScan[unitId] = now;
}

/**
 * Get list of targets that this enemy recently couldn't reach.
 */
export function getBlockedTargets(unitId: number, now: number): number[] {
    if (!unreachableTargets[unitId]) return [];
    return unreachableTargets[unitId]
        .filter(e => e.until > now)
        .map(e => e.targetId);
}

// =============================================================================
// PATH RECALCULATION
// =============================================================================

export interface PathRecalcResult {
    needsNewPath: boolean;
    reason: "no_path" | "target_moved" | "unit_deviated" | "none";
}

// Pre-compute squared thresholds
const PATH_MAX_DEVIATION_SQ = PATH_MAX_DEVIATION * PATH_MAX_DEVIATION;
const PATH_MAX_DEVIATION_DOUBLE_SQ = (PATH_MAX_DEVIATION * 2) * (PATH_MAX_DEVIATION * 2);

/**
 * Check if a path needs to be recalculated.
 * Considers both target movement and unit deviation from path.
 * Uses squared distances to avoid sqrt calls.
 */
export function checkPathNeedsRecalc(
    currentPath: { x: number; z: number }[] | undefined,
    targetX: number,
    targetZ: number,
    unitX?: number,
    unitZ?: number
): PathRecalcResult {
    if (!currentPath?.length) {
        return { needsNewPath: true, reason: "no_path" };
    }

    // Check if target has moved too far from path end (squared comparison)
    const pathEnd = currentPath[currentPath.length - 1];
    const dx = pathEnd.x - targetX;
    const dz = pathEnd.z - targetZ;
    if (dx * dx + dz * dz > PATH_MAX_DEVIATION_SQ) {
        return { needsNewPath: true, reason: "target_moved" };
    }

    // Check if unit has deviated too far from current waypoint (if position provided)
    if (unitX !== undefined && unitZ !== undefined && currentPath.length > 0) {
        const nextWaypoint = currentPath[0];
        const wdx = nextWaypoint.x - unitX;
        const wdz = nextWaypoint.z - unitZ;
        // If unit is very far from next waypoint, path may be invalid
        // Use a larger threshold since unit might be approaching from an angle
        if (wdx * wdx + wdz * wdz > PATH_MAX_DEVIATION_DOUBLE_SQ) {
            return { needsNewPath: true, reason: "unit_deviated" };
        }
    }

    return { needsNewPath: false, reason: "none" };
}

// Pre-compute squared waypoint reach distance
const PATH_WAYPOINT_REACH_DIST_SQ = PATH_WAYPOINT_REACH_DIST * PATH_WAYPOINT_REACH_DIST;

/**
 * Check if unit has reached the current waypoint.
 * Uses squared distance to avoid sqrt call.
 */
export function hasReachedWaypoint(
    unitX: number,
    unitZ: number,
    waypointX: number,
    waypointZ: number
): boolean {
    const dx = waypointX - unitX;
    const dz = waypointZ - unitZ;
    return dx * dx + dz * dz < PATH_WAYPOINT_REACH_DIST_SQ;
}

// =============================================================================
// PATH CREATION
// =============================================================================

export interface CreatePathResult {
    path: { x: number; z: number }[];
    success: boolean;
}

/**
 * Create a new path to a target, handling the common pattern of
 * slicing off the first waypoint (which is the start position).
 * Flying units can pass over lava.
 */
export function createPathToTarget(
    startX: number,
    startZ: number,
    targetX: number,
    targetZ: number,
    flying: boolean = false
): CreatePathResult {
    const path = findPath(startX, startZ, targetX, targetZ, 0, flying);
    if (path && path.length > 0) {
        return { path: path.slice(1), success: true };
    }
    return { path: [], success: false };
}

// =============================================================================
// STATE CLEANUP
// =============================================================================

/**
 * Clean up all state for a unit (call when unit is removed/dies).
 */
export function cleanupUnitState(unitId: number): void {
    delete gaveUpUntil[unitId];
    delete lastTargetScan[unitId];
    delete unreachableTargets[unitId];
    delete jitterTracking[unitId];
}

/**
 * Reset all movement state (for game restart).
 */
export function resetAllMovementState(): void {
    Object.keys(gaveUpUntil).forEach(k => delete gaveUpUntil[Number(k)]);
    Object.keys(lastTargetScan).forEach(k => delete lastTargetScan[Number(k)]);
    Object.keys(unreachableTargets).forEach(k => delete unreachableTargets[Number(k)]);
    Object.keys(jitterTracking).forEach(k => delete jitterTracking[Number(k)]);
}
