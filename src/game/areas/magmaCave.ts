// =============================================================================
// MAGMA CAVE AREA - The Magma Cave
// =============================================================================

import { GRID_SIZE } from "../../core/constants";
import type { AreaData } from "./types";

export const MAGMA_CAVE_AREA: AreaData = {
    id: "magma_cave",
    name: "The Magma Cave",
    flavor: "Heat radiates from rivers of molten rock flowing through the darkness.",
    gridSize: GRID_SIZE,
    backgroundColor: "#1a0a0a",  // Very dark red-black
    groundColor: "#2a1a1a",      // Dark stone with red tint
    ambientLight: 0.18,          // Dark but visible
    directionalLight: 0.22,      // Low directional light
    hasFogOfWar: true,
    defaultSpawn: { x: 46, z: 25 },  // Near east entrance
    rooms: [
        // East entrance chamber
        { x: 40, z: 20, w: 8, h: 12 },
        // First corridor going west
        { x: 30, z: 22, w: 10, h: 8 },
        // Central chamber (large, magma river runs through it)
        { x: 10, z: 14, w: 20, h: 22 },
        // North alcove
        { x: 12, z: 38, w: 8, h: 6 },
        // South alcove
        { x: 12, z: 4, w: 8, h: 8 },
        // West chamber
        { x: 2, z: 18, w: 8, h: 14 }
    ],
    hallways: [
        // Connect east entrance to first corridor
        { x1: 38, z1: 24, x2: 42, z2: 28 },
        // Connect first corridor to central chamber
        { x1: 28, z1: 24, x2: 32, z2: 28 },
        // Connect central chamber to north alcove
        { x1: 14, z1: 34, x2: 18, z2: 38 },
        // Connect central chamber to south alcove
        { x1: 14, z1: 10, x2: 18, z2: 14 },
        // Connect central chamber to west chamber
        { x1: 8, z1: 22, x2: 12, z2: 28 }
    ],
    // Lava zones - impassable but no walls rendered
    lavaZones: [
        // Main magma river running north-south (with gap for bridge at z:23-27)
        { x: 18, z: 14, w: 4, h: 9 },   // South of bridge
        { x: 18, z: 27, w: 4, h: 9 }    // North of bridge
    ],
    roomFloors: [
        // Cave floor - dark stone
        { x: 40, z: 20, w: 8, h: 12, color: "#1a1215" },
        { x: 30, z: 22, w: 10, h: 8, color: "#1a1215" },
        { x: 10, z: 14, w: 20, h: 22, color: "#1a1215" },  // Central chamber
        { x: 12, z: 38, w: 8, h: 6, color: "#1a1215" },
        { x: 12, z: 4, w: 8, h: 8, color: "#1a1215" },
        { x: 2, z: 18, w: 8, h: 14, color: "#1a1215" },
        // MAIN MAGMA RIVER - runs north-south (rendered on top)
        { x: 18, z: 14, w: 4, h: 9, color: "#ff4500" },   // South of bridge
        { x: 18, z: 27, w: 4, h: 9, color: "#ff4500" },   // North of bridge
        // Bridge floor (darker stone, rendered on top of central chamber)
        { x: 18, z: 23, w: 4, h: 4, color: "#2a2020" },
        // Small magma pools in corners
        { x: 2, z: 32, w: 4, h: 4, color: "#ff5500" },
        { x: 2, z: 8, w: 4, h: 4, color: "#ff5500" }
    ],
    enemySpawns: [
        // Bats in central chamber (deeper in)
        { x: 14, z: 28, type: "bat" },
        // Bat in west chamber
        { x: 5, z: 24, type: "bat" },
        // Magma Imps - positioned near/over lava for tactical advantage
        { x: 19, z: 17, type: "magma_imp" },    // Over south magma river
        { x: 20, z: 32, type: "magma_imp" },    // Over north magma river
        { x: 12, z: 24, type: "magma_imp" },    // West side of central chamber
        // Magma Imp in south alcove (guards treasure)
        { x: 15, z: 8, type: "magma_imp" }
    ],
    transitions: [
        // East entrance from Cliffs
        {
            x: 48, z: 23, w: 1, h: 5,
            targetArea: "cliffs",
            targetSpawn: { x: 2, z: 30 },
            direction: "east"
        }
    ],
    chests: [
        // Chest in west chamber
        {
            x: 5.5,
            z: 28.5,
            contents: [
                { itemId: "smallManaPotion", quantity: 2 },
                { itemId: "stripOfBatJerky", quantity: 3 }
            ],
            gold: 40
        }
    ],
    trees: [],  // No trees in cave
    decorations: [
        // Broken stalagmites/columns throughout
        { x: 12, z: 20, type: "broken_column", size: 0.8 },
        { x: 26, z: 30, type: "broken_column", size: 0.9 },
        { x: 34, z: 26, type: "broken_column", size: 0.7 },
        { x: 5, z: 20, type: "broken_column", size: 0.8 }
    ],
    // Orange-tinted candles near magma for the glow effect
    candles: [
        // East entrance chamber
        { x: 44, z: 20.85, dx: 0, dz: 1 },
        { x: 40.85, z: 26, dx: 1, dz: 0 },
        // First corridor
        { x: 34, z: 22.85, dx: 0, dz: 1 },
        // Along the magma river (east bank)
        { x: 22.5, z: 18, dx: -1, dz: 0 },
        { x: 22.5, z: 32, dx: -1, dz: 0 },
        // Along the magma river (west bank)
        { x: 17.5, z: 18, dx: 1, dz: 0 },
        { x: 17.5, z: 32, dx: 1, dz: 0 },
        // Central chamber corners
        { x: 10.85, z: 20, dx: 1, dz: 0 },
        { x: 10.85, z: 28, dx: 1, dz: 0 },
        // West chamber
        { x: 2.85, z: 24, dx: 1, dz: 0 },
        { x: 2.85, z: 20, dx: 1, dz: 0 },
        // North alcove
        { x: 14, z: 42.15, dx: 0, dz: -1 },
        // South alcove (near treasure)
        { x: 14, z: 4.85, dx: 0, dz: 1 },
        // Near small magma pools
        { x: 6.5, z: 32, dx: -1, dz: 0 },
        { x: 6.5, z: 8, dx: -1, dz: 0 }
    ]
};
