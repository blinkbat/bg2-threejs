import { describe, expect, it, vi } from "vitest";
import type { Skill, Unit, UnitGroup } from "../src/core/types";
import type { SkillExecutionContext } from "../src/combat/skills/types";

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

vi.mock("three", () => {
    function Color() { /* noop */ }
    Color.prototype.copy = function () { return this; };
    Color.prototype.multiplyScalar = function () { return this; };

    function Mesh() {
        this.position = { set() {}, x: 0, y: 0, z: 0 };
        this.rotation = { x: 0, y: 0, z: 0 };
        this.scale = { set() {} };
        this.renderOrder = 0;
        this.userData = {};
        this.material = { map: { image: { getContext() { return { clearRect() {}, fillText() {}, strokeText() {} }; } }, needsUpdate: false }, opacity: 1, dispose() {} };
        this.geometry = { dispose() {} };
    }

    function MeshPhongMaterial() {
        this.color = new Color();
        this.emissive = new Color();
        this.emissiveIntensity = 0;
        this.shininess = 0;
        this.transparent = false;
        this.opacity = 1;
        this.dispose = function () {};
        this.clone = function () { return new MeshPhongMaterial(); };
    }

    function MeshBasicMaterial() {
        this.dispose = function () {};
        this.opacity = 1;
    }

    function Vector3() {
        this.x = 0; this.y = 0; this.z = 0;
        this.set = function () { return this; };
        this.copy = function () { return this; };
        this.normalize = function () { return this; };
        this.multiplyScalar = function () { return this; };
    }

    return {
        Scene: function () { this.add = function () {}; this.remove = function () {}; },
        Mesh,
        PlaneGeometry: function () {},
        MeshBasicMaterial,
        MeshPhongMaterial,
        SphereGeometry: function () {},
        RingGeometry: function () {},
        CylinderGeometry: function () {},
        IcosahedronGeometry: function () {},
        BufferGeometry: function () {},
        LineBasicMaterial: function () {},
        Line: function () { this.position = { set() {} }; this.userData = {}; },
        CanvasTexture: function () { this.generateMipmaps = false; this.minFilter = 0; this.magFilter = 0; this.colorSpace = ""; },
        LinearFilter: 0,
        SRGBColorSpace: "",
        DoubleSide: 0,
        Color,
        Vector3,
    };
});

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
        range: undefined,
        projectileColor: undefined,
        attackCooldown: undefined,
        damageType: undefined,
    }),
}));

import { executeSkill } from "../src/combat/skills/index";

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

function makeUnitGroup(): UnitGroup {
    return {
        position: { x: 5, y: 0, z: 5 },
        visible: true,
        userData: {},
    } as unknown as UnitGroup;
}

function makeCtx(units: Unit[], unitsRef: Record<number, UnitGroup> = {}): SkillExecutionContext {
    return {
        scene: { add() {}, remove() {} } as any,
        unitsStateRef: { current: units } as any,
        unitsRef: { current: unitsRef } as any,
        actionCooldownRef: { current: {} } as any,
        projectilesRef: { current: [] } as any,
        hitFlashRef: { current: {} } as any,
        damageTexts: { current: [] } as any,
        unitMeshRef: { current: {} } as any,
        unitOriginalColorRef: { current: {} } as any,
        swingAnimationsRef: { current: [] } as any,
        setUnits: vi.fn() as any,
        setSkillCooldowns: vi.fn() as any,
        addLog: vi.fn(),
        defeatedThisFrame: new Set<number>(),
    };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("executeSkill", () => {
    describe("precondition checks", () => {
        it("returns false when caster is dead", () => {
            const caster = makeUnit({ id: 1, hp: 0, mana: 50 });
            const casterG = makeUnitGroup();
            const ctx = makeCtx([caster], { 1: casterG });
            const skill: Skill = { name: "Fireball", manaCost: 15, cooldown: 5000, type: "damage", targetType: "aoe", range: 10, damageRange: [8, 14], damageType: "fire" };

            expect(executeSkill(ctx, 1, skill, 10, 10)).toBe(false);
        });

        it("returns false when caster is not found in units", () => {
            const ctx = makeCtx([], {});
            const skill: Skill = { name: "Fireball", manaCost: 15, cooldown: 5000, type: "damage", targetType: "aoe", range: 10, damageRange: [8, 14], damageType: "fire" };

            expect(executeSkill(ctx, 1, skill, 10, 10)).toBe(false);
        });

        it("returns false when caster has no UnitGroup", () => {
            const caster = makeUnit({ id: 1, hp: 30, mana: 50 });
            const ctx = makeCtx([caster], {}); // no group for id 1

            const skill: Skill = { name: "Fireball", manaCost: 15, cooldown: 5000, type: "damage", targetType: "aoe", range: 10, damageRange: [8, 14], damageType: "fire" };

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
            const skill: Skill = { name: "Fireball", manaCost: 15, cooldown: 5000, type: "damage", targetType: "aoe", range: 10, damageRange: [8, 14], damageType: "fire" };

            const result = executeSkill(ctx, 1, skill, 10, 10);

            expect(result).toBe(false);
            expect(ctx.addLog).toHaveBeenCalledWith(
                expect.stringContaining("cannot act"),
                expect.any(String)
            );
        });

        it("returns false and logs when not enough mana", () => {
            const caster = makeUnit({ id: 1, hp: 30, mana: 5 });
            const casterG = makeUnitGroup();
            const ctx = makeCtx([caster], { 1: casterG });
            const skill: Skill = { name: "Fireball", manaCost: 15, cooldown: 5000, type: "damage", targetType: "aoe", range: 10, damageRange: [8, 14], damageType: "fire" };

            const result = executeSkill(ctx, 1, skill, 10, 10);

            expect(result).toBe(false);
            expect(ctx.addLog).toHaveBeenCalledWith(
                expect.stringContaining("Not enough mana"),
                expect.any(String)
            );
        });
    });

    describe("skill routing", () => {
        it("routes AoE damage skills (Fireball)", () => {
            const caster = makeUnit({ id: 1, hp: 30, mana: 50 });
            const casterG = makeUnitGroup();
            const ctx = makeCtx([caster], { 1: casterG });
            const skill: Skill = { name: "Fireball", manaCost: 15, cooldown: 5000, type: "damage", targetType: "aoe", range: 10, aoeRadius: 2.5, damageRange: [8, 14], damageType: "fire", projectileColor: "#ff4400" };

            // Fireball always returns true (fires projectile)
            const result = executeSkill(ctx, 1, skill, 10, 10);
            expect(result).toBe(true);
        });

        it("routes taunt skills", () => {
            const caster = makeUnit({ id: 1, hp: 30, mana: 50 });
            const casterG = makeUnitGroup();
            // Need enemies in range for taunt to work
            const enemy = makeUnit({ id: 100, hp: 20, team: "enemy" });
            const enemyG = makeUnitGroup();
            const ctx = makeCtx([caster, enemy], { 1: casterG, 100: enemyG });
            const skill: Skill = { name: "Warcry", manaCost: 10, cooldown: 8000, type: "taunt", targetType: "self", range: 5, aoeRadius: 5, damageType: "physical" };

            const result = executeSkill(ctx, 1, skill, 5, 5);
            // Whether true or false depends on taunt implementation finding targets,
            // but it should not crash
            expect(typeof result).toBe("boolean");
        });

        it("routes dodge/movement skills", () => {
            const caster = makeUnit({ id: 1, hp: 30, mana: 50 });
            const casterG = makeUnitGroup();
            const ctx = makeCtx([caster], { 1: casterG });
            const skill: Skill = { name: "Dodge", manaCost: 5, cooldown: 3000, type: "dodge", targetType: "self", range: 5, damageType: "physical" };

            const result = executeSkill(ctx, 1, skill, 10, 10);
            expect(typeof result).toBe("boolean");
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
            const skill: Skill = { name: "Defiance", manaCost: 10, cooldown: 15000, type: "buff", targetType: "self", range: 0, duration: 8000, damageType: "physical" };

            const result = executeSkill(ctx, 1, skill, 5, 5);
            expect(result).toBe(true);
        });

        it("routes energy shield skill", () => {
            const caster = makeUnit({ id: 4, hp: 17, mana: 50 });
            const casterG = makeUnitGroup();
            const ctx = makeCtx([caster], { 4: casterG });
            const skill: Skill = { name: "Energy Shield", manaCost: 18, cooldown: 2500, type: "energy_shield", targetType: "self", range: 0, shieldAmount: 30, duration: 20000, damageType: "chaos" };

            const result = executeSkill(ctx, 4, skill, 5, 5);
            expect(result).toBe(true);
        });
    });
});
