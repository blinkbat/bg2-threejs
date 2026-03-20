import { describe, expect, it } from "vitest";
import { buildAreaDataFromEditor } from "../src/editor/mapEditorAreaBuilder";
import { createLoadedAreaState } from "../src/editor/mapEditorAreaState";
import type { AreaData } from "../src/game/areas/types";

function toGrid(...rows: string[]): string[][] {
    return rows.map((row) => row.split(""));
}

function createArea(overrides: Partial<AreaData> = {}): AreaData {
    return {
        id: "coast",
        name: "Seaswept Coastline",
        flavor: "Salt air fills your lungs.",
        gridSize: 3,
        gridWidth: 3,
        gridHeight: 3,
        backgroundColor: "#3181a0",
        groundColor: "#ab9e78",
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
            "...",
            "...",
            "..."
        ),
        enemySpawns: [],
        transitions: [],
        chests: [],
        trees: [],
        ambientLight: 0.55,
        directionalLight: 0.75,
        hasFogOfWar: true,
        sceneEffects: { rain: true, lightning: true },
        defaultSpawn: { x: 1, z: 1 },
        ...overrides,
    };
}

describe("map editor scene effects", () => {
    it("preserves scene effects when loading and rebuilding area data", () => {
        const area = createArea();
        const state = createLoadedAreaState(area);

        expect(state.metadata.sceneEffects).toEqual({ rain: true, lightning: true });

        const rebuilt = buildAreaDataFromEditor({
            metadata: state.metadata,
            geometryLayer: state.geometryLayer,
            terrainLayers: state.terrainLayers,
            floorLayers: state.floorLayers,
            terrainTintLayers: state.terrainTintLayers,
            floorTintLayers: state.floorTintLayers,
            propsLayer: state.propsLayer,
            entitiesLayer: state.entitiesLayer,
            entities: state.entities,
            trees: state.trees,
            decorations: state.decorations,
            dialogs: state.dialogs,
            dialogLocations: state.locations,
            dialogTriggers: state.dialogTriggers,
        });

        expect(rebuilt.sceneEffects).toEqual({ rain: true, lightning: true });
    });
});
