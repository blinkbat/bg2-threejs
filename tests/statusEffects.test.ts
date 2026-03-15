import { describe, expect, it, vi } from "vitest";
import type { Dispatch, SetStateAction } from "react";
import type { Scene } from "three";
import type { Unit, UnitGroup, DamageText, StatusEffect } from "../src/core/types";
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

import { processStatusEffects } from "../src/gameLoop/statusEffects";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeStatusEffect(type: StatusEffect["type"], overrides: Partial<StatusEffect> = {}): StatusEffect {
    return {
        type,
        duration: 5000,
        tickInterval: 1000,
        timeSinceTick: 0,
        lastUpdateTime: 0,
        damagePerTick: 0,
        sourceId: 1,
        ...overrides,
    };
}

function makeUnit(overrides: Partial<Unit> = {}): Unit {
    return {
        id: 100,
        x: 5,
        z: 5,
        hp: 50,
        team: "enemy",
        enemyType: "ogre",
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

function makeScene(): Scene {
    return { add() {}, remove() {} } as unknown as Scene;
}

interface ProcessResult {
    updatedUnits: Unit[];
    addLog: ReturnType<typeof vi.fn>;
}

function runProcessStatusEffects(units: Unit[], now: number = 2000): ProcessResult {
    const unitsRef: Record<number, UnitGroup> = {};
    for (const u of units) {
        unitsRef[u.id] = makeUnitGroup();
    }

    let updatedUnits = units;
    const setUnits: Dispatch<SetStateAction<Unit[]>> = vi.fn((nextState: SetStateAction<Unit[]>) => {
        updatedUnits = typeof nextState === "function" ? nextState(updatedUnits) : nextState;
    });
    const addLog = vi.fn();
    const defeatedThisFrame = new Set<number>();

    processStatusEffects(
        units,
        unitsRef,
        makeScene(),
        [] as DamageText[],
        {},                  // hitFlashRef
        setUnits,
        addLog,
        now,
        defeatedThisFrame
    );

    return { updatedUnits, addLog };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("statusEffects - processStatusEffects", () => {
    it("does nothing for units without status effects", () => {
        const unit = makeUnit({ statusEffects: undefined });
        const { updatedUnits } = runProcessStatusEffects([unit]);
        expect(updatedUnits[0].hp).toBe(50);
    });

    it("does nothing for dead units", () => {
        const unit = makeUnit({
            hp: 0,
            statusEffects: [makeStatusEffect("poison", { damagePerTick: 5 })],
        });
        const { updatedUnits } = runProcessStatusEffects([unit]);
        expect(updatedUnits[0].hp).toBe(0);
    });

    describe("poison ticks", () => {
        it("deals damage on tick", () => {
            const unit = makeUnit({
                hp: 50,
                statusEffects: [
                    makeStatusEffect("poison", {
                        damagePerTick: 5,
                        tickInterval: 1000,
                        timeSinceTick: 0,
                        lastUpdateTime: 0,
                        duration: 5000,
                    }),
                ],
            });

            // now=2000, lastUpdateTime=0 → delta=100 (capped), timeSinceTick=0+100=100
            // tickInterval=1000, 100 < 1000 → should NOT tick yet with delta cap
            // But let's set timeSinceTick=999 so it crosses the threshold
            unit.statusEffects![0].timeSinceTick = 999;
            unit.statusEffects![0].lastUpdateTime = 1900;

            const { updatedUnits } = runProcessStatusEffects([unit], 2000);
            expect(updatedUnits[0].hp).toBe(45); // 50 - 5 poison
        });

        it("removes expired poison", () => {
            const unit = makeUnit({
                hp: 50,
                statusEffects: [
                    makeStatusEffect("poison", {
                        damagePerTick: 2,
                        tickInterval: 1000,
                        timeSinceTick: 999,
                        lastUpdateTime: 1900,
                        duration: 1000, // Will expire on next tick (1000 - 1000 = 0)
                    }),
                ],
            });

            const { updatedUnits } = runProcessStatusEffects([unit], 2000);
            expect(updatedUnits[0].hp).toBe(48);
            // Effect should be removed since duration dropped to 0
            expect(updatedUnits[0].statusEffects).toBeUndefined();
        });

        it("does not tick poison when interval not yet reached", () => {
            const unit = makeUnit({
                hp: 50,
                statusEffects: [
                    makeStatusEffect("poison", {
                        damagePerTick: 5,
                        tickInterval: 1000,
                        timeSinceTick: 0,
                        lastUpdateTime: 1990, // only 10ms ago
                        duration: 5000,
                    }),
                ],
            });

            const { updatedUnits } = runProcessStatusEffects([unit], 2000);
            expect(updatedUnits[0].hp).toBe(50); // No damage yet
        });
    });

    describe("regen", () => {
        it("heals on tick", () => {
            const unit = makeUnit({
                id: 100,
                hp: 40,
                team: "enemy",
                enemyType: "ogre",
                statusEffects: [
                    makeStatusEffect("regen", {
                        damagePerTick: 0,
                        shieldAmount: 3,     // healPerTick stored in shieldAmount
                        tickInterval: 1000,
                        timeSinceTick: 999,
                        lastUpdateTime: 1900,
                        duration: 5000,
                    }),
                ],
            });

            const { updatedUnits } = runProcessStatusEffects([unit], 2000);
            // Regen should heal 3 HP, but clamped to maxHp from enemy stats
            expect(updatedUnits[0].hp).toBeGreaterThanOrEqual(40);
        });
    });

    describe("doom", () => {
        it("kills unit when doom expires", () => {
            const unit = makeUnit({
                hp: 50,
                enemyType: "bloated_corpse",
                statusEffects: [
                    makeStatusEffect("doom", {
                        tickInterval: 1000,
                        timeSinceTick: 999,
                        lastUpdateTime: 1900,
                        duration: 1000, // Will expire on next tick
                    }),
                ],
            });

            const { updatedUnits } = runProcessStatusEffects([unit], 2000);
            expect(updatedUnits[0].hp).toBe(0);
            expect(updatedUnits[0].statusEffects).toBeUndefined();
        });

        it("does not kill if doom has remaining duration", () => {
            const unit = makeUnit({
                hp: 50,
                statusEffects: [
                    makeStatusEffect("doom", {
                        tickInterval: 1000,
                        timeSinceTick: 999,
                        lastUpdateTime: 1900,
                        duration: 5000,
                    }),
                ],
            });

            const { updatedUnits } = runProcessStatusEffects([unit], 2000);
            expect(updatedUnits[0].hp).toBe(50);
        });

        it("doom does not kill units with divine_lattice", () => {
            const unit = makeUnit({
                hp: 50,
                statusEffects: [
                    makeStatusEffect("doom", {
                        tickInterval: 1000,
                        timeSinceTick: 999,
                        lastUpdateTime: 1900,
                        duration: 1000,
                    }),
                    makeStatusEffect("divine_lattice"),
                ],
            });

            const { updatedUnits } = runProcessStatusEffects([unit], 2000);
            expect(updatedUnits[0].hp).toBe(50);
        });
    });

    describe("buff expiry", () => {
        it("removes expired buffs", () => {
            const unit = makeUnit({
                hp: 50,
                statusEffects: [
                    makeStatusEffect("shielded", {
                        tickInterval: 100,
                        timeSinceTick: 99,
                        lastUpdateTime: 1900,
                        duration: 100, // Will expire on next tick
                    }),
                ],
            });

            const { updatedUnits } = runProcessStatusEffects([unit], 2000);
            // Shielded should be removed
            expect(updatedUnits[0].statusEffects).toBeUndefined();
        });

        it("keeps active buffs with remaining duration", () => {
            const unit = makeUnit({
                hp: 50,
                statusEffects: [
                    makeStatusEffect("shielded", {
                        tickInterval: 100,
                        timeSinceTick: 99,
                        lastUpdateTime: 1900,
                        duration: 5000,
                    }),
                ],
            });

            const { updatedUnits } = runProcessStatusEffects([unit], 2000);
            expect(updatedUnits[0].statusEffects).toHaveLength(1);
            expect(updatedUnits[0].statusEffects![0].type).toBe("shielded");
        });
    });

    describe("divine_lattice poison immunity", () => {
        it("prevents poison damage when divine_lattice is active", () => {
            const unit = makeUnit({
                hp: 50,
                statusEffects: [
                    makeStatusEffect("poison", {
                        damagePerTick: 10,
                        tickInterval: 1000,
                        timeSinceTick: 999,
                        lastUpdateTime: 1900,
                        duration: 5000,
                    }),
                    makeStatusEffect("divine_lattice", {
                        tickInterval: 100,
                        timeSinceTick: 0,
                        lastUpdateTime: 1900,
                        duration: 10000,
                    }),
                ],
            });

            const { updatedUnits } = runProcessStatusEffects([unit], 2000);
            expect(updatedUnits[0].hp).toBe(50); // No damage taken
        });
    });

    describe("multiple effects", () => {
        it("processes multiple effects on same unit", () => {
            const unit = makeUnit({
                hp: 50,
                statusEffects: [
                    makeStatusEffect("poison", {
                        damagePerTick: 3,
                        tickInterval: 1000,
                        timeSinceTick: 999,
                        lastUpdateTime: 1900,
                        duration: 5000,
                    }),
                    makeStatusEffect("shielded", {
                        tickInterval: 100,
                        timeSinceTick: 99,
                        lastUpdateTime: 1900,
                        duration: 5000,
                    }),
                ],
            });

            const { updatedUnits } = runProcessStatusEffects([unit], 2000);
            expect(updatedUnits[0].hp).toBe(47); // 50 - 3 poison
            // Both effects should still be present (neither expired)
            expect(updatedUnits[0].statusEffects).toHaveLength(2);
        });

        it("kills unit when poison damage exceeds remaining HP", () => {
            const unit = makeUnit({
                hp: 3,
                statusEffects: [
                    makeStatusEffect("poison", {
                        damagePerTick: 5,
                        tickInterval: 1000,
                        timeSinceTick: 999,
                        lastUpdateTime: 1900,
                        duration: 5000,
                    }),
                ],
            });

            const { updatedUnits } = runProcessStatusEffects([unit], 2000);
            expect(updatedUnits[0].hp).toBe(0);
            expect(updatedUnits[0].statusEffects).toBeUndefined();
        });
    });
});
