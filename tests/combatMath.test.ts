import { afterEach, describe, expect, it, vi } from "vitest";
import type { EnemyStats, StatusEffect, Unit } from "../src/core/types";
import {
    applyPoison,
    applyStatusEffect,
    calculateSkillStatBonusBudget,
    calculateDamageWithOptionalCritChance,
    checkEnemyDefenses,
    getCooldownMultiplier,
    getDistributedStatBonus,
    getEffectiveSpeedMultiplier,
    getSkillHitChance,
} from "../src/combat/combatMath";

function makeStatusEffect(
    type: StatusEffect["type"],
    overrides: Partial<StatusEffect> = {}
): StatusEffect {
    return {
        type,
        duration: 1000,
        tickInterval: 100,
        timeSinceTick: 0,
        lastUpdateTime: 0,
        damagePerTick: 0,
        sourceId: 1,
        ...overrides,
    };
}

function makeEnemyUnit(overrides: Partial<Unit> = {}): Unit {
    return {
        id: 100,
        x: 0,
        z: 0,
        hp: 10,
        team: "enemy",
        target: null,
        aiEnabled: true,
        ...overrides,
    };
}

function makePlayerUnit(overrides: Partial<Unit> = {}): Unit {
    return {
        id: 1,
        x: 0,
        z: 0,
        hp: 20,
        mana: 10,
        team: "player",
        target: null,
        aiEnabled: true,
        ...overrides,
    };
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe("combatMath", () => {
    it("clamps and resolves skill hit chance by skill profile", () => {
        expect(getSkillHitChance(undefined, 120)).toBe(100);
        expect(getSkillHitChance(undefined, -20)).toBe(0);
        expect(getSkillHitChance({ name: "Fireball" }, 50)).toBe(100);
        expect(getSkillHitChance({ name: "Attack" }, 63)).toBe(63);
        expect(getSkillHitChance({ name: "Fireball", hitChance: 140 }, 10)).toBe(100);
        expect(getSkillHitChance({ name: "Fireball", hitChance: -10 }, 10)).toBe(0);
    });

    it("applies armor only for physical damage in optional-crit path", () => {
        vi.spyOn(Math, "random").mockReturnValue(0.99);
        const physical = calculateDamageWithOptionalCritChance(10, 10, 25, "physical", undefined, 0);
        const fire = calculateDamageWithOptionalCritChance(10, 10, 25, "fire", undefined, 0);

        expect(physical.isCrit).toBe(false);
        expect(physical.damage).toBe(1);
        expect(fire.damage).toBe(10);
    });

    it("uses crit override when provided", () => {
        vi.spyOn(Math, "random").mockReturnValue(0);
        const result = calculateDamageWithOptionalCritChance(10, 10, 0, "physical", undefined, 100);
        expect(result.isCrit).toBe(true);
        expect(result.damage).toBe(15);
    });

    it("builds and distributes a skill stat bonus budget without cloning it per hit", () => {
        const unit = makePlayerUnit({
            stats: {
                strength: 10,
                dexterity: 0,
                vitality: 0,
                intelligence: 0,
                faith: 0,
            },
        });

        const totalBudget = calculateSkillStatBonusBudget(unit, "physical", { statScaling: 1 });
        const split = [
            getDistributedStatBonus(totalBudget, 0, 4),
            getDistributedStatBonus(totalBudget, 1, 4),
            getDistributedStatBonus(totalBudget, 2, 4),
            getDistributedStatBonus(totalBudget, 3, 4),
        ];

        expect(totalBudget).toBe(5);
        expect(split).toEqual([1, 1, 1, 2]);
        expect(split.reduce((sum, value) => sum + value, 0)).toBe(totalBudget);
    });

    it("does not apply poison when cleansed is active", () => {
        const unit = makeEnemyUnit({
            statusEffects: [makeStatusEffect("cleansed")],
        });

        const updated = applyPoison(unit, 5, 123);
        expect(updated).toBe(unit);
    });

    it("applies poison when none exists", () => {
        const unit = makeEnemyUnit();
        const updated = applyPoison(unit, 5, 123, 7);

        expect(updated).not.toBe(unit);
        expect(updated.statusEffects).toBeDefined();
        expect(updated.statusEffects).toHaveLength(1);
        expect(updated.statusEffects?.[0].type).toBe("poison");
        expect(updated.statusEffects?.[0].damagePerTick).toBe(7);
    });

    it("refreshes existing poison and keeps stronger damage", () => {
        const unit = makeEnemyUnit({
            statusEffects: [
                makeStatusEffect("poison", { damagePerTick: 6, duration: 200 }),
                makeStatusEffect("slowed"),
            ],
        });

        const updated = applyPoison(unit, 7, 999, 4);
        const poison = updated.statusEffects?.find(effect => effect.type === "poison");

        expect(poison).toBeDefined();
        expect(poison?.damagePerTick).toBe(6);
        expect(poison?.lastUpdateTime).toBe(999);
    });

    it("combines cooldown multipliers from status effects", () => {
        const unit = makeEnemyUnit({
            statusEffects: [
                makeStatusEffect("slowed"),
                makeStatusEffect("chilled"),
                makeStatusEffect("constricted"),
                makeStatusEffect("defiance"),
            ],
        });

        expect(getCooldownMultiplier(unit)).toBeCloseTo(2.025, 6);
    });

    it("prioritizes front shield over block chance in defense checks", () => {
        const defense = checkEnemyDefenses(
            { frontShield: true, blockChance: 100 },
            0,
            0,
            1,
            0,
            0,
            "physical"
        );

        expect(defense).toBe("frontShield");
    });

    it("falls back to block chance when front shield does not apply", () => {
        vi.spyOn(Math, "random").mockReturnValue(0);
        const defense = checkEnemyDefenses(
            { frontShield: true, blockChance: 100 },
            0,
            1,
            0,
            0,
            0,
            "physical"
        );

        expect(defense).toBe("blockChance");
    });

    it("replaces existing status effects of the same type by default", () => {
        const existing = [
            makeStatusEffect("poison", { sourceId: 1 }),
            makeStatusEffect("slowed", { sourceId: 2 }),
        ];
        const nextPoison = makeStatusEffect("poison", { sourceId: 9 });

        const updated = applyStatusEffect(existing, nextPoison);

        expect(updated).toHaveLength(2);
        const poison = updated.find(effect => effect.type === "poison");
        expect(poison?.sourceId).toBe(9);
    });

    it("returns zero speed when pinned", () => {
        const unit = makeEnemyUnit({
            statusEffects: [makeStatusEffect("pinned")],
        });
        const stats: EnemyStats = {
            name: "Test",
            monsterType: "beast",
            tier: "enemy",
            hp: 10,
            maxHp: 10,
            damage: [1, 2],
            accuracy: 70,
            armor: 1,
            aggroRange: 5,
            attackCooldown: 1000,
            expReward: 1,
            moveSpeed: 2,
        };

        expect(getEffectiveSpeedMultiplier(unit, stats)).toBe(0);
    });

    it("applies movement debuffs and enrage multiplier for enemies", () => {
        const unit = makeEnemyUnit({
            statusEffects: [
                makeStatusEffect("slowed"),
                makeStatusEffect("chilled"),
                makeStatusEffect("hamstrung"),
                makeStatusEffect("enraged"),
            ],
        });
        const stats: EnemyStats = {
            name: "Test",
            monsterType: "beast",
            tier: "enemy",
            hp: 10,
            maxHp: 10,
            damage: [1, 2],
            accuracy: 70,
            armor: 1,
            aggroRange: 5,
            attackCooldown: 1000,
            expReward: 1,
            moveSpeed: 1.2,
            enrage: {
                hpThreshold: 0.5,
                speedMultiplier: 1.5,
                damageMultiplier: 1.2,
            },
        };

        expect(getEffectiveSpeedMultiplier(unit, stats)).toBeCloseTo(0.27, 6);
    });
});
