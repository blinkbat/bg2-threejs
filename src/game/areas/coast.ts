// =============================================================================
// COAST AREA - The Coast
// =============================================================================

import { GRID_SIZE } from "../../core/constants";
import type { AreaData } from "./types";

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
    defaultSpawn: { x: 25, z: 12 },  // Near water's edge
    rooms: [
        // Full area - water is visual only (no walls)
        { x: 1, z: 1, w: 48, h: 48 }
    ],
    hallways: [],
    roomFloors: [
        // Non-overlapping tiles from south to north
        // Water (z: 1-9)
        { x: 1, z: 1, w: 48, h: 4, color: "#4682b4" },    // Deep water
        { x: 1, z: 5, w: 48, h: 5, color: "#5f9ea0" },    // Shallow water
        // Wet sand (z: 10-21)
        { x: 1, z: 10, w: 48, h: 12, color: "#a89968" },
        // Mid sand (z: 22-39)
        { x: 1, z: 22, w: 48, h: 18, color: "#c2b280" },
        // Dry sand and grass patches (z: 40-49) - non-overlapping
        { x: 1, z: 40, w: 2, h: 9, color: "#d4c4a8" },    // Sand west edge
        { x: 3, z: 40, w: 8, h: 5, color: "#d4c4a8" },    // Sand under grass
        { x: 3, z: 45, w: 8, h: 4, color: "#8ab07a" },    // Grass west
        { x: 11, z: 40, w: 3, h: 2, color: "#d4c4a8" },   // Sand gap
        { x: 11, z: 42, w: 3, h: 7, color: "#d4c4a8" },   // Sand
        { x: 14, z: 40, w: 5, h: 2, color: "#d4c4a8" },   // Sand
        { x: 14, z: 42, w: 5, h: 4, color: "#7a9a6a" },   // Grass small
        { x: 14, z: 46, w: 6, h: 3, color: "#d4c4a8" },   // Sand
        { x: 19, z: 40, w: 1, h: 6, color: "#d4c4a8" },   // Sand strip
        { x: 20, z: 40, w: 10, h: 6, color: "#d4c4a8" },  // Sand
        { x: 20, z: 46, w: 10, h: 3, color: "#7a9a6a" },  // Grass center
        { x: 30, z: 40, w: 2, h: 3, color: "#d4c4a8" },   // Sand
        { x: 30, z: 43, w: 2, h: 6, color: "#d4c4a8" },   // Sand
        { x: 32, z: 40, w: 4, h: 3, color: "#d4c4a8" },   // Sand
        { x: 32, z: 43, w: 4, h: 3, color: "#8ab07a" },   // Grass small
        { x: 32, z: 46, w: 6, h: 3, color: "#d4c4a8" },   // Sand
        { x: 36, z: 40, w: 2, h: 4, color: "#d4c4a8" },   // Sand
        { x: 38, z: 40, w: 10, h: 4, color: "#d4c4a8" },  // Sand under grass
        { x: 38, z: 44, w: 10, h: 5, color: "#9ac08a" },  // Grass east
        { x: 48, z: 40, w: 1, h: 9, color: "#d4c4a8" },   // Sand east edge
    ],
    enemySpawns: [
        { x: 15, z: 42, type: "giant_amoeba" },
        { x: 35, z: 40, type: "giant_amoeba" },
        // Acid slugs further up the beach
        { x: 10, z: 32, type: "acid_slug" },
        { x: 40, z: 34, type: "acid_slug" },
        { x: 25, z: 36, type: "acid_slug" },
        // Baby Kraken in the shallow water
        { x: 45, z: 5, type: "baby_kraken" }
    ],
    transitions: [
        // North edge leads back to forest
        {
            x: 23, z: 49, w: 5, h: 1,
            targetArea: "forest",
            targetSpawn: { x: 25, z: 2 },
            direction: "north"
        },
        // West side near beach leads to cliffs
        {
            x: 0, z: 18, w: 1, h: 5,
            targetArea: "cliffs",
            targetSpawn: { x: 47, z: 25 },
            direction: "west"
        }
    ],
    chests: [
        {
            x: 5.5,
            z: 40.5,
            contents: [{ itemId: "stripOfBatJerky", quantity: 1 }],
            gold: 25
        }
    ],
    trees: [
        // Palm trees scattered on sandy areas (away from water)
        { x: 5, z: 44, size: 1.2 },
        { x: 12, z: 46, size: 1.0 },
        { x: 18, z: 43, size: 1.3 },
        { x: 32, z: 45, size: 1.1 },
        { x: 40, z: 44, size: 1.2 },
        { x: 46, z: 47, size: 0.9 },
        // Mid-north beach (sandy area)
        { x: 8, z: 38, size: 1.0 },
        { x: 42, z: 40, size: 1.1 },
        { x: 25, z: 42, size: 1.0 },
        // Along the grassy inland edge
        { x: 15, z: 47, size: 1.1 },
        { x: 35, z: 48, size: 1.0 },
    ]
};
