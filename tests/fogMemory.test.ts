import { describe, expect, it, beforeEach } from "vitest";
import {
    loadFogVisibility,
    saveFogVisibility,
    captureFogVisibilityMemory,
    restoreFogVisibilityMemory,
    clearFogVisibilityMemory,
} from "../src/game/fogMemory";
import type { AreaId } from "../src/game/areas";

const AREA_A = "area_a" as AreaId;
const AREA_B = "area_b" as AreaId;

describe("fogMemory", () => {
    beforeEach(() => {
        clearFogVisibilityMemory();
    });

    describe("loadFogVisibility", () => {
        it("returns empty grid when no data stored", () => {
            const grid = loadFogVisibility(AREA_A, 3, 4);
            expect(grid.length).toBe(3);
            expect(grid[0].length).toBe(4);
            expect(grid.every(col => col.every(v => v === 0))).toBe(true);
        });

        it("returns stored data after save", () => {
            const vis = [[1, 0], [0, 1]];
            saveFogVisibility(AREA_A, vis);
            const loaded = loadFogVisibility(AREA_A, 2, 2);
            expect(loaded).toEqual([[1, 0], [0, 1]]);
        });

        it("returns empty grid when dimensions mismatch (width)", () => {
            saveFogVisibility(AREA_A, [[1, 0], [0, 1]]);
            const loaded = loadFogVisibility(AREA_A, 3, 2);
            expect(loaded.length).toBe(3);
            expect(loaded.every(col => col.every(v => v === 0))).toBe(true);
        });

        it("returns empty grid when dimensions mismatch (height)", () => {
            saveFogVisibility(AREA_A, [[1, 0], [0, 1]]);
            const loaded = loadFogVisibility(AREA_A, 2, 3);
            expect(loaded.length).toBe(2);
            expect(loaded[0].length).toBe(3);
        });
    });

    describe("saveFogVisibility", () => {
        it("clones data so mutations don't affect stored copy", () => {
            const vis = [[1, 0], [0, 1]];
            saveFogVisibility(AREA_A, vis);
            vis[0][0] = 99;
            const loaded = loadFogVisibility(AREA_A, 2, 2);
            expect(loaded[0][0]).toBe(1);
        });
    });

    describe("loadFogVisibility clone", () => {
        it("returns a clone so mutations don't affect stored copy", () => {
            saveFogVisibility(AREA_A, [[1, 0], [0, 1]]);
            const loaded = loadFogVisibility(AREA_A, 2, 2);
            loaded[0][0] = 99;
            const loaded2 = loadFogVisibility(AREA_A, 2, 2);
            expect(loaded2[0][0]).toBe(1);
        });
    });

    describe("captureFogVisibilityMemory", () => {
        it("captures all stored areas", () => {
            saveFogVisibility(AREA_A, [[1]]);
            saveFogVisibility(AREA_B, [[2]]);
            const snapshot = captureFogVisibilityMemory();
            expect(snapshot[String(AREA_A)]).toEqual([[1]]);
            expect(snapshot[String(AREA_B)]).toEqual([[2]]);
        });

        it("includes optional current area override", () => {
            saveFogVisibility(AREA_A, [[1]]);
            const snapshot = captureFogVisibilityMemory(AREA_B, [[5]]);
            expect(snapshot[String(AREA_A)]).toEqual([[1]]);
            expect(snapshot[String(AREA_B)]).toEqual([[5]]);
        });

        it("clones data in snapshot", () => {
            const vis = [[1]];
            saveFogVisibility(AREA_A, vis);
            const snapshot = captureFogVisibilityMemory();
            vis[0][0] = 99;
            expect(snapshot[String(AREA_A)]).toEqual([[1]]);
        });
    });

    describe("restoreFogVisibilityMemory", () => {
        it("restores snapshot data", () => {
            const snapshot = { [String(AREA_A)]: [[7]], [String(AREA_B)]: [[8]] };
            restoreFogVisibilityMemory(snapshot);
            expect(loadFogVisibility(AREA_A, 1, 1)).toEqual([[7]]);
            expect(loadFogVisibility(AREA_B, 1, 1)).toEqual([[8]]);
        });

        it("clears existing data before restoring", () => {
            saveFogVisibility(AREA_A, [[1]]);
            restoreFogVisibilityMemory({ [String(AREA_B)]: [[2]] });
            const loaded = loadFogVisibility(AREA_A, 1, 1);
            expect(loaded[0][0]).toBe(0);
        });

        it("handles null snapshot (no-op clear)", () => {
            saveFogVisibility(AREA_A, [[1]]);
            restoreFogVisibilityMemory(null);
            const loaded = loadFogVisibility(AREA_A, 1, 1);
            expect(loaded[0][0]).toBe(0);
        });

        it("handles undefined snapshot (no-op clear)", () => {
            saveFogVisibility(AREA_A, [[1]]);
            restoreFogVisibilityMemory(undefined);
            const loaded = loadFogVisibility(AREA_A, 1, 1);
            expect(loaded[0][0]).toBe(0);
        });
    });

    describe("clearFogVisibilityMemory", () => {
        it("clears all stored fog data", () => {
            saveFogVisibility(AREA_A, [[1]]);
            saveFogVisibility(AREA_B, [[2]]);
            clearFogVisibilityMemory();
            expect(loadFogVisibility(AREA_A, 1, 1)[0][0]).toBe(0);
            expect(loadFogVisibility(AREA_B, 1, 1)[0][0]).toBe(0);
        });
    });
});
