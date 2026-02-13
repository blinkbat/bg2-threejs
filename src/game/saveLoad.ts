// =============================================================================
// SAVE/LOAD SYSTEM - Persistence for game state
// =============================================================================

import type { CharacterEquipment, PartyInventory, CharacterStats, StatusEffect, SummonType } from "../core/types";
import type { AreaId } from "./areas";
import type { HotbarAssignments } from "../hooks/localStorage";

// =============================================================================
// CONSTANTS
// =============================================================================

export const SAVE_VERSION = 1;
export const STORAGE_KEY = "bg2-threejs-saves";
export const MAX_SLOTS = 3;

// =============================================================================
// TYPES
// =============================================================================

/** Persisted player data - matches PersistedPlayer in App.tsx */
export interface SavedPlayer {
    id: number;
    hp: number;
    mana?: number;
    level?: number;
    exp?: number;
    stats?: CharacterStats;
    statPoints?: number;
    skillPoints?: number;
    learnedSkills?: string[];
    statusEffects?: StatusEffect[];
    cantripUses?: Record<string, number>;
    summonType?: SummonType;
    summonedBy?: number;
}

/** Complete save slot data */
export interface SaveSlotData {
    version: number;
    timestamp: number;
    slotName: string;

    // Player state
    players: SavedPlayer[];

    // World progression
    currentAreaId: AreaId;
    openedChests: string[];
    openedSecretDoors: string[];
    killedEnemies: string[];
    gold: number;

    // Equipment & inventory
    equipment: Record<number, CharacterEquipment>;
    inventory: PartyInventory;

    // UI state (optional for backwards compat with old saves)
    hotbarAssignments?: HotbarAssignments;
    formationOrder?: number[];
}

/** Minimal slot info for UI display */
export interface SaveSlotInfo {
    slotName: string;
    timestamp: number;
    partyLevel: number;
    areaId: AreaId;
}

/** Storage structure in localStorage */
interface SaveGameStorage {
    slots: (SaveSlotData | null)[];
}

// =============================================================================
// CORE FUNCTIONS
// =============================================================================

/** Get all save slots from localStorage */
export function getSaveSlots(): (SaveSlotData | null)[] {
    try {
        const data = localStorage.getItem(STORAGE_KEY);
        if (!data) {
            return Array(MAX_SLOTS).fill(null);
        }
        const storage: SaveGameStorage = JSON.parse(data);
        // Ensure we have exactly MAX_SLOTS
        while (storage.slots.length < MAX_SLOTS) {
            storage.slots.push(null);
        }
        return storage.slots.slice(0, MAX_SLOTS);
    } catch (e) {
        console.error("Failed to load save slots:", e);
        return Array(MAX_SLOTS).fill(null);
    }
}

/** Get a single save slot */
export function loadGame(slot: number): SaveSlotData | null {
    if (slot < 0 || slot >= MAX_SLOTS) {
        console.error("Invalid slot number:", slot);
        return null;
    }
    const slots = getSaveSlots();
    return slots[slot] ?? null;
}

/** Save game to a slot */
export function saveGame(slot: number, state: SaveSlotData): boolean {
    if (slot < 0 || slot >= MAX_SLOTS) {
        console.error("Invalid slot number:", slot);
        return false;
    }
    try {
        const slots = getSaveSlots();
        slots[slot] = {
            ...state,
            version: SAVE_VERSION,
            timestamp: Date.now()
        };
        const storage: SaveGameStorage = { slots };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(storage));
        return true;
    } catch (e) {
        console.error("Failed to save game:", e);
        return false;
    }
}

/** Delete a save slot */
export function deleteSave(slot: number): boolean {
    if (slot < 0 || slot >= MAX_SLOTS) {
        console.error("Invalid slot number:", slot);
        return false;
    }
    try {
        const slots = getSaveSlots();
        slots[slot] = null;
        const storage: SaveGameStorage = { slots };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(storage));
        return true;
    } catch (e) {
        console.error("Failed to delete save:", e);
        return false;
    }
}

// =============================================================================
// HELPERS
// =============================================================================

/** Format timestamp for display */
export function formatSaveTimestamp(timestamp: number): string {
    const date = new Date(timestamp);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();

    if (isToday) {
        return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }

    return date.toLocaleDateString([], {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit"
    });
}

/** Get average party level for display */
export function getPartyLevel(players: SavedPlayer[]): number {
    const corePlayers = players.filter(p => !p.summonType);
    if (corePlayers.length === 0) return 1;
    const total = corePlayers.reduce((sum, p) => sum + (p.level ?? 1), 0);
    return Math.round(total / corePlayers.length);
}

/** Get slot display info */
export function getSlotInfo(slot: SaveSlotData | null): SaveSlotInfo | null {
    if (!slot) return null;
    return {
        slotName: slot.slotName,
        timestamp: slot.timestamp,
        partyLevel: getPartyLevel(slot.players),
        areaId: slot.currentAreaId
    };
}

/** Get human-readable area name */
export function getAreaDisplayName(areaId: AreaId): string {
    const names: Record<AreaId, string> = {
        coast: "The Coast",
        forest: "The Forest",
        dungeon: "Kobold Warrens",
        ruins: "Ancient Ruins",
        sanctum: "The Sanctum",
        cliffs: "Coastal Cliffs",
        magma_cave: "The Magma Cave"
    };
    return names[areaId] ?? areaId;
}
