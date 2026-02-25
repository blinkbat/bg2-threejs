import type { Layer } from "./types";
import type { EntityDef } from "./types";
import { LAYER_COLORS } from "./constants";
import { clampTileTintPercent } from "../game/areas/tileLayers";

export function getCharColor(char: string, layer: Layer): string {
    return LAYER_COLORS[layer].get(char) ?? "#666";
}

export function getLayerColor(layer: Layer): string {
    switch (layer) {
        case "geometry": return "#888";
        case "terrain": return "#f80";
        case "floor": return "#a86";
        case "props": return "#4a4";
        case "entities": return "#f44";
        case "locations": return "#b98cff";
    }
}

function tintColorForEditor(hexColor: string, tintPercent: number): string {
    const clamped = clampTileTintPercent(tintPercent);
    if (clamped === 0) return hexColor;
    const parsed = hexColor.match(/^#?([0-9a-fA-F]{6})$/);
    if (!parsed) return hexColor;
    const raw = parsed[1];
    const r = parseInt(raw.slice(0, 2), 16);
    const g = parseInt(raw.slice(2, 4), 16);
    const b = parseInt(raw.slice(4, 6), 16);
    const factor = Math.min(1, Math.abs(clamped) / 35);

    const blendChannel = (value: number): number => {
        if (clamped > 0) {
            return Math.round(value + (255 - value) * factor * 0.45);
        }
        return Math.round(value * (1 - factor * 0.45));
    };

    const tintedR = blendChannel(r);
    const tintedG = blendChannel(g);
    const tintedB = blendChannel(b);
    const toHex = (value: number): string => value.toString(16).padStart(2, "0");
    return `#${toHex(tintedR)}${toHex(tintedG)}${toHex(tintedB)}`;
}

export function drawLayer(
    ctx: CanvasRenderingContext2D,
    layer: string[][],
    layerType: Layer,
    cellSize: number,
    tintGrid?: number[][]
): void {
    for (let z = 0; z < layer.length; z++) {
        for (let x = 0; x < layer[z].length; x++) {
            const char = layer[z][x];
            if (char === ".") continue;

            const tintPercent = tintGrid?.[z]?.[x] ?? 0;
            const baseColor = getCharColor(char, layerType);
            const color = (layerType === "floor" || layerType === "terrain") && baseColor
                ? tintColorForEditor(baseColor, tintPercent)
                : baseColor;
            ctx.fillStyle = color;
            ctx.fillRect(x * cellSize + 1, z * cellSize + 1, cellSize - 2, cellSize - 2);

            // Draw char label (skip for floor layer - just show color)
            if (layerType !== "floor") {
                ctx.fillStyle = "#fff";
                ctx.font = "14px monospace";
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText(char, x * cellSize + cellSize / 2, z * cellSize + cellSize / 2);
            }
        }
    }
}

function getSecretDoorCenterTile(
    blockX: number,
    blockZ: number,
    blockW: number,
    blockH: number
): { x: number; z: number } {
    return {
        x: blockX + Math.floor((blockW - 1) / 2),
        z: blockZ + Math.floor((blockH - 1) / 2),
    };
}

export function normalizeSecretDoorEntity(entity: EntityDef): EntityDef {
    if (entity.type !== "secret_door") {
        return entity;
    }

    const blockX = Math.floor(entity.secretBlockX ?? entity.x);
    const blockZ = Math.floor(entity.secretBlockZ ?? entity.z);
    const blockW = Math.max(1, Math.floor(entity.secretBlockW ?? 1));
    const blockH = Math.max(1, Math.floor(entity.secretBlockH ?? 1));
    const center = getSecretDoorCenterTile(blockX, blockZ, blockW, blockH);

    return {
        ...entity,
        x: center.x,
        z: center.z,
        secretBlockX: blockX,
        secretBlockZ: blockZ,
        secretBlockW: blockW,
        secretBlockH: blockH,
    };
}

const LAST_SAVED_AREA_ID_STORAGE_KEY = "bg2-editor-last-saved-area-id";

export function loadLastSavedAreaId(): string | null {
    try {
        const raw = localStorage.getItem(LAST_SAVED_AREA_ID_STORAGE_KEY);
        return raw && raw.trim().length > 0 ? raw.trim() : null;
    } catch {
        return null;
    }
}

export function persistLastSavedAreaId(areaId: string): void {
    try {
        localStorage.setItem(LAST_SAVED_AREA_ID_STORAGE_KEY, areaId);
    } catch {
        // Ignore storage failures (private mode/quota).
    }
}
