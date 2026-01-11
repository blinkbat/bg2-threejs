import type { UnitData, KoboldStats, Unit } from "./types";

// =============================================================================
// UNIT DATA - Simple party, no complex D&D logic yet
// =============================================================================

export const UNIT_DATA: Record<number, UnitData> = {
    1: { name: "Barbarian", class: "Barbarian", hp: 120, maxHp: 120, damage: [8, 14], thac0: 8, ac: 4, color: "#c0392b", skills: [], items: ["Axe"] },
    2: { name: "Paladin", class: "Paladin", hp: 100, maxHp: 100, damage: [6, 12], thac0: 10, ac: 2, color: "#f1c40f", skills: [], items: ["Mace"] },
    3: { name: "Thief", class: "Thief", hp: 60, maxHp: 60, damage: [4, 8], thac0: 12, ac: 6, color: "#8e44ad", skills: [], items: ["Bow"], range: 7, projectileColor: "#a0522d" },
    4: { name: "Wizard", class: "Wizard", hp: 40, maxHp: 40, damage: [6, 10], thac0: 14, ac: 8, color: "#3498db", skills: [], items: ["Staff"], range: 8, projectileColor: "#ff6600" },
    5: { name: "Monk", class: "Monk", hp: 80, maxHp: 80, damage: [5, 10], thac0: 10, ac: 5, color: "#27ae60", skills: [], items: ["Fists"] },
    6: { name: "Cleric", class: "Cleric", hp: 70, maxHp: 70, damage: [4, 8], thac0: 12, ac: 4, color: "#ecf0f1", skills: [], items: ["Staff"], range: 6, projectileColor: "#ffffaa" },
};

export const KOBOLD_STATS: KoboldStats = {
    name: "Kobold",
    hp: 12,
    maxHp: 12,
    damage: [1, 4],
    thac0: 20,
    ac: 7,
    color: "#8B4513",
    aggroRange: 6
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
        ...Object.keys(UNIT_DATA).map((id, i) => ({
            id: Number(id),
            x: 4.5 + (i % 3) * 2,
            z: 4.5 + Math.floor(i / 3) * 2,
            hp: UNIT_DATA[Number(id)].hp,
            team: "player" as const,
            target: null,
            aiEnabled: true
        })),
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
export const rollD20 = () => Math.floor(Math.random() * 20) + 1;
