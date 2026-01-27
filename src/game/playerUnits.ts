import type { UnitData, Skill } from "../core/types";
import { SKILLS } from "./skills";

// =============================================================================
// PLAYER UNIT DATA
// =============================================================================

export const UNIT_DATA: Record<number, UnitData> = {
    1: { name: "Barbarian", class: "Barbarian", hp: 50, maxHp: 50, mana: 25, maxMana: 25, damage: [4, 8], accuracy: 70, armor: 2, color: "#c0392b", skills: [SKILLS.warcry, SKILLS.stunningBlow], items: ["Axe"], attackCooldown: 2000 },
    2: { name: "Paladin", class: "Paladin", hp: 45, maxHp: 45, mana: 35, maxMana: 35, damage: [3, 6], accuracy: 65, armor: 3, color: "#f1c40f", skills: [SKILLS.raiseShield, SKILLS.sanctuary], items: ["Mace"], attackCooldown: 2500 },
    3: { name: "Thief", class: "Thief", hp: 25, maxHp: 25, mana: 30, maxMana: 30, damage: [2, 4], accuracy: 75, armor: 1, color: "#8e44ad", skills: [SKILLS.poisonDagger, SKILLS.caltrops], items: ["Bow"], range: 7, projectileColor: "#a0522d", attackCooldown: 1500 },
    4: { name: "Wizard", class: "Wizard", hp: 18, maxHp: 18, mana: 80, maxMana: 80, damage: [1, 5], accuracy: 60, armor: 0, color: "#3498db", skills: [SKILLS.fireball, SKILLS.magicWave], items: ["Staff"], range: 8, projectileColor: "#ff6600", attackCooldown: 3000 },
    5: { name: "Monk", class: "Monk", hp: 35, maxHp: 35, mana: 30, maxMana: 30, damage: [2, 5], accuracy: 70, armor: 1, color: "#27ae60", skills: [SKILLS.flurryOfFists, SKILLS.qiFocus], items: ["Fists"], attackCooldown: 1800 },
    6: { name: "Cleric", class: "Cleric", hp: 30, maxHp: 30, mana: 60, maxMana: 60, damage: [2, 4], accuracy: 60, armor: 2, color: "#ecf0f1", skills: [SKILLS.heal, SKILLS.cleanse], items: ["Staff"], range: 6, projectileColor: "#ffffaa", attackCooldown: 2500 },
};

// =============================================================================
// PLAYER UNIT HELPERS
// =============================================================================

/** Generate a "basic attack" pseudo-skill for display in UI */
export function getBasicAttackSkill(unitId: number): Skill {
    const data = UNIT_DATA[unitId];
    // Determine damage type based on class
    const damageType = data.class === "Wizard" ? "chaos" as const
        : data.class === "Cleric" ? "holy" as const
        : "physical" as const;
    return {
        name: "Attack",
        manaCost: 0,
        cooldown: data.attackCooldown,
        type: "damage",
        targetType: "enemy",
        range: data.range ?? 1.8,
        value: data.damage,
        damageType,
    };
}

/** Get all skills for a unit (basic attack + special skills) */
export function getAllSkills(unitId: number): Skill[] {
    const data = UNIT_DATA[unitId];
    return [getBasicAttackSkill(unitId), ...data.skills];
}
