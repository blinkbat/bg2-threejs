import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/ai/pathfinding", () => ({
    isPassable: vi.fn(() => true),
}));

import { isPassable } from "../src/ai/pathfinding";
import { findSpawnPositions, getFormationPositionsForSpawn } from "../src/game/formation";

const mockedIsPassable = vi.mocked(isPassable);

describe("findSpawnPositions", () => {
    beforeEach(() => {
        mockedIsPassable.mockReset();
        mockedIsPassable.mockReturnValue(true);
    });

    it("uses directional formation when a direction is provided", () => {
        const spawnX = 12;
        const spawnZ = 7;
        const count = 4;
        const direction = "east";

        const expected = getFormationPositionsForSpawn(spawnX, spawnZ, direction, count);
        const actual = findSpawnPositions(spawnX, spawnZ, count, direction);

        expect(actual).toEqual(expected);
    });

    it("uses 3-wide fallback grid layout when no direction is provided", () => {
        const actual = findSpawnPositions(10, 10, 5);
        expect(actual).toEqual([
            { x: 8.5, z: 10 },
            { x: 10, z: 10 },
            { x: 11.5, z: 10 },
            { x: 8.5, z: 11.5 },
            { x: 10, z: 11.5 },
        ]);
    });

    it("searches nearby passable cells when the ideal fallback slot is blocked", () => {
        mockedIsPassable.mockImplementation((x: number, z: number) => !(x === 8 && z === 10));

        const actual = findSpawnPositions(10, 10, 1);

        expect(actual).toEqual([{ x: 7.5, z: 9.5 }]);
    });
});
