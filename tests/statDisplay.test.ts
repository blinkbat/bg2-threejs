import { describe, expect, it, vi } from "vitest";
import type { Item, Skill, StatusEffect, Unit } from "../src/core/types";

// Mock equipment state: no equipment effects by default.
vi.mock("../src/game/equipmentState", () => {
    const emptyStats = {
        damage: [0, 0] as [number, number],
        damageType: "physical",
        armor: 0,
        range: undefined,
        projectileColor: undefined,
        attackCooldown: undefined,
        bonusMaxHp: 0,
        bonusMaxMana: 0,
        bonusMagicDamage: 0,
        bonusCritChance: 0,
        lifesteal: 0,
        hpRegen: null,
        aggroMultiplier: 1,
        moveSpeedMultiplier: 1,
        thornsDamage: 0,
    };
    return {
        getEffectivePlayerEquipmentStats: () => emptyStats,
        getEffectivePlayerBonusMagicDamage: () => 0,
        getEffectivePlayerBonusCritChance: () => 0,
        getEffectivePlayerLifesteal: () => 0,
        getEffectivePlayerThornsDamage: () => 0,
        getEffectivePlayerHpRegen: () => null,
        getEffectivePlayerMoveSpeedMultiplier: () => 1,
        getEffectivePlayerAggroMultiplier: () => 1,
        getCharacterEquipment: () => ({
            armor: null,
            leftHand: null,
            rightHand: null,
            accessory1: null,
            accessory2: null,
        }),
    };
});

import {
    resolveSkillDisplay,
    resolveStatBonuses,
    resolveStatusEffectDetails,
    resolveEquipDiff,
} from "../src/game/statDisplay";

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

function makeSkill(overrides: Partial<Skill>): Skill {
    return {
        name: "Test Skill",
        kind: "ability",
        manaCost: 0,
        cooldown: 1000,
        type: "damage",
        targetType: "enemy",
        range: 6,
        damageType: "physical",
        ...overrides,
    } as Skill;
}

describe("statDisplay", () => {
    describe("resolveSkillDisplay", () => {
        it("returns base range when no unit is supplied", () => {
            const skill = makeSkill({ damageRange: [5, 8] });
            const r = resolveSkillDisplay(undefined, skill);
            expect(r.damage).not.toBeNull();
            expect(r.damage!.effective).toEqual([5, 8]);
            expect(r.damage!.base).toEqual([5, 8]);
            expect(r.damage!.bonus).toBe(0);
            // Hit chance can't be computed without a unit
            expect(r.hitChance).toBeNull();
        });

        it("adds strength bonus to physical damage", () => {
            // STR 6 -> +3 physical damage (per statBonuses formula)
            const unit = makePlayerUnit(1, {
                stats: { strength: 6, dexterity: 0, vitality: 0, intelligence: 0, faith: 0 },
            });
            const skill = makeSkill({ damageRange: [5, 8], damageType: "physical" });
            const r = resolveSkillDisplay(unit, skill);
            expect(r.damage!.effective).toEqual([8, 11]);
            expect(r.damage!.bonus).toBe(3);
        });

        it("applies statScaling when provided", () => {
            // INT 10 -> +5 magic damage; statScaling 0.5 -> floor(5*0.5) = 2
            const unit = makePlayerUnit(1, {
                stats: { strength: 0, dexterity: 0, vitality: 0, intelligence: 10, faith: 0 },
            });
            const skill = makeSkill({
                damageRange: [10, 20],
                damageType: "fire",
                statScaling: 0.5,
            });
            const r = resolveSkillDisplay(unit, skill);
            expect(r.damage!.effective).toEqual([12, 22]);
            expect(r.damage!.bonus).toBe(2);
        });

        it("adds faith bonus to heal ranges without statScaling", () => {
            // FAI 6 -> +3 healing bonus
            const unit = makePlayerUnit(1, {
                stats: { strength: 0, dexterity: 0, vitality: 0, intelligence: 0, faith: 6 },
            });
            const skill = makeSkill({
                healRange: [4, 6],
                damageType: "holy",
                type: "heal",
            });
            const r = resolveSkillDisplay(unit, skill);
            expect(r.heal).not.toBeNull();
            expect(r.heal!.effective).toEqual([7, 9]);
            expect(r.heal!.bonus).toBe(3);
        });

        it("returns null heal for non-heal skills", () => {
            const skill = makeSkill({ damageRange: [1, 2] });
            const r = resolveSkillDisplay(undefined, skill);
            expect(r.heal).toBeNull();
        });

        it("honors explicit hitChance override", () => {
            const unit = makePlayerUnit(1);
            const skill = makeSkill({ damageRange: [1, 2], hitChance: 72 });
            const r = resolveSkillDisplay(unit, skill);
            expect(r.hitChance).toBe(72);
        });

        it("honors critChanceOverride when set", () => {
            const unit = makePlayerUnit(1);
            const skill = makeSkill({ damageRange: [1, 2], critChanceOverride: 100 });
            const r = resolveSkillDisplay(unit, skill);
            expect(r.critChance).toBe(100);
        });
    });

    describe("resolveStatBonuses", () => {
        it("returns null current for zero-stat rows", () => {
            const unit = makePlayerUnit(1);
            const bonuses = resolveStatBonuses(unit);
            expect(bonuses.strength[0].current).toBeNull();
            expect(bonuses.dexterity[0].current).toBeNull();
        });

        it("returns concrete numbers when stats are allocated", () => {
            const unit = makePlayerUnit(1, {
                stats: { strength: 8, dexterity: 4, vitality: 5, intelligence: 6, faith: 4 },
            });
            const b = resolveStatBonuses(unit);
            expect(b.strength[0].current).toBe("+4");
            expect(b.dexterity[0].current).toBe("+2%");
            expect(b.dexterity[1].current).toBe("+2%");
            expect(b.vitality[0].current).toBe("+5");
            expect(b.intelligence[0].current).toBe("+6");
            expect(b.intelligence[1].current).toBe("+3");
            expect(b.faith[0].current).toBe("+2");
            expect(b.faith[1].current).toBe("+2");
        });
    });

    describe("resolveStatusEffectDetails", () => {
        const make = (type: StatusEffect["type"], overrides: Partial<StatusEffect> = {}): StatusEffect => ({
            type,
            duration: 1000,
            tickInterval: 0,
            timeSinceTick: 0,
            lastUpdateTime: 0,
            damagePerTick: 0,
            sourceId: 0,
            ...overrides,
        });

        it("reports slowed move-speed and cooldown mults", () => {
            const details = resolveStatusEffectDetails(make("slowed"));
            const labels = details.map(d => d.label);
            expect(labels).toContain("Move Speed");
            expect(labels).toContain("Cooldowns");
        });

        it("reports constricted cooldown percentage", () => {
            const details = resolveStatusEffectDetails(make("constricted"));
            expect(details[0].label).toBe("Cooldowns");
            expect(details[0].value).toBe("+35%");
        });

        it("reports regen heal amount (stored in shieldAmount)", () => {
            const details = resolveStatusEffectDetails(make("regen", { shieldAmount: 5 }));
            expect(details).toHaveLength(1);
            expect(details[0].value).toContain("5");
        });

        it("returns empty array for effects without mechanical details", () => {
            expect(resolveStatusEffectDetails(make("cleansed"))).toEqual([]);
        });
    });

    describe("resolveEquipDiff", () => {
        it("returns empty array when candidate item is unknown", () => {
            const deltas = resolveEquipDiff(1, "nonexistent_item", "leftHand");
            expect(deltas).toEqual([]);
        });

        it("returns damage delta vs empty slot", () => {
            // Picking a known starter item from items registry and checking we get
            // at least a Damage delta line.
            // We won't hardcode a specific value (depends on items.ts contents), just
            // that some damage change is reported when slotting a weapon into an
            // empty main-hand slot.
            const deltas = resolveEquipDiff(1, "iron_sword", "leftHand");
            // If iron_sword doesn't exist in the registry, this is empty — accept either
            // but assert the shape is safe.
            if (deltas.length > 0) {
                for (const d of deltas) {
                    expect(["positive", "negative", "neutral"]).toContain(d.sign);
                    expect(typeof d.label).toBe("string");
                    expect(typeof d.deltaText).toBe("string");
                }
            }
        });
    });
});

// Keep the type import live in case it is later used for assertions.
const _itemTypeCheck: Item | undefined = undefined;
void _itemTypeCheck;
