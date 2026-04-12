import { describe, expect, it, beforeEach } from "vitest";
import { getNextUnitId, initializeUnitIdCounter } from "../src/core/unitIds";
import type { Unit } from "../src/core/types";

function makeUnit(id: number): Unit {
    return { id, x: 0, z: 0, hp: 10, team: "player", target: null, aiEnabled: true };
}

describe("unitIds", () => {
    beforeEach(() => {
        // Reset counter to known state
        initializeUnitIdCounter([]);
    });

    describe("getNextUnitId", () => {
        it("returns IDs starting at 1000 when no units exist", () => {
            const id = getNextUnitId();
            expect(id).toBe(1000);
        });

        it("increments on each call", () => {
            const a = getNextUnitId();
            const b = getNextUnitId();
            const c = getNextUnitId();
            expect(b).toBe(a + 1);
            expect(c).toBe(a + 2);
        });

        it("never collides with player IDs", () => {
            for (let i = 0; i < 10; i++) {
                expect(getNextUnitId()).toBeGreaterThanOrEqual(1000);
            }
        });
    });

    describe("initializeUnitIdCounter", () => {
        it("starts above the highest existing unit ID", () => {
            initializeUnitIdCounter([makeUnit(5), makeUnit(1500), makeUnit(3)]);
            expect(getNextUnitId()).toBe(1501);
        });

        it("respects minimum of 1000 even when units have low IDs", () => {
            initializeUnitIdCounter([makeUnit(1), makeUnit(2), makeUnit(3)]);
            expect(getNextUnitId()).toBe(1000);
        });

        it("handles empty array", () => {
            initializeUnitIdCounter([]);
            expect(getNextUnitId()).toBe(1000);
        });
    });
});
