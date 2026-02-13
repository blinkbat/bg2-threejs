// =============================================================================
// TEXT MAP LOADER - Dynamically loads all text-based area definitions
// =============================================================================

import { textToAreaData } from "../../editor/areaTextFormat";
import type { AreaData, AreaId } from "./types";

// Dynamically import all .txt files from the maps directory
const textFiles = import.meta.glob("./maps/*.txt", { eager: true, query: "?raw", import: "default" }) as Record<string, string>;

// Parse all text maps into AreaData, keyed by their area ID from the file content
const areaMap = new Map<string, AreaData>();

for (const content of Object.values(textFiles)) {
    const areaData = textToAreaData(content);
    areaMap.set(areaData.id, areaData);
}

// Export as a Record for backwards compatibility
export const TEXT_AREAS: Record<string, AreaData> = Object.fromEntries(areaMap);

// Get all available area IDs (dynamically determined from loaded files)
export function getAllAreaIds(): string[] {
    return Array.from(areaMap.keys());
}

// Get text area by ID
export function getTextArea(areaId: AreaId): AreaData | undefined {
    return areaMap.get(areaId);
}

// Check if an area exists
export function hasArea(areaId: string): boolean {
    return areaMap.has(areaId);
}

// Register a new area at runtime (for editor use)
export function registerArea(areaId: string, areaData: AreaData): void {
    areaMap.set(areaId, areaData);
}

// Register area from text content (for editor save)
export function registerAreaFromText(areaId: string, textContent: string): AreaData {
    const areaData = textToAreaData(textContent);
    areaMap.set(areaId, areaData);
    return areaData;
}
