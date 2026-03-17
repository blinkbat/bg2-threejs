// =============================================================================
// COMBAT MATH - Unified damage calculation and combat utilities
// =============================================================================

import type { Unit, UnitData, EnemyStats, StatusEffect, StatusEffectType, DamageType } from "../core/types";
import { isEnemyData } from "../game/units";
import { POISON_DURATION, POISON_TICK_INTERVAL, POISON_DAMAGE_PER_TICK, SLOW_DURATION, BUFF_TICK_INTERVAL, COLORS, SLOW_COOLDOWN_MULT, SLOW_MOVE_MULT, DEFIANCE_COOLDOWN_MULT, SLEEP_MIN_DURATION, SLEEP_MAX_DURATION, CHILLED_DURATION, CHILLED_COOLDOWN_MULT, CHILLED_MOVE_MULT, WEAKENED_COOLDOWN_MULT, HAMSTRUNG_MOVE_MULT, BLIND_ACCURACY_MULT } from "../core/constants";
import { getStrengthDamageBonus, getIntelligenceMagicDamageBonus, getFaithHolyDamageBonus, getDexterityCritChance, CRIT_MULTIPLIER } from "../game/statBonuses";
import { getEffectivePlayerBonusMagicDamage, getEffectivePlayerMoveSpeedMultiplier } from "../game/equipmentState";
import { normalizeAngle } from "../game/geometry";

// =============================================================================
// DISTANCE & POSITION UTILITIES
// =============================================================================

/** Get direction vector and distance between two points. Returns normalized dx/dz and distance. */
export function getDirectionAndDistance(
    fromX: number, fromZ: number,
    toX: number, toZ: number
): { dx: number; dz: number; dist: number } {
    const dx = toX - fromX;
    const dz = toZ - fromZ;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.001) return { dx: 0, dz: 0, dist: 0 };
    return { dx: dx / dist, dz: dz / dist, dist };
}

/**
 * Check if an attack is blocked by a front shield.
 * Returns true if the attack is from the front (within 90 degrees of facing).
 * @param attackerX - Attacker's X position
 * @param attackerZ - Attacker's Z position
 * @param targetX - Target's X position
 * @param targetZ - Target's Z position
 * @param targetFacing - Target's facing direction in radians (0 = +Z direction)
 */
function isBlockedByFrontShield(
    attackerX: number, attackerZ: number,
    targetX: number, targetZ: number,
    targetFacing: number
): boolean {
    // Direction from target to attacker (where the attack is coming from)
    const dx = attackerX - targetX;
    const dz = attackerZ - targetZ;

    // Angle from target to attacker
    const attackAngle = Math.atan2(dx, dz);

    // If angle difference is within 90 degrees (PI/2), attack is from the front
    return Math.abs(normalizeAngle(attackAngle - targetFacing)) < Math.PI / 2;
}

// =============================================================================
// PROBABILITY & DAMAGE CALCULATIONS
// =============================================================================

/** Roll a percentage chance (0-100). Returns true if roll succeeds. */
export const rollChance = (percent: number): boolean =>
    Math.random() * 100 < percent;

// Roll random damage in a range (inclusive)
export const rollDamage = (min: number, max: number): number =>
    Math.floor(Math.random() * (max - min + 1)) + min;

// Roll hit based on accuracy percentage, with blind penalty for affected attackers.
export const rollHit = (accuracy: number, attacker?: Unit): boolean => {
    const clampedAccuracy = Math.max(0, Math.min(100, accuracy));
    if (!attacker || !hasStatusEffect(attacker, "blind")) {
        return rollChance(clampedAccuracy);
    }
    const blindAdjustedAccuracy = clampedAccuracy * BLIND_ACCURACY_MULT;
    return rollChance(blindAdjustedAccuracy);
};

interface SkillHitProfile {
    name: string;
    hitChance?: number;
}

interface SkillStatScalingProfile {
    statScaling?: number;
}

/**
 * Get base hit chance for a skill.
 * Named skills default to 100% unless they explicitly set hitChance.
 * "Attack" falls back to attacker accuracy.
 */
export function getSkillHitChance(skill: SkillHitProfile | undefined, attackerAccuracy: number): number {
    if (!skill) return Math.max(0, Math.min(100, attackerAccuracy));
    if (skill.hitChance !== undefined) return Math.max(0, Math.min(100, skill.hitChance));
    if (skill.name !== "Attack") return 100;
    return Math.max(0, Math.min(100, attackerAccuracy));
}

/** Roll hit for skill usage, applying blind penalty through rollHit. */
export function rollSkillHit(skill: SkillHitProfile | undefined, attackerAccuracy: number, attacker?: Unit): boolean {
    return rollHit(getSkillHitChance(skill, attackerAccuracy), attacker);
}

/**
 * Check if an attack is a critical hit based on unit's dexterity.
 * @returns true if crit occurs
 */
function rollCrit(attacker: Unit | undefined): boolean {
    if (!attacker) return false;
    const critChance = getDexterityCritChance(attacker);
    return rollChance(critChance);
}

/**
 * Roll damage with potential critical hit.
 * @returns object with final damage and whether it was a crit
 */
function rollDamageWithCrit(
    min: number,
    max: number,
    attacker: Unit | undefined
): { damage: number; isCrit: boolean } {
    const baseDamage = rollDamage(min, max);
    const isCrit = rollCrit(attacker);
    const damage = isCrit ? Math.floor(baseDamage * CRIT_MULTIPLIER) : baseDamage;
    return { damage, isCrit };
}

/**
 * Calculate stat-based damage bonus for a unit based on damage type.
 * Physical damage gets strength bonus, elemental/chaos gets intelligence bonus, holy gets faith bonus.
 * @returns The stat bonus to add to damage (0 if unit is undefined)
 */
export function calculateStatBonus(unit: Unit | undefined, damageType: DamageType): number {
    if (!unit) return 0;
    const auraBonus = unit.auraDamageBonus ?? 0;
    const equipmentMagicBonus = unit.team === "player"
        ? getEffectivePlayerBonusMagicDamage(unit.id)
        : 0;
    if (damageType === "physical") {
        return getStrengthDamageBonus(unit) + auraBonus;
    } else if (damageType === "holy") {
        return getFaithHolyDamageBonus(unit) + equipmentMagicBonus + auraBonus;
    } else if (damageType === "fire" || damageType === "cold" || damageType === "lightning" || damageType === "chaos") {
        return getIntelligenceMagicDamageBonus(unit) + equipmentMagicBonus + auraBonus;
    }
    // Remaining non-physical types (for example poison) still benefit from flat non-physical gear bonuses.
    return equipmentMagicBonus + auraBonus;
}

export function calculateSkillStatBonusBudget(
    unit: Unit | undefined,
    damageType: DamageType,
    skill?: SkillStatScalingProfile
): number {
    const scaling = Math.max(0, skill?.statScaling ?? 1);
    return Math.floor(calculateStatBonus(unit, damageType) * scaling);
}

export function getDistributedStatBonus(
    totalBonus: number,
    hitIndex: number,
    totalHits: number
): number {
    if (totalBonus === 0 || totalHits <= 0 || hitIndex < 0 || hitIndex >= totalHits) {
        return 0;
    }

    const sign = totalBonus < 0 ? -1 : 1;
    const absBonus = Math.abs(totalBonus);
    const distributedBefore = Math.floor((absBonus * hitIndex) / totalHits);
    const distributedAfter = Math.floor((absBonus * (hitIndex + 1)) / totalHits);
    return (distributedAfter - distributedBefore) * sign;
}

/**
 * Calculate final damage with critical hit check.
 * Rolls damage, checks for crit, applies crit multiplier, then applies armor.
 * @returns object with final damage and whether it was a crit
 */
export function calculateDamageWithCrit(
    rawMin: number,
    rawMax: number,
    armor: number,
    damageType: DamageType,
    attacker: Unit | undefined
): { damage: number; isCrit: boolean } {
    const { damage: rolledDamage, isCrit } = rollDamageWithCrit(rawMin, rawMax, attacker);
    // Only physical damage is reduced by armor
    const finalDamage = damageType === "physical"
        ? Math.max(1, rolledDamage - armor)
        : rolledDamage;
    return { damage: finalDamage, isCrit };
}

/**
 * Calculate final damage with optional explicit crit chance override.
 * If no override is provided, falls back to normal attacker-derived crit logic.
 */
export function calculateDamageWithOptionalCritChance(
    rawMin: number,
    rawMax: number,
    armor: number,
    damageType: DamageType,
    attacker: Unit | undefined,
    critChanceOverride?: number
): { damage: number; isCrit: boolean } {
    if (critChanceOverride === undefined) {
        return calculateDamageWithCrit(rawMin, rawMax, armor, damageType, attacker);
    }

    const rolledDamage = rollDamage(rawMin, rawMax);
    const clampedCritChance = Math.max(0, Math.min(100, critChanceOverride));
    const isCrit = rollChance(clampedCritChance);
    const critDamage = isCrit ? Math.floor(rolledDamage * CRIT_MULTIPLIER) : rolledDamage;
    const finalDamage = damageType === "physical"
        ? Math.max(1, critDamage - armor)
        : critDamage;
    return { damage: finalDamage, isCrit };
}

/**
 * Calculate damage from a pre-rolled value (when you've already rolled).
 * Armor only reduces physical damage - magic bypasses armor entirely.
 * Always returns at least 1 damage.
 */
export function applyArmor(rawDamage: number, armor: number, damageType: DamageType): number {
    // Only physical damage is reduced by armor
    if (damageType === "physical") {
        return Math.max(1, rawDamage - armor);
    }
    return rawDamage;
}

/**
 * Get damage color based on who is taking damage.
 * For AOE damage, enemies show neutral (orange) instead of player (green).
 */
export function getDamageColor(targetTeam: "player" | "enemy", isAoe: boolean = false): string {
    if (targetTeam === "player") return COLORS.damageEnemy;
    return isAoe ? COLORS.damageNeutral : COLORS.damagePlayer;
}

/**
 * Apply or refresh poison on a unit.
 * Returns the updated unit with poison effect, or the same unit if immune (cleansed).
 * @param customDamage - Optional custom damage per tick (defaults to POISON_DAMAGE_PER_TICK)
 */
export function applyPoison(unit: Unit, sourceId: number, now: number, customDamage?: number): Unit {
    // Check for poison immunity (cleansed effect)
    if (hasStatusEffect(unit, "cleansed")) {
        return unit;  // Immune to poison, no change
    }

    const existingEffects = unit.statusEffects || [];
    const existingPoison = existingEffects.find(e => e.type === "poison");
    const damage = customDamage ?? POISON_DAMAGE_PER_TICK;

    if (existingPoison) {
        // Refresh existing poison (keep the stronger damage if re-poisoned with weaker)
        return {
            ...unit,
            statusEffects: existingEffects.map(e =>
                e.type === "poison"
                    ? { ...e, duration: POISON_DURATION, timeSinceTick: 0, lastUpdateTime: now, damagePerTick: Math.max(e.damagePerTick, damage) }
                    : e
            )
        };
    } else {
        // Apply new poison
        const newPoison: StatusEffect = {
            type: "poison",
            duration: POISON_DURATION,
            tickInterval: POISON_TICK_INTERVAL,
            timeSinceTick: 0,
            lastUpdateTime: now,
            damagePerTick: damage,
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
    return rollChance(attackerData.poisonChance);
}

/**
 * Check if a unit currently has a specific status effect.
 */
export function hasStatusEffect(unit: Unit, effectType: StatusEffectType): boolean {
    return unit.statusEffects?.some(e => e.type === effectType) ?? false;
}

type IncapacitatingStatus = "stunned" | "sleep";

export function getIncapacitatingStatus(unit: Unit): IncapacitatingStatus | null {
    if (hasStatusEffect(unit, "stunned")) return "stunned";
    if (hasStatusEffect(unit, "sleep")) return "sleep";
    return null;
}

/**
 * Apply the slowed debuff to a unit (1.5x cooldowns, 0.5x move speed for 10s).
 */
export function applySlowed(unit: Unit, sourceId: number, now: number): Unit {
    const existingEffects = unit.statusEffects || [];
    const existingSlowed = existingEffects.find(e => e.type === "slowed");

    if (existingSlowed) {
        // Refresh existing slow
        return {
            ...unit,
            statusEffects: existingEffects.map(e =>
                e.type === "slowed"
                    ? { ...e, duration: SLOW_DURATION, timeSinceTick: 0, lastUpdateTime: now }
                    : e
            )
        };
    }

    // Apply new slow effect
    const slowEffect: StatusEffect = {
        type: "slowed",
        duration: SLOW_DURATION,
        tickInterval: BUFF_TICK_INTERVAL,
        timeSinceTick: 0,
        lastUpdateTime: now,
        damagePerTick: 0,  // Slow doesn't deal damage
        sourceId
    };

    return {
        ...unit,
        statusEffects: [...existingEffects, slowEffect]
    };
}

/**
 * Apply the chilled debuff to a unit (2x cooldowns, 0.5x move speed for 5s).
 */
export function applyChilled(unit: Unit, sourceId: number, now: number): Unit {
    const existingEffects = unit.statusEffects || [];
    const existingChilled = existingEffects.find(e => e.type === "chilled");

    if (existingChilled) {
        // Refresh existing chill
        return {
            ...unit,
            statusEffects: existingEffects.map(e =>
                e.type === "chilled"
                    ? { ...e, duration: CHILLED_DURATION, timeSinceTick: 0, lastUpdateTime: now }
                    : e
            )
        };
    }

    // Apply new chilled effect
    const chilledEffect: StatusEffect = {
        type: "chilled",
        duration: CHILLED_DURATION,
        tickInterval: BUFF_TICK_INTERVAL,
        timeSinceTick: 0,
        lastUpdateTime: now,
        damagePerTick: 0,  // Chill doesn't deal damage
        sourceId
    };

    return {
        ...unit,
        statusEffects: [...existingEffects, chilledEffect]
    };
}

/**
 * Apply sleep status to a unit. Duration is randomized between SLEEP_MIN_DURATION and SLEEP_MAX_DURATION.
 * If already sleeping, refreshes the duration with a new random roll.
 */
export function applySleep(unit: Unit, sourceId: number, now: number): Unit {
    const existingEffects = unit.statusEffects || [];
    const duration = SLEEP_MIN_DURATION + Math.random() * (SLEEP_MAX_DURATION - SLEEP_MIN_DURATION);
    const existingSleep = existingEffects.find(e => e.type === "sleep");

    if (existingSleep) {
        return {
            ...unit,
            statusEffects: existingEffects.map(e =>
                e.type === "sleep"
                    ? { ...e, duration, timeSinceTick: 0, lastUpdateTime: now }
                    : e
            )
        };
    }

    const sleepEffect: StatusEffect = {
        type: "sleep",
        duration,
        tickInterval: BUFF_TICK_INTERVAL,
        timeSinceTick: 0,
        lastUpdateTime: now,
        damagePerTick: 0,
        sourceId
    };

    return {
        ...unit,
        statusEffects: [...existingEffects, sleepEffect]
    };
}

/**
 * Check if an attacker should apply slow based on their slow chance.
 */
export function shouldApplySlow(attackerData: UnitData | EnemyStats): boolean {
    if (!('slowChance' in attackerData) || !attackerData.slowChance) {
        return false;
    }
    return rollChance(attackerData.slowChance);
}

/**
 * Get effective armor for a unit, applying shielded buff (doubles armor) and defiance (+2 armor).
 */
export function getEffectiveArmor(unit: Unit, baseArmor: number): number {
    let armor = baseArmor;
    if (hasStatusEffect(unit, "shielded")) armor *= 2;
    if (hasStatusEffect(unit, "defiance")) armor += 2;
    return armor;
}

/**
 * Get effective cooldown multiplier for a unit, accounting for slow (increases) and defiance (decreases).
 * Slow: 1.5x cooldowns, Defiance: 0.5x cooldowns
 * If both apply, they multiply together (1.5 * 0.5 = 0.75)
 */
export function getCooldownMultiplier(unit: Unit): number {
    let mult = 1;
    if (hasStatusEffect(unit, "slowed")) mult *= SLOW_COOLDOWN_MULT;
    if (hasStatusEffect(unit, "chilled")) mult *= CHILLED_COOLDOWN_MULT;
    if (hasStatusEffect(unit, "weakened")) mult *= WEAKENED_COOLDOWN_MULT;
    if (hasStatusEffect(unit, "defiance")) mult *= DEFIANCE_COOLDOWN_MULT;
    return mult;
}

/**
 * Set a skill cooldown with status-effect multiplier applied.
 * Consolidates the common pattern of computing cooldown multiplier + calling setSkillCooldowns.
 */
export function setSkillCooldown(
    setSkillCooldowns: React.Dispatch<React.SetStateAction<Record<string, { end: number; duration: number }>>>,
    key: string,
    baseCooldown: number,
    now: number,
    unit?: Unit
): void {
    const mult = unit ? getCooldownMultiplier(unit) : 1;
    setSkillCooldowns(prev => ({
        ...prev,
        [key]: { end: now + baseCooldown * mult, duration: baseCooldown }
    }));
}

/**
 * Check if a skill is off cooldown and ready to use.
 * Consolidates the repeated pattern: build key → lookup → compare to now.
 */
export function isCooldownReady(
    skillCooldowns: Record<string, { end: number; duration: number }>,
    unitId: number,
    skillName: string,
    now: number
): boolean {
    const key = `${unitId}-${skillName}`;
    const cooldownEnd = skillCooldowns[key]?.end ?? 0;
    return now >= cooldownEnd;
}

/**
 * Get effective damage range for a unit, accounting for amoeba split weakening
 * and enrage multiplier. Each split reduces damage by 15%.
 */
export function getEffectiveDamage(unit: Unit, baseDamage: [number, number], damageMultiplier: number = 1): [number, number] {
    let low = baseDamage[0];
    let high = baseDamage[1];
    if (unit.enemyType === "giant_amoeba" && unit.splitCount !== undefined && unit.splitCount > 0) {
        const scaleFactor = Math.pow(0.85, unit.splitCount);
        low = Math.floor(low * scaleFactor);
        high = Math.floor(high * scaleFactor);
    }
    if (damageMultiplier !== 1) {
        low = Math.floor(low * damageMultiplier);
        high = Math.floor(high * damageMultiplier);
    }
    return [Math.max(1, low), Math.max(1, high)];
}

/**
 * Get effective speed multiplier for a unit, accounting for pinned (0), base moveSpeed, and movement debuffs.
 * Consolidates the 3x duplicated speed calculation from the game loop.
 */
export function getEffectiveSpeedMultiplier(unit: Unit, data: EnemyStats | UnitData): number {
    if (hasStatusEffect(unit, "pinned")) return 0;
    const baseMoveSpeed = "moveSpeed" in data && typeof data.moveSpeed === "number"
        ? data.moveSpeed
        : 1;
    const equipmentMoveSpeed = unit.team === "player"
        ? getEffectivePlayerMoveSpeedMultiplier(unit.id)
        : 1;
    const slow = hasStatusEffect(unit, "slowed") ? SLOW_MOVE_MULT : 1;
    const chill = hasStatusEffect(unit, "chilled") ? CHILLED_MOVE_MULT : 1;
    const hamstrung = hasStatusEffect(unit, "hamstrung") ? HAMSTRUNG_MOVE_MULT : 1;
    const enraged = hasStatusEffect(unit, "enraged") && "enrage" in data && isEnemyData(data) && data.enrage
        ? data.enrage.speedMultiplier : 1;
    return baseMoveSpeed * equipmentMoveSpeed * slow * chill * hamstrung * enraged;
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

// =============================================================================
// COMBAT LOG MESSAGES - Centralized for consistency
// =============================================================================

/** "{unit}'s {skill} hits {target} for {dmg} damage!" */
export function logHit(attackerName: string, skillName: string, targetName: string, damage: number): string {
    return `${attackerName}'s ${skillName} hits ${targetName} for ${damage} damage!`;
}

/** "{unit} bites {target} for {dmg} damage, draining {heal} life!" - for lifesteal attacks */
export function logLifestealHit(attackerName: string, targetName: string, damage: number, healAmount: number): string {
    return `${attackerName} bites ${targetName} for ${damage} damage, draining ${healAmount} life!`;
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

/** "{target} is slowed!" */
export function logSlowed(targetName: string): string {
    return `${targetName} is slowed!`;
}

/** "{target}'s attacks are weakened!" */
export function logWeakened(targetName: string): string {
    return `${targetName}'s attacks are weakened!`;
}

/** "{target} is hamstrung!" */
export function logHamstrung(targetName: string): string {
    return `${targetName} is hamstrung!`;
}

/** "{target} is defeated!" */
export function logDefeated(targetName: string): string {
    return `${targetName} is killed!`;
}

/** "{unit} casts {skill}!" */
export function logCast(casterName: string, skillName: string): string {
    return `${casterName} casts ${skillName}!`;
}

/** "{unit}'s {skill} hits {count} target(s) for {damage} total damage!" */
export function logAoeHit(casterName: string, skillName: string, hitCount: number, totalDamage?: number): string {
    if (totalDamage !== undefined) {
        return `${casterName}'s ${skillName} hits ${hitCount} time${hitCount !== 1 ? 's' : ''} for ${totalDamage} total damage!`;
    }
    return `${casterName}'s ${skillName} hits ${hitCount} time${hitCount !== 1 ? 's' : ''}!`;
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

/** "{unit} activates {skill}!" */
export function logBuff(casterName: string, skillName: string): string {
    return `${casterName} activates ${skillName}!`;
}

/** "{target} is stunned!" */
export function logStunned(targetName: string): string {
    return `${targetName} is stunned!`;
}

/** "{caster} cleanses {target}!" */
export function logCleanse(casterName: string, targetName: string): string {
    return `${casterName} cleanses ${targetName}!`;
}

/** "{caster} throws {skill}!" */
export function logTrapThrown(casterName: string, skillName: string): string {
    return `${casterName} throws ${skillName}!`;
}

/** "{skill} triggers, pinning {count} enemies!" */
export function logTrapTriggered(skillName: string, pinnedCount: number): string {
    return `${skillName} triggers, pinning ${pinnedCount} enem${pinnedCount !== 1 ? 'ies' : 'y'}!`;
}

// =============================================================================
// UNIT STATE HELPERS
// =============================================================================

/**
 * Check if a unit is alive (HP > 0 and not defeated this frame).
 * Consolidates the common pattern: `if (unit.hp <= 0 || defeatedThisFrame.has(unit.id)) continue;`
 */
export function isUnitAlive(unit: Unit, defeatedThisFrame?: Set<number>): boolean {
    if (unit.hp <= 0) return false;
    if (defeatedThisFrame && defeatedThisFrame.has(unit.id)) return false;
    return true;
}

// =============================================================================
// ENEMY DEFENSE HELPERS
// =============================================================================

/**
 * Check if an enemy's front shield blocks an attack.
 * Returns true if the enemy has a front shield, is facing the attacker, and the attack comes from the front.
 * @param enemyStats - The enemy's stats (from ENEMY_STATS lookup)
 * @param enemyFacing - The enemy's facing direction (undefined if not applicable)
 * @param attackerX - Attacker's X position
 * @param attackerZ - Attacker's Z position
 * @param targetX - Target's X position
 * @param targetZ - Target's Z position
 * @param blockModifier - Optional modifier to reduce block effectiveness (e.g., 0.5 for magic projectiles)
 */
function checkFrontShieldBlock(
    enemyStats: { frontShield?: boolean },
    enemyFacing: number | undefined,
    attackerX: number,
    attackerZ: number,
    targetX: number,
    targetZ: number,
    blockModifier: number = 1
): boolean {
    if (!enemyStats.frontShield || enemyFacing === undefined) return false;
    if (!isBlockedByFrontShield(attackerX, attackerZ, targetX, targetZ, enemyFacing)) return false;
    // Apply block modifier (e.g., magic missiles have 50% chance to be blocked)
    if (blockModifier < 1 && Math.random() >= blockModifier) return false;
    return true;
}

/**
 * Check if an enemy's passive block chance blocks a physical attack.
 * Only physical damage can be blocked by block chance.
 * @param enemyStats - The enemy's stats (from ENEMY_STATS lookup)
 * @param damageType - The type of damage being dealt
 */
function checkEnemyBlockChance(
    enemyStats: { blockChance?: number },
    damageType: DamageType
): boolean {
    if (!enemyStats.blockChance || damageType !== "physical") return false;
    return rollChance(enemyStats.blockChance);
}

/**
 * Combined defense check: front shield block + passive block chance.
 * Returns the type of block that occurred, or "none" if the attack gets through.
 */
type DefenseResult = "none" | "frontShield" | "blockChance";

export function checkEnemyDefenses(
    enemyStats: { frontShield?: boolean; blockChance?: number },
    enemyFacing: number | undefined,
    attackerX: number,
    attackerZ: number,
    targetX: number,
    targetZ: number,
    damageType?: DamageType,
    shieldBlockModifier?: number
): DefenseResult {
    if (checkFrontShieldBlock(enemyStats, enemyFacing, attackerX, attackerZ, targetX, targetZ, shieldBlockModifier)) {
        return "frontShield";
    }
    if (damageType && checkEnemyBlockChance(enemyStats, damageType)) {
        return "blockChance";
    }
    return "none";
}

// =============================================================================
// STATUS EFFECT HELPERS
// =============================================================================

/**
 * Apply a status effect to a unit, optionally replacing an existing effect of the same type.
 * Returns a new statusEffects array (does not mutate).
 *
 * @param existingEffects - Current status effects array (or undefined)
 * @param newEffect - The effect to apply
 * @param replaceExisting - If true, removes any existing effect of the same type first (default: true)
 */
export function applyStatusEffect(
    existingEffects: StatusEffect[] | undefined,
    newEffect: StatusEffect,
    replaceExisting: boolean = true
): StatusEffect[] {
    const effects = existingEffects || [];
    const filtered = replaceExisting
        ? effects.filter(e => e.type !== newEffect.type)
        : effects;
    return [...filtered, newEffect];
}
