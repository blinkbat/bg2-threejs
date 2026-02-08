// =============================================================================
// TARGETING - Target acquisition, kiting behavior for ranged enemies
// =============================================================================

import { DEFAULT_KITE_DISTANCE, DEFAULT_KITE_COOLDOWN } from "../core/constants";
import { findPath, isPassable } from "./pathfinding";
import { getEnemyKiteCooldown, setEnemyKiteCooldown, setEnemyKitingUntil } from "../game/enemyState";
import { getDirectionAndDistance } from "../combat/combatMath";
import { getCurrentArea } from "../game/areas";
import { findNearestUnit } from "../game/unitQuery";
import type { Unit, UnitGroup, EnemyStats } from "../core/types";

// =============================================================================
// KITING BEHAVIOR - Ranged enemies retreat when players get too close
// =============================================================================

export interface KiteContext {
    unit: Unit;
    g: UnitGroup;
    unitsRef: Record<number, UnitGroup>;
    unitsState: Unit[];
    pathsRef: Record<number, { x: number; z: number }[]>;
    moveStartRef: Record<number, { time: number; x: number; z: number }>;
    now: number;
}

export interface KiteResult {
    isKiting: boolean;
}


/**
 * Try to find a retreat path for a kiting enemy.
 * Attempts multiple angles if direct retreat is blocked.
 */
function findRetreatPath(
    g: UnitGroup,
    awayFromX: number,
    awayFromZ: number,
    kiteDistance: number
): { path: { x: number; z: number }[] | null } {
    const { dx, dz, dist } = getDirectionAndDistance(awayFromX, awayFromZ, g.position.x, g.position.z);

    if (dist <= 0.1) {
        return { path: null };
    }

    // Try multiple retreat angles if direct path is blocked
    const angles = [0, Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2, Math.PI * 3 / 4, -Math.PI * 3 / 4];

    for (const angleOffset of angles) {
        // Rotate the retreat direction
        const cos = Math.cos(angleOffset);
        const sin = Math.sin(angleOffset);
        const rotatedDx = dx * cos - dz * sin;
        const rotatedDz = dx * sin + dz * cos;

        const retreatX = g.position.x + rotatedDx * kiteDistance;
        const retreatZ = g.position.z + rotatedDz * kiteDistance;

        // Clamp to grid bounds
        const area = getCurrentArea();
        const clampedX = Math.max(0.5, Math.min(area.gridWidth - 0.5, retreatX));
        const clampedZ = Math.max(0.5, Math.min(area.gridHeight - 0.5, retreatZ));

        // Check if destination is passable
        if (!isPassable(Math.floor(clampedX), Math.floor(clampedZ))) continue;

        // Use A* to find a path to the retreat point
        const path = findPath(g.position.x, g.position.z, clampedX, clampedZ);
        if (path && path.length > 0) {
            return { path };
        }
    }

    return { path: null };
}

/**
 * Check if an enemy should kite and execute the kiting behavior.
 * Returns true if the enemy is now kiting (should skip normal attack logic).
 */
export function tryKite(ctx: KiteContext, enemyData: EnemyStats): KiteResult {
    const { unit, g, unitsRef, unitsState, pathsRef, moveStartRef, now } = ctx;

    const kiteTrigger = enemyData.kiteTrigger;
    if (!kiteTrigger) {
        return { isKiting: false };
    }

    // Check cooldown
    const kiteCooldownEnd = getEnemyKiteCooldown(unit.id);
    if (now < kiteCooldownEnd) {
        return { isKiting: false };
    }

    // Find nearest player
    const nearestPlayer = findNearestUnit(unitsState, unitsRef, g.position.x, g.position.z, u => u.team === "player" && u.hp > 0);

    if (!nearestPlayer) {
        return { isKiting: false };
    }

    // Check if recently took damage (within last 2 seconds)
    const recentlyHit = g.userData.lastHitTime && (now - g.userData.lastHitTime) < 2000;
    // Expand kite trigger range if recently hit - prioritize survival
    const effectiveTriggerRange = recentlyHit ? kiteTrigger * 2 : kiteTrigger;

    // Check if player is within kite trigger range
    if (nearestPlayer.dist >= effectiveTriggerRange) {
        return { isKiting: false };
    }

    // Calculate kiting parameters
    const kiteDistance = enemyData.kiteDistance ?? DEFAULT_KITE_DISTANCE;
    // Shorter cooldown if recently hit - more desperate to escape
    const baseKiteCooldown = enemyData.kiteCooldown ?? DEFAULT_KITE_COOLDOWN;
    const kiteCooldown = recentlyHit ? baseKiteCooldown / 2 : baseKiteCooldown;

    // Try to find a retreat path
    const { path } = findRetreatPath(g, nearestPlayer.group.position.x, nearestPlayer.group.position.z, kiteDistance);

    if (path) {
        // Skip the first waypoint if it's the start position
        pathsRef[unit.id] = path.length > 1 ? path.slice(1) : path;
        moveStartRef[unit.id] = { time: now, x: g.position.x, z: g.position.z };
        setEnemyKiteCooldown(unit.id, now + kiteCooldown);
        // Clear attack target so enemy focuses on retreating
        g.userData.attackTarget = null;
        // Mark enemy as kiting - prevent re-targeting until path done or 3 seconds
        const kiteDuration = Math.min(3000, path.length * 500);
        setEnemyKitingUntil(unit.id, now + kiteDuration);
        return { isKiting: true };
    }

    // If no path found, still set cooldown to prevent spamming
    setEnemyKiteCooldown(unit.id, now + kiteCooldown / 2);
    return { isKiting: false };
}
