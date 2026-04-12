import { describe, expect, it, beforeEach, vi } from "vitest";
import type { Unit } from "../src/core/types";

vi.mock("../src/game/playerUnits", () => ({
    getEffectiveUnitData: vi.fn((unitId: number) => ({
        name: `Player${unitId}`,
        class: "Barbarian",
        maxHp: 33,
        damage: [2, 5] as [number, number],
        accuracy: 70,
        armor: 0,
        range: 1.95,
        attackCooldown: 2000,
    })),
}));

vi.mock("../src/game/enemyStats", () => ({
    ENEMY_STATS: {
        kobold: { name: "Kobold", monsterType: "beast", maxHp: 8, damage: [1, 3], accuracy: 60, armor: 0, aggroRange: 6, range: 1.5 },
        ogre: { name: "Ogre", monsterType: "humanoid", maxHp: 50, damage: [5, 10], accuracy: 55, armor: 2, aggroRange: 8, range: 2 },
        giant_amoeba: { name: "Giant Amoeba", monsterType: "beast", maxHp: 40, damage: [3, 6], accuracy: 65, armor: 0, aggroRange: 7 },
    },
    getAmoebaMaxHpForSplitCount: vi.fn((splitCount: number) => {
        const stages = [40, 25, 15];
        return stages[splitCount] ?? 10;
    }),
}));

import { getUnitStats, getEnemyUnitStats, getAttackRange, clearUnitStatsCache, isEnemyData } from "../src/game/units";

function makePlayer(id: number): Unit {
    return { id, x: 0, z: 0, hp: 10, team: "player", target: null, aiEnabled: true };
}

function makeEnemy(id: number, enemyType: string, overrides: Partial<Unit> = {}): Unit {
    return { id, x: 0, z: 0, hp: 10, team: "enemy", enemyType, target: null, aiEnabled: true, ...overrides } as Unit;
}

describe("units", () => {
    beforeEach(() => {
        clearUnitStatsCache();
    });

    describe("getUnitStats", () => {
        it("returns player stats via getEffectiveUnitData", () => {
            const stats = getUnitStats(makePlayer(1));
            expect(stats.name).toBe("Player1");
            expect(stats.maxHp).toBe(33);
        });

        it("returns enemy stats from ENEMY_STATS registry", () => {
            const stats = getUnitStats(makeEnemy(100, "ogre"));
            expect(stats.name).toBe("Ogre");
            expect(stats.maxHp).toBe(50);
        });

        it("falls back to kobold for enemy with missing type", () => {
            const unit: Unit = { id: 100, x: 0, z: 0, hp: 5, team: "enemy", target: null, aiEnabled: true };
            const stats = getUnitStats(unit);
            expect(stats.name).toBe("Kobold");
        });

        it("caches results within same frame", () => {
            const unit = makeEnemy(100, "ogre");
            const a = getUnitStats(unit);
            const b = getUnitStats(unit);
            expect(a).toBe(b);
        });

        it("returns fresh results after cache clear", () => {
            const unit = makePlayer(1);
            const a = getUnitStats(unit);
            clearUnitStatsCache();
            const b = getUnitStats(unit);
            // Both should have same values but be fresh lookups
            expect(a.name).toBe(b.name);
        });

        it("handles giant_amoeba split count", () => {
            const amoeba = makeEnemy(100, "giant_amoeba", { splitCount: 1 });
            const stats = getUnitStats(amoeba);
            expect(stats.maxHp).toBe(25);
        });

        it("handles giant_amoeba at split 0", () => {
            const amoeba = makeEnemy(100, "giant_amoeba", { splitCount: 0 });
            const stats = getUnitStats(amoeba);
            expect(stats.maxHp).toBe(40);
        });
    });

    describe("getEnemyUnitStats", () => {
        it("returns enemy stats for valid enemy", () => {
            const stats = getEnemyUnitStats(makeEnemy(100, "kobold"));
            expect(stats.name).toBe("Kobold");
        });

        it("falls back to kobold for player unit", () => {
            const stats = getEnemyUnitStats(makePlayer(1));
            expect(stats.name).toBe("Kobold");
        });

        it("falls back to kobold for enemy without type", () => {
            const unit: Unit = { id: 100, x: 0, z: 0, hp: 5, team: "enemy", target: null, aiEnabled: true };
            const stats = getEnemyUnitStats(unit);
            expect(stats.name).toBe("Kobold");
        });
    });

    describe("isEnemyData", () => {
        it("returns true for enemy stats (has monsterType)", () => {
            const stats = getUnitStats(makeEnemy(100, "kobold"));
            expect(isEnemyData(stats)).toBe(true);
        });

        it("returns false for player stats (no monsterType)", () => {
            const stats = getUnitStats(makePlayer(1));
            expect(isEnemyData(stats)).toBe(false);
        });
    });

    describe("getAttackRange", () => {
        it("returns range from enemy stats", () => {
            expect(getAttackRange(makeEnemy(100, "ogre"))).toBe(2);
        });

        it("returns range from player stats", () => {
            expect(getAttackRange(makePlayer(1))).toBe(1.95);
        });

        it("returns default melee range when no range specified", () => {
            const unit = makeEnemy(100, "kobold");
            expect(getAttackRange(unit)).toBe(1.5);
        });
    });
});
