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

    // Unblock terrain hazard zones (they don't render as walls, but block movement separately)
    for (let z = 0; z < area.gridHeight && z < area.terrain.length; z++) {
        for (let x = 0; x < area.gridWidth && x < (area.terrain[z]?.length ?? 0); x++) {
            const t = area.terrain[z][x];
            if (t === "~" || t === "w") {
                blocked[x][z] = false;
            }
        }
    }

    // Keep transition footprints out of merged wall geometry so portal meshes
    // render cleanly instead of being replaced by wall obstacles.
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

    // Merge obstacles BEFORE dynamic blockers (trees, secret doors, etc.)
    const mergedObstacles = mergeObstacles(blocked, area.gridWidth, area.gridHeight);

    // Transition doors are non-walkable for movement/pathing.
    area.transitions.forEach(trans => {
        for (let dz = 0; dz < trans.h; dz++) {
            for (let dx = 0; dx < trans.w; dx++) {
                const x = Math.floor(trans.x) + dx;
                const z = Math.floor(trans.z) + dz;
                if (x >= 0 && x < area.gridWidth && z >= 0 && z < area.gridHeight) {
                    blocked[x][z] = true;
                }
            }
        }
    });

    // Secret doors: keep cells blocked for movement/LOS until opened.
    // They render with dedicated secret-door meshes, so we do NOT include them in mergedObstacles.
    area.secretDoors?.forEach(secretDoor => {
        const wallX = Math.floor(secretDoor.blockingWall.x);
        const wallZ = Math.floor(secretDoor.blockingWall.z);
        const wallW = Math.max(1, Math.floor(secretDoor.blockingWall.w));
        const wallH = Math.max(1, Math.floor(secretDoor.blockingWall.h));

        for (let dz = 0; dz < wallH; dz++) {
            for (let dx = 0; dx < wallW; dx++) {
                const x = wallX + dx;
                const z = wallZ + dz;
                if (x >= 0 && x < area.gridWidth && z >= 0 && z < area.gridHeight) {
                    blocked[x][z] = true;
                }
            }
        }
    });

    // Track terrain hazard zones for pathfinding (NOT in main blocked grid - doesn't block LOS)
    const terrainBlocked = new Set<string>();
    for (let z = 0; z < area.gridHeight && z < area.terrain.length; z++) {
        for (let x = 0; x < area.gridWidth && x < (area.terrain[z]?.length ?? 0); x++) {
            const t = area.terrain[z][x];
            if (t === "~" || t === "w") {
                terrainBlocked.add(`${x},${z}`);
            }
        }
    }

    // Block tree positions for pathing and LOS (after wall merging).
    // Trees behave like tall poles: one blocked cell centered on the tree.
    const treeBlocked = new Set<string>();
    area.trees.forEach(tree => {
        const tx = Math.floor(tree.x);
        const tz = Math.floor(tree.z);

        // Block the cell the tree is on for pathfinding
        if (tx >= 0 && tx < area.gridWidth && tz >= 0 && tz < area.gridHeight) {
            blocked[tx][tz] = true;
            treeBlocked.add(`${tx},${tz}`);
        }
    });

    // Block decoration positions for pathing (large types) and LOS (tall things only)
    const nonBlockingDecorations = new Set(["small_rock", "mushroom", "small_mushroom", "fern", "small_fern", "weeds", "small_weeds", "chair"]);
    if (area.decorations) {
        area.decorations.forEach(dec => {
            const dx = Math.floor(dec.x);
            const dz = Math.floor(dec.z);

            if (dx >= 0 && dx < area.gridWidth && dz >= 0 && dz < area.gridHeight) {
                // Bars are always solid blockers; other large decorations block by default.
                if (dec.type === "bar" || !nonBlockingDecorations.has(dec.type)) {
                    blocked[dx][dz] = true;
                }

                // Standing columns block LoS (they're tall)
                if (dec.type === "column") {
                    treeBlocked.add(`${dx},${dz}`);
                }
            }
        });
    }

    // Chests are solid props for movement/pathing.
    area.chests.forEach(chest => {
        const cx = Math.floor(chest.x);
        const cz = Math.floor(chest.z);
        if (cx >= 0 && cx < area.gridWidth && cz >= 0 && cz < area.gridHeight) {
            blocked[cx][cz] = true;
        }
    });

    // Waystones are solid world props for pathing.
    area.waystones?.forEach(waystone => {
        const wx = Math.floor(waystone.x);
        const wz = Math.floor(waystone.z);
        if (wx >= 0 && wx < area.gridWidth && wz >= 0 && wz < area.gridHeight) {
            blocked[wx][wz] = true;
        }
    });

    return { blocked, mergedObstacles, candlePositions, treeBlocked, terrainBlocked };
}
