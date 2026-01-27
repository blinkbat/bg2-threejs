import type { UnitData, Skill } from "../core/types";
import { SKILLS } from "./skills";
import {
    getEffectivePlayerDamage,
    getEffectivePlayerDamageType,
    getEffectivePlayerRange,
    getEffectivePlayerProjectileColor,
    getEffectivePlayerArmor,
    getEffectivePlayerBonusMaxHp,
} from "./equipmentState";

// =============================================================================
// PLAYER UNIT DATA
// =============================================================================
// Base stats for player characters. Damage and armor come from equipment.
// These values are used as fallbacks and for non-equipment stats.

export const UNIT_DATA: Record<number, UnitData> = {
    1: { name: "Barbarian", class: "Barbarian", hp: 50, maxHp: 50, mana: 25, maxMana: 25, damage: [1, 4], accuracy: 70, armor: 0, color: "#c0392b", skills: [SKILLS.warcry, SKILLS.stunningBlow], items: [], attackCooldown: 2000 },
    2: { name: "Paladin", class: "Paladin", hp: 45, maxHp: 45, mana: 35, maxMana: 35, damage: [1, 4], accuracy: 65, armor: 0, color: "#f1c40f", skills: [SKILLS.raiseShield, SKILLS.sanctuary], items: [], attackCooldown: 2500 },
    3: { name: "Thief", class: "Thief", hp: 25, maxHp: 25, mana: 30, maxMana: 30, damage: [1, 4], accuracy: 75, armor: 0, color: "#8e44ad", skills: [SKILLS.poisonDagger, SKILLS.caltrops], items: [], attackCooldown: 1500 },
    4: { name: "Wizard", class: "Wizard", hp: 18, maxHp: 18, mana: 80, maxMana: 80, damage: [1, 4], accuracy: 60, armor: 0, color: "#3498db", skills: [SKILLS.fireball, SKILLS.magicWave], items: [], attackCooldown: 3000 },
    5: { name: "Monk", class: "Monk", hp: 35, maxHp: 35, mana: 30, maxMana: 30, damage: [1, 4], accuracy: 70, armor: 0, color: "#27ae60", skills: [SKILLS.flurryOfFists, SKILLS.qiFocus], items: [], attackCooldown: 1800 },
    6: { name: "Cleric", class: "Cleric", hp: 30, maxHp: 30, mana: 60, maxMana: 60, damage: [1, 4], accuracy: 60, armor: 0, color: "#ecf0f1", skills: [SKILLS.heal, SKILLS.cleanse], items: [], attackCooldown: 2500 },
};

// =============================================================================
// PLAYER UNIT HELPERS
// =============================================================================

/** Generate a "basic attack" pseudo-skill for display in UI. Uses equipment stats. */
export function getBasicAttackSkill(unitId: number): Skill {
    const data = UNIT_DATA[unitId];

    // Get stats from equipment
    const damage = getEffectivePlayerDamage(unitId);
    const damageType = getEffectivePlayerDamageType(unitId);
    const range = getEffectivePlayerRange(unitId);
    const projectileColor = getEffectivePlayerProjectileColor(unitId);

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

/** Get effective max HP for a player (base + equipment bonuses) */
export function getEffectiveMaxHp(unitId: number): number {
    const data = UNIT_DATA[unitId];
    return data.maxHp + getEffectivePlayerBonusMaxHp(unitId);
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

/** Get effective unit data with equipment stats applied */
export function getEffectiveUnitData(unitId: number): UnitData {
    const data = UNIT_DATA[unitId];
    const damage = getEffectivePlayerDamage(unitId);
    const range = getEffectivePlayerRange(unitId);
    const projectileColor = getEffectivePlayerProjectileColor(unitId);
    const armor = getEffectivePlayerArmor(unitId);
    const bonusMaxHp = getEffectivePlayerBonusMaxHp(unitId);

    return {
        ...data,
        damage,
        armor,
        maxHp: data.maxHp + bonusMaxHp,
        range,
        projectileColor,
    };
}
