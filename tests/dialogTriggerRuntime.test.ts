import { describe, expect, it } from "vitest";
import type { Unit } from "../src/core/types";
import type { AreaData, AreaDialogTrigger } from "../src/game/areas/types";
import {
    getTriggerStartDialogId,
    isDialogTriggerSatisfied,
    type DialogTriggerRuntimeState,
} from "../src/dialog/triggerRuntime";

function createRuntimeState(): DialogTriggerRuntimeState {
    return {
        stickySatisfiedConditionKeys: new Set(),
        previousRegionInsideByConditionKey: new Map(),
        pendingNpcEngagementSpawnIndexes: new Set(),
    };
}

function createArea(overrides: Partial<AreaData> = {}): AreaData {
    return {
        id: "coast",
        name: "Test Area",
        flavor: "test",
        gridSize: 6,
        gridWidth: 6,
        gridHeight: 6,
        backgroundColor: "#000000",
        groundColor: "#111111",
        geometry: Array.from({ length: 6 }, () => Array(6).fill(".")),
        terrain: Array.from({ length: 6 }, () => Array(6).fill(".")),
        floor: Array.from({ length: 6 }, () => Array(6).fill(".")),
        enemySpawns: [],
        transitions: [],
        chests: [],
        trees: [],
        ambientLight: 0.5,
        directionalLight: 0.5,
        hasFogOfWar: true,
        defaultSpawn: { x: 1, z: 1 },
        ...overrides,
    };
}

function createTrigger(overrides: Partial<AreaDialogTrigger> = {}): AreaDialogTrigger {
    return {
        id: "trigger_1",
        conditions: [{ type: "on_area_load" }],
        ...overrides,
    };
}

function makeUnit(overrides: Partial<Unit>): Unit {
    return {
        id: 1,
        x: 0,
        z: 0,
        hp: 10,
        team: "player",
        target: null,
        aiEnabled: true,
        ...overrides,
    };
}

describe("dialog trigger runtime", () => {
    it("returns false for empty condition lists", () => {
        const trigger = createTrigger({ conditions: [] });
        const result = isDialogTriggerSatisfied({
            trigger,
            area: createArea(),
            units: [],
            killedEnemies: new Set(),
            now: 100,
            areaLoadedAt: 0,
            runtimeState: createRuntimeState(),
        });
        expect(result).toBe(false);
    });

    it("satisfies on_area_load condition", () => {
        const trigger = createTrigger({
            conditions: [{ type: "on_area_load" }],
        });

        const result = isDialogTriggerSatisfied({
            trigger,
            area: createArea(),
            units: [],
            killedEnemies: new Set(),
            now: 100,
            areaLoadedAt: 0,
            runtimeState: createRuntimeState(),
        });

        expect(result).toBe(true);
    });

    it("satisfies enemy_killed by killed-enemy key", () => {
        const trigger = createTrigger({
            conditions: [{ type: "enemy_killed", spawnIndex: 2 }],
        });

        const result = isDialogTriggerSatisfied({
            trigger,
            area: createArea({ id: "coast" }),
            units: [],
            killedEnemies: new Set(["coast-2"]),
            now: 100,
            areaLoadedAt: 0,
            runtimeState: createRuntimeState(),
        });

        expect(result).toBe(true);
    });

    it("satisfies enemy_killed when static spawn unit is dead", () => {
        const trigger = createTrigger({
            conditions: [{ type: "enemy_killed", spawnIndex: 0 }],
        });
        const units = [makeUnit({ id: 100, team: "enemy", hp: 0 })];

        const result = isDialogTriggerSatisfied({
            trigger,
            area: createArea(),
            units,
            killedEnemies: new Set(),
            now: 100,
            areaLoadedAt: 0,
            runtimeState: createRuntimeState(),
        });

        expect(result).toBe(true);
    });

    it("keeps region-enter condition sticky after first satisfaction", () => {
        const trigger = createTrigger({
            id: "region_trigger",
            conditions: [{ type: "party_enters_region", x: 0, z: 0, w: 2, h: 2 }],
        });
        const runtimeState = createRuntimeState();
        const area = createArea();

        const first = isDialogTriggerSatisfied({
            trigger,
            area,
            units: [makeUnit({ x: 0.2, z: 0.2, team: "player" })],
            killedEnemies: new Set(),
            now: 100,
            areaLoadedAt: 0,
            runtimeState,
        });

        const second = isDialogTriggerSatisfied({
            trigger,
            area,
            units: [makeUnit({ x: 5.5, z: 5.5, team: "player" })],
            killedEnemies: new Set(),
            now: 120,
            areaLoadedAt: 0,
            runtimeState,
        });

        expect(first).toBe(true);
        expect(second).toBe(true);
    });

    it("requires location to exist for party_enters_location", () => {
        const trigger = createTrigger({
            conditions: [{ type: "party_enters_location", locationId: "missing" }],
        });

        const result = isDialogTriggerSatisfied({
            trigger,
            area: createArea(),
            units: [makeUnit({ x: 0, z: 0 })],
            killedEnemies: new Set(),
            now: 100,
            areaLoadedAt: 0,
            runtimeState: createRuntimeState(),
        });

        expect(result).toBe(false);
    });

    it("requires pending marker for npc_engaged", () => {
        const trigger = createTrigger({
            conditions: [{ type: "npc_engaged", spawnIndex: 1 }],
        });
        const area = createArea();
        const units = [makeUnit({ id: 101, team: "neutral", hp: 10 })];
        const runtimeState = createRuntimeState();

        const before = isDialogTriggerSatisfied({
            trigger,
            area,
            units,
            killedEnemies: new Set(),
            now: 100,
            areaLoadedAt: 0,
            runtimeState,
        });

        runtimeState.pendingNpcEngagementSpawnIndexes.add(1);
        const after = isDialogTriggerSatisfied({
            trigger,
            area,
            units,
            killedEnemies: new Set(),
            now: 100,
            areaLoadedAt: 0,
            runtimeState,
        });

        expect(before).toBe(false);
        expect(after).toBe(true);
    });

    it("respects after_delay threshold", () => {
        const trigger = createTrigger({
            conditions: [{ type: "after_delay", ms: 500 }],
        });
        const area = createArea();
        const runtimeState = createRuntimeState();

        const early = isDialogTriggerSatisfied({
            trigger,
            area,
            units: [],
            killedEnemies: new Set(),
            now: 400,
            areaLoadedAt: 0,
            runtimeState,
        });

        const onTime = isDialogTriggerSatisfied({
            trigger,
            area,
            units: [],
            killedEnemies: new Set(),
            now: 500,
            areaLoadedAt: 0,
            runtimeState,
        });

        expect(early).toBe(false);
        expect(onTime).toBe(true);
    });

    it("uses action dialog id before legacy dialogId", () => {
        const trigger = createTrigger({
            dialogId: "legacy",
            actions: [{ type: "start_dialog", dialogId: " action_id " }],
        });
        expect(getTriggerStartDialogId(trigger)).toBe("action_id");
    });

    it("falls back to legacy dialogId when no action exists", () => {
        const trigger = createTrigger({ dialogId: " legacy_only " });
        expect(getTriggerStartDialogId(trigger)).toBe("legacy_only");
    });

    it("returns null when no dialog start target exists", () => {
        const trigger = createTrigger({ dialogId: undefined, actions: [] });
        expect(getTriggerStartDialogId(trigger)).toBeNull();
    });
});
