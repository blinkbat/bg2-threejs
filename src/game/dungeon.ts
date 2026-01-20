import { GRID_SIZE } from "../core/constants";
import type { Room, CandlePosition, MergedObstacle } from "../core/types";

// =============================================================================
// DUNGEON GENERATION - carve rooms/hallways from solid, then merge walls
// =============================================================================

export const blocked: boolean[][] = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(true));

const carve = (x1: number, z1: number, x2: number, z2: number): void => {
    for (let x = x1; x <= x2; x++) {
        for (let z = z1; z <= z2; z++) {
            if (x >= 0 && x < GRID_SIZE && z >= 0 && z < GRID_SIZE) blocked[x][z] = false;
        }
    }
};

// Rooms - larger rooms with wider hallways
export const rooms: Room[] = [
    { x: 1, z: 1, w: 12, h: 12 },      // Room A - player spawn (SW)
    { x: 1, z: 36, w: 12, h: 12 },     // Room B - NW
    { x: 36, z: 1, w: 12, h: 12 },     // Room C - SE
    { x: 36, z: 36, w: 12, h: 12 },    // Room D - kobold lair (NE)
    { x: 16, z: 16, w: 16, h: 16 },    // Room E - central great hall (bigger)
    { x: 18, z: 1, w: 10, h: 10 },     // Room F - S middle
    { x: 1, z: 18, w: 10, h: 10 },     // Room G - W middle
    { x: 38, z: 18, w: 10, h: 10 },    // Room H - E middle
    { x: 18, z: 38, w: 10, h: 10 },    // Room I - N middle
];

// Carve rooms
rooms.forEach(r => carve(r.x, r.z, r.x + r.w - 1, r.z + r.h - 1));

// Hallways (7-8 wide) - wider corridors connecting rooms
carve(12, 3, 18, 10);     // A to F
carve(27, 3, 36, 10);     // F to C
carve(3, 12, 10, 18);     // A to G
carve(3, 27, 10, 36);     // G to B
carve(10, 20, 16, 27);    // G to E
carve(31, 20, 38, 27);    // E to H
carve(40, 12, 47, 18);    // C to H
carve(40, 27, 47, 36);    // H to D
carve(20, 10, 27, 16);    // F to E
carve(20, 31, 27, 38);    // E to I
carve(10, 40, 18, 47);    // B to I
carve(27, 40, 36, 47);    // I to D

// Wall sconces - find wall cells adjacent to rooms, place sconce facing into room
export const candlePositions: CandlePosition[] = [];
rooms.forEach(r => {
    const midX = r.x + Math.floor(r.w / 2);
    const midZ = r.z + Math.floor(r.h / 2);
    const isOgreRoom = r.x === 19 && r.z === 19; // Room E - central great hall

    // South wall (wall cell just south of room)
    const sWallZ = r.z - 1;
    if (sWallZ >= 0 && blocked[midX]?.[sWallZ]) {
        candlePositions.push({ x: midX + 0.5, z: sWallZ + 0.85, dx: 0, dz: 1 });
    }
    // North wall
    const nWallZ = r.z + r.h;
    if (nWallZ < GRID_SIZE && blocked[midX]?.[nWallZ]) {
        candlePositions.push({ x: midX + 0.5, z: nWallZ + 0.15, dx: 0, dz: -1 });
    }
    // West wall
    const wWallX = r.x - 1;
    if (wWallX >= 0 && blocked[wWallX]?.[midZ]) {
        candlePositions.push({ x: wWallX + 0.85, z: midZ + 0.5, dx: 1, dz: 0 });
    }
    // East wall
    const eWallX = r.x + r.w;
    if (eWallX < GRID_SIZE && blocked[eWallX]?.[midZ]) {
        candlePositions.push({ x: eWallX + 0.15, z: midZ + 0.5, dx: -1, dz: 0 });
    }

    // Extra candles for ogre room (corners)
    if (isOgreRoom) {
        // SW corner
        if (blocked[r.x - 1]?.[r.z]) {
            candlePositions.push({ x: r.x - 0.15, z: r.z + 0.5, dx: 1, dz: 0 });
        }
        // SE corner
        if (blocked[r.x + r.w]?.[r.z]) {
            candlePositions.push({ x: r.x + r.w + 0.15, z: r.z + 0.5, dx: -1, dz: 0 });
        }
        // NW corner
        if (blocked[r.x - 1]?.[r.z + r.h - 1]) {
            candlePositions.push({ x: r.x - 0.15, z: r.z + r.h - 0.5, dx: 1, dz: 0 });
        }
        // NE corner
        if (blocked[r.x + r.w]?.[r.z + r.h - 1]) {
            candlePositions.push({ x: r.x + r.w + 0.15, z: r.z + r.h - 0.5, dx: -1, dz: 0 });
        }
    }
});

// Merge adjacent blocked cells into larger meshes (reduces draw calls significantly)
export const mergedObstacles: MergedObstacle[] = [];
const used = new Set<string>();
for (let x = 0; x < GRID_SIZE; x++) {
    for (let z = 0; z < GRID_SIZE; z++) {
        if (!blocked[x][z] || used.has(`${x},${z}`)) continue;
        let w = 1, h = 1;
        while (x + w < GRID_SIZE && blocked[x + w][z] && !used.has(`${x + w},${z}`)) w++;
        outer: while (z + h < GRID_SIZE) {
            for (let dx = 0; dx < w; dx++) {
                if (!blocked[x + dx][z + h] || used.has(`${x + dx},${z + h}`)) break outer;
            }
            h++;
        }
        for (let dx = 0; dx < w; dx++) {
            for (let dz = 0; dz < h; dz++) {
                used.add(`${x + dx},${z + dz}`);
            }
        }
        mergedObstacles.push({ x, z, w, h });
    }
}

// Room floor colors for rendering
export const roomFloors = [
    { x: 1, z: 1, w: 12, h: 12, color: "#1a1a1a" },
    { x: 1, z: 36, w: 12, h: 12, color: "#1a1a2a" },
    { x: 36, z: 1, w: 12, h: 12, color: "#2a1a1a" },
    { x: 36, z: 36, w: 12, h: 12, color: "#2a1a2a" },
    { x: 16, z: 16, w: 16, h: 16, color: "#1a2020" },
    { x: 18, z: 1, w: 10, h: 10, color: "#20201a" },
    { x: 1, z: 18, w: 10, h: 10, color: "#1a201a" },
    { x: 38, z: 18, w: 10, h: 10, color: "#201a20" },
    { x: 18, z: 38, w: 10, h: 10, color: "#1a1a20" },
];
