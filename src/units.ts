import type { UnitData, KoboldStats, Unit } from "./types";

// =============================================================================
// UNIT DATA - THAC0: lower=better, AC: lower=better
// =============================================================================

export const UNIT_DATA: Record<number, UnitData> = {
    1: { name: "Keldorn", class: "Paladin", hp: 102, maxHp: 102, damage: [8, 16], thac0: 5, ac: 2, color: "#e63946", skills: ["Lay on Hands", "True Sight", "Dispel Magic"], items: ["Carsomyr +5", "Plate Mail", "Helm of Glory", "Potion x3"] },
    2: { name: "Edwin", class: "Conjurer", hp: 42, maxHp: 42, damage: [4, 8], thac0: 18, ac: 5, color: "#457b9d", skills: ["Fireball", "Magic Missile", "Stoneskin", "Haste"], items: ["Staff of the Magi", "Edwin's Amulet", "Robe of Vecna", "Scroll Case"] },
    3: { name: "Minsc", class: "Ranger", hp: 95, maxHp: 95, damage: [10, 18], thac0: 6, ac: 0, color: "#2a9d8f", skills: ["Berserk", "Charm Animal", "Tracking"], items: ["Lilarcor +3", "Full Plate", "Boo", "Potion x5"] },
    4: { name: "Viconia", class: "Cleric", hp: 72, maxHp: 72, damage: [6, 14], thac0: 10, ac: 1, color: "#e9c46a", skills: ["Heal", "Flame Strike", "Hold Person", "Sanctuary"], items: ["Flail of Ages +3", "Dark Elven Chain", "Shield of Harmony", "Holy Symbol"] },
    5: { name: "Yoshimo", class: "Bounty Hunter", hp: 58, maxHp: 58, damage: [6, 12], thac0: 12, ac: 3, color: "#9b5de5", skills: ["Set Snare", "Detect Traps", "Hide in Shadows", "Backstab"], items: ["Katana +2", "Leather Armor +3", "Trap Kit x10", "Thieves' Tools"] },
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

// Helper to create initial units
export function createInitialUnits(): Unit[] {
    return [
        ...Object.keys(UNIT_DATA).map((id, i) => ({
            id: Number(id),
            x: 4.5 + (i % 3) * 2,
            z: 4.5 + Math.floor(i / 3) * 2,
            hp: UNIT_DATA[Number(id)].hp,
            team: "player" as const,
            target: null
        })),
        ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((_, i) => ({
            id: 100 + i,
            x: 30.5 + (i % 4) * 2,
            z: 30.5 + Math.floor(i / 4) * 2,
            hp: KOBOLD_STATS.maxHp,
            team: "enemy" as const,
            target: null
        })),
    ];
}

// Combat helpers
export const rollDamage = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
export const rollD20 = () => Math.floor(Math.random() * 20) + 1;
