import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/ai/pathfinding", () => ({
    findNearestPassable: vi.fn((x: number, z: number) => ({ x, z })),
}));

vi.mock("../src/game/formation", () => ({
    findSpawnPositions: vi.fn((x: number, z: number, count: number) =>
        Array.from({ length: count }, (_, index) => ({ x: x + index, z }))
    ),
}));

vi.mock("../src/game/areas", () => ({
    getCurrentArea: vi.fn(() => ({
        defaultSpawn: { x: 4, z: 6 },
        enemySpawns: [],
    })),
    getCurrentAreaId: vi.fn(() => "coast"),
}));

vi.mock("../src/game/enemyStats", () => ({
    ENEMY_STATS: {},
}));

vi.mock("../src/gameLoop", () => ({
    initializeUnitIdCounter: vi.fn(),
}));

vi.mock("../src/hooks/formationStorage", () => ({
    loadFormationOrder: vi.fn(() => [1, 2, 3, 4, 5, 6]),
}));

import { createUnitsForArea } from "../src/app/gameSetup";

describe("createUnitsForArea", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("clamps restored summon HP and mana to effective caps", () => {
        const units = createUnitsForArea({
            persistedPlayers: [{
                id: 8,
                hp: 99,
                mana: 99,
                summonType: "vishas_eye_orb",
                summonedBy: 6,
            }],
            spawnPoint: { x: 10, z: 10 },
            initialKilledEnemies: null,
            initialEnemyPositions: null,
            playtestUnlockAllSkills: false,
        });

        const summon = units.find(unit => unit.id === 8);
        expect(summon).toBeDefined();
        expect(summon?.hp).toBe(16);
        expect(summon?.mana).toBe(0);
    });
});
