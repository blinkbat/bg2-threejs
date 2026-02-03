// =============================================================================
// TEXT MAP LOADER - Loads and parses text-based area definitions
// =============================================================================

import { textToAreaData } from "../../editor/areaTextFormat";
import type { AreaData, AreaId } from "./types";

// Import all text maps using Vite's ?raw suffix
import cliffsText from "./maps/cliffs.txt?raw";
import dungeonText from "./maps/dungeon.txt?raw";
import forestText from "./maps/forest.txt?raw";
import coastText from "./maps/coast.txt?raw";
import ruinsText from "./maps/ruins.txt?raw";
import sanctumText from "./maps/sanctum.txt?raw";
import magmaCaveText from "./maps/magma_cave.txt?raw";

// Parse all text maps into AreaData
export const TEXT_AREAS: Record<AreaId, AreaData> = {
    cliffs: textToAreaData(cliffsText),
    dungeon: textToAreaData(dungeonText),
    forest: textToAreaData(forestText),
    coast: textToAreaData(coastText),
    ruins: textToAreaData(ruinsText),
    sanctum: textToAreaData(sanctumText),
    magma_cave: textToAreaData(magmaCaveText),
};

// Get text area by ID
export function getTextArea(areaId: AreaId): AreaData {
    return TEXT_AREAS[areaId];
}
