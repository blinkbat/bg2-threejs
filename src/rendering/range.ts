// =============================================================================
// RANGE & HITBOX UTILITIES
// =============================================================================

import type { Unit, UnitGroup } from "../core/types";
import { DEFAULT_UNIT_RADIUS } from "../core/constants";
import { UNIT_DATA } from "../game/playerUnits";
import { ENEMY_STATS } from "../game/enemyStats";

/**
 * Get the hitbox radius for a unit based on its size property.
 * Larger units (like ogres) have bigger hitboxes.
 */
export function getUnitRadius(unit: Unit): number {
    if (unit.team === "player") {
        const data = UNIT_DATA[unit.id];
        // Player units use default radius (could add size to UnitData later)
        return DEFAULT_UNIT_RADIUS * (data?.size ?? 1);
    } else {
        // Safely handle missing enemyType or invalid enemy stats
        if (!unit.enemyType) return DEFAULT_UNIT_RADIUS;
        const stats = ENEMY_STATS[unit.enemyType];
        return DEFAULT_UNIT_RADIUS * (stats?.size ?? 1);
    }
}

/**
 * Get the hitbox radius for a unit by ID, looking up in unitsState.
 */
export function getUnitRadiusById(unitId: number, unitsState: Unit[]): number {
    const unit = unitsState.find(u => u.id === unitId);
    if (!unit) return DEFAULT_UNIT_RADIUS;
    return getUnitRadius(unit);
}

/**
 * Calculate the effective distance between two units for range checks.
 * This is the distance from the attacker to the closest edge of the target's hitbox.
 * If any part of the target is in range, it should be targetable.
 */
export function getEffectiveDistance(
    attackerX: number,
    attackerZ: number,
    targetX: number,
    targetZ: number,
    targetRadius: number
): number {
    const centerDist = Math.hypot(targetX - attackerX, targetZ - attackerZ);
    return Math.max(0, centerDist - targetRadius);
}

/**
 * Check if a target is within range, accounting for target's hitbox.
 * Returns true if any part of the target's hitbox is within the specified range.
 */
export function isInRange(
    attackerX: number,
    attackerZ: number,
    targetX: number,
    targetZ: number,
    targetRadius: number,
    range: number
): boolean {
    return getEffectiveDistance(attackerX, attackerZ, targetX, targetZ, targetRadius) <= range;
}

/**
 * Convenience function: check if attacker can reach target unit.
 * Looks up target's position from UnitGroup and radius from Unit.
 */
export function canReachTarget(
    attackerG: UnitGroup,
    targetG: UnitGroup,
    targetUnit: Unit,
    range: number
): boolean {
    const targetRadius = getUnitRadius(targetUnit);
    return isInRange(
        attackerG.position.x,
        attackerG.position.z,
        targetG.position.x,
        targetG.position.z,
        targetRadius,
        range
    );
}
