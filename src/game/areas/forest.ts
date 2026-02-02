// =============================================================================
// FOREST AREA - Whispering Woods
// =============================================================================

import { GRID_SIZE } from "../../core/constants";
import type { AreaData } from "./types";

export const FIELD_AREA: AreaData = {
    id: "forest",
    name: "Whispering Woods",
    flavor: "Something skitters in the shadows between the trees.",
    gridSize: GRID_SIZE,
    backgroundColor: "#87CEEB",  // Sky blue
    groundColor: "#2d5a27",      // Forest green (matches floor tiles)
    ambientLight: 0.5,           // Bright outdoor lighting
    directionalLight: 0.8,
    hasFogOfWar: true,            // Fog of war like dungeon
    defaultSpawn: { x: 25, z: 25 },  // Center of forest
    rooms: [
        // Single large open area
        { x: 1, z: 1, w: 48, h: 48 }
    ],
    hallways: [],  // No hallways - open field
    roomFloors: [
        // Tiled grass floor - subtle color variations (similar value/vibrancy)
        // Row 1 (z: 1-12)
        { x: 1, z: 1, w: 16, h: 12, color: "#2d5a27" },
        { x: 17, z: 1, w: 16, h: 12, color: "#325d2c" },
        { x: 33, z: 1, w: 16, h: 12, color: "#2a5830" },
        // Row 2 (z: 13-24)
        { x: 1, z: 13, w: 12, h: 12, color: "#305b2a" },
        { x: 13, z: 13, w: 6, h: 5, color: "#4a4035" },    // Dirt patch
        { x: 13, z: 18, w: 10, h: 6, color: "#2d5a27" },
        { x: 19, z: 13, w: 14, h: 5, color: "#2a5830" },
        { x: 23, z: 18, w: 10, h: 6, color: "#2f5c29" },
        { x: 33, z: 13, w: 5, h: 5, color: "#453a30" },    // Dirt patch
        { x: 38, z: 13, w: 11, h: 12, color: "#2d5a27" },
        { x: 33, z: 18, w: 5, h: 6, color: "#325d2c" },
        // Row 3 (z: 25-36)
        { x: 1, z: 25, w: 16, h: 12, color: "#2a5830" },
        { x: 17, z: 25, w: 16, h: 12, color: "#2d5a27" },
        { x: 33, z: 25, w: 7, h: 5, color: "#4a4035" },    // Dirt patch
        { x: 40, z: 25, w: 9, h: 12, color: "#305b2a" },
        { x: 33, z: 30, w: 7, h: 7, color: "#2a5830" },
        // Row 4 (z: 37-48)
        { x: 1, z: 37, w: 20, h: 12, color: "#2d5a27" },
        { x: 21, z: 37, w: 7, h: 5, color: "#453a30" },    // Dirt patch
        { x: 28, z: 37, w: 21, h: 12, color: "#325d2c" },
        { x: 21, z: 42, w: 7, h: 7, color: "#2f5c29" },
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
        },
        // East edge leads to ruins
        {
            x: 49, z: 23, w: 1, h: 5,
            targetArea: "ruins",
            targetSpawn: { x: 3, z: 25 },
            direction: "east"
        }
    ],
    chests: [
        {
            x: 6.5,
            z: 6.5,
            contents: [
                { itemId: "loafOfBread", quantity: 1 },
                { itemId: "scrollOfLearning", quantity: 1 }
            ],
            gold: 15
        },
        {
            x: 38.5,
            z: 38.5,
            contents: [{ itemId: "smallManaPotion", quantity: 1 }]
        }
    ],
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
        // GIANT TREES - ancient forest sentinels (reduced sizes)
        { x: 6, z: 15, size: 1.8 },    // West side giant
        { x: 42, z: 28, size: 1.9 },   // East side giant
        { x: 15, z: 35, size: 1.7 },   // Southwest giant
        { x: 38, z: 15, size: 1.8 },   // Northeast giant
        { x: 25, z: 25, size: 2.0 },   // Center giant - the biggest
    ]
};
