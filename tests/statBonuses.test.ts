import { describe, expect, it, vi } from "vitest";
import type { Unit } from "../src/core/types";

// Mock equipment state to return no equipment bonuses
vi.mock("../src/game/equipmentState", () => ({
    getEffectivePlayerEquipmentStats: () => ({
        damage: [1, 4] as [number, number],
        armor: 0,
        bonusMaxHp: 0,
        bonusMaxMana: 0,
        range: undefined,
        projectileColor: undefined,
        attackCooldown: undefined,
        damageType: undefined,
    }),
}));

import {
    getStrengthDamageBonus,
    getDexterityCritChance,
    getIntelligenceMagicDamageBonus,
    getFaithHolyDamageBonus,
    getFaithHealingBonus,
    CRIT_MULTIPLIER,
    HP_PER_VITALITY,
    MP_PER_INTELLIGENCE,
    LEVEL_UP_HP,
    LEVEL_UP_MANA,
    LEVEL_UP_STAT_POINTS,
    LEVEL_UP_SKILL_POINTS,
} from "../src/game/statBonuses";

import { getEffectiveMaxHp, getEffectiveMaxMana } from "../src/game/playerUnits";

function makePlayerUnit(id: number, overrides: Partial<Unit> = {}): Unit {
    return {
        id,
        x: 0,
        z: 0,
        hp: 20,
        team: "player",
        target: null,
        aiEnabled: true,
        ...overrides,
    };
}

describe("statBonuses", () => {
    describe("getStrengthDamageBonus", () => {
        it("returns 0 for unit with no stats", () => {
            const unit = makePlayerUnit(1);
            expect(getStrengthDamageBonus(unit)).toBe(0);
        });

        it("returns floor(strength / 2)", () => {
            const unit = makePlayerUnit(1, {
                stats: { strength: 7, dexterity: 0, vitality: 0, intelligence: 0, faith: 0 },
            });
            expect(getStrengthDamageBonus(unit)).toBe(3);
        });

        it("returns 0 for strength 1", () => {
            const unit = makePlayerUnit(1, {
                stats: { strength: 1, dexterity: 0, vitality: 0, intelligence: 0, faith: 0 },
            });
            expect(getStrengthDamageBonus(unit)).toBe(0);
        });
    });

    describe("getDexterityCritChance", () => {
        it("includes base crit for player units", () => {
            // Barbarian (id=1) has baseCrit: 3 and starting dex: 1
            // With no explicit stats, uses starting stats (dex=1) → floor(1/2)=0 + baseCrit=3 = 3
            const unit = makePlayerUnit(1);
            expect(getDexterityCritChance(unit)).toBe(3);
        });

        it("adds dex bonus to base crit", () => {
            // Thief (id=3) has baseCrit: 5
            const unit = makePlayerUnit(3, {
                stats: { strength: 0, dexterity: 10, vitality: 0, intelligence: 0, faith: 0 },
            });
            expect(getDexterityCritChance(unit)).toBe(10); // floor(10/2)=5 + baseCrit=5
        });

        it("returns enemy baseCrit for enemies (ignores dex)", () => {
            const unit: Unit = {
                id: 100,
                x: 0,
                z: 0,
                hp: 10,
                team: "enemy",
                enemyType: "kobold",
                target: null,
                aiEnabled: true,
            };
            // Kobold has no baseCrit → 0
            expect(getDexterityCritChance(unit)).toBe(0);
        });
    });

    describe("getIntelligenceMagicDamageBonus", () => {
        it("returns floor(intelligence / 2)", () => {
            const unit = makePlayerUnit(4, {
                stats: { strength: 0, dexterity: 0, vitality: 0, intelligence: 9, faith: 0 },
            });
            expect(getIntelligenceMagicDamageBonus(unit)).toBe(4);
        });
    });

    describe("getFaithHolyDamageBonus", () => {
        it("returns floor(faith / 2)", () => {
            const unit = makePlayerUnit(6, {
                stats: { strength: 0, dexterity: 0, vitality: 0, intelligence: 0, faith: 6 },
            });
            expect(getFaithHolyDamageBonus(unit)).toBe(3);
        });
    });

    describe("getFaithHealingBonus", () => {
        it("matches holy damage bonus formula", () => {
            const unit = makePlayerUnit(6, {
                stats: { strength: 0, dexterity: 0, vitality: 0, intelligence: 0, faith: 8 },
            });
            expect(getFaithHealingBonus(unit)).toBe(4);
        });
    });

    describe("constants", () => {
        it("exports expected progression constants", () => {
            expect(CRIT_MULTIPLIER).toBe(1.5);
            expect(HP_PER_VITALITY).toBe(1);
            expect(MP_PER_INTELLIGENCE).toBe(1);
            expect(LEVEL_UP_HP).toBe(2);
            expect(LEVEL_UP_MANA).toBe(1);
            expect(LEVEL_UP_STAT_POINTS).toBe(5);
            expect(LEVEL_UP_SKILL_POINTS).toBe(1);
        });
    });

    describe("getEffectiveMaxHp", () => {
        it("adds vitality bonus to base HP", () => {
            // Barbarian (id=1) has maxHp: 33, starting vitality: 5
            // 33 + 0 (equipment) + 5*1 = 38
            const unit = makePlayerUnit(1);
            expect(getEffectiveMaxHp(1, unit)).toBe(38);
        });

        it("includes allocated vitality", () => {
            const unit = makePlayerUnit(1, {
                stats: { strength: 0, dexterity: 0, vitality: 10, intelligence: 0, faith: 0 },
            });
            // 33 + 0 (equipment) + 10*1 = 43
            expect(getEffectiveMaxHp(1, unit)).toBe(43);
        });
    });

    describe("getEffectiveMaxMana", () => {
        it("adds intelligence bonus to base mana", () => {
            // Wizard (id=4) has maxMana: 45, starting intelligence: 5
            // 45 + 5*1 = 50
            const unit = makePlayerUnit(4);
            expect(getEffectiveMaxMana(4, unit)).toBe(50);
        });

        it("includes allocated intelligence", () => {
            const unit = makePlayerUnit(4, {
                stats: { strength: 0, dexterity: 0, vitality: 0, intelligence: 20, faith: 0 },
            });
            // 45 + 20*1 = 65
            expect(getEffectiveMaxMana(4, unit)).toBe(65);
        });
    });
});
