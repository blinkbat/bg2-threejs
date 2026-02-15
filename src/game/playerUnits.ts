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
export const XP_REQUIREMENTS = [0, 0, 200, 500, 900, 1400, 2000, 2800, 3800, 5000, 6400];

export function getXpForLevel(level: number): number {
    if (level < 1) return 0;
    if (level >= XP_REQUIREMENTS.length) return XP_REQUIREMENTS[XP_REQUIREMENTS.length - 1] + (level - XP_REQUIREMENTS.length + 1) * 1500;
    return XP_REQUIREMENTS[level];
}

export const CORE_PLAYER_IDS = [1, 2, 3, 4, 5, 6] as const;
export const ANCESTOR_SUMMON_ID = 7;

const CORE_PLAYER_ID_SET = new Set<number>(CORE_PLAYER_IDS);

export function isCorePlayerId(unitId: number): boolean {
    return CORE_PLAYER_ID_SET.has(unitId);
}

function usesEquipmentForUnit(unitId: number): boolean {
    return isCorePlayerId(unitId);
}

// =============================================================================
// PLAYER UNIT DATA
// =============================================================================
// Base stats for player characters. Damage and armor come from equipment.
// These values are used as fallbacks and for non-equipment stats.

// Level 1 base stats - characters gain stats on level up
export const UNIT_DATA: Record<number, UnitData> = {
    1: { name: "Barbarian", class: "Barbarian", hp: 38, maxHp: 38, mana: 15, maxMana: 15, damage: [1, 4], accuracy: 70, armor: 0, color: "#c0392b", skills: [SKILLS.warcry, SKILLS.defiance, SKILLS.stunningBlow, SKILLS.summonAncestor, SKILLS.highlandDefense], items: [], attackCooldown: 2000, baseCrit: 3 },
    2: { name: "Paladin", class: "Paladin", hp: 35, maxHp: 35, mana: 20, maxMana: 20, damage: [1, 4], accuracy: 65, armor: 0, color: "#d4a017", skills: [SKILLS.raiseShield, SKILLS.divineLattice, SKILLS.sanctuary, SKILLS.holyStrike], items: [], attackCooldown: 2500 },
    3: { name: "Thief", class: "Thief", hp: 22, maxHp: 22, mana: 18, maxMana: 18, damage: [1, 4], accuracy: 75, armor: 0, color: "#8e44ad", skills: [SKILLS.poisonDagger, SKILLS.targetHead, SKILLS.targetArm, SKILLS.targetLegs, SKILLS.caltrops, SKILLS.dodge], items: [], attackCooldown: 1500, baseCrit: 5 },
    4: { name: "Wizard", class: "Wizard", hp: 18, maxHp: 18, mana: 50, maxMana: 50, damage: [1, 4], accuracy: 60, armor: 0, color: "#3498db", skills: [SKILLS.fireball, SKILLS.magicWave, SKILLS.glacialWhorl, SKILLS.energyShield, SKILLS.bodySwap], items: [], attackCooldown: 3000, baseCrit: 2 },
    5: { name: "Monk", class: "Monk", hp: 28, maxHp: 28, mana: 18, maxMana: 18, damage: [1, 4], accuracy: 70, armor: 0, color: "#27ae60", skills: [SKILLS.flurryOfFists, SKILLS.qiFocus, SKILLS.sunStance, SKILLS.pangolinStance], items: [], attackCooldown: 1800 },
    6: { name: "Cleric", class: "Cleric", hp: 26, maxHp: 26, mana: 40, maxMana: 40, damage: [1, 4], accuracy: 60, armor: 0, color: "#c0c8d0", skills: [SKILLS.heal, SKILLS.cleanse, SKILLS.thunder, SKILLS.restoration, SKILLS.ankh], items: [], attackCooldown: 2500 },
    7: { name: "Ancestor", class: "Ancestor", hp: 54, maxHp: 54, mana: 0, maxMana: 0, damage: [4, 8], accuracy: 74, armor: 2, color: "#d7c09a", skills: [], items: [], range: 1.8, attackCooldown: 2100, size: 1.08, baseCrit: 4 },
};

// =============================================================================
// PLAYER UNIT HELPERS
// =============================================================================

/** Generate a "basic attack" pseudo-skill for display in UI. Uses equipment stats. */
export function getBasicAttackSkill(unitId: number, unit?: Unit): Skill {
    const data = UNIT_DATA[unitId];

    const usesEquipment = usesEquipmentForUnit(unitId);
    const baseDamage = usesEquipment ? getEffectivePlayerDamage(unitId) : data.damage;
    const damageType = usesEquipment ? getEffectivePlayerDamageType(unitId) : "physical";
    const range = usesEquipment ? getEffectivePlayerRange(unitId) : data.range;
    const projectileColor = usesEquipment ? getEffectivePlayerProjectileColor(unitId) : data.projectileColor;

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
        damageRange: damage,
        damageType,
        projectileColor,
    };
}

/** Get effective max HP for a player (base + equipment + vitality bonuses) */
export function getEffectiveMaxHp(unitId: number, unit?: Unit): number {
    const data = UNIT_DATA[unitId];
    const vitalityBonus = unit ? getVitalityHpBonus(unit) : 0;
    const bonusMaxHp = usesEquipmentForUnit(unitId) ? getEffectivePlayerBonusMaxHp(unitId) : 0;
    return data.maxHp + bonusMaxHp + vitalityBonus;
}

/** Get effective max mana for a player (base + intelligence bonus) */
export function getEffectiveMaxMana(unitId: number, unit?: Unit): number {
    const data = UNIT_DATA[unitId];
    const intelligenceBonus = unit ? getIntelligenceMpBonus(unit) : 0;
    return (data.maxMana ?? 0) + intelligenceBonus;
}

/** Get effective armor for a player (from equipment) */
export function getEffectiveArmor(unitId: number): number {
    if (!usesEquipmentForUnit(unitId)) {
        return UNIT_DATA[unitId].armor;
    }
    return getEffectivePlayerArmor(unitId);
}

/** Get all learned skills for a unit (basic attack + learned special skills) */
export function getAllSkills(unitId: number, unit?: Unit): Skill[] {
    const data = UNIT_DATA[unitId];
    const learnedSet = unit?.learnedSkills;
    const specials = learnedSet !== undefined
        ? data.skills.filter(s => learnedSet.includes(s.name))
        : data.skills;
    return [getBasicAttackSkill(unitId, unit), ...specials];
}

/** Get all possible skills for a unit (for skill learning UI) */
export function getAvailableSkills(unitId: number): Skill[] {
    const data = UNIT_DATA[unitId];
    return data.skills;
}

/** Get effective unit data with equipment and stat bonuses applied */
export function getEffectiveUnitData(unitId: number, unit?: Unit): UnitData {
    const data = UNIT_DATA[unitId];
    const usesEquipment = usesEquipmentForUnit(unitId);
    const baseDamage = usesEquipment ? getEffectivePlayerDamage(unitId) : data.damage;
    const damageType = usesEquipment ? getEffectivePlayerDamageType(unitId) : "physical";
    const range = usesEquipment ? getEffectivePlayerRange(unitId) : data.range;
    const projectileColor = usesEquipment ? getEffectivePlayerProjectileColor(unitId) : data.projectileColor;
    const armor = usesEquipment ? getEffectivePlayerArmor(unitId) : data.armor;
    const bonusMaxHp = usesEquipment ? getEffectivePlayerBonusMaxHp(unitId) : 0;

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
