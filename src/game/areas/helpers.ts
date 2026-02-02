// =============================================================================
// AREA HELPERS - Grid generation, candles, obstacle merging
// =============================================================================

import type { Room, CandlePosition, MergedObstacle } from "../../core/types";
import type { AreaData, ComputedAreaData } from "./types";

/**
 * Carve walkable area into blocked grid.
 */
function carve(blocked: boolean[][], x1: number, z1: number, x2: number, z2: number): void {
    for (let x = x1; x <= x2; x++) {
        for (let z = z1; z <= z2; z++) {
            if (x >= 0 && x < blocked.length && z >= 0 && z < blocked[0].length) {
                blocked[x][z] = false;
            }
        }
    }
}

/**
 * Generate wall sconces based on room positions.
 * Places 1-2 candles per wall depending on room size.
 */
function generateCandles(rooms: Room[], blocked: boolean[][], gridSize: number): CandlePosition[] {
    const candles: CandlePosition[] = [];

    rooms.forEach(r => {
        // For larger rooms (>8 cells), place 2 candles per wall; otherwise just 1
        const numCandlesX = r.w > 8 ? 2 : 1;
        const numCandlesZ = r.h > 8 ? 2 : 1;

        // South wall
        const sWallZ = r.z - 1;
        if (sWallZ >= 0) {
            for (let i = 0; i < numCandlesX; i++) {
                const xPos = r.x + (i + 0.5) * (r.w / numCandlesX);
                const xInt = Math.floor(xPos);
                if (blocked[xInt]?.[sWallZ]) {
                    candles.push({ x: xPos, z: sWallZ + 0.85, dx: 0, dz: 1 });
                }
            }
        }

        // North wall
        const nWallZ = r.z + r.h;
        if (nWallZ < gridSize) {
            for (let i = 0; i < numCandlesX; i++) {
                const xPos = r.x + (i + 0.5) * (r.w / numCandlesX);
                const xInt = Math.floor(xPos);
                if (blocked[xInt]?.[nWallZ]) {
                    candles.push({ x: xPos, z: nWallZ + 0.15, dx: 0, dz: -1 });
                }
            }
        }

        // West wall
        const wWallX = r.x - 1;
        if (wWallX >= 0) {
            for (let i = 0; i < numCandlesZ; i++) {
                const zPos = r.z + (i + 0.5) * (r.h / numCandlesZ);
                const zInt = Math.floor(zPos);
                if (blocked[wWallX]?.[zInt]) {
                    candles.push({ x: wWallX + 0.85, z: zPos, dx: 1, dz: 0 });
                }
            }
        }

        // East wall
        const eWallX = r.x + r.w;
        if (eWallX < gridSize) {
            for (let i = 0; i < numCandlesZ; i++) {
                const zPos = r.z + (i + 0.5) * (r.h / numCandlesZ);
                const zInt = Math.floor(zPos);
                if (blocked[eWallX]?.[zInt]) {
                    candles.push({ x: eWallX + 0.15, z: zPos, dx: -1, dz: 0 });
                }
            }
        }
    });

    return candles;
}

/**
 * Merge adjacent blocked cells into larger rectangles for efficient rendering.
 */
function mergeObstacles(blocked: boolean[][], gridSize: number): MergedObstacle[] {
    const obstacles: MergedObstacle[] = [];
    const used = new Set<string>();

    for (let x = 0; x < gridSize; x++) {
        for (let z = 0; z < gridSize; z++) {
            if (!blocked[x][z] || used.has(`${x},${z}`)) continue;

            let w = 1, h = 1;
            // Expand horizontally
            while (x + w < gridSize && blocked[x + w][z] && !used.has(`${x + w},${z}`)) w++;
            // Expand vertically
            outer: while (z + h < gridSize) {
                for (let dx = 0; dx < w; dx++) {
                    if (!blocked[x + dx][z + h] || used.has(`${x + dx},${z + h}`)) break outer;
                }
                h++;
            }
            // Mark used
            for (let dx = 0; dx < w; dx++) {
                for (let dz = 0; dz < h; dz++) {
                    used.add(`${x + dx},${z + dz}`);
                }
            }
            obstacles.push({ x, z, w, h });
        }
    }

    return obstacles;
}

/**
 * Compute dynamic area data from static definition.
 */
export function computeAreaData(area: AreaData): ComputedAreaData {
    // Initialize blocked grid
    const blocked: boolean[][] = Array(area.gridSize)
        .fill(null)
        .map(() => Array(area.gridSize).fill(true));

    // Carve rooms
    area.rooms.forEach(r => carve(blocked, r.x, r.z, r.x + r.w - 1, r.z + r.h - 1));

    // Carve hallways
    area.hallways.forEach(h => carve(blocked, h.x1, h.z1, h.x2, h.z2));

    // Carve transition areas (doors)
    area.transitions.forEach(t => carve(blocked, t.x, t.z, t.x + t.w - 1, t.z + t.h - 1));

    // Carve lava zones BEFORE wall merging (so they don't render as walls)
    if (area.lavaZones) {
        area.lavaZones.forEach(lz => carve(blocked, lz.x, lz.z, lz.x + lz.w - 1, lz.z + lz.h - 1));
    }

    // Generate candles for dungeon-like areas, and include any manual candle placements
    const generatedCandles = area.id === "dungeon"
        ? generateCandles(area.rooms, blocked, area.gridSize)
        : [];
    const candlePositions = [...generatedCandles, ...(area.candles ?? [])];

    // Merge obstacles BEFORE blocking trees/lava (so they don't become walls)
    // Note: Secret door areas remain blocked, so walls WILL render there
    // The walls get removed when the secret door is opened
    const mergedObstacles = mergeObstacles(blocked, area.gridSize);

    // Track lava zones for pathfinding (NOT in main blocked grid - lava doesn't block LOS)
    const lavaBlocked = new Set<string>();
    if (area.lavaZones) {
        area.lavaZones.forEach(lz => {
            for (let x = lz.x; x < lz.x + lz.w; x++) {
                for (let z = lz.z; z < lz.z + lz.h; z++) {
                    if (x >= 0 && x < area.gridSize && z >= 0 && z < area.gridSize) {
                        lavaBlocked.add(`${x},${z}`);
                    }
                }
            }
        });
    }

    // Block tree positions for pathing and LOS (after wall merging)
    const treeBlocked = new Set<string>();
    area.trees.forEach(tree => {
        const tx = Math.floor(tree.x);
        const tz = Math.floor(tree.z);
        // Block the cell the tree is on for pathfinding
        if (tx >= 0 && tx < area.gridSize && tz >= 0 && tz < area.gridSize) {
            blocked[tx][tz] = true;
            treeBlocked.add(`${tx},${tz}`);
        }
        // Taller trees (size >= 1.0) block adjacent cells for LOS only
        if (tree.size >= 1.0) {
            for (let dx = -1; dx <= 1; dx++) {
                for (let dz = -1; dz <= 1; dz++) {
                    if (dx === 0 && dz === 0) continue;
                    const nx = tx + dx, nz = tz + dz;
                    if (nx >= 0 && nx < area.gridSize && nz >= 0 && nz < area.gridSize) {
                        treeBlocked.add(`${nx},${nz}`);
                    }
                }
            }
        }
    });

    // Block decoration positions for pathing (all types) and LOS (tall things only)
    if (area.decorations) {
        area.decorations.forEach(dec => {
            const dx = Math.floor(dec.x);
            const dz = Math.floor(dec.z);

            // Block movement for all decoration types
            if (dx >= 0 && dx < area.gridSize && dz >= 0 && dz < area.gridSize) {
                blocked[dx][dz] = true;

                // Standing columns block LoS (they're tall)
                if (dec.type === "column") {
                    treeBlocked.add(`${dx},${dz}`);
                }
            }
        });
    }

    return { blocked, mergedObstacles, candlePositions, treeBlocked, lavaBlocked };
}
