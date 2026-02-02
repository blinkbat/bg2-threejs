// =============================================================================
// TEXT MAP LOADER - Loads and parses text-based area definitions
// =============================================================================

import { textToAreaData, areaDataToText } from "../../editor/areaTextFormat";
import type { AreaData, AreaId } from "./types";

// Import all text maps using Vite's ?raw suffix
import cliffsText from "./maps/cliffs.txt?raw";
import dungeonText from "./maps/dungeon.txt?raw";
import forestText from "./maps/forest.txt?raw";
import coastText from "./maps/coast.txt?raw";
import ruinsText from "./maps/ruins.txt?raw";
import sanctumText from "./maps/sanctum.txt?raw";
import magmaCaveText from "./maps/magma_cave.txt?raw";

// Import original TypeScript areas (for comparison/fallback)
import { CLIFFS_AREA as CLIFFS_TS } from "./cliffs";
import { DUNGEON_AREA as DUNGEON_TS } from "./dungeon";
import { FIELD_AREA as FOREST_TS } from "./forest";
import { COAST_AREA as COAST_TS } from "./coast";
import { RUINS_AREA as RUINS_TS } from "./ruins";
import { SANCTUM_AREA as SANCTUM_TS } from "./sanctum";
import { MAGMA_CAVE_AREA as MAGMA_CAVE_TS } from "./magmaCave";

// TypeScript area registry (for comparison/fallback)
const TS_AREAS: Record<AreaId, AreaData> = {
    cliffs: CLIFFS_TS,
    dungeon: DUNGEON_TS,
    forest: FOREST_TS,
    coast: COAST_TS,
    ruins: RUINS_TS,
    sanctum: SANCTUM_TS,
    magma_cave: MAGMA_CAVE_TS,
};

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

// Helper: Generate text from TypeScript area (for debugging)
export function generateTextFromArea(areaId: AreaId): string {
    const area = TS_AREAS[areaId];
    if (!area) return "";
    return areaDataToText(area);
}

// Get text area by ID
export function getTextArea(areaId: AreaId): AreaData {
    return TEXT_AREAS[areaId];
}
