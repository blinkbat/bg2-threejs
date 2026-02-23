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

// -----------------------------------------------------------------------------
// Playtest Mode
// -----------------------------------------------------------------------------

const DEV_MODE_STORAGE_KEY = "devModeEnabled";
const PLAYTEST_SETTINGS_STORAGE_KEY = "playtestSettings";

export interface PlaytestSettings {
    unlockAllSkills: boolean;
    skipDialogs: boolean;
}

const DEFAULT_PLAYTEST_SETTINGS: PlaytestSettings = {
    unlockAllSkills: false,
    skipDialogs: true,
};

function sanitizePlaytestSettings(raw: unknown): PlaytestSettings | null {
    if (!raw || typeof raw !== "object") return null;
    const candidate = raw as Partial<PlaytestSettings> & { enabled?: unknown };

    // Legacy shape migration: flatten previous master toggle into per-option values.
    if (typeof candidate.enabled === "boolean") {
        const legacyUnlockAllSkills = typeof candidate.unlockAllSkills === "boolean"
            ? candidate.unlockAllSkills
            : DEFAULT_PLAYTEST_SETTINGS.unlockAllSkills;
        const legacySkipDialogs = typeof candidate.skipDialogs === "boolean"
            ? candidate.skipDialogs
            : DEFAULT_PLAYTEST_SETTINGS.skipDialogs;
        return {
            unlockAllSkills: candidate.enabled && legacyUnlockAllSkills,
            skipDialogs: candidate.enabled && legacySkipDialogs,
        };
    }

    if (typeof candidate.unlockAllSkills !== "boolean") return null;
    if (typeof candidate.skipDialogs !== "boolean") return null;
    return {
        unlockAllSkills: candidate.unlockAllSkills,
        skipDialogs: candidate.skipDialogs,
    };
}

export function loadPlaytestSettings(): PlaytestSettings {
    try {
        const storedPlaytest = localStorage.getItem(PLAYTEST_SETTINGS_STORAGE_KEY);
        if (storedPlaytest !== null) {
            const parsed = sanitizePlaytestSettings(JSON.parse(storedPlaytest));
            if (parsed) {
                return parsed;
            }
        }

        // Legacy migration: carry over prior Dev Mode master toggle.
        const storedDevMode = localStorage.getItem(DEV_MODE_STORAGE_KEY);
        if (storedDevMode !== null && JSON.parse(storedDevMode) === true) {
            return {
                unlockAllSkills: true,
                skipDialogs: true,
            };
        }
    } catch { /* ignore */ }

    return { ...DEFAULT_PLAYTEST_SETTINGS };
}

export function savePlaytestSettings(settings: PlaytestSettings): void {
    try {
        localStorage.setItem(PLAYTEST_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    } catch { /* ignore */ }
}
