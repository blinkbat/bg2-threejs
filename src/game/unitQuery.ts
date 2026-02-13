// =============================================================================
// UNIT QUERY UTILITIES - Common unit filtering and search patterns
// =============================================================================

import type { Unit, UnitGroup, EnemyStats } from "../core/types";
import { distance, distanceToPoint } from "./geometry";

// =============================================================================
// UNIT LOOKUP CACHE - O(1) unit lookups by ID
// Updated once per frame in useGameLoop before any game logic runs.
// =============================================================================

const unitsByIdCache: Map<number, Unit> = new Map();

/**
 * Update the unit lookup cache. Call this once per frame before AI/combat updates.
 */
export function updateUnitCache(unitsState: Unit[]): void {
    unitsByIdCache.clear();
    for (const unit of unitsState) {
        unitsByIdCache.set(unit.id, unit);
    }
}

/**
 * Get a unit by ID from the per-frame cache - O(1) lookup.
 * Returns undefined if the unit doesn't exist or cache hasn't been populated.
 */
export function getUnitById(id: number): Unit | undefined {
    return unitsByIdCache.get(id);
}

/**
 * Find the nearest unit matching a filter condition.
 * Returns the unit and its UnitGroup, or null if none found.
 */
export function findNearestUnit(
    units: Unit[],
    unitsRef: Record<number, UnitGroup>,
    targetX: number,
    targetZ: number,
    filter: (unit: Unit) => boolean,
    maxDist: number = Infinity
): { unit: Unit; group: UnitGroup; dist: number } | null {
    let nearest: { unit: Unit; group: UnitGroup; dist: number } | null = null;

    for (const unit of units) {
        if (!filter(unit)) continue;

        const g = unitsRef[unit.id];
        if (!g) continue;

        const d = distanceToPoint(g.position, targetX, targetZ);
        if (d < maxDist && (!nearest || d < nearest.dist)) {
            nearest = { unit, group: g, dist: d };
        }
    }

    return nearest;
}

/**
 * Find the nearest unit to another unit (using UnitGroup positions).
 */
export function findNearestUnitTo(
    units: Unit[],
    unitsRef: Record<number, UnitGroup>,
    fromGroup: UnitGroup,
    filter: (unit: Unit) => boolean,
    maxDist: number = Infinity
): { unit: Unit; group: UnitGroup; dist: number } | null {
    return findNearestUnit(units, unitsRef, fromGroup.position.x, fromGroup.position.z, filter, maxDist);
}

/**
 * Get all alive units of a specific team.
 */
export function getAliveUnits(units: Unit[], team: "player" | "enemy"): Unit[] {
    return units.filter(u => u.team === team && u.hp > 0);
}

/**
 * Get all alive units of a specific team with their UnitGroups.
 */
export function getAliveUnitsWithGroups(
    units: Unit[],
    unitsRef: Record<number, UnitGroup>,
    team: "player" | "enemy"
): { unit: Unit; group: UnitGroup }[] {
    const result: { unit: Unit; group: UnitGroup }[] = [];

    for (const unit of units) {
        if (unit.team !== team || unit.hp <= 0) continue;
        const g = unitsRef[unit.id];
        if (!g) continue;
        result.push({ unit, group: g });
    }

    return result;
}

/**
 * Check if a unit is alive and on a specific team.
 */
export function isAliveOnTeam(unit: Unit, team: "player" | "enemy"): boolean {
    return unit.team === team && unit.hp > 0;
}

/**
 * Check if any player unit is within aggro range of a position.
 * Used by spawner enemies (brood mother, necromancer) to detect players.
 */
export function isPlayerVisible(
    g: UnitGroup,
    enemyStats: EnemyStats,
    unitsState: Unit[],
    unitsRef: Record<number, UnitGroup>
): boolean {
    return unitsState.some(u => {
        if (u.team !== "player" || u.hp <= 0) return false;
        const playerG = unitsRef[u.id];
        if (!playerG) return false;
        return distance(playerG.position.x, playerG.position.z, g.position.x, g.position.z) <= enemyStats.aggroRange;
    });
}
