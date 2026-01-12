import type { UnitData, KoboldStats, Unit, Skill } from "./types";

// =============================================================================
// SKILLS
// =============================================================================

export const SKILLS: Record<string, Skill> = {
    fireball: {
        name: "Fireball",
        manaCost: 15,
        cooldown: 5000,
        type: "damage",
        targetType: "aoe",
        range: 10,
        aoeRadius: 2.5,
        value: [8, 14],
        projectileColor: "#ff4400"
    },
    heal: {
        name: "Heal",
        manaCost: 10,
        cooldown: 4000,
        type: "heal",
        targetType: "ally",
        range: 8,
        value: [8, 12]
    }
};

// =============================================================================
// UNIT DATA - Simple party, no complex D&D logic yet
// =============================================================================

export const UNIT_DATA: Record<number, UnitData> = {
    1: { name: "Barbarian", class: "Barbarian", hp: 50, maxHp: 50, damage: [3, 6], accuracy: 70, armor: 2, color: "#c0392b", skills: [], items: ["Axe"], attackCooldown: 2000 },
    2: { name: "Paladin", class: "Paladin", hp: 45, maxHp: 45, damage: [2, 5], accuracy: 65, armor: 3, color: "#f1c40f", skills: [], items: ["Mace"], attackCooldown: 2500 },
    3: { name: "Thief", class: "Thief", hp: 25, maxHp: 25, damage: [2, 4], accuracy: 75, armor: 1, color: "#8e44ad", skills: [], items: ["Bow"], range: 7, projectileColor: "#a0522d", attackCooldown: 1500 },
    4: { name: "Wizard", class: "Wizard", hp: 18, maxHp: 18, mana: 50, maxMana: 50, damage: [3, 5], accuracy: 60, armor: 0, color: "#3498db", skills: [SKILLS.fireball], items: ["Staff"], range: 8, projectileColor: "#ff6600", attackCooldown: 3000 },
    5: { name: "Monk", class: "Monk", hp: 35, maxHp: 35, damage: [2, 5], accuracy: 70, armor: 1, color: "#27ae60", skills: [], items: ["Fists"], attackCooldown: 1800 },
    6: { name: "Cleric", class: "Cleric", hp: 30, maxHp: 30, mana: 40, maxMana: 40, damage: [2, 4], accuracy: 60, armor: 2, color: "#ecf0f1", skills: [SKILLS.heal], items: ["Staff"], range: 6, projectileColor: "#ffffaa", attackCooldown: 2500 },
};

export const KOBOLD_STATS: KoboldStats = {
    name: "Kobold",
    hp: 12,
    maxHp: 12,
    damage: [1, 4],
    accuracy: 50,
    armor: 0,
    color: "#8B4513",
    aggroRange: 6,
    attackCooldown: 2000
};

// Kobold spawn locations across the dungeon
const koboldSpawns = [
    // Room D - kobold lair (NE) - 4 kobolds
    { x: 30.5, z: 30.5 }, { x: 32.5, z: 30.5 }, { x: 30.5, z: 32.5 }, { x: 32.5, z: 32.5 },
    // Room E - central great hall - 3 kobolds
    { x: 18.5, z: 18.5 }, { x: 20.5, z: 20.5 }, { x: 22.5, z: 18.5 },
    // Room B - NW - 2 kobolds
    { x: 4.5, z: 28.5 }, { x: 6.5, z: 28.5 },
    // Room C - SE - 3 kobolds
    { x: 31.5, z: 4.5 }, { x: 33.5, z: 4.5 }, { x: 32.5, z: 6.5 },
    // Room F - S middle - 2 kobolds
    { x: 17.5, z: 4.5 }, { x: 19.5, z: 4.5 },
    // Room G - W middle - 2 kobolds
    { x: 4.5, z: 17.5 }, { x: 4.5, z: 19.5 },
    // Room H - E middle - 2 kobolds
    { x: 33.5, z: 17.5 }, { x: 33.5, z: 19.5 },
    // Room I - N middle - 2 kobolds
    { x: 17.5, z: 34.5 }, { x: 19.5, z: 34.5 },
];

// Helper to create initial units
export function createInitialUnits(): Unit[] {
    return [
        ...Object.keys(UNIT_DATA).map((id, i) => {
            const data = UNIT_DATA[Number(id)];
            return {
                id: Number(id),
                x: 4.5 + (i % 3) * 2,
                z: 4.5 + Math.floor(i / 3) * 2,
                hp: data.hp,
                mana: data.mana,
                team: "player" as const,
                target: null,
                aiEnabled: true
            };
        }),
        ...koboldSpawns.map((spawn, i) => ({
            id: 100 + i,
            x: spawn.x,
            z: spawn.z,
            hp: KOBOLD_STATS.maxHp,
            team: "enemy" as const,
            target: null,
            aiEnabled: true
        })),
    ];
}

// Combat helpers
export const rollDamage = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
export const rollHit = (accuracy: number) => Math.random() * 100 < accuracy;

// Generate a "basic attack" pseudo-skill for display in UI
export function getBasicAttackSkill(unitId: number): Skill {
    const data = UNIT_DATA[unitId];
    return {
        name: "Attack",
        manaCost: 0,
        cooldown: data.attackCooldown,
        type: "damage",
        targetType: "enemy",
        range: data.range ?? 1.8,
        value: data.damage,
    };
}

// Get all skills for a unit (basic attack + special skills)
export function getAllSkills(unitId: number): Skill[] {
    const data = UNIT_DATA[unitId];
    return [getBasicAttackSkill(unitId), ...data.skills];
}
