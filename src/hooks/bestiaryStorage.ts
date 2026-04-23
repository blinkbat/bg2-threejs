// =============================================================================
// BESTIARY STORAGE - Persists the set of enemy types the player has killed
// =============================================================================

import type { EnemyType } from "../core/types";
import { ENEMY_STATS } from "../game/enemyStats";

const BESTIARY_STORAGE_KEY = "bestiaryKnownEnemies";

function isValidEnemyType(value: unknown): value is EnemyType {
    return typeof value === "string" && value in ENEMY_STATS;
}

export function loadKnownEnemies(): Set<EnemyType> {
    const known = new Set<EnemyType>();
    try {
        const stored = localStorage.getItem(BESTIARY_STORAGE_KEY);
        if (!stored) return known;
        const parsed: unknown = JSON.parse(stored);
        if (!Array.isArray(parsed)) return known;
        for (const entry of parsed) {
            if (isValidEnemyType(entry)) {
                known.add(entry);
            }
        }
    } catch { /* ignore */ }
    return known;
}

export function saveKnownEnemies(known: ReadonlySet<EnemyType>): void {
    try {
        localStorage.setItem(BESTIARY_STORAGE_KEY, JSON.stringify(Array.from(known)));
    } catch { /* ignore */ }
}

export function recordKnownEnemy(enemyType: EnemyType): void {
    if (!isValidEnemyType(enemyType)) return;
    if (ENEMY_STATS[enemyType].tier === "npc") return;
    const known = loadKnownEnemies();
    if (known.has(enemyType)) return;
    known.add(enemyType);
    saveKnownEnemies(known);
}
