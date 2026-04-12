import { describe, expect, it, beforeEach, vi } from "vitest";
import type { Unit, UnitGroup } from "../src/core/types";

vi.mock("../src/game/geometry", () => ({
    distanceToPoint: vi.fn((pos: { x: number; z: number }, tx: number, tz: number) => {
        return Math.hypot(pos.x - tx, pos.z - tz);
    }),
}));

vi.mock("../src/rendering/range", () => ({
    isInRange: vi.fn((_ax: number, _az: number, _tx: number, _tz: number, _r: number, range: number) => {
        return range > 0;
    }),
    getUnitRadius: vi.fn(() => 0.7),
}));

import { updateUnitCache, getUnitById, getAliveUnits, findNearestUnit } from "../src/game/unitQuery";

function makeUnit(id: number, overrides: Partial<Unit> = {}): Unit {
    return { id, x: 0, z: 0, hp: 10, team: "player", target: null, aiEnabled: true, ...overrides };
}

function makeGroup(x: number, z: number): UnitGroup {
    return { position: { x, y: 0, z } } as unknown as UnitGroup;
}

describe("unitQuery", () => {
    beforeEach(() => {
        updateUnitCache([]);
    });

    describe("updateUnitCache / getUnitById", () => {
        it("returns undefined before cache is populated", () => {
            expect(getUnitById(1)).toBeUndefined();
        });

        it("returns unit after cache is populated", () => {
            const u = makeUnit(1);
            updateUnitCache([u]);
            expect(getUnitById(1)).toBe(u);
        });

        it("returns undefined for missing ID", () => {
            updateUnitCache([makeUnit(1)]);
            expect(getUnitById(999)).toBeUndefined();
        });

        it("replaces previous cache on update", () => {
            const u1 = makeUnit(1, { hp: 10 });
            const u2 = makeUnit(1, { hp: 5 });
            updateUnitCache([u1]);
            expect(getUnitById(1)?.hp).toBe(10);
            updateUnitCache([u2]);
            expect(getUnitById(1)?.hp).toBe(5);
        });

        it("handles multiple units", () => {
            const units = [makeUnit(1), makeUnit(2), makeUnit(3)];
            updateUnitCache(units);
            expect(getUnitById(1)).toBe(units[0]);
            expect(getUnitById(2)).toBe(units[1]);
            expect(getUnitById(3)).toBe(units[2]);
        });
    });

    describe("getAliveUnits", () => {
        it("filters by team", () => {
            const units = [
                makeUnit(1, { team: "player" }),
                makeUnit(2, { team: "enemy" }),
                makeUnit(3, { team: "player" }),
            ];
            const players = getAliveUnits(units, "player");
            expect(players.length).toBe(2);
            expect(players.every(u => u.team === "player")).toBe(true);
        });

        it("excludes dead units", () => {
            const units = [
                makeUnit(1, { team: "player", hp: 10 }),
                makeUnit(2, { team: "player", hp: 0 }),
                makeUnit(3, { team: "player", hp: -1 }),
            ];
            expect(getAliveUnits(units, "player").length).toBe(1);
        });

        it("returns empty array when no matches", () => {
            const units = [makeUnit(1, { team: "enemy" })];
            expect(getAliveUnits(units, "player").length).toBe(0);
        });
    });

    describe("findNearestUnit", () => {
        it("returns null when no units match filter", () => {
            const units = [makeUnit(1, { team: "enemy" })];
            const unitsRef = { 1: makeGroup(5, 0) };
            const result = findNearestUnit(units, unitsRef, 0, 0, u => u.team === "player");
            expect(result).toBeNull();
        });

        it("returns nearest unit", () => {
            const units = [
                makeUnit(1, { team: "enemy" }),
                makeUnit(2, { team: "enemy" }),
            ];
            const unitsRef: Record<number, UnitGroup> = {
                1: makeGroup(10, 0),
                2: makeGroup(3, 0),
            };
            const result = findNearestUnit(units, unitsRef, 0, 0, u => u.team === "enemy");
            expect(result?.unit.id).toBe(2);
        });

        it("skips units without group ref", () => {
            const units = [makeUnit(1), makeUnit(2)];
            const unitsRef: Record<number, UnitGroup> = { 2: makeGroup(5, 0) };
            const result = findNearestUnit(units, unitsRef, 0, 0, () => true);
            expect(result?.unit.id).toBe(2);
        });

        it("respects maxDist", () => {
            const units = [makeUnit(1)];
            const unitsRef: Record<number, UnitGroup> = { 1: makeGroup(20, 0) };
            const result = findNearestUnit(units, unitsRef, 0, 0, () => true, 10);
            expect(result).toBeNull();
        });
    });
});
