// =============================================================================
// TILE LAYER HELPERS
// =============================================================================

export const TILE_EMPTY = ".";
const MIN_TILE_TINT_PERCENT = -35;
const MAX_TILE_TINT_PERCENT = 35;

function createEmptyTileGrid(width: number, height: number, fill: string = TILE_EMPTY): string[][] {
    return Array.from({ length: height }, () => Array(width).fill(fill));
}

export function createEmptyTintGrid(width: number, height: number, fill: number = 0): number[][] {
    return Array.from({ length: height }, () => Array(width).fill(fill));
}

function cloneTileGrid(grid: string[][]): string[][] {
    return grid.map(row => [...row]);
}

function cloneTintGrid(grid: number[][]): number[][] {
    return grid.map(row => [...row]);
}

export function cloneTileLayerStack(layers: string[][][]): string[][][] {
    return layers.map(cloneTileGrid);
}

export function cloneTintLayerStack(layers: number[][][]): number[][][] {
    return layers.map(cloneTintGrid);
}

export function clampTileTintPercent(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(MIN_TILE_TINT_PERCENT, Math.min(MAX_TILE_TINT_PERCENT, Math.round(value)));
}

export function normalizeTileLayerStack(
    layers: string[][][] | undefined,
    width: number,
    height: number,
    fill: string = TILE_EMPTY
): string[][][] {
    if (!layers || layers.length === 0) {
        return [createEmptyTileGrid(width, height, fill)];
    }

    return layers.map(layer => resizeTileGrid(layer, width, height, fill));
}

export function normalizeTintLayerStack(
    tintLayers: number[][][] | undefined,
    layerCount: number,
    width: number,
    height: number
): number[][][] {
    const normalized: number[][][] = [];
    for (let layerIndex = 0; layerIndex < layerCount; layerIndex++) {
        const source = tintLayers?.[layerIndex];
        normalized.push(resizeTintGrid(source ?? [], width, height));
    }
    return normalized;
}

export function composeTileLayers(
    layers: string[][][] | undefined,
    width: number,
    height: number,
    emptyChar: string = TILE_EMPTY
): string[][] {
    const normalizedLayers = normalizeTileLayerStack(layers, width, height, emptyChar);
    const composed = createEmptyTileGrid(width, height, emptyChar);

    for (let z = 0; z < height; z++) {
        for (let x = 0; x < width; x++) {
            for (let layerIndex = normalizedLayers.length - 1; layerIndex >= 0; layerIndex--) {
                const char = normalizedLayers[layerIndex][z][x];
                if (char !== emptyChar && char !== " " && char !== undefined) {
                    composed[z][x] = char;
                    break;
                }
            }
        }
    }

    return composed;
}

export function composeTintLayers(
    layers: string[][][] | undefined,
    tintLayers: number[][][] | undefined,
    width: number,
    height: number,
    emptyChar: string = TILE_EMPTY
): number[][] {
    const normalizedLayers = normalizeTileLayerStack(layers, width, height, emptyChar);
    const normalizedTints = normalizeTintLayerStack(tintLayers, normalizedLayers.length, width, height);
    const composedTint = createEmptyTintGrid(width, height, 0);

    for (let z = 0; z < height; z++) {
        for (let x = 0; x < width; x++) {
            for (let layerIndex = normalizedLayers.length - 1; layerIndex >= 0; layerIndex--) {
                const char = normalizedLayers[layerIndex][z][x];
                if (char !== emptyChar && char !== " " && char !== undefined) {
                    composedTint[z][x] = clampTileTintPercent(normalizedTints[layerIndex][z][x] ?? 0);
                    break;
                }
            }
        }
    }

    return composedTint;
}

export function hasTintData(tintLayers: number[][][] | undefined): boolean {
    if (!tintLayers) return false;
    for (const layer of tintLayers) {
        for (const row of layer) {
            for (const tint of row) {
                if (Math.abs(tint) > 0.001) return true;
            }
        }
    }
    return false;
}

function resizeTileGrid(layer: string[][], width: number, height: number, fill: string): string[][] {
    const resized: string[][] = [];
    for (let z = 0; z < height; z++) {
        const row: string[] = [];
        for (let x = 0; x < width; x++) {
            row.push(layer[z]?.[x] ?? fill);
        }
        resized.push(row);
    }
    return resized;
}

function resizeTintGrid(layer: number[][], width: number, height: number): number[][] {
    const resized: number[][] = [];
    for (let z = 0; z < height; z++) {
        const row: number[] = [];
        for (let x = 0; x < width; x++) {
            row.push(clampTileTintPercent(layer[z]?.[x] ?? 0));
        }
        resized.push(row);
    }
    return resized;
}
