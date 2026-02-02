// =============================================================================
// DUNGEON AREA - Kobold Warrens
// =============================================================================

import { GRID_SIZE } from "../../core/constants";
import type { AreaData } from "./types";

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
    defaultSpawn: { x: 6, z: 6 },  // Center of spawn room
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
        {
            x: 28.5,
            z: 28.5,
            contents: [
                { itemId: "smallManaPotion", quantity: 3 },
                { itemId: "battleaxe", quantity: 1 }
            ]
        },
        {
            x: 8.5,
            z: 42.5,
            contents: [{ itemId: "loafOfBread", quantity: 1 }],
            gold: 20
        }
    ],
    trees: []  // No trees in dungeon
};
