// =============================================================================
// STAT DISPLAY RESOLVERS
// =============================================================================
// Pure helpers that package gameplay helpers (damage math, equipment stats,
// character stat bonuses, status-effect constants) into shapes the UI can
// render directly. UI surfaces (skill tooltips, equipment diffs, unit panel
// stats, status effect tooltips) all call through here so the displayed value
// stays in lockstep with what combat actually computes at runtime.
//
// Nothing in this module mutates state — it is snapshot-at-call-time only.

import type {
    CharacterEquipment,
    CharacterStats,
    DamageType,
    EquipmentPassives,
    EquipmentSlot,
    Item,
    Skill,
    StatusEffect,
    Unit,
} from "../core/types";
import { isAccessory, isArmor, isConsumable, isShield, isWeapon } from "../core/types";
import {
    BLIND_ACCURACY_MULT,
    BURN_DAMAGE_PER_TICK,
    BURN_TICK_INTERVAL,
    CHANNELED_COOLDOWN_MULT,
    CHANNELED_MANA_MULT,
    CHILLED_COOLDOWN_MULT,
    CHILLED_MOVE_MULT,
    CONSTRICTED_COOLDOWN_MULT,
    DEFIANCE_COOLDOWN_MULT,
    HAMSTRUNG_MOVE_MULT,
    POISON_DAMAGE_PER_TICK,
    POISON_TICK_INTERVAL,
    REGEN_TICK_INTERVAL,
    SLOW_COOLDOWN_MULT,
    SLOW_MOVE_MULT,
    SUN_STANCE_BONUS_DAMAGE,
} from "../core/constants";
import { calculateStatBonus, getTotalCritChance } from "../combat/combatMath";
import {
    getFaithHealingBonus,
    getFaithHolyDamageBonus,
    getIntelligenceMagicDamageBonus,
    getStrengthDamageBonus,
} from "./statBonuses";
import { getCharacterEquipment } from "./equipmentState";
import { getComputedStats } from "./equipment";
import { getEffectiveMaxHp, getEffectiveMaxMana, getEffectiveUnitData } from "./playerUnits";
import { getItem } from "./items";

// =============================================================================
// SKILL TOOLTIP RESOLUTION
// =============================================================================

export interface ResolvedRange {
    base: [number, number];
    effective: [number, number];
    bonus: number;
}

export interface ResolvedSkillDisplay {
    damage: ResolvedRange | null;
    heal: ResolvedRange | null;
    critChance: number | null;
    hitChance: number | null;
    manaCost: number;
    cooldownMs: number;
}

function addBonusToRange(range: [number, number], bonus: number): [number, number] {
    return [Math.max(0, range[0] + bonus), Math.max(0, range[1] + bonus)];
}

/**
 * Compute what a skill's tooltip values will actually resolve to for a given
 * unit: damage range with stat scaling applied, heal with faith bonus, and
 * the unit-specific crit/hit chance the skill will roll with.
 *
 * When `unit` is undefined (e.g. hovering a skill with no character context)
 * the effective values fall back to the skill's base definition.
 */
export function resolveSkillDisplay(unit: Unit | undefined, skill: Skill): ResolvedSkillDisplay {
    const scaling = Math.max(0, skill.statScaling ?? 1);

    let damage: ResolvedRange | null = null;
    if (skill.damageRange) {
        const totalBonus = unit ? calculateStatBonus(unit, skill.damageType) : 0;
        const scaledBonus = Math.floor(totalBonus * scaling);
        damage = {
            base: [skill.damageRange[0], skill.damageRange[1]],
            effective: addBonusToRange(skill.damageRange, scaledBonus),
            bonus: scaledBonus,
        };
    }

    let heal: ResolvedRange | null = null;
    if (skill.healRange) {
        // Healing skills add the raw faith bonus (no statScaling applied in combat math).
        const faithBonus = unit ? getFaithHealingBonus(unit) : 0;
        heal = {
            base: [skill.healRange[0], skill.healRange[1]],
            effective: addBonusToRange(skill.healRange, faithBonus),
            bonus: faithBonus,
        };
    }

    let critChance: number | null = null;
    if (skill.damageRange) {
        critChance = skill.critChanceOverride ?? (unit ? getTotalCritChance(unit) : 0);
    }

    let hitChance: number | null = null;
    if (skill.damageRange) {
        if (skill.hitChance !== undefined) {
            hitChance = skill.hitChance;
        } else if (unit) {
            const data = getEffectiveUnitData(unit.id, unit);
            hitChance = data.accuracy;
        }
    }

    return {
        damage,
        heal,
        critChance,
        hitChance,
        manaCost: skill.manaCost,
        cooldownMs: skill.cooldown,
    };
}

// =============================================================================
// STAT BONUS RESOLUTION
// =============================================================================

export type StatKey = keyof CharacterStats;

export interface ResolvedStatBonusLine {
    desc: string;
    rate: string;
    current: string | null;    // e.g. "+3", "+2%", or null if the bonus is zero / unknown
}

/**
 * Numeric bonuses that each character stat currently contributes. Values are
 * computed against `unit.stats` and the stat-bonus formulas.
 */
export function resolveStatBonuses(unit: Unit): Record<StatKey, ResolvedStatBonusLine[]> {
    const stats = unit.stats ?? { strength: 0, dexterity: 0, vitality: 0, intelligence: 0, faith: 0 };

    const strength = getStrengthDamageBonus(unit);
    const dexDamage = Math.floor(stats.dexterity / 2);
    const vit = stats.vitality;
    const intMagic = getIntelligenceMagicDamageBonus(unit);
    const intMana = stats.intelligence;
    const faithHoly = getFaithHolyDamageBonus(unit);
    const faithHeal = getFaithHealingBonus(unit);

    return {
        strength: [
            { desc: "Physical Damage", rate: "+1 per 2 pts", current: strength > 0 ? `+${strength}` : null },
        ],
        dexterity: [
            { desc: "Hit Chance", rate: "+1% per 2 pts", current: dexDamage > 0 ? `+${dexDamage}%` : null },
            { desc: "Crit Chance", rate: "+1% per 2 pts", current: dexDamage > 0 ? `+${dexDamage}%` : null },
        ],
        vitality: [
            { desc: "Max HP", rate: "+1 per pt", current: vit > 0 ? `+${vit}` : null },
        ],
        intelligence: [
            { desc: "Max Mana", rate: "+1 per pt", current: intMana > 0 ? `+${intMana}` : null },
            { desc: "Magic Damage", rate: "+1 per 2 pts", current: intMagic > 0 ? `+${intMagic}` : null },
        ],
        faith: [
            { desc: "Holy Damage", rate: "+1 per 2 pts", current: faithHoly > 0 ? `+${faithHoly}` : null },
            { desc: "Healing Power", rate: "+1 per 2 pts", current: faithHeal > 0 ? `+${faithHeal}` : null },
        ],
    };
}

// =============================================================================
// EQUIP DIFF RESOLUTION
// =============================================================================

export interface StatDelta {
    label: string;
    deltaText: string;        // e.g. "+2", "-1%"
    sign: "positive" | "negative" | "neutral";
}

/**
 * Compute what would change if `candidateItemId` replaced whatever is in
 * `slot` for `unitId`. Returned deltas cover damage range, armor, and all
 * EquipmentPassives fields.
 */
export function resolveEquipDiff(
    unitId: number,
    candidateItemId: string,
    slot: EquipmentSlot
): StatDelta[] {
    const candidate = getItem(candidateItemId);
    if (!candidate) return [];

    const current = getCharacterEquipment(unitId);
    const previewed: CharacterEquipment = { ...current, [slot]: candidateItemId };

    const currentStats = getComputedStats(current);
    const nextStats = getComputedStats(previewed);

    const deltas: StatDelta[] = [];

    const pushNumberDelta = (label: string, before: number, after: number, suffix = "") => {
        const diff = after - before;
        if (diff === 0) return;
        const sign: StatDelta["sign"] = diff > 0 ? "positive" : "negative";
        const deltaText = (diff > 0 ? `+${diff}` : `${diff}`) + suffix;
        deltas.push({ label, deltaText, sign });
    };

    const pushPercentDelta = (label: string, before: number, after: number) => {
        const diff = Math.round((after - before) * 100);
        if (diff === 0) return;
        const sign: StatDelta["sign"] = diff > 0 ? "positive" : "negative";
        deltas.push({ label, deltaText: `${diff > 0 ? "+" : ""}${diff}%`, sign });
    };

    // Damage range (min / max as one line)
    if (currentStats.damage[0] !== nextStats.damage[0] || currentStats.damage[1] !== nextStats.damage[1]) {
        const dMin = nextStats.damage[0] - currentStats.damage[0];
        const dMax = nextStats.damage[1] - currentStats.damage[1];
        const avgDiff = (dMin + dMax) / 2;
        const sign: StatDelta["sign"] = avgDiff > 0 ? "positive" : avgDiff < 0 ? "negative" : "neutral";
        const fmt = (n: number) => (n > 0 ? `+${n}` : `${n}`);
        deltas.push({
            label: "Damage",
            deltaText: dMin === dMax ? fmt(dMin) : `${fmt(dMin)} / ${fmt(dMax)}`,
            sign,
        });
    }

    pushNumberDelta("Armor", currentStats.armor, nextStats.armor);
    pushNumberDelta("Max HP", currentStats.bonusMaxHp, nextStats.bonusMaxHp);
    pushNumberDelta("Max Mana", currentStats.bonusMaxMana, nextStats.bonusMaxMana);
    pushNumberDelta("Magic Dmg", currentStats.bonusMagicDamage, nextStats.bonusMagicDamage);
    pushNumberDelta("Crit", currentStats.bonusCritChance, nextStats.bonusCritChance, "%");
    pushPercentDelta("Lifesteal", currentStats.lifesteal, nextStats.lifesteal);
    pushNumberDelta("Thorns", currentStats.thornsDamage, nextStats.thornsDamage);

    // Move speed is expressed as a multiplier; show as +/- %.
    const moveBefore = currentStats.moveSpeedMultiplier - 1;
    const moveAfter = nextStats.moveSpeedMultiplier - 1;
    pushPercentDelta("Speed", moveBefore, moveAfter);

    // Aggro multiplier: lower = less aggro. Show as reduction %.
    const aggroBefore = 1 - currentStats.aggroMultiplier;
    const aggroAfter = 1 - nextStats.aggroMultiplier;
    pushPercentDelta("Aggro red.", aggroBefore, aggroAfter);

    // HP regen: describe only if anything changed.
    const regenBefore = currentStats.hpRegen;
    const regenAfter = nextStats.hpRegen;
    const regenKey = (r: typeof regenBefore) => (r ? `${r.amount}/${r.interval}` : "none");
    if (regenKey(regenBefore) !== regenKey(regenAfter)) {
        if (regenAfter && !regenBefore) {
            deltas.push({ label: "Regen", deltaText: `+${regenAfter.amount}/${regenAfter.interval / 1000}s`, sign: "positive" });
        } else if (!regenAfter && regenBefore) {
            deltas.push({ label: "Regen", deltaText: `−${regenBefore.amount}/${regenBefore.interval / 1000}s`, sign: "negative" });
        } else if (regenAfter && regenBefore) {
            const amountDiff = regenAfter.amount - regenBefore.amount;
            const sign: StatDelta["sign"] = amountDiff > 0 ? "positive" : amountDiff < 0 ? "negative" : "neutral";
            deltas.push({
                label: "Regen",
                deltaText: `${amountDiff > 0 ? "+" : ""}${amountDiff}/${regenAfter.interval / 1000}s`,
                sign,
            });
        }
    }

    return deltas;
}

// =============================================================================
// RESOLVED CHARACTER TOTALS (for status/equipment modals)
// =============================================================================

export interface ResolvedCharacterTotals {
    maxHp: number;
    maxMana: number;
    damage: [number, number];
    damageType: DamageType;
    armor: number;
    accuracy: number;
    critChance: number;
}

export function resolveCharacterTotals(unit: Unit): ResolvedCharacterTotals {
    const data = getEffectiveUnitData(unit.id, unit);
    return {
        maxHp: getEffectiveMaxHp(unit.id, unit),
        maxMana: getEffectiveMaxMana(unit.id, unit),
        damage: data.damage,
        damageType: data.basicDamageType ?? "physical",
        armor: data.armor,
        accuracy: data.accuracy,
        critChance: getTotalCritChance(unit),
    };
}

// =============================================================================
// STATUS EFFECT RESOLUTION
// =============================================================================

export interface ResolvedStatusDetail {
    label: string;
    value: string;
}

/**
 * Mechanical numbers for effects whose impact is defined by constants rather
 * than stored on the StatusEffect itself. These fill tooltip lines so the UI
 * shows actual numbers ("cooldowns +35%") rather than just descriptions.
 */
export function resolveStatusEffectDetails(effect: StatusEffect): ResolvedStatusDetail[] {
    const details: ResolvedStatusDetail[] = [];
    const pctChange = (mult: number): string => {
        const pct = Math.round((mult - 1) * 100);
        return pct > 0 ? `+${pct}%` : `${pct}%`;
    };
    const moveMultPct = (mult: number): string => {
        const pct = Math.round((mult - 1) * 100);
        return pct > 0 ? `+${pct}%` : `${pct}%`;
    };

    switch (effect.type) {
        case "slowed":
            details.push({ label: "Move Speed", value: moveMultPct(SLOW_MOVE_MULT) });
            details.push({ label: "Cooldowns", value: pctChange(SLOW_COOLDOWN_MULT) });
            break;
        case "chilled":
            details.push({ label: "Move Speed", value: moveMultPct(CHILLED_MOVE_MULT) });
            details.push({ label: "Cooldowns", value: pctChange(CHILLED_COOLDOWN_MULT) });
            break;
        case "constricted":
            details.push({ label: "Cooldowns", value: pctChange(CONSTRICTED_COOLDOWN_MULT) });
            break;
        case "hamstrung":
            details.push({ label: "Move Speed", value: moveMultPct(HAMSTRUNG_MOVE_MULT) });
            break;
        case "blind": {
            const pct = Math.round((1 - BLIND_ACCURACY_MULT) * 100);
            details.push({ label: "Hit Chance", value: `−${pct}%` });
            break;
        }
        case "shielded":
            details.push({ label: "Armor", value: "×2" });
            details.push({ label: "Cooldowns", value: "+100%" });
            break;
        case "defiance":
            details.push({ label: "Armor", value: "+2" });
            details.push({ label: "Cooldowns", value: pctChange(DEFIANCE_COOLDOWN_MULT) });
            break;
        case "channeled":
            details.push({ label: "Spell Cooldowns", value: pctChange(CHANNELED_COOLDOWN_MULT) });
            details.push({ label: "Spell Mana Cost", value: pctChange(CHANNELED_MANA_MULT) });
            break;
        case "poison":
            details.push({
                label: "Damage",
                value: `${POISON_DAMAGE_PER_TICK} per ${POISON_TICK_INTERVAL / 1000}s`,
            });
            break;
        case "burn":
            details.push({
                label: "Damage",
                value: `${BURN_DAMAGE_PER_TICK} per ${BURN_TICK_INTERVAL / 1000}s`,
            });
            break;
        case "regen": {
            // regen reuses `shieldAmount` to carry heal-per-tick (see statusEffects.ts).
            const healPerTick = effect.shieldAmount;
            if (healPerTick !== undefined && healPerTick > 0) {
                details.push({
                    label: "Healing",
                    value: `${healPerTick} per ${REGEN_TICK_INTERVAL / 1000}s`,
                });
            }
            break;
        }
        case "sun_stance":
            details.push({
                label: "Bonus Fire",
                value: `+${SUN_STANCE_BONUS_DAMAGE[0]}-${SUN_STANCE_BONUS_DAMAGE[1]}`,
            });
            break;
    }

    return details;
}

// =============================================================================
// ITEM DISPLAY HELPERS
// =============================================================================
// Used to narrow the passive-line handling in EquipmentModal.

export function getItemPassives(item: Item): EquipmentPassives | null {
    if (isWeapon(item) || isShield(item) || isArmor(item) || isAccessory(item)) {
        return item;
    }
    if (isConsumable(item)) {
        return null;
    }
    return null;
}
