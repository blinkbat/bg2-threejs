// =============================================================================
// COMBAT MATH - Unified damage calculation and combat utilities
// =============================================================================

import type { Unit, UnitData, EnemyStats, StatusEffect } from "../core/types";
import { POISON_DURATION, POISON_TICK_INTERVAL, POISON_DAMAGE_PER_TICK, COLORS } from "../core/constants";

// Roll random damage in a range (inclusive)
export const rollDamage = (min: number, max: number): number =>
    Math.floor(Math.random() * (max - min + 1)) + min;

// Roll hit based on accuracy percentage
export const rollHit = (accuracy: number): boolean =>
    Math.random() * 100 < accuracy;

/**
 * Calculate final damage after armor reduction.
 * Always returns at least 1 damage.
 */
export function calculateDamage(rawMin: number, rawMax: number, armor: number): number {
    const rolled = rollDamage(rawMin, rawMax);
    return Math.max(1, rolled - armor);
}

/**
 * Calculate damage from a pre-rolled value (when you've already rolled).
 * Always returns at least 1 damage.
 */
export function applyArmor(rawDamage: number, armor: number): number {
    return Math.max(1, rawDamage - armor);
}

/**
 * Get damage color based on who is taking damage.
 */
export function getDamageColor(targetTeam: "player" | "enemy"): string {
    return targetTeam === "player" ? COLORS.damageEnemy : COLORS.damagePlayer;
}

/**
 * Apply or refresh poison on a unit.
 * Returns the updated unit with poison effect.
 */
export function applyPoison(unit: Unit, sourceId: number, now: number): Unit {
    const existingEffects = unit.statusEffects || [];
    const existingPoison = existingEffects.find(e => e.type === "poison");

    if (existingPoison) {
        // Refresh existing poison
        return {
            ...unit,
            statusEffects: existingEffects.map(e =>
                e.type === "poison"
                    ? { ...e, duration: POISON_DURATION, lastTick: now }
                    : e
            )
        };
    } else {
        // Apply new poison
        const newPoison: StatusEffect = {
            type: "poison",
            duration: POISON_DURATION,
            tickInterval: POISON_TICK_INTERVAL,
            lastTick: now,
            damagePerTick: POISON_DAMAGE_PER_TICK,
            sourceId
        };
        return {
            ...unit,
            statusEffects: [...existingEffects, newPoison]
        };
    }
}

/**
 * Check if an attacker should apply poison based on their poison chance.
 */
export function shouldApplyPoison(attackerData: UnitData | EnemyStats): boolean {
    if (!('poisonChance' in attackerData) || !attackerData.poisonChance) {
        return false;
    }
    return Math.random() * 100 < attackerData.poisonChance;
}

/**
 * Get HP percentage for a unit.
 */
export function getHpPercentage(hp: number, maxHp: number): number {
    return (hp / maxHp) * 100;
}

/**
 * Get HP bar color based on percentage.
 */
export function getHpColor(hpPct: number): string {
    if (hpPct > 50) return COLORS.hpHigh;
    if (hpPct > 25) return COLORS.hpMedium;
    return COLORS.hpLow;
}

/**
 * Get mana value safely with fallback to 0.
 */
export function getMana(unit: Unit): number {
    return unit.mana ?? 0;
}

/**
 * Check if unit has enough mana for a skill.
 */
export function hasEnoughMana(unit: Unit, manaCost: number): boolean {
    return getMana(unit) >= manaCost;
}

// =============================================================================
// COMBAT LOG MESSAGES - Centralized for consistency
// =============================================================================

/** "{unit}'s {skill} hits {target} for {dmg} damage!" */
export function logHit(attackerName: string, skillName: string, targetName: string, damage: number): string {
    return `${attackerName}'s ${skillName} hits ${targetName} for ${damage} damage!`;
}

/** "{unit}'s {skill} misses {target}." */
export function logMiss(attackerName: string, skillName: string, targetName: string): string {
    return `${attackerName}'s ${skillName} misses ${targetName}.`;
}

/** "{unit}'s {skill} heals {target} for {amount}!" */
export function logHeal(casterName: string, skillName: string, targetName: string, amount: number): string {
    return `${casterName}'s ${skillName} heals ${targetName} for ${amount}!`;
}

/** "{target} is poisoned!" */
export function logPoisoned(targetName: string): string {
    return `${targetName} is poisoned!`;
}

/** "{target} is defeated!" */
export function logDefeated(targetName: string): string {
    return `${targetName} is defeated!`;
}

/** "{unit} casts {skill}!" */
export function logCast(casterName: string, skillName: string): string {
    return `${casterName} casts ${skillName}!`;
}

/** "{unit}'s {skill} hits {count} target(s)!" */
export function logAoeHit(casterName: string, skillName: string, hitCount: number): string {
    return `${casterName}'s ${skillName} hits ${hitCount} target${hitCount !== 1 ? 's' : ''}!`;
}

/** "{unit}'s {skill} misses!" (for AOE that hits nothing) */
export function logAoeMiss(casterName: string, skillName: string): string {
    return `${casterName}'s ${skillName} misses!`;
}

/** "{unit}'s {skill} taunts {count} enemies!" */
export function logTaunt(casterName: string, skillName: string, tauntedCount: number): string {
    return `${casterName}'s ${skillName} taunts ${tauntedCount} enem${tauntedCount !== 1 ? 'ies' : 'y'}!`;
}

/** "{unit}'s {skill} echoes... but no enemies are affected." */
export function logTauntMiss(casterName: string, skillName: string): string {
    return `${casterName}'s ${skillName} echoes... but no enemies are affected.`;
}
