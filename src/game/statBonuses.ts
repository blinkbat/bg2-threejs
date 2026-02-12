// =============================================================================
// STAT BONUS CALCULATIONS
// =============================================================================
// Functions to calculate bonuses from allocated character stats.
// See CharacterStats interface in units.ts for stat descriptions.

import type { Unit, CharacterStats } from "../core/types";
import { UNIT_DATA } from "./playerUnits";
import { ENEMY_STATS } from "./enemyStats";

/** Get character stats with fallback to zero */
function getStats(unit: Unit): CharacterStats {
    return unit.stats ?? {
        strength: 0,
        dexterity: 0,
        vitality: 0,
        intelligence: 0,
        faith: 0
    };
}

/** +1 physical damage per 2 strength points */
export function getStrengthDamageBonus(unit: Unit): number {
    const stats = getStats(unit);
    return Math.floor(stats.strength / 2);
}

/** +1% hit chance per 2 dexterity points */
export function getDexterityAccuracyBonus(unit: Unit): number {
    const stats = getStats(unit);
    return Math.floor(stats.dexterity / 2);
}

/** +1% crit chance per 2 dexterity points (plus base crit from class/enemy type) */
export function getDexterityCritChance(unit: Unit): number {
    const stats = getStats(unit);
    const dexBonus = Math.floor(stats.dexterity / 2);
    if (unit.team === "enemy" && unit.enemyType) {
        const enemyData = ENEMY_STATS[unit.enemyType];
        return enemyData?.baseCrit ?? 0;
    }
    const unitData = UNIT_DATA[unit.id];
    const baseCrit = unitData?.baseCrit ?? 0;
    return dexBonus + baseCrit;
}

/** Base crit damage multiplier (1.5x) */
export const CRIT_MULTIPLIER = 1.5;

// Per-point stat allocation bonuses
export const HP_PER_VITALITY = 1;
export const MP_PER_INTELLIGENCE = 1;

// Level-up grants
export const LEVEL_UP_HP = 2;
export const LEVEL_UP_MANA = 1;
export const LEVEL_UP_STAT_POINTS = 5;
export const LEVEL_UP_SKILL_POINTS = 1;

/** +HP_PER_VITALITY HP per vitality point */
export function getVitalityHpBonus(unit: Unit): number {
    const stats = getStats(unit);
    return stats.vitality * HP_PER_VITALITY;
}

/** +MP_PER_INTELLIGENCE MP per intelligence point */
export function getIntelligenceMpBonus(unit: Unit): number {
    const stats = getStats(unit);
    return stats.intelligence * MP_PER_INTELLIGENCE;
}

/** +1 elemental/chaos damage per 2 intelligence points */
export function getIntelligenceMagicDamageBonus(unit: Unit): number {
    const stats = getStats(unit);
    return Math.floor(stats.intelligence / 2);
}

/** +1 holy damage per 2 faith points */
export function getFaithHolyDamageBonus(unit: Unit): number {
    const stats = getStats(unit);
    return Math.floor(stats.faith / 2);
}

/** +1 healing power per 2 faith points */
export function getFaithHealingBonus(unit: Unit): number {
    const stats = getStats(unit);
    return Math.floor(stats.faith / 2);
}
