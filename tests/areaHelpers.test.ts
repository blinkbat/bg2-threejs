import { describe, expect, it } from "vitest";
import type { AreaData } from "../src/game/areas/types";
import { computeAreaData } from "../src/game/areas/helpers";

function toGrid(...rows: string[]): string[][] {
    return rows.map(row => row.split(""));
}

function createArea(overrides: Partial<AreaData> = {}): AreaData {
    return {
        id: "coast",
        name: "Test",
        flavor: "Test area",
        gridSize: 4,
        gridWidth: 4,
        gridHeight: 4,
        backgroundColor: "#000000",
        groundColor: "#111111",
        geometry: toGrid(
            "....",
            ".#..",
            "....",
            "...#"
        ),
        terrain: toGrid(
            "....",
            "....",
            "..~.",
            "...."
        ),
        floor: toGrid(
            "....",
            "....",
            "....",
            "...."
        ),
        enemySpawns: [],
        transitions: [
            {
                x: 1,
                z: 1,
                w: 1,
                h: 1,
                targetArea: "forest",
                targetSpawn: { x: 0, z: 0 },
                direction: "north",
            },
        ],
        chests: [
            {
                x: 2,
                z: 1,
                contents: [],
            },
        ],
        trees: [
            {
                x: 0.2,
                z: 0.2,
                size: 1,
                type: "pine",
            },
        ],
        decorations: [
            { x: 2, z: 0, type: "chair" },
            { x: 0, z: 3, type: "column" },
        ],
        secretDoors: [
            {
                x: 3,
                z: 0,
                blockingWall: { x: 3, z: 0, w: 1, h: 1 },
            },
        ],
        candles: [
            { x: 1, z: 2, dx: 0, dz: 1, kind: "candle", lightColor: "#ffffff" },
        ],
        ambientLight: 0.5,
        directionalLight: 0.5,
        hasFogOfWar: true,
        defaultSpawn: { x: 0, z: 0 },
        ...overrides,
    };
}

describe("area helpers", () => {
    it("applies geometry/terrain/transition/secret-door/tree/prop/chest invariants", () => {
        const area = createArea();
        const computed = computeAreaData(area);

        // Transition door footprint is non-walkable
        expect(computed.blocked[1][1]).toBe(true);
        // Transition cells should not be merged into rendered wall obstacles
        expect(computed.mergedObstacles.some(obstacle => obstacle.x === 1 && obstacle.z === 1)).toBe(false);
        // Terrain hazards are not wall-blocked but are tracked separately
        expect(computed.blocked[2][2]).toBe(false);
        expect(computed.terrainBlocked.has("2,2")).toBe(true);
        // Secret door blocks after merged-obstacle pass
        expect(computed.blocked[3][0]).toBe(true);
        expect(computed.mergedObstacles.some(obstacle => obstacle.x === 3 && obstacle.z === 0)).toBe(false);
        // Remaining static wall still appears in merged obstacles
        expect(computed.mergedObstacles.some(obstacle => obstacle.x === 3 && obstacle.z === 3)).toBe(true);

        // Trees block movement and LOS
        expect(computed.blocked[0][0]).toBe(true);
        expect(computed.treeBlocked.has("0,0")).toBe(true);
        // Non-blocking decoration remains walkable
        expect(computed.blocked[2][0]).toBe(false);
        // Column blocks movement and LOS
        expect(computed.blocked[0][3]).toBe(true);
        expect(computed.treeBlocked.has("0,3")).toBe(true);
        // Chests block movement
        expect(computed.blocked[2][1]).toBe(true);
    });

    it("preserves manual candle positions", () => {
        const area = createArea({
            candles: [
                { x: 1, z: 2, dx: 1, dz: 0, kind: "torch", lightColor: "#ffaa33" },
                { x: 3, z: 1, dx: -1, dz: 0, kind: "candle", lightColor: "#fff0cc" },
            ],
        });

        const computed = computeAreaData(area);

        expect(computed.candlePositions).toEqual(area.candles);
    });
});
