import type { UnitData, EnemyStats, Unit } from "../core/types";
import { getEffectiveUnitData } from "./playerUnits";
import { ENEMY_STATS } from "./enemyStats";

// =============================================================================
// SHARED HELPERS
// =============================================================================

/** Default melee attack range (used when unit has no range specified) */
export const DEFAULT_MELEE_RANGE = 1.8;

// =============================================================================
// PER-FRAME STATS CACHE
// =============================================================================
// Player unit stats are expensive to compute (equipment + stat bonuses).
// Cache results per frame to avoid redundant recalculations.

const statsCache: Map<string, UnitData | EnemyStats> = new Map();

function getStatsCacheKey(unit: Unit): string {
    if (unit.team === "player") {
        return `player:${unit.id}`;
    }
    return `enemy:${unit.id}:${unit.enemyType ?? "unknown"}`;
}

/** Clear the per-frame stats cache. Call once at the start of each game loop frame. */
export function clearUnitStatsCache(): void {
    statsCache.clear();
}

/**
 * Get stats for any unit (player or enemy).
 * For player units, returns effective stats with equipment and stat bonuses applied.
 * Results are cached per frame — call clearUnitStatsCache() at frame start.
 */
export function getUnitStats(unit: Unit): UnitData | EnemyStats {
    const cacheKey = getStatsCacheKey(unit);
    const cached = statsCache.get(cacheKey);
    if (cached) return cached;

    let result: UnitData | EnemyStats;
    if (unit.team === "player") {
        result = getEffectiveUnitData(unit.id, unit);
    } else if (!unit.enemyType) {
        result = ENEMY_STATS.kobold;
    } else {
        result = ENEMY_STATS[unit.enemyType];
    }

    statsCache.set(cacheKey, result);
    return result;
}

/** Get the attack range for any unit (player or enemy) */
export function getAttackRange(unit: Unit): number {
    const stats = getUnitStats(unit);
    return stats.range ?? DEFAULT_MELEE_RANGE;
}
