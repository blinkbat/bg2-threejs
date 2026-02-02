// =============================================================================
// RUINS AREA - The Fallen Temple
// =============================================================================

import { GRID_SIZE } from "../../core/constants";
import type { AreaData } from "./types";

export const RUINS_AREA: AreaData = {
    id: "ruins",
    name: "The Fallen Temple",
    flavor: "Crumbling stone and overgrown vines speak of forgotten glory.",
    gridSize: GRID_SIZE,
    backgroundColor: "#708090",  // Slate gray sky
    groundColor: "#4a6741",      // Overgrown grass
    ambientLight: 0.4,
    directionalLight: 0.6,
    hasFogOfWar: true,
    defaultSpawn: { x: 3, z: 25 },  // In the entrance hallway
    rooms: [
        // Main temple floor - large open area
        { x: 5, z: 5, w: 40, h: 40 },
        // Entrance hallway from forest
        { x: 0, z: 20, w: 5, h: 10 }
    ],
    hallways: [],
    roomFloors: [
        // Overgrown grass base
        { x: 5, z: 5, w: 40, h: 40, color: "#3d5c34" },
        // Entrance path - grass
        { x: 0, z: 20, w: 5, h: 10, color: "#4a6741" },
        // Stone patches scattered through the ruins
        { x: 10, z: 10, w: 8, h: 6, color: "#5a5a4a" },
        { x: 32, z: 12, w: 6, h: 8, color: "#4a4a3a" },
        { x: 12, z: 32, w: 7, h: 6, color: "#5a5a4a" },
        { x: 30, z: 34, w: 8, h: 5, color: "#4a4a3a" },
        // Inner sanctum - darker stone
        { x: 18, z: 18, w: 14, h: 14, color: "#3a3a2a" },
        // Cracked stone paths
        { x: 5, z: 23, w: 13, h: 4, color: "#4a4a3a" },
        { x: 32, z: 23, w: 13, h: 4, color: "#4a4a3a" },
        { x: 23, z: 5, w: 4, h: 13, color: "#4a4a3a" },
        { x: 23, z: 32, w: 4, h: 13, color: "#4a4a3a" }
    ],
    enemySpawns: [
        // Bats - haunting the fallen temple
        { x: 12, z: 12, type: "bat" },
        { x: 38, z: 12, type: "bat" },
        { x: 12, z: 38, type: "bat" },
        { x: 38, z: 38, type: "bat" },
        { x: 25, z: 25, type: "bat" },
        // Undead Knight - guarding the inner sanctum
        { x: 35, z: 25, type: "undead_knight" },
    ],
    transitions: [
        // West entrance from forest
        {
            x: 0, z: 23, w: 1, h: 4,
            targetArea: "forest",
            targetSpawn: { x: 47, z: 25 },
            direction: "west"
        },
        // East entrance to the Construct Sanctum
        {
            x: 44, z: 23, w: 1, h: 4,
            targetArea: "sanctum",
            targetSpawn: { x: 3, z: 25 },
            direction: "east"
        }
    ],
    chests: [
        {
            x: 25.5,
            z: 20.5,
            contents: [
                { itemId: "stripOfBatJerky", quantity: 3 },
                { itemId: "sulliedBronzeKey", quantity: 1 },
                { itemId: "scrollOfLearning", quantity: 1 }
            ]
        },
        {
            x: 40.5,
            z: 38.5,
            contents: [{ itemId: "smallManaPotion", quantity: 1 }],
            gold: 30
        }
    ],
    trees: [
        // Trees growing through cracks in the ruins
        // Northwest corner
        { x: 8, z: 8, size: 1.0 },
        { x: 12, z: 6, size: 0.8 },
        // Northeast corner
        { x: 40, z: 8, size: 1.1 },
        { x: 38, z: 12, size: 0.9 },
        // Southwest corner
        { x: 8, z: 40, size: 1.2 },
        { x: 6, z: 36, size: 0.8 },
        // Southeast corner
        { x: 40, z: 40, size: 1.0 },
        { x: 42, z: 36, size: 0.9 },
        // Along the walls - nature reclaiming
        { x: 6, z: 20, size: 0.7 },
        { x: 6, z: 30, size: 0.8 },
        { x: 20, z: 6, size: 0.9 },
        { x: 30, z: 6, size: 0.7 },
        { x: 44, z: 20, size: 0.8 },
        { x: 44, z: 30, size: 0.9 },
        { x: 20, z: 44, size: 0.8 },
        { x: 30, z: 44, size: 0.7 },
        // A large dead tree in the center courtyard
        { x: 15, z: 25, size: 1.8 },
        { x: 35, z: 25, size: 1.6 }
    ],
    decorations: [
        // Standing columns - remnants of the temple colonnade
        { x: 10, z: 18, type: "column", size: 1.0 },
        { x: 10, z: 22, type: "column", size: 1.0 },
        { x: 10, z: 26, type: "column", size: 1.0 },
        { x: 10, z: 30, type: "column", size: 1.0 },
        { x: 40, z: 18, type: "column", size: 1.0 },
        { x: 40, z: 22, type: "column", size: 1.0 },
        { x: 40, z: 26, type: "column", size: 1.0 },
        { x: 40, z: 30, type: "column", size: 1.0 },
        // Inner sanctum columns (taller)
        { x: 18, z: 18, type: "column", size: 1.2 },
        { x: 32, z: 18, type: "column", size: 1.2 },
        { x: 18, z: 32, type: "column", size: 1.2 },
        { x: 32, z: 32, type: "column", size: 1.2 },

        // Broken columns - scattered throughout
        { x: 14, z: 10, type: "broken_column", size: 1.0 },
        { x: 36, z: 12, type: "broken_column", size: 0.9 },
        { x: 12, z: 38, type: "broken_column", size: 1.1 },
        { x: 38, z: 36, type: "broken_column", size: 0.8 },
        { x: 22, z: 8, type: "broken_column", size: 1.0 },
        { x: 28, z: 42, type: "broken_column", size: 0.9 },
        { x: 8, z: 25, type: "broken_column", size: 1.0 },
        { x: 42, z: 25, type: "broken_column", size: 1.0 },

        // Broken walls - ruined temple walls
        { x: 8, z: 14, type: "broken_wall", rotation: 0, size: 1.0 },
        { x: 42, z: 14, type: "broken_wall", rotation: 0, size: 1.1 },
        { x: 8, z: 36, type: "broken_wall", rotation: 0, size: 0.9 },
        { x: 42, z: 36, type: "broken_wall", rotation: 0, size: 1.0 },
        { x: 16, z: 8, type: "broken_wall", rotation: Math.PI / 2, size: 1.0 },
        { x: 34, z: 8, type: "broken_wall", rotation: Math.PI / 2, size: 0.9 },
        { x: 16, z: 42, type: "broken_wall", rotation: Math.PI / 2, size: 1.1 },
        { x: 34, z: 42, type: "broken_wall", rotation: Math.PI / 2, size: 1.0 },
        // Inner ruins
        { x: 20, z: 15, type: "broken_wall", rotation: Math.PI / 4, size: 0.8 },
        { x: 30, z: 15, type: "broken_wall", rotation: -Math.PI / 4, size: 0.8 },
        { x: 15, z: 22, type: "broken_wall", rotation: Math.PI / 3, size: 0.7 },
        { x: 35, z: 28, type: "broken_wall", rotation: -Math.PI / 3, size: 0.7 }
    ]
};
