import { afterEach, describe, expect, it, vi } from "vitest";
import type { Unit, UnitGroup, DamageText, StatusEffect } from "../src/core/types";

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

    return {
        Scene: function () {},
        Mesh,
        PlaneGeometry: function () {},
        MeshBasicMaterial,
        MeshPhongMaterial,
        SphereGeometry: function () {},
        RingGeometry: function () {},
        CylinderGeometry: function () {},
        CanvasTexture: function () { this.generateMipmaps = false; this.minFilter = 0; this.magFilter = 0; this.colorSpace = ""; },
        LinearFilter: 0,
        SRGBColorSpace: "",
        DoubleSide: 0,
        Color,
    };
});

vi.mock("../src/audio", () => ({
    soundFns: {
        playDeath: vi.fn(),
        playGush: vi.fn(),
        playLevelUp: vi.fn(),
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
}));

import { applyDamageToUnit, handleUnitDefeat, applyLifesteal, getAliveUnitsInRange } from "../src/combat/damageEffects";
import type { DamageContext } from "../src/combat/damageEffects";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeUnit(overrides: Partial<Unit> = {}): Unit {
    return {
        id: 100,
        x: 5,
        z: 5,
        hp: 50,
        team: "enemy",
        target: null,
        aiEnabled: true,
        ...overrides,
    };
}

function makeUnitGroup(overrides: Partial<UnitGroup> = {}): UnitGroup {
    return {
        position: { x: 5, y: 0, z: 5 },
        visible: true,
        userData: {},
        ...overrides,
    } as unknown as UnitGroup;
}

function makeStatusEffect(type: StatusEffect["type"], overrides: Partial<StatusEffect> = {}): StatusEffect {
    return {
        type,
        duration: 5000,
        tickInterval: 100,
        timeSinceTick: 0,
        lastUpdateTime: 0,
        damagePerTick: 0,
        sourceId: 1,
        ...overrides,
    };
}

function makeCtx(units: Unit[], unitsRef: Record<number, UnitGroup> = {}): DamageContext {
    // applySyncedUnitsUpdate manages unitsStateRef.current internally,
    // so setUnits should be a no-op mock — the ref is the source of truth.
    const ref = { current: units };
    const setUnits = vi.fn();
    return {
        scene: { add() {}, remove() {} } as any,
        damageTexts: [] as DamageText[],
        hitFlashRef: {},
        unitsRef,
        unitsStateRef: ref as unknown as React.RefObject<Unit[]>,
        setUnits: setUnits as unknown as React.Dispatch<React.SetStateAction<Unit[]>>,
        addLog: vi.fn(),
        now: 1000,
        defeatedThisFrame: new Set<number>(),
    };
}

afterEach(() => {
    vi.restoreAllMocks();
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("damageEffects", () => {
    describe("applyDamageToUnit", () => {
        it("reduces target HP by damage amount", () => {
            const target = makeUnit({ id: 10, hp: 50 });
            const targetG = makeUnitGroup();
            const ctx = makeCtx([target], { 10: targetG });

            applyDamageToUnit(ctx, 10, targetG, 15, "Kobold");

            expect(ctx.setUnits).toHaveBeenCalled();
            const updatedUnits = ctx.unitsStateRef.current;
            expect(updatedUnits[0].hp).toBe(35);
        });

        it("clamps HP to 0 on lethal damage", () => {
            const target = makeUnit({ id: 10, hp: 5 });
            const targetG = makeUnitGroup();
            const ctx = makeCtx([target], { 10: targetG });

            applyDamageToUnit(ctx, 10, targetG, 100, "Kobold");

            const updatedUnits = ctx.unitsStateRef.current;
            expect(updatedUnits[0].hp).toBe(0);
        });

        it("skips already-defeated targets this frame", () => {
            const target = makeUnit({ id: 10, hp: 50 });
            const targetG = makeUnitGroup();
            const ctx = makeCtx([target], { 10: targetG });
            ctx.defeatedThisFrame!.add(10);

            applyDamageToUnit(ctx, 10, targetG, 15, "Kobold");

            expect(ctx.setUnits).not.toHaveBeenCalled();
        });

        it("tracks defeated units in defeatedThisFrame", () => {
            const target = makeUnit({ id: 10, hp: 5 });
            const targetG = makeUnitGroup();
            const ctx = makeCtx([target], { 10: targetG });

            applyDamageToUnit(ctx, 10, targetG, 10, "Kobold");

            expect(ctx.defeatedThisFrame!.has(10)).toBe(true);
        });

        it("sets hitFlash on damage", () => {
            const target = makeUnit({ id: 10, hp: 50 });
            const targetG = makeUnitGroup();
            const ctx = makeCtx([target], { 10: targetG });

            applyDamageToUnit(ctx, 10, targetG, 5, "Kobold");

            expect(ctx.hitFlashRef[10]).toBe(1000);
        });

        it("does not damage invulnerable units", () => {
            const target = makeUnit({
                id: 10,
                hp: 50,
                statusEffects: [makeStatusEffect("invul")],
            });
            const targetG = makeUnitGroup();
            const ctx = makeCtx([target], { 10: targetG });

            applyDamageToUnit(ctx, 10, targetG, 15, "Kobold");

            // setUnits should not be called to deal damage — only spawns a 0 damage number
            expect(ctx.setUnits).not.toHaveBeenCalled();
        });

        it("does not damage units with divine_lattice", () => {
            const target = makeUnit({
                id: 10,
                hp: 50,
                statusEffects: [makeStatusEffect("divine_lattice")],
            });
            const targetG = makeUnitGroup();
            const ctx = makeCtx([target], { 10: targetG });

            applyDamageToUnit(ctx, 10, targetG, 15, "Kobold");

            expect(ctx.setUnits).not.toHaveBeenCalled();
        });

        it("skips damage on already-dead units", () => {
            const target = makeUnit({ id: 10, hp: 0 });
            const targetG = makeUnitGroup();
            const ctx = makeCtx([target], { 10: targetG });

            applyDamageToUnit(ctx, 10, targetG, 15, "Kobold");

            expect(ctx.setUnits).not.toHaveBeenCalled();
        });

        it("clears status effects on death", () => {
            const target = makeUnit({
                id: 10,
                hp: 5,
                statusEffects: [makeStatusEffect("poison")],
            });
            const targetG = makeUnitGroup();
            const ctx = makeCtx([target], { 10: targetG });

            applyDamageToUnit(ctx, 10, targetG, 10, "Kobold");

            const updated = ctx.unitsStateRef.current[0];
            expect(updated.hp).toBe(0);
            expect(updated.statusEffects).toBeUndefined();
        });

        it("wakes sleeping targets on damage", () => {
            const target = makeUnit({
                id: 10,
                hp: 50,
                statusEffects: [
                    makeStatusEffect("sleep"),
                    makeStatusEffect("poison", { damagePerTick: 2 }),
                ],
            });
            const targetG = makeUnitGroup();
            const ctx = makeCtx([target], { 10: targetG });

            applyDamageToUnit(ctx, 10, targetG, 5, "Kobold");

            const updated = ctx.unitsStateRef.current[0];
            expect(updated.statusEffects?.find(e => e.type === "sleep")).toBeUndefined();
            // Poison should still be there
            expect(updated.statusEffects?.find(e => e.type === "poison")).toBeDefined();
        });

        describe("energy shield", () => {
            it("absorbs all damage when shield is large enough", () => {
                const target = makeUnit({
                    id: 10,
                    hp: 50,
                    statusEffects: [makeStatusEffect("energy_shield", { shieldAmount: 100 })],
                });
                const targetG = makeUnitGroup();
                const ctx = makeCtx([target], { 10: targetG });

                applyDamageToUnit(ctx, 10, targetG, 20, "Kobold");

                const updated = ctx.unitsStateRef.current[0];
                expect(updated.hp).toBe(50); // No HP damage
                const shield = updated.statusEffects?.find(e => e.type === "energy_shield");
                expect(shield?.shieldAmount).toBe(80); // Shield reduced by 20
            });

            it("shatters when damage exceeds shield", () => {
                const target = makeUnit({
                    id: 10,
                    hp: 50,
                    statusEffects: [makeStatusEffect("energy_shield", { shieldAmount: 10 })],
                });
                const targetG = makeUnitGroup();
                const ctx = makeCtx([target], { 10: targetG });

                applyDamageToUnit(ctx, 10, targetG, 20, "Kobold");

                const updated = ctx.unitsStateRef.current[0];
                expect(updated.hp).toBe(40); // 20 - 10 shield = 10 overflow damage
                const shield = updated.statusEffects?.find(e => e.type === "energy_shield");
                expect(shield).toBeUndefined(); // Shield removed
            });

            it("chaos damage does 2x to energy shield", () => {
                const target = makeUnit({
                    id: 10,
                    hp: 50,
                    statusEffects: [makeStatusEffect("energy_shield", { shieldAmount: 30 })],
                });
                const targetG = makeUnitGroup();
                const ctx = makeCtx([target], { 10: targetG });

                applyDamageToUnit(ctx, 10, targetG, 10, "Kobold", { damageType: "chaos" });

                const updated = ctx.unitsStateRef.current[0];
                // 10 damage * 2 = 20 to shield, shield was 30, shield remaining = 10
                expect(updated.hp).toBe(50); // No HP damage
                const shield = updated.statusEffects?.find(e => e.type === "energy_shield");
                expect(shield?.shieldAmount).toBe(10);
            });

            it("converts chaos overflow back to regular damage", () => {
                const target = makeUnit({
                    id: 10,
                    hp: 50,
                    statusEffects: [makeStatusEffect("energy_shield", { shieldAmount: 10 })],
                });
                const targetG = makeUnitGroup();
                const ctx = makeCtx([target], { 10: targetG });

                // 15 damage, chaos: 30 to shield, shield=10, overflow=20, effective = ceil(20/2)=10
                applyDamageToUnit(ctx, 10, targetG, 15, "Kobold", { damageType: "chaos" });

                const updated = ctx.unitsStateRef.current[0];
                expect(updated.hp).toBe(40); // 50 - 10 overflow
            });
        });

        describe("poison application", () => {
            it("applies poison on damage when option is set", () => {
                const target = makeUnit({ id: 10, hp: 50 });
                const targetG = makeUnitGroup();
                const ctx = makeCtx([target], { 10: targetG });

                applyDamageToUnit(ctx, 10, targetG, 5, "Kobold", {
                    poison: { sourceId: 1, damagePerTick: 3 },
                });

                const updated = ctx.unitsStateRef.current[0];
                const poison = updated.statusEffects?.find(e => e.type === "poison");
                expect(poison).toBeDefined();
            });

            it("does not apply poison to shielded units", () => {
                const target = makeUnit({
                    id: 10,
                    hp: 50,
                    statusEffects: [makeStatusEffect("shielded")],
                });
                const targetG = makeUnitGroup();
                const ctx = makeCtx([target], { 10: targetG });

                applyDamageToUnit(ctx, 10, targetG, 5, "Kobold", {
                    poison: { sourceId: 1 },
                });

                const updated = ctx.unitsStateRef.current[0];
                const poison = updated.statusEffects?.find(e => e.type === "poison");
                expect(poison).toBeUndefined();
            });
        });

        describe("slow application", () => {
            it("applies slow debuff on damage when option is set", () => {
                const target = makeUnit({ id: 10, hp: 50 });
                const targetG = makeUnitGroup();
                const ctx = makeCtx([target], { 10: targetG });

                applyDamageToUnit(ctx, 10, targetG, 5, "Kobold", {
                    slow: { sourceId: 1 },
                });

                const updated = ctx.unitsStateRef.current[0];
                const slowed = updated.statusEffects?.find(e => e.type === "slowed");
                expect(slowed).toBeDefined();
            });
        });

        describe("XP rewards", () => {
            it("awards XP to alive player units on enemy kill", () => {
                const player = makeUnit({ id: 1, hp: 30, team: "player", exp: 0, level: 1 });
                const enemy = makeUnit({ id: 10, hp: 5, team: "enemy", enemyType: "kobold" });
                const enemyG = makeUnitGroup();
                const ctx = makeCtx([player, enemy], { 10: enemyG });

                applyDamageToUnit(ctx, 10, enemyG, 10, "Kobold", { targetUnit: enemy });

                const updatedPlayer = ctx.unitsStateRef.current.find(u => u.id === 1);
                expect(updatedPlayer?.exp).toBeGreaterThan(0);
            });
        });
    });

    describe("handleUnitDefeat", () => {
        it("hides the unit group", () => {
            const targetG = makeUnitGroup();
            const unitsRef: Record<number, UnitGroup> = { 10: targetG };
            const addLog = vi.fn();

            handleUnitDefeat(10, targetG, unitsRef, addLog, "Kobold");

            expect(targetG.visible).toBe(false);
        });

        it("clears attack targets pointing to defeated unit", () => {
            const targetG = makeUnitGroup();
            const allyG = makeUnitGroup();
            allyG.userData.attackTarget = 10;
            const unitsRef: Record<number, UnitGroup> = { 10: targetG, 1: allyG };
            const addLog = vi.fn();

            handleUnitDefeat(10, targetG, unitsRef, addLog, "Kobold");

            expect(allyG.userData.attackTarget).toBeNull();
        });

        it("logs defeat message unless silent", () => {
            const targetG = makeUnitGroup();
            const addLog = vi.fn();

            handleUnitDefeat(10, targetG, { 10: targetG }, addLog, "Kobold");
            expect(addLog).toHaveBeenCalled();

            addLog.mockClear();
            handleUnitDefeat(10, targetG, { 10: targetG }, addLog, "Kobold", true);
            expect(addLog).not.toHaveBeenCalled();
        });
    });

    describe("applyLifesteal", () => {
        it("heals the attacker up to maxHp", () => {
            const attacker = makeUnit({ id: 1, hp: 20, team: "player" });
            const units = [attacker];
            const setUnits = vi.fn((fn: unknown) => {
                if (typeof fn === "function") {
                    const result = fn(units);
                    units.length = 0;
                    units.push(...result);
                }
            });

            applyLifesteal(
                { add() {}, remove() {} } as any, // scene
                [],         // damageTexts
                setUnits as any,
                1, 5, 5,   // attacker id and position
                10,         // healAmount
                25          // maxHp
            );

            expect(setUnits).toHaveBeenCalled();
            expect(units[0].hp).toBe(25); // 20 + 10 clamped to 25
        });

        it("does nothing for zero heal amount", () => {
            const setUnits = vi.fn();

            applyLifesteal({} as any, [], setUnits as any, 1, 5, 5, 0, 25);

            expect(setUnits).not.toHaveBeenCalled();
        });
    });

    describe("getAliveUnitsInRange", () => {
        it("returns units of specified team within range", () => {
            const enemy1 = makeUnit({ id: 10, hp: 20, team: "enemy" });
            const enemy2 = makeUnit({ id: 11, hp: 20, team: "enemy" });
            const player = makeUnit({ id: 1, hp: 20, team: "player" });
            const units = [enemy1, enemy2, player];

            const g10 = makeUnitGroup({ position: { x: 5, y: 0, z: 5 } } as any);
            const g11 = makeUnitGroup({ position: { x: 100, y: 0, z: 100 } } as any);
            const g1 = makeUnitGroup({ position: { x: 5, y: 0, z: 6 } } as any);
            const unitsRef: Record<number, UnitGroup> = { 10: g10, 11: g11, 1: g1 };

            const results = getAliveUnitsInRange(units, unitsRef, "enemy", 5, 5, 3);

            expect(results).toHaveLength(1);
            expect(results[0].unit.id).toBe(10);
        });

        it("excludes dead units", () => {
            const dead = makeUnit({ id: 10, hp: 0, team: "enemy" });
            const g10 = makeUnitGroup();
            const unitsRef: Record<number, UnitGroup> = { 10: g10 };

            const results = getAliveUnitsInRange([dead], unitsRef, "enemy", 5, 5, 10);
            expect(results).toHaveLength(0);
        });

        it("excludes units defeated this frame", () => {
            const alive = makeUnit({ id: 10, hp: 20, team: "enemy" });
            const g10 = makeUnitGroup();
            const unitsRef: Record<number, UnitGroup> = { 10: g10 };
            const defeated = new Set([10]);

            const results = getAliveUnitsInRange([alive], unitsRef, "enemy", 5, 5, 10, defeated);
            expect(results).toHaveLength(0);
        });
    });
});
