import type { UnitData, EnemyStats, Unit } from "../core/types";
import { getEffectiveUnitData } from "./playerUnits";
import { ENEMY_STATS, getAmoebaMaxHpForSplitCount } from "./enemyStats";

// =============================================================================
// SHARED HELPERS
// =============================================================================

/** Default melee attack range (used when unit has no range specified) */
const DEFAULT_MELEE_RANGE = 1.55;

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
    const amoebaStage = unit.enemyType === "giant_amoeba" ? `:${unit.splitCount ?? 0}` : "";
    return `enemy:${unit.id}:${unit.enemyType ?? "unknown"}${amoebaStage}`;
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
        const baseEnemyStats = ENEMY_STATS[unit.enemyType];
        if (unit.enemyType === "giant_amoeba") {
            const stageMaxHp = getAmoebaMaxHpForSplitCount(unit.splitCount ?? 0);
            result = {
                ...baseEnemyStats,
                hp: stageMaxHp,
                maxHp: stageMaxHp,
            };
        } else {
            result = baseEnemyStats;
        }
    }

    statsCache.set(cacheKey, result);
    return result;
}

/** Type guard: returns true when the stats object is EnemyStats (not player UnitData). */
export function isEnemyData(data: UnitData | EnemyStats): data is EnemyStats {
    return "monsterType" in data;
}

/**
 * Get stats for a unit that is known to be an enemy.
 * Returns EnemyStats directly, avoiding the need for `as EnemyStats` casts.
 * Falls back to kobold stats for enemies with missing enemyType.
 */
export function getEnemyUnitStats(unit: Unit): EnemyStats {
    return getUnitStats(unit) as EnemyStats;
}

/** Get the attack range for any unit (player or enemy) */
export function getAttackRange(unit: Unit): number {
    const stats = getUnitStats(unit);
    return stats.range ?? DEFAULT_MELEE_RANGE;
}
