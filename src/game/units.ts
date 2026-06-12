import type { UnitData, EnemyStats, Unit } from "../core/types";
import { getEffectiveUnitData } from "./playerUnits";
import { ENEMY_STATS, getAmoebaMaxHpForSplitCount } from "./enemyStats";
import { getEquipmentStateRevision } from "./equipmentState";

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

interface StatsCacheEntry {
    team: Unit["team"];
    statsRef: Unit["stats"];            // player: invalidates on stat changes (immutable updates)
    equipmentRevision: number;          // player: invalidates on equipment changes
    enemyType: Unit["enemyType"];       // enemy: invalidates on type mismatch (id reuse)
    splitCount: number;                 // enemy: amoeba split stage
    result: UnitData | EnemyStats;
}

// Keyed by unit id — numeric keys avoid building a string per lookup on the hot path.
const statsCache: Map<number, StatsCacheEntry> = new Map();

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
    const splitCount = unit.splitCount ?? 0;
    const cached = statsCache.get(unit.id);
    if (cached && cached.team === unit.team) {
        if (unit.team === "player") {
            if (cached.statsRef === unit.stats && cached.equipmentRevision === getEquipmentStateRevision()) {
                return cached.result;
            }
        } else if (cached.enemyType === unit.enemyType && cached.splitCount === splitCount) {
            return cached.result;
        }
    }

    let result: UnitData | EnemyStats;
    let equipmentRevision = 0;
    if (unit.team === "player") {
        equipmentRevision = getEquipmentStateRevision();
        result = getEffectiveUnitData(unit.id, unit);
    } else {
        const baseEnemyStats = unit.enemyType ? ENEMY_STATS[unit.enemyType] : undefined;
        if (!baseEnemyStats) {
            result = ENEMY_STATS.kobold;
        } else if (unit.enemyType === "giant_amoeba") {
            const stageMaxHp = getAmoebaMaxHpForSplitCount(splitCount);
            result = {
                ...baseEnemyStats,
                hp: stageMaxHp,
                maxHp: stageMaxHp,
            };
        } else {
            result = baseEnemyStats;
        }
    }

    statsCache.set(unit.id, {
        team: unit.team,
        statsRef: unit.stats,
        equipmentRevision,
        enemyType: unit.enemyType,
        splitCount,
        result
    });
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
    if (unit.team === "player") {
        if (import.meta.env.DEV) {
            console.warn(`[units] getEnemyUnitStats called for player unit ${unit.id}; falling back to kobold stats.`);
        }
        return ENEMY_STATS.kobold;
    }

    const stats = getUnitStats(unit);
    return isEnemyData(stats) ? stats : ENEMY_STATS.kobold;
}

/** Get the attack range for any unit (player or enemy) */
export function getAttackRange(unit: Unit): number {
    const stats = getUnitStats(unit);
    return stats.range ?? DEFAULT_MELEE_RANGE;
}
