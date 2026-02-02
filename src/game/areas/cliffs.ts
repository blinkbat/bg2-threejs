// =============================================================================
// CLIFFS AREA - The Rocky Pass
// =============================================================================

import { GRID_SIZE } from "../../core/constants";
import type { AreaData } from "./types";

export const CLIFFS_AREA: AreaData = {
    id: "cliffs",
    name: "The Rocky Pass",
    flavor: "Wind howls through the jagged stones of this narrow passage.",
    gridSize: GRID_SIZE,
    backgroundColor: "#87CEEB",  // Sky blue
    groundColor: "#5a7a4a",      // Grassy green
    ambientLight: 0.55,
    directionalLight: 0.85,
    hasFogOfWar: true,
    defaultSpawn: { x: 47, z: 25 },
    rooms: [
        // Jagged winding hallway - series of wide connected segments
        // Entry area from coast (east side)
        { x: 40, z: 18, w: 10, h: 14 },
        // First bend going north
        { x: 32, z: 24, w: 12, h: 12 },
        // North segment going west
        { x: 22, z: 26, w: 14, h: 10 },
        // Second bend going south
        { x: 18, z: 14, w: 10, h: 16 },
        // South segment going west
        { x: 8, z: 12, w: 14, h: 10 },
        // Third bend going north
        { x: 4, z: 18, w: 10, h: 16 },
        // Exit area (west side)
        { x: 1, z: 22, w: 8, h: 12 },
        // Secret cave (south of main path, wall at z:11 blocks entry)
        { x: 10, z: 1, w: 28, h: 10 }
    ],
    hallways: [
        // Connect the wide jagged segments
        { x1: 38, z1: 24, x2: 42, z2: 30 },   // Entry to first bend
        { x1: 32, z1: 28, x2: 36, z2: 34 },   // First bend to north segment
        { x1: 22, z1: 22, x2: 26, z2: 26 },   // North to second bend
        { x1: 14, z1: 16, x2: 18, z2: 20 },   // Second bend to south segment
        { x1: 8, z1: 18, x2: 12, z2: 22 },    // South to third bend
        { x1: 4, z1: 22, x2: 8, z2: 28 }      // Third bend to exit
    ],
    roomFloors: [
        // Grassy path with some dirt patches
        { x: 40, z: 18, w: 10, h: 14, color: "#5a7a4a" },
        { x: 32, z: 24, w: 12, h: 12, color: "#4a6a3a" },
        { x: 22, z: 26, w: 14, h: 10, color: "#5a7a4a" },
        { x: 18, z: 14, w: 10, h: 16, color: "#4a6a3a" },
        { x: 8, z: 12, w: 14, h: 10, color: "#5a7a4a" },
        { x: 4, z: 18, w: 10, h: 16, color: "#4a6a3a" },
        { x: 1, z: 22, w: 8, h: 12, color: "#5a7a4a" },
        // Dirt path through the center
        { x: 43, z: 22, w: 5, h: 6, color: "#6a5a4a" },
        { x: 22, z: 18, w: 4, h: 6, color: "#6a5a4a" },
        { x: 6, z: 26, w: 5, h: 4, color: "#6a5a4a" },
        // Secret cave floor
        { x: 10, z: 1, w: 28, h: 10, color: "#4a5a3a" }
    ],
    enemySpawns: [
        // Pack at north segment
        { x: 26, z: 30, type: "feral_hound" },
        { x: 28, z: 32, type: "feral_hound" },
        // Pack at second bend
        { x: 20, z: 18, type: "feral_hound" },
        { x: 22, z: 20, type: "feral_hound" },
        // Pack at south segment
        { x: 12, z: 16, type: "feral_hound" },
        { x: 14, z: 18, type: "feral_hound" },
        // Pack guarding exit
        { x: 6, z: 26, type: "feral_hound" },
        { x: 8, z: 28, type: "feral_hound" },
        { x: 5, z: 30, type: "feral_hound" },
        // Corrupt Druid near chest
        { x: 3, z: 28, type: "corrupt_druid" },
        // Skeleton Warriors guarding secret cave treasure
        { x: 28, z: 5, type: "skeleton_warrior" },
        { x: 33, z: 6, type: "skeleton_warrior" },
    ],
    transitions: [
        // East entrance from coast
        {
            x: 49, z: 23, w: 1, h: 5,
            targetArea: "coast",
            targetSpawn: { x: 2, z: 20 },
            direction: "east"
        },
        // West entrance to Magma Cave (near the druid)
        {
            x: 0, z: 28, w: 1, h: 5,
            targetArea: "magma_cave",
            targetSpawn: { x: 46, z: 25 },
            direction: "west"
        }
    ],
    chests: [
        {
            x: 5.5,
            z: 30.5,
            contents: [{ itemId: "smallManaPotion", quantity: 2 }],
            gold: 20
        },
        // Hidden chest in secret cave
        {
            x: 30.5,
            z: 5.5,
            contents: [
                { itemId: "battleaxe", quantity: 1 },
                { itemId: "scrollOfLearning", quantity: 2 }
            ],
            gold: 50
        }
    ],
    trees: [
        // Sparse vegetation among the rocks (outside path)
        { x: 48, z: 16, size: 0.7 },
        { x: 46, z: 35, size: 0.6 },
        { x: 30, z: 38, size: 0.8 },
        { x: 6, z: 10, size: 0.7 },
        { x: 2, z: 36, size: 0.8 }
    ],
    decorations: [
        // Rocky outcrops lining the wide path - broken walls as rock faces
        // East entrance rocks (outside walkable area)
        { x: 48, z: 34, type: "broken_wall", rotation: 0, size: 1.2 },
        { x: 42, z: 16, type: "broken_wall", rotation: Math.PI / 4, size: 1.0 },
        // First bend rocks
        { x: 44, z: 36, type: "broken_wall", rotation: Math.PI / 3, size: 1.1 },
        { x: 30, z: 37, type: "broken_column", size: 0.9 },
        // North segment rocks
        { x: 36, z: 38, type: "broken_wall", rotation: -Math.PI / 4, size: 1.0 },
        { x: 20, z: 37, type: "broken_column", size: 0.8 },
        // Second bend rocks
        { x: 28, z: 12, type: "broken_wall", rotation: 0, size: 1.2 },
        { x: 16, z: 10, type: "broken_column", size: 0.9 },
        { x: 28, z: 8, type: "broken_wall", rotation: Math.PI / 2, size: 1.0 },
        // South segment rocks
        { x: 6, z: 10, type: "broken_wall", rotation: Math.PI / 4, size: 1.1 },
        { x: 22, z: 10, type: "broken_column", size: 0.8 },
        // Third bend rocks
        { x: 2, z: 16, type: "broken_wall", rotation: -Math.PI / 3, size: 1.0 },
        { x: 14, z: 35, type: "broken_column", size: 0.9 },
        { x: 2, z: 36, type: "broken_wall", rotation: 0, size: 1.1 },
        // Exit area rocks
        { x: 8, z: 36, type: "broken_wall", rotation: Math.PI / 6, size: 1.0 },
        { x: 10, z: 8, type: "broken_column", size: 0.9 }
    ],
    secretDoors: [
        {
            x: 17,
            z: 11,
            blockingWall: { x: 16, z: 11, w: 3, h: 1 }
        }
    ],
    // Candles in the secret cave
    candles: [
        { x: 10.85, z: 5.5, dx: 1, dz: 0 },   // West wall, facing east
        { x: 25, z: 1.85, dx: 0, dz: 1 }      // South wall, facing north
    ]
};
