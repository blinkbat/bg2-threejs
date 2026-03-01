import { describe, expect, it } from "vitest";
import {
    clampTileTintPercent,
    composeTileLayers,
    composeTintLayers,
    hasTintData,
    normalizeTileLayerStack,
    normalizeTintLayerStack,
    TILE_EMPTY,
} from "../src/game/areas/tileLayers";

describe("tileLayers", () => {
    it("clamps and rounds tint values", () => {
        expect(clampTileTintPercent(Number.NaN)).toBe(0);
        expect(clampTileTintPercent(3.7)).toBe(4);
        expect(clampTileTintPercent(80)).toBe(35);
        expect(clampTileTintPercent(-80)).toBe(-35);
    });

    it("creates a default single layer when no layer stack exists", () => {
        const normalized = normalizeTileLayerStack(undefined, 2, 3, TILE_EMPTY);
        expect(normalized).toHaveLength(1);
        expect(normalized[0]).toHaveLength(3);
        expect(normalized[0][0]).toEqual([TILE_EMPTY, TILE_EMPTY]);
    });

    it("normalizes tint layers to requested dimensions and count", () => {
        const normalized = normalizeTintLayerStack(
            [[[1], [2]]],
            2,
            2,
            2
        );
        expect(normalized).toHaveLength(2);
        expect(normalized[0]).toEqual([
            [1, 0],
            [2, 0],
        ]);
        expect(normalized[1]).toEqual([
            [0, 0],
            [0, 0],
        ]);
    });

    it("composes tile layers using topmost non-empty tile", () => {
        const base = [
            ["g", "g"],
            ["g", "g"],
        ];
        const overlay = [
            [".", "w"],
            [".", "."],
        ];
        const composed = composeTileLayers([base, overlay], 2, 2, ".");
        expect(composed).toEqual([
            ["g", "w"],
            ["g", "g"],
        ]);
    });

    it("composes tint from visible top layer only", () => {
        const base = [
            ["g", "g"],
            ["g", "g"],
        ];
        const overlay = [
            [".", "w"],
            [".", "."],
        ];
        const baseTint = [
            [3, 4],
            [5, 6],
        ];
        const overlayTint = [
            [20, 30],
            [0, 0],
        ];
        const composed = composeTintLayers([base, overlay], [baseTint, overlayTint], 2, 2, ".");
        expect(composed).toEqual([
            [3, 30],
            [5, 6],
        ]);
    });

    it("detects whether any tint data exists", () => {
        expect(hasTintData(undefined)).toBe(false);
        expect(hasTintData([[[0, 0]], [[0, 0]]])).toBe(false);
        expect(hasTintData([[[0.001, 0]]])).toBe(false);
        expect(hasTintData([[[0.002, 0]]])).toBe(true);
    });
});
