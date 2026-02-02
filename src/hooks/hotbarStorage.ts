// =============================================================================
// HOTBAR STORAGE - Persistence for skill hotbar assignments
// =============================================================================

export type HotbarAssignments = Record<number, (string | null)[]>;  // unitId -> [5 skill names or null]

const HOTBAR_STORAGE_KEY = "skillHotbarAssignments";

/** Load hotbar assignments from localStorage */
export function loadHotbarAssignments(): HotbarAssignments {
    try {
        const stored = localStorage.getItem(HOTBAR_STORAGE_KEY);
        if (stored) {
            return JSON.parse(stored);
        }
    } catch {
        // Ignore parse errors
    }
    return {};
}

/** Save hotbar assignments to localStorage */
export function saveHotbarAssignments(assignments: HotbarAssignments): void {
    try {
        localStorage.setItem(HOTBAR_STORAGE_KEY, JSON.stringify(assignments));
    } catch {
        // Ignore storage errors
    }
}
