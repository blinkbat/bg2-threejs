// =============================================================================
// STAT BONUS CALCULATIONS
// =============================================================================
// Functions to calculate bonuses from allocated character stats.
// See CharacterStats interface in units.ts for stat descriptions.

import type { Unit, CharacterStats } from "../core/types";

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

/** +2 HP per vitality point */
export function getVitalityHpBonus(unit: Unit): number {
    const stats = getStats(unit);
    return stats.vitality * 2;
}

/** +1 MP per intelligence point */
export function getIntelligenceMpBonus(unit: Unit): number {
    const stats = getStats(unit);
    return stats.intelligence;
}

/** +1 elemental/chaos damage per 3 intelligence points */
export function getIntelligenceMagicDamageBonus(unit: Unit): number {
    const stats = getStats(unit);
    return Math.floor(stats.intelligence / 3);
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
