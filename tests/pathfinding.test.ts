import { beforeEach, describe, expect, it, vi } from "vitest";

// Create a configurable blocked grid and area mock
const blockedGrid: boolean[][] = [];
const treeBlockedSet = new Set<string>();
const terrainBlockedSet = new Set<string>();
const waterSet = new Set<string>();

function resetGrid(width: number, height: number) {
    blockedGrid.length = 0;
    for (let x = 0; x < width; x++) {
        blockedGrid[x] = [];
        for (let z = 0; z < height; z++) {
            blockedGrid[x][z] = false;
        }
    }
    treeBlockedSet.clear();
    terrainBlockedSet.clear();
    waterSet.clear();
}

function setBlocked(x: number, z: number) {
    if (blockedGrid[x]) blockedGrid[x][z] = true;
}

vi.mock("../src/game/areas", () => ({
    getCurrentArea: () => ({ gridWidth: 20, gridHeight: 20 }),
    getComputedAreaData: () => ({ blocked: blockedGrid }),
    isTreeBlocked: (x: number, z: number) => treeBlockedSet.has(`${x},${z}`),
    isTerrainBlocked: (x: number, z: number) => terrainBlockedSet.has(`${x},${z}`),
    isWaterTerrain: (x: number, z: number) => waterSet.has(`${x},${z}`),
}));

vi.mock("../src/game/dungeon", () => ({
    blocked: new Proxy([] as boolean[][], {
        get(_target, prop) {
            if (typeof prop === "string" && !isNaN(Number(prop))) {
                return blockedGrid[Number(prop)];
            }
            if (prop === "length") return blockedGrid.length;
            return undefined;
        },
    }),
}));

import {
    findPath,
    isBlocked,
    isPassable,
    findNearestPassable,
    clearPathCache,
} from "../src/ai/pathfinding";

describe("pathfinding", () => {
    beforeEach(() => {
        resetGrid(20, 20);
        clearPathCache();
    });

    describe("isBlocked", () => {
        it("returns false for open cell", () => {
            expect(isBlocked(5, 5)).toBe(false);
        });

        it("returns true for blocked cell", () => {
            setBlocked(5, 5);
            expect(isBlocked(5, 5)).toBe(true);
        });

        it("returns false for out-of-bounds cell", () => {
            expect(isBlocked(100, 100)).toBe(false);
        });
    });

    describe("isPassable", () => {
        it("returns true for open in-grid cell", () => {
            expect(isPassable(5, 5)).toBe(true);
        });

        it("returns false for blocked cell", () => {
            setBlocked(5, 5);
            expect(isPassable(5, 5)).toBe(false);
        });

        it("returns false for out-of-grid cell", () => {
            expect(isPassable(-1, 5)).toBe(false);
            expect(isPassable(5, 20)).toBe(false);
        });

        it("returns false for terrain-blocked cell (non-flying)", () => {
            terrainBlockedSet.add("5,5");
            expect(isPassable(5, 5, false)).toBe(false);
        });

        it("returns true for terrain-blocked cell when flying", () => {
            terrainBlockedSet.add("5,5");
            expect(isPassable(5, 5, true)).toBe(true);
        });

        it("constrains water units to water cells", () => {
            waterSet.add("5,5");
            expect(isPassable(5, 5, false, true)).toBe(true);
            expect(isPassable(6, 6, false, true)).toBe(false); // not water
        });
    });

    describe("findNearestPassable", () => {
        it("returns target position if already passable", () => {
            const result = findNearestPassable(5.5, 5.5);
            expect(result).toEqual({ x: 5.5, z: 5.5 });
        });

        it("finds nearby passable cell when target is blocked", () => {
            setBlocked(5, 5);
            const result = findNearestPassable(5.5, 5.5);
            expect(result).not.toBeNull();
            // Should be an adjacent cell
            if (result) {
                const dist = Math.hypot(result.x - 5.5, result.z - 5.5);
                expect(dist).toBeLessThanOrEqual(3);
            }
        });

        it("returns null when surrounded by walls", () => {
            for (let dx = -5; dx <= 5; dx++) {
                for (let dz = -5; dz <= 5; dz++) {
                    const x = 10 + dx;
                    const z = 10 + dz;
                    if (x >= 0 && x < 20 && z >= 0 && z < 20) {
                        setBlocked(x, z);
                    }
                }
            }
            const result = findNearestPassable(10.5, 10.5, 5);
            expect(result).toBeNull();
        });
    });

    describe("findPath", () => {
        it("returns single-node path for same start and end cell", () => {
            const path = findPath(5.5, 5.5, 5.7, 5.3);
            expect(path).toEqual([{ x: 5.7, z: 5.3 }]);
        });

        it("finds straight path in open grid", () => {
            const path = findPath(1.5, 1.5, 5.5, 1.5);
            expect(path).not.toBeNull();
            expect(path!.length).toBeGreaterThan(1);
            // Last point should be the target
            expect(path![path!.length - 1]).toEqual({ x: 5.5, z: 1.5 });
        });

        it("navigates around a wall", () => {
            // Create a wall from (3,0) to (3,4)
            for (let z = 0; z <= 4; z++) {
                setBlocked(3, z);
            }
            clearPathCache();

            const path = findPath(1.5, 2.5, 5.5, 2.5);
            expect(path).not.toBeNull();
            // Path should go around the wall
            expect(path!.length).toBeGreaterThan(4);
        });

        it("returns null for unreachable target", () => {
            // Completely wall off the target area
            for (let x = 0; x < 20; x++) {
                setBlocked(x, 10);
            }
            clearPathCache();

            const path = findPath(5.5, 5.5, 5.5, 15.5);
            expect(path).toBeNull();
        });

        it("returns null for out-of-grid target", () => {
            const path = findPath(5.5, 5.5, 100.5, 100.5);
            expect(path).toBeNull();
        });

        it("finds nearest passable cell when target is blocked", () => {
            setBlocked(8, 8);
            clearPathCache();

            const path = findPath(1.5, 1.5, 8.5, 8.5);
            // Should find path to cell adjacent to the blocked target
            expect(path).not.toBeNull();
        });

        it("uses cached path for repeated queries", () => {
            const path1 = findPath(1.5, 1.5, 5.5, 5.5);
            const path2 = findPath(1.5, 1.5, 5.5, 5.5);
            expect(path1).toEqual(path2);
        });

        it("prevents corner-cutting through diagonal walls", () => {
            // Create an L-shaped wall that would allow corner-cutting
            setBlocked(5, 5);
            setBlocked(5, 6);
            clearPathCache();

            const path = findPath(4.5, 5.5, 6.5, 6.5);
            expect(path).not.toBeNull();
            // Path should not cut through the diagonal between (5,5) and (5,6)
            for (const node of path!) {
                const cellX = Math.floor(node.x);
                const cellZ = Math.floor(node.z);
                expect(isBlocked(cellX, cellZ)).toBe(false);
            }
        });
    });
});
