// =============================================================================
// LOCAL STORAGE - Persistent UI state independent of save/load game slots
// =============================================================================

// -----------------------------------------------------------------------------
// Hotbar Assignments
// -----------------------------------------------------------------------------

export type HotbarAssignments = Record<number, (string | null)[]>;

const HOTBAR_STORAGE_KEY = "skillHotbarAssignments";
const HOTBAR_SLOT_COUNT = 5;
const FORMATION_STORAGE_KEY = "formationOrder";
const AUTO_PAUSE_SETTINGS_STORAGE_KEY = "autoPauseSettings";

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeHotbarAssignments(raw: unknown): HotbarAssignments {
    if (!isRecord(raw)) return {};

    const sanitized: HotbarAssignments = {};
    for (const [unitIdRaw, slotsRaw] of Object.entries(raw)) {
        const unitId = Number(unitIdRaw);
        if (!Number.isFinite(unitId) || unitId <= 0) continue;
        if (!Array.isArray(slotsRaw)) continue;

        const slots: (string | null)[] = [];
        for (let i = 0; i < HOTBAR_SLOT_COUNT; i++) {
            const value = slotsRaw[i];
            if (typeof value === "string") {
                const trimmed = value.trim();
                slots.push(trimmed.length > 0 ? trimmed : null);
            } else {
                slots.push(null);
            }
        }

        sanitized[Math.floor(unitId)] = slots;
    }

    return sanitized;
}

function sanitizeFormationOrder(raw: unknown): number[] {
    if (!Array.isArray(raw)) return [];

    const sanitized: number[] = [];
    const seen = new Set<number>();
    for (const value of raw) {
        if (typeof value !== "number" || !Number.isFinite(value)) continue;
        const unitId = Math.floor(value);
        if (unitId <= 0 || seen.has(unitId)) continue;
        seen.add(unitId);
        sanitized.push(unitId);
    }

    return sanitized;
}

export function loadHotbarAssignments(): HotbarAssignments {
    try {
        const stored = localStorage.getItem(HOTBAR_STORAGE_KEY);
        if (stored) return sanitizeHotbarAssignments(JSON.parse(stored));
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

export function loadFormationOrder(): number[] {
    try {
        const stored = localStorage.getItem(FORMATION_STORAGE_KEY);
        if (stored) return sanitizeFormationOrder(JSON.parse(stored));
    } catch { /* ignore */ }
    return [];
}

export function saveFormationOrder(order: number[]): void {
    try {
        localStorage.setItem(FORMATION_STORAGE_KEY, JSON.stringify(order));
    } catch { /* ignore */ }
}

// -----------------------------------------------------------------------------
// Auto-Pause Settings
// -----------------------------------------------------------------------------

export interface AutoPauseSettings {
    enemySighted: boolean;
    allyNearDeath: boolean;
    allyKilled: boolean;
}

const DEFAULT_AUTO_PAUSE_SETTINGS: AutoPauseSettings = {
    enemySighted: false,
    allyNearDeath: false,
    allyKilled: false,
};

function sanitizeAutoPauseSettings(raw: unknown): AutoPauseSettings | null {
    if (!isRecord(raw)) return null;

    return {
        enemySighted: typeof raw.enemySighted === "boolean"
            ? raw.enemySighted
            : DEFAULT_AUTO_PAUSE_SETTINGS.enemySighted,
        allyNearDeath: typeof raw.allyNearDeath === "boolean"
            ? raw.allyNearDeath
            : DEFAULT_AUTO_PAUSE_SETTINGS.allyNearDeath,
        allyKilled: typeof raw.allyKilled === "boolean"
            ? raw.allyKilled
            : DEFAULT_AUTO_PAUSE_SETTINGS.allyKilled,
    };
}

export function loadAutoPauseSettings(): AutoPauseSettings {
    try {
        const stored = localStorage.getItem(AUTO_PAUSE_SETTINGS_STORAGE_KEY);
        if (stored !== null) {
            const parsed = sanitizeAutoPauseSettings(JSON.parse(stored));
            if (parsed) {
                return parsed;
            }
        }
    } catch { /* ignore */ }

    return { ...DEFAULT_AUTO_PAUSE_SETTINGS };
}

export function saveAutoPauseSettings(settings: AutoPauseSettings): void {
    try {
        localStorage.setItem(AUTO_PAUSE_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
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
