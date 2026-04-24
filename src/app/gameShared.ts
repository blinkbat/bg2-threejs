import type {
    LootPickupRequest,
    StatusEffect,
    Unit,
} from "../core/types";
import type { AreaId } from "../game/areas";
import type { HotbarAssignments } from "../hooks/hotbarStorage";
import type { DialogTriggerProgress } from "../game/saveLoad";
import type { FogVisibilityByArea } from "../game/fogMemory";
import type { DialogDefinition, MenuChainAction } from "../dialog/types";
import type { PersistedPlayer } from "./gameSetup";
import monkPortrait from "../assets/monk-portrait.png";
import barbarianPortrait from "../assets/barbarian-portrait.png";
import wizardPortrait from "../assets/wizard-portrait.png";
import paladinPortrait from "../assets/paladin-portrait.png";
import thiefPortrait from "../assets/thief-portrait.png";
import clericPortrait from "../assets/cleric-portrait.png";

export const PORTRAIT_URLS = [
    monkPortrait,
    barbarianPortrait,
    wizardPortrait,
    paladinPortrait,
    thiefPortrait,
    clericPortrait,
];

export interface GameProps {
    onRestart: () => void;
    onAreaTransition: (
        players: PersistedPlayer[],
        targetArea: AreaId,
        spawn: { x: number; z: number },
        direction?: "north" | "south" | "east" | "west"
    ) => void;
    onShowControls: (options?: { chainAction?: MenuChainAction }) => void;
    onShowHelp: (options?: { chainAction?: MenuChainAction }) => void;
    onShowGlossary: (options?: { chainAction?: MenuChainAction }) => void;
    onShowBestiary: () => void;
    onCloseInfoModal: () => void;
    infoModalOpen: boolean;
    saveLoadOpen: boolean;
    menuOpen: boolean;
    jukeboxOpen: boolean;
    persistedPlayers: PersistedPlayer[] | null;
    spawnPoint: { x: number; z: number } | null;
    spawnDirection?: "north" | "south" | "east" | "west";
    onSaveClick: (options?: { chainAction?: MenuChainAction }) => void;
    onLoadClick: (options?: { chainAction?: MenuChainAction }) => void;
    onOpenMenu: (options?: { chainAction?: MenuChainAction }) => void;
    onCloseMenu: () => void;
    onOpenJukebox: (options?: { chainAction?: MenuChainAction }) => void;
    onCloseJukebox: () => void;
    onOpenEquipment: (options?: { chainAction?: MenuChainAction }) => void;
    onCloseEquipment: () => void;
    gameStateRef: React.MutableRefObject<(() => SaveableGameState) | null>;
    startDialogRef: React.MutableRefObject<((definition: DialogDefinition) => void) | null>;
    initialOpenedChests: Set<string> | null;
    initialOpenedSecretDoors: Set<string> | null;
    initialActivatedWaystones: Set<string> | null;
    initialGold: number | null;
    initialKilledEnemies: Set<string> | null;
    initialEnemyPositions: Partial<Record<string, { x: number; z: number }>> | null;
    initialDialogTriggerProgress: DialogTriggerProgress | null;
    initialLastWaystone?: { areaId: AreaId; waystoneIndex: number } | null;
    dialogTriggersEnabled: boolean;
    skipNextFogSaveOnUnmountRef: React.MutableRefObject<boolean>;
    onReady?: () => void;
}

export interface SaveableGameState {
    players: PersistedPlayer[];
    currentAreaId: AreaId;
    openedChests: Set<string>;
    openedSecretDoors: Set<string>;
    activatedWaystones: Set<string>;
    gold: number;
    killedEnemies: Set<string>;
    enemyPositions: Partial<Record<string, { x: number; z: number }>>;
    hotbarAssignments: HotbarAssignments;
    formationOrder: number[];
    dialogTriggerProgress: DialogTriggerProgress;
    fogVisibilityByArea: FogVisibilityByArea;
    saveLockReason: string | null;
    lastWaystone?: { areaId: AreaId; waystoneIndex: number };
}

export interface LightingTuningSettings {
    shadowsEnabled: boolean;
    exposureScale: number;
    ambientScale: number;
    hemisphereScale: number;
    directionalScale: number;
    shadowRadius: number;
    shadowBias: number;
    shadowNormalBias: number;
    spriteEmissiveScale: number;
    spriteRoughness: number;
    spriteMetalness: number;
}

export type LootPickupModalState = Pick<LootPickupRequest, "sourceLabel" | "entries">;

export const DEFAULT_LIGHTING_TUNING: LightingTuningSettings = {
    shadowsEnabled: false,
    exposureScale: 0.88,
    ambientScale: 1.5,
    hemisphereScale: 0,
    directionalScale: 0.91,
    shadowRadius: 2,
    shadowBias: -0.00115,
    shadowNormalBias: 0.007,
    spriteEmissiveScale: 0.7,
    spriteRoughness: 0.82,
    spriteMetalness: 0,
};

export const DIALOG_TYPING_INTERVAL_MS = 18;
export const DIALOG_CHARS_PER_TICK = 3;
export const DIALOG_MIN_BLIP_INTERVAL_MS = 38;
export const DIALOG_TRIGGER_REPEAT_GUARD_MS = 1500;
export const DIALOG_PARTY_GATHERED_DEFAULT_MAX_DISTANCE = 8;
export const SPEND_NIGHT_FADE_MS = 1200;
export const SPEND_NIGHT_BLACK_HOLD_MS = 600;
export const DIALOG_TRIGGER_POLL_MS = 120;

export function getWaystoneActivationKey(areaId: AreaId, waystoneIndex: number): string {
    return `${areaId}-waystone-${waystoneIndex}`;
}

export function cloneDialogTriggerProgressForRuntime(
    progress: DialogTriggerProgress | null
): Record<string, Set<string>> {
    const clone: Record<string, Set<string>> = {};
    if (!progress) return clone;

    for (const [areaId, triggerIds] of Object.entries(progress)) {
        clone[areaId] = new Set(triggerIds);
    }

    return clone;
}

export function serializeDialogTriggerProgressForSave(
    progress: Record<string, Set<string>>
): DialogTriggerProgress {
    const serialized: DialogTriggerProgress = {};
    for (const [areaId, triggerIds] of Object.entries(progress)) {
        if (triggerIds.size === 0) continue;
        serialized[areaId] = Array.from(triggerIds);
    }
    return serialized;
}

function formatStatusEffectLabel(statusType: StatusEffect["type"]): string {
    return statusType
        .split("_")
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
}

export function buildDialogTriggerUnitsSnapshot(
    units: Unit[],
    unitGroups: Record<number, { position: { x: number; z: number } }>
): Unit[] {
    const snapshot: Unit[] = [];

    for (const unit of units) {
        const group = unitGroups[unit.id];
        if (!group) {
            snapshot.push(unit);
            continue;
        }

        const liveX = group.position.x;
        const liveZ = group.position.z;
        if (unit.x === liveX && unit.z === liveZ) {
            snapshot.push(unit);
            continue;
        }

        snapshot.push({
            ...unit,
            x: liveX,
            z: liveZ,
        });
    }

    return snapshot;
}

export function getPrimaryStatusLabel(statusEffects: StatusEffect[] | undefined): string | null {
    if (!statusEffects || statusEffects.length === 0) return null;
    return formatStatusEffectLabel(statusEffects[0].type);
}
