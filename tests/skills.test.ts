import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from "react";
import type { Color, Mesh, Scene } from "three";
import type { Skill, Unit, UnitGroup } from "../src/core/types";
import type { SkillExecutionContext } from "../src/combat/skills/types";
import { createThreeTestModule } from "./threeMock";

// Provide a minimal document.createElement for canvas/texture pooling
const globalAny = globalThis as Record<string, unknown>;
if (!globalAny.document) {
    globalAny.document = {
        createElement: () => ({
            width: 64,
            height: 32,
            getContext: () => ({
                clearRect() {},
                fillText() {},
                strokeText() {},
                measureText: () => ({ width: 0 }),
                font: "",
                fillStyle: "",
                textAlign: "",
                textBaseline: "",
                lineWidth: 0,
                strokeStyle: "",
            }),
        }),
    };
}

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("three", () => createThreeTestModule());

vi.mock("../src/audio", () => ({
    soundFns: {
        playDeath: vi.fn(),
        playGush: vi.fn(),
        playLevelUp: vi.fn(),
        playFireball: vi.fn(),
        playHeal: vi.fn(),
        playWarcry: vi.fn(),
        playChainLightning: vi.fn(),
        playEnergyShield: vi.fn(),
        playThunder: vi.fn(),
        playHolyStrike: vi.fn(),
        playMagicWave: vi.fn(),
        playBlock: vi.fn(),
        playExplosion: vi.fn(),
        playMiss: vi.fn(),
        playPoisonDagger: vi.fn(),
        playForcePush: vi.fn(),
    },
}));

vi.mock("../src/ai/movement", () => ({
    cleanupUnitState: vi.fn(),
}));

vi.mock("../src/game/enemyState", () => ({
    cleanupEnemyKiteCooldown: vi.fn(),
}));

vi.mock("../src/core/gameClock", () => ({
    getGameTime: () => 1000,
}));

vi.mock("../src/core/effectScheduler", () => ({
    scheduleEffectAnimation: vi.fn(),
}));

vi.mock("../src/game/areas", () => ({
    getCurrentArea: () => ({ gridWidth: 50, gridHeight: 50, invulnerable: false }),
    getComputedAreaData: () => ({ blocked: [] }),
    isTreeBlocked: () => false,
    isTerrainBlocked: () => false,
    isWaterTerrain: () => false,
}));

vi.mock("../src/gameLoop/enemyBehaviors/submerge", () => ({
    trySubmergeKraken: vi.fn(),
}));

vi.mock("../src/gameLoop/enemyBehaviors/untargetable", () => ({
    isEnemyUntargetable: vi.fn(() => false),
}));

vi.mock("../src/combat/barks", () => ({
    tryKillBark: vi.fn(),
    trySpellBark: vi.fn(),
    tryHealBark: vi.fn(),
    resetBarks: vi.fn(),
}));

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
    getEffectivePlayerBonusCritChance: () => 0,
    getEffectivePlayerBonusMagicDamage: () => 0,
    getEffectivePlayerMoveSpeedMultiplier: () => 1,
}));

import { executeSkill } from "../src/combat/skills/index";
import { SKILLS } from "../src/game/skills";

let randomSpy: { mockRestore(): void } | undefined;

beforeEach(() => {
    randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.5);
});

afterEach(() => {
    randomSpy?.mockRestore();
    randomSpy = undefined;
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeUnit(overrides: Partial<Unit> = {}): Unit {
    return {
        id: 1,
        x: 5,
        z: 5,
        hp: 30,
        mana: 50,
        team: "player",
        target: null,
        aiEnabled: true,
        ...overrides,
    };
}

type UnitGroupOverrides = Partial<Omit<UnitGroup, "position">> & {
    position?: { x: number; y: number; z: number };
};

function makeUnitGroup(overrides: UnitGroupOverrides = {}): UnitGroup {
    return {
        position: overrides.position ?? { x: 5, y: 0, z: 5 },
        visible: true,
        userData: {},
        ...overrides,
    } as unknown as UnitGroup;
}

function createRef<T>(current: T): RefObject<T> {
    return { current };
}

function createMutableRef<T>(current: T): MutableRefObject<T> {
    return { current };
}

function makeScene(): Scene {
    return { add() {}, remove() {} } as unknown as Scene;
}

function makeCtx(units: Unit[], unitsRef: Record<number, UnitGroup> = {}): SkillExecutionContext {
    const setUnits: Dispatch<SetStateAction<Unit[]>> = vi.fn(() => {});
    const setSkillCooldowns: Dispatch<SetStateAction<Record<string, { end: number; duration: number }>>> = vi.fn(() => {});

    return {
        scene: makeScene(),
        unitsStateRef: createRef(units),
        unitsRef: createRef(unitsRef),
        actionCooldownRef: createMutableRef<Record<number, number>>({}),
        cantripCooldownRef: createMutableRef<Record<string, number>>({}),
        projectilesRef: createMutableRef<SkillExecutionContext["projectilesRef"]["current"]>([]),
        hitFlashRef: createMutableRef<Record<number, number>>({}),
        damageTexts: createMutableRef<SkillExecutionContext["damageTexts"]["current"]>([]),
        unitMeshRef: createRef<Record<number, Mesh>>({}),
        unitOriginalColorRef: createRef<Record<number, Color>>({}),
        swingAnimationsRef: createMutableRef<SkillExecutionContext["swingAnimationsRef"]["current"]>([]),
        setUnits,
        setSkillCooldowns,
        addLog: vi.fn(),
        defeatedThisFrame: new Set<number>(),
    };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("executeSkill", () => {
    it("keeps the agreed balance values in sync", () => {
        expect(SKILLS.warcry.cooldown).toBe(7000);
        expect(SKILLS.holyCross.duration).toBe(6000);
        expect(SKILLS.magicWave.hitCount).toBe(6);
        expect(SKILLS.restoration.manaCost).toBe(14);
        expect(SKILLS.ankh.cooldown).toBe(10000);
        expect(SKILLS.vanquishingLight.duration).toBe(8000);
        expect(SKILLS.targetHead.onHitEffect?.chance).toBe(25);
        expect(SKILLS.glacialWhorl.damageRange).toEqual([5, 9]);
        expect(SKILLS.pangolinStance.maxUses).toBe(2);
        expect(SKILLS.bodySwap.manaCost).toBe(6);
        expect(SKILLS.divineLattice.manaCost).toBe(8);
        expect(SKILLS.teleportOther.manaCost).toBe(8);
    });

    it("keeps Visha's Eyes as a zero-cost cantrip", () => {
        expect(SKILLS.vishasEyes.manaCost).toBe(0);
    });

    it("labels player skills as spells or abilities", () => {
        expect(SKILLS.fireball.kind).toBe("spell");
        expect(SKILLS.bodySwap.kind).toBe("spell");
        expect(SKILLS.warcry.kind).toBe("ability");
        expect(SKILLS.fivePointPalm.kind).toBe("ability");
    });

    describe("precondition checks", () => {
        it("returns false when caster is dead", () => {
            const caster = makeUnit({ id: 1, hp: 0, mana: 50 });
            const casterG = makeUnitGroup();
            const ctx = makeCtx([caster], { 1: casterG });
            const skill: Skill = { name: "Fireball", kind: "spell", manaCost: 15, cooldown: 5000, type: "damage", targetType: "aoe", range: 10, damageRange: [8, 14], damageType: "fire" };

            expect(executeSkill(ctx, 1, skill, 10, 10)).toBe(false);
        });

        it("returns false when caster is not found in units", () => {
            const ctx = makeCtx([], {});
            const skill: Skill = { name: "Fireball", kind: "spell", manaCost: 15, cooldown: 5000, type: "damage", targetType: "aoe", range: 10, damageRange: [8, 14], damageType: "fire" };

            expect(executeSkill(ctx, 1, skill, 10, 10)).toBe(false);
        });

        it("returns false when caster has no UnitGroup", () => {
            const caster = makeUnit({ id: 1, hp: 30, mana: 50 });
            const ctx = makeCtx([caster], {}); // no group for id 1

            const skill: Skill = { name: "Fireball", kind: "spell", manaCost: 15, cooldown: 5000, type: "damage", targetType: "aoe", range: 10, damageRange: [8, 14], damageType: "fire" };

            expect(executeSkill(ctx, 1, skill, 10, 10)).toBe(false);
        });

        it("returns false and logs when caster has divine_lattice", () => {
            const caster = makeUnit({
                id: 1,
                hp: 30,
                mana: 50,
                statusEffects: [{
                    type: "divine_lattice",
                    duration: 5000,
                    tickInterval: 100,
                    timeSinceTick: 0,
                    lastUpdateTime: 0,
                    damagePerTick: 0,
                    sourceId: 1,
                }],
            });
            const casterG = makeUnitGroup();
            const ctx = makeCtx([caster], { 1: casterG });
            const skill: Skill = { name: "Fireball", kind: "spell", manaCost: 15, cooldown: 5000, type: "damage", targetType: "aoe", range: 10, damageRange: [8, 14], damageType: "fire" };

            const result = executeSkill(ctx, 1, skill, 10, 10);

            expect(result).toBe(false);
            expect(ctx.addLog).toHaveBeenCalledWith(
                expect.stringContaining("cannot act"),
                expect.any(String)
            );
        });

        it("returns false and logs when caster is stunned", () => {
            const caster = makeUnit({
                id: 1,
                hp: 30,
                mana: 50,
                statusEffects: [{
                    type: "stunned",
                    duration: 5000,
                    tickInterval: 100,
                    timeSinceTick: 0,
                    lastUpdateTime: 0,
                    damagePerTick: 0,
                    sourceId: 1,
                }],
            });
            const casterG = makeUnitGroup();
            const ctx = makeCtx([caster], { 1: casterG });
            const skill: Skill = { name: "Fireball", kind: "spell", manaCost: 15, cooldown: 5000, type: "damage", targetType: "aoe", range: 10, damageRange: [8, 14], damageType: "fire" };

            const result = executeSkill(ctx, 1, skill, 10, 10);

            expect(result).toBe(false);
            expect(ctx.addLog).toHaveBeenCalledWith(
                expect.stringContaining("cannot act while stunned"),
                expect.any(String)
            );
        });

        it("returns false and logs when caster is asleep", () => {
            const caster = makeUnit({
                id: 1,
                hp: 30,
                mana: 50,
                statusEffects: [{
                    type: "sleep",
                    duration: 5000,
                    tickInterval: 100,
                    timeSinceTick: 0,
                    lastUpdateTime: 0,
                    damagePerTick: 0,
                    sourceId: 1,
                }],
            });
            const casterG = makeUnitGroup();
            const ctx = makeCtx([caster], { 1: casterG });
            const skill: Skill = { name: "Fireball", kind: "spell", manaCost: 15, cooldown: 5000, type: "damage", targetType: "aoe", range: 10, damageRange: [8, 14], damageType: "fire" };

            const result = executeSkill(ctx, 1, skill, 10, 10);

            expect(result).toBe(false);
            expect(ctx.addLog).toHaveBeenCalledWith(
                expect.stringContaining("cannot act while asleep"),
                expect.any(String)
            );
        });

        it("returns false and logs when not enough mana", () => {
            const caster = makeUnit({ id: 1, hp: 30, mana: 5 });
            const casterG = makeUnitGroup();
            const ctx = makeCtx([caster], { 1: casterG });
            const skill: Skill = { name: "Fireball", kind: "spell", manaCost: 15, cooldown: 5000, type: "damage", targetType: "aoe", range: 10, damageRange: [8, 14], damageType: "fire" };

            const result = executeSkill(ctx, 1, skill, 10, 10);

            expect(result).toBe(false);
            expect(ctx.addLog).toHaveBeenCalledWith(
                expect.stringContaining("Not enough mana"),
                expect.any(String)
            );
        });

        it("returns false and logs when caster is silenced and tries to cast a spell", () => {
            const caster = makeUnit({
                id: 1,
                hp: 30,
                mana: 50,
                statusEffects: [{
                    type: "silenced",
                    duration: 5000,
                    tickInterval: 100,
                    timeSinceTick: 0,
                    lastUpdateTime: 0,
                    damagePerTick: 0,
                    sourceId: 1,
                }],
            });
            const casterG = makeUnitGroup();
            const ctx = makeCtx([caster], { 1: casterG });

            const result = executeSkill(ctx, 1, SKILLS.fireball, 10, 10);

            expect(result).toBe(false);
            expect(ctx.addLog).toHaveBeenCalledWith(
                expect.stringContaining("is silenced"),
                expect.any(String)
            );
        });
    });

    describe("skill routing", () => {
        it("routes AoE damage skills (Fireball)", () => {
            const caster = makeUnit({ id: 1, hp: 30, mana: 50 });
            const casterG = makeUnitGroup();
            const ctx = makeCtx([caster], { 1: casterG });
            const skill: Skill = { name: "Fireball", kind: "spell", manaCost: 15, cooldown: 5000, type: "damage", targetType: "aoe", range: 10, aoeRadius: 2.5, damageRange: [8, 14], damageType: "fire", projectileColor: "#ff4400" };

            // Fireball always returns true (fires projectile)
            const result = executeSkill(ctx, 1, skill, 10, 10);
            expect(result).toBe(true);
        });

        it("splits Magic Wave stat bonus across the volley instead of cloning it per missile", () => {
            const caster = makeUnit({
                id: 4,
                hp: 17,
                mana: 50,
                stats: {
                    strength: 0,
                    dexterity: 0,
                    vitality: 0,
                    intelligence: 10,
                    faith: 0,
                },
            });
            const casterG = makeUnitGroup();
            const ctx = makeCtx([caster], { 4: casterG });
            const skill: Skill = {
                name: "Magic Wave",
                kind: "spell",
                manaCost: 20,
                cooldown: 6000,
                type: "damage",
                targetType: "aoe",
                range: 10,
                aoeRadius: 3,
                damageRange: [2, 4],
                damageType: "chaos",
                hitCount: 4,
                projectileColor: "#9966ff",
            };

            const result = executeSkill(ctx, 4, skill, 10, 10);

            expect(result).toBe(true);
            expect(ctx.projectilesRef.current).toHaveLength(4);
            const missileBonuses = ctx.projectilesRef.current.map(projectile => projectile.statBonus ?? 0);
            expect(missileBonuses).toEqual([1, 1, 1, 2]);
            expect(missileBonuses.reduce((sum, bonus) => sum + bonus, 0)).toBe(5);
        });

        it("keeps Chain Lightning stat bonus from bleeding into later bounce decay", () => {
            const caster = makeUnit({
                id: 4,
                hp: 17,
                mana: 50,
                stats: {
                    strength: 0,
                    dexterity: 0,
                    vitality: 0,
                    intelligence: 10,
                    faith: 0,
                },
            });
            const enemyA = makeUnit({ id: 100, hp: 100, team: "enemy", enemyType: "kobold" });
            const enemyB = makeUnit({ id: 101, hp: 100, team: "enemy", enemyType: "kobold" });
            const enemyC = makeUnit({ id: 102, hp: 100, team: "enemy", enemyType: "kobold" });
            const enemyD = makeUnit({ id: 103, hp: 100, team: "enemy", enemyType: "kobold" });
            const casterG = makeUnitGroup();
            const enemyAG = makeUnitGroup({ position: { x: 7, y: 0, z: 5 } });
            const enemyBG = makeUnitGroup({ position: { x: 9, y: 0, z: 5 } });
            const enemyCG = makeUnitGroup({ position: { x: 11, y: 0, z: 5 } });
            const enemyDG = makeUnitGroup({ position: { x: 13, y: 0, z: 5 } });
            const ctx = makeCtx(
                [caster, enemyA, enemyB, enemyC, enemyD],
                { 4: casterG, 100: enemyAG, 101: enemyBG, 102: enemyCG, 103: enemyDG }
            );
            const skill: Skill = {
                name: "Chain Lightning",
                kind: "spell",
                manaCost: 20,
                cooldown: 8500,
                type: "smite",
                targetType: "enemy",
                range: 10,
                damageRange: [14, 14],
                damageType: "lightning",
            };

            const result = executeSkill(ctx, 4, skill, 7, 5, 100);

            expect(result).toBe(true);
            const updatedUnits = new Map(ctx.unitsStateRef.current.map(unit => [unit.id, unit]));
            expect(updatedUnits.get(100)?.hp).toBe(85);
            expect(updatedUnits.get(101)?.hp).toBe(92);
            expect(updatedUnits.get(102)?.hp).toBe(96);
            expect(updatedUnits.get(103)?.hp).toBe(97);
        });

        it("routes taunt skills and taunts enemies in range", () => {
            const caster = makeUnit({ id: 1, hp: 30, mana: 50 });
            const casterG = makeUnitGroup();
            const enemy = makeUnit({ id: 100, hp: 20, team: "enemy" });
            const enemyG = makeUnitGroup();
            const ctx = makeCtx([caster, enemy], { 1: casterG, 100: enemyG });
            const skill: Skill = { name: "Warcry", kind: "ability", manaCost: 10, cooldown: 8000, type: "taunt", targetType: "self", range: 5, aoeRadius: 5, damageType: "physical" };

            const result = executeSkill(ctx, 1, skill, 5, 5);

            expect(result).toBe(true);
            expect(ctx.setUnits).toHaveBeenCalled();
        });

        it("returns false for dodge without cantrip uses", () => {
            const caster = makeUnit({ id: 1, hp: 30, mana: 50 });
            const casterG = makeUnitGroup();
            const ctx = makeCtx([caster], { 1: casterG });
            const skill: Skill = { name: "Dodge", kind: "ability", manaCost: 5, cooldown: 3000, type: "dodge", targetType: "self", range: 5, damageType: "physical" };

            const result = executeSkill(ctx, 1, skill, 10, 10);

            expect(result).toBe(false);
            expect(ctx.addLog).toHaveBeenCalledWith(
                expect.stringContaining("No uses remaining"),
                expect.any(String)
            );
        });

        it("returns false for unrecognized skill type", () => {
            const caster = makeUnit({ id: 1, hp: 30, mana: 50 });
            const casterG = makeUnitGroup();
            const ctx = makeCtx([caster], { 1: casterG });
            const skill = { name: "Unknown", manaCost: 0, cooldown: 0, type: "nonexistent", targetType: "self", range: 0 } as unknown as Skill;

            const result = executeSkill(ctx, 1, skill, 5, 5);
            expect(result).toBe(false);
        });

        it("routes self-buff skills", () => {
            const caster = makeUnit({ id: 1, hp: 30, mana: 50 });
            const casterG = makeUnitGroup();
            const ctx = makeCtx([caster], { 1: casterG });
            const skill: Skill = { name: "Defiance", kind: "ability", manaCost: 10, cooldown: 15000, type: "buff", targetType: "self", range: 0, duration: 8000, damageType: "physical" };

            const result = executeSkill(ctx, 1, skill, 5, 5);
            expect(result).toBe(true);
        });

        it("still allows abilities while silenced", () => {
            const caster = makeUnit({
                id: 1,
                hp: 30,
                mana: 50,
                statusEffects: [{
                    type: "silenced",
                    duration: 5000,
                    tickInterval: 100,
                    timeSinceTick: 0,
                    lastUpdateTime: 0,
                    damagePerTick: 0,
                    sourceId: 1,
                }],
            });
            const casterG = makeUnitGroup();
            const ctx = makeCtx([caster], { 1: casterG });

            const result = executeSkill(ctx, 1, SKILLS.raiseShield, 5, 5);

            expect(result).toBe(true);
        });

        it("routes energy shield skill", () => {
            const caster = makeUnit({ id: 4, hp: 17, mana: 50 });
            const casterG = makeUnitGroup();
            const ctx = makeCtx([caster], { 4: casterG });
            const skill: Skill = { name: "Energy Shield", kind: "spell", manaCost: 18, cooldown: 2500, type: "energy_shield", targetType: "self", range: 0, shieldAmount: 30, duration: 20000, damageType: "chaos" };

            const result = executeSkill(ctx, 4, skill, 5, 5);
            expect(result).toBe(true);
        });
    });
});
