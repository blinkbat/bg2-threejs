// =============================================================================
// PATH MANAGER - Centralized path state and management utilities
// =============================================================================

import {
    STUCK_REALLY_STUCK_MS, STUCK_REALLY_STUCK_DIST, STUCK_MS, STUCK_DIST,
    STUCK_RECOVERY_COOLDOWN, PATH_WAYPOINT_REACH_DIST, PATH_MAX_DEVIATION,
    UNREACHABLE_COOLDOWN, TARGET_SCAN_INTERVAL
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
}

/**
 * Check if a unit is stuck based on time and distance moved.
 */
export function checkIfStuck(
    currentX: number,
    currentZ: number,
    moveStart: MoveStart | undefined,
    now: number
): StuckResult {
    if (!moveStart) {
        return { isStuck: false, isReallyStuck: false };
    }

    const timeSinceStart = now - moveStart.time;
    const movedDist = Math.hypot(currentX - moveStart.x, currentZ - moveStart.z);

    // Give up faster if really stuck
    const isReallyStuck = timeSinceStart > STUCK_REALLY_STUCK_MS && movedDist < STUCK_REALLY_STUCK_DIST;
    const isStuck = timeSinceStart > STUCK_MS && movedDist < STUCK_DIST;

    return { isStuck, isReallyStuck };
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

/**
 * Check if a path needs to be recalculated.
 * Considers both target movement and unit deviation from path.
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

    // Check if target has moved too far from path end
    const pathEnd = currentPath[currentPath.length - 1];
    const distToPathEnd = Math.hypot(pathEnd.x - targetX, pathEnd.z - targetZ);
    if (distToPathEnd > PATH_MAX_DEVIATION) {
        return { needsNewPath: true, reason: "target_moved" };
    }

    // Check if unit has deviated too far from current waypoint (if position provided)
    if (unitX !== undefined && unitZ !== undefined && currentPath.length > 0) {
        const nextWaypoint = currentPath[0];
        const distToWaypoint = Math.hypot(nextWaypoint.x - unitX, nextWaypoint.z - unitZ);
        // If unit is very far from next waypoint, path may be invalid
        // Use a larger threshold since unit might be approaching from an angle
        if (distToWaypoint > PATH_MAX_DEVIATION * 2) {
            return { needsNewPath: true, reason: "unit_deviated" };
        }
    }

    return { needsNewPath: false, reason: "none" };
}

/**
 * Check if unit has reached the current waypoint.
 */
export function hasReachedWaypoint(
    unitX: number,
    unitZ: number,
    waypointX: number,
    waypointZ: number
): boolean {
    return Math.hypot(waypointX - unitX, waypointZ - unitZ) < PATH_WAYPOINT_REACH_DIST;
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
 */
export function createPathToTarget(
    startX: number,
    startZ: number,
    targetX: number,
    targetZ: number
): CreatePathResult {
    const path = findPath(startX, startZ, targetX, targetZ);
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
}

/**
 * Reset all path manager state (for game restart).
 */
export function resetAllState(): void {
    Object.keys(gaveUpUntil).forEach(k => delete gaveUpUntil[Number(k)]);
    Object.keys(lastTargetScan).forEach(k => delete lastTargetScan[Number(k)]);
    Object.keys(unreachableTargets).forEach(k => delete unreachableTargets[Number(k)]);
}
