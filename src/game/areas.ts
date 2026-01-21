// =============================================================================
// AREA SYSTEM - Multi-area support with transitions
// =============================================================================

import { GRID_SIZE } from "../core/constants";
import type { Room, CandlePosition, MergedObstacle, EnemyType } from "../core/types";
import { clearPathCache, invalidateDynamicObstacles } from "../ai/pathfinding";

// =============================================================================
// TYPES
// =============================================================================

export type AreaId = "dungeon" | "forest" | "coast";

export interface RoomFloor {
    x: number;
    z: number;
    w: number;
    h: number;
    color: string;
}

export interface EnemySpawn {
    x: number;
    z: number;
    type: EnemyType;
}

export interface AreaTransition {
    x: number;
    z: number;
    w: number;
    h: number;
    targetArea: AreaId;
    targetSpawn: { x: number; z: number };  // Where party spawns in target area
    direction: "north" | "south" | "east" | "west";  // Which way door faces
}

export interface ChestLocation {
    x: number;
    z: number;
}

export interface TreeLocation {
    x: number;
    z: number;
    size: number;  // Scale multiplier (0.5 = small, 1 = medium, 1.5 = large)
}

export interface AreaData {
    id: AreaId;
    name: string;
    flavor: string;              // Short atmospheric description
    gridSize: number;
    backgroundColor: string;
    groundColor: string;
    rooms: Room[];
    hallways: { x1: number; z1: number; x2: number; z2: number }[];
    roomFloors: RoomFloor[];
    enemySpawns: EnemySpawn[];
    transitions: AreaTransition[];
    chests: ChestLocation[];
    trees: TreeLocation[];
    ambientLight: number;        // Ambient light intensity
    directionalLight: number;    // Directional light intensity
    hasFogOfWar: boolean;
}

export interface ComputedAreaData {
    blocked: boolean[][];
    mergedObstacles: MergedObstacle[];
    candlePositions: CandlePosition[];
    treeBlocked: Set<string>;  // Set of "x,z" keys for tree-blocked cells (for LOS)
}

// =============================================================================
// AREA GENERATION FUNCTIONS
// =============================================================================

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

    // Generate candles only for dungeon-like areas
    const candlePositions = area.id === "dungeon"
        ? generateCandles(area.rooms, blocked, area.gridSize)
        : [];

    // Merge obstacles BEFORE blocking trees (so trees don't become walls)
    const mergedObstacles = mergeObstacles(blocked, area.gridSize);

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

    return { blocked, mergedObstacles, candlePositions, treeBlocked };
}

// =============================================================================
// AREA DEFINITIONS
// =============================================================================

export const DUNGEON_AREA: AreaData = {
    id: "dungeon",
    name: "Kobold Warrens",
    flavor: "The stench of vermin hangs heavy in the air.",
    gridSize: GRID_SIZE,
    backgroundColor: "#050508",
    groundColor: "#0a0a10",
    ambientLight: 0.15,
    directionalLight: 0.25,
    hasFogOfWar: true,
    rooms: [
        { x: 1, z: 1, w: 12, h: 12 },      // Room A - player spawn (SW)
        { x: 1, z: 36, w: 12, h: 12 },     // Room B - NW
        { x: 36, z: 1, w: 12, h: 12 },     // Room C - SE
        { x: 36, z: 36, w: 12, h: 12 },    // Room D - kobold lair (NE)
        { x: 16, z: 16, w: 16, h: 16 },    // Room E - central great hall (bigger)
        { x: 18, z: 1, w: 10, h: 10 },     // Room F - S middle
        { x: 1, z: 18, w: 10, h: 10 },     // Room G - W middle
        { x: 38, z: 18, w: 10, h: 10 },    // Room H - E middle
        { x: 18, z: 38, w: 10, h: 10 },    // Room I - N middle
    ],
    hallways: [
        // Tighter, longer hallways (width of 2-3 cells)
        { x1: 13, z1: 5, x2: 18, z2: 7 },      // A to F (horizontal, tight)
        { x1: 28, z1: 5, x2: 36, z2: 7 },      // F to C (horizontal, tight)
        { x1: 5, z1: 13, x2: 7, z2: 18 },      // A to G (vertical, tight)
        { x1: 5, z1: 28, x2: 7, z2: 36 },      // G to B (vertical, tight)
        { x1: 11, z1: 22, x2: 16, z2: 24 },    // G to E (horizontal, tight)
        { x1: 32, z1: 22, x2: 38, z2: 24 },    // E to H (horizontal, tight)
        { x1: 42, z1: 13, x2: 44, z2: 18 },    // C to H (vertical, tight)
        { x1: 42, z1: 28, x2: 44, z2: 36 },    // H to D (vertical, tight)
        { x1: 22, z1: 11, x2: 24, z2: 16 },    // F to E (vertical, tight)
        { x1: 22, z1: 32, x2: 24, z2: 38 },    // E to I (vertical, tight)
        { x1: 13, z1: 42, x2: 18, z2: 44 },    // B to I (horizontal, tight)
        { x1: 28, z1: 42, x2: 36, z2: 44 },    // I to D (horizontal, tight)
    ],
    roomFloors: [
        { x: 1, z: 1, w: 12, h: 12, color: "#1a1a1a" },
        { x: 1, z: 36, w: 12, h: 12, color: "#1a1a2a" },
        { x: 36, z: 1, w: 12, h: 12, color: "#2a1a1a" },
        { x: 36, z: 36, w: 12, h: 12, color: "#2a1a2a" },
        { x: 16, z: 16, w: 16, h: 16, color: "#1a2020" },
        { x: 18, z: 1, w: 10, h: 10, color: "#20201a" },
        { x: 1, z: 18, w: 10, h: 10, color: "#1a201a" },
        { x: 38, z: 18, w: 10, h: 10, color: "#201a20" },
        { x: 18, z: 38, w: 10, h: 10, color: "#1a1a20" },
    ],
    enemySpawns: [
        // Room D - kobold lair (NE corner) - 4 kobolds
        { x: 40.5, z: 40.5, type: "kobold" },
        { x: 43.5, z: 40.5, type: "kobold" },
        { x: 40.5, z: 43.5, type: "kobold" },
        { x: 43.5, z: 43.5, type: "kobold" },
        // Room E - central great hall - 3 kobolds
        { x: 20.5, z: 20.5, type: "kobold" },
        { x: 27.5, z: 20.5, type: "kobold" },
        { x: 27.5, z: 27.5, type: "kobold" },
        // Room B - NW - 2 kobolds
        { x: 5.5, z: 40.5, type: "kobold" },
        { x: 8.5, z: 40.5, type: "kobold" },
        // Room C - SE - 3 kobolds
        { x: 40.5, z: 5.5, type: "kobold" },
        { x: 43.5, z: 5.5, type: "kobold" },
        { x: 42.5, z: 8.5, type: "kobold" },
        // Room F - S middle - 2 kobolds
        { x: 22.5, z: 5.5, type: "kobold" },
        { x: 24.5, z: 5.5, type: "kobold" },
        // Room G - W middle - 1 kobold
        { x: 5.5, z: 22.5, type: "kobold" },
        // Room H - E middle - 1 kobold
        { x: 43.5, z: 22.5, type: "kobold" },
        // Room I - N middle - 2 kobolds
        { x: 22.5, z: 43.5, type: "kobold" },
        { x: 24.5, z: 43.5, type: "kobold" },
        // Kobold Archers
        { x: 5.5, z: 25.5, type: "kobold_archer" },
        { x: 43.5, z: 25.5, type: "kobold_archer" },
        { x: 5.5, z: 44.5, type: "kobold_archer" },
        { x: 44.5, z: 8.5, type: "kobold_archer" },
        // Witch Doctors
        { x: 24.5, z: 28.5, type: "kobold_witch_doctor" },
        { x: 8.5, z: 43.5, type: "kobold_witch_doctor" },
        { x: 43.5, z: 8.5, type: "kobold_witch_doctor" },
        // Ogre
        { x: 24.5, z: 24.5, type: "ogre" },
    ],
    transitions: [
        // Door on south wall of starting room (Room A), leads to field
        {
            x: 5, z: 0, w: 3, h: 1,
            targetArea: "forest",
            targetSpawn: { x: 25, z: 47 },  // North side of field (top of diamond)
            direction: "south"
        }
    ],
    chests: [
        { x: 28.5, z: 28.5 }  // In ogre room
    ],
    trees: []  // No trees in dungeon
};

export const FIELD_AREA: AreaData = {
    id: "forest",
    name: "Whispering Woods",
    flavor: "Something skitters in the shadows between the trees.",
    gridSize: GRID_SIZE,
    backgroundColor: "#87CEEB",  // Sky blue
    groundColor: "#228B22",      // Forest green
    ambientLight: 0.5,           // Bright outdoor lighting
    directionalLight: 0.8,
    hasFogOfWar: true,            // Fog of war like dungeon
    rooms: [
        // Single large open area
        { x: 1, z: 1, w: 48, h: 48 }
    ],
    hallways: [],  // No hallways - open field
    roomFloors: [
        // Main grass floor
        { x: 1, z: 1, w: 48, h: 48, color: "#2d5a27" }
    ],
    enemySpawns: [
        // Brood Mothers scattered in the forest
        { x: 8, z: 10, type: "brood_mother" },     // NW area near trees
        { x: 38, z: 12, type: "brood_mother" },    // NE area near trees
        { x: 10, z: 38, type: "brood_mother" },    // SW area near trees
        { x: 40, z: 40, type: "brood_mother" },    // SE area near trees
    ],
    transitions: [
        // Door on north edge, leads back to dungeon
        {
            x: 23, z: 49, w: 5, h: 1,
            targetArea: "dungeon",
            targetSpawn: { x: 6.5, z: 2 },
            direction: "north"
        },
        // South edge leads to coast
        {
            x: 23, z: 0, w: 5, h: 1,
            targetArea: "coast",
            targetSpawn: { x: 25, z: 47 },
            direction: "south"
        }
    ],
    chests: [],
    trees: [
        // Dense forest scattered around the field
        // Northwest cluster
        { x: 5, z: 5, size: 1.3 },
        { x: 8, z: 8, size: 1.2 },
        { x: 4, z: 10, size: 1.0 },
        { x: 10, z: 6, size: 0.9 },
        { x: 7, z: 12, size: 1.1 },
        { x: 12, z: 10, size: 0.8 },
        // West side
        { x: 3, z: 18, size: 1.2 },
        { x: 6, z: 22, size: 1.0 },
        { x: 5, z: 28, size: 1.4 },
        { x: 8, z: 32, size: 0.9 },
        { x: 4, z: 36, size: 1.1 },
        { x: 7, z: 40, size: 1.3 },
        // Southwest cluster
        { x: 10, z: 38, size: 1.0 },
        { x: 12, z: 42, size: 1.2 },
        { x: 15, z: 40, size: 0.8 },
        { x: 8, z: 44, size: 1.1 },
        // North side (away from door at z:47-49)
        { x: 12, z: 15, size: 0.8 },
        { x: 16, z: 12, size: 1.0 },
        { x: 20, z: 10, size: 1.2 },
        { x: 30, z: 8, size: 1.0 },
        { x: 35, z: 10, size: 1.1 },
        { x: 38, z: 6, size: 0.9 },
        // Northeast cluster
        { x: 42, z: 5, size: 1.3 },
        { x: 45, z: 8, size: 1.0 },
        { x: 44, z: 12, size: 1.1 },
        { x: 40, z: 10, size: 0.8 },
        // East side
        { x: 44, z: 18, size: 0.9 },
        { x: 46, z: 22, size: 1.2 },
        { x: 43, z: 26, size: 1.0 },
        { x: 45, z: 32, size: 1.1 },
        { x: 44, z: 38, size: 0.8 },
        { x: 42, z: 42, size: 1.3 },
        // Southeast cluster
        { x: 38, z: 40, size: 1.0 },
        { x: 40, z: 44, size: 0.9 },
        { x: 36, z: 42, size: 1.2 },
        // Center-ish trees (sparser for gameplay)
        { x: 18, z: 20, size: 0.8 },
        { x: 24, z: 18, size: 1.0 },
        { x: 32, z: 22, size: 1.1 },
        { x: 28, z: 28, size: 0.9 },
        { x: 20, z: 32, size: 1.0 },
        { x: 34, z: 34, size: 1.2 },
        // South side (sparse near door area)
        { x: 14, z: 46, size: 0.7 },
        { x: 34, z: 46, size: 0.8 },
        // GIANT TREES - ancient forest sentinels
        { x: 6, z: 15, size: 2.5 },    // West side giant
        { x: 42, z: 28, size: 2.8 },   // East side giant
        { x: 15, z: 35, size: 2.3 },   // Southwest giant
        { x: 38, z: 15, size: 2.6 },   // Northeast giant
        { x: 25, z: 25, size: 3.0 },   // Center giant - the biggest
    ]
};

export const COAST_AREA: AreaData = {
    id: "coast",
    name: "The Coast",
    flavor: "Salt air fills your lungs as waves crash against the shore.",
    gridSize: GRID_SIZE,
    backgroundColor: "#87CEEB",  // Sky blue
    groundColor: "#c2b280",      // Sandy tan
    ambientLight: 0.6,
    directionalLight: 0.9,
    hasFogOfWar: true,
    rooms: [
        // Full area - water is visual only (no walls)
        { x: 1, z: 1, w: 48, h: 48 }
    ],
    hallways: [],
    roomFloors: [
        // Sandy beach - gradient from dry to wet sand
        { x: 1, z: 40, w: 48, h: 9, color: "#d4c4a8" },   // Dry sand (north)
        { x: 1, z: 32, w: 48, h: 8, color: "#c2b280" },   // Mid sand
        { x: 1, z: 25, w: 48, h: 7, color: "#a89968" },   // Wet sand (near water)
        // Shoreline visual (not walkable - just for color reference)
        { x: 1, z: 20, w: 48, h: 5, color: "#5f9ea0" },   // Shallow water
        { x: 1, z: 1, w: 48, h: 19, color: "#4682b4" }    // Deep water
    ],
    enemySpawns: [],  // No enemies for now
    transitions: [
        // North edge leads back to forest
        {
            x: 23, z: 49, w: 5, h: 1,
            targetArea: "forest",
            targetSpawn: { x: 25, z: 2 },
            direction: "north"
        }
    ],
    chests: [],
    trees: [
        // Palm trees scattered along the beach
        { x: 5, z: 42, size: 1.2 },
        { x: 12, z: 44, size: 1.0 },
        { x: 18, z: 41, size: 1.3 },
        { x: 32, z: 43, size: 1.1 },
        { x: 40, z: 42, size: 1.2 },
        { x: 46, z: 45, size: 0.9 },
        // A few near the water
        { x: 8, z: 28, size: 1.0 },
        { x: 25, z: 30, size: 1.4 },
        { x: 42, z: 29, size: 1.1 },
    ]
};

// Registry of all areas
export const AREAS: Record<AreaId, AreaData> = {
    dungeon: DUNGEON_AREA,
    forest: FIELD_AREA,
    coast: COAST_AREA
};

// =============================================================================
// AREA STATE MANAGEMENT
// =============================================================================

let currentAreaId: AreaId = "coast";
let currentAreaComputed: ComputedAreaData | null = null;

export function getCurrentAreaId(): AreaId {
    return currentAreaId;
}

export function getCurrentArea(): AreaData {
    return AREAS[currentAreaId];
}

export function getComputedAreaData(): ComputedAreaData {
    if (!currentAreaComputed) {
        currentAreaComputed = computeAreaData(getCurrentArea());
    }
    return currentAreaComputed;
}

export function setCurrentArea(areaId: AreaId): ComputedAreaData {
    currentAreaId = areaId;
    currentAreaComputed = computeAreaData(AREAS[areaId]);
    // Invalidate pathfinding caches when changing areas
    clearPathCache();
    invalidateDynamicObstacles();
    return currentAreaComputed;
}

export function getBlocked(): boolean[][] {
    return getComputedAreaData().blocked;
}

export function isTreeBlocked(x: number, z: number): boolean {
    return getComputedAreaData().treeBlocked.has(`${x},${z}`);
}
