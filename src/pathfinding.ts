import { GRID_SIZE, VISION_RADIUS } from "./constants";
import { blocked } from "./dungeon";
import type { PathNode, Unit, UnitGroup } from "./types";

// =============================================================================
// FOG OF WAR - Bresenham LOS, visibility states: 0=unseen, 1=seen, 2=visible
// =============================================================================

export function hasLineOfSight(x0: number, z0: number, x1: number, z1: number): boolean {
    // Bresenham's line - returns false if any blocked cell between start and end
    const dx = Math.abs(x1 - x0), dz = Math.abs(z1 - z0);
    const sx = x0 < x1 ? 1 : -1, sz = z0 < z1 ? 1 : -1;
    let err = dx - dz;
    let x = x0, z = z0;

    while (true) {
        if (x === x1 && z === z1) return true;
        if (blocked[x]?.[z] && !(x === x0 && z === z0)) return false;
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
    // Decay: visible (2) -> seen (1), seen stays seen
    for (let x = 0; x < GRID_SIZE; x++) {
        for (let z = 0; z < GRID_SIZE; z++) {
            if (visibility[x][z] === 2) visibility[x][z] = 1;
        }
    }

    // Mark cells visible from each player unit
    playerUnits.forEach((u: Unit) => {
        const g = unitsRef.current[u.id];
        if (!g || u.hp <= 0) return;
        const ux = Math.floor(g.position.x), uz = Math.floor(g.position.z);

        for (let dx = -VISION_RADIUS; dx <= VISION_RADIUS; dx++) {
            for (let dz = -VISION_RADIUS; dz <= VISION_RADIUS; dz++) {
                const x = ux + dx, z = uz + dz;
                if (x < 0 || x >= GRID_SIZE || z < 0 || z >= GRID_SIZE) continue;
                if (dx * dx + dz * dz > VISION_RADIUS * VISION_RADIUS) continue;
                if (hasLineOfSight(ux, uz, x, z)) visibility[x][z] = 2;
            }
        }
    });

    return visibility;
}

// =============================================================================
// A* PATHFINDING
// =============================================================================

export function findPath(startX: number, startZ: number, endX: number, endZ: number, depth: number = 0): { x: number; z: number }[] | null {
    // Prevent infinite recursion with depth limit
    if (depth > 3) return null;

    const sx = Math.floor(startX), sz = Math.floor(startZ);
    const ex = Math.floor(endX), ez = Math.floor(endZ);

    if (sx === ex && sz === ez) return [{ x: endX, z: endZ }];
    if (ex < 0 || ex >= GRID_SIZE || ez < 0 || ez >= GRID_SIZE) return null;

    // Target blocked - find nearest unblocked
    if (blocked[ex]?.[ez]) {
        let best: { x: number; z: number } | null = null, bestDist = Infinity;
        for (let dx = -2; dx <= 2; dx++) {
            for (let dz = -2; dz <= 2; dz++) {
                const nx = ex + dx, nz = ez + dz;
                if (nx >= 0 && nx < GRID_SIZE && nz >= 0 && nz < GRID_SIZE && !blocked[nx][nz]) {
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
        open.sort((a, b) => (a.g + a.h) - (b.g + b.h));
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

        const neighbors = [
            { x: current.x - 1, z: current.z, cost: 1 },
            { x: current.x + 1, z: current.z, cost: 1 },
            { x: current.x, z: current.z - 1, cost: 1 },
            { x: current.x, z: current.z + 1, cost: 1 },
            { x: current.x - 1, z: current.z - 1, cost: 1.41 },
            { x: current.x + 1, z: current.z - 1, cost: 1.41 },
            { x: current.x - 1, z: current.z + 1, cost: 1.41 },
            { x: current.x + 1, z: current.z + 1, cost: 1.41 },
        ];

        for (const n of neighbors) {
            if (n.x < 0 || n.x >= GRID_SIZE || n.z < 0 || n.z >= GRID_SIZE) continue;
            if (blocked[n.x][n.z]) continue;
            if (closed.has(key(n.x, n.z))) continue;
            // Diagonal: block if either adjacent cardinal is blocked (no corner cutting)
            if (n.cost > 1 && (blocked[current.x]?.[n.z] || blocked[n.x]?.[current.z])) continue;

            const g = current.g + n.cost;
            const existing = open.find(o => o.x === n.x && o.z === n.z);
            if (existing) {
                if (g < existing.g) { existing.g = g; existing.parent = current; }
            } else {
                open.push({ x: n.x, z: n.z, g, h: Math.hypot(ex - n.x, ez - n.z), parent: current });
            }
        }
    }
    return null;
}
