import { MAX_SLOTS, SAVE_VERSION, STORAGE_KEY } from "./constants";
import { normalizeSlots, parseSaveSlotData } from "./sanitize";
import type {
    SaveGameStorage,
    SaveLoadDataResult,
    SaveLoadFailure,
    SaveLoadOperationResult,
    SaveSlotData,
} from "./types";

function createFailure(code: SaveLoadFailure["code"], error: string): SaveLoadFailure {
    return { ok: false, code, error };
}

function buildEmptySlots(): (SaveSlotData | null)[] {
    return Array(MAX_SLOTS).fill(null);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRawSlots(): { ok: true; rawSlots: unknown } | SaveLoadFailure {
    try {
        const data = localStorage.getItem(STORAGE_KEY);
        if (!data) {
            return { ok: true, rawSlots: [] };
        }

        const parsed: unknown = JSON.parse(data);
        if (!isRecord(parsed)) {
            return createFailure("storage_corrupted", "Save storage data is corrupted.");
        }

        return { ok: true, rawSlots: parsed.slots };
    } catch (error) {
        if (error instanceof SyntaxError) {
            return createFailure("storage_corrupted", "Save storage data is corrupted.");
        }
        return createFailure("storage_unavailable", "Save storage is unavailable.");
    }
}

function writeSlots(slots: (SaveSlotData | null)[]): SaveLoadOperationResult {
    try {
        const storage: SaveGameStorage = { slots: slots.slice(0, MAX_SLOTS) };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(storage));
        return { ok: true };
    } catch {
        return createFailure("storage_unavailable", "Failed to write save data to local storage.");
    }
}

function isSlotIndexValid(slot: number): boolean {
    return Number.isInteger(slot) && slot >= 0 && slot < MAX_SLOTS;
}

/** Get all save slots from localStorage */
export function getSaveSlots(): (SaveSlotData | null)[] {
    const raw = readRawSlots();
    if (!raw.ok) {
        console.error(raw.error);
        return buildEmptySlots();
    }

    return normalizeSlots(raw.rawSlots);
}

/** Check whether any save slots currently contain save data. */
export function hasAnySaveSlots(): boolean {
    return getSaveSlots().some(slot => slot !== null);
}

/** Get a single save slot */
export function loadGame(slot: number): SaveLoadDataResult {
    if (!isSlotIndexValid(slot)) {
        return createFailure("invalid_slot", `Invalid slot number: ${slot}`);
    }

    const raw = readRawSlots();
    if (!raw.ok) {
        return raw;
    }

    const sourceSlots = Array.isArray(raw.rawSlots) ? raw.rawSlots : [];
    const rawSlot = sourceSlots[slot];
    if (rawSlot === null || rawSlot === undefined) {
        return createFailure("save_not_found", `No save found in slot ${slot + 1}.`);
    }

    const parsed = parseSaveSlotData(rawSlot);
    if (!parsed.ok) {
        if (parsed.code === "version_unsupported") {
            return createFailure("version_unsupported", "This save was created by a newer game version.");
        }
        return createFailure("invalid_save_data", "This save is invalid or corrupted.");
    }

    return { ok: true, data: parsed.data };
}

/** Save game to a slot */
export function saveGame(slot: number, state: SaveSlotData): SaveLoadOperationResult {
    if (!isSlotIndexValid(slot)) {
        return createFailure("invalid_slot", `Invalid slot number: ${slot}`);
    }

    const parsed = parseSaveSlotData(state);
    if (!parsed.ok) {
        return createFailure("invalid_save_data", "Cannot save invalid game data.");
    }

    const slots = getSaveSlots();
    slots[slot] = {
        ...parsed.data,
        version: SAVE_VERSION,
        timestamp: Date.now(),
    };

    return writeSlots(slots);
}

/** Delete a save slot */
export function deleteSave(slot: number): SaveLoadOperationResult {
    if (!isSlotIndexValid(slot)) {
        return createFailure("invalid_slot", `Invalid slot number: ${slot}`);
    }

    const slots = getSaveSlots();
    slots[slot] = null;

    return writeSlots(slots);
}
