// =============================================================================
// PARTY FORMATION - Wedge formation with directional rotation
// =============================================================================

import { isPassable } from "../ai/pathfinding";

// =============================================================================
// FORMATION OFFSETS
// =============================================================================

/**
 * Local-space offsets for a wedge (arrow) formation.
 * x = lateral (negative = left), z = forward (positive = toward destination).
 * z=0 is the destination (click point), negative z = behind.
 *
 * Slot 0 = tip of wedge (Barbarian), expanding outward toward back.
 *
 *        [0]           <- tip (at destination)
 *      [1] [2]         <- second row
 *    [3] [4] [5]       <- back row
 */
const FORMATION_OFFSETS: { x: number; z: number }[] = [
    { x:  0.0,  z:  0.0 },  // tip (at destination)
    { x: -1.0,  z: -1.5 },  // second row left
    { x:  1.0,  z: -1.5 },  // second row right
    { x: -2.0,  z: -3.0 },  // back row left
    { x:  0.0,  z: -3.0 },  // back row center
    { x:  2.0,  z: -3.0 },  // back row right
];

// =============================================================================
// POSITION CALCULATION
// =============================================================================

/**
 * Compute formation positions centered on (centerX, centerZ) facing the given angle.
 * Returns up to `count` positions. If a position lands on a blocked cell, searches
 * nearby for a passable one.
 */
export function getFormationPositions(
    centerX: number,
    centerZ: number,
    facingAngle: number,
    count: number
): { x: number; z: number }[] {
    const cos = Math.cos(facingAngle);
    const sin = Math.sin(facingAngle);
    const positions: { x: number; z: number }[] = [];
    const usedCells = new Set<string>();

    for (let i = 0; i < count; i++) {
        const offset = FORMATION_OFFSETS[i % FORMATION_OFFSETS.length];
        // Project offset onto facing direction (z=forward) and perpendicular (x=lateral)
        // facing = (cos, sin), perpendicular-left = (-sin, cos)
        const worldX = centerX - offset.x * sin + offset.z * cos;
        const worldZ = centerZ + offset.x * cos + offset.z * sin;

        const cellX = Math.floor(worldX);
        const cellZ = Math.floor(worldZ);
        const cellKey = `${cellX},${cellZ}`;

        if (isPassable(cellX, cellZ) && !usedCells.has(cellKey)) {
            positions.push({ x: worldX, z: worldZ });
            usedCells.add(cellKey);
        } else {
            // Search nearby for passable cell
            const fallback = findNearbyPassable(cellX, cellZ, usedCells);
            if (fallback) {
                positions.push(fallback);
                usedCells.add(`${Math.floor(fallback.x)},${Math.floor(fallback.z)}`);
            } else {
                // Last resort: use center
                positions.push({ x: centerX, z: centerZ });
            }
        }
    }

    return positions;
}

/**
 * Search expanding radius for a passable cell.
 */
function findNearbyPassable(
    cellX: number,
    cellZ: number,
    usedCells: Set<string>
): { x: number; z: number } | null {
    for (let radius = 1; radius <= 5; radius++) {
        for (let dx = -radius; dx <= radius; dx++) {
            for (let dz = -radius; dz <= radius; dz++) {
                if (Math.abs(dx) !== radius && Math.abs(dz) !== radius) continue;
                const checkX = cellX + dx;
                const checkZ = cellZ + dz;
                const key = `${checkX},${checkZ}`;
                if (isPassable(checkX, checkZ) && !usedCells.has(key)) {
                    return { x: checkX + 0.5, z: checkZ + 0.5 };
                }
            }
        }
    }
    return null;
}

// =============================================================================
// SPAWN FORMATION (for area transitions)
// =============================================================================

/** Direction-to-angle mapping. The party faces INTO the new area (opposite of door direction). */
const DIRECTION_ANGLES: Record<string, number> = {
    north: Math.PI / 2,    // Door faces north → party entered from south, faces north (+Z)
    south: -Math.PI / 2,   // Door faces south → party entered from north, faces south (-Z)
    east: 0,               // Door faces east → party entered from west, faces east (+X)
    west: Math.PI,         // Door faces west → party entered from east, faces west (-X)
};

/**
 * Compute formation positions for area spawn, oriented by door direction.
 */
export function getFormationPositionsForSpawn(
    spawnX: number,
    spawnZ: number,
    direction: "north" | "south" | "east" | "west",
    count: number
): { x: number; z: number }[] {
    const angle = DIRECTION_ANGLES[direction] ?? 0;
    return getFormationPositions(spawnX, spawnZ, angle, count);
}

/**
 * Find passable spawn positions for multiple units around a spawn point.
 * Uses formation layout when a direction is provided (area transitions),
 * otherwise falls back to a simple grid pattern.
 */
export function findSpawnPositions(
    spawnX: number,
    spawnZ: number,
    count: number,
    direction?: "north" | "south" | "east" | "west"
): { x: number; z: number }[] {
    if (direction) {
        return getFormationPositionsForSpawn(spawnX, spawnZ, direction, count);
    }

    // Fallback: simple 3-wide grid (used for initial game load with no transition)
    const spacing = 1.5;
    const positions: { x: number; z: number }[] = [];
    const usedCells = new Set<string>();

    for (let i = 0; i < count; i++) {
        const idealX = spawnX + (i % 3) * spacing - spacing;
        const idealZ = spawnZ + Math.floor(i / 3) * spacing;

        let found = false;
        const cx = Math.floor(idealX);
        const cz = Math.floor(idealZ);
        const ck = `${cx},${cz}`;

        if (isPassable(cx, cz) && !usedCells.has(ck)) {
            positions.push({ x: idealX, z: idealZ });
            usedCells.add(ck);
            found = true;
        }

        if (!found) {
            for (let radius = 1; radius <= 5; radius++) {
                if (found) break;
                for (let dx = -radius; dx <= radius; dx++) {
                    if (found) break;
                    for (let dz = -radius; dz <= radius; dz++) {
                        if (Math.abs(dx) !== radius && Math.abs(dz) !== radius) continue;
                        const checkX = cx + dx;
                        const checkZ = cz + dz;
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

        if (!found) {
            positions.push({ x: spawnX, z: spawnZ });
        }
    }

    return positions;
}
