import { describe, expect, it, vi } from "vitest";
import type { AreaData } from "../src/game/areas/types";
import { areaDataToText, textToAreaData } from "../src/editor/areaTextFormat";

function toGrid(...rows: string[]): string[][] {
    return rows.map(row => row.split(""));
}

function createArea(overrides: Partial<AreaData> = {}): AreaData {
    return {
        id: "glade",
        name: "The Glade",
        flavor: "A quiet test glade.",
        gridSize: 3,
        gridWidth: 3,
        gridHeight: 3,
        backgroundColor: "#102030",
        groundColor: "#405060",
        geometry: toGrid(
            "...",
            "...",
            "..."
        ),
        terrain: toGrid(
            "...",
            "...",
            "..."
        ),
        floor: toGrid(
            "ggg",
            "ggg",
            "ggg"
        ),
        terrainLayers: [
            toGrid(
                "...",
                "...",
                "..."
            ),
            toGrid(
                "...",
                ".~.",
                "..."
            ),
        ],
        floorLayers: [
            toGrid(
                "ggg",
                "ggg",
                "ggg"
            ),
            toGrid(
                "...",
                ".t.",
                "..."
            ),
        ],
        terrainTintLayers: [
            [
                [0, 0, 0],
                [0, 0, 0],
                [0, 0, 0],
            ],
            [
                [0, 0, 0],
                [0, 18, 0],
                [0, 0, 0],
            ],
        ],
        floorTintLayers: [
            [
                [0, 0, 0],
                [0, 0, 0],
                [0, 0, 0],
            ],
            [
                [0, 0, 0],
                [0, -12, 0],
                [0, 0, 0],
            ],
        ],
        enemySpawns: [],
        transitions: [],
        chests: [],
        trees: [],
        ambientLight: 0.5,
        directionalLight: 0.5,
        hasFogOfWar: true,
        defaultSpawn: { x: 1, z: 1 },
        dialogs: [
            {
                id: "inn_intro",
                startNodeId: "start",
                nodes: {
                    start: {
                        id: "start",
                        speakerId: "innkeeper",
                        text: "Welcome, traveler.",
                    },
                },
            },
        ],
        locations: [
            { id: "inn", x: 0, z: 0, w: 1, h: 1 },
        ],
        dialogTriggers: [
            {
                id: "enter_inn",
                once: false,
                priority: 2,
                actions: [{ type: "start_dialog", dialogId: "inn_intro" }],
                conditions: [{ type: "party_enters_location", locationId: "inn" }],
            },
        ],
        ...overrides,
    };
}

describe("areaTextFormat", () => {
    it("round-trips layered tiles, tint layers, and dialog data", () => {
        const area = createArea();
        const text = areaDataToText(area);
        const parsed = textToAreaData(text);

        expect(parsed.id).toBe(area.id);
        expect(parsed.terrain[1][1]).toBe("~");
        expect(parsed.floor[1][1]).toBe("t");
        expect(parsed.terrainLayers).toHaveLength(2);
        expect(parsed.floorLayers).toHaveLength(2);
        expect(parsed.terrainTintLayers?.[1][1][1]).toBe(18);
        expect(parsed.floorTintLayers?.[1][1][1]).toBe(-12);
        expect(parsed.dialogs?.[0].id).toBe("inn_intro");
        expect(parsed.locations?.[0].id).toBe("inn");
        expect(parsed.dialogTriggers?.[0].id).toBe("enter_inn");
        expect(parsed.dialogTriggers?.[0].actions?.[0].type).toBe("start_dialog");
    });

    it("sanitizes and de-duplicates parsed dialog triggers", () => {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        const text = [
            "=== AREA: coast ===",
            "name: Coast",
            "flavor: test",
            "size: 2x2",
            "background: #000000",
            "ground: #111111",
            "ambient: 0.5",
            "directional: 0.5",
            "fog: true",
            "spawn: 0,0",
            "",
            "=== GEOMETRY ===",
            "..",
            "..",
            "",
            "=== TERRAIN ===",
            "..",
            "..",
            "",
            "=== FLOOR ===",
            "..",
            "..",
            "",
            "=== DIALOG_TRIGGERS ===",
            "not-json",
            JSON.stringify({
                id: "dup",
                dialogId: "legacy_id",
                conditions: [{ type: "after_delay", ms: 120 }],
            }),
            JSON.stringify({
                id: "dup",
                dialogId: "ignored_duplicate",
                conditions: [{ type: "on_area_load" }],
            }),
            JSON.stringify({
                id: "sanitized",
                actions: [{ type: "start_dialog", dialogId: " action_id " }, { type: "bad" }],
                conditions: [
                    { type: "party_out_of_combat_range", range: -2 },
                    { type: "unit_seen", spawnIndex: 2, range: 0 },
                ],
            }),
            "",
        ].join("\n");

        try {
            const parsed = textToAreaData(text);
            const triggers = parsed.dialogTriggers ?? [];

            expect(triggers).toHaveLength(2);
            expect(triggers[0].id).toBe("dup");
            expect(triggers[0].dialogId).toBe("legacy_id");

            const sanitized = triggers.find(trigger => trigger.id === "sanitized");
            expect(sanitized).toBeDefined();
            expect(sanitized?.actions).toEqual([{ type: "start_dialog", dialogId: "action_id" }]);
            expect(sanitized?.conditions).toEqual([
                { type: "party_out_of_combat_range", range: 0.1 },
                { type: "unit_seen", spawnIndex: 2, range: 0.1 },
            ]);
        } finally {
            warnSpy.mockRestore();
        }
    });
});
