import { describe, expect, it, vi } from "vitest";
import type { Unit } from "../src/core/types";
import { DEFAULT_UNIT_RADIUS } from "../src/core/constants";

// Mock dependencies for range module
vi.mock("../src/game/playerUnits", () => ({
    UNIT_DATA: {
        1: { name: "Barbarian", size: 1 },
        2: { name: "Paladin" }, // no size → defaults to 1
    },
}));

vi.mock("../src/game/enemyStats", () => ({
    ENEMY_STATS: {
        ogre: { name: "Ogre", size: 2.5 },
        kobold: { name: "Kobold", size: 0.8 },
        bat: { name: "Bat" }, // no size → defaults to 1
    },
}));

import { getUnitRadius, isInRange } from "../src/rendering/range";

describe("range", () => {
    describe("getUnitRadius", () => {
        it("returns default radius for standard player unit", () => {
            const unit: Unit = { id: 1, x: 0, z: 0, hp: 10, team: "player", target: null, aiEnabled: true };
            expect(getUnitRadius(unit)).toBe(DEFAULT_UNIT_RADIUS);
        });

        it("returns default radius for player unit without size", () => {
            const unit: Unit = { id: 2, x: 0, z: 0, hp: 10, team: "player", target: null, aiEnabled: true };
            expect(getUnitRadius(unit)).toBe(DEFAULT_UNIT_RADIUS);
        });

        it("scales radius by enemy size", () => {
            const ogre: Unit = { id: 100, x: 0, z: 0, hp: 50, team: "enemy", enemyType: "ogre", target: null, aiEnabled: true };
            expect(getUnitRadius(ogre)).toBe(DEFAULT_UNIT_RADIUS * 2.5);
        });

        it("scales radius for small enemies", () => {
            const kobold: Unit = { id: 101, x: 0, z: 0, hp: 5, team: "enemy", enemyType: "kobold", target: null, aiEnabled: true };
            expect(getUnitRadius(kobold)).toBe(DEFAULT_UNIT_RADIUS * 0.8);
        });

        it("defaults to base radius for enemy without size", () => {
            const bat: Unit = { id: 102, x: 0, z: 0, hp: 3, team: "enemy", enemyType: "bat", target: null, aiEnabled: true };
            expect(getUnitRadius(bat)).toBe(DEFAULT_UNIT_RADIUS);
        });

        it("returns default radius for enemy without enemyType", () => {
            const unit: Unit = { id: 200, x: 0, z: 0, hp: 10, team: "enemy", target: null, aiEnabled: true };
            expect(getUnitRadius(unit)).toBe(DEFAULT_UNIT_RADIUS);
        });
    });

    describe("isInRange", () => {
        it("returns true when target center is within range", () => {
            expect(isInRange(0, 0, 2, 0, 0.7, 3)).toBe(true);
        });

        it("returns true when hitbox edge is within range", () => {
            // Center is 4 away, radius is 0.7, effective distance is 3.3
            expect(isInRange(0, 0, 4, 0, 0.7, 3.5)).toBe(true);
        });

        it("returns false when target is out of range", () => {
            // Center is 5 away, radius is 0.7, effective distance is 4.3
            expect(isInRange(0, 0, 5, 0, 0.7, 4)).toBe(false);
        });

        it("returns true for overlapping positions", () => {
            expect(isInRange(0, 0, 0, 0, 0.7, 1)).toBe(true);
        });

        it("accounts for large hitboxes", () => {
            // Center is 5 away, large radius of 3, effective distance = max(0, 5-3) = 2
            expect(isInRange(0, 0, 5, 0, 3, 2)).toBe(true);
            expect(isInRange(0, 0, 5, 0, 3, 1.9)).toBe(false);
        });

        it("never returns negative effective distance", () => {
            // Target radius larger than center distance
            expect(isInRange(0, 0, 1, 0, 5, 0)).toBe(true);
        });

        it("handles diagonal distances", () => {
            // Distance from (0,0) to (3,4) = 5, minus radius 0.7 = 4.3
            expect(isInRange(0, 0, 3, 4, 0.7, 4.5)).toBe(true);
            expect(isInRange(0, 0, 3, 4, 0.7, 4)).toBe(false);
        });
    });
});
