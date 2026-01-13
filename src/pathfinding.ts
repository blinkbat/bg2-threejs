import { GRID_SIZE, VISION_RADIUS, PATH_RECURSION_LIMIT, ASTAR_BLOCKED_TARGET_SEARCH, ASTAR_DIAGONAL_COST } from "./constants";
import { blocked } from "./dungeon";
import { isWithinGrid } from "./geometry";
import type { PathNode, Unit, UnitGroup } from "./types";

// =============================================================================
// GRID HELPERS
// =============================================================================

/**
 * Check if a cell is blocked (wall or obstacle).
 * Returns false for out-of-bounds cells (treated as passable for LOS).
 */
export function isBlocked(x: number, z: number): boolean {
    return blocked[x]?.[z] === true;
}

/**
 * Check if a cell is passable (not blocked and within grid).
 */
export function isPassable(x: number, z: number): boolean {
    return isWithinGrid(x, z) && !isBlocked(x, z);
}

// =============================================================================
// FOG OF WAR - Bresenham LOS, visibility states: 0=unseen, 1=seen, 2=visible
// =============================================================================

/**
 * Decay all visible cells to seen state.
 */
function decayVisibility(visibility: number[][]): void {
    for (let x = 0; x < GRID_SIZE; x++) {
        for (let z = 0; z < GRID_SIZE; z++) {
            if (visibility[x][z] === 2) visibility[x][z] = 1;
        }
    }
}

/**
 * Mark cells visible from a unit's position using line of sight.
 */
function markVisibleFromUnit(visibility: number[][], ux: number, uz: number): void {
    for (let dx = -VISION_RADIUS; dx <= VISION_RADIUS; dx++) {
        for (let dz = -VISION_RADIUS; dz <= VISION_RADIUS; dz++) {
            const x = ux + dx, z = uz + dz;
            if (!isWithinGrid(x, z)) continue;
            // Skip if outside vision circle
            if (dx * dx + dz * dz > VISION_RADIUS * VISION_RADIUS) continue;
            if (hasLineOfSight(ux, uz, x, z)) visibility[x][z] = 2;
        }
    }
}

export function hasLineOfSight(x0: number, z0: number, x1: number, z1: number): boolean {
    // Bresenham's line - returns false if any blocked cell between start and end
    const dx = Math.abs(x1 - x0), dz = Math.abs(z1 - z0);
    const sx = x0 < x1 ? 1 : -1, sz = z0 < z1 ? 1 : -1;
    let err = dx - dz;
    let x = x0, z = z0;

    while (true) {
        if (x === x1 && z === z1) return true;
        // Skip start cell, check all others for blocking
        if (isBlocked(x, z) && !(x === x0 && z === z0)) return false;
        const e2 = 2 * err;
        if (e2 > -dz) { err -= dz; x += sx; }
        if (e2 < dx) { err += dx; z += sz; }
    }
}

export function updateVisibility(
    visibility: number[][],
    playerUnits: Unit[],
    unitsRef: React.RefObject<Record<number, UnitGroup>>
): number[][] {
    decayVisibility(visibility);

    // Mark cells visible from each player unit
    playerUnits.forEach((u: Unit) => {
        const g = unitsRef.current[u.id];
        if (!g || u.hp <= 0) return;
        const ux = Math.floor(g.position.x), uz = Math.floor(g.position.z);
        markVisibleFromUnit(visibility, ux, uz);
    });

    return visibility;
}

// =============================================================================
// A* PATHFINDING
// =============================================================================

interface Neighbor {
    x: number;
    z: number;
    cost: number;
}

/**
 * Get valid neighbors for A* pathfinding.
 * Handles diagonal movement with corner-cutting prevention.
 */
function getNeighbors(x: number, z: number, diagonalCost: number): Neighbor[] {
    const neighbors: Neighbor[] = [];

    // Cardinal directions (cost = 1)
    const cardinals = [
        { dx: -1, dz: 0 },
        { dx: 1, dz: 0 },
        { dx: 0, dz: -1 },
        { dx: 0, dz: 1 },
    ];

    // Diagonal directions
    const diagonals = [
        { dx: -1, dz: -1 },
        { dx: 1, dz: -1 },
        { dx: -1, dz: 1 },
        { dx: 1, dz: 1 },
    ];

    // Add cardinal neighbors
    for (const { dx, dz } of cardinals) {
        const nx = x + dx, nz = z + dz;
        if (isPassable(nx, nz)) {
            neighbors.push({ x: nx, z: nz, cost: 1 });
        }
    }

    // Add diagonal neighbors (with corner-cutting prevention)
    for (const { dx, dz } of diagonals) {
        const nx = x + dx, nz = z + dz;
        if (!isPassable(nx, nz)) continue;

        // Block diagonal if either adjacent cardinal is blocked (no corner cutting)
        if (isBlocked(x, nz) || isBlocked(nx, z)) continue;

        neighbors.push({ x: nx, z: nz, cost: diagonalCost });
    }

    return neighbors;
}

/**
 * Binary search to find insertion index for a node in a sorted open list.
 * Returns the index where the node should be inserted to maintain sort order.
 */
function binarySearchInsertIndex(open: PathNode[], f: number): number {
    let low = 0, high = open.length;
    while (low < high) {
        const mid = (low + high) >>> 1;
        if ((open[mid].g + open[mid].h) < f) {
            low = mid + 1;
        } else {
            high = mid;
        }
    }
    return low;
}

/**
 * Insert a node into the open list maintaining sorted order by f-score.
 */
function insertSorted(open: PathNode[], node: PathNode): void {
    const f = node.g + node.h;
    const index = binarySearchInsertIndex(open, f);
    open.splice(index, 0, node);
}

export function findPath(startX: number, startZ: number, endX: number, endZ: number, depth: number = 0): { x: number; z: number }[] | null {
    // Prevent infinite recursion with depth limit
    if (depth > PATH_RECURSION_LIMIT) return null;

    const sx = Math.floor(startX), sz = Math.floor(startZ);
    const ex = Math.floor(endX), ez = Math.floor(endZ);

    if (sx === ex && sz === ez) return [{ x: endX, z: endZ }];
    if (ex < 0 || ex >= GRID_SIZE || ez < 0 || ez >= GRID_SIZE) return null;

    // Target blocked - find nearest unblocked cell
    if (isBlocked(ex, ez)) {
        let best: { x: number; z: number } | null = null, bestDist = Infinity;
        for (let dx = -ASTAR_BLOCKED_TARGET_SEARCH; dx <= ASTAR_BLOCKED_TARGET_SEARCH; dx++) {
            for (let dz = -ASTAR_BLOCKED_TARGET_SEARCH; dz <= ASTAR_BLOCKED_TARGET_SEARCH; dz++) {
                const nx = ex + dx, nz = ez + dz;
                if (isPassable(nx, nz)) {
                    const d = Math.hypot(dx, dz);
                    if (d < bestDist) { bestDist = d; best = { x: nx, z: nz }; }
                }
            }
        }
        if (best) return findPath(startX, startZ, best.x + 0.5, best.z + 0.5, depth + 1);
        return null;
    }

    const open: PathNode[] = [{ x: sx, z: sz, g: 0, h: Math.hypot(ex - sx, ez - sz), parent: null }];
    const closed = new Set<string>();
    const key = (x: number, z: number) => `${x},${z}`;

    while (open.length > 0) {
        // List is already sorted, just take the first element (lowest f-score)
        const current = open.shift()!;

        if (current.x === ex && current.z === ez) {
            const path: { x: number; z: number }[] = [];
            let node: PathNode | null = current;
            while (node) {
                path.unshift({ x: node.x + 0.5, z: node.z + 0.5 });
                node = node.parent;
            }
            path[path.length - 1] = { x: endX, z: endZ };
            return path;
        }

        closed.add(key(current.x, current.z));

        // Get valid neighbors (handles bounds, blocking, and corner-cutting)
        const neighbors = getNeighbors(current.x, current.z, ASTAR_DIAGONAL_COST);

        for (const n of neighbors) {
            if (closed.has(key(n.x, n.z))) continue;

            const g = current.g + n.cost;
            const existingIndex = open.findIndex(o => o.x === n.x && o.z === n.z);
            if (existingIndex !== -1) {
                const existing = open[existingIndex];
                if (g < existing.g) {
                    // Remove from current position and re-insert with updated g value
                    open.splice(existingIndex, 1);
                    existing.g = g;
                    existing.parent = current;
                    insertSorted(open, existing);
                }
            } else {
                // Insert new node in sorted position
                insertSorted(open, { x: n.x, z: n.z, g, h: Math.hypot(ex - n.x, ez - n.z), parent: current });
            }
        }
    }
    return null;
}
