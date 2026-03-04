/**
 * BG2-STYLE ISOMETRIC TACTICS
 * Main game component - orchestrates Three.js scene and game loop via hooks
 */

import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import * as THREE from "three";

// Constants & Types
import { BUFF_TICK_INTERVAL, getSkillTextColor, setDebugSpeedMultiplier } from "./core/constants";
import type { Unit, Skill, CombatLogEntry, SelectionBox, CharacterStats, StatusEffect, EquipmentSlot } from "./core/types";

// Game Logic
import { getCurrentArea, getCurrentAreaId, setCurrentArea, AREAS, DEFAULT_STARTING_AREA, type AreaId, type AreaTransition } from "./game/areas";
import { UNIT_DATA, CORE_PLAYER_IDS, getEffectiveMaxHp, getEffectiveMaxMana, getXpForLevel, isCorePlayerId } from "./game/playerUnits";
import { LEVEL_UP_HP, LEVEL_UP_MANA, LEVEL_UP_STAT_POINTS, LEVEL_UP_SKILL_POINTS, HP_PER_VITALITY, MP_PER_INTELLIGENCE } from "./game/statBonuses";
import { ENEMY_STATS } from "./game/enemyStats";
import { SKILLS } from "./game/skills";
import { rollEnemyLoot } from "./game/enemyLoot";
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
import { applyPoison, applyStatusEffect } from "./combat/combatMath";
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
import { HpBarsOverlay } from "./components/HpBarsOverlay";
import { loadFormationOrder, saveFormationOrder } from "./hooks/formationStorage";
import { HelpModal } from "./components/HelpModal";
import { SaveLoadModal } from "./components/SaveLoadModal";
import { DialogModal } from "./components/DialogModal";
import {
    type DialogTriggerProgress,
    type SaveLoadOperationResult,
    type SaveSlotData,
    buildSaveSlotData,
    deleteSave,
    loadGame,
    resolveLoadedSaveState,
    saveGame
} from "./game/saveLoad";
import { clearFogVisibilityMemory } from "./game/fogMemory";
import { buildAreaDialogDefinitionMap } from "./dialog/areaDialogs";
import { getDialogDefinitionById } from "./dialog/registry";
import { isInRange } from "./rendering/range";
import {
    getDialogTriggerPriority,
    getTriggerStartDialogId,
    isDialogTriggerSatisfied,
    type DialogTriggerRuntimeState
} from "./dialog/triggerRuntime";
import type { DialogChoiceCondition, DialogDefinition, DialogNode, DialogSpeaker, DialogState, DialogUiAction } from "./dialog/types";
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
    onShowHelp: () => void;
    onCloseHelp: () => void;
    helpOpen: boolean;
    saveLoadOpen: boolean;
    persistedPlayers: PersistedPlayer[] | null;
    spawnPoint: { x: number; z: number } | null;
    spawnDirection?: "north" | "south" | "east" | "west";
    onSaveClick: () => void;
    onLoadClick: () => void;
    gameStateRef: React.MutableRefObject<(() => SaveableGameState) | null>;
    initialOpenedChests: Set<string> | null;
    initialOpenedSecretDoors: Set<string> | null;
    initialGold: number | null;
    initialKilledEnemies: Set<string> | null;
    initialDialogTriggerProgress: DialogTriggerProgress | null;
    dialogTriggersEnabled: boolean;
    onReady?: () => void;
}

export interface SaveableGameState {
    players: PersistedPlayer[];
    currentAreaId: AreaId;
    openedChests: Set<string>;
    openedSecretDoors: Set<string>;
    gold: number;
    killedEnemies: Set<string>;
    hotbarAssignments: HotbarAssignments;
    formationOrder: number[];
    dialogTriggerProgress: DialogTriggerProgress;
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
const SPEND_NIGHT_FADE_MS = 420;
const SPEND_NIGHT_BLACK_HOLD_MS = 260;

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

// =============================================================================
// GAME COMPONENT
// =============================================================================

function Game({
    onRestart, onAreaTransition, onShowHelp, onCloseHelp, helpOpen, saveLoadOpen,
    persistedPlayers, spawnPoint, spawnDirection, onSaveClick, onLoadClick, gameStateRef,
    initialOpenedChests, initialOpenedSecretDoors, initialGold, initialKilledEnemies, initialDialogTriggerProgress, dialogTriggersEnabled, onReady
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
            playtestUnlockAllSkills,
        }),
        [persistedPlayers, spawnPoint, spawnDirection, initialKilledEnemies, playtestUnlockAllSkills]
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
    const [targetingMode, setTargetingMode] = useState<{ casterId: number; skill: Skill } | null>(null);
    const [consumableTargetingMode, setConsumableTargetingMode] = useState<{ userId: number; itemId: string } | null>(null);
    const [queuedActions, setQueuedActions] = useState<{ unitId: number; skillName: string }[]>([]);
    const [hoveredEnemy, setHoveredEnemy] = useState<{ id: number; x: number; y: number } | null>(null);
    const [hoveredChest, setHoveredChest] = useState<{ x: number; y: number; chestIndex: number; chestX: number; chestZ: number } | null>(null);
    const [openedChests, setOpenedChests] = useState<Set<string>>(() => initialOpenedChests ?? new Set());
    const [openedSecretDoors, setOpenedSecretDoors] = useState<Set<string>>(() => initialOpenedSecretDoors ?? new Set());
    const [gold, setGold] = useState(() => initialGold ?? 30);
    const [killedEnemies, setKilledEnemies] = useState<Set<string>>(() => initialKilledEnemies ?? new Set());
    const [hoveredPlayer, setHoveredPlayer] = useState<{ id: number; x: number; y: number } | null>(null);
    const [hoveredDoor, setHoveredDoor] = useState<{ targetArea: string; x: number; y: number } | null>(null);
    const [hoveredSecretDoor, setHoveredSecretDoor] = useState<{ x: number; y: number } | null>(null);
    const [hoveredLootBag, setHoveredLootBag] = useState<{ x: number; y: number; gold: number; hasItems: boolean } | null>(null);
    const [fps, setFps] = useState(0);
    const [debug, setDebug] = useState(false);
    const [fastMove, setFastMove] = useState(false);
    const [commandMode, setCommandMode] = useState<"attackMove" | null>(null);
    const [hotbarAssignments, setHotbarAssignments] = useState<HotbarAssignments>(loadHotbarAssignments);
    const [formationOrder, setFormationOrder] = useState<number[]>(loadFormationOrder);
    const [lightingTuning, setLightingTuning] = useState<LightingTuningSettings>({ ...DEFAULT_LIGHTING_TUNING });
    const [dialogState, setDialogState] = useState<DialogState | null>(null);
    const [dialogTypedChars, setDialogTypedChars] = useState(0);
    const [sleepFadeOpacity, setSleepFadeOpacity] = useState(0);
    const [hudMenuModalOpen, setHudMenuModalOpen] = useState(false);
    const [equipmentModalUnitId, setEquipmentModalUnitId] = useState<number | null>(null);

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
    const helpOpenRef = useRef(helpOpen);
    const skillCooldownsRef = useRef(skillCooldowns);
    const openedChestsRef = useRef(openedChests);
    const hotbarAssignmentsRef = useRef(hotbarAssignments);
    const formationOrderRef = useRef(formationOrder);
    const commandModeRef = useRef(commandMode);
    const handleCastSkillRef = useRef<((unitId: number, skill: Skill) => void) | null>(null);
    const unitGroupsRef = useRef<Record<number, { position: { x: number; z: number } }>>({});
    const dialogPauseForcedRef = useRef(false);
    const dialogLastBlipAtRef = useRef(0);
    const dialogPreviousTypedCharsRef = useRef(0);
    const dialogTriggerAreaLoadedAtRef = useRef(Date.now());
    const firedDialogTriggerIdsRef = useRef<Set<string>>(new Set());
    const dialogTriggerLastFiredAtRef = useRef<Map<string, number>>(new Map());
    const dialogTriggerProgressByAreaRef = useRef<Record<string, Set<string>>>(cloneDialogTriggerProgressForRuntime(initialDialogTriggerProgress));
    const skippedDialogTriggerLogIdsRef = useRef<Set<string>>(new Set());
    const spendNightFadeTimeoutRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
    const spendNightRestoreTimeoutRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
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
    useEffect(() => { helpOpenRef.current = helpOpen; }, [helpOpen]);
    useEffect(() => { skillCooldownsRef.current = skillCooldowns; }, [skillCooldowns]);
    useEffect(() => { openedChestsRef.current = openedChests; }, [openedChests]);
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
    const equipmentModalOpen = equipmentModalUnitId !== null;
    const isDialogTyping = currentDialogNode !== null && dialogTypedChars < currentDialogNode.text.length;
    const dialogVisibleText = currentDialogNode ? currentDialogNode.text.slice(0, dialogTypedChars) : "";
    const canContinueWithoutChoices = !isDialogTyping && dialogChoiceOptions.length === 0 && currentDialogNode !== null;
    const anyMenuOpen = isDialogOpen || helpOpen || saveLoadOpen || hudMenuModalOpen || equipmentModalOpen;

    useEffect(() => {
        pauseToggleLockedRef.current = anyMenuOpen;
    }, [anyMenuOpen]);

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
        initialCameraOffset: initialCamOffset
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
        holyTilesRef: { current: gameRefs.current.holyTiles }
    }), [sceneState, gameRefs, addLog, setUnitsLive]);

    // Execute consumable
    const executeConsumable = useCallback((unitId: number, itemId: string, targetId?: number): boolean => {
        const item = getItem(itemId);
        if (!item || !isConsumable(item)) return false;

        const userUnit = unitsStateRef.current.find(u => u.id === unitId);
        if (!userUnit || userUnit.hp <= 0) return false;
        const inventory = getPartyInventory();
        if (!hasInInventory(inventory, itemId, 1)) return false;

        if (item.effect === "heal") {
            const maxHp = getEffectiveMaxHp(unitId, userUnit);
            if (userUnit.hp >= maxHp) return false;
            const newHp = Math.min(maxHp, userUnit.hp + item.value);
            const healed = newHp - userUnit.hp;
            updateUnit(setUnits, unitId, { hp: newHp });
            addLog(`${UNIT_DATA[unitId].name} uses ${item.name}, restoring ${healed} HP.`, "#22c55e");

            const poisonChanceOnUse = item.poisonChanceOnUse ?? 0;
            const isPoisonImmune = userUnit.statusEffects?.some(effect => effect.type === "cleansed") ?? false;
            if (poisonChanceOnUse > 0 && !isPoisonImmune && Math.random() * 100 < poisonChanceOnUse) {
                const now = Date.now();
                setUnits(prev => prev.map(u => (
                    u.id === unitId
                        ? applyPoison(u, unitId, now, item.poisonDamageOnUse)
                        : u
                )));
                addLog(`${UNIT_DATA[unitId].name} is poisoned by ${item.name}!`, "#7cba7c");
            }
        } else if (item.effect === "mana") {
            const maxMana = getEffectiveMaxMana(unitId, userUnit);
            const currentMana = userUnit.mana ?? 0;
            if (currentMana >= maxMana) return false;
            const newMana = Math.min(maxMana, currentMana + item.value);
            const restored = newMana - currentMana;
            updateUnit(setUnits, unitId, { mana: newMana });
            addLog(`${UNIT_DATA[unitId].name} uses ${item.name}, restoring ${restored} Mana.`, "#3b82f6");
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
            addLog(`${UNIT_DATA[unitId].name} uses ${item.name}, cleansing poison and gaining immunity.`, "#ecf0f1");
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
                addLog(`${UNIT_DATA[unitId].name} reads ${item.name} and levels up!`, "#ffd700");
                soundFns.playLevelUp();
                if (sceneState.scene) {
                    const unitGroup = sceneState.unitGroups[unitId];
                    if (unitGroup) {
                        createLightningPillar(sceneState.scene, unitGroup.position.x, unitGroup.position.z, { color: "#ffd700", duration: 600, radius: 0.3, height: 10 });
                    }
                }
            } else {
                updateUnit(setUnits, unitId, { exp: newExp });
                addLog(`${UNIT_DATA[unitId].name} reads ${item.name}, gaining ${item.value} Experience.`, "#9b59b6");
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

            addLog(`${UNIT_DATA[unitId].name} uses ${item.name}, reviving ${UNIT_DATA[targetId].name}!`, "#ffd700");
            soundFns.playHeal();
            if (sceneState.scene) {
                createLightningPillar(sceneState.scene, reviveX, reviveZ, { color: "#ffd700", duration: 600, radius: 0.3, height: 10 });
            }
        } else {
            return false;
        }

        if (item.sound === "gulp") soundFns.playGulp();
        else if (item.sound === "crunch") soundFns.playCrunch();

        setPartyInventory(removeFromInventory(inventory, itemId, 1));
        actionCooldownRef.current[unitId] = Date.now() + item.cooldown;
        return true;
    }, [addLog, sceneState]);

    // Process action queue wrapper
    const doProcessQueue = useCallback((defeatedThisFrame: Set<number>) => {
        const skillCtx = getSkillContext(defeatedThisFrame);
        processActionQueue(
            actionQueueRef, actionCooldownRef, sceneState.unitGroups,
            gameRefs.current.paths, gameRefs.current.moveStart, pausedRef,
            skillCtx, setUnits, setQueuedActions, executeConsumable
        );
    }, [getSkillContext, sceneState.unitGroups, gameRefs, executeConsumable]);

    useEffect(() => {
        if (!anyMenuOpen || pausedRef.current) return;
        togglePause(
            { pauseStartTimeRef, actionCooldownRef },
            { pausedRef },
            { setPaused, setSkillCooldowns },
            doProcessQueue
        );
    }, [anyMenuOpen, doProcessQueue]);

    const closeDialog = useCallback((options?: { resumeIfForced?: boolean }) => {
        const resumeIfForced = options?.resumeIfForced ?? true;
        setDialogState(null);
        setDialogTypedChars(0);
        dialogPreviousTypedCharsRef.current = 0;
        dialogLastBlipAtRef.current = 0;

        if (resumeIfForced && dialogPauseForcedRef.current && pausedRef.current) {
            togglePause(
                { pauseStartTimeRef, actionCooldownRef },
                { pausedRef },
                { setPaused, setSkillCooldowns },
                doProcessQueue
            );
        }
        dialogPauseForcedRef.current = false;
    }, [doProcessQueue]);

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

        if (!definition.nodes[definition.startNodeId]) {
            addLog(`Dialog "${definition.id}" is missing start node "${definition.startNodeId}".`, "#ef4444");
            return;
        }

        if (!pausedRef.current) {
            dialogPauseForcedRef.current = true;
            togglePause(
                { pauseStartTimeRef, actionCooldownRef },
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
    }, [addLog, doProcessQueue, playtestSkipDialogs]);

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

            soundFns.playHeal();
            addLog("The party spends the night and wakes restored.", "#22c55e");

            spendNightRestoreTimeoutRef.current = window.setTimeout(() => {
                spendNightRestoreTimeoutRef.current = null;
                setSleepFadeOpacity(0);
            }, SPEND_NIGHT_BLACK_HOLD_MS);
        }, SPEND_NIGHT_FADE_MS);
    }, [addLog, clearSpendNightTimers]);

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

        if (action.menuId === "controls") {
            onShowHelp();
            return;
        }
        if (action.menuId === "save_game") {
            onSaveClick();
            return;
        }
        if (action.menuId === "load_game") {
            onLoadClick();
        }
    }, [onShowHelp, onSaveClick, onLoadClick, runSpendNightEvent]);

    const closeDialogWithAction = useCallback((action: DialogUiAction | undefined) => {
        if (action) {
            closeDialog({ resumeIfForced: action.type === "event" });
            runDialogUiAction(action);
            return;
        }
        closeDialog();
    }, [closeDialog, runDialogUiAction]);

    const continueDialogWithoutChoices = useCallback(() => {
        if (!dialogState || !currentDialogNode) return;

        if (currentDialogNode.nextNodeId && dialogState.definition.nodes[currentDialogNode.nextNodeId]) {
            setDialogState({ definition: dialogState.definition, nodeId: currentDialogNode.nextNodeId });
            return;
        }

        closeDialogWithAction(currentDialogNode.onDialogEndAction);
    }, [dialogState, currentDialogNode, closeDialogWithAction]);

    const chooseDialogOption = useCallback((choiceId: string) => {
        if (!dialogState || !currentDialogNode) return;
        const selectedChoice = dialogChoiceOptionsById.get(choiceId);
        if (!selectedChoice || selectedChoice.disabled) return;
        const choice = selectedChoice.choice;

        if (choice.nextNodeId && dialogState.definition.nodes[choice.nextNodeId]) {
            setDialogState({ definition: dialogState.definition, nodeId: choice.nextNodeId });
            return;
        }

        closeDialogWithAction(choice.onDialogEndAction ?? currentDialogNode.onDialogEndAction);
    }, [dialogState, currentDialogNode, dialogChoiceOptionsById, closeDialogWithAction]);

    useEffect(() => {
        if (!dialogTriggersEnabled) return;

        const evaluateDialogTriggers = () => {
            if (isDialogOpen) return;

            const area = getCurrentArea();
            const runtimeState = dialogTriggerRuntimeStateRef.current;
            const triggers = area.dialogTriggers ?? [];
            if (triggers.length === 0) {
                runtimeState.pendingNpcEngagementSpawnIndexes.clear();
                return;
            }
            const areaDialogDefinitionsById = buildAreaDialogDefinitionMap(area.dialogs);

            // Trigger conditions that depend on position must read live scene transforms,
            // not potentially stale React unit coordinates.
            const triggerUnits = units.map(unit => {
                const group = sceneState.unitGroups[unit.id];
                if (!group) return unit;
                return {
                    ...unit,
                    x: group.position.x,
                    z: group.position.z,
                };
            });

            const now = Date.now();
            const firedIds = firedDialogTriggerIdsRef.current;
            const lastFiredAtByTriggerId = dialogTriggerLastFiredAtRef.current;
            const sortedTriggers = [...triggers].sort((a, b) => getDialogTriggerPriority(b) - getDialogTriggerPriority(a));
            const markTriggerFired = (triggerId: string): void => {
                firedIds.add(triggerId);
                dialogTriggerProgressByAreaRef.current[currentAreaId] = new Set(firedIds);
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
                    units: triggerUnits,
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
    }, [addLog, currentAreaId, dialogTriggersEnabled, isDialogOpen, killedEnemies, playtestSkipDialogs, sceneState.unitGroups, startDialog, units]);

    const buildPersistedPlayers = useCallback((allUnits: Unit[]): PersistedPlayer[] => {
        const players = allUnits.filter(u => u.team === "player");
        const corePlayers = players.filter(u => !u.summonType);
        const summon = players.find(u => u.summonType === "ancestor_warrior" && u.hp > 0);

        const toPersisted = (u: Unit): PersistedPlayer => ({
            id: u.id,
            hp: u.hp,
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
            summonedBy: u.summonedBy
        });

        return [
            ...corePlayers.map(toPersisted),
            ...(summon ? [toPersisted(summon)] : [])
        ];
    }, []);

    // Area transition handler
    const handleAreaTransition = useCallback((transition: AreaTransition) => {
        if (!AREAS[transition.targetArea]) {
            addLog(`The way forward is blocked (unknown area: ${transition.targetArea}).`, "#ef4444");
            return;
        }
        const persistedState = buildPersistedPlayers(unitsStateRef.current);
        onAreaTransition(persistedState, transition.targetArea, transition.targetSpawn, transition.direction);
    }, [addLog, buildPersistedPlayers, onAreaTransition]);

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
        helpOpenRef,
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
        onNpcEngaged: handleNpcEngaged,
        onCloseHelp,
        processActionQueue: doProcessQueue,
        handleCastSkillRef
    }), [addLog, getSkillContext, handleAreaTransition, handleNpcEngaged, onCloseHelp, doProcessQueue]);

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
        keysPressed
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

            if (u.id >= 100 && u.id <= staticEnemyMaxId) {
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
                const rolledLoot = rollEnemyLoot(u.enemyType);
                if (!rolledLoot) continue;

                const g = sceneState.unitGroups[u.id];
                const x = g ? g.position.x : u.x;
                const z = g ? g.position.z : u.z;
                const bagItems = rolledLoot.items.length > 0 ? rolledLoot.items : undefined;
                const bag = spawnLootBag(sceneState.scene, x, z, rolledLoot.gold, bagItems);
                gameRefs.current.lootBags.push(bag);

                queueMicrotask(() => {
                    const lootParts: string[] = [];
                    if (rolledLoot.gold > 0) {
                        lootParts.push(`${rolledLoot.gold} gold`);
                    }
                    for (const itemId of rolledLoot.items) {
                        const item = getItem(itemId);
                        lootParts.push(item?.name ?? itemId);
                    };
                });
            }
        }

        prevAliveEnemiesRef.current = currentAlive;
    }, [units, sceneState.scene, sceneState.unitGroups, gameRefs, addLog]);

    // Expose game state for save
    useEffect(() => {
        gameStateRef.current = () => {
            return {
                players: buildPersistedPlayers(unitsStateRef.current),
                currentAreaId: getCurrentAreaId(),
                openedChests: openedChestsRef.current,
                openedSecretDoors,
                gold,
                killedEnemies,
                hotbarAssignments: hotbarAssignmentsRef.current,
                formationOrder: formationOrderRef.current,
                dialogTriggerProgress: serializeDialogTriggerProgressForSave(dialogTriggerProgressByAreaRef.current),
            };
        };
        return () => { gameStateRef.current = null; };
    }, [buildPersistedPlayers, gameStateRef, openedSecretDoors, gold, killedEnemies]);

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
                    ctx.fillStyle = "#ffffff"; ctx.font = "600 14px \"DM Mono\", monospace"; ctx.textAlign = "center";
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
            addLog(`${UNIT_DATA[casterId].name}: No uses remaining!`, getSkillTextColor(skill.type, skill.damageType));
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
                addLog(`${UNIT_DATA[casterId].name} queues ${skill.name} (${paused ? "queued" : "on cooldown"})`, getSkillTextColor(skill.type, skill.damageType));
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
            { pauseStartTimeRef, actionCooldownRef },
            { pausedRef },
            { setPaused, setSkillCooldowns },
            doProcessQueue
        );
    }, [doProcessQueue]);

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
            addLog(`${UNIT_DATA[unitId].name} equips ${item.name}.`, "#58a6ff");
        }
    }, [addLog, clampUnitToEffectiveCaps]);

    const handleUnequipItem = useCallback((unitId: number, slot: EquipmentSlot) => {
        const transaction = unequipItemForCharacter(unitId, slot);
        if (!transaction) return;

        clampUnitToEffectiveCaps(unitId);

        const itemId = transaction.previousEquipment[slot];
        const item = itemId ? getItem(itemId) : undefined;
        if (item) {
            addLog(`${UNIT_DATA[unitId].name} unequips ${item.name}.`, "#58a6ff");
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
                `${UNIT_DATA[unitId].name} moves ${movedItem.name} (${fromSlot} -> ${toSlot}).`,
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
            addLog(`${UNIT_DATA[userId].name} prepares ${item.name}... (${paused ? "queued" : "on cooldown"})`, "#888");
            return;
        }
        executeConsumable(userId, itemId);
    }, [units, paused, addLog, executeConsumable]);

    const handleConsumableTarget = useCallback((deadAllyId: number) => {
        if (!consumableTargetingMode) return;
        const { userId, itemId } = consumableTargetingMode;
        setConsumableTargetingMode(null);

        const item = getItem(itemId);
        if (!item || !isConsumable(item)) return;

        // Validate target is a dead ally
        const deadAlly = units.find(u => u.id === deadAllyId && u.team === "player" && u.hp <= 0);
        if (!deadAlly) {
            addLog(`${UNIT_DATA[userId].name}: Must target a fallen ally!`, "#888");
            return;
        }

        const now = Date.now();
        const cooldownEnd = actionCooldownRef.current[userId] || 0;
        if (paused || now < cooldownEnd) {
            actionQueueRef.current[userId] = { type: "consumable", itemId, targetId: deadAllyId };
            setQueuedActions(prev => [...prev.filter(q => q.unitId !== userId), { unitId: userId, skillName: item.name }]);
            addLog(`${UNIT_DATA[userId].name} prepares ${item.name}... (${paused ? "queued" : "on cooldown"})`, "#888");
            return;
        }
        executeConsumable(userId, itemId, deadAllyId);
    }, [units, paused, addLog, executeConsumable, consumableTargetingMode]);

    const handleWarpToArea = useCallback((areaId: AreaId) => {
        const persistedState = buildPersistedPlayers(unitsStateRef.current);
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
            addLog(`Level up! +${LEVEL_UP_STAT_POINTS} stat points available.`, "#ffd700");
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
    const handleToggleFastMove = useCallback(() => setFastMove(f => !f), []);
    const handleAttackMove = useCallback(() => setCommandMode("attackMove"), []);
    const handleClosePanel = useCallback(() => setShowPanel(false), []);
    const handleCloseEquipmentModal = useCallback(() => setEquipmentModalUnitId(null), []);

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

    const otherModalOpen = helpOpen || saveLoadOpen || isDialogOpen || hudMenuModalOpen || equipmentModalOpen || sleepFadeOpacity > 0;

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
            <HpBarsOverlay />

            {/* Tooltips */}
            {hoveredEnemy && (() => {
                const enemy = hoveredEnemyUnit;
                if (!enemy?.enemyType || enemy.hp <= 0) return null;
                const stats = ENEMY_STATS[enemy.enemyType];
                const pct = enemy.hp / stats.maxHp;
                const status = pct >= 1 ? "Unharmed" : pct > 0.75 ? "Scuffed" : pct > 0.5 ? "Injured" : pct > 0.25 ? "Badly wounded" : "Near death";
                const statusColor = getHealthStatusColor(pct);
                return (
                    <div className="enemy-tooltip" style={{ left: hoveredEnemy.x + 12, top: hoveredEnemy.y - 10 }}>
                        <div className="enemy-tooltip-name">{stats.name}</div>
                        <div className="enemy-tooltip-status" style={{ color: statusColor }}>{status}</div>
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

            {hoveredSecretDoor && <div className="enemy-tooltip" style={{ left: hoveredSecretDoor.x + 12, top: hoveredSecretDoor.y - 10 }}><div className="enemy-tooltip-name">Cracked wall</div></div>}

            {hoveredLootBag && (
                <div className="enemy-tooltip" style={{ left: hoveredLootBag.x + 12, top: hoveredLootBag.y - 10 }}>
                    <div className="enemy-tooltip-name">Loot Bag</div>
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
            <HUD areaName={areaData.name} areaFlavor={areaData.flavor} alivePlayers={alivePlayers} paused={paused} onTogglePause={handleTogglePause} onShowHelp={onShowHelp} onRestart={onRestart} onSaveClick={onSaveClick} onLoadClick={onLoadClick} debug={debug} onToggleDebug={handleToggleDebug} onWarpToArea={handleWarpToArea} onAddXp={handleAddXp} onStatBoost={handleStatBoost} onTogglePlaytestUnlockAllSkills={handleTogglePlaytestUnlockAllSkills} playtestUnlockAllSkillsEnabled={playtestSettings.unlockAllSkills} onTogglePlaytestSkipDialogs={handleTogglePlaytestSkipDialogs} playtestSkipDialogsEnabled={playtestSettings.skipDialogs} onToggleFastMove={handleToggleFastMove} fastMoveEnabled={fastMove} lightingTuning={lightingTuning} onUpdateLightingTuning={handleUpdateLightingTuning} onResetLightingTuning={handleResetLightingTuning} lightingTuningOutput={lightingTuningOutput} otherModalOpen={otherModalOpen} hasSelection={selectedIds.length > 0} onModalOpenStateChange={setHudMenuModalOpen} />
            <CombatLog log={combatLog} />
            <FormationIndicator units={playerUnits} formationOrder={formationOrder} />
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
                    onCastSkill={handleCastSkill} skillCooldowns={skillCooldowns} paused={paused}
                    queuedSkills={queuedActions.filter(q => q.unitId === selectedIds[0]).map(q => q.skillName)}
                    onUseConsumable={handleUseConsumable} consumableCooldownEnd={selectedConsumableCooldownEnd}
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

function shouldSkipGameIntro(): boolean {
    return loadPlaytestSettings().skipDialogs;
}

export default function App() {
    const [skipIntroByDefault] = useState<boolean>(shouldSkipGameIntro);
    const [gameKey, setGameKey] = useState(0);
    const [showHelp, setShowHelp] = useState(false);
    const [persistedPlayers, setPersistedPlayers] = useState<PersistedPlayer[] | null>(null);
    const [spawnPoint, setSpawnPoint] = useState<{ x: number; z: number } | null>(null);
    const [spawnDirection, setSpawnDirection] = useState<"north" | "south" | "east" | "west" | undefined>(undefined);
    const [showSaveLoad, setShowSaveLoad] = useState(false);
    const [saveLoadMode, setSaveLoadMode] = useState<"save" | "load">("save");
    const [initialOpenedChests, setInitialOpenedChests] = useState<Set<string> | null>(null);
    const [initialOpenedSecretDoors, setInitialOpenedSecretDoors] = useState<Set<string> | null>(null);
    const [initialGold, setInitialGold] = useState<number | null>(null);
    const [initialKilledEnemies, setInitialKilledEnemies] = useState<Set<string> | null>(null);
    const [initialDialogTriggerProgress, setInitialDialogTriggerProgress] = useState<DialogTriggerProgress | null>(null);
    const [savePreviewState, setSavePreviewState] = useState<SaveSlotData | null>(null);
    const gameStateRef = useRef<(() => SaveableGameState) | null>(null);
    const [startupPhase, setStartupPhase] = useState<StartupPhase>(skipIntroByDefault ? "running" : "title");
    const [gameMounted, setGameMounted] = useState(skipIntroByDefault);
    const [dialogTriggersEnabled, setDialogTriggersEnabled] = useState(skipIntroByDefault);

    // Transition overlay state (starts opaque unless intro is skipped)
    const [transitionOpacity, setTransitionOpacity] = useState(skipIntroByDefault ? 0 : 1);
    const pendingTransition = useRef<{ players: PersistedPlayer[]; targetArea: AreaId; spawn: { x: number; z: number }; direction?: "north" | "south" | "east" | "west" } | null>(null);
    const transitionTimeoutRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
    const startupBootTimeoutRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
    const startupReadyTimeoutRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);

    const setCurrentAreaWithPathReset = useCallback((areaId: AreaId) => {
        setCurrentArea(areaId);
        clearPathCache();
        invalidateDynamicObstacles();
    }, []);

    const handleStartGame = useCallback(() => {
        if (startupPhase !== "title") return;
        setStartupPhase("booting");
        setDialogTriggersEnabled(false);
        setTransitionOpacity(1);
        soundFns.playGameStartFanfare();
        if (startupBootTimeoutRef.current !== null) {
            window.clearTimeout(startupBootTimeoutRef.current);
        }
        startupBootTimeoutRef.current = window.setTimeout(() => {
            startupBootTimeoutRef.current = null;
            setGameMounted(true);
        }, STARTUP_FANFARE_LEAD_IN_MS);
    }, [startupPhase]);

    const handleFullRestart = () => {
        const skipIntro = shouldSkipGameIntro();

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
        setShowHelp(false);
        setShowSaveLoad(false);
        setSavePreviewState(null);
        setPersistedPlayers(null);
        setSpawnPoint(null);
        setSpawnDirection(undefined);
        setInitialOpenedChests(null);
        setInitialOpenedSecretDoors(null);
        setInitialGold(null);
        setInitialKilledEnemies(null);
        setInitialDialogTriggerProgress(null);
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
        const worldState = gameStateRef.current?.();
        if (worldState) {
            setInitialOpenedChests(new Set(worldState.openedChests));
            setInitialOpenedSecretDoors(new Set(worldState.openedSecretDoors));
            setInitialKilledEnemies(new Set(worldState.killedEnemies));
            setInitialGold(worldState.gold);
            setInitialDialogTriggerProgress(worldState.dialogTriggerProgress);
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
            const preview = buildCurrentSavePreview(Date.now());
            if (preview) {
                setSavePreviewState(preview);
            }
        }, 1000);
        return () => clearInterval(interval);
    }, [showSaveLoad, buildCurrentSavePreview]);

    const handleSave = (slot: number): SaveLoadOperationResult => {
        if (!gameStateRef.current) {
            return {
                ok: false,
                code: "invalid_save_data",
                error: "Game state is unavailable. Please try again.",
            };
        }
        const state = gameStateRef.current();
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
        clearFogVisibilityMemory();
        setAllEquipment(saveData.equipment);
        setPartyInventory(saveData.inventory);
        setCurrentAreaWithPathReset(saveData.areaId);
        setInitialOpenedChests(new Set(saveData.openedChests));
        setInitialOpenedSecretDoors(new Set(saveData.openedSecretDoors));
        setInitialKilledEnemies(new Set(saveData.killedEnemies));
        setInitialGold(saveData.gold);
        setPersistedPlayers(saveData.players);
        setInitialDialogTriggerProgress(saveData.dialogTriggerProgress);
        setSpawnPoint(saveData.spawnPoint);
        // Restore UI state to localStorage so Game reads it on remount
        if (saveData.hotbarAssignments) saveHotbarAssignments(saveData.hotbarAssignments);
        if (saveData.formationOrder) saveFormationOrder(saveData.formationOrder);
        setGameKey(k => k + 1);
        return { ok: true };
    };

    const handleDelete = (slot: number): SaveLoadOperationResult => {
        return deleteSave(slot);
    };

    const openSaveLoadModal = useCallback((mode: "save" | "load") => {
        setSaveLoadMode(mode);
        setShowSaveLoad(true);
        setSavePreviewState(buildCurrentSavePreview(Date.now()));
    }, [buildCurrentSavePreview]);

    const closeSaveLoadModal = useCallback(() => {
        setShowSaveLoad(false);
        setSavePreviewState(null);
    }, []);

    useEffect(() => {
        if (startupPhase !== "title") return;

        const onAnyKeyDown = (event: KeyboardEvent) => {
            event.preventDefault();
            event.stopPropagation();
            handleStartGame();
        };

        window.addEventListener("keydown", onAnyKeyDown, true);
        return () => window.removeEventListener("keydown", onAnyKeyDown, true);
    }, [startupPhase, handleStartGame]);

    return (
        <>
            {gameMounted && (
                <Game
                    key={gameKey} onRestart={handleFullRestart} onAreaTransition={handleAreaTransition}
                    onShowHelp={() => setShowHelp(true)} onCloseHelp={() => setShowHelp(false)}
                    helpOpen={showHelp} saveLoadOpen={showSaveLoad}
                    persistedPlayers={persistedPlayers} spawnPoint={spawnPoint} spawnDirection={spawnDirection}
                    onSaveClick={() => openSaveLoadModal("save")}
                    onLoadClick={() => openSaveLoadModal("load")}
                    gameStateRef={gameStateRef}
                    initialOpenedChests={initialOpenedChests} initialOpenedSecretDoors={initialOpenedSecretDoors}
                    initialGold={initialGold} initialKilledEnemies={initialKilledEnemies}
                    initialDialogTriggerProgress={initialDialogTriggerProgress}
                    dialogTriggersEnabled={dialogTriggersEnabled}
                    onReady={handleSceneReady}
                />
            )}
            {gameMounted && showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
            {gameMounted && showSaveLoad && <SaveLoadModal mode={saveLoadMode} onClose={closeSaveLoadModal} onSave={handleSave} onLoad={handleLoad} onDelete={handleDelete} currentState={savePreviewState} />}
            {startupPhase === "title" && (
                <div className="startup-title-screen">
                    <div className="startup-title-card">
                        <h1 className="startup-title-text">Untitled Shipwreck RPG</h1>
                        <button className="startup-title-btn" onClick={handleStartGame}>
                            Start Game
                        </button>
                    </div>
                </div>
            )}
            {/* Transition overlay - fades to black during area transitions */}
            <div
                style={{
                    position: "fixed",
                    inset: 0,
                    backgroundColor: "var(--ui-color-overlay-strong)",
                    opacity: transitionOpacity,
                    pointerEvents: transitionOpacity > 0 ? "all" : "none",
                    transition: `opacity ${transitionDurationMs}ms ease-in-out`,
                    zIndex: 9999
                }}
            />
        </>
    );
}
