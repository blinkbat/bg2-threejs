// =============================================================================
// LOCAL STORAGE - Persistent UI state independent of save/load game slots
// =============================================================================

// -----------------------------------------------------------------------------
// Hotbar Assignments
// -----------------------------------------------------------------------------

export type HotbarAssignments = Record<number, (string | null)[]>;

const HOTBAR_STORAGE_KEY = "skillHotbarAssignments";

export function loadHotbarAssignments(): HotbarAssignments {
    try {
        const stored = localStorage.getItem(HOTBAR_STORAGE_KEY);
        if (stored) return JSON.parse(stored);
    } catch { /* ignore */ }
    return {};
}

export function saveHotbarAssignments(assignments: HotbarAssignments): void {
    try {
        localStorage.setItem(HOTBAR_STORAGE_KEY, JSON.stringify(assignments));
    } catch { /* ignore */ }
}

// -----------------------------------------------------------------------------
// Formation Order
// -----------------------------------------------------------------------------

const FORMATION_STORAGE_KEY = "formationOrder";

export function loadFormationOrder(): number[] {
    try {
        const stored = localStorage.getItem(FORMATION_STORAGE_KEY);
        if (stored) return JSON.parse(stored);
    } catch { /* ignore */ }
    return [];
}

export function saveFormationOrder(order: number[]): void {
    try {
        localStorage.setItem(FORMATION_STORAGE_KEY, JSON.stringify(order));
    } catch { /* ignore */ }
}
