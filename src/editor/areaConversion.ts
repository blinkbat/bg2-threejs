import {
    MAX_PINE_TREE_SIZE,
    MAX_TREE_SIZE,
    MIN_TREE_SIZE,
    type AreaData,
    type Decoration,
    type EnemySpawn,
    type TreeLocation,
} from "../game/areas/types";
import { clampTileTintPercent } from "../game/areas/tileLayers";
import {
    PROP_CHAR_TO_TREE_TYPE,
    PROP_CHAR_TO_TYPE,
    PROP_TREE_CHARS,
    PROP_TREE_TYPE_TO_CHAR,
    PROP_TYPE_TO_CHAR,
} from "./constants";

export function normalizeLightHexColor(color: string | undefined, fallback: string): string {
    if (typeof color === "string" && /^#[0-9a-fA-F]{6}$/.test(color)) {
        return color.toLowerCase();
    }
    return fallback;
}

export function clampFiniteNumber(value: number | undefined, min: number, max: number, fallback: number): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return fallback;
    }
    return Math.max(min, Math.min(max, value));
}

export function createEmptyLayer(width: number, height: number, fill: string): string[][] {
    return Array.from({ length: height }, () => Array(width).fill(fill));
}

export function resizeLayer(layer: string[][], newWidth: number, newHeight: number, fill: string): string[][] {
    const result: string[][] = [];
    for (let z = 0; z < newHeight; z++) {
        const row: string[] = [];
        for (let x = 0; x < newWidth; x++) {
            if (z < layer.length && x < layer[z].length) {
                row.push(layer[z][x]);
            } else {
                row.push(fill);
            }
        }
        result.push(row);
    }
    return result;
}

export function resizeTintLayer(layer: number[][], newWidth: number, newHeight: number): number[][] {
    const result: number[][] = [];
    for (let z = 0; z < newHeight; z++) {
        const row: number[] = [];
        for (let x = 0; x < newWidth; x++) {
            row.push(clampTileTintPercent(layer[z]?.[x] ?? 0));
        }
        result.push(row);
    }
    return result;
}

export function computePropsFromArea(area: AreaData, width: number, height: number): string[][] {
    const grid: string[][] = Array.from({ length: height }, () => Array(width).fill("."));

    for (const tree of area.trees) {
        const x = Math.floor(tree.x);
        const z = Math.floor(tree.z);
        if (x >= 0 && x < width && z >= 0 && z < height) {
            grid[z][x] = PROP_TREE_TYPE_TO_CHAR.get(tree.type ?? "pine") ?? "T";
        }
    }

    if (area.decorations) {
        for (const dec of area.decorations) {
            const x = Math.floor(dec.x);
            const z = Math.floor(dec.z);
            if (x >= 0 && x < width && z >= 0 && z < height) {
                const char = PROP_TYPE_TO_CHAR.get(dec.type);
                if (char) grid[z][x] = char;
            }
        }
    }

    return grid;
}

export function computeEntitiesFromArea(area: AreaData, width: number, height: number): string[][] {
    const grid: string[][] = Array.from({ length: height }, () => Array(width).fill("."));

    // Spawn point
    const sx = Math.floor(area.defaultSpawn.x);
    const sz = Math.floor(area.defaultSpawn.z);
    if (sx >= 0 && sx < width && sz >= 0 && sz < height) grid[sz][sx] = "@";

    // Enemies
    for (const enemy of area.enemySpawns) {
        const x = Math.floor(enemy.x);
        const z = Math.floor(enemy.z);
        if (x >= 0 && x < width && z >= 0 && z < height) grid[z][x] = "E";
    }

    // Chests
    for (const chest of area.chests) {
        const x = Math.floor(chest.x);
        const z = Math.floor(chest.z);
        if (x >= 0 && x < width && z >= 0 && z < height) grid[z][x] = "X";
    }

    // Transitions (doors) - fill entire door area for multi-tile doors
    for (const trans of area.transitions) {
        const startX = Math.floor(trans.x);
        const startZ = Math.floor(trans.z);
        for (let dz = 0; dz < trans.h; dz++) {
            for (let dx = 0; dx < trans.w; dx++) {
                const x = startX + dx;
                const z = startZ + dz;
                if (x >= 0 && x < width && z >= 0 && z < height) grid[z][x] = "D";
            }
        }
    }

    // Candles
    if (area.candles) {
        for (const candle of area.candles) {
            const x = Math.floor(candle.x);
            const z = Math.floor(candle.z);
            if (x >= 0 && x < width && z >= 0 && z < height) {
                grid[z][x] = candle.kind === "torch" ? "Y" : "L";
            }
        }
    }

    // High lights
    if (area.lights) {
        for (const light of area.lights) {
            const x = Math.floor(light.x);
            const z = Math.floor(light.z);
            if (x >= 0 && x < width && z >= 0 && z < height) grid[z][x] = "H";
        }
    }

    // Secret doors
    if (area.secretDoors) {
        for (const sd of area.secretDoors) {
            const startX = Math.floor(sd.blockingWall.x);
            const startZ = Math.floor(sd.blockingWall.z);
            const wallW = Math.max(1, Math.floor(sd.blockingWall.w));
            const wallH = Math.max(1, Math.floor(sd.blockingWall.h));
            for (let dz = 0; dz < wallH; dz++) {
                for (let dx = 0; dx < wallW; dx++) {
                    const x = startX + dx;
                    const z = startZ + dz;
                    if (x >= 0 && x < width && z >= 0 && z < height) grid[z][x] = "S";
                }
            }
        }
    }

    return grid;
}

export function extractPropsFromLayer(props: string[][]): { trees: TreeLocation[]; decorations: Decoration[] } {
    const trees: TreeLocation[] = [];
    const decorations: Decoration[] = [];

    for (let z = 0; z < props.length; z++) {
        for (let x = 0; x < props[z].length; x++) {
            const char = props[z][x];
            if (PROP_TREE_CHARS.has(char)) {
                trees.push({ x, z, size: 1.0, type: PROP_CHAR_TO_TREE_TYPE.get(char) });
            } else {
                const decType = PROP_CHAR_TO_TYPE.get(char);
                if (decType) {
                    decorations.push({ x, z, type: decType });
                }
            }
        }
    }

    return { trees, decorations };
}

export function extractEntitiesFromGrid(entitiesLayer: string[][]): { enemies: { x: number; z: number }[]; chests: { x: number; z: number }[] } {
    const enemies: { x: number; z: number }[] = [];
    const chests: { x: number; z: number }[] = [];

    for (let z = 0; z < entitiesLayer.length; z++) {
        for (let x = 0; x < entitiesLayer[z].length; x++) {
            const char = entitiesLayer[z][x];
            if (char === "E") enemies.push({ x, z });
            else if (char === "X") chests.push({ x, z });
        }
    }

    return { enemies, chests };
}

const NON_BLOCKING_PROP_DECORATIONS = new Set<Decoration["type"]>([
    "small_rock",
    "mushroom",
    "small_mushroom",
    "fern",
    "small_fern",
    "weeds",
    "small_weeds",
    "chair",
]);

export function clampTreeSizeByType(size: number, treeType: TreeLocation["type"]): number {
    const normalizedType = treeType ?? "pine";
    const clampedBase = Math.max(MIN_TREE_SIZE, Math.min(MAX_TREE_SIZE, Number.isFinite(size) ? size : 1));
    if (normalizedType === "pine") {
        return Math.min(clampedBase, MAX_PINE_TREE_SIZE);
    }
    return clampedBase;
}

export function isBlockingPropCell(propsLayer: string[][], x: number, z: number): boolean {
    const char = propsLayer[z]?.[x] ?? ".";
    if (PROP_TREE_CHARS.has(char)) {
        return true;
    }
    const decType = PROP_CHAR_TO_TYPE.get(char);
    if (!decType) {
        return false;
    }
    return !NON_BLOCKING_PROP_DECORATIONS.has(decType);
}

function isValidEnemySpawnCell(
    x: number,
    z: number,
    geometryLayer: string[][],
    terrainLayer: string[][],
    propsLayer: string[][],
    width: number,
    height: number,
    occupied: Set<string>,
    allowWater: boolean = false
): boolean {
    if (x < 0 || z < 0 || x >= width || z >= height) {
        return false;
    }

    if ((geometryLayer[z]?.[x] ?? "#") !== ".") {
        return false;
    }

    if (!allowWater) {
        const terrain = terrainLayer[z]?.[x] ?? ".";
        if (terrain === "~" || terrain === "w") {
            return false;
        }
    }

    if (isBlockingPropCell(propsLayer, x, z)) {
        return false;
    }

    return !occupied.has(`${x},${z}`);
}

function findNearestValidEnemySpawnCell(
    startX: number,
    startZ: number,
    geometryLayer: string[][],
    terrainLayer: string[][],
    propsLayer: string[][],
    width: number,
    height: number,
    occupied: Set<string>,
    allowWater: boolean = false
): { x: number; z: number } | null {
    if (isValidEnemySpawnCell(startX, startZ, geometryLayer, terrainLayer, propsLayer, width, height, occupied, allowWater)) {
        return { x: startX, z: startZ };
    }

    const maxRadius = Math.max(width, height);
    for (let radius = 1; radius <= maxRadius; radius++) {
        let best: { x: number; z: number; distSq: number } | null = null;

        for (let dz = -radius; dz <= radius; dz++) {
            for (let dx = -radius; dx <= radius; dx++) {
                if (Math.abs(dx) !== radius && Math.abs(dz) !== radius) {
                    continue;
                }

                const x = startX + dx;
                const z = startZ + dz;
                if (!isValidEnemySpawnCell(x, z, geometryLayer, terrainLayer, propsLayer, width, height, occupied, allowWater)) {
                    continue;
                }

                const distSq = dx * dx + dz * dz;
                if (
                    best === null
                    || distSq < best.distSq
                    || (distSq === best.distSq && (z < best.z || (z === best.z && x < best.x)))
                ) {
                    best = { x, z, distSq };
                }
            }
        }

        if (best) {
            return { x: best.x, z: best.z };
        }
    }

    return null;
}

export function sanitizeEnemySpawns(
    spawns: EnemySpawn[],
    geometryLayer: string[][],
    terrainLayer: string[][],
    propsLayer: string[][],
    width: number,
    height: number
): EnemySpawn[] {
    const sanitized: EnemySpawn[] = [];
    const occupied = new Set<string>();

    const AQUATIC_ENEMIES = new Set(["baby_kraken", "kraken_tentacle"]);

    for (const spawn of spawns) {
        const startX = Math.floor(spawn.x);
        const startZ = Math.floor(spawn.z);
        const allowWater = AQUATIC_ENEMIES.has(spawn.type);
        const nearest = findNearestValidEnemySpawnCell(
            startX,
            startZ,
            geometryLayer,
            terrainLayer,
            propsLayer,
            width,
            height,
            occupied,
            allowWater
        );

        if (!nearest) {
            sanitized.push(spawn);
            continue;
        }

        occupied.add(`${nearest.x},${nearest.z}`);
        sanitized.push({ ...spawn, x: nearest.x + 0.5, z: nearest.z + 0.5 });
    }

    return sanitized;
}
