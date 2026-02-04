// =============================================================================
// AREA HELPERS - Grid generation, candles, obstacle merging
// =============================================================================

import type { CandlePosition, MergedObstacle } from "../../core/types";
import type { AreaData, ComputedAreaData } from "./types";

/**
 * Build blocked grid from geometry grid.
 * Walkable: . (floor)
 * Blocked: # (wall), anything else
 * Note: Doors are defined by transitions, not geometry chars
 */
function buildBlockedFromGeometry(geometry: string[][], gridWidth: number, gridHeight: number): boolean[][] {
    const blocked: boolean[][] = Array(gridWidth)
        .fill(null)
        .map(() => Array(gridHeight).fill(true));

    for (let z = 0; z < gridHeight && z < geometry.length; z++) {
        for (let x = 0; x < gridWidth && x < (geometry[z]?.length ?? 0); x++) {
            const char = geometry[z][x];
            // Only floor is walkable
            if (char === ".") {
                blocked[x][z] = false;
            }
        }
    }

    return blocked;
}

/**
 * Merge adjacent blocked cells into larger rectangles for efficient rendering.
 */
function mergeObstacles(blocked: boolean[][], gridWidth: number, gridHeight: number): MergedObstacle[] {
    const obstacles: MergedObstacle[] = [];
    const used = new Set<string>();

    for (let x = 0; x < gridWidth; x++) {
        for (let z = 0; z < gridHeight; z++) {
            if (!blocked[x][z] || used.has(`${x},${z}`)) continue;

            let w = 1, h = 1;
            // Expand horizontally
            while (x + w < gridWidth && blocked[x + w][z] && !used.has(`${x + w},${z}`)) w++;
            // Expand vertically
            outer: while (z + h < gridHeight) {
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
    // Build blocked grid from geometry
    const blocked = buildBlockedFromGeometry(area.geometry, area.gridWidth, area.gridHeight);

    // Also unblock terrain lava zones (they don't render as walls, but block movement separately)
    for (let z = 0; z < area.gridHeight && z < area.terrain.length; z++) {
        for (let x = 0; x < area.gridWidth && x < (area.terrain[z]?.length ?? 0); x++) {
            if (area.terrain[z][x] === "~") {
                blocked[x][z] = false;
            }
        }
    }

    // Unblock transition (door) cells - doors render as portals, not walls
    area.transitions.forEach(trans => {
        for (let dz = 0; dz < trans.h; dz++) {
            for (let dx = 0; dx < trans.w; dx++) {
                const x = Math.floor(trans.x) + dx;
                const z = Math.floor(trans.z) + dz;
                if (x >= 0 && x < area.gridWidth && z >= 0 && z < area.gridHeight) {
                    blocked[x][z] = false;
                }
            }
        }
    });

    // Include manual candle placements only (no auto-generation)
    const candlePositions: CandlePosition[] = [...(area.candles ?? [])];

    // Merge obstacles BEFORE blocking trees/lava (so they don't become walls)
    // Note: Secret door areas remain blocked, so walls WILL render there
    // The walls get removed when the secret door is opened
    const mergedObstacles = mergeObstacles(blocked, area.gridWidth, area.gridHeight);

    // Track lava zones for pathfinding (NOT in main blocked grid - lava doesn't block LOS)
    const lavaBlocked = new Set<string>();
    for (let z = 0; z < area.gridHeight && z < area.terrain.length; z++) {
        for (let x = 0; x < area.gridWidth && x < (area.terrain[z]?.length ?? 0); x++) {
            if (area.terrain[z][x] === "~") {
                lavaBlocked.add(`${x},${z}`);
            }
        }
    }

    // Block tree positions for pathing and LOS (after wall merging)
    const treeBlocked = new Set<string>();
    area.trees.forEach(tree => {
        const tx = Math.floor(tree.x);
        const tz = Math.floor(tree.z);
        // Block the cell the tree is on for pathfinding
        if (tx >= 0 && tx < area.gridWidth && tz >= 0 && tz < area.gridHeight) {
            blocked[tx][tz] = true;
            treeBlocked.add(`${tx},${tz}`);
        }
        // Taller trees (size >= 1.0) block adjacent cells for LOS only
        if (tree.size >= 1.0) {
            for (let dx = -1; dx <= 1; dx++) {
                for (let dz = -1; dz <= 1; dz++) {
                    if (dx === 0 && dz === 0) continue;
                    const nx = tx + dx, nz = tz + dz;
                    if (nx >= 0 && nx < area.gridWidth && nz >= 0 && nz < area.gridHeight) {
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
            if (dx >= 0 && dx < area.gridWidth && dz >= 0 && dz < area.gridHeight) {
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
