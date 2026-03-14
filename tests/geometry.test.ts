import { describe, expect, it, vi } from "vitest";

// Mock getCurrentArea before importing geometry module
vi.mock("../src/game/areas", () => ({
    getCurrentArea: () => ({ gridWidth: 50, gridHeight: 50 }),
    getComputedAreaData: () => ({ blocked: [] }),
    isTreeBlocked: () => false,
    isTerrainBlocked: () => false,
    isWaterTerrain: () => false,
}));

import {
    distance,
    distanceBetween,
    distanceToPoint,
    isWithinGrid,
    clampToGrid,
    normalizeAngle,
    isPointInCone,
    isPointInRectangle,
} from "../src/game/geometry";

describe("geometry", () => {
    describe("distance", () => {
        it("returns 0 for same point", () => {
            expect(distance(5, 5, 5, 5)).toBe(0);
        });

        it("returns correct distance for axis-aligned points", () => {
            expect(distance(0, 0, 3, 0)).toBe(3);
            expect(distance(0, 0, 0, 4)).toBe(4);
        });

        it("returns correct hypotenuse for 3-4-5 triangle", () => {
            expect(distance(0, 0, 3, 4)).toBe(5);
        });

        it("works with negative coordinates", () => {
            expect(distance(-3, -4, 0, 0)).toBe(5);
        });
    });

    describe("distanceBetween", () => {
        it("calculates distance between position objects", () => {
            expect(distanceBetween({ x: 0, z: 0 }, { x: 3, z: 4 })).toBe(5);
        });
    });

    describe("distanceToPoint", () => {
        it("calculates distance from position object to point", () => {
            expect(distanceToPoint({ x: 0, z: 0 }, 3, 4)).toBe(5);
        });
    });

    describe("isWithinGrid", () => {
        it("returns true for valid coordinates", () => {
            expect(isWithinGrid(0, 0)).toBe(true);
            expect(isWithinGrid(25, 25)).toBe(true);
            expect(isWithinGrid(49, 49)).toBe(true);
        });

        it("returns false for out-of-bounds coordinates", () => {
            expect(isWithinGrid(-1, 0)).toBe(false);
            expect(isWithinGrid(0, -1)).toBe(false);
            expect(isWithinGrid(50, 0)).toBe(false);
            expect(isWithinGrid(0, 50)).toBe(false);
        });
    });

    describe("clampToGrid", () => {
        it("clamps below minimum to padding", () => {
            expect(clampToGrid(-5, 0.5, "x")).toBe(0.5);
        });

        it("clamps above maximum to gridWidth - padding", () => {
            expect(clampToGrid(100, 0.5, "x")).toBe(49.5);
        });

        it("returns value when within bounds", () => {
            expect(clampToGrid(25, 0.5, "x")).toBe(25);
        });

        it("uses z axis for gridHeight", () => {
            expect(clampToGrid(100, 0.5, "z")).toBe(49.5);
        });
    });

    describe("normalizeAngle", () => {
        it("returns angles already in [-PI, PI] unchanged", () => {
            expect(normalizeAngle(0)).toBe(0);
            expect(normalizeAngle(1)).toBe(1);
            expect(normalizeAngle(-1)).toBe(-1);
        });

        it("wraps angles > PI", () => {
            const result = normalizeAngle(Math.PI + 0.5);
            expect(result).toBeCloseTo(-Math.PI + 0.5, 10);
        });

        it("wraps angles < -PI", () => {
            const result = normalizeAngle(-Math.PI - 0.5);
            expect(result).toBeCloseTo(Math.PI - 0.5, 10);
        });

        it("wraps full rotations", () => {
            expect(normalizeAngle(Math.PI * 4)).toBeCloseTo(0, 10);
            expect(normalizeAngle(-Math.PI * 4)).toBeCloseTo(0, 10);
        });
    });

    describe("isPointInCone", () => {
        it("returns true for point directly ahead within range", () => {
            // Cone pointing right (angle=0), point at (5, 0)
            expect(isPointInCone(5, 0, 0, 0, 0, Math.PI / 4, 10)).toBe(true);
        });

        it("returns false for point behind the cone", () => {
            // Cone pointing right, point at (-5, 0)
            expect(isPointInCone(-5, 0, 0, 0, 0, Math.PI / 4, 10)).toBe(false);
        });

        it("returns false for point beyond max distance", () => {
            expect(isPointInCone(15, 0, 0, 0, 0, Math.PI / 4, 10)).toBe(false);
        });

        it("returns false for point within min distance", () => {
            expect(isPointInCone(0.05, 0, 0, 0, 0, Math.PI / 4, 10, 0.1)).toBe(false);
        });

        it("returns false for point outside cone angle", () => {
            // Cone pointing right with narrow angle, point at 45 degrees
            expect(isPointInCone(5, 5, 0, 0, 0, Math.PI / 8, 10)).toBe(false);
        });

        it("returns true for point on cone edge", () => {
            // Point at exactly the half-angle boundary
            const halfAngle = Math.PI / 4;
            const dist = 5;
            const px = dist * Math.cos(halfAngle);
            const pz = dist * Math.sin(halfAngle);
            expect(isPointInCone(px, pz, 0, 0, 0, halfAngle, 10)).toBe(true);
        });
    });

    describe("isPointInRectangle", () => {
        it("returns true for point inside rectangle", () => {
            // Rectangle pointing right, 10 long, 2 wide (halfWidth=1)
            expect(isPointInRectangle(5, 0, 0, 0, 0, 10, 1)).toBe(true);
        });

        it("returns false for point behind origin", () => {
            expect(isPointInRectangle(-1, 0, 0, 0, 0, 10, 1)).toBe(false);
        });

        it("returns false for point beyond length", () => {
            expect(isPointInRectangle(11, 0, 0, 0, 0, 10, 1)).toBe(false);
        });

        it("returns false for point outside width", () => {
            expect(isPointInRectangle(5, 2, 0, 0, 0, 10, 1)).toBe(false);
        });

        it("handles rotated rectangles", () => {
            // Rectangle pointing up (angle = PI/2)
            expect(isPointInRectangle(0, 5, 0, 0, Math.PI / 2, 10, 1)).toBe(true);
            // Point to the right should be outside
            expect(isPointInRectangle(5, 0, 0, 0, Math.PI / 2, 10, 1)).toBe(false);
        });

        it("returns true for point on boundary", () => {
            expect(isPointInRectangle(10, 1, 0, 0, 0, 10, 1)).toBe(true);
            expect(isPointInRectangle(0, 0, 0, 0, 0, 10, 1)).toBe(true);
        });
    });
});
