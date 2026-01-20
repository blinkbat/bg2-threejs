// =============================================================================
// AREA SYSTEM - Multi-area support with transitions
// =============================================================================

import { GRID_SIZE } from "../core/constants";
import type { Room, CandlePosition, MergedObstacle, EnemyType } from "../core/types";

// =============================================================================
// TYPES
// =============================================================================

export type AreaId = "dungeon" | "field";

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
 */
function generateCandles(rooms: Room[], blocked: boolean[][], gridSize: number): CandlePosition[] {
    const candles: CandlePosition[] = [];

    rooms.forEach(r => {
        const midX = r.x + Math.floor(r.w / 2);
        const midZ = r.z + Math.floor(r.h / 2);

        // South wall
        const sWallZ = r.z - 1;
        if (sWallZ >= 0 && blocked[midX]?.[sWallZ]) {
            candles.push({ x: midX + 0.5, z: sWallZ + 0.85, dx: 0, dz: 1 });
        }
        // North wall
        const nWallZ = r.z + r.h;
        if (nWallZ < gridSize && blocked[midX]?.[nWallZ]) {
            candles.push({ x: midX + 0.5, z: nWallZ + 0.15, dx: 0, dz: -1 });
        }
        // West wall
        const wWallX = r.x - 1;
        if (wWallX >= 0 && blocked[wWallX]?.[midZ]) {
            candles.push({ x: wWallX + 0.85, z: midZ + 0.5, dx: 1, dz: 0 });
        }
        // East wall
        const eWallX = r.x + r.w;
        if (eWallX < gridSize && blocked[eWallX]?.[midZ]) {
            candles.push({ x: eWallX + 0.15, z: midZ + 0.5, dx: -1, dz: 0 });
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

    // Merge obstacles
    const mergedObstacles = mergeObstacles(blocked, area.gridSize);

    return { blocked, mergedObstacles, candlePositions };
}

// =============================================================================
// AREA DEFINITIONS
// =============================================================================

export const DUNGEON_AREA: AreaData = {
    id: "dungeon",
    name: "Dungeon",
    gridSize: GRID_SIZE,
    backgroundColor: "#0d1117",
    groundColor: "#0a0a10",
    ambientLight: 0.08,
    directionalLight: 0.15,
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
        { x1: 12, z1: 3, x2: 18, z2: 10 },     // A to F
        { x1: 27, z1: 3, x2: 36, z2: 10 },     // F to C
        { x1: 3, z1: 12, x2: 10, z2: 18 },     // A to G
        { x1: 3, z1: 27, x2: 10, z2: 36 },     // G to B
        { x1: 10, z1: 20, x2: 16, z2: 27 },    // G to E
        { x1: 31, z1: 20, x2: 38, z2: 27 },    // E to H
        { x1: 40, z1: 12, x2: 47, z2: 18 },    // C to H
        { x1: 40, z1: 27, x2: 47, z2: 36 },    // H to D
        { x1: 20, z1: 10, x2: 27, z2: 16 },    // F to E
        { x1: 20, z1: 31, x2: 27, z2: 38 },    // E to I
        { x1: 10, z1: 40, x2: 18, z2: 47 },    // B to I
        { x1: 27, z1: 40, x2: 36, z2: 47 },    // I to D
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
            targetArea: "field",
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
    id: "field",
    name: "Green Fields",
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
    enemySpawns: [],  // No enemies for now
    transitions: [
        // Door on north edge, leads back to dungeon
        {
            x: 23, z: 49, w: 5, h: 1,
            targetArea: "dungeon",
            targetSpawn: { x: 6.5, z: 2 },  // Starting room (south side)
            direction: "north"
        }
    ],
    chests: [],
    trees: [
        // Scattered trees around the field
        { x: 8, z: 8, size: 1.2 },
        { x: 12, z: 15, size: 0.8 },
        { x: 5, z: 25, size: 1.0 },
        { x: 10, z: 35, size: 1.4 },
        { x: 15, z: 42, size: 0.7 },
        { x: 35, z: 10, size: 1.1 },
        { x: 40, z: 18, size: 0.9 },
        { x: 38, z: 30, size: 1.3 },
        { x: 42, z: 40, size: 0.6 },
        { x: 30, z: 8, size: 1.0 },
        { x: 18, z: 20, size: 0.8 },
        { x: 32, z: 35, size: 1.5 },
        { x: 8, z: 42, size: 1.0 },
        { x: 45, z: 25, size: 0.9 },
        { x: 20, z: 12, size: 1.1 },
    ]
};

// Registry of all areas
export const AREAS: Record<AreaId, AreaData> = {
    dungeon: DUNGEON_AREA,
    field: FIELD_AREA
};

// =============================================================================
// AREA STATE MANAGEMENT
// =============================================================================

let currentAreaId: AreaId = "dungeon";
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
    return currentAreaComputed;
}

export function getBlocked(): boolean[][] {
    return getComputedAreaData().blocked;
}
