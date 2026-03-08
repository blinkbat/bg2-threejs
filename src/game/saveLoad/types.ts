import type { CharacterEquipment, PartyInventory, CharacterStats, StatusEffect, SummonType } from "../../core/types";
import type { AreaId } from "../areas";
import type { HotbarAssignments } from "../../hooks/localStorage";

/** Persisted player data - matches PersistedPlayer in App.tsx */
export interface SavedPlayer {
    id: number;
    hp: number;
    x?: number;
    z?: number;
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

export type DialogTriggerProgress = Partial<Record<AreaId, string[]>>;
export type EnemyPositionMap = Partial<Record<string, { x: number; z: number }>>;

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

    // Dialog progression state by area
    dialogTriggerProgress?: DialogTriggerProgress;
    // Current-area static enemy spawn positions keyed by `${areaId}-${spawnIndex}`
    enemyPositions?: EnemyPositionMap;
}

/** Storage structure in localStorage */
export interface SaveGameStorage {
    slots: (SaveSlotData | null)[];
}

type SaveLoadErrorCode =
    | "invalid_slot"
    | "storage_unavailable"
    | "storage_corrupted"
    | "save_not_found"
    | "version_unsupported"
    | "invalid_save_data"
    | "unknown_area";

interface SaveLoadSuccess {
    ok: true;
}

export interface SaveLoadFailure {
    ok: false;
    error: string;
    code: SaveLoadErrorCode;
}

export type SaveLoadOperationResult = SaveLoadSuccess | SaveLoadFailure;

interface SaveLoadDataSuccess {
    ok: true;
    data: SaveSlotData;
}

export type SaveLoadDataResult = SaveLoadDataSuccess | SaveLoadFailure;
