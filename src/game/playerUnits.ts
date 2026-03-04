import type { UnitData, Skill, Unit, CharacterStats } from "../core/types";
import { SKILLS } from "./skills";
import {
    getEffectivePlayerEquipmentStats,
} from "./equipmentState";
import {
    HP_PER_VITALITY,
    MP_PER_INTELLIGENCE,
} from "./progression";

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
export const VISHAS_EYE_SUMMON_IDS = [8, 9, 10] as const;

const CORE_PLAYER_ID_SET = new Set<number>(CORE_PLAYER_IDS);

export function isCorePlayerId(unitId: number): boolean {
    return CORE_PLAYER_ID_SET.has(unitId);
}

function usesEquipmentForUnit(unitId: number): boolean {
    return isCorePlayerId(unitId);
}

const ZERO_CHARACTER_STATS: CharacterStats = {
    strength: 0,
    dexterity: 0,
    vitality: 0,
    intelligence: 0,
    faith: 0,
};

export const STARTING_PLAYER_STATS: Record<number, CharacterStats> = {
    1: { strength: 4, dexterity: 1, vitality: 5, intelligence: 0, faith: 0 }, // Barbarian
    2: { strength: 2, dexterity: 2, vitality: 3, intelligence: 1, faith: 2 }, // Paladin
    3: { strength: 2, dexterity: 5, vitality: 2, intelligence: 1, faith: 0 }, // Thief
    4: { strength: 0, dexterity: 2, vitality: 1, intelligence: 5, faith: 2 }, // Wizard
    5: { strength: 3, dexterity: 3, vitality: 3, intelligence: 1, faith: 0 }, // Monk
    6: { strength: 1, dexterity: 1, vitality: 2, intelligence: 3, faith: 3 }, // Cleric
};

function resolveStats(unitId: number, stats?: CharacterStats): CharacterStats {
    if (stats) return stats;
    return STARTING_PLAYER_STATS[unitId] ?? ZERO_CHARACTER_STATS;
}

function getStrengthBonusFromStats(stats: CharacterStats): number {
    return Math.floor(stats.strength / 2);
}

function getDexterityAccuracyBonusFromStats(stats: CharacterStats): number {
    return Math.floor(stats.dexterity / 2);
}

export function getStartingPlayerStats(unitId: number): CharacterStats {
    return { ...resolveStats(unitId) };
}

// =============================================================================
// PLAYER UNIT DATA
// =============================================================================
// Base stats for player characters. Damage and armor come from equipment.
// These values are used as fallbacks and for non-equipment stats.

// Level 1 base stats - characters gain stats on level up
export const UNIT_DATA: Record<number, UnitData> = {
    1: { name: "Barbarian", class: "Barbarian", hp: 33, maxHp: 33, mana: 15, maxMana: 15, damage: [1, 4], accuracy: 70, armor: 0, skills: [SKILLS.warcry, SKILLS.defiance, SKILLS.stunningBlow, SKILLS.summonAncestor, SKILLS.highlandDefense], items: [], range: 1.95, attackCooldown: 2000, baseCrit: 3 },
    2: { name: "Paladin", class: "Paladin", hp: 32, maxHp: 32, mana: 19, maxMana: 19, damage: [1, 4], accuracy: 65, armor: 0, skills: [SKILLS.raiseShield, SKILLS.divineLattice, SKILLS.sanctuary, SKILLS.holyStrike, SKILLS.vanquishingLight], items: [], range: 1.7, attackCooldown: 2500 },
    3: { name: "Thief", class: "Thief", hp: 20, maxHp: 20, mana: 17, maxMana: 17, damage: [1, 4], accuracy: 75, armor: 0, skills: [SKILLS.poisonDagger, SKILLS.targetHead, SKILLS.targetArm, SKILLS.targetLegs, SKILLS.caltrops, SKILLS.dodge], items: [], attackCooldown: 1500, baseCrit: 5 },
    4: { name: "Wizard", class: "Wizard", hp: 17, maxHp: 17, mana: 45, maxMana: 45, damage: [1, 4], accuracy: 60, armor: 0, skills: [SKILLS.fireball, SKILLS.chainLightning, SKILLS.magicWave, SKILLS.glacialWhorl, SKILLS.energyShield, SKILLS.bodySwap], items: [], attackCooldown: 3000, baseCrit: 2 },
    5: { name: "Monk", class: "Monk", hp: 25, maxHp: 25, mana: 17, maxMana: 17, damage: [1, 4], accuracy: 70, armor: 0, skills: [SKILLS.flurryOfFists, SKILLS.forcePush, SKILLS.qiFocus, SKILLS.sunStance, SKILLS.pangolinStance], items: [], attackCooldown: 1800 },
    6: { name: "Cleric", class: "Cleric", hp: 24, maxHp: 24, mana: 37, maxMana: 37, damage: [1, 4], accuracy: 60, armor: 0, skills: [SKILLS.heal, SKILLS.cleanse, SKILLS.thunder, SKILLS.holyCross, SKILLS.vishasEyes, SKILLS.restoration, SKILLS.ankh], items: [], attackCooldown: 2500 },
    7: { name: "Ancestor", class: "Ancestor", hp: 54, maxHp: 54, mana: 0, maxMana: 0, damage: [4, 8], accuracy: 74, armor: 2, skills: [], items: [], range: 1.8, attackCooldown: 2100, size: 1.08, baseCrit: 4 },
    8: { name: "Visha's Eye", class: "Visha Orb", hp: 16, maxHp: 16, mana: 0, maxMana: 0, damage: [4, 7], accuracy: 100, armor: 0, skills: [], items: [], range: 8, projectileColor: "#fff4bf", attackCooldown: 1700, size: 0.55, baseCrit: 0, basicDamageType: "holy", shape: "sphere" },
    9: { name: "Visha's Eye", class: "Visha Orb", hp: 16, maxHp: 16, mana: 0, maxMana: 0, damage: [4, 7], accuracy: 100, armor: 0, skills: [], items: [], range: 8, projectileColor: "#fff4bf", attackCooldown: 1700, size: 0.55, baseCrit: 0, basicDamageType: "holy", shape: "sphere" },
    10: { name: "Visha's Eye", class: "Visha Orb", hp: 16, maxHp: 16, mana: 0, maxMana: 0, damage: [4, 7], accuracy: 100, armor: 0, skills: [], items: [], range: 8, projectileColor: "#fff4bf", attackCooldown: 1700, size: 0.55, baseCrit: 0, basicDamageType: "holy", shape: "sphere" },
};

// =============================================================================
// PLAYER UNIT HELPERS
// =============================================================================

/** Generate a "basic attack" pseudo-skill for display in UI. Uses equipment stats. */
export function getBasicAttackSkill(unitId: number): Skill {
    const data = UNIT_DATA[unitId];

    const usesEquipment = usesEquipmentForUnit(unitId);
    const equipmentStats = usesEquipment ? getEffectivePlayerEquipmentStats(unitId) : null;
    const damage = equipmentStats?.damage ?? data.damage;
    const damageType = equipmentStats?.damageType ?? (data.basicDamageType ?? "physical");
    const range = equipmentStats?.range ?? data.range;
    const projectileColor = equipmentStats?.projectileColor ?? data.projectileColor;
    const attackCooldown = equipmentStats?.attackCooldown ?? data.attackCooldown;

    return {
        name: "Attack",
        manaCost: 0,
        cooldown: attackCooldown,
        type: "damage",
        targetType: "enemy",
        range: range ?? 1.55,
        damageRange: damage,
        damageType,
        projectileColor,
    };
}

export function getEffectiveMaxHpForStats(unitId: number, stats?: CharacterStats): number {
    const data = UNIT_DATA[unitId];
    const resolvedStats = resolveStats(unitId, stats);
    const vitalityBonus = resolvedStats.vitality * HP_PER_VITALITY;
    const bonusMaxHp = usesEquipmentForUnit(unitId) ? getEffectivePlayerEquipmentStats(unitId).bonusMaxHp : 0;
    return data.maxHp + bonusMaxHp + vitalityBonus;
}

/** Get effective max HP for a player (base + equipment + vitality bonuses) */
export function getEffectiveMaxHp(unitId: number, unit?: Unit): number {
    return getEffectiveMaxHpForStats(unitId, unit?.stats);
}

export function getEffectiveMaxManaForStats(unitId: number, stats?: CharacterStats): number {
    const data = UNIT_DATA[unitId];
    const resolvedStats = resolveStats(unitId, stats);
    const intelligenceBonus = resolvedStats.intelligence * MP_PER_INTELLIGENCE;
    return (data.maxMana ?? 0) + intelligenceBonus;
}

/** Get effective max mana for a player (base + intelligence bonus) */
export function getEffectiveMaxMana(unitId: number, unit?: Unit): number {
    return getEffectiveMaxManaForStats(unitId, unit?.stats);
}

/** Get all learned skills for a unit (basic attack + learned special skills) */
export function getAllSkills(unitId: number, unit?: Unit): Skill[] {
    const data = UNIT_DATA[unitId];
    const learnedSet = unit?.learnedSkills;
    const specials = learnedSet !== undefined
        ? data.skills.filter(s => learnedSet.includes(s.name))
        : data.skills;
    return [getBasicAttackSkill(unitId), ...specials];
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
    const equipmentStats = usesEquipment ? getEffectivePlayerEquipmentStats(unitId) : null;
    const baseDamage = equipmentStats?.damage ?? data.damage;
    const damageType = equipmentStats?.damageType ?? (data.basicDamageType ?? "physical");
    const range = equipmentStats?.range ?? data.range;
    const projectileColor = equipmentStats?.projectileColor ?? data.projectileColor;
    const armor = equipmentStats?.armor ?? data.armor;
    const bonusMaxHp = equipmentStats?.bonusMaxHp ?? 0;
    const attackCooldown = equipmentStats?.attackCooldown ?? data.attackCooldown;

    // Apply stat bonuses
    const resolvedStats = resolveStats(unitId, unit?.stats);
    const vitalityBonus = resolvedStats.vitality * HP_PER_VITALITY;
    const intelligenceBonus = resolvedStats.intelligence * MP_PER_INTELLIGENCE;
    const dexterityBonus = getDexterityAccuracyBonusFromStats(resolvedStats);
    const strengthBonus = damageType === "physical" ? getStrengthBonusFromStats(resolvedStats) : 0;

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
        attackCooldown,
        basicDamageType: damageType,
    };
}
