// =============================================================================
// SANCTUM AREA - The Construct Sanctum
// =============================================================================

import { GRID_SIZE } from "../../core/constants";
import type { AreaData } from "./types";

export const SANCTUM_AREA: AreaData = {
    id: "sanctum",
    name: "The Construct Sanctum",
    flavor: "Ancient machinery hums within these forgotten halls.",
    gridSize: GRID_SIZE,
    backgroundColor: "#4a4a5a",  // Dark grey-purple sky
    groundColor: "#3a3a3a",      // Dark stone
    ambientLight: 0.3,
    directionalLight: 0.4,
    hasFogOfWar: true,
    defaultSpawn: { x: 3, z: 25 },  // In the entrance hallway
    rooms: [
        // Long entrance hallway
        { x: 0, z: 20, w: 18, h: 10 },
        // Large boss chamber
        { x: 18, z: 8, w: 30, h: 34 }
    ],
    hallways: [],
    roomFloors: [
        // Entrance hallway - worn stone path
        { x: 0, z: 20, w: 18, h: 10, color: "#4a4a4a" },
        // Boss chamber - darker stone floor
        { x: 18, z: 8, w: 30, h: 34, color: "#3a3a3a" },
        // Inner circle floor - ancient runes
        { x: 25, z: 17, w: 16, h: 16, color: "#2a2a3a" }
    ],
    enemySpawns: [
        // The Ancient Construct - center of the chamber
        { x: 33, z: 25, type: "ancient_construct" }
    ],
    transitions: [
        // West entrance back to ruins
        {
            x: 0, z: 23, w: 1, h: 4,
            targetArea: "ruins",
            targetSpawn: { x: 43, z: 25 },
            direction: "west"
        }
    ],
    chests: [
        {
            x: 40.5,
            z: 25.5,
            contents: [
                { itemId: "stripOfBatJerky", quantity: 1 },
                { itemId: "quickfoxRing", quantity: 1 }
            ],
            gold: 90,
            locked: true,
            requiredKeyId: "bronzeKey"
        }
    ],
    trees: [],  // No trees in the sanctum
    decorations: [
        // Circle of pillars around the boss arena (radius ~8 from center at 33,25)
        { x: 33, z: 17, type: "column", size: 1.3 },   // North
        { x: 39, z: 19, type: "column", size: 1.3 },   // NE
        { x: 41, z: 25, type: "column", size: 1.3 },   // East
        { x: 39, z: 31, type: "column", size: 1.3 },   // SE
        { x: 33, z: 33, type: "column", size: 1.3 },   // South
        { x: 27, z: 31, type: "column", size: 1.3 },   // SW
        { x: 25, z: 25, type: "column", size: 1.3 },   // West
        { x: 27, z: 19, type: "column", size: 1.3 },   // NW

        // Entrance hallway columns
        { x: 4, z: 21, type: "column", size: 1.0 },
        { x: 4, z: 28, type: "column", size: 1.0 },
        { x: 10, z: 21, type: "column", size: 1.0 },
        { x: 10, z: 28, type: "column", size: 1.0 },
        { x: 16, z: 21, type: "column", size: 1.0 },
        { x: 16, z: 28, type: "column", size: 1.0 },

        // Broken columns scattered in the chamber
        { x: 22, z: 12, type: "broken_column", size: 0.9 },
        { x: 42, z: 14, type: "broken_column", size: 1.0 },
        { x: 20, z: 36, type: "broken_column", size: 0.8 },
        { x: 44, z: 38, type: "broken_column", size: 1.1 },

        // Broken walls at chamber edges
        { x: 20, z: 10, type: "broken_wall", rotation: Math.PI / 2, size: 1.0 },
        { x: 44, z: 25, type: "broken_wall", rotation: 0, size: 0.9 },
        { x: 30, z: 40, type: "broken_wall", rotation: Math.PI / 2, size: 1.0 }
    ]
};
