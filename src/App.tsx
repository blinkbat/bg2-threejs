/**
 * BG2-STYLE ISOMETRIC TACTICS
 * Main game component - orchestrates Three.js scene and game loop via hooks
 */

import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";
import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import * as THREE from "three";

// Constants & Types
import { BUFF_TICK_INTERVAL, COLORS, getSkillTextColor, setDebugSpeedMultiplier } from "./core/constants";
import type { Unit, Skill, CombatLogEntry, SelectionBox, CharacterStats, StatusEffect, EquipmentSlot, LootPickupRequest } from "./core/types";

// Game Logic
import { getCurrentArea, getCurrentAreaId, setCurrentArea, AREAS, DEFAULT_STARTING_AREA, type AreaId, type AreaTransition, type Waystone } from "./game/areas";
import { UNIT_DATA, CORE_PLAYER_IDS, getEffectiveMaxHp, getEffectiveMaxMana, getXpForLevel, isCorePlayerId } from "./game/playerUnits";
import { LEVEL_UP_HP, LEVEL_UP_MANA, LEVEL_UP_STAT_POINTS, LEVEL_UP_SKILL_POINTS, HP_PER_VITALITY, MP_PER_INTELLIGENCE } from "./game/statBonuses";
import { ENEMY_STATS, getMonsterTypeLabel, isEnemyPermanentDeath } from "./game/enemyStats";
import { SKILLS } from "./game/skills";
import { formatRolledEnemyLootSummary, rollEnemyLoot } from "./game/enemyLoot";
import {
    initializeEquipmentState,
    getPartyInventory,
    setPartyInventory,
    getAllEquipment,
    setAllEquipment,
    equipItemForCharacter,
    unequipItemForCharacter,
    moveEquippedItemForCharacter
} from "./game/equipmentState";
import { hasInInventory, removeFromInventory } from "./game/equipment";
import { getItem } from "./game/items";
import { isConsumable } from "./core/types";
import { updateChestStates } from "./rendering/scene";
import { soundFns } from "./audio";
import { updateUnit, updateUnitWith, updateUnitsWhere, createLiveUnitsDispatch } from "./core/stateUtils";
import { createUnitsForArea as createAreaUnits, type PersistedPlayer } from "./app/gameSetup";

// Extracted modules
import { executeSkill, type SkillExecutionContext } from "./combat/skills";
import { applyPoison, applyStatusEffect, getIncapacitatingStatus } from "./combat/combatMath";
import { setupTargetingMode } from "./input";
import { createLightningPillar } from "./combat/damageEffects";
import { spawnLootBag } from "./gameLoop";
import { clearPathCache, invalidateDynamicObstacles } from "./ai/pathfinding";
import {
    togglePause,
    processActionQueue,
    handleTargetingOnUnit,
    stopSelectedUnits,
    toggleHoldPositionForSelectedUnits,
    type ActionQueue
} from "./input";

// Hooks
import { useThreeScene, useGameLoop, useInputHandlers, type InitializedSceneState, type InputGameRefs, type PerfFrameSample } from "./hooks";

// UI Components
import { PartyBar } from "./components/PartyBar";
import { CommandBar } from "./components/CommandBar";
import { UnitPanel } from "./components/UnitPanel";
import { EquipmentModal } from "./components/EquipmentModal";
import type { HotbarAssignments } from "./hooks/hotbarStorage";
import { loadHotbarAssignments, saveHotbarAssignments } from "./hooks/hotbarStorage";
import { loadPlaytestSettings, savePlaytestSettings, type PlaytestSettings } from "./hooks/localStorage";
import { CombatLog } from "./components/CombatLog";
import { HUD } from "./components/HUD";
import { FormationIndicator } from "./components/FormationIndicator";
import { loadFormationOrder, saveFormationOrder } from "./hooks/formationStorage";
import { ControlsModal } from "./components/ControlsModal";
import { GlossaryModal } from "./components/GlossaryModal";
import { HelpModal } from "./components/HelpModal";
import { SaveLoadModal } from "./components/SaveLoadModal";
import { DialogModal } from "./components/DialogModal";
import { LootPickupModal } from "./components/LootPickupModal";
import { WaystoneTravelModal, type WaystoneDestination } from "./components/WaystoneTravelModal";
import {
    type DialogTriggerProgress,
    type SaveLoadOperationResult,
    type SaveSlotData,
    buildSaveSlotData,
    deleteSave,
    getSaveSlots,
    loadGame,
    resolveLoadedSaveState,
    saveGame
} from "./game/saveLoad";
import {
    captureFogVisibilityMemory,
    clearFogVisibilityMemory,
    restoreFogVisibilityMemory,
    type FogVisibilityByArea,
} from "./game/fogMemory";
import { buildAreaDialogDefinitionMap } from "./dialog/areaDialogs";
import { getDialogDefinitionById } from "./dialog/registry";
import { getUnitRadius, isInRange } from "./rendering/range";
import {
    getDialogTriggerPriority,
    getTriggerStartDialogId,
    isDialogTriggerSatisfied,
    type DialogTriggerRuntimeState
} from "./dialog/triggerRuntime";
import type { DialogChoiceCondition, DialogDefinition, DialogNode, DialogSpeaker, DialogState, DialogUiAction, MenuChainAction } from "./dialog/types";
import {
    formatPerfLogLine,
    PERF_LOG_BUFFER_LIMIT,
    PERF_LOG_ENDPOINT,
    PERF_LOG_FLUSH_INTERVAL_MS,
    preloadPortraits,
    reviveUnitVisual,
    STAT_BOOST_AMOUNT,
    syncHoveredDoorRef,
    ZERO_STATS,
} from "./app/helpers";
import monkPortrait from "./assets/monk-portrait.png";
import barbarianPortrait from "./assets/barbarian-portrait.png";
import wizardPortrait from "./assets/wizard-portrait.png";
import paladinPortrait from "./assets/paladin-portrait.png";
import thiefPortrait from "./assets/thief-portrait.png";
import clericPortrait from "./assets/cleric-portrait.png";

const PORTRAIT_URLS = [monkPortrait, barbarianPortrait, wizardPortrait, paladinPortrait, thiefPortrait, clericPortrait];

// =============================================================================
// TYPES
// =============================================================================

interface GameProps {
    onRestart: () => void;
    onAreaTransition: (players: PersistedPlayer[], targetArea: AreaId, spawn: { x: number; z: number }, direction?: "north" | "south" | "east" | "west") => void;
    onShowControls: (options?: { chainAction?: MenuChainAction }) => void;
    onShowHelp: (options?: { chainAction?: MenuChainAction }) => void;
    onShowGlossary: (options?: { chainAction?: MenuChainAction }) => void;
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

interface SaveableGameState {
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

interface LightingTuningSettings {
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

type LootPickupModalState = Pick<LootPickupRequest, "sourceLabel" | "entries">;

function getWaystoneActivationKey(areaId: AreaId, waystoneIndex: number): string {
    return `${areaId}-waystone-${waystoneIndex}`;
}


const DEFAULT_LIGHTING_TUNING: LightingTuningSettings = {
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
    spriteMetalness: 0
};

const DIALOG_TYPING_INTERVAL_MS = 18;
const DIALOG_CHARS_PER_TICK = 3;
const DIALOG_MIN_BLIP_INTERVAL_MS = 38;
const DIALOG_TRIGGER_REPEAT_GUARD_MS = 1500;
const DIALOG_PARTY_GATHERED_DEFAULT_MAX_DISTANCE = 8;
const SPEND_NIGHT_FADE_MS = 1200;
const SPEND_NIGHT_BLACK_HOLD_MS = 600;
const DIALOG_TRIGGER_SNAPSHOT_HASH_SEED = 2166136261;
const DIALOG_TRIGGER_SNAPSHOT_HASH_PRIME = 16777619;
const DIALOG_TRIGGER_POSITION_QUANT = 4;

function cloneDialogTriggerProgressForRuntime(progress: DialogTriggerProgress | null): Record<string, Set<string>> {
    const clone: Record<string, Set<string>> = {};
    if (!progress) return clone;

    for (const [areaId, triggerIds] of Object.entries(progress)) {
        clone[areaId] = new Set(triggerIds);
    }

    return clone;
}

function serializeDialogTriggerProgressForSave(progress: Record<string, Set<string>>): DialogTriggerProgress {
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

function getDialogTriggerTeamCode(team: Unit["team"]): number {
    if (team === "player") return 1;
    if (team === "enemy") return 2;
    return 3;
}

function buildDialogTriggerUnitsHash(
    units: Unit[],
    unitGroups: Record<number, { position: { x: number; z: number } }>
): number {
    let hash = Math.imul(
        DIALOG_TRIGGER_SNAPSHOT_HASH_SEED ^ units.length,
        DIALOG_TRIGGER_SNAPSHOT_HASH_PRIME
    );

    for (const unit of units) {
        const group = unitGroups[unit.id];
        const x = group?.position.x ?? unit.x;
        const z = group?.position.z ?? unit.z;
        const qx = Math.round(x * DIALOG_TRIGGER_POSITION_QUANT);
        const qz = Math.round(z * DIALOG_TRIGGER_POSITION_QUANT);

        hash = Math.imul(hash ^ unit.id, DIALOG_TRIGGER_SNAPSHOT_HASH_PRIME);
        hash = Math.imul(hash ^ Math.round(unit.hp), DIALOG_TRIGGER_SNAPSHOT_HASH_PRIME);
        hash = Math.imul(hash ^ getDialogTriggerTeamCode(unit.team), DIALOG_TRIGGER_SNAPSHOT_HASH_PRIME);
        hash = Math.imul(hash ^ qx, DIALOG_TRIGGER_SNAPSHOT_HASH_PRIME);
        hash = Math.imul(hash ^ qz, DIALOG_TRIGGER_SNAPSHOT_HASH_PRIME);
    }

    return hash >>> 0;
}

function buildDialogTriggerUnitsSnapshot(
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

function getPrimaryStatusLabel(statusEffects: StatusEffect[] | undefined): string | null {
    if (!statusEffects || statusEffects.length === 0) return null;
    return formatStatusEffectLabel(statusEffects[0].type);
}

// =============================================================================
// GAME COMPONENT
// =============================================================================

function Game({
    onRestart, onAreaTransition, onShowControls, onShowHelp, onShowGlossary, onCloseInfoModal, infoModalOpen, saveLoadOpen,
    menuOpen, jukeboxOpen,
    persistedPlayers, spawnPoint, spawnDirection, onSaveClick, onLoadClick,
    onOpenMenu, onCloseMenu, onOpenJukebox, onCloseJukebox, onOpenEquipment, onCloseEquipment,
    gameStateRef, startDialogRef,
    initialOpenedChests, initialOpenedSecretDoors, initialActivatedWaystones, initialGold, initialKilledEnemies, initialEnemyPositions, initialDialogTriggerProgress, initialLastWaystone, dialogTriggersEnabled,
    skipNextFogSaveOnUnmountRef, onReady
}: GameProps) {
    const containerRef = useRef<HTMLDivElement>(null);

    // Initial camera offset
    const initialCamOffset = useMemo(() => spawnPoint ?? getCurrentArea().defaultSpawn, [spawnPoint]);
    const [playtestSettings, setPlaytestSettings] = useState<PlaytestSettings>(loadPlaytestSettings);
    const playtestUnlockAllSkills = playtestSettings.unlockAllSkills;
    const playtestSkipDialogs = playtestSettings.skipDialogs;

    // Create initial units
    const createUnitsForArea = useCallback(
        () => createAreaUnits({
            persistedPlayers,
            spawnPoint,
            spawnDirection,
            initialKilledEnemies,
            initialEnemyPositions,
            playtestUnlockAllSkills,
        }),
        [persistedPlayers, spawnPoint, spawnDirection, initialKilledEnemies, initialEnemyPositions, playtestUnlockAllSkills]
    );

    // =============================================================================
    // REACT STATE
    // =============================================================================

    const [units, setUnits] = useState<Unit[]>(createUnitsForArea);
    const [selectedIds, setSelectedIds] = useState<number[]>(() => {
        const persistedAliveIds = (persistedPlayers ?? [])
            .filter(player => player.hp > 0)
            .map(player => player.id);
        return persistedAliveIds.length > 0 ? persistedAliveIds : [...CORE_PLAYER_IDS];
    });
    const [selBox, setSelBox] = useState<SelectionBox | null>(null);
    const [showPanel, setShowPanel] = useState(false);
    const [combatLog, setCombatLog] = useState<CombatLogEntry[]>(() => [{ text: `The party enters ${getCurrentArea().name}.`, color: "#f59e0b" }]);
    const [paused, setPaused] = useState(true);
    const [skillCooldowns, setSkillCooldowns] = useState<Record<string, { end: number; duration: number }>>({});
    const [targetingMode, setTargetingMode] = useState<{ casterId: number; skill: Skill; displacementTargetId?: number } | null>(null);
    const [consumableTargetingMode, setConsumableTargetingMode] = useState<{ userId: number; itemId: string } | null>(null);
    const [queuedActions, setQueuedActions] = useState<{ unitId: number; skillName: string }[]>([]);
    const [hoveredEnemy, setHoveredEnemy] = useState<{ id: number; x: number; y: number } | null>(null);
    const [hoveredChest, setHoveredChest] = useState<{ x: number; y: number; chestIndex: number; chestX: number; chestZ: number } | null>(null);
    const [openedChests, setOpenedChests] = useState<Set<string>>(() => initialOpenedChests ?? new Set());
    const [openedSecretDoors, setOpenedSecretDoors] = useState<Set<string>>(() => initialOpenedSecretDoors ?? new Set());
    const [activatedWaystones, setActivatedWaystones] = useState<Set<string>>(() => initialActivatedWaystones ?? new Set());
    const [gold, setGold] = useState(() => initialGold ?? 30);
    const [killedEnemies, setKilledEnemies] = useState<Set<string>>(() => initialKilledEnemies ?? new Set());
    const [hoveredPlayer, setHoveredPlayer] = useState<{ id: number; x: number; y: number } | null>(null);
    const [hoveredDoor, setHoveredDoor] = useState<{ targetArea: string; x: number; y: number } | null>(null);
    const [hoveredWaystone, setHoveredWaystone] = useState<{ x: number; y: number } | null>(null);
    const [hoveredSecretDoor, setHoveredSecretDoor] = useState<{ x: number; y: number } | null>(null);
    const [hoveredLootBag, setHoveredLootBag] = useState<{ x: number; y: number; gold: number; hasItems: boolean } | null>(null);
    const [fps, setFps] = useState(0);
    const [debug, setDebug] = useState(false);
    const [debugFogOfWarDisabled, setDebugFogOfWarDisabled] = useState(false);
    const [fastMove, setFastMove] = useState(false);
    const [commandMode, setCommandMode] = useState<"attackMove" | null>(null);
    const [hotbarAssignments, setHotbarAssignments] = useState<HotbarAssignments>(loadHotbarAssignments);
    const [formationOrder, setFormationOrder] = useState<number[]>(loadFormationOrder);
    const [lightingTuning, setLightingTuning] = useState<LightingTuningSettings>({ ...DEFAULT_LIGHTING_TUNING });
    const [dialogState, setDialogState] = useState<DialogState | null>(null);
    const [dialogTypedChars, setDialogTypedChars] = useState(0);
    const [sleepFadeOpacity, setSleepFadeOpacity] = useState(0);
    // hudMenuModalOpen replaced by menuOpen/jukeboxOpen props from App
    const [equipmentModalUnitId, setEquipmentModalUnitId] = useState<number | null>(null);
    const [lootPickupModalState, setLootPickupModalState] = useState<LootPickupModalState | null>(null);
    const [waystoneTravelDestinations, setWaystoneTravelDestinations] = useState<WaystoneDestination[] | null>(null);

    // =============================================================================
    // STATE SYNC REFS
    // =============================================================================

    const selectedRef = useRef(selectedIds);
    const unitsStateRef = useRef(units);
    const pausedRef = useRef(paused);
    const pauseToggleLockedRef = useRef(false);
    const targetingModeRef = useRef(targetingMode);
    const consumableTargetingModeRef = useRef(consumableTargetingMode);
    const pauseStartTimeRef = useRef<number | null>(null);
    const showPanelRef = useRef(showPanel);
    const infoModalOpenRef = useRef(infoModalOpen);
    const skillCooldownsRef = useRef(skillCooldowns);
    const openedChestsRef = useRef(openedChests);
    const activatedWaystonesRef = useRef(activatedWaystones);
    const hotbarAssignmentsRef = useRef(hotbarAssignments);
    const formationOrderRef = useRef(formationOrder);
    const commandModeRef = useRef(commandMode);
    const handleCastSkillRef = useRef<((unitId: number, skill: Skill) => void) | null>(null);
    const unitGroupsRef = useRef<Record<number, { position: { x: number; z: number } }>>({});
    const dialogPauseForcedRef = useRef(false);
    const runDialogUiActionRef = useRef<(action: DialogUiAction | undefined) => void>(() => {});
    const lootPickupPauseForcedRef = useRef(false);
    const lootPickupOnTakeRef = useRef<(() => void) | null>(null);
    const dialogLastBlipAtRef = useRef(0);
    const dialogPreviousTypedCharsRef = useRef(0);
    const dialogTriggerAreaLoadedAtRef = useRef(Date.now());
    const firedDialogTriggerIdsRef = useRef<Set<string>>(new Set());
    const dialogTriggerLastFiredAtRef = useRef<Map<string, number>>(new Map());
    const dialogTriggerProgressByAreaRef = useRef<Record<string, Set<string>>>(cloneDialogTriggerProgressForRuntime(initialDialogTriggerProgress));
    const skippedDialogTriggerLogIdsRef = useRef<Set<string>>(new Set());
    const spendNightFadeTimeoutRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
    const spendNightRestoreTimeoutRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
    const spendNightPauseForcedRef = useRef(false);
    const lastWaystoneRef = useRef<{ areaId: AreaId; waystoneIndex: number } | null>(initialLastWaystone ?? null);
    const getSaveLockReasonRef = useRef<() => string | null>(() => null);
    const runSpendNightEventRef = useRef<() => void>(() => {});
    const travelToAreaRef = useRef<(targetArea: AreaId, spawn: { x: number; z: number }, direction?: "north" | "south" | "east" | "west") => void>(() => {});
    const dialogTriggerRuntimeStateRef = useRef<DialogTriggerRuntimeState>({
        stickySatisfiedConditionKeys: new Set(),
        previousRegionInsideByConditionKey: new Map(),
        pendingNpcEngagementSpawnIndexes: new Set(),
    });

    // Sync refs with state
    useEffect(() => { selectedRef.current = selectedIds; }, [selectedIds]);
    useEffect(() => { unitsStateRef.current = units; }, [units]);
    useEffect(() => { pausedRef.current = paused; }, [paused]);
    useEffect(() => { targetingModeRef.current = targetingMode; }, [targetingMode]);
    useEffect(() => { consumableTargetingModeRef.current = consumableTargetingMode; }, [consumableTargetingMode]);
    useEffect(() => { showPanelRef.current = showPanel; }, [showPanel]);
    useEffect(() => { infoModalOpenRef.current = infoModalOpen; }, [infoModalOpen]);
    useEffect(() => { skillCooldownsRef.current = skillCooldowns; }, [skillCooldowns]);
    useEffect(() => { openedChestsRef.current = openedChests; }, [openedChests]);
    useEffect(() => { activatedWaystonesRef.current = activatedWaystones; }, [activatedWaystones]);
    useEffect(() => { hotbarAssignmentsRef.current = hotbarAssignments; }, [hotbarAssignments]);
    useEffect(() => { formationOrderRef.current = formationOrder; }, [formationOrder]);
    useEffect(() => { commandModeRef.current = commandMode; }, [commandMode]);
    useEffect(() => {
        dialogTriggerProgressByAreaRef.current = cloneDialogTriggerProgressForRuntime(initialDialogTriggerProgress);
    }, [initialDialogTriggerProgress]);
    useEffect(() => {
        if (showPanel && selectedIds.length === 1 && isCorePlayerId(selectedIds[0])) {
            setEquipmentModalUnitId(prev => prev !== null ? selectedIds[0] : null);
            return;
        }
        setEquipmentModalUnitId(null);
    }, [showPanel, selectedIds]);

    const currentAreaId = getCurrentAreaId();

    const currentDialogNode = useMemo<DialogNode | null>(() => {
        if (!dialogState) return null;
        return dialogState.definition.nodes[dialogState.nodeId] ?? null;
    }, [dialogState]);

    const currentDialogSpeaker = useMemo<DialogSpeaker | null>(() => {
        if (!dialogState || !currentDialogNode) return null;
        return dialogState.definition.speakers[currentDialogNode.speakerId] ?? null;
    }, [dialogState, currentDialogNode]);

    const isPartyGatheredForDialog = useCallback((maxDistance: number): boolean => {
        const aliveCoreParty = units.filter(unit =>
            unit.team === "player"
            && isCorePlayerId(unit.id)
            && unit.hp > 0
        );
        if (aliveCoreParty.length <= 1) return true;

        const groups = unitGroupsRef.current;
        for (let i = 0; i < aliveCoreParty.length; i++) {
            const source = aliveCoreParty[i];
            const sourceG = groups[source.id];
            const sx = sourceG?.position.x ?? source.x;
            const sz = sourceG?.position.z ?? source.z;
            for (let j = i + 1; j < aliveCoreParty.length; j++) {
                const target = aliveCoreParty[j];
                const targetG = groups[target.id];
                const tx = targetG?.position.x ?? target.x;
                const tz = targetG?.position.z ?? target.z;
                if (!isInRange(sx, sz, tx, tz, 0, maxDistance)) {
                    return false;
                }
            }
        }

        return true;
    }, [units]);

    const getDialogChoiceConditionBlockReason = useCallback((condition: DialogChoiceCondition): string | null => {
        const customDisabledMessage = typeof condition.disabledMessage === "string" && condition.disabledMessage.trim().length > 0
            ? condition.disabledMessage.trim()
            : undefined;
        if (condition.type === "party_is_gathered") {
            const maxDistance = condition.maxDistance ?? DIALOG_PARTY_GATHERED_DEFAULT_MAX_DISTANCE;
            if (!isPartyGatheredForDialog(maxDistance)) {
                return customDisabledMessage
                    ?? `Party is scattered. Bring all living party members within ${maxDistance} units of each other.`;
            }
            return null;
        }
        if (condition.type === "party_has_gold") {
            if (gold < condition.amount) {
                return customDisabledMessage
                    ?? `Requires ${condition.amount} gold (you have ${gold}).`;
            }
            return null;
        }
        return customDisabledMessage ?? "Requirements for this option are not met.";
    }, [isPartyGatheredForDialog, gold]);

    const dialogChoiceOptions = useMemo(() => {
        const choices = currentDialogNode?.choices ?? [];
        return choices.map(choice => {
            const disabledReason = (choice.conditions ?? [])
                .map(getDialogChoiceConditionBlockReason)
                .find(reason => reason !== null) ?? undefined;

            return {
                choice,
                disabled: disabledReason !== undefined,
                disabledReason
            };
        });
    }, [currentDialogNode, getDialogChoiceConditionBlockReason]);
    const dialogChoiceOptionsById = useMemo(() => {
        return new Map(dialogChoiceOptions.map(option => [option.choice.id, option]));
    }, [dialogChoiceOptions]);
    const isDialogOpen = dialogState !== null;
    const isLootPickupModalOpen = lootPickupModalState !== null;
    const isWaystoneTravelModalOpen = waystoneTravelDestinations !== null;
    const equipmentModalOpen = equipmentModalUnitId !== null;
    const isDialogTyping = currentDialogNode !== null && dialogTypedChars < currentDialogNode.text.length;
    const dialogVisibleText = currentDialogNode ? currentDialogNode.text.slice(0, dialogTypedChars) : "";
    const canContinueWithoutChoices = !isDialogTyping && dialogChoiceOptions.length === 0 && currentDialogNode !== null;
    const anyMenuOpen = isDialogOpen || isLootPickupModalOpen || isWaystoneTravelModalOpen || infoModalOpen || saveLoadOpen || menuOpen || jukeboxOpen || equipmentModalOpen;

    useEffect(() => {
        pauseToggleLockedRef.current = anyMenuOpen || sleepFadeOpacity > 0;
    }, [anyMenuOpen, sleepFadeOpacity]);

    useEffect(() => {
        dialogTriggerAreaLoadedAtRef.current = Date.now();
        const persistedFiredIds = dialogTriggerProgressByAreaRef.current[currentAreaId] ?? new Set<string>();
        firedDialogTriggerIdsRef.current = new Set(persistedFiredIds);
        dialogTriggerProgressByAreaRef.current[currentAreaId] = new Set(firedDialogTriggerIdsRef.current);
        dialogTriggerLastFiredAtRef.current = new Map();
        skippedDialogTriggerLogIdsRef.current = new Set();
        dialogTriggerRuntimeStateRef.current = {
            stickySatisfiedConditionKeys: new Set(),
            previousRegionInsideByConditionKey: new Map(),
            pendingNpcEngagementSpawnIndexes: new Set(),
        };
    }, [currentAreaId]);

    useEffect(() => {
        if (!currentDialogNode) {
            setDialogTypedChars(0);
            dialogPreviousTypedCharsRef.current = 0;
            return;
        }
        setDialogTypedChars(0);
        dialogPreviousTypedCharsRef.current = 0;
        dialogLastBlipAtRef.current = 0;
    }, [currentDialogNode]);

    useEffect(() => {
        if (!currentDialogNode) return;

        const textLength = currentDialogNode.text.length;

        const intervalId = window.setInterval(() => {
            setDialogTypedChars(prev => {
                const next = Math.min(textLength, prev + DIALOG_CHARS_PER_TICK);
                if (next >= textLength) {
                    window.clearInterval(intervalId);
                }
                return next;
            });
        }, DIALOG_TYPING_INTERVAL_MS);

        return () => window.clearInterval(intervalId);
    }, [currentDialogNode]);

    useEffect(() => {
        if (!currentDialogNode) return;
        if (!isDialogTyping) return;

        const previousChars = dialogPreviousTypedCharsRef.current;
        const nextChars = dialogTypedChars;
        dialogPreviousTypedCharsRef.current = nextChars;

        const delta = nextChars - previousChars;
        if (delta <= 0 || delta > DIALOG_CHARS_PER_TICK) return;

        const latestChar = currentDialogNode.text.charAt(Math.max(0, nextChars - 1));
        if (!latestChar || /\s/.test(latestChar)) return;

        const now = performance.now();
        if (now - dialogLastBlipAtRef.current < DIALOG_MIN_BLIP_INTERVAL_MS) return;

        dialogLastBlipAtRef.current = now;
        soundFns.playDialogBlip();
    }, [dialogTypedChars, currentDialogNode, isDialogTyping]);

    // Live dispatch keeps unitsStateRef in sync immediately (no waiting for useEffect)
    const setUnitsLive = useMemo(
        () => createLiveUnitsDispatch(setUnits, unitsStateRef as { current: Unit[] }),
        [setUnits]
    );

    // =============================================================================
    // MUTABLE REFS FOR INPUT
    // =============================================================================

    const actionQueueRef = useRef<ActionQueue>({});
    const actionCooldownRef = useRef<Record<number, number>>({});
    const keysPressed = useRef<Set<string>>(new Set());
    const isDragging = useRef(false);
    const didPan = useRef(false);
    const isBoxSel = useRef(false);
    const boxStart = useRef({ x: 0, y: 0 });
    const boxEnd = useRef({ x: 0, y: 0 });
    const lastMouse = useRef({ x: 0, y: 0 });
    const debugGridRef = useRef<THREE.Group | null>(null);
    const [selectedConsumableCooldownEnd, setSelectedConsumableCooldownEnd] = useState(0);
    const perfLogBufferRef = useRef<string[]>([]);
    const perfLogFlushInFlightRef = useRef(false);
    const perfSessionIdRef = useRef(`${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
    const perfSessionHeaderWrittenRef = useRef(false);
    const lastPerfTriggerAtRef = useRef(0);
    const playtestStartupLogsWrittenRef = useRef(false);

    useEffect(() => {
        const interval = setInterval(() => {
            const selectedId = selectedRef.current[0];
            const nextCooldown = selectedId !== undefined ? (actionCooldownRef.current[selectedId] || 0) : 0;
            setSelectedConsumableCooldownEnd(prev => (prev === nextCooldown ? prev : nextCooldown));
        }, 100);
        return () => clearInterval(interval);
    }, []);

    // =============================================================================
    // USE THREE SCENE HOOK
    // =============================================================================

    const { sceneState, gameRefs, isInitialized } = useThreeScene({
        containerRef,
        units,
        openedChests,
        initialCameraOffset: initialCamOffset,
        skipNextFogSaveOnUnmountRef,
    });
    const sceneRef = useRef<THREE.Scene | null>(null);
    const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
    useEffect(() => {
        sceneRef.current = sceneState.scene;
        rendererRef.current = sceneState.renderer;
    }, [sceneState.scene, sceneState.renderer]);
    unitGroupsRef.current = sceneState.unitGroups;

    // Preload portrait images before fade-in
    const [portraitsReady, setPortraitsReady] = useState(false);
    useEffect(() => {
        preloadPortraits(PORTRAIT_URLS).then(() => setPortraitsReady(true));
    }, []);

    // Notify parent when scene + portraits are ready
    useEffect(() => {
        if (isInitialized && portraitsReady && onReady) {
            onReady();
        }
    }, [isInitialized, portraitsReady, onReady]);

    // Sync hoveredDoor to gameRefs
    useEffect(() => {
        syncHoveredDoorRef(gameRefs, hoveredDoor?.targetArea ?? null);
    }, [hoveredDoor, gameRefs]);

    // Update chest states when opened chests change
    useEffect(() => {
        if (sceneState.chestMeshes.length > 0) {
            updateChestStates(sceneState.chestMeshes, openedChests);
        }
    }, [openedChests, sceneState.chestMeshes]);

    // Debug speed multiplier
    useEffect(() => {
        setDebugSpeedMultiplier(fastMove ? 10 : 1);
    }, [fastMove]);

    // Live lighting tuning from debug panel
    useEffect(() => {
        const scene = sceneRef.current;
        const renderer = rendererRef.current;
        if (!scene || !renderer) return;

        const baseExposureRaw = scene.userData.baseExposure;
        const baseExposure = typeof baseExposureRaw === "number"
            ? baseExposureRaw
            : renderer.toneMappingExposure;
        renderer.toneMappingExposure = baseExposure * lightingTuning.exposureScale;
        renderer.shadowMap.enabled = lightingTuning.shadowsEnabled;
        renderer.shadowMap.needsUpdate = true;

        const ambient = scene.getObjectByName("ambientLight");
        if (ambient instanceof THREE.AmbientLight) {
            const baseAmbient = typeof ambient.userData.baseIntensity === "number"
                ? ambient.userData.baseIntensity
                : ambient.intensity;
            ambient.intensity = baseAmbient * lightingTuning.ambientScale;
        }

        const hemi = scene.getObjectByName("hemiLight");
        if (hemi instanceof THREE.HemisphereLight) {
            const baseHemi = typeof hemi.userData.baseIntensity === "number"
                ? hemi.userData.baseIntensity
                : hemi.intensity;
            hemi.intensity = baseHemi * lightingTuning.hemisphereScale;
        }

        const dir = scene.getObjectByName("directionalLight");
        if (dir instanceof THREE.DirectionalLight) {
            const baseDirectional = typeof dir.userData.baseIntensity === "number"
                ? dir.userData.baseIntensity
                : dir.intensity;
            dir.intensity = baseDirectional * lightingTuning.directionalScale;
            dir.castShadow = lightingTuning.shadowsEnabled;
            dir.shadow.radius = lightingTuning.shadowRadius;
            dir.shadow.bias = lightingTuning.shadowBias;
            dir.shadow.normalBias = lightingTuning.shadowNormalBias;
            dir.shadow.needsUpdate = true;
        }

        scene.traverse((object: THREE.Object3D) => {
            if (!(object instanceof THREE.Mesh) || object.userData?.isBillboard !== true) return;

            const mat = object.material;
            if (!(mat instanceof THREE.MeshStandardMaterial)) return;

            const existingBase = mat.userData.spriteLightingBase as {
                emissiveIntensity: number;
                metalness: number;
                roughness: number;
            } | undefined;
            const base = existingBase ?? {
                emissiveIntensity: mat.emissiveIntensity,
                metalness: mat.metalness,
                roughness: mat.roughness
            };
            if (!existingBase) {
                mat.userData.spriteLightingBase = base;
            }

            mat.emissiveIntensity = base.emissiveIntensity * lightingTuning.spriteEmissiveScale;
            mat.metalness = lightingTuning.spriteMetalness;
            mat.roughness = lightingTuning.spriteRoughness;
            mat.needsUpdate = true;
        });
    }, [sceneState.scene, sceneState.renderer, lightingTuning]);

    // =============================================================================
    // CALLBACKS
    // =============================================================================

    const addLog = useCallback((text: string, color?: string) => {
        setCombatLog(prev => [...prev.slice(-50), { text, color }]);
    }, []);

    useEffect(() => {
        if (playtestStartupLogsWrittenRef.current) return;
        playtestStartupLogsWrittenRef.current = true;
        addLog(
            `Debug: Playtest option "Unlock Skills" ${playtestSettings.unlockAllSkills ? "enabled" : "disabled"}.`,
            playtestSettings.unlockAllSkills ? "#9b59b6" : "#888"
        );
        addLog(
            `Debug: Playtest option "Skip Dialogs" ${playtestSettings.skipDialogs ? "enabled" : "disabled"}.`,
            playtestSettings.skipDialogs ? "#9b59b6" : "#888"
        );
    }, [addLog, playtestSettings.skipDialogs, playtestSettings.unlockAllSkills]);

    const flushPerfLogs = useCallback(async () => {
        if (!import.meta.env.DEV) return;
        if (perfLogFlushInFlightRef.current) return;
        if (perfLogBufferRef.current.length === 0) return;

        const batch = perfLogBufferRef.current.splice(0, perfLogBufferRef.current.length);
        perfLogFlushInFlightRef.current = true;
        try {
            const response = await fetch(PERF_LOG_ENDPOINT, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    sessionId: perfSessionIdRef.current,
                    lines: batch
                })
            });
            if (!response.ok) {
                throw new Error(`Perf log flush failed: ${response.status}`);
            }
        } catch {
            const merged = [...batch, ...perfLogBufferRef.current];
            perfLogBufferRef.current = merged.slice(-PERF_LOG_BUFFER_LIMIT);
        } finally {
            perfLogFlushInFlightRef.current = false;
        }
    }, []);

    const onPerfSample = useCallback((sample: PerfFrameSample) => {
        if (!import.meta.env.DEV) return;

        if (!perfSessionHeaderWrittenRef.current) {
            perfSessionHeaderWrittenRef.current = true;
            perfLogBufferRef.current.push(`=== perf-session ${perfSessionIdRef.current} ${new Date().toISOString()} ===`);
        }

        if (sample.belowThreshold && sample.timestamp - lastPerfTriggerAtRef.current > 1000) {
            lastPerfTriggerAtRef.current = sample.timestamp;
            perfLogBufferRef.current.push(`--- dip-trigger ${new Date(sample.timestamp).toISOString()} fps=${sample.fps.toFixed(1)} ---`);
        }

        perfLogBufferRef.current.push(formatPerfLogLine(sample));
        if (perfLogBufferRef.current.length > PERF_LOG_BUFFER_LIMIT) {
            perfLogBufferRef.current.splice(0, perfLogBufferRef.current.length - PERF_LOG_BUFFER_LIMIT);
        }
    }, []);

    useEffect(() => {
        if (!import.meta.env.DEV) return;
        const intervalId = window.setInterval(() => {
            void flushPerfLogs();
        }, PERF_LOG_FLUSH_INTERVAL_MS);

        return () => {
            window.clearInterval(intervalId);
            void flushPerfLogs();
        };
    }, [flushPerfLogs]);

    // Skill execution context
    const getSkillContext = useCallback((defeatedThisFrame?: Set<number>): SkillExecutionContext => ({
        scene: sceneState.scene!,
        unitsStateRef: unitsStateRef as React.RefObject<Unit[]>,
        unitsRef: { current: sceneState.unitGroups },
        actionCooldownRef,
        projectilesRef: { current: gameRefs.current.projectiles },
        hitFlashRef: { current: gameRefs.current.hitFlash },
        damageTexts: { current: gameRefs.current.damageTexts },
        unitMeshRef: { current: sceneState.unitMeshes },
        unitOriginalColorRef: { current: sceneState.unitOriginalColors },
        swingAnimationsRef: { current: gameRefs.current.swingAnimations },
        setUnits: setUnitsLive,
        setSkillCooldowns,
        addLog,
        defeatedThisFrame: defeatedThisFrame ?? new Set<number>(),
        sanctuaryTilesRef: { current: gameRefs.current.sanctuaryTiles },
        acidTilesRef: { current: gameRefs.current.acidTiles },
        holyTilesRef: { current: gameRefs.current.holyTiles },
        smokeTilesRef: { current: gameRefs.current.smokeTiles },
        fireTilesRef: { current: gameRefs.current.fireTiles }
    }), [sceneState, gameRefs, addLog, setUnitsLive]);

    // Execute consumable
    const executeConsumable = useCallback((unitId: number, itemId: string, targetId?: number): boolean => {
        const item = getItem(itemId);
        if (!item || !isConsumable(item)) return false;

        const userUnit = unitsStateRef.current.find(u => u.id === unitId);
        if (!userUnit || userUnit.hp <= 0) return false;
        const incapacitatingStatus = getIncapacitatingStatus(userUnit);
        if (incapacitatingStatus === "stunned") {
            addLog(`${UNIT_DATA[unitId]?.name ?? "Unknown"} cannot act while stunned.`, COLORS.stunnedText);
            return false;
        }
        if (incapacitatingStatus === "sleep") {
            addLog(`${UNIT_DATA[unitId]?.name ?? "Unknown"} cannot act while asleep.`, COLORS.sleepText);
            return false;
        }
        const inventory = getPartyInventory();
        if (!hasInInventory(inventory, itemId, 1)) return false;

        if (item.effect === "heal") {
            const maxHp = getEffectiveMaxHp(unitId, userUnit);
            if (userUnit.hp >= maxHp) return false;
            const newHp = Math.min(maxHp, userUnit.hp + item.value);
            const healed = newHp - userUnit.hp;
            updateUnit(setUnits, unitId, { hp: newHp });
            addLog(`${UNIT_DATA[unitId]?.name ?? "Unknown"} uses ${item.name}, restoring ${healed} HP.`, "#22c55e");

            const poisonChanceOnUse = item.poisonChanceOnUse ?? 0;
            const isPoisonImmune = userUnit.statusEffects?.some(effect => effect.type === "cleansed") ?? false;
            if (poisonChanceOnUse > 0 && !isPoisonImmune && Math.random() * 100 < poisonChanceOnUse) {
                const now = Date.now();
                setUnits(prev => prev.map(u => (
                    u.id === unitId
                        ? applyPoison(u, unitId, now, item.poisonDamageOnUse)
                        : u
                )));
                addLog(`${UNIT_DATA[unitId]?.name ?? "Unknown"} is poisoned by ${item.name}!`, "#7cba7c");
            }
        } else if (item.effect === "mana") {
            const maxMana = getEffectiveMaxMana(unitId, userUnit);
            const currentMana = userUnit.mana ?? 0;
            if (currentMana >= maxMana) return false;
            const newMana = Math.min(maxMana, currentMana + item.value);
            const restored = newMana - currentMana;
            updateUnit(setUnits, unitId, { mana: newMana });
            addLog(`${UNIT_DATA[unitId]?.name ?? "Unknown"} uses ${item.name}, restoring ${restored} Mana.`, "#3b82f6");
        } else if (item.effect === "cleanse") {
            const hasPoison = userUnit.statusEffects?.some(effect => effect.type === "poison") ?? false;
            const alreadyCleansed = userUnit.statusEffects?.some(effect => effect.type === "cleansed") ?? false;
            if (!hasPoison && alreadyCleansed) return false;

            const now = Date.now();
            const cleanseDuration = SKILLS.cleanse.duration ?? 30000;
            const cleansedEffect: StatusEffect = {
                type: "cleansed",
                duration: cleanseDuration,
                tickInterval: BUFF_TICK_INTERVAL,
                timeSinceTick: 0,
                lastUpdateTime: now,
                damagePerTick: 0,
                sourceId: unitId
            };

            setUnits(prev => prev.map(u => {
                if (u.id !== unitId) return u;
                const withoutPoison = (u.statusEffects ?? []).filter(effect => effect.type !== "poison");
                return { ...u, statusEffects: applyStatusEffect(withoutPoison, cleansedEffect) };
            }));
            addLog(`${UNIT_DATA[unitId]?.name ?? "Unknown"} uses ${item.name}, cleansing poison and gaining immunity.`, "#ecf0f1");
        } else if (item.effect === "exp") {
            const newExp = (userUnit.exp ?? 0) + item.value;
            const currentLevel = userUnit.level ?? 1;
            const xpForNext = getXpForLevel(currentLevel + 1);

            if (newExp >= xpForNext) {
                setUnits(prev => prev.map(u => {
                    if (u.id !== unitId) return u;
                    const maxHp = getEffectiveMaxHp(u.id, u);
                    const maxMana = getEffectiveMaxMana(u.id, u);
                    return {
                        ...u, exp: newExp, level: currentLevel + 1,
                        statPoints: (u.statPoints ?? 0) + LEVEL_UP_STAT_POINTS,
                        skillPoints: (u.skillPoints ?? 0) + LEVEL_UP_SKILL_POINTS,
                        hp: Math.min(u.hp + LEVEL_UP_HP, maxHp), mana: Math.min((u.mana ?? 0) + LEVEL_UP_MANA, maxMana),
                        stats: u.stats ?? { strength: 0, dexterity: 0, vitality: 0, intelligence: 0, faith: 0 }
                    };
                }));
                addLog(`${UNIT_DATA[unitId]?.name ?? "Unknown"} reads ${item.name} and levels up!`, "#ffd700");
                soundFns.playLevelUp();
                if (sceneState.scene) {
                    const unitGroup = sceneState.unitGroups[unitId];
                    if (unitGroup) {
                        createLightningPillar(sceneState.scene, unitGroup.position.x, unitGroup.position.z, { color: "#ffd700", duration: 600, radius: 0.3, height: 10 });
                    }
                }
            } else {
                updateUnit(setUnits, unitId, { exp: newExp });
                addLog(`${UNIT_DATA[unitId]?.name ?? "Unknown"} reads ${item.name}, gaining ${item.value} Experience.`, "#9b59b6");
            }
        } else if (item.effect === "revive") {
            // Revive a dead ally - targetId is required
            if (targetId === undefined) return false;
            const deadAlly = unitsStateRef.current.find(u => u.id === targetId && u.team === "player" && u.hp <= 0);
            if (!deadAlly) return false;

            const userG = sceneState.unitGroups[unitId];
            if (!userG) return false;

            // Place revived unit next to user
            const angle = Math.random() * Math.PI * 2;
            const reviveX = userG.position.x + Math.cos(angle) * 1.5;
            const reviveZ = userG.position.z + Math.sin(angle) * 1.5;

            updateUnit(setUnits, targetId, { hp: item.value, x: reviveX, z: reviveZ, statusEffects: undefined, target: null });

            // Make the unit visible and reposition
            reviveUnitVisual(sceneState.unitGroups, targetId, reviveX, reviveZ);

            addLog(`${UNIT_DATA[unitId]?.name ?? "Unknown"} uses ${item.name}, reviving ${UNIT_DATA[targetId]?.name ?? "Unknown"}!`, "#ffd700");
            soundFns.playHeal();
            if (sceneState.scene) {
                createLightningPillar(sceneState.scene, reviveX, reviveZ, { color: "#ffd700", duration: 600, radius: 0.3, height: 10 });
            }
        } else if (item.effect === "camp") {
            const lockReason = getSaveLockReasonRef.current();
            if (lockReason) {
                addLog("Cannot camp here. " + lockReason, "#ef4444");
                return false;
            }
            if (!isPartyGatheredForDialog(DIALOG_PARTY_GATHERED_DEFAULT_MAX_DISTANCE)) {
                addLog("The party must be gathered before making camp.", "#ef4444");
                return false;
            }
        } else if (item.effect === "waystone_recall") {
            if (!lastWaystoneRef.current) {
                addLog("No waystone has been visited yet.", "#ef4444");
                return false;
            }
            const { areaId, waystoneIndex } = lastWaystoneRef.current;
            if (areaId === getCurrentAreaId()) {
                addLog("You are already near this waystone.", "#ef4444");
                return false;
            }
            const targetArea = AREAS[areaId];
            if (!targetArea?.waystones?.[waystoneIndex]) {
                addLog("The waystone's connection has faded.", "#ef4444");
                return false;
            }
        } else {
            return false;
        }

        if (item.sound === "gulp") soundFns.playGulp();
        else if (item.sound === "crunch") soundFns.playCrunch();

        setPartyInventory(removeFromInventory(inventory, itemId, 1));
        actionCooldownRef.current[unitId] = Date.now() + item.cooldown;

        // Post-consume side effects
        if (item.effect === "camp") {
            runSpendNightEventRef.current();
        } else if (item.effect === "waystone_recall") {
            const { areaId, waystoneIndex } = lastWaystoneRef.current!;
            const waystone = AREAS[areaId].waystones![waystoneIndex];
            travelToAreaRef.current(areaId as AreaId, { x: waystone.x, z: waystone.z }, waystone.direction);
        }

        return true;
    }, [addLog, sceneState, isPartyGatheredForDialog]);

    // Process action queue wrapper
    const doProcessQueue = useCallback((defeatedThisFrame: Set<number>) => {
        const skillCtx = getSkillContext(defeatedThisFrame);
        processActionQueue(
            actionQueueRef, actionCooldownRef, sceneState.unitGroups,
            gameRefs.current.paths, gameRefs.current.moveStart, pausedRef,
            skillCtx, setUnits, setQueuedActions, executeConsumable
        );
    }, [getSkillContext, sceneState.unitGroups, gameRefs, executeConsumable]);

    const getPauseRuntimeRefs = useCallback(() => ({
        pauseStartTimeRef,
        actionCooldownRef,
        actionQueueRef,
        moveStartRef: { current: gameRefs.current.moveStart }
    }), [gameRefs]);

    useEffect(() => {
        if (!anyMenuOpen || pausedRef.current) return;
        togglePause(
            getPauseRuntimeRefs(),
            { pausedRef },
            { setPaused, setSkillCooldowns },
            doProcessQueue
        );
    }, [anyMenuOpen, doProcessQueue, getPauseRuntimeRefs]);

    const closeDialog = useCallback((options?: { resumeIfForced?: boolean }) => {
        const resumeIfForced = options?.resumeIfForced ?? true;
        setDialogState(null);
        setDialogTypedChars(0);
        dialogPreviousTypedCharsRef.current = 0;
        dialogLastBlipAtRef.current = 0;

        if (resumeIfForced && dialogPauseForcedRef.current && pausedRef.current) {
            togglePause(
                getPauseRuntimeRefs(),
                { pausedRef },
                { setPaused, setSkillCooldowns },
                doProcessQueue
            );
        }
        dialogPauseForcedRef.current = false;
    }, [doProcessQueue, getPauseRuntimeRefs]);

    const closeLootPickupModal = useCallback((options?: { resumeIfForced?: boolean }) => {
        const resumeIfForced = options?.resumeIfForced ?? true;
        setLootPickupModalState(null);
        lootPickupOnTakeRef.current = null;

        if (resumeIfForced && lootPickupPauseForcedRef.current && pausedRef.current) {
            togglePause(
                getPauseRuntimeRefs(),
                { pausedRef },
                { setPaused, setSkillCooldowns },
                doProcessQueue
            );
        }
        lootPickupPauseForcedRef.current = false;
    }, [doProcessQueue, getPauseRuntimeRefs]);

    const openLootPickupModal = useCallback((request: LootPickupRequest) => {
        if (!pausedRef.current) {
            lootPickupPauseForcedRef.current = true;
            togglePause(
                getPauseRuntimeRefs(),
                { pausedRef },
                { setPaused, setSkillCooldowns },
                doProcessQueue
            );
        } else {
            lootPickupPauseForcedRef.current = false;
        }

        lootPickupOnTakeRef.current = request.onTake;
        setLootPickupModalState({
            sourceLabel: request.sourceLabel,
            entries: request.entries
        });
    }, [doProcessQueue, getPauseRuntimeRefs]);

    const takeLootPickup = useCallback(() => {
        const onTake = lootPickupOnTakeRef.current;
        if (onTake) {
            onTake();
        }
        closeLootPickupModal();
    }, [closeLootPickupModal]);

    useEffect(() => {
        if (!playtestSkipDialogs || !isDialogOpen) return;
        addLog(`Skipped active dialog "${dialogState?.definition.id ?? "unknown"}" (Skip Dialogs enabled).`, "#9b59b6");
        closeDialog();
    }, [addLog, closeDialog, dialogState, isDialogOpen, playtestSkipDialogs]);

    const startDialog = useCallback((definition: DialogDefinition) => {
        if (playtestSkipDialogs) {
            addLog(`Skipped dialog "${definition.id}" (Skip Dialogs enabled).`, "#9b59b6");
            return;
        }

        const startNode = definition.nodes[definition.startNodeId];
        if (!startNode) {
            addLog(`Dialog "${definition.id}" is missing start node "${definition.startNodeId}".`, "#ef4444");
            return;
        }

        // Menu nodes fire their action immediately without displaying dialog
        if (startNode.isMenuNode) {
            const action = startNode.onDialogEndAction;
            if (action && startNode.nextNodeId && definition.nodes[startNode.nextNodeId]) {
                const chainAction: MenuChainAction = { type: "open_dialog", dialogId: definition.id, startNodeId: startNode.nextNodeId };
                runDialogUiActionRef.current(action.type === "open_menu" ? { ...action, chainAction } : action);
            } else {
                runDialogUiActionRef.current(action);
            }
            return;
        }

        if (!pausedRef.current) {
            dialogPauseForcedRef.current = true;
            togglePause(
                getPauseRuntimeRefs(),
                { pausedRef },
                { setPaused, setSkillCooldowns },
                doProcessQueue
            );
        } else {
            dialogPauseForcedRef.current = false;
        }

        setDialogState({ definition, nodeId: definition.startNodeId });
        setDialogTypedChars(0);
        dialogPreviousTypedCharsRef.current = 0;
        dialogLastBlipAtRef.current = 0;
    }, [addLog, doProcessQueue, getPauseRuntimeRefs, playtestSkipDialogs]);

    const skipDialogTyping = useCallback(() => {
        if (!currentDialogNode) return;
        setDialogTypedChars(currentDialogNode.text.length);
    }, [currentDialogNode]);

    const clearSpendNightTimers = useCallback(() => {
        if (spendNightFadeTimeoutRef.current !== null) {
            window.clearTimeout(spendNightFadeTimeoutRef.current);
            spendNightFadeTimeoutRef.current = null;
        }
        if (spendNightRestoreTimeoutRef.current !== null) {
            window.clearTimeout(spendNightRestoreTimeoutRef.current);
            spendNightRestoreTimeoutRef.current = null;
        }
    }, []);

    const runSpendNightEvent = useCallback(() => {
        clearSpendNightTimers();

        // Route sleep through the standard pause pipeline so game-clock and cooldown
        // timing stay consistent while the party rests.
        pauseToggleLockedRef.current = true;
        if (!pausedRef.current) {
            spendNightPauseForcedRef.current = true;
            togglePause(
                getPauseRuntimeRefs(),
                { pausedRef },
                { setPaused, setSkillCooldowns },
                doProcessQueue
            );
        }
        setSleepFadeOpacity(1);

        spendNightFadeTimeoutRef.current = window.setTimeout(() => {
            spendNightFadeTimeoutRef.current = null;

            setUnits(prev => prev.map(unit => {
                if (unit.team !== "player" || !isCorePlayerId(unit.id) || unit.hp <= 0) {
                    return unit;
                }
                const maxHp = getEffectiveMaxHp(unit.id, unit);
                const maxMana = getEffectiveMaxMana(unit.id, unit);
                return {
                    ...unit,
                    hp: maxHp,
                    mana: unit.mana === undefined ? undefined : maxMana,
                };
            }));

            soundFns.playLullaby();
            addLog("The party spends the night and wakes restored.", "#22c55e");

            // Respawn all enemy-tier enemies across all areas
            setKilledEnemies(prev => {
                const next = new Set<string>();
                for (const key of prev) {
                    // key format: "areaId-spawnIndex"
                    const dashIdx = key.lastIndexOf("-");
                    const areaId = key.substring(0, dashIdx);
                    const spawnIndex = parseInt(key.substring(dashIdx + 1), 10);
                    const area = AREAS[areaId];
                    if (!area) { next.add(key); continue; }
                    const spawn = area.enemySpawns[spawnIndex];
                    if (!spawn) { next.add(key); continue; }
                    const stats = ENEMY_STATS[spawn.type];
                    if (stats.tier !== "enemy") {
                        next.add(key); // Keep miniboss/boss/npc kills
                    }
                }
                return next;
            });

            // Recreate enemy-tier units for the current area
            const area = getCurrentArea();
            setUnits(prev => {
                const existingEnemyIds = new Set(prev.filter(u => u.team === "enemy" || u.team === "neutral").map(u => u.id));
                const newUnits: Unit[] = [];
                area.enemySpawns.forEach((spawnDef, spawnIndex) => {
                    const unitId = 100 + spawnIndex;
                    if (existingEnemyIds.has(unitId)) return; // Already alive
                    const stats = ENEMY_STATS[spawnDef.type];
                    if (stats.tier !== "enemy") return; // Only respawn enemy tier
                    newUnits.push({
                        id: unitId,
                        x: spawnDef.x,
                        z: spawnDef.z,
                        hp: stats.maxHp,
                        team: "enemy" as const,
                        enemyType: spawnDef.type,
                        target: null,
                        aiEnabled: true,
                        ...(stats.frontShield && { facing: 0 }),
                    });
                });
                return newUnits.length > 0 ? [...prev, ...newUnits] : prev;
            });

            spendNightRestoreTimeoutRef.current = window.setTimeout(() => {
                spendNightRestoreTimeoutRef.current = null;
                setSleepFadeOpacity(0);
                if (spendNightPauseForcedRef.current && pausedRef.current) {
                    togglePause(
                        getPauseRuntimeRefs(),
                        { pausedRef },
                        { setPaused, setSkillCooldowns },
                        doProcessQueue
                    );
                }
                spendNightPauseForcedRef.current = false;
            }, SPEND_NIGHT_BLACK_HOLD_MS);
        }, SPEND_NIGHT_FADE_MS);
    }, [addLog, clearSpendNightTimers, doProcessQueue, getPauseRuntimeRefs]);
    runSpendNightEventRef.current = runSpendNightEvent;

    useEffect(() => {
        return () => {
            clearSpendNightTimers();
        };
    }, [clearSpendNightTimers]);

    const runDialogUiAction = useCallback((action: DialogUiAction | undefined) => {
        if (!action) return;
        if (action.type === "event") {
            if (action.eventId === "spend_the_night") {
                runSpendNightEvent();
            }
            return;
        }

        const chainAction = action.chainAction;

        if (action.menuId === "startup_controls") {
            onShowControls({ chainAction: { type: "open_menu", menuId: "help" } });
            return;
        }
        if (action.menuId === "controls") {
            onShowControls({ chainAction });
            return;
        }
        if (action.menuId === "help") {
            onShowHelp({ chainAction });
            return;
        }
        if (action.menuId === "glossary") {
            onShowGlossary({ chainAction });
            return;
        }
        if (action.menuId === "save_game") {
            onSaveClick({ chainAction });
            return;
        }
        if (action.menuId === "load_game") {
            onLoadClick({ chainAction });
            return;
        }
        if (action.menuId === "equipment") {
            onOpenEquipment({ chainAction });
            return;
        }
        if (action.menuId === "menu") {
            onOpenMenu({ chainAction });
            return;
        }
        if (action.menuId === "jukebox") {
            onOpenJukebox({ chainAction });
        }
    }, [onShowControls, onShowHelp, onShowGlossary, onSaveClick, onLoadClick, onOpenEquipment, onOpenMenu, onOpenJukebox, runSpendNightEvent]);
    runDialogUiActionRef.current = runDialogUiAction;

    const closeDialogWithAction = useCallback((action: DialogUiAction | undefined) => {
        if (action) {
            closeDialog({ resumeIfForced: action.type === "event" });
            runDialogUiAction(action);
            return;
        }
        closeDialog();
    }, [closeDialog, runDialogUiAction]);

    const navigateToDialogNode = useCallback((definition: DialogDefinition, nodeId: string) => {
        const targetNode = definition.nodes[nodeId];
        if (targetNode?.isMenuNode) {
            const action = targetNode.onDialogEndAction;
            if (action && targetNode.nextNodeId && definition.nodes[targetNode.nextNodeId]) {
                const chainAction: MenuChainAction = { type: "open_dialog", dialogId: definition.id, startNodeId: targetNode.nextNodeId };
                closeDialogWithAction(action.type === "open_menu"
                    ? { ...action, chainAction }
                    : action
                );
            } else {
                closeDialogWithAction(action);
            }
            return;
        }
        setDialogState({ definition, nodeId });
    }, [closeDialogWithAction]);

    const continueDialogWithoutChoices = useCallback(() => {
        if (!dialogState || !currentDialogNode) return;

        if (currentDialogNode.nextNodeId && dialogState.definition.nodes[currentDialogNode.nextNodeId]) {
            navigateToDialogNode(dialogState.definition, currentDialogNode.nextNodeId);
            return;
        }

        closeDialogWithAction(currentDialogNode.onDialogEndAction);
    }, [dialogState, currentDialogNode, closeDialogWithAction, navigateToDialogNode]);

    const chooseDialogOption = useCallback((choiceId: string) => {
        if (!dialogState || !currentDialogNode) return;
        const selectedChoice = dialogChoiceOptionsById.get(choiceId);
        if (!selectedChoice || selectedChoice.disabled) return;
        const choice = selectedChoice.choice;

        if (choice.nextNodeId && dialogState.definition.nodes[choice.nextNodeId]) {
            navigateToDialogNode(dialogState.definition, choice.nextNodeId);
            return;
        }

        closeDialogWithAction(choice.onDialogEndAction ?? currentDialogNode.onDialogEndAction);
    }, [dialogState, currentDialogNode, dialogChoiceOptionsById, closeDialogWithAction, navigateToDialogNode]);

    useEffect(() => {
        if (!dialogTriggersEnabled) return;
        const area = getCurrentArea();
        const triggers = area.dialogTriggers ?? [];
        const sortedTriggers = [...triggers].sort((a, b) => getDialogTriggerPriority(b) - getDialogTriggerPriority(a));
        const areaDialogDefinitionsById = buildAreaDialogDefinitionMap(area.dialogs);
        let hasCachedTriggerUnitsHash = false;
        let cachedTriggerUnitsHash = 0;
        let cachedTriggerUnitsSnapshot: Unit[] | null = null;

        const getCachedTriggerUnitsSnapshot = (): Unit[] => {
            const units = unitsStateRef.current;
            const unitGroups = unitGroupsRef.current;
            const nextHash = buildDialogTriggerUnitsHash(units, unitGroups);
            if (hasCachedTriggerUnitsHash && cachedTriggerUnitsSnapshot && nextHash === cachedTriggerUnitsHash) {
                return cachedTriggerUnitsSnapshot;
            }

            const nextSnapshot = buildDialogTriggerUnitsSnapshot(units, unitGroups);
            cachedTriggerUnitsHash = nextHash;
            hasCachedTriggerUnitsHash = true;
            cachedTriggerUnitsSnapshot = nextSnapshot;
            return nextSnapshot;
        };

        const evaluateDialogTriggers = () => {
            if (isDialogOpen || isLootPickupModalOpen) return;

            const runtimeState = dialogTriggerRuntimeStateRef.current;
            if (sortedTriggers.length === 0) {
                runtimeState.pendingNpcEngagementSpawnIndexes.clear();
                return;
            }

            const now = Date.now();
            const firedIds = firedDialogTriggerIdsRef.current;
            const lastFiredAtByTriggerId = dialogTriggerLastFiredAtRef.current;
            const markTriggerFired = (triggerId: string): void => {
                firedIds.add(triggerId);
                dialogTriggerProgressByAreaRef.current[currentAreaId] = new Set(firedIds);
            };
            let triggerUnits: Unit[] | null = null;
            const getTriggerUnits = (): Unit[] => {
                if (!triggerUnits) {
                    triggerUnits = getCachedTriggerUnitsSnapshot();
                }
                return triggerUnits;
            };

            for (const trigger of sortedTriggers) {
                if (trigger.wip) {
                    continue;
                }

                const once = trigger.once !== false;
                if (once && firedIds.has(trigger.id)) {
                    continue;
                }

                if (!once) {
                    const lastFiredAt = lastFiredAtByTriggerId.get(trigger.id) ?? 0;
                    if (now - lastFiredAt < DIALOG_TRIGGER_REPEAT_GUARD_MS) {
                        continue;
                    }
                }

                const satisfied = isDialogTriggerSatisfied({
                    trigger,
                    area,
                    units: getTriggerUnits(),
                    killedEnemies,
                    now,
                    areaLoadedAt: dialogTriggerAreaLoadedAtRef.current,
                    runtimeState
                });
                if (!satisfied) {
                    continue;
                }

                const targetDialogId = getTriggerStartDialogId(trigger);
                if (!targetDialogId) {
                    addLog(`Trigger "${trigger.id}" has no executable action.`, "#ef4444");
                    if (once) {
                        markTriggerFired(trigger.id);
                    }
                    lastFiredAtByTriggerId.set(trigger.id, now);
                    continue;
                }

                const definition = areaDialogDefinitionsById.get(targetDialogId) ?? getDialogDefinitionById(targetDialogId);
                if (!definition) {
                    addLog(`Trigger "${trigger.id}" references unknown dialog "${targetDialogId}".`, "#ef4444");
                    if (once) {
                        markTriggerFired(trigger.id);
                    }
                    lastFiredAtByTriggerId.set(trigger.id, now);
                    continue;
                }

                // Keep trigger state progression while skip-dialog mode is enabled,
                // but do not consume one-shot triggers.
                if (playtestSkipDialogs) {
                    if (!skippedDialogTriggerLogIdsRef.current.has(trigger.id)) {
                        addLog(
                            `Skipped dialog "${targetDialogId}" from trigger "${trigger.id}" (Skip Dialogs enabled).`,
                            "#9b59b6"
                        );
                        skippedDialogTriggerLogIdsRef.current.add(trigger.id);
                    }
                    continue;
                }

                markTriggerFired(trigger.id);
                lastFiredAtByTriggerId.set(trigger.id, now);
                startDialog(definition);
                break;
            }
            runtimeState.pendingNpcEngagementSpawnIndexes.clear();
        };

        evaluateDialogTriggers();
        const intervalId = window.setInterval(evaluateDialogTriggers, DIALOG_TRIGGER_POLL_MS);
        return () => window.clearInterval(intervalId);
    }, [addLog, currentAreaId, dialogTriggersEnabled, isDialogOpen, isLootPickupModalOpen, killedEnemies, playtestSkipDialogs, startDialog]);

    const buildPersistedPlayers = useCallback((allUnits: Unit[], includePositions: boolean): PersistedPlayer[] => {
        const players = allUnits.filter(u => u.team === "player");
        const corePlayers = players.filter(u => !u.summonType);
        const summons = players.filter(u => u.summonType !== undefined && u.hp > 0);

        const toPersisted = (u: Unit): PersistedPlayer => {
            const unitGroup = sceneState.unitGroups[u.id];
            const x = unitGroup?.position.x ?? u.x;
            const z = unitGroup?.position.z ?? u.z;
            return {
                id: u.id,
                hp: u.hp,
                x: includePositions ? x : undefined,
                z: includePositions ? z : undefined,
                mana: u.mana,
                level: u.level,
                exp: u.exp,
                stats: u.stats,
                statPoints: u.statPoints,
                skillPoints: u.skillPoints,
                learnedSkills: u.learnedSkills,
                statusEffects: u.statusEffects,
                cantripUses: u.cantripUses,
                summonType: u.summonType,
                summonedBy: u.summonedBy,
                summonExpireAt: u.summonExpireAt,
            };
        };

        return [
            ...corePlayers.map(toPersisted),
            ...summons.map(toPersisted),
        ];
    }, [sceneState.unitGroups]);

    const buildPersistedEnemyPositions = useCallback((allUnits: Unit[]): Partial<Record<string, { x: number; z: number }>> => {
        const enemyPositions: Partial<Record<string, { x: number; z: number }>> = {};
        const areaId = getCurrentAreaId();
        const maxStaticEnemyId = 99 + getCurrentArea().enemySpawns.length;

        for (const unit of allUnits) {
            const isStaticEnemySpawn = unit.id >= 100 && unit.id <= maxStaticEnemyId;
            const isEnemyOrNeutral = unit.team === "enemy" || unit.team === "neutral";
            if (!isStaticEnemySpawn || !isEnemyOrNeutral || unit.hp <= 0) continue;

            const spawnIndex = unit.id - 100;
            const enemyKey = `${areaId}-${spawnIndex}`;
            const unitGroup = sceneState.unitGroups[unit.id];
            enemyPositions[enemyKey] = {
                x: unitGroup?.position.x ?? unit.x,
                z: unitGroup?.position.z ?? unit.z,
            };
        }

        return enemyPositions;
    }, [sceneState.unitGroups]);

    const travelToArea = useCallback((targetArea: AreaId, spawn: { x: number; z: number }, direction?: "north" | "south" | "east" | "west") => {
        if (!AREAS[targetArea]) {
            addLog(`The way forward is blocked (unknown area: ${targetArea}).`, "#ef4444");
            return;
        }
        const persistedState = buildPersistedPlayers(unitsStateRef.current, false);
        onAreaTransition(persistedState, targetArea, spawn, direction);
    }, [addLog, buildPersistedPlayers, onAreaTransition]);
    travelToAreaRef.current = travelToArea;

    const handleAreaTransition = useCallback((transition: AreaTransition) => {
        travelToArea(transition.targetArea, transition.targetSpawn, transition.direction);
    }, [travelToArea]);

    const buildWaystoneDestinations = useCallback((sourceAreaId: AreaId, sourceWaystoneIndex: number, activatedKeys: Set<string>): WaystoneDestination[] => {
        const destinations: WaystoneDestination[] = [];

        for (const [areaIdRaw, area] of Object.entries(AREAS)) {
            const areaId = areaIdRaw as AreaId;
            const waystones = area.waystones ?? [];
            const hasMultipleWaystones = waystones.length > 1;
            waystones.forEach((waystone, index) => {
                const key = getWaystoneActivationKey(areaId, index);
                if (!activatedKeys.has(key)) {
                    return;
                }

                const isCurrent = areaId === sourceAreaId && index === sourceWaystoneIndex;
                destinations.push({
                    key,
                    areaId,
                    areaName: hasMultipleWaystones ? `${area.name} (${index + 1})` : area.name,
                    areaFlavor: area.flavor,
                    waystoneIndex: index,
                    x: waystone.x,
                    z: waystone.z,
                    direction: waystone.direction ?? "north",
                    isCurrent,
                });
            });
        }

        destinations.sort((a, b) => {
            if (a.isCurrent !== b.isCurrent) {
                return a.isCurrent ? -1 : 1;
            }
            const areaCompare = a.areaName.localeCompare(b.areaName);
            if (areaCompare !== 0) {
                return areaCompare;
            }
            return a.waystoneIndex - b.waystoneIndex;
        });

        return destinations;
    }, []);

    const closeWaystoneTravelModal = useCallback(() => {
        setWaystoneTravelDestinations(null);
    }, []);

    const handleWaystoneTravel = useCallback((destination: WaystoneDestination) => {
        if (destination.isCurrent) {
            return;
        }
        lastWaystoneRef.current = { areaId: destination.areaId as AreaId, waystoneIndex: destination.waystoneIndex };
        closeWaystoneTravelModal();
        travelToArea(destination.areaId, { x: destination.x, z: destination.z }, destination.direction);
    }, [closeWaystoneTravelModal, travelToArea]);

    const handleWaystoneInteract = useCallback((_waystone: Waystone, waystoneIndex: number) => {
        const activationKey = getWaystoneActivationKey(currentAreaId, waystoneIndex);
        const nextActivated = new Set(activatedWaystonesRef.current);
        if (!nextActivated.has(activationKey)) {
            nextActivated.add(activationKey);
            activatedWaystonesRef.current = nextActivated;
            setActivatedWaystones(nextActivated);
            addLog("Waystone activated.", "#60a5fa");
        }

        lastWaystoneRef.current = { areaId: currentAreaId as AreaId, waystoneIndex };
        setWaystoneTravelDestinations(buildWaystoneDestinations(currentAreaId, waystoneIndex, nextActivated));
    }, [addLog, buildWaystoneDestinations, currentAreaId]);

    // =============================================================================
    // INPUT HANDLERS HOOK
    // =============================================================================

    const inputSceneRefs = useMemo(() => {
        if (!isInitialized || !sceneState.scene || !sceneState.camera || !sceneState.renderer) return null;
        return {
            scene: sceneState.scene,
            camera: sceneState.camera,
            renderer: sceneState.renderer,
            unitGroups: sceneState.unitGroups,
            targetRings: sceneState.targetRings,
            moveMarker: sceneState.moveMarker,
            rangeIndicator: sceneState.rangeIndicator,
            aoeIndicator: sceneState.aoeIndicator,
            secretDoorMeshes: sceneState.secretDoorMeshes
        };
    }, [isInitialized, sceneState]);

    const inputStateRefs = useMemo(() => ({
        unitsStateRef,
        selectedRef,
        pausedRef,
        pauseToggleLockedRef,
        targetingModeRef,
        consumableTargetingModeRef,
        showPanelRef,
        infoModalOpenRef,
        openedChestsRef,
        hotbarAssignmentsRef,
        pauseStartTimeRef,
        formationOrderRef,
        commandModeRef
    }), []);

    const inputMutableRefs = useMemo(() => ({
        actionQueueRef,
        actionCooldownRef,
        keysPressed,
        isDragging,
        didPan,
        isBoxSel,
        boxStart,
        boxEnd,
        lastMouse
    }), []);

    const inputSetters = useMemo(() => ({
        setSelectedIds,
        setSelBox,
        setUnits,
        setPaused,
        setTargetingMode,
        setConsumableTargetingMode,
        setSkillCooldowns,
        setQueuedActions,
        setShowPanel,
        setHoveredEnemy,
        setHoveredChest,
        setHoveredPlayer,
        setHoveredDoor,
        setHoveredWaystone,
        setHoveredSecretDoor,
        setHoveredLootBag,
        setOpenedChests,
        setOpenedSecretDoors,
        setGold,
        setCommandMode
    }), []);

    const handleNpcEngaged = useCallback((unitId: number) => {
        const npcUnit = unitsStateRef.current.find(unit => unit.id === unitId);
        if (!npcUnit || npcUnit.team !== "neutral" || npcUnit.hp <= 0) return;
        const spawnIndex = unitId - 100;
        if (!Number.isInteger(spawnIndex) || spawnIndex < 0) return;
        const area = getCurrentArea();
        if (!area.enemySpawns[spawnIndex]) return;
        dialogTriggerRuntimeStateRef.current.pendingNpcEngagementSpawnIndexes.add(spawnIndex);
    }, []);

    const inputCallbacks = useMemo(() => ({
        addLog,
        getSkillContext,
        handleAreaTransition,
        handleWaystoneInteract,
        onNpcEngaged: handleNpcEngaged,
        onCloseInfoModal,
        openLootPickupModal,
        processActionQueue: doProcessQueue,
        handleCastSkillRef
    }), [addLog, getSkillContext, handleAreaTransition, handleWaystoneInteract, handleNpcEngaged, onCloseInfoModal, openLootPickupModal, doProcessQueue]);

    useInputHandlers({
        containerRef,
        sceneRefs: inputSceneRefs,
        gameRefs: gameRefs as React.MutableRefObject<InputGameRefs>,
        stateRefs: inputStateRefs,
        mutableRefs: inputMutableRefs,
        setters: inputSetters,
        callbacks: inputCallbacks
    });

    // =============================================================================
    // GAME LOOP HOOK
    // =============================================================================

    const gameLoopSceneState = useMemo((): InitializedSceneState | null => {
        if (!isInitialized || !sceneState.scene || !sceneState.camera || !sceneState.renderer) return null;
        return sceneState as InitializedSceneState;
    }, [isInitialized, sceneState]);

    const gameLoopStateRefs = useMemo(() => ({
        unitsStateRef,
        pausedRef,
        targetingModeRef,
        skillCooldownsRef,
        actionQueueRef
    }), []);

    const gameLoopCallbacks = useMemo(() => ({
        setUnits,
        setFps,
        setSkillCooldowns,
        setQueuedActions,
        addLog,
        processActionQueue: doProcessQueue,
        onPerfSample
    }), [addLog, doProcessQueue, onPerfSample]);

    useGameLoop({
        sceneState: gameLoopSceneState,
        gameRefs,
        stateRefs: gameLoopStateRefs,
        callbacks: gameLoopCallbacks,
        keysPressed,
        debugFogOfWarDisabled
    });

    // =============================================================================
    // EFFECTS
    // =============================================================================

    // Track enemy deaths for persistence and loot bag drops
    const prevAliveEnemiesRef = useRef<Set<number>>(new Set());
    useEffect(() => {
        const areaId = getCurrentAreaId();
        const staticEnemyMaxId = 99 + getCurrentArea().enemySpawns.length;
        const currentAlive = new Set<number>();
        const newlyDead: string[] = [];
        const newlyDeadUnits: Unit[] = [];

        for (const u of units) {
            if (u.team !== "enemy") continue;

            if (u.hp > 0) {
                currentAlive.add(u.id);
                continue;
            }

            if (!prevAliveEnemiesRef.current.has(u.id)) continue;

            if (u.id >= 100 && u.id <= staticEnemyMaxId && isEnemyPermanentDeath(u)) {
                const spawnIndex = u.id - 100;
                newlyDead.push(`${areaId}-${spawnIndex}`);
            }
            newlyDeadUnits.push(u);
        }

        if (newlyDead.length > 0) {
            queueMicrotask(() => {
                setKilledEnemies(prev => {
                    const next = new Set(prev);
                    for (const key of newlyDead) next.add(key);
                    return next;
                });
            });
        }

        if (sceneState.scene) {
            for (const u of newlyDeadUnits) {
                if (!isEnemyPermanentDeath(u)) continue;
                const rolledLoot = rollEnemyLoot(u.enemyType);
                if (!rolledLoot) continue;

                const g = sceneState.unitGroups[u.id];
                const x = g ? g.position.x : u.x;
                const z = g ? g.position.z : u.z;
                const bagItems = rolledLoot.items.length > 0 ? rolledLoot.items : undefined;
                const bag = spawnLootBag(sceneState.scene, x, z, rolledLoot.gold, bagItems);
                gameRefs.current.lootBags.push(bag);

                queueMicrotask(() => {
                    const lootSummary = formatRolledEnemyLootSummary(
                        rolledLoot,
                        itemId => getItem(itemId)?.name
                    );
                    if (!lootSummary) return;
                    addLog(lootSummary, COLORS.damageCrit);
                });
            }
        }

        prevAliveEnemiesRef.current = currentAlive;
    }, [units, sceneState.scene, sceneState.unitGroups, gameRefs, addLog]);

    const getSaveLockReason = useCallback((): string | null => {
        const refs = gameRefs.current;
        if (refs.projectiles.length > 0 || refs.swingAnimations.length > 0) {
            return "Cannot save during active combat actions.";
        }

        const currentUnits = unitsStateRef.current;
        const unitGroups = sceneState.unitGroups;
        const aliveUnitsById = new Map<number, Unit>();
        const alivePlayers: Unit[] = [];
        const aliveEnemies: Unit[] = [];

        for (const unit of currentUnits) {
            if (unit.hp <= 0) continue;
            aliveUnitsById.set(unit.id, unit);

            if (unit.team === "player") {
                alivePlayers.push(unit);
                continue;
            }

            if (unit.team === "enemy" && unit.enemyType) {
                aliveEnemies.push(unit);
            }
        }

        for (const unit of currentUnits) {
            if (unit.hp <= 0) continue;
            const group = unitGroups[unit.id];
            if (!group) continue;

            const attackTarget = group.userData.attackTarget;
            if (typeof attackTarget !== "number") continue;

            const targetUnit = aliveUnitsById.get(attackTarget);
            if (!targetUnit || targetUnit.team === unit.team) continue;
            return "Cannot save while units are engaged in combat.";
        }

        for (const enemy of aliveEnemies) {
            const enemyType = enemy.enemyType;
            if (!enemyType) continue;
            const enemyStats = ENEMY_STATS[enemyType];
            const enemyGroup = unitGroups[enemy.id];
            const enemyX = enemyGroup?.position.x ?? enemy.x;
            const enemyZ = enemyGroup?.position.z ?? enemy.z;

            for (const player of alivePlayers) {
                const playerGroup = unitGroups[player.id];
                const playerX = playerGroup?.position.x ?? player.x;
                const playerZ = playerGroup?.position.z ?? player.z;
                const inAggroRange = isInRange(
                    enemyX,
                    enemyZ,
                    playerX,
                    playerZ,
                    getUnitRadius(player),
                    enemyStats.aggroRange
                );
                if (inAggroRange) {
                    return "Cannot save while enemies are nearby.";
                }
            }
        }

        return null;
    }, [gameRefs, sceneState.unitGroups]);
    getSaveLockReasonRef.current = getSaveLockReason;

    // Expose game state for save
    useEffect(() => {
        gameStateRef.current = () => {
            return {
                players: buildPersistedPlayers(unitsStateRef.current, true),
                currentAreaId: getCurrentAreaId(),
                openedChests: openedChestsRef.current,
                openedSecretDoors,
                activatedWaystones: activatedWaystonesRef.current,
                gold,
                killedEnemies,
                enemyPositions: buildPersistedEnemyPositions(unitsStateRef.current),
                hotbarAssignments: hotbarAssignmentsRef.current,
                formationOrder: formationOrderRef.current,
                dialogTriggerProgress: serializeDialogTriggerProgressForSave(dialogTriggerProgressByAreaRef.current),
                fogVisibilityByArea: captureFogVisibilityMemory(getCurrentAreaId(), gameRefs.current.visibility),
                saveLockReason: getSaveLockReason(),
                lastWaystone: lastWaystoneRef.current ?? undefined,
            };
        };
        return () => { gameStateRef.current = null; };
    }, [buildPersistedPlayers, buildPersistedEnemyPositions, gameRefs, gameStateRef, openedSecretDoors, gold, killedEnemies, getSaveLockReason]);

    // Expose startDialog for chain actions
    useEffect(() => {
        startDialogRef.current = startDialog;
        return () => { startDialogRef.current = null; };
    }, [startDialogRef, startDialog]);

    // Update selection rings
    useEffect(() => {
        const selectedSet = new Set<number>(selectedIds);
        const unitsById = new Map<number, Unit>(units.map(unit => [unit.id, unit]));

        Object.entries(sceneState.selectRings).forEach(([id, ring]) => {
            const numericId = Number(id);
            const unit = unitsById.get(numericId);
            ring.visible = selectedSet.has(numericId) && (unit?.hp ?? 0) > 0;
        });

        const selectedUnit = unitsById.get(selectedIds[0]);
        const shouldShowPanel = selectedIds.length === 1 && selectedUnit?.team === "player" && (selectedUnit?.hp ?? 0) > 0;
        setShowPanel(prev => prev === shouldShowPanel ? prev : shouldShowPanel);
    }, [selectedIds, units, sceneState.selectRings]);

    // Debug grid
    useEffect(() => {
        const scene = sceneState.scene;
        if (!scene) return;
        if (debugGridRef.current) {
            scene.remove(debugGridRef.current);
            debugGridRef.current = null;
        }
        if (debug) {
            const group = new THREE.Group();
            group.name = "debugGrid";
            const area = getCurrentArea();
            for (let x = 0; x <= area.gridWidth; x += 5) {
                for (let z = 0; z <= area.gridHeight; z += 5) {
                    const marker = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 8), new THREE.MeshBasicMaterial({ color: 0xff0000 }));
                    marker.position.set(x, 0.2, z);
                    group.add(marker);
                    const canvas = document.createElement("canvas");
                    canvas.width = 48; canvas.height = 24;
                    const ctx = canvas.getContext("2d")!;
                    ctx.fillStyle = "#ffffff"; ctx.font = "600 14px \"DM Mono\""; ctx.textAlign = "center";
                    ctx.fillText(`${x},${z}`, 24, 17);
                    const texture = new THREE.CanvasTexture(canvas);
                    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true }));
                    sprite.position.set(x, 0.5, z);
                    sprite.scale.set(1, 0.5, 1);
                    group.add(sprite);
                }
            }
            scene.add(group);
            debugGridRef.current = group;
        }
    }, [debug, sceneState.scene]);

    // =============================================================================
    // SKILL HANDLERS
    // =============================================================================

    const handleCastSkill = useCallback((casterId: number, skill: Skill) => {
        const caster = units.find(u => u.id === casterId);
        if (!caster || caster.hp <= 0 || (caster.mana ?? 0) < skill.manaCost) return;
        if (skill.isCantrip && (caster.cantripUses?.[skill.name] ?? 0) <= 0) {
            addLog(`${UNIT_DATA[casterId]?.name ?? "Unknown"}: No uses remaining!`, getSkillTextColor(skill.type, skill.damageType));
            return;
        }
        const casterG = sceneState.unitGroups[casterId];
        if (!casterG || !sceneState.scene) return;

        if (skill.targetType === "self") {
            const skillCtx = getSkillContext();
            const cooldownEnd = actionCooldownRef.current[casterId] || 0;
            if (paused || Date.now() < cooldownEnd) {
                actionQueueRef.current[casterId] = { type: "skill", skill, targetX: casterG.position.x, targetZ: casterG.position.z };
                setQueuedActions(prev => [...prev.filter(q => q.unitId !== casterId), { unitId: casterId, skillName: skill.name }]);
                addLog(`${UNIT_DATA[casterId]?.name ?? "Unknown"} queues ${skill.name} (${paused ? "queued" : "on cooldown"})`, getSkillTextColor(skill.type, skill.damageType));
            } else {
                executeSkill(skillCtx, casterId, skill, casterG.position.x, casterG.position.z);
            }
            return;
        }

        setupTargetingMode(casterId, skill, casterG, { current: sceneState.rangeIndicator }, { current: sceneState.aoeIndicator }, setTargetingMode);
    }, [units, sceneState, paused, getSkillContext, addLog]);

    useEffect(() => {
        handleCastSkillRef.current = handleCastSkill;
    }, [handleCastSkill]);

    const handleCancelQueuedSkill = useCallback((unitId: number, skill: Skill) => {
        const queuedAction = actionQueueRef.current[unitId];
        if (!queuedAction || queuedAction.type !== "skill" || queuedAction.skill.name !== skill.name) {
            return;
        }

        delete actionQueueRef.current[unitId];
        setQueuedActions(prev => prev.filter(q => q.unitId !== unitId));
        addLog(
            `${UNIT_DATA[unitId]?.name ?? "Unknown"} cancels ${skill.name}.`,
            getSkillTextColor(skill.type, skill.damageType)
        );
    }, [addLog]);

    const handleStop = useCallback(() => {
        stopSelectedUnits({
            selectedIds: selectedRef.current,
            unitGroups: sceneState.unitGroups,
            pathsRef: gameRefs.current.paths,
            actionQueueRef: actionQueueRef.current,
            setQueuedActions,
            setUnits
        });
    }, [sceneState.unitGroups, gameRefs]);

    const handleHold = useCallback(() => {
        toggleHoldPositionForSelectedUnits(
            {
                selectedIds: selectedRef.current,
                unitGroups: sceneState.unitGroups,
                pathsRef: gameRefs.current.paths,
                actionQueueRef: actionQueueRef.current,
                setQueuedActions,
                setUnits
            },
            unitsStateRef.current
        );
    }, [sceneState.unitGroups, gameRefs]);

    const handleSelectAllPlayers = useCallback(() => {
        const controllableIds = unitsStateRef.current
            .filter(u => u.team === "player" && u.hp > 0)
            .map(u => u.id);
        setSelectedIds(controllableIds);
        if (controllableIds.length === 0) {
            setCommandMode(null);
        }
    }, []);

    const handleDeselectAllPlayers = useCallback(() => {
        setSelectedIds([]);
        setCommandMode(null);
    }, []);

    const handleTogglePartyAutoBattle = useCallback(() => {
        const players = unitsStateRef.current.filter(u => u.team === "player");
        if (players.length === 0) return;

        const enableAutoBattle = players.some(u => !u.aiEnabled);
        updateUnitsWhere(setUnits, u => u.team === "player", { aiEnabled: enableAutoBattle });
        addLog(
            `Auto-battle ${enableAutoBattle ? "enabled" : "disabled"} for party and summons.`,
            enableAutoBattle ? "#22c55e" : "#f59e0b"
        );
    }, [addLog]);

    const handleTogglePause = useCallback(() => {
        if (pauseToggleLockedRef.current && pausedRef.current) {
            return;
        }
        togglePause(
            getPauseRuntimeRefs(),
            { pausedRef },
            { setPaused, setSkillCooldowns },
            doProcessQueue
        );
    }, [doProcessQueue, getPauseRuntimeRefs]);

    const clampUnitToEffectiveCaps = useCallback((unitId: number) => {
        updateUnitWith(setUnits, unitId, u => ({
            hp: Math.min(u.hp, getEffectiveMaxHp(u.id, u)),
            mana: u.mana === undefined ? undefined : Math.min(u.mana, getEffectiveMaxMana(u.id, u)),
        }));
    }, []);

    const handleEquipItem = useCallback((unitId: number, itemId: string, slot: EquipmentSlot) => {
        const transaction = equipItemForCharacter(unitId, itemId, slot);
        if (!transaction) return;

        clampUnitToEffectiveCaps(unitId);

        const item = getItem(itemId);
        if (item) {
            addLog(`${UNIT_DATA[unitId]?.name ?? "Unknown"} equips ${item.name}.`, "#58a6ff");
        }
    }, [addLog, clampUnitToEffectiveCaps]);

    const handleUnequipItem = useCallback((unitId: number, slot: EquipmentSlot) => {
        const transaction = unequipItemForCharacter(unitId, slot);
        if (!transaction) return;

        clampUnitToEffectiveCaps(unitId);

        const itemId = transaction.previousEquipment[slot];
        const item = itemId ? getItem(itemId) : undefined;
        if (item) {
            addLog(`${UNIT_DATA[unitId]?.name ?? "Unknown"} unequips ${item.name}.`, "#58a6ff");
        }
    }, [addLog, clampUnitToEffectiveCaps]);

    const handleMoveEquippedItem = useCallback((unitId: number, fromSlot: EquipmentSlot, toSlot: EquipmentSlot) => {
        const transaction = moveEquippedItemForCharacter(unitId, fromSlot, toSlot);
        if (!transaction) return;

        clampUnitToEffectiveCaps(unitId);

        const movedItemId = transaction.previousEquipment[fromSlot];
        const movedItem = movedItemId ? getItem(movedItemId) : undefined;
        if (movedItem) {
            addLog(
                `${UNIT_DATA[unitId]?.name ?? "Unknown"} moves ${movedItem.name} (${fromSlot} -> ${toSlot}).`,
                "#58a6ff"
            );
        }
    }, [addLog, clampUnitToEffectiveCaps]);

    const handleUseConsumable = useCallback((itemId: string, userId: number) => {
        const item = getItem(itemId);
        if (!item || !isConsumable(item)) return;
        const userUnit = units.find(u => u.id === userId);
        if (!userUnit || userUnit.hp <= 0) return;

        // Targeted consumables enter targeting mode instead of immediate use
        if (item.targetType) {
            setConsumableTargetingMode({ userId, itemId });
            return;
        }

        const now = Date.now();
        const cooldownEnd = actionCooldownRef.current[userId] || 0;
        if (paused || now < cooldownEnd) {
            actionQueueRef.current[userId] = { type: "consumable", itemId };
            setQueuedActions(prev => [...prev.filter(q => q.unitId !== userId), { unitId: userId, skillName: item.name }]);
            addLog(`${UNIT_DATA[userId]?.name ?? "Unknown"} prepares ${item.name}... (${paused ? "queued" : "on cooldown"})`, "#888");
            return;
        }
        executeConsumable(userId, itemId);
    }, [units, paused, addLog, executeConsumable]);

    const handleCancelQueuedConsumable = useCallback((itemId: string, userId: number) => {
        const queuedAction = actionQueueRef.current[userId];
        if (!queuedAction || queuedAction.type !== "consumable" || queuedAction.itemId !== itemId) {
            return;
        }

        const item = getItem(itemId);
        delete actionQueueRef.current[userId];
        setQueuedActions(prev => prev.filter(q => q.unitId !== userId));
        addLog(
            `${UNIT_DATA[userId]?.name ?? "Unknown"} cancels ${item?.name ?? "that item"}.`,
            "#888"
        );
    }, [addLog]);

    const handleConsumableTarget = useCallback((deadAllyId: number) => {
        if (!consumableTargetingMode) return;
        const { userId, itemId } = consumableTargetingMode;
        setConsumableTargetingMode(null);

        const item = getItem(itemId);
        if (!item || !isConsumable(item)) return;

        // Validate target is a dead ally
        const deadAlly = units.find(u => u.id === deadAllyId && u.team === "player" && u.hp <= 0);
        if (!deadAlly) {
            addLog(`${UNIT_DATA[userId]?.name ?? "Unknown"}: Must target a fallen ally!`, "#888");
            return;
        }

        const now = Date.now();
        const cooldownEnd = actionCooldownRef.current[userId] || 0;
        if (paused || now < cooldownEnd) {
            actionQueueRef.current[userId] = { type: "consumable", itemId, targetId: deadAllyId };
            setQueuedActions(prev => [...prev.filter(q => q.unitId !== userId), { unitId: userId, skillName: item.name }]);
            addLog(`${UNIT_DATA[userId]?.name ?? "Unknown"} prepares ${item.name}... (${paused ? "queued" : "on cooldown"})`, "#888");
            return;
        }
        executeConsumable(userId, itemId, deadAllyId);
    }, [units, paused, addLog, executeConsumable, consumableTargetingMode]);

    const handleWarpToArea = useCallback((areaId: AreaId) => {
        const persistedState = buildPersistedPlayers(unitsStateRef.current, false);
        onAreaTransition(persistedState, areaId, AREAS[areaId].defaultSpawn);
    }, [buildPersistedPlayers, onAreaTransition]);

    const handleAddXp = useCallback((amount: number) => {
        const scene = sceneState.scene;
        if (!scene) return;
        const currentUnits = unitsStateRef.current ?? [];
        const leveledUpIds: number[] = [];
        for (const u of currentUnits) {
            if (u.team === "player" && u.hp > 0) {
                const newExp = (u.exp ?? 0) + amount;
                if (newExp >= getXpForLevel((u.level ?? 1) + 1)) leveledUpIds.push(u.id);
            }
        }

        setUnits(prev => prev.map(u => {
            if (u.team === "player" && u.hp > 0) {
                const newExp = (u.exp ?? 0) + amount;
                const currentLevel = u.level ?? 1;
                if (newExp >= getXpForLevel(currentLevel + 1)) {
                    const maxHp = getEffectiveMaxHp(u.id, u);
                    const maxMana = getEffectiveMaxMana(u.id, u);
                    return {
                        ...u, exp: newExp, level: currentLevel + 1,
                        statPoints: (u.statPoints ?? 0) + LEVEL_UP_STAT_POINTS,
                        skillPoints: (u.skillPoints ?? 0) + LEVEL_UP_SKILL_POINTS,
                        hp: Math.min(u.hp + LEVEL_UP_HP, maxHp), mana: Math.min((u.mana ?? 0) + LEVEL_UP_MANA, maxMana),
                        stats: u.stats ?? { strength: 0, dexterity: 0, vitality: 0, intelligence: 0, faith: 0 }
                    };
                }
                return { ...u, exp: newExp };
            }
            return u;
        }));

        addLog(`Debug: Party gained ${amount} Experience!`, "#9b59b6");
        if (leveledUpIds.length > 0) {
            const names = leveledUpIds.map(id => UNIT_DATA[id]?.name ?? "Unknown").join(", ");
            addLog(`${names} leveled up! +${LEVEL_UP_STAT_POINTS} stat points available.`, "#ffd700");
            soundFns.playLevelUp();
            for (const unitId of leveledUpIds) {
                const unitGroup = sceneState.unitGroups[unitId];
                if (unitGroup) createLightningPillar(scene, unitGroup.position.x, unitGroup.position.z, { color: "#ffd700", duration: 600, radius: 0.3, height: 10 });
            }
        }
    }, [sceneState, addLog]);

    const handleStatBoost = useCallback(() => {
        setUnits(prev => prev.map(u => {
            if (u.team !== "player") return u;

            const currentStats = u.stats ?? ZERO_STATS;
            const boostedStats: CharacterStats = {
                strength: currentStats.strength + STAT_BOOST_AMOUNT,
                dexterity: currentStats.dexterity + STAT_BOOST_AMOUNT,
                vitality: currentStats.vitality + STAT_BOOST_AMOUNT,
                intelligence: currentStats.intelligence + STAT_BOOST_AMOUNT,
                faith: currentStats.faith + STAT_BOOST_AMOUNT
            };

            const updatedUnit: Unit = { ...u, stats: boostedStats };
            if (u.hp <= 0) {
                return updatedUnit;
            }

            const nextHpCap = getEffectiveMaxHp(u.id, updatedUnit);
            const nextManaCap = getEffectiveMaxMana(u.id, updatedUnit);
            const nextMana = u.mana === undefined
                ? undefined
                : Math.min(u.mana + STAT_BOOST_AMOUNT * MP_PER_INTELLIGENCE, nextManaCap);

            return {
                ...updatedUnit,
                hp: Math.min(u.hp + STAT_BOOST_AMOUNT * HP_PER_VITALITY, nextHpCap),
                mana: nextMana
            };
        }));

        addLog(`Debug: Stat Boost applied (+${STAT_BOOST_AMOUNT} to all stats).`, "#9b59b6");
    }, [addLog]);

    const unlockAllPlayerSkills = useCallback(() => {
        setUnits(prev => prev.map(u => {
            if (u.team !== "player") return u;
            const data = UNIT_DATA[u.id];
            if (!data) return u;

            const unlockedSkillNames = data.skills.map(s => s.name);
            const currentSkills = u.learnedSkills ?? [];
            const alreadyUnlocked = unlockedSkillNames.length === currentSkills.length
                && unlockedSkillNames.every(name => currentSkills.includes(name));

            if (alreadyUnlocked) return u;
            return { ...u, learnedSkills: unlockedSkillNames };
        }));
    }, []);

    const updatePlaytestSettings = useCallback((patch: Partial<PlaytestSettings>) => {
        setPlaytestSettings(prev => {
            const next = { ...prev, ...patch };
            savePlaytestSettings(next);
            return next;
        });
    }, []);

    const handleTogglePlaytestUnlockAllSkills = useCallback(() => {
        const nextValue = !playtestSettings.unlockAllSkills;
        updatePlaytestSettings({ unlockAllSkills: nextValue });
        if (nextValue) {
            unlockAllPlayerSkills();
        }
        addLog(
            `Debug: Playtest option "Unlock Skills" ${nextValue ? "enabled" : "disabled"}.`,
            nextValue ? "#9b59b6" : "#888"
        );
    }, [addLog, playtestSettings.unlockAllSkills, updatePlaytestSettings, unlockAllPlayerSkills]);

    const handleTogglePlaytestSkipDialogs = useCallback(() => {
        const nextValue = !playtestSettings.skipDialogs;
        updatePlaytestSettings({ skipDialogs: nextValue });
        addLog(
            `Debug: Playtest option "Skip Dialogs" ${nextValue ? "enabled" : "disabled"}.`,
            nextValue ? "#9b59b6" : "#888"
        );
    }, [addLog, playtestSettings.skipDialogs, updatePlaytestSettings]);

    const handleUpdateLightingTuning = useCallback((patch: Partial<LightingTuningSettings>) => {
        setLightingTuning(prev => ({ ...prev, ...patch }));
    }, []);

    const handleResetLightingTuning = useCallback(() => {
        setLightingTuning({ ...DEFAULT_LIGHTING_TUNING });
    }, []);

    const lightingTuningOutput = useMemo(() => {
        const payload = {
            areaId: currentAreaId,
            ...lightingTuning
        };
        const compact = [
            `area=${payload.areaId}`,
            `shadows=${payload.shadowsEnabled ? 1 : 0}`,
            `exp=${payload.exposureScale.toFixed(2)}`,
            `amb=${payload.ambientScale.toFixed(2)}`,
            `hemi=${payload.hemisphereScale.toFixed(2)}`,
            `dir=${payload.directionalScale.toFixed(2)}`,
            `srad=${payload.shadowRadius.toFixed(2)}`,
            `sbias=${payload.shadowBias.toFixed(5)}`,
            `snbias=${payload.shadowNormalBias.toFixed(3)}`,
            `sprE=${payload.spriteEmissiveScale.toFixed(2)}`,
            `sprR=${payload.spriteRoughness.toFixed(2)}`,
            `sprM=${payload.spriteMetalness.toFixed(2)}`
        ].join(" ");
        return `${JSON.stringify(payload, null, 2)}\n\n${compact}`;
    }, [lightingTuning, currentAreaId]);

    // =============================================================================
    // EXTRACTED CALLBACKS (stable refs for memoized children)
    // =============================================================================

    const handleToggleDebug = useCallback(() => setDebug(d => !d), []);
    const handleToggleDebugFogOfWar = useCallback(() => {
        const nextValue = !debugFogOfWarDisabled;
        setDebugFogOfWarDisabled(nextValue);
        addLog(
            `Debug: Fog of War ${nextValue ? "hidden" : "restored"}.`,
            nextValue ? "#9b59b6" : "#888"
        );
    }, [addLog, debugFogOfWarDisabled]);
    const handleToggleFastMove = useCallback(() => setFastMove(f => !f), []);
    const handleAttackMove = useCallback(() => setCommandMode("attackMove"), []);
    const handleClosePanel = useCallback(() => setShowPanel(false), []);
    const handleCloseEquipmentModal = useCallback(() => {
        setEquipmentModalUnitId(null);
        onCloseEquipment();
    }, [onCloseEquipment]);

    const handleTargetUnit = useCallback((targetUnitId: number) => {
        if (consumableTargetingModeRef.current) {
            handleConsumableTarget(targetUnitId);
            return;
        }
        const tm = targetingModeRef.current;
        if (!tm || !sceneState.scene) return;
        const skillCtx = getSkillContext();
        handleTargetingOnUnit(
            targetUnitId, tm,
            { actionCooldownRef, actionQueueRef, rangeIndicatorRef: { current: sceneState.rangeIndicator }, aoeIndicatorRef: { current: sceneState.aoeIndicator } },
            { unitsStateRef: unitsStateRef as React.RefObject<Unit[]>, pausedRef },
            { setTargetingMode, setQueuedActions },
            sceneState.unitGroups, skillCtx, addLog
        );
    }, [handleConsumableTarget, sceneState, getSkillContext, addLog]);

    const handleAssignSkill = useCallback((unitId: number, slotIndex: number, skillName: string | null) => {
        setHotbarAssignments(prev => {
            const unitSlots = prev[unitId] || [null, null, null, null, null];
            const newSlots = [...unitSlots];
            newSlots[slotIndex] = skillName;
            const newAssignments = { ...prev, [unitId]: newSlots };
            saveHotbarAssignments(newAssignments);
            return newAssignments;
        });
    }, []);

    const handleReorderFormation = useCallback((newOrder: number[]) => {
        setFormationOrder(newOrder);
        saveFormationOrder(newOrder);
    }, []);

    const handleToggleAI = useCallback((id: number) => {
        updateUnitWith(setUnits, id, u => ({ aiEnabled: !u.aiEnabled }));
    }, []);

    const handleIncrementStat = useCallback((id: number, stat: keyof CharacterStats) => {
        updateUnitWith(setUnits, id, u => {
            if ((u.statPoints ?? 0) <= 0) return {};
            const currentStats = u.stats ?? { strength: 0, dexterity: 0, vitality: 0, intelligence: 0, faith: 0 };
            const newStats = { ...currentStats, [stat]: currentStats[stat] + 1 };
            const partial: Partial<Unit> = { statPoints: (u.statPoints ?? 0) - 1, stats: newStats };
            if (stat === "vitality") {
                const updated = { ...u, ...partial };
                partial.hp = Math.min(u.hp + HP_PER_VITALITY, getEffectiveMaxHp(u.id, updated));
            }
            if (stat === "intelligence") {
                const updated = { ...u, ...partial };
                partial.mana = Math.min((u.mana ?? 0) + MP_PER_INTELLIGENCE, getEffectiveMaxMana(u.id, updated));
            }
            return partial;
        });
    }, []);

    const handleLearnSkill = useCallback((id: number, skillName: string) => {
        updateUnitWith(setUnits, id, u => {
            if ((u.learnedSkills ?? []).includes(skillName)) return {};
            if (!playtestUnlockAllSkills && (u.skillPoints ?? 0) <= 0) return {};
            return {
                skillPoints: playtestUnlockAllSkills ? (u.skillPoints ?? 0) : (u.skillPoints ?? 0) - 1,
                learnedSkills: [...(u.learnedSkills ?? []), skillName]
            };
        });
    }, [playtestUnlockAllSkills]);

    const handleChangeEquipmentUnit = useCallback((id: number) => {
        setEquipmentModalUnitId(id);
        setSelectedIds([id]);
    }, []);

    const otherModalOpen = infoModalOpen || saveLoadOpen || isDialogOpen || isLootPickupModalOpen || isWaystoneTravelModalOpen || menuOpen || jukeboxOpen || equipmentModalOpen || sleepFadeOpacity > 0;

    // =============================================================================
    // RENDER
    // =============================================================================

    const playerUnits = useMemo(
        () => units.filter(u => u.team === "player"),
        [units]
    );
    const unitsById = useMemo(() => {
        const byId = new Map<number, Unit>();
        for (const unit of units) {
            byId.set(unit.id, unit);
        }
        return byId;
    }, [units]);
    const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
    const alivePlayers = useMemo(
        () => playerUnits.reduce((count, unit) => count + (isCorePlayerId(unit.id) && unit.hp > 0 ? 1 : 0), 0),
        [playerUnits]
    );
    const partyAutoBattleActive = useMemo(
        () => playerUnits.length > 0 && playerUnits.every(unit => unit.aiEnabled),
        [playerUnits]
    );
    const holdActive = useMemo(
        () => units.some(unit => selectedIdSet.has(unit.id) && unit.holdPosition),
        [units, selectedIdSet]
    );
    const hoveredEnemyUnit = useMemo(
        () => (hoveredEnemy ? unitsById.get(hoveredEnemy.id) : undefined),
        [hoveredEnemy, unitsById]
    );
    const hoveredPlayerUnit = useMemo(
        () => (hoveredPlayer ? unitsById.get(hoveredPlayer.id) : undefined),
        [hoveredPlayer, unitsById]
    );
    const getHealthStatusColor = useCallback((pct: number): string => {
        if (pct >= 1) return "var(--ui-color-accent-success)";
        if (pct > 0.75) return "var(--ui-color-accent-success-bright)";
        if (pct > 0.5) return "var(--ui-color-accent-warning)";
        if (pct > 0.25) return "var(--ui-color-accent-warning)";
        return "var(--ui-color-accent-danger)";
    }, []);
    const areaData = getCurrentArea();
    const selectedQueuedActionEntry = selectedIds.length === 1
        ? queuedActions.find(q => q.unitId === selectedIds[0])
        : undefined;
    const selectedPanelQueuedAction = selectedQueuedActionEntry
        ? actionQueueRef.current[selectedIds[0]]
        : undefined;
    const queuedPanelAction = selectedPanelQueuedAction?.type === "skill"
        ? { type: "skill" as const, skillName: selectedPanelQueuedAction.skill.name }
        : selectedPanelQueuedAction?.type === "consumable"
            ? { type: "consumable" as const, itemId: selectedPanelQueuedAction.itemId }
            : null;

    return (
        <div className={equipmentModalOpen ? "equip-modal-active" : undefined} style={{ width: "100%", height: "100vh", position: "relative", cursor: (targetingMode || consumableTargetingMode || commandMode === "attackMove") ? "crosshair" : "default" }}>
            <div ref={containerRef} style={{ width: "100%", height: "100%", filter: paused ? "saturate(0.4) brightness(0.85)" : "none", transition: "filter 0.2s" }} />
            {selBox && (
                <div
                    style={{
                        position: "absolute",
                        left: selBox.left,
                        top: selBox.top,
                        width: selBox.width,
                        height: selBox.height,
                        border: "1px solid var(--ui-color-selection-border)",
                        backgroundColor: "var(--ui-color-selection-fill)",
                        pointerEvents: "none"
                    }}
                />
            )}
            {/* Tooltips */}
            {hoveredEnemy && (() => {
                const enemy = hoveredEnemyUnit;
                if (!enemy?.enemyType || enemy.hp <= 0) return null;
                const stats = ENEMY_STATS[enemy.enemyType];
                const monsterTypeLabel = getMonsterTypeLabel(stats.monsterType);
                const primaryStatusLabel = getPrimaryStatusLabel(enemy.statusEffects);
                const pct = enemy.hp / stats.maxHp;
                const status = pct >= 1 ? "Unharmed" : pct > 0.75 ? "Scuffed" : pct > 0.5 ? "Injured" : pct > 0.25 ? "Badly wounded" : "Near death";
                const statusColor = getHealthStatusColor(pct);
                return (
                    <div className="enemy-tooltip enemy-tooltip--enemy" style={{ left: hoveredEnemy.x + 12, top: hoveredEnemy.y - 10 }}>
                        <div className="enemy-tooltip-name enemy-tooltip-name--enemy">
                            {stats.name}
                        </div>
                        <div className="enemy-tooltip-type">
                            {monsterTypeLabel}
                        </div>
                        <div className="enemy-tooltip-status enemy-tooltip-status-line">
                            {primaryStatusLabel && (
                                <>
                                    <span className="enemy-tooltip-effect">{primaryStatusLabel}</span>
                                    <span className="enemy-tooltip-separator">&middot;</span>
                                </>
                            )}
                            <span style={{ color: statusColor }}>{status}</span>
                        </div>
                        {debug && <div className="enemy-tooltip-status" style={{ color: "var(--ui-color-text-dim)" }}>{enemy.hp}/{stats.maxHp} HP</div>}
                    </div>
                );
            })()}

            {hoveredChest && <div className="enemy-tooltip" style={{ left: hoveredChest.x + 12, top: hoveredChest.y - 10 }}><div className="enemy-tooltip-name">{openedChests.has(`${getCurrentAreaId()}-${hoveredChest.chestIndex}`) ? "Empty Chest" : "Chest"}</div></div>}

            {hoveredPlayer && (() => {
                const player = hoveredPlayerUnit;
                if (!player || player.hp <= 0) return null;
                const data = UNIT_DATA[player.id];
                if (!data) return null;
                const pct = player.hp / data.maxHp;
                const status = pct >= 1 ? "Unharmed" : pct > 0.75 ? "Scuffed" : pct > 0.5 ? "Injured" : pct > 0.25 ? "Badly wounded" : "Near death";
                const statusColor = getHealthStatusColor(pct);
                return (
                    <div className="enemy-tooltip" style={{ left: hoveredPlayer.x + 12, top: hoveredPlayer.y - 10 }}>
                        <div className="enemy-tooltip-name">{data.name}</div>
                        <div className="enemy-tooltip-status" style={{ color: statusColor }}>{status}</div>
                    </div>
                );
            })()}

            {hoveredDoor && (
                <div className="enemy-tooltip" style={{ left: hoveredDoor.x + 12, top: hoveredDoor.y - 10 }}>
                    <div className="enemy-tooltip-name">Travel</div>
                    <div className="enemy-tooltip-status" style={{ color: "var(--ui-color-accent-primary-bright)" }}>{AREAS[hoveredDoor.targetArea as AreaId]?.name ?? hoveredDoor.targetArea}</div>
                </div>
            )}

            {hoveredWaystone && (
                <div className="enemy-tooltip" style={{ left: hoveredWaystone.x + 12, top: hoveredWaystone.y - 10 }}>
                    <div className="enemy-tooltip-name">Waystone</div>
                    <div className="enemy-tooltip-status" style={{ color: "var(--ui-color-accent-primary-bright)" }}>Fast travel</div>
                </div>
            )}

            {hoveredSecretDoor && <div className="enemy-tooltip" style={{ left: hoveredSecretDoor.x + 12, top: hoveredSecretDoor.y - 10 }}><div className="enemy-tooltip-name">Cracked wall</div></div>}

            {hoveredLootBag && (
                <div className="enemy-tooltip" style={{ left: hoveredLootBag.x + 12, top: hoveredLootBag.y - 10 }}>
                    <div className="enemy-tooltip-name">Looted Corpse</div>
                    <div className="enemy-tooltip-status" style={{ color: "var(--ui-color-accent-gold)" }}>
                        {hoveredLootBag.gold > 0
                            ? `${hoveredLootBag.gold} Gold`
                            : hoveredLootBag.hasItems
                                ? "Contains items"
                                : "Empty"}
                    </div>
                </div>
            )}

            {currentDialogNode && currentDialogSpeaker && (
                <DialogModal
                    speakerName={currentDialogSpeaker.name}
                    portraitSrc={currentDialogSpeaker.portraitSrc}
                    portraitTint={currentDialogSpeaker.portraitTint}
                    visibleText={dialogVisibleText}
                    isTyping={isDialogTyping}
                    choices={dialogChoiceOptions}
                    canContinueWithoutChoices={canContinueWithoutChoices}
                    continueLabel={currentDialogNode.continueLabel ?? "Continue"}
                    onSkipTyping={skipDialogTyping}
                    onSkipDialog={closeDialog}
                    onContinueWithoutChoices={continueDialogWithoutChoices}
                    onChoose={chooseDialogOption}
                />
            )}

            {lootPickupModalState && (
                <LootPickupModal
                    sourceLabel={lootPickupModalState.sourceLabel}
                    entries={lootPickupModalState.entries}
                    onTake={takeLootPickup}
                />
            )}

            {waystoneTravelDestinations && (
                <WaystoneTravelModal
                    currentAreaName={areaData.name}
                    destinations={waystoneTravelDestinations}
                    onTravel={handleWaystoneTravel}
                    onClose={closeWaystoneTravelModal}
                />
            )}

            <div
                style={{
                    position: "absolute",
                    inset: 0,
                    backgroundColor: "var(--ui-color-overlay-strong)",
                    opacity: sleepFadeOpacity,
                    pointerEvents: sleepFadeOpacity > 0 ? "all" : "none",
                    transition: `opacity ${SPEND_NIGHT_FADE_MS}ms ease-in-out`,
                    zIndex: 9500
                }}
            />

            {/* FPS */}
            <div style={{ position: "absolute", top: 10, right: 10, color: "var(--ui-color-text-dim)", fontSize: 11, opacity: 0.6 }}>{fps} fps</div>

            {/* UI Components */}
            <HUD areaName={areaData.name} areaFlavor={areaData.flavor} alivePlayers={alivePlayers} paused={paused} onTogglePause={handleTogglePause} onShowControls={onShowControls} onShowHelp={onShowHelp} onShowGlossary={onShowGlossary} onRestart={onRestart} onSaveClick={onSaveClick} onLoadClick={onLoadClick} debug={debug} onToggleDebug={handleToggleDebug} onWarpToArea={handleWarpToArea} onAddXp={handleAddXp} onStatBoost={handleStatBoost} onTogglePlaytestUnlockAllSkills={handleTogglePlaytestUnlockAllSkills} playtestUnlockAllSkillsEnabled={playtestSettings.unlockAllSkills} onTogglePlaytestSkipDialogs={handleTogglePlaytestSkipDialogs} playtestSkipDialogsEnabled={playtestSettings.skipDialogs} onToggleFastMove={handleToggleFastMove} fastMoveEnabled={fastMove} onToggleDebugFogOfWar={handleToggleDebugFogOfWar} debugFogOfWarDisabled={debugFogOfWarDisabled} lightingTuning={lightingTuning} onUpdateLightingTuning={handleUpdateLightingTuning} onResetLightingTuning={handleResetLightingTuning} lightingTuningOutput={lightingTuningOutput} menuOpen={menuOpen} jukeboxOpen={jukeboxOpen} onOpenMenu={onOpenMenu} onCloseMenu={onCloseMenu} onOpenJukebox={onOpenJukebox} onCloseJukebox={onCloseJukebox} otherModalOpen={otherModalOpen} hasSelection={selectedIds.length > 0} />
            <CombatLog log={combatLog} />
            <FormationIndicator units={playerUnits} formationOrder={formationOrder} onReorderFormation={handleReorderFormation} />
            <div className="bottom-bar-container">
            <CommandBar
                commandMode={commandMode}
                onStop={handleStop}
                onHold={handleHold}
                onAttackMove={handleAttackMove}
                onSelectAll={handleSelectAllPlayers}
                onDeselectAll={handleDeselectAllPlayers}
                onToggleAutoBattle={handleTogglePartyAutoBattle}
                hasSelection={selectedIds.length > 0}
                holdActive={holdActive}
                partyAutoBattleActive={partyAutoBattleActive}
            />
            <PartyBar
                units={playerUnits} selectedIds={selectedIds} onSelect={setSelectedIds} targetingMode={targetingMode}
                consumableTargetingMode={consumableTargetingMode}
                onTargetUnit={handleTargetUnit}
                hotbarAssignments={hotbarAssignments}
                onAssignSkill={handleAssignSkill}
                onCastSkill={handleCastSkill} skillCooldowns={skillCooldowns} paused={paused}
                formationOrder={formationOrder}
                onReorderFormation={handleReorderFormation}
                hideHotbar={equipmentModalOpen}
            />
            </div>
            {showPanel && selectedIds.length === 1 && (
                <UnitPanel
                    unitId={selectedIds[0]} units={playerUnits} onClose={handleClosePanel}
                    onToggleAI={handleToggleAI}
                    onCastSkill={handleCastSkill}
                    onCancelQueuedSkill={handleCancelQueuedSkill}
                    skillCooldowns={skillCooldowns}
                    paused={paused}
                    queuedAction={queuedPanelAction}
                    onUseConsumable={handleUseConsumable}
                    onCancelQueuedConsumable={handleCancelQueuedConsumable}
                    consumableCooldownEnd={selectedConsumableCooldownEnd}
                    onOpenEquipment={setEquipmentModalUnitId}
                    onIncrementStat={handleIncrementStat}
                    onLearnSkill={handleLearnSkill}
                    gold={gold}
                />
            )}
            {equipmentModalUnitId !== null && (
                <EquipmentModal
                    key={equipmentModalUnitId}
                    unitId={equipmentModalUnitId}
                    onClose={handleCloseEquipmentModal}
                    onEquipItem={handleEquipItem}
                    onUnequipItem={handleUnequipItem}
                    onMoveEquippedItem={handleMoveEquippedItem}
                    onChangeUnit={handleChangeEquipmentUnit}
                    formationOrder={formationOrder}
                />
            )}
        </div>
    );
}

// =============================================================================
// APP WRAPPER
// =============================================================================

// Transition timing constants
const AREA_FADE_DURATION = 300; // ms for area transition fade in/out
const STARTUP_SCENE_FADE_IN_DURATION = 1400; // ms for initial black-to-scene fade
const STARTUP_FANFARE_LEAD_IN_MS = 550;
const DIALOG_TRIGGER_POLL_MS = 120;
type StartupPhase = "title" | "booting" | "running";
type InfoModalKind = "controls" | "help" | "glossary";

function shouldSkipGameIntro(): boolean {
    return loadPlaytestSettings().skipDialogs;
}

export default function App() {
    const [skipIntroByDefault] = useState<boolean>(shouldSkipGameIntro);
    const [gameKey, setGameKey] = useState(0);
    const [openInfoModal, setOpenInfoModal] = useState<InfoModalKind | null>(null);
    const [menuOpen, setMenuOpen] = useState(false);
    const [jukeboxOpen, setJukeboxOpen] = useState(false);
    const pendingChainActionRef = useRef<MenuChainAction | null>(null);
    const [persistedPlayers, setPersistedPlayers] = useState<PersistedPlayer[] | null>(null);
    const [spawnPoint, setSpawnPoint] = useState<{ x: number; z: number } | null>(null);
    const [spawnDirection, setSpawnDirection] = useState<"north" | "south" | "east" | "west" | undefined>(undefined);
    const [showSaveLoad, setShowSaveLoad] = useState(false);
    const [saveLoadMode, setSaveLoadMode] = useState<"save" | "load">("save");
    const [hasSaves] = useState(() => getSaveSlots().some(s => s !== null));
    const [initialOpenedChests, setInitialOpenedChests] = useState<Set<string> | null>(null);
    const [initialOpenedSecretDoors, setInitialOpenedSecretDoors] = useState<Set<string> | null>(null);
    const [initialActivatedWaystones, setInitialActivatedWaystones] = useState<Set<string> | null>(null);
    const [initialGold, setInitialGold] = useState<number | null>(null);
    const [initialKilledEnemies, setInitialKilledEnemies] = useState<Set<string> | null>(null);
    const [initialEnemyPositions, setInitialEnemyPositions] = useState<Partial<Record<string, { x: number; z: number }>> | null>(null);
    const [initialDialogTriggerProgress, setInitialDialogTriggerProgress] = useState<DialogTriggerProgress | null>(null);
    const [initialLastWaystone, setInitialLastWaystone] = useState<{ areaId: AreaId; waystoneIndex: number } | null>(null);
    const [savePreviewState, setSavePreviewState] = useState<SaveSlotData | null>(null);
    const [saveDisabledReason, setSaveDisabledReason] = useState<string | null>(null);
    const gameStateRef = useRef<(() => SaveableGameState) | null>(null);
    const startDialogRef = useRef<((definition: DialogDefinition) => void) | null>(null);
    const [startupPhase, setStartupPhase] = useState<StartupPhase>(skipIntroByDefault ? "running" : "title");
    const [gameMounted, setGameMounted] = useState(skipIntroByDefault);
    const [dialogTriggersEnabled, setDialogTriggersEnabled] = useState(skipIntroByDefault);

    // Transition overlay state (starts opaque unless intro is skipped)
    const [transitionOpacity, setTransitionOpacity] = useState(skipIntroByDefault ? 0 : 1);
    const pendingTransition = useRef<{ players: PersistedPlayer[]; targetArea: AreaId; spawn: { x: number; z: number }; direction?: "north" | "south" | "east" | "west" } | null>(null);
    const transitionTimeoutRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
    const startupBootTimeoutRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
    const startupReadyTimeoutRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
    const skipNextFogSaveOnUnmountRef = useRef(false);

    const setCurrentAreaWithPathReset = useCallback((areaId: AreaId) => {
        setCurrentArea(areaId);
        clearPathCache();
        invalidateDynamicObstacles();
    }, []);

    const startStartupBoot = useCallback((options?: { playFanfare?: boolean; mountDelayMs?: number }) => {
        const playFanfare = options?.playFanfare ?? false;
        const mountDelayMs = options?.mountDelayMs ?? 0;

        setStartupPhase("booting");
        setDialogTriggersEnabled(false);
        setTransitionOpacity(1);
        if (playFanfare) {
            soundFns.playGameStartFanfare();
        }

        if (startupBootTimeoutRef.current !== null) {
            window.clearTimeout(startupBootTimeoutRef.current);
            startupBootTimeoutRef.current = null;
        }

        if (mountDelayMs <= 0) {
            setGameMounted(true);
            return;
        }

        startupBootTimeoutRef.current = window.setTimeout(() => {
            startupBootTimeoutRef.current = null;
            setGameMounted(true);
        }, mountDelayMs);
    }, []);

    const handleStartGame = useCallback(() => {
        if (startupPhase !== "title") return;
        startStartupBoot({ playFanfare: true, mountDelayMs: STARTUP_FANFARE_LEAD_IN_MS });
    }, [startupPhase, startStartupBoot]);

    const executePendingChain = useCallback(() => {
        const action = pendingChainActionRef.current;
        pendingChainActionRef.current = null;
        if (!action) return;
        if (action.type === "open_menu") {
            // Dispatch without passing a chain to prevent infinite loops
            const id = action.menuId;
            if (id === "controls" || id === "startup_controls") { setOpenInfoModal("controls"); }
            else if (id === "help") { setOpenInfoModal("help"); }
            else if (id === "glossary") { setOpenInfoModal("glossary"); }
            else if (id === "save_game") { setSaveLoadMode("save"); setShowSaveLoad(true); }
            else if (id === "load_game") { setSaveLoadMode("load"); setShowSaveLoad(true); }
            else if (id === "equipment") { /* equipment needs a unit — skip if no obvious target */ }
            else if (id === "menu") { setMenuOpen(true); }
            else if (id === "jukebox") { setJukeboxOpen(true); }
        }
        if (action.type === "open_dialog") {
            const area = getCurrentArea();
            const areaDialogs = buildAreaDialogDefinitionMap(area.dialogs);
            const definition = areaDialogs.get(action.dialogId) ?? getDialogDefinitionById(action.dialogId);
            if (definition) {
                const overriddenDefinition = action.startNodeId && definition.nodes[action.startNodeId]
                    ? { ...definition, startNodeId: action.startNodeId }
                    : definition;
                startDialogRef.current?.(overriddenDefinition);
            }
        }
    }, []);

    const handleShowControls = useCallback((options?: { chainAction?: MenuChainAction }) => {
        pendingChainActionRef.current = options?.chainAction ?? null;
        setOpenInfoModal("controls");
    }, []);

    const handleShowHelp = useCallback((options?: { chainAction?: MenuChainAction }) => {
        pendingChainActionRef.current = options?.chainAction ?? null;
        setOpenInfoModal("help");
    }, []);

    const handleShowGlossary = useCallback((options?: { chainAction?: MenuChainAction }) => {
        pendingChainActionRef.current = options?.chainAction ?? null;
        setOpenInfoModal("glossary");
    }, []);

    const handleCloseInfoModal = useCallback(() => {
        pendingChainActionRef.current = null;
        setOpenInfoModal(null);
    }, []);

    const handleCloseHelpModal = useCallback(() => {
        setOpenInfoModal(null);
        executePendingChain();
    }, [executePendingChain]);

    const handleConfirmControlsModal = useCallback(() => {
        setOpenInfoModal(null);
        executePendingChain();
    }, [executePendingChain]);

    const handleCloseGlossaryModal = useCallback(() => {
        setOpenInfoModal(null);
        executePendingChain();
    }, [executePendingChain]);

    const handleOpenMenu = useCallback((options?: { chainAction?: MenuChainAction }) => {
        pendingChainActionRef.current = options?.chainAction ?? null;
        setMenuOpen(true);
    }, []);

    const handleCloseMenu = useCallback(() => {
        setMenuOpen(false);
        executePendingChain();
    }, [executePendingChain]);

    const handleOpenJukebox = useCallback((options?: { chainAction?: MenuChainAction }) => {
        pendingChainActionRef.current = options?.chainAction ?? null;
        setJukeboxOpen(true);
    }, []);

    const handleCloseJukebox = useCallback(() => {
        setJukeboxOpen(false);
        executePendingChain();
    }, [executePendingChain]);

    const handleFullRestart = () => {
        const skipIntro = shouldSkipGameIntro();
        if (gameMounted) {
            skipNextFogSaveOnUnmountRef.current = true;
        }

        if (transitionTimeoutRef.current !== null) {
            window.clearTimeout(transitionTimeoutRef.current);
            transitionTimeoutRef.current = null;
        }
        if (startupBootTimeoutRef.current !== null) {
            window.clearTimeout(startupBootTimeoutRef.current);
            startupBootTimeoutRef.current = null;
        }
        if (startupReadyTimeoutRef.current !== null) {
            window.clearTimeout(startupReadyTimeoutRef.current);
            startupReadyTimeoutRef.current = null;
        }
        pendingTransition.current = null;
        setStartupPhase(skipIntro ? "running" : "title");
        setGameMounted(skipIntro);
        setDialogTriggersEnabled(skipIntro);
        setTransitionOpacity(skipIntro ? 0 : 1);
        setOpenInfoModal(null);
        setMenuOpen(false);
        setJukeboxOpen(false);
        pendingChainActionRef.current = null;
        setShowSaveLoad(false);
        setSavePreviewState(null);
        setPersistedPlayers(null);
        setSpawnPoint(null);
        setSpawnDirection(undefined);
        setInitialOpenedChests(null);
        setInitialOpenedSecretDoors(null);
        setInitialActivatedWaystones(null);
        setInitialGold(null);
        setInitialKilledEnemies(null);
        setInitialEnemyPositions(null);
        setInitialDialogTriggerProgress(null);
        setInitialLastWaystone(null);
        clearFogVisibilityMemory();
        initializeEquipmentState();
        setCurrentAreaWithPathReset(DEFAULT_STARTING_AREA);
        setGameKey(k => k + 1);
    };

    const handleAreaTransition = (players: PersistedPlayer[], targetArea: AreaId, spawn: { x: number; z: number }, direction?: "north" | "south" | "east" | "west") => {
        if (!AREAS[targetArea]) {
            if (import.meta.env.DEV) {
                console.warn(`[app] Ignoring transition to unknown area "${targetArea}".`);
            }
            return;
        }

        // Persist world progression across the forced Game remount on area transitions.
        setInitialEnemyPositions(null);
        const worldState = gameStateRef.current?.();
        if (worldState) {
            setInitialOpenedChests(new Set(worldState.openedChests));
            setInitialOpenedSecretDoors(new Set(worldState.openedSecretDoors));
            setInitialActivatedWaystones(new Set(worldState.activatedWaystones));
            setInitialKilledEnemies(new Set(worldState.killedEnemies));
            setInitialGold(worldState.gold);
            setInitialDialogTriggerProgress(worldState.dialogTriggerProgress);
            setInitialLastWaystone(worldState.lastWaystone ?? null);
        }

        // Store pending transition and start fade to black
        pendingTransition.current = { players, targetArea, spawn, direction };
        setTransitionOpacity(1);
        soundFns.playFootsteps();

        // After fade completes, execute the actual transition
        if (transitionTimeoutRef.current !== null) {
            window.clearTimeout(transitionTimeoutRef.current);
        }
        transitionTimeoutRef.current = window.setTimeout(() => {
            transitionTimeoutRef.current = null;
            if (pendingTransition.current) {
                const { players: p, targetArea: area, spawn: s, direction: dir } = pendingTransition.current;
                setPersistedPlayers(p);
                setSpawnPoint(s);
                setSpawnDirection(dir);
                setCurrentAreaWithPathReset(area);
                setGameKey(k => k + 1);
            }
        }, AREA_FADE_DURATION);
    };

    useEffect(() => {
        return () => {
            if (transitionTimeoutRef.current !== null) {
                window.clearTimeout(transitionTimeoutRef.current);
                transitionTimeoutRef.current = null;
            }
            if (startupBootTimeoutRef.current !== null) {
                window.clearTimeout(startupBootTimeoutRef.current);
                startupBootTimeoutRef.current = null;
            }
            if (startupReadyTimeoutRef.current !== null) {
                window.clearTimeout(startupReadyTimeoutRef.current);
                startupReadyTimeoutRef.current = null;
            }
        };
    }, []);

    const handleSceneReady = useCallback(() => {
        // Scene is ready, fade out the overlay
        pendingTransition.current = null;
        if (startupPhase === "booting") {
            setTransitionOpacity(0);
            if (startupReadyTimeoutRef.current !== null) {
                window.clearTimeout(startupReadyTimeoutRef.current);
            }
            startupReadyTimeoutRef.current = window.setTimeout(() => {
                startupReadyTimeoutRef.current = null;
                setDialogTriggersEnabled(true);
                setStartupPhase("running");
            }, STARTUP_SCENE_FADE_IN_DURATION);
            return;
        }
        setTransitionOpacity(0);
    }, [startupPhase]);

    const transitionDurationMs = startupPhase === "booting"
        ? STARTUP_SCENE_FADE_IN_DURATION
        : AREA_FADE_DURATION;

    const buildCurrentSavePreview = useCallback((timestamp: number): SaveSlotData | null => {
        if (!gameStateRef.current) return null;
        const state = gameStateRef.current();
        const areaData = AREAS[state.currentAreaId];
        const slotName = areaData?.name ?? state.currentAreaId;
        return buildSaveSlotData({
            timestamp,
            slotName,
            state,
            equipment: getAllEquipment(),
            inventory: getPartyInventory(),
        });
    }, []);

    useEffect(() => {
        if (!showSaveLoad) return;
        const interval = setInterval(() => {
            const saveState = gameStateRef.current?.();
            setSaveDisabledReason(saveLoadMode === "save" ? (saveState?.saveLockReason ?? null) : null);
            const preview = buildCurrentSavePreview(Date.now());
            if (preview) {
                setSavePreviewState(preview);
            }
        }, 1000);
        return () => clearInterval(interval);
    }, [showSaveLoad, saveLoadMode, buildCurrentSavePreview]);

    const handleSave = (slot: number): SaveLoadOperationResult => {
        if (!gameStateRef.current) {
            return {
                ok: false,
                code: "invalid_save_data",
                error: "Game state is unavailable. Please try again.",
            };
        }
        const state = gameStateRef.current();
        if (state.saveLockReason) {
            return {
                ok: false,
                code: "invalid_save_data",
                error: state.saveLockReason,
            };
        }
        const areaData = AREAS[state.currentAreaId];
        const saveData = buildSaveSlotData({
            timestamp: Date.now(),
            slotName: areaData?.name ?? state.currentAreaId,
            state,
            equipment: getAllEquipment(),
            inventory: getPartyInventory(),
        });
        return saveGame(slot, saveData);
    };

    const handleLoad = (slot: number): SaveLoadOperationResult => {
        const loaded = loadGame(slot);
        if (!loaded.ok) return loaded;

        const resolved = resolveLoadedSaveState(loaded.data, AREAS);
        if (!resolved.ok) return resolved;

        const saveData = resolved.data;
        const loadingFromTitleScreen = startupPhase === "title";
        if (gameMounted) {
            skipNextFogSaveOnUnmountRef.current = true;
        }

        restoreFogVisibilityMemory(saveData.fogVisibilityByArea);
        setAllEquipment(saveData.equipment);
        setPartyInventory(saveData.inventory);
        setCurrentAreaWithPathReset(saveData.areaId);
        setInitialOpenedChests(new Set(saveData.openedChests));
        setInitialOpenedSecretDoors(new Set(saveData.openedSecretDoors));
        setInitialActivatedWaystones(new Set(saveData.activatedWaystones));
        setInitialKilledEnemies(new Set(saveData.killedEnemies));
        setInitialGold(saveData.gold);
        setInitialEnemyPositions(saveData.enemyPositions ?? null);
        setPersistedPlayers(saveData.players);
        setInitialDialogTriggerProgress(saveData.dialogTriggerProgress);
        setInitialLastWaystone(saveData.lastWaystone ?? null);
        setSpawnPoint(saveData.spawnPoint);
        // Restore UI state to localStorage so Game reads it on remount
        if (saveData.hotbarAssignments) saveHotbarAssignments(saveData.hotbarAssignments);
        if (saveData.formationOrder) saveFormationOrder(saveData.formationOrder);
        if (loadingFromTitleScreen) {
            // Restore loads should boot straight into the saved scene without the new-game fanfare delay.
            startStartupBoot();
        }
        setGameKey(k => k + 1);
        return { ok: true };
    };

    const handleDelete = (slot: number): SaveLoadOperationResult => {
        return deleteSave(slot);
    };

    const openSaveLoadModal = useCallback((mode: "save" | "load", options?: { chainAction?: MenuChainAction }) => {
        pendingChainActionRef.current = options?.chainAction ?? null;
        setSaveLoadMode(mode);
        setShowSaveLoad(true);
        const saveState = gameStateRef.current?.();
        setSaveDisabledReason(mode === "save" ? (saveState?.saveLockReason ?? null) : null);
        setSavePreviewState(buildCurrentSavePreview(Date.now()));
    }, [buildCurrentSavePreview]);

    const closeSaveLoadModal = useCallback(() => {
        setShowSaveLoad(false);
        setSavePreviewState(null);
        setSaveDisabledReason(null);
        executePendingChain();
    }, [executePendingChain]);

    const handleOpenEquipment = useCallback((options?: { chainAction?: MenuChainAction }) => {
        pendingChainActionRef.current = options?.chainAction ?? null;
        // Equipment modal needs a unitId — opened via unit panel in standalone mode;
        // from dialog, just set chain and let the existing equipment open flow handle it.
        // For now, we don't auto-open equipment from dialog (needs a selected unit).
    }, []);

    const handleCloseEquipment = useCallback(() => {
        executePendingChain();
    }, [executePendingChain]);

    useEffect(() => {
        if (startupPhase !== "title" || showSaveLoad) return;

        const onAnyKeyDown = (event: KeyboardEvent) => {
            event.preventDefault();
            event.stopPropagation();
            handleStartGame();
        };

        window.addEventListener("keydown", onAnyKeyDown, true);
        return () => window.removeEventListener("keydown", onAnyKeyDown, true);
    }, [startupPhase, handleStartGame, showSaveLoad]);

    return (
        <>
            {gameMounted && (
                <Game
                    key={gameKey} onRestart={handleFullRestart} onAreaTransition={handleAreaTransition}
                    onShowControls={handleShowControls} onShowHelp={handleShowHelp} onShowGlossary={handleShowGlossary} onCloseInfoModal={handleCloseInfoModal}
                    infoModalOpen={openInfoModal !== null} saveLoadOpen={showSaveLoad}
                    menuOpen={menuOpen} jukeboxOpen={jukeboxOpen}
                    persistedPlayers={persistedPlayers} spawnPoint={spawnPoint} spawnDirection={spawnDirection}
                    onSaveClick={(opts) => openSaveLoadModal("save", opts)}
                    onLoadClick={(opts) => openSaveLoadModal("load", opts)}
                    onOpenMenu={handleOpenMenu} onCloseMenu={handleCloseMenu}
                    onOpenJukebox={handleOpenJukebox} onCloseJukebox={handleCloseJukebox}
                    onOpenEquipment={handleOpenEquipment} onCloseEquipment={handleCloseEquipment}
                    gameStateRef={gameStateRef} startDialogRef={startDialogRef}
                    initialOpenedChests={initialOpenedChests} initialOpenedSecretDoors={initialOpenedSecretDoors} initialActivatedWaystones={initialActivatedWaystones}
                    initialGold={initialGold} initialKilledEnemies={initialKilledEnemies} initialEnemyPositions={initialEnemyPositions}
                    initialDialogTriggerProgress={initialDialogTriggerProgress}
                    initialLastWaystone={initialLastWaystone}
                    dialogTriggersEnabled={dialogTriggersEnabled}
                    skipNextFogSaveOnUnmountRef={skipNextFogSaveOnUnmountRef}
                    onReady={handleSceneReady}
                />
            )}
            {gameMounted && openInfoModal === "controls" && <ControlsModal onClose={handleCloseInfoModal} onConfirm={handleConfirmControlsModal} />}
            {gameMounted && openInfoModal === "help" && <HelpModal onClose={handleCloseHelpModal} />}
            {gameMounted && openInfoModal === "glossary" && <GlossaryModal onClose={handleCloseGlossaryModal} />}
            {showSaveLoad && (
                <SaveLoadModal
                    mode={saveLoadMode}
                    onClose={closeSaveLoadModal}
                    onSave={handleSave}
                    onLoad={handleLoad}
                    onDelete={handleDelete}
                    currentState={savePreviewState}
                    saveDisabledReason={saveDisabledReason}
                    overlayClassName={startupPhase === "title" ? "modal-overlay--startup" : undefined}
                />
            )}
            {startupPhase === "title" && (
                <div className="startup-title-screen">
                    <div className="startup-title-card">
                        <h1 className="startup-title-text">Archipelago</h1>
                        <div className="startup-title-buttons">
                            <button className="startup-title-btn startup-title-btn-new" onClick={handleStartGame}>
                                New Game
                            </button>
                            {hasSaves && (
                                <button className="startup-title-btn startup-title-btn-load" onClick={() => { setSaveLoadMode("load"); setShowSaveLoad(true); }}>
                                    Load Game
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}
            {/* Transition overlay - fades to black during area transitions */}
            <div
                style={{
                    position: "fixed",
                    inset: 0,
                    backgroundColor: startupPhase === "running" ? "var(--ui-color-overlay-strong)" : "#000000",
                    opacity: transitionOpacity,
                    pointerEvents: transitionOpacity > 0 ? "all" : "none",
                    transition: `opacity ${transitionDurationMs}ms ease-in-out`,
                    zIndex: 9999
                }}
            />
            <Analytics />
            <SpeedInsights />
        </>
    );
}
