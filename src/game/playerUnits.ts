import type { UnitData, Skill, Unit } from "../core/types";
import { SKILLS } from "./skills";
import {
    getEffectivePlayerDamage,
    getEffectivePlayerDamageType,
    getEffectivePlayerRange,
    getEffectivePlayerProjectileColor,
    getEffectivePlayerArmor,
    getEffectivePlayerBonusMaxHp,
} from "./equipmentState";
import {
    getStrengthDamageBonus,
    getDexterityAccuracyBonus,
    getVitalityHpBonus,
    getIntelligenceMpBonus,
} from "./statBonuses";

// =============================================================================
// EXPERIENCE & LEVELING
// =============================================================================

// XP required to reach each level (index = level, value = total XP needed)
export const XP_REQUIREMENTS = [0, 0, 100, 250, 450, 700, 1000, 1400, 1900, 2500, 3200];

export function getXpForLevel(level: number): number {
    if (level < 1) return 0;
    if (level >= XP_REQUIREMENTS.length) return XP_REQUIREMENTS[XP_REQUIREMENTS.length - 1] + (level - XP_REQUIREMENTS.length + 1) * 800;
    return XP_REQUIREMENTS[level];
}

// =============================================================================
// PLAYER UNIT DATA
// =============================================================================
// Base stats for player characters. Damage and armor come from equipment.
// These values are used as fallbacks and for non-equipment stats.

// Level 1 base stats - characters gain stats on level up
export const UNIT_DATA: Record<number, UnitData> = {
    1: { name: "Barbarian", class: "Barbarian", hp: 30, maxHp: 30, mana: 15, maxMana: 15, damage: [1, 4], accuracy: 70, armor: 0, color: "#c0392b", skills: [SKILLS.warcry, SKILLS.stunningBlow], items: [], attackCooldown: 2000 },
    2: { name: "Paladin", class: "Paladin", hp: 28, maxHp: 28, mana: 20, maxMana: 20, damage: [1, 4], accuracy: 65, armor: 0, color: "#f1c40f", skills: [SKILLS.raiseShield, SKILLS.sanctuary], items: [], attackCooldown: 2500 },
    3: { name: "Thief", class: "Thief", hp: 16, maxHp: 16, mana: 18, maxMana: 18, damage: [1, 4], accuracy: 75, armor: 0, color: "#8e44ad", skills: [SKILLS.poisonDagger, SKILLS.caltrops], items: [], attackCooldown: 1500 },
    4: { name: "Wizard", class: "Wizard", hp: 12, maxHp: 12, mana: 50, maxMana: 50, damage: [1, 4], accuracy: 60, armor: 0, color: "#3498db", skills: [SKILLS.fireball, SKILLS.magicWave, SKILLS.energyShield], items: [], attackCooldown: 3000 },
    5: { name: "Monk", class: "Monk", hp: 22, maxHp: 22, mana: 18, maxMana: 18, damage: [1, 4], accuracy: 70, armor: 0, color: "#27ae60", skills: [SKILLS.flurryOfFists, SKILLS.qiFocus], items: [], attackCooldown: 1800 },
    6: { name: "Cleric", class: "Cleric", hp: 20, maxHp: 20, mana: 40, maxMana: 40, damage: [1, 4], accuracy: 60, armor: 0, color: "#ecf0f1", skills: [SKILLS.heal, SKILLS.cleanse, SKILLS.thunder], items: [], attackCooldown: 2500 },
};

// =============================================================================
// PLAYER UNIT HELPERS
// =============================================================================

/** Generate a "basic attack" pseudo-skill for display in UI. Uses equipment stats. */
export function getBasicAttackSkill(unitId: number, unit?: Unit): Skill {
    const data = UNIT_DATA[unitId];

    // Get stats from equipment
    const baseDamage = getEffectivePlayerDamage(unitId);
    const damageType = getEffectivePlayerDamageType(unitId);
    const range = getEffectivePlayerRange(unitId);
    const projectileColor = getEffectivePlayerProjectileColor(unitId);

    // Apply strength bonus to physical damage only
    const strengthBonus = unit && damageType === "physical" ? getStrengthDamageBonus(unit) : 0;
    const damage: [number, number] = [baseDamage[0] + strengthBonus, baseDamage[1] + strengthBonus];

    return {
        name: "Attack",
        manaCost: 0,
        cooldown: data.attackCooldown,
        type: "damage",
        targetType: "enemy",
        range: range ?? 1.8,
        value: damage,
        damageType,
        projectileColor,
    };
}

/** Get effective max HP for a player (base + equipment + vitality bonuses) */
export function getEffectiveMaxHp(unitId: number, unit?: Unit): number {
    const data = UNIT_DATA[unitId];
    const vitalityBonus = unit ? getVitalityHpBonus(unit) : 0;
    return data.maxHp + getEffectivePlayerBonusMaxHp(unitId) + vitalityBonus;
}

/** Get effective max mana for a player (base + intelligence bonus) */
export function getEffectiveMaxMana(unitId: number, unit?: Unit): number {
    const data = UNIT_DATA[unitId];
    const intelligenceBonus = unit ? getIntelligenceMpBonus(unit) : 0;
    return (data.maxMana ?? 0) + intelligenceBonus;
}

/** Get effective armor for a player (from equipment) */
export function getEffectiveArmor(unitId: number): number {
    return getEffectivePlayerArmor(unitId);
}

/** Get all skills for a unit (basic attack + special skills) */
export function getAllSkills(unitId: number): Skill[] {
    const data = UNIT_DATA[unitId];
    return [getBasicAttackSkill(unitId), ...data.skills];
}

/** Get effective unit data with equipment and stat bonuses applied */
export function getEffectiveUnitData(unitId: number, unit?: Unit): UnitData {
    const data = UNIT_DATA[unitId];
    const baseDamage = getEffectivePlayerDamage(unitId);
    const damageType = getEffectivePlayerDamageType(unitId);
    const range = getEffectivePlayerRange(unitId);
    const projectileColor = getEffectivePlayerProjectileColor(unitId);
    const armor = getEffectivePlayerArmor(unitId);
    const bonusMaxHp = getEffectivePlayerBonusMaxHp(unitId);

    // Apply stat bonuses
    const vitalityBonus = unit ? getVitalityHpBonus(unit) : 0;
    const intelligenceBonus = unit ? getIntelligenceMpBonus(unit) : 0;
    const dexterityBonus = unit ? getDexterityAccuracyBonus(unit) : 0;
    const strengthBonus = unit && damageType === "physical" ? getStrengthDamageBonus(unit) : 0;

    const damage: [number, number] = [baseDamage[0] + strengthBonus, baseDamage[1] + strengthBonus];

    return {
        ...data,
        damage,
        armor,
        accuracy: data.accuracy + dexterityBonus,
        maxHp: data.maxHp + bonusMaxHp + vitalityBonus,
        maxMana: (data.maxMana ?? 0) + intelligenceBonus,
        range,
        projectileColor,
    };
}
