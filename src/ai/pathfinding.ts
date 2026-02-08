import { VISION_RADIUS, PATH_RECURSION_LIMIT, ASTAR_BLOCKED_TARGET_SEARCH, ASTAR_DIAGONAL_COST } from "../core/constants";
import { blocked } from "../game/dungeon";
import { isTreeBlocked, isTerrainBlocked } from "../game/areas";
import { isWithinGrid } from "../game/geometry";
import type { PathNode, Unit, UnitGroup } from "../core/types";

// =============================================================================
// DYNAMIC OBSTACLE MAP - Units treated as soft obstacles with extra cost
// =============================================================================

// Cost multiplier for cells near other units (makes pathfinder prefer wider berths)
const UNIT_PROXIMITY_COST = 2;
// How far from a unit's center to apply extra cost (in cells)
const UNIT_AVOIDANCE_RADIUS = 1;
// Squared avoidance radius for fast comparison
const UNIT_AVOIDANCE_RADIUS_SQ = UNIT_AVOIDANCE_RADIUS * UNIT_AVOIDANCE_RADIUS;

// Module-level state for dynamic obstacles (updated each frame before pathfinding)
let dynamicCostMap: Map<string, number> = new Map();

// Track last unit positions to avoid recomputing when nothing moved
let lastUnitPositions: Map<number, string> = new Map();
let dynamicObstaclesDirty = true;

/**
 * Update the dynamic obstacle map based on current unit positions.
 * Call this once per frame before any pathfinding.
 * Uses dirty flag to skip computation when units haven't moved.
 */
export function updateDynamicObstacles(
    units: Unit[],
    unitsRef: Record<number, UnitGroup>,
    excludeUnitId?: number
): void {
    // Check if any unit has moved
    let needsUpdate = false;
    const newPositions: Map<number, string> = new Map();

    for (const unit of units) {
        if (unit.hp <= 0) continue;
        const g = unitsRef[unit.id];
        if (!g) continue;

        const posKey = `${Math.floor(g.position.x)},${Math.floor(g.position.z)}`;
        newPositions.set(unit.id, posKey);

        const oldPos = lastUnitPositions.get(unit.id);
        if (oldPos !== posKey) {
            needsUpdate = true;
        }
    }

    // Check if any units were removed
    if (lastUnitPositions.size !== newPositions.size) {
        needsUpdate = true;
    }

    // Skip if nothing changed
    if (!needsUpdate && !dynamicObstaclesDirty) {
        return;
    }

    lastUnitPositions = newPositions;
    dynamicObstaclesDirty = false;
    dynamicCostMap.clear();

    for (const unit of units) {
        if (unit.hp <= 0) continue;
        if (unit.id === excludeUnitId) continue;

        const g = unitsRef[unit.id];
        if (!g) continue;

        const centerX = Math.floor(g.position.x);
        const centerZ = Math.floor(g.position.z);

        // Add cost to cells near this unit
        for (let dx = -UNIT_AVOIDANCE_RADIUS; dx <= UNIT_AVOIDANCE_RADIUS; dx++) {
            for (let dz = -UNIT_AVOIDANCE_RADIUS; dz <= UNIT_AVOIDANCE_RADIUS; dz++) {
                const x = centerX + dx;
                const z = centerZ + dz;
                if (!isWithinGrid(x, z)) continue;
                if (isBlocked(x, z)) continue; // Don't add cost to walls

                const distSq = dx * dx + dz * dz;
                if (distSq <= UNIT_AVOIDANCE_RADIUS_SQ) {
                    // Higher cost for cells closer to unit center
                    const dist = Math.sqrt(distSq);
                    const cost = UNIT_PROXIMITY_COST * (1 - dist / (UNIT_AVOIDANCE_RADIUS + 1));
                    const key = `${x},${z}`;
                    const existing = dynamicCostMap.get(key) || 0;
                    dynamicCostMap.set(key, Math.max(existing, cost));
                }
            }
        }
    }
}

/**
 * Mark dynamic obstacles as needing recalculation (call on area change, etc.)
 */
export function invalidateDynamicObstacles(): void {
    dynamicObstaclesDirty = true;
    lastUnitPositions.clear();
}

/**
 * Get the extra traversal cost for a cell due to nearby units.
 */
function getDynamicCost(x: number, z: number): number {
    return dynamicCostMap.get(`${x},${z}`) || 0;
}

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
 * Flying units can pass over lava.
 */
export function isPassable(x: number, z: number, flying: boolean = false): boolean {
    if (!isWithinGrid(x, z) || isBlocked(x, z)) return false;
    // Flying units can pass over lava
    if (flying) return true;
    return !isTerrainBlocked(x, z);
}

/**
 * Find the nearest passable position to a target position.
 * Searches in expanding squares around the target.
 */
export function findNearestPassable(targetX: number, targetZ: number, maxRadius: number = 5): { x: number; z: number } | null {
    // Check target first
    const cellX = Math.floor(targetX);
    const cellZ = Math.floor(targetZ);
    if (isPassable(cellX, cellZ)) {
        return { x: targetX, z: targetZ };
    }

    // Search in expanding squares
    for (let radius = 1; radius <= maxRadius; radius++) {
        for (let dx = -radius; dx <= radius; dx++) {
            for (let dz = -radius; dz <= radius; dz++) {
                // Only check cells on the edge of the square
                if (Math.abs(dx) !== radius && Math.abs(dz) !== radius) continue;

                const checkX = cellX + dx;
                const checkZ = cellZ + dz;
                if (isPassable(checkX, checkZ)) {
                    return { x: checkX + 0.5, z: checkZ + 0.5 };
                }
            }
        }
    }

    return null;
}

/**
 * Find passable spawn positions for multiple units around a spawn point.
 * Spreads units in a grid pattern, finding nearest passable cell for each.
 */
export function findSpawnPositions(
    spawnX: number,
    spawnZ: number,
    count: number,
    spacing: number = 1.5
): { x: number; z: number }[] {
    const positions: { x: number; z: number }[] = [];
    const usedCells = new Set<string>();

    for (let i = 0; i < count; i++) {
        // Calculate ideal position in a 3-wide grid
        const idealX = spawnX + (i % 3) * spacing - spacing;
        const idealZ = spawnZ + Math.floor(i / 3) * spacing;

        // Find nearest passable position
        let found = false;
        const cellX = Math.floor(idealX);
        const cellZ = Math.floor(idealZ);
        const cellKey = `${cellX},${cellZ}`;

        // Check ideal position first
        if (isPassable(cellX, cellZ) && !usedCells.has(cellKey)) {
            positions.push({ x: idealX, z: idealZ });
            usedCells.add(cellKey);
            found = true;
        }

        // Search for nearby passable cell if ideal is blocked
        if (!found) {
            for (let radius = 1; radius <= 5; radius++) {
                if (found) break;
                for (let dx = -radius; dx <= radius; dx++) {
                    if (found) break;
                    for (let dz = -radius; dz <= radius; dz++) {
                        if (Math.abs(dx) !== radius && Math.abs(dz) !== radius) continue;

                        const checkX = cellX + dx;
                        const checkZ = cellZ + dz;
                        const key = `${checkX},${checkZ}`;

                        if (isPassable(checkX, checkZ) && !usedCells.has(key)) {
                            positions.push({ x: checkX + 0.5, z: checkZ + 0.5 });
                            usedCells.add(key);
                            found = true;
                            break;
                        }
                    }
                }
            }
        }

        // Fallback to spawn point if nothing found
        if (!found) {
            positions.push({ x: spawnX, z: spawnZ });
        }
    }

    return positions;
}

// =============================================================================
// FOG OF WAR - Bresenham LOS, visibility states: 0=unseen, 1=seen, 2=visible
// =============================================================================

/**
 * Decay all visible cells to seen state.
 */
function decayVisibility(visibility: number[][]): void {
    for (let x = 0; x < visibility.length; x++) {
        for (let z = 0; z < (visibility[x]?.length ?? 0); z++) {
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
        // Skip start cell, check all others for blocking (walls and trees)
        if (!(x === x0 && z === z0)) {
            if (isBlocked(x, z) || isTreeBlocked(x, z)) return false;
        }
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
    // Use Math.round to center visibility on the unit's visual position
    playerUnits.forEach((u: Unit) => {
        const g = unitsRef.current[u.id];
        if (!g || u.hp <= 0) return;
        const ux = Math.round(g.position.x), uz = Math.round(g.position.z);
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

// Pre-compute direction arrays (avoid allocation each call)
const CARDINALS = [
    { dx: -1, dz: 0 },
    { dx: 1, dz: 0 },
    { dx: 0, dz: -1 },
    { dx: 0, dz: 1 },
];
const DIAGONALS = [
    { dx: -1, dz: -1 },
    { dx: 1, dz: -1 },
    { dx: -1, dz: 1 },
    { dx: 1, dz: 1 },
];

/**
 * Get valid neighbors for A* pathfinding.
 * Handles diagonal movement with corner-cutting prevention.
 * Adds dynamic cost for cells near other units (for wider berth pathfinding).
 * Flying units can pass over lava.
 */
function getNeighbors(x: number, z: number, diagonalCost: number, flying: boolean = false): Neighbor[] {
    const neighbors: Neighbor[] = [];

    // Add cardinal neighbors
    for (const { dx, dz } of CARDINALS) {
        const nx = x + dx, nz = z + dz;
        if (isPassable(nx, nz, flying)) {
            // Base cost + dynamic cost from nearby units
            const cost = 1 + getDynamicCost(nx, nz);
            neighbors.push({ x: nx, z: nz, cost });
        }
    }

    // Add diagonal neighbors (with corner-cutting prevention)
    for (const { dx, dz } of DIAGONALS) {
        const nx = x + dx, nz = z + dz;
        if (!isPassable(nx, nz, flying)) continue;

        // Block diagonal if either adjacent cardinal is blocked (no corner cutting)
        if (isBlocked(x, nz) || isBlocked(nx, z)) continue;

        // Base diagonal cost + dynamic cost from nearby units
        const cost = diagonalCost + getDynamicCost(nx, nz);
        neighbors.push({ x: nx, z: nz, cost });
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

// =============================================================================
// PATH CACHING - Avoid redundant A* calculations
// =============================================================================

interface CachedPath {
    path: { x: number; z: number }[];
    timestamp: number;
}

// Cache duration in ms - paths are valid for this long
const PATH_CACHE_DURATION = 500;
// Max cache entries to prevent memory bloat
const PATH_CACHE_MAX_SIZE = 100;

const pathCache: Map<string, CachedPath> = new Map();

function getPathCacheKey(sx: number, sz: number, ex: number, ez: number): string {
    return `${sx},${sz}->${ex},${ez}`;
}

function getCachedPath(sx: number, sz: number, ex: number, ez: number, now: number): { x: number; z: number }[] | null {
    const key = getPathCacheKey(sx, sz, ex, ez);
    const cached = pathCache.get(key);
    if (cached && now - cached.timestamp < PATH_CACHE_DURATION) {
        // Return a copy to prevent mutation issues
        return cached.path.map(p => ({ x: p.x, z: p.z }));
    }
    return null;
}

function setCachedPath(sx: number, sz: number, ex: number, ez: number, path: { x: number; z: number }[], now: number): void {
    // Prune old entries if cache is too large
    if (pathCache.size >= PATH_CACHE_MAX_SIZE) {
        const oldestKey = pathCache.keys().next().value;
        if (oldestKey) pathCache.delete(oldestKey);
    }

    const key = getPathCacheKey(sx, sz, ex, ez);
    pathCache.set(key, { path: path.map(p => ({ x: p.x, z: p.z })), timestamp: now });
}

/**
 * Clear path cache (call on area change or major obstacle updates).
 */
export function clearPathCache(): void {
    pathCache.clear();
}

// =============================================================================
// OPTIMIZED OPEN LIST - O(1) index lookup for updates
// =============================================================================

/**
 * Managed open list that maintains both sorted array and index map.
 * Provides O(1) lookup for updates instead of O(n) indexOf.
 */
class OpenList {
    private nodes: PathNode[] = [];
    private indexMap: Map<string, number> = new Map();

    private key(x: number, z: number): string {
        return `${x},${z}`;
    }

    get length(): number {
        return this.nodes.length;
    }

    /**
     * Insert a node maintaining sorted order by f-score.
     */
    insert(node: PathNode): void {
        const f = node.g + node.h;
        const insertIdx = binarySearchInsertIndex(this.nodes, f);

        // Update indices for all nodes that will shift
        for (let i = insertIdx; i < this.nodes.length; i++) {
            const n = this.nodes[i];
            this.indexMap.set(this.key(n.x, n.z), i + 1);
        }

        this.nodes.splice(insertIdx, 0, node);
        this.indexMap.set(this.key(node.x, node.z), insertIdx);
    }

    /**
     * Remove and return the node with lowest f-score.
     */
    shift(): PathNode | undefined {
        if (this.nodes.length === 0) return undefined;

        const node = this.nodes.shift()!;
        this.indexMap.delete(this.key(node.x, node.z));

        // Update indices for remaining nodes
        for (let i = 0; i < this.nodes.length; i++) {
            const n = this.nodes[i];
            this.indexMap.set(this.key(n.x, n.z), i);
        }

        return node;
    }

    /**
     * Get node by coordinates (O(1)).
     */
    get(x: number, z: number): PathNode | undefined {
        const idx = this.indexMap.get(this.key(x, z));
        return idx !== undefined ? this.nodes[idx] : undefined;
    }

    /**
     * Check if coordinates exist in list (O(1)).
     */
    has(x: number, z: number): boolean {
        return this.indexMap.has(this.key(x, z));
    }

    /**
     * Update a node's g-score and re-sort (O(n) for splice, but O(1) lookup).
     */
    update(node: PathNode, newG: number, newParent: PathNode): void {
        const k = this.key(node.x, node.z);
        const oldIdx = this.indexMap.get(k);
        if (oldIdx === undefined) return;

        // Remove from current position
        this.nodes.splice(oldIdx, 1);

        // Update indices for nodes that shifted
        for (let i = oldIdx; i < this.nodes.length; i++) {
            const n = this.nodes[i];
            this.indexMap.set(this.key(n.x, n.z), i);
        }

        // Update node values
        node.g = newG;
        node.parent = newParent;

        // Re-insert in sorted position
        this.insert(node);
    }
}

export function findPath(startX: number, startZ: number, endX: number, endZ: number, depth: number = 0, flying: boolean = false): { x: number; z: number }[] | null {
    // Prevent infinite recursion with depth limit
    if (depth > PATH_RECURSION_LIMIT) return null;

    const sx = Math.floor(startX), sz = Math.floor(startZ);
    const ex = Math.floor(endX), ez = Math.floor(endZ);

    if (sx === ex && sz === ez) return [{ x: endX, z: endZ }];
    if (!isWithinGrid(ex, ez)) return null;

    // Target blocked - find nearest unblocked cell
    if (isBlocked(ex, ez)) {
        let best: { x: number; z: number } | null = null;
        let bestDistSq = Infinity;
        for (let dx = -ASTAR_BLOCKED_TARGET_SEARCH; dx <= ASTAR_BLOCKED_TARGET_SEARCH; dx++) {
            for (let dz = -ASTAR_BLOCKED_TARGET_SEARCH; dz <= ASTAR_BLOCKED_TARGET_SEARCH; dz++) {
                const nx = ex + dx, nz = ez + dz;
                if (isPassable(nx, nz, flying)) {
                    const dSq = dx * dx + dz * dz;
                    if (dSq < bestDistSq) { bestDistSq = dSq; best = { x: nx, z: nz }; }
                }
            }
        }
        if (best) return findPath(startX, startZ, best.x + 0.5, best.z + 0.5, depth + 1, flying);
        return null;
    }

    // Check cache first
    const now = Date.now();
    const cached = getCachedPath(sx, sz, ex, ez, now);
    if (cached) return cached;

    // Calculate heuristic using squared distance comparison but actual distance for h value
    const heuristicDistSq = (ex - sx) * (ex - sx) + (ez - sz) * (ez - sz);
    const startNode: PathNode = { x: sx, z: sz, g: 0, h: Math.sqrt(heuristicDistSq), parent: null };

    const open = new OpenList();
    open.insert(startNode);
    const closed = new Set<string>();
    const key = (x: number, z: number) => `${x},${z}`;

    while (open.length > 0) {
        const current = open.shift()!;
        const currentKey = key(current.x, current.z);

        if (current.x === ex && current.z === ez) {
            const path: { x: number; z: number }[] = [];
            let node: PathNode | null = current;
            while (node) {
                path.unshift({ x: node.x + 0.5, z: node.z + 0.5 });
                node = node.parent;
            }
            path[path.length - 1] = { x: endX, z: endZ };

            // Cache the result
            setCachedPath(sx, sz, ex, ez, path, now);
            return path;
        }

        closed.add(currentKey);

        // Get valid neighbors (handles bounds, blocking, and corner-cutting)
        const neighbors = getNeighbors(current.x, current.z, ASTAR_DIAGONAL_COST, flying);

        for (const n of neighbors) {
            const nKey = key(n.x, n.z);
            if (closed.has(nKey)) continue;

            const g = current.g + n.cost;
            const existing = open.get(n.x, n.z);
            if (existing) {
                if (g < existing.g) {
                    // O(1) lookup, then update
                    open.update(existing, g, current);
                }
            } else {
                // Calculate h using actual distance (needed for accurate pathfinding)
                const hdx = ex - n.x, hdz = ez - n.z;
                const newNode: PathNode = { x: n.x, z: n.z, g, h: Math.sqrt(hdx * hdx + hdz * hdz), parent: current };
                open.insert(newNode);
            }
        }
    }
    return null;
}
