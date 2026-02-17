// =============================================================================
// AREA HELPERS - Grid generation, candles, obstacle merging
// =============================================================================

import type { CandlePosition, MergedObstacle } from "../../core/types";
import { MAX_PINE_TREE_SIZE, MAX_TREE_SIZE, MIN_TREE_SIZE, type AreaData, type ComputedAreaData } from "./types";

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
 * Estimate canopy footprint radius for LOS blocking.
 * The formulas mirror rendered tree proportions (with average variance) so LOS
 * feels aligned with what the player actually sees.
 */
function estimateTreeLosRadius(areaId: string, treeSize: number, treeType: "pine" | "palm" | "oak"): number {
    const treeSizeMultiplier = areaId === "forest" ? 1.5 : 1.0;
    const clampedSize = Math.max(MIN_TREE_SIZE, Math.min(MAX_TREE_SIZE, treeSize));
    const effectiveSize = treeType === "pine"
        ? Math.min(clampedSize, MAX_PINE_TREE_SIZE)
        : clampedSize;
    const scale = effectiveSize * treeSizeMultiplier;
    const skinnyFactor = Math.min(1, 1 / Math.sqrt(Math.max(scale, 0.0001)));

    if (treeType === "palm") {
        // Palm LOS radius includes canopy spread + average lean offset.
        const palmCanopyRadius = 0.58 * scale * 1.22 * 1.225;
        const averageLeanOffset = (2.5 * scale * 1.325) * Math.sin(8 * (Math.PI / 180));
        return Math.max(0.85, palmCanopyRadius + averageLeanOffset + 0.15);
    }

    if (treeType === "oak") {
        const foliageRadius = 1.0 * scale * skinnyFactor;
        return Math.max(0.75, foliageRadius * 1.1 + 0.15);
    }

    // Pine (default)
    const foliageRadius = 0.8 * scale * skinnyFactor;
    return Math.max(0.65, foliageRadius * 1.05 + 0.12);
}

/**
 * Add a circular LOS footprint to the blocked set.
 * Uses cell centers to produce natural round-ish silhouettes on the grid.
 */
function addTreeLosFootprint(
    treeBlocked: Set<string>,
    centerX: number,
    centerZ: number,
    radius: number,
    gridWidth: number,
    gridHeight: number
): void {
    const influenceRadius = radius + 0.35;
    const radiusSq = influenceRadius * influenceRadius;

    const minX = Math.max(0, Math.floor(centerX - influenceRadius - 1));
    const maxX = Math.min(gridWidth - 1, Math.ceil(centerX + influenceRadius + 1));
    const minZ = Math.max(0, Math.floor(centerZ - influenceRadius - 1));
    const maxZ = Math.min(gridHeight - 1, Math.ceil(centerZ + influenceRadius + 1));

    for (let x = minX; x <= maxX; x++) {
        for (let z = minZ; z <= maxZ; z++) {
            const cx = x + 0.5;
            const cz = z + 0.5;
            const dx = cx - centerX;
            const dz = cz - centerZ;
            if (dx * dx + dz * dz <= radiusSq) {
                treeBlocked.add(`${x},${z}`);
            }
        }
    }
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

    // Merge obstacles BEFORE dynamic blockers (trees, secret doors, etc.)
    const mergedObstacles = mergeObstacles(blocked, area.gridWidth, area.gridHeight);

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

        // LOS blocking follows visual canopy footprint (size/type aware), not a fixed 3x3.
        const treeType = tree.type ?? "pine";
        const losRadius = estimateTreeLosRadius(area.id, tree.size, treeType);
        addTreeLosFootprint(treeBlocked, tree.x, tree.z, losRadius, area.gridWidth, area.gridHeight);
    });

    // Block decoration positions for pathing (large types) and LOS (tall things only)
    const nonBlockingDecorations = new Set(["small_rock", "mushroom", "small_mushroom", "fern", "small_fern", "weeds", "small_weeds"]);
    if (area.decorations) {
        area.decorations.forEach(dec => {
            const dx = Math.floor(dec.x);
            const dz = Math.floor(dec.z);

            if (dx >= 0 && dx < area.gridWidth && dz >= 0 && dz < area.gridHeight) {
                // Only block movement for large decorations
                if (!nonBlockingDecorations.has(dec.type)) {
                    blocked[dx][dz] = true;
                }

                // Standing columns block LoS (they're tall)
                if (dec.type === "column") {
                    treeBlocked.add(`${dx},${dz}`);
                }
            }
        });
    }

    return { blocked, mergedObstacles, candlePositions, treeBlocked, terrainBlocked };
}
