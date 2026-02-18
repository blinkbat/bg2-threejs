// =============================================================================
// TEXT MAP LOADER - Dynamically loads all text-based area definitions
// =============================================================================

import { textToAreaData } from "../../editor/areaTextFormat";
import type { AreaData, AreaId } from "./types";

// Dynamically import all .txt files from the maps directory
const textFiles = import.meta.glob("./maps/*.txt", { eager: true, query: "?raw", import: "default" }) as Record<string, string>;

function getMapFileId(filePath: string): string {
    const parts = filePath.split("/");
    const fileName = parts[parts.length - 1] ?? filePath;
    return fileName.endsWith(".txt") ? fileName.slice(0, -4) : fileName;
}

// Parse all text maps into AreaData, keyed by their area ID from the file content
const areaMap = new Map<string, AreaData>();
const areaSources = new Map<string, string>();

for (const [filePath, content] of Object.entries(textFiles).sort(([a], [b]) => a.localeCompare(b))) {
    const areaData = textToAreaData(content);
    const existing = areaMap.get(areaData.id);
    if (!existing) {
        areaMap.set(areaData.id, areaData);
        areaSources.set(areaData.id, filePath);
        continue;
    }

    const existingSource = areaSources.get(areaData.id) ?? "unknown";
    const existingFileId = getMapFileId(existingSource);
    const currentFileId = getMapFileId(filePath);
    const currentMatchesId = currentFileId === areaData.id;
    const existingMatchesId = existingFileId === areaData.id;

    const shouldReplace = currentMatchesId && !existingMatchesId;
    if (shouldReplace) {
        areaMap.set(areaData.id, areaData);
        areaSources.set(areaData.id, filePath);
    }

    if (import.meta.env.DEV) {
        const chosenSource = shouldReplace ? filePath : existingSource;
        console.warn(
            `[areas] Duplicate area id "${areaData.id}" from "${filePath}" and "${existingSource}". Using "${chosenSource}".`
        );
    }
}

// Export as a Record for backwards compatibility
export const TEXT_AREAS: Record<string, AreaData> = Object.fromEntries(areaMap);

function upsertArea(areaData: AreaData): void {
    areaMap.set(areaData.id, areaData);
    TEXT_AREAS[areaData.id] = areaData;
}

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
    if (areaData.id !== areaId) {
        upsertArea({ ...areaData, id: areaId as AreaId });
        return;
    }
    upsertArea(areaData);
}

// Register area from text content (for editor save)
export function registerAreaFromText(areaId: string, textContent: string): AreaData {
    const parsedArea = textToAreaData(textContent);
    const areaData = parsedArea.id === areaId
        ? parsedArea
        : { ...parsedArea, id: areaId as AreaId };
    upsertArea(areaData);
    return areaData;
}
