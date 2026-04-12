import { describe, expect, it, vi } from "vitest";

vi.mock("../src/game/equipmentState", () => ({
    getEffectivePlayerEquipmentStats: vi.fn(() => ({
        damage: [3, 8] as [number, number],
        armor: 2,
        bonusMaxHp: 10,
        bonusMaxMana: 5,
        range: undefined,
        projectileColor: undefined,
        attackCooldown: undefined,
        damageType: undefined,
    })),
}));

import {
    getEffectiveMaxHp,
    getEffectiveMaxMana,
    getXpForLevel,
    isCorePlayerId,
    getStartingPlayerStats,
    CORE_PLAYER_IDS,
    UNIT_DATA,
} from "../src/game/playerUnits";
import { HP_PER_VITALITY, MP_PER_INTELLIGENCE } from "../src/game/progression";

describe("playerUnits", () => {
    describe("getEffectiveMaxHp", () => {
        it("includes base HP + equipment bonus + vitality bonus", () => {
            // Barbarian: base 33, equipment bonus 10, starting vitality 5
            const result = getEffectiveMaxHp(1);
            const expected = UNIT_DATA[1].maxHp + 10 + (5 * HP_PER_VITALITY);
            expect(result).toBe(expected);
        });

        it("uses unit override stats when provided", () => {
            const unit = { stats: { strength: 0, dexterity: 0, vitality: 10, intelligence: 0, faith: 0 } };
            const result = getEffectiveMaxHp(1, unit as any);
            const expected = UNIT_DATA[1].maxHp + 10 + (10 * HP_PER_VITALITY);
            expect(result).toBe(expected);
        });

        it("uses starting stats when unit has no stats override", () => {
            // Wizard (id 4): base 17, starting vitality 1
            const result = getEffectiveMaxHp(4);
            const expected = UNIT_DATA[4].maxHp + 10 + (1 * HP_PER_VITALITY);
            expect(result).toBe(expected);
        });
    });

    describe("getEffectiveMaxMana", () => {
        it("includes base mana + equipment bonus + intelligence bonus", () => {
            // Wizard (id 4): base 45, equipment bonus 5, starting intelligence 5
            const result = getEffectiveMaxMana(4);
            const expected = UNIT_DATA[4].maxMana! + 5 + (5 * MP_PER_INTELLIGENCE);
            expect(result).toBe(expected);
        });

        it("uses unit override stats when provided", () => {
            const unit = { stats: { strength: 0, dexterity: 0, vitality: 0, intelligence: 20, faith: 0 } };
            const result = getEffectiveMaxMana(4, unit as any);
            const expected = UNIT_DATA[4].maxMana! + 5 + (20 * MP_PER_INTELLIGENCE);
            expect(result).toBe(expected);
        });
    });

    describe("getXpForLevel", () => {
        it("returns 0 for level 0 and below", () => {
            expect(getXpForLevel(0)).toBe(0);
            expect(getXpForLevel(-1)).toBe(0);
        });

        it("returns 0 for level 1", () => {
            expect(getXpForLevel(1)).toBe(0);
        });

        it("returns known values for early levels", () => {
            expect(getXpForLevel(2)).toBe(200);
            expect(getXpForLevel(3)).toBe(500);
            expect(getXpForLevel(4)).toBe(900);
        });

        it("scales linearly for levels beyond the table", () => {
            const lastTableLevel = 10;
            const lastTableXp = getXpForLevel(lastTableLevel);
            expect(getXpForLevel(lastTableLevel + 1)).toBe(lastTableXp + 1500);
            expect(getXpForLevel(lastTableLevel + 2)).toBe(lastTableXp + 3000);
        });
    });

    describe("isCorePlayerId", () => {
        it("returns true for core player IDs 1-6", () => {
            for (const id of CORE_PLAYER_IDS) {
                expect(isCorePlayerId(id)).toBe(true);
            }
        });

        it("returns false for non-core IDs", () => {
            expect(isCorePlayerId(0)).toBe(false);
            expect(isCorePlayerId(7)).toBe(false);
            expect(isCorePlayerId(100)).toBe(false);
        });
    });

    describe("getStartingPlayerStats", () => {
        it("returns a copy of starting stats", () => {
            const stats1 = getStartingPlayerStats(1);
            const stats2 = getStartingPlayerStats(1);
            expect(stats1).toEqual(stats2);
            expect(stats1).not.toBe(stats2);
        });

        it("barbarian starts with high vitality", () => {
            const stats = getStartingPlayerStats(1);
            expect(stats.vitality).toBe(5);
            expect(stats.strength).toBe(4);
        });

        it("wizard starts with high intelligence", () => {
            const stats = getStartingPlayerStats(4);
            expect(stats.intelligence).toBe(5);
        });

        it("returns zero stats for unknown unit ID", () => {
            const stats = getStartingPlayerStats(999);
            expect(stats.strength).toBe(0);
            expect(stats.vitality).toBe(0);
        });
    });
});
