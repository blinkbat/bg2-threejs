import { VISION_RADIUS, PATH_RECURSION_LIMIT, ASTAR_BLOCKED_TARGET_SEARCH, ASTAR_DIAGONAL_COST } from "../core/constants";
import { blocked } from "../game/dungeon";
import { isTreeBlocked, isTerrainBlocked, isWaterTerrain } from "../game/areas";
import { isWithinGrid, distance } from "../game/geometry";
import type { PathNode, Unit, UnitGroup } from "../core/types";
import type { UnitSpatialFrame } from "./spatialCache";

// =============================================================================
// NUMERIC KEY HELPER — eliminates string allocation in hot paths
// =============================================================================
// Stride must exceed the maximum grid dimension. 1024 is safe for all maps.
const KEY_STRIDE = 1024;

/** Pack (x, z) into a single number for use as a Map/Set key. */
function cellKey(x: number, z: number): number {
    return x * KEY_STRIDE + z;
}

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
const dynamicCostMap: Map<number, number> = new Map();

// Track last unit positions to avoid recomputing when nothing moved
let lastUnitPositions: Map<number, number> = new Map();
let scratchUnitPositions: Map<number, number> = new Map();
let dynamicObstaclesDirty = true;
let hasDynamicSpatialSnapshot = false;
let lastDynamicSpatialHash = 0;
let lastDynamicSpatialCount = -1;

/**
 * Update the dynamic obstacle map based on current unit positions.
 * Call this once per frame before any pathfinding.
 * Uses dirty flag to skip computation when units haven't moved.
 */
export function updateDynamicObstacles(
    units: Unit[],
    unitsRef: Record<number, UnitGroup>,
    excludeUnitId?: number,
    spatialFrame?: UnitSpatialFrame
): void {
    if (spatialFrame && excludeUnitId === undefined) {
        const spatialUnchanged = hasDynamicSpatialSnapshot
            && spatialFrame.positionHash === lastDynamicSpatialHash
            && spatialFrame.aliveCount === lastDynamicSpatialCount;
        if (!dynamicObstaclesDirty && spatialUnchanged) {
            return;
        }

        hasDynamicSpatialSnapshot = true;
        lastDynamicSpatialHash = spatialFrame.positionHash;
        lastDynamicSpatialCount = spatialFrame.aliveCount;
        dynamicObstaclesDirty = false;
        dynamicCostMap.clear();

        for (const entry of spatialFrame.aliveEntries) {
            const centerX = entry.cellX;
            const centerZ = entry.cellZ;

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
                        const key = cellKey(x, z);
                        const existing = dynamicCostMap.get(key) || 0;
                        dynamicCostMap.set(key, Math.max(existing, cost));
                    }
                }
            }
        }

        return;
    }

    hasDynamicSpatialSnapshot = false;

    // Check if any unit has moved
    let needsUpdate = false;
    const newPositions = scratchUnitPositions;
    newPositions.clear();

    for (const unit of units) {
        if (unit.hp <= 0) continue;
        const g = unitsRef[unit.id];
        if (!g) continue;

        const posKey = cellKey(Math.floor(g.position.x), Math.floor(g.position.z));
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

    const previousPositions = lastUnitPositions;
    lastUnitPositions = newPositions;
    scratchUnitPositions = previousPositions;
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
                    const key = cellKey(x, z);
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
    scratchUnitPositions.clear();
    hasDynamicSpatialSnapshot = false;
    lastDynamicSpatialHash = 0;
    lastDynamicSpatialCount = -1;
}

/**
 * Get the extra traversal cost for a cell due to nearby units.
 */
function getDynamicCost(x: number, z: number): number {
    return dynamicCostMap.get(cellKey(x, z)) || 0;
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
 * - Flying units ignore terrain hazards.
 * - Water-bound units (e.g. kraken) can move only on water cells.
 */
export function isPassable(
    x: number,
    z: number,
    flying: boolean = false,
    canTraverseWaterTerrain: boolean = false
): boolean {
    if (!isWithinGrid(x, z) || isBlocked(x, z)) return false;
    // Kraken-like movement profile: constrained to water (terrain or floor water tiles).
    if (canTraverseWaterTerrain) return isWaterTerrain(x, z);
    // Flying units ignore terrain hazards
    if (flying) return true;
    if (!isTerrainBlocked(x, z)) return true;
    return false;
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

// =============================================================================
// FOG OF WAR - Bresenham LOS, visibility states: 0=unseen, 1=seen, 2=visible
// =============================================================================

const previousVisibleCells: number[] = [];
let visibilityTrackingDirty = true;

function seedPreviousVisibleCells(visibility: number[][]): void {
    previousVisibleCells.length = 0;
    for (let x = 0; x < visibility.length; x++) {
        for (let z = 0; z < (visibility[x]?.length ?? 0); z++) {
            if (visibility[x][z] === 2) {
                previousVisibleCells.push(cellKey(x, z));
            }
        }
    }
}

export function resetVisibilityTracking(): void {
    previousVisibleCells.length = 0;
    visibilityTrackingDirty = true;
}

/**
 * Decay all visible cells to seen state.
 */
function decayVisibility(visibility: number[][]): boolean {
    if (visibilityTrackingDirty) {
        seedPreviousVisibleCells(visibility);
        visibilityTrackingDirty = false;
    }

    if (previousVisibleCells.length === 0) {
        return false;
    }

    let changed = false;
    for (const key of previousVisibleCells) {
        const x = Math.floor(key / KEY_STRIDE);
        const z = key - x * KEY_STRIDE;
        if (visibility[x]?.[z] === 2) {
            visibility[x][z] = 1;
            changed = true;
        }
    }
    previousVisibleCells.length = 0;
    return changed;
}

/**
 * Mark cells visible from a unit's position using line of sight.
 * Returns true if any cell was newly set to visible.
 */
function markVisibleFromUnit(visibility: number[][], ux: number, uz: number): boolean {
    let changed = false;
    for (let dx = -VISION_RADIUS; dx <= VISION_RADIUS; dx++) {
        for (let dz = -VISION_RADIUS; dz <= VISION_RADIUS; dz++) {
            const x = ux + dx, z = uz + dz;
            if (!isWithinGrid(x, z)) continue;
            // Skip if outside vision circle
            if (dx * dx + dz * dz > VISION_RADIUS * VISION_RADIUS) continue;
            if (hasLineOfSight(ux, uz, x, z)) {
                if (visibility[x][z] !== 2) {
                    changed = true;
                    visibility[x][z] = 2;
                    previousVisibleCells.push(cellKey(x, z));
                }
            }
        }
    }
    return changed;
}

function hasLineOfSight(x0: number, z0: number, x1: number, z1: number): boolean {
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
): boolean {
    let changed = decayVisibility(visibility);

    // Mark cells visible from each player unit
    // Use Math.round to center visibility on the unit's visual position
    playerUnits.forEach((u: Unit) => {
        const g = unitsRef.current[u.id];
        if (!g || u.hp <= 0) return;
        const ux = Math.round(g.position.x), uz = Math.round(g.position.z);
        if (markVisibleFromUnit(visibility, ux, uz)) changed = true;
    });

    return changed;
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
 * Flying units can pass over terrain hazards.
 */
function collectNeighbors(
    x: number,
    z: number,
    diagonalCost: number,
    out: Neighbor[],
    flying: boolean = false,
    canTraverseWaterTerrain: boolean = false
): number {
    let count = 0;

    // Add cardinal neighbors
    for (const { dx, dz } of CARDINALS) {
        const nx = x + dx, nz = z + dz;
        if (isPassable(nx, nz, flying, canTraverseWaterTerrain)) {
            // Base cost + dynamic cost from nearby units
            const cost = 1 + getDynamicCost(nx, nz);
            const existing = out[count];
            if (existing) {
                existing.x = nx;
                existing.z = nz;
                existing.cost = cost;
            } else {
                out[count] = { x: nx, z: nz, cost };
            }
            count++;
        }
    }

    // Add diagonal neighbors (with corner-cutting prevention)
    for (const { dx, dz } of DIAGONALS) {
        const nx = x + dx, nz = z + dz;
        if (!isPassable(nx, nz, flying, canTraverseWaterTerrain)) continue;

        // Block diagonal if either adjacent cardinal is blocked (no corner cutting)
        if (isBlocked(x, nz) || isBlocked(nx, z)) continue;

        // Base diagonal cost + dynamic cost from nearby units
        const cost = diagonalCost + getDynamicCost(nx, nz);
        const existing = out[count];
        if (existing) {
            existing.x = nx;
            existing.z = nz;
            existing.cost = cost;
        } else {
            out[count] = { x: nx, z: nz, cost };
        }
        count++;
    }

    return count;
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

const pathCache: Map<number, CachedPath> = new Map();

function getPathCacheKey(
    sx: number,
    sz: number,
    ex: number,
    ez: number,
    flying: boolean,
    canTraverseWaterTerrain: boolean
): number {
    // Pack 4 coordinates and movement mode into a single number.
    const packed = ((sx * KEY_STRIDE + sz) * KEY_STRIDE + ex) * KEY_STRIDE + ez;
    return packed * 4 + (flying ? 1 : 0) + (canTraverseWaterTerrain ? 2 : 0);
}

function getCachedPath(
    sx: number,
    sz: number,
    ex: number,
    ez: number,
    now: number,
    flying: boolean,
    canTraverseWaterTerrain: boolean
): { x: number; z: number }[] | null {
    const key = getPathCacheKey(sx, sz, ex, ez, flying, canTraverseWaterTerrain);
    const cached = pathCache.get(key);
    if (cached && now - cached.timestamp < PATH_CACHE_DURATION) {
        // Return a shallow copy so callers can mutate array shape without touching cache.
        return cached.path.slice();
    }
    return null;
}

function setCachedPath(
    sx: number,
    sz: number,
    ex: number,
    ez: number,
    path: { x: number; z: number }[],
    now: number,
    flying: boolean,
    canTraverseWaterTerrain: boolean
): void {
    // Prune old entries if cache is too large
    if (pathCache.size >= PATH_CACHE_MAX_SIZE) {
        const oldestKey = pathCache.keys().next().value;
        if (oldestKey) pathCache.delete(oldestKey);
    }

    const key = getPathCacheKey(sx, sz, ex, ez, flying, canTraverseWaterTerrain);
    pathCache.set(key, { path: path.slice(), timestamp: now });
}

/**
 * Clear path cache (call on area change or major obstacle updates).
 */
export function clearPathCache(): void {
    pathCache.clear();
}

// =============================================================================
// OPTIMIZED OPEN LIST - Binary min-heap with O(1) lookup
// =============================================================================

/**
 * Binary min-heap ordered by f-score with O(1) has/get via indexMap.
 * insert/shift/update are all O(log n) instead of O(n).
 */
class OpenList {
    private nodes: PathNode[] = [];
    private indexMap: Map<number, number> = new Map();

    get length(): number {
        return this.nodes.length;
    }

    private swap(i: number, j: number): void {
        const a = this.nodes[i], b = this.nodes[j];
        this.nodes[i] = b;
        this.nodes[j] = a;
        this.indexMap.set(cellKey(b.x, b.z), i);
        this.indexMap.set(cellKey(a.x, a.z), j);
    }

    private bubbleUp(idx: number): void {
        while (idx > 0) {
            const parent = (idx - 1) >> 1;
            if (this.nodes[idx].g + this.nodes[idx].h < this.nodes[parent].g + this.nodes[parent].h) {
                this.swap(idx, parent);
                idx = parent;
            } else {
                break;
            }
        }
    }

    private bubbleDown(idx: number): void {
        const n = this.nodes.length;
        while (true) {
            let smallest = idx;
            const left = 2 * idx + 1;
            const right = 2 * idx + 2;
            if (left < n && this.nodes[left].g + this.nodes[left].h < this.nodes[smallest].g + this.nodes[smallest].h) {
                smallest = left;
            }
            if (right < n && this.nodes[right].g + this.nodes[right].h < this.nodes[smallest].g + this.nodes[smallest].h) {
                smallest = right;
            }
            if (smallest !== idx) {
                this.swap(idx, smallest);
                idx = smallest;
            } else {
                break;
            }
        }
    }

    insert(node: PathNode): void {
        const idx = this.nodes.length;
        this.nodes.push(node);
        this.indexMap.set(cellKey(node.x, node.z), idx);
        this.bubbleUp(idx);
    }

    shift(): PathNode | undefined {
        if (this.nodes.length === 0) return undefined;
        const min = this.nodes[0];
        this.indexMap.delete(cellKey(min.x, min.z));

        const last = this.nodes.pop()!;
        if (this.nodes.length > 0) {
            this.nodes[0] = last;
            this.indexMap.set(cellKey(last.x, last.z), 0);
            this.bubbleDown(0);
        }
        return min;
    }

    get(x: number, z: number): PathNode | undefined {
        const idx = this.indexMap.get(cellKey(x, z));
        return idx !== undefined ? this.nodes[idx] : undefined;
    }

    has(x: number, z: number): boolean {
        return this.indexMap.has(cellKey(x, z));
    }

    update(node: PathNode, newG: number, newParent: PathNode): void {
        const k = cellKey(node.x, node.z);
        const idx = this.indexMap.get(k);
        if (idx === undefined) return;

        node.g = newG;
        node.parent = newParent;
        // g decreased → f decreased → bubble up
        this.bubbleUp(idx);
    }
}

export function findPath(
    startX: number,
    startZ: number,
    endX: number,
    endZ: number,
    depth: number = 0,
    flying: boolean = false,
    canTraverseWaterTerrain: boolean = false
): { x: number; z: number }[] | null {
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
                if (isPassable(nx, nz, flying, canTraverseWaterTerrain)) {
                    const dSq = dx * dx + dz * dz;
                    if (dSq < bestDistSq) { bestDistSq = dSq; best = { x: nx, z: nz }; }
                }
            }
        }
        if (best) return findPath(startX, startZ, best.x + 0.5, best.z + 0.5, depth + 1, flying, canTraverseWaterTerrain);
        return null;
    }

    // Check cache first
    const now = Date.now();
    const cached = getCachedPath(sx, sz, ex, ez, now, flying, canTraverseWaterTerrain);
    if (cached) return cached;

    // Calculate heuristic using squared distance comparison but actual distance for h value
    const heuristicDistSq = (ex - sx) * (ex - sx) + (ez - sz) * (ez - sz);
    const startNode: PathNode = { x: sx, z: sz, g: 0, h: Math.sqrt(heuristicDistSq), parent: null };

    const open = new OpenList();
    open.insert(startNode);
    const closed = new Set<number>();
    const neighborsBuffer: Neighbor[] = [];

    while (open.length > 0) {
        const current = open.shift()!;

        if (current.x === ex && current.z === ez) {
            const path: { x: number; z: number }[] = [];
            let node: PathNode | null = current;
            while (node) {
                path.push({ x: node.x + 0.5, z: node.z + 0.5 });
                node = node.parent;
            }
            path.reverse();
            path[path.length - 1] = { x: endX, z: endZ };

            // Cache the result
            setCachedPath(sx, sz, ex, ez, path, now, flying, canTraverseWaterTerrain);
            return path;
        }

        closed.add(cellKey(current.x, current.z));

        // Get valid neighbors (handles bounds, blocking, and corner-cutting)
        const neighborCount = collectNeighbors(
            current.x,
            current.z,
            ASTAR_DIAGONAL_COST,
            neighborsBuffer,
            flying,
            canTraverseWaterTerrain
        );

        for (let i = 0; i < neighborCount; i++) {
            const n = neighborsBuffer[i];
            if (closed.has(cellKey(n.x, n.z))) continue;

            const g = current.g + n.cost;
            const existing = open.get(n.x, n.z);
            if (existing) {
                if (g < existing.g) {
                    // O(1) lookup, then update
                    open.update(existing, g, current);
                }
            } else {
                // Calculate h using actual distance (needed for accurate pathfinding)
                const newNode: PathNode = { x: n.x, z: n.z, g, h: distance(n.x, n.z, ex, ez), parent: current };
                open.insert(newNode);
            }
        }
    }
    return null;
}

