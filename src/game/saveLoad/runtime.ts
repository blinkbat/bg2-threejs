import type { CharacterEquipment, PartyInventory } from "../../core/types";
import type { HotbarAssignments } from "../../hooks/localStorage";
import type { AreaId } from "../areas";
import { SAVE_VERSION } from "./constants";
import type { DialogTriggerProgress, SaveLoadFailure, SaveSlotData, SavedPlayer } from "./types";

interface SaveSnapshotState {
    players: SavedPlayer[];
    currentAreaId: AreaId;
    openedChests: Set<string>;
    openedSecretDoors: Set<string>;
    killedEnemies: Set<string>;
    gold: number;
    hotbarAssignments: HotbarAssignments;
    formationOrder: number[];
    dialogTriggerProgress: DialogTriggerProgress;
}

interface BuildSaveSlotDataInput {
    timestamp: number;
    slotName: string;
    state: SaveSnapshotState;
    equipment: Record<number, CharacterEquipment>;
    inventory: PartyInventory;
}

interface LoadableAreaDefinition {
    defaultSpawn: { x: number; z: number };
}

interface ResolvedLoadedSaveState {
    areaId: AreaId;
    spawnPoint: { x: number; z: number };
    players: SavedPlayer[];
    openedChests: Set<string>;
    openedSecretDoors: Set<string>;
    killedEnemies: Set<string>;
    gold: number;
    equipment: Record<number, CharacterEquipment>;
    inventory: PartyInventory;
    hotbarAssignments?: HotbarAssignments;
    formationOrder?: number[];
    dialogTriggerProgress: DialogTriggerProgress;
}

type ResolveLoadedSaveResult =
    | { ok: true; data: ResolvedLoadedSaveState }
    | SaveLoadFailure;

function createFailure(code: SaveLoadFailure["code"], error: string): SaveLoadFailure {
    return { ok: false, code, error };
}

function cloneEquipment(equipment: CharacterEquipment): CharacterEquipment {
    return {
        armor: equipment.armor,
        leftHand: equipment.leftHand,
        rightHand: equipment.rightHand,
        accessory1: equipment.accessory1,
        accessory2: equipment.accessory2,
    };
}

function cloneEquipmentMap(source: Record<number, CharacterEquipment>): Record<number, CharacterEquipment> {
    const clone: Record<number, CharacterEquipment> = {};
    for (const [unitId, equipment] of Object.entries(source)) {
        clone[Number(unitId)] = cloneEquipment(equipment);
    }
    return clone;
}

function cloneInventory(inventory: PartyInventory): PartyInventory {
    return {
        items: inventory.items.map(entry => ({ ...entry })),
    };
}

function cloneHotbarAssignments(assignments: HotbarAssignments): HotbarAssignments {
    const clone: HotbarAssignments = {};
    for (const [unitId, slots] of Object.entries(assignments)) {
        clone[Number(unitId)] = slots.map(slot => slot);
    }
    return clone;
}

function normalizeStringArray(values: readonly string[]): string[] {
    const unique = new Set<string>();
    const normalized: string[] = [];
    for (const value of values) {
        const trimmed = value.trim();
        if (trimmed.length === 0 || unique.has(trimmed)) continue;
        unique.add(trimmed);
        normalized.push(trimmed);
    }
    return normalized;
}

function normalizeDialogTriggerProgress(progress: DialogTriggerProgress | undefined): DialogTriggerProgress {
    const normalized: DialogTriggerProgress = {};
    if (!progress) return normalized;

    for (const [areaId, triggerIds] of Object.entries(progress)) {
        const trimmedAreaId = areaId.trim();
        if (trimmedAreaId.length === 0) continue;
        if (!Array.isArray(triggerIds)) continue;
        const normalizedTriggerIds = normalizeStringArray(triggerIds);
        if (normalizedTriggerIds.length === 0) continue;
        normalized[trimmedAreaId] = normalizedTriggerIds;
    }

    return normalized;
}

export function buildSaveSlotData(input: BuildSaveSlotDataInput): SaveSlotData {
    const { timestamp, slotName, state, equipment, inventory } = input;

    return {
        version: SAVE_VERSION,
        timestamp,
        slotName,
        players: state.players.map(player => ({ ...player })),
        currentAreaId: state.currentAreaId,
        openedChests: Array.from(state.openedChests),
        openedSecretDoors: Array.from(state.openedSecretDoors),
        killedEnemies: Array.from(state.killedEnemies),
        gold: state.gold,
        equipment: cloneEquipmentMap(equipment),
        inventory: cloneInventory(inventory),
        hotbarAssignments: cloneHotbarAssignments(state.hotbarAssignments),
        formationOrder: [...state.formationOrder],
        dialogTriggerProgress: normalizeDialogTriggerProgress(state.dialogTriggerProgress),
    };
}

function isValidSpawn(spawn: { x: number; z: number } | undefined): spawn is { x: number; z: number } {
    if (!spawn) return false;
    return Number.isFinite(spawn.x) && Number.isFinite(spawn.z);
}

export function resolveLoadedSaveState(
    saveData: SaveSlotData,
    areas: Record<string, LoadableAreaDefinition>
): ResolveLoadedSaveResult {
    const area = areas[saveData.currentAreaId];
    if (!area || !isValidSpawn(area.defaultSpawn)) {
        return createFailure("unknown_area", `Save references unknown area "${saveData.currentAreaId}".`);
    }

    return {
        ok: true,
        data: {
            areaId: saveData.currentAreaId,
            spawnPoint: { x: area.defaultSpawn.x, z: area.defaultSpawn.z },
            players: saveData.players.map(player => ({ ...player })),
            openedChests: new Set(saveData.openedChests),
            openedSecretDoors: new Set(saveData.openedSecretDoors),
            killedEnemies: new Set(saveData.killedEnemies),
            gold: saveData.gold,
            equipment: cloneEquipmentMap(saveData.equipment),
            inventory: cloneInventory(saveData.inventory),
            hotbarAssignments: saveData.hotbarAssignments ? cloneHotbarAssignments(saveData.hotbarAssignments) : undefined,
            formationOrder: saveData.formationOrder ? [...saveData.formationOrder] : undefined,
            dialogTriggerProgress: normalizeDialogTriggerProgress(saveData.dialogTriggerProgress),
        },
    };
}
