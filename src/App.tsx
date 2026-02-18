/**
 * BG2-STYLE ISOMETRIC TACTICS
 * Main game component - orchestrates Three.js scene and game loop via hooks
 */

import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import * as THREE from "three";

// Constants & Types
import { getSkillTextColor, setDebugSpeedMultiplier } from "./core/constants";
import type { Unit, UnitGroup, Skill, CombatLogEntry, SelectionBox, CharacterStats, SummonType } from "./core/types";

// Game Logic
import { getCurrentArea, getCurrentAreaId, setCurrentArea, AREAS, DEFAULT_STARTING_AREA, type AreaId, type AreaTransition } from "./game/areas";
import { UNIT_DATA, CORE_PLAYER_IDS, getEffectiveMaxHp, getEffectiveMaxMana, getXpForLevel, isCorePlayerId } from "./game/playerUnits";
import { LEVEL_UP_HP, LEVEL_UP_MANA, LEVEL_UP_STAT_POINTS, LEVEL_UP_SKILL_POINTS, HP_PER_VITALITY, MP_PER_INTELLIGENCE } from "./game/statBonuses";
import { ENEMY_STATS } from "./game/enemyStats";
import { initializeEquipmentState, getPartyInventory, setPartyInventory, getAllEquipment, setAllEquipment } from "./game/equipmentState";
import { removeFromInventory } from "./game/equipment";
import { getItem } from "./game/items";
import { isConsumable } from "./core/types";
import { updateChestStates } from "./rendering/scene";
import { soundFns } from "./audio";
import { findNearestPassable, findSpawnPositions } from "./ai/pathfinding";
import { updateUnit, updateUnitWith } from "./core/stateUtils";

// Extracted modules
import { executeSkill, type SkillExecutionContext } from "./combat/skills";
import { setupTargetingMode } from "./input";
import { createLightningPillar } from "./combat/damageEffects";
import { initializeUnitIdCounter, spawnLootBag } from "./gameLoop";
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
import type { HotbarAssignments } from "./hooks/hotbarStorage";
import { loadHotbarAssignments, saveHotbarAssignments } from "./hooks/hotbarStorage";
import { loadDevMode, saveDevMode } from "./hooks/localStorage";
import { CombatLog } from "./components/CombatLog";
import { HUD } from "./components/HUD";
import { FormationIndicator } from "./components/FormationIndicator";
import { loadFormationOrder, saveFormationOrder } from "./hooks/formationStorage";
import { HelpModal } from "./components/HelpModal";
import { SaveLoadModal } from "./components/SaveLoadModal";
import { type SaveSlotData, SAVE_VERSION, saveGame, loadGame } from "./game/saveLoad";
import { clearFogVisibilityMemory } from "./game/fogMemory";
import monkPortrait from "./assets/monk-portrait.png";
import barbarianPortrait from "./assets/barbarian-portrait.png";
import wizardPortrait from "./assets/wizard-portrait.png";
import paladinPortrait from "./assets/paladin-portrait.png";
import thiefPortrait from "./assets/thief-portrait.png";
import clericPortrait from "./assets/cleric-portrait.png";

const PORTRAIT_URLS = [monkPortrait, barbarianPortrait, wizardPortrait, paladinPortrait, thiefPortrait, clericPortrait];

function preloadPortraits(): Promise<void> {
    return Promise.all(
        PORTRAIT_URLS.map(src => new Promise<void>((resolve) => {
            const img = new Image();
            img.onload = () => resolve();
            img.onerror = () => resolve(); // Don't block on failure
            img.src = src;
        }))
    ).then(() => {});
}

function syncHoveredDoorRef<T extends { hoveredDoor: string | null }>(
    refs: React.MutableRefObject<T>,
    hoveredDoorTarget: string | null
): void {
    refs.current.hoveredDoor = hoveredDoorTarget;
}

function reviveUnitVisual(
    unitGroups: Record<number, UnitGroup>,
    targetId: number,
    reviveX: number,
    reviveZ: number
): void {
    const reviveGroup = unitGroups[targetId];
    if (!reviveGroup) return;
    reviveGroup.visible = true;
    reviveGroup.position.set(reviveX, reviveGroup.userData.flyHeight, reviveZ);
    reviveGroup.userData.targetX = reviveX;
    reviveGroup.userData.targetZ = reviveZ;
}

function getForwardVectorForDirection(direction?: "north" | "south" | "east" | "west"): { x: number; z: number } {
    switch (direction ?? "south") {
        case "north": return { x: 0, z: 1 };
        case "south": return { x: 0, z: -1 };
        case "east": return { x: 1, z: 0 };
        case "west": return { x: -1, z: 0 };
        default: return { x: 0, z: -1 };
    }
}

// =============================================================================
// TYPES
// =============================================================================

interface PersistedPlayer {
    id: number;
    hp: number;
    mana?: number;
    level?: number;
    exp?: number;
    stats?: CharacterStats;
    statPoints?: number;
    skillPoints?: number;
    learnedSkills?: string[];
    statusEffects?: Unit["statusEffects"];
    cantripUses?: Record<string, number>;
    summonType?: SummonType;
    summonedBy?: number;
}

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
    onReady?: () => void;
}

export interface SaveableGameState {
    players: PersistedPlayer[];
    currentAreaId: AreaId;
    openedChests: Set<string>;
    openedSecretDoors: Set<string>;
    gold: number;
    killedEnemies: Set<string>;
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

const ZERO_STATS: CharacterStats = {
    strength: 0,
    dexterity: 0,
    vitality: 0,
    intelligence: 0,
    faith: 0
};

const STAT_BOOST_AMOUNT = 10;
const PERF_LOG_FLUSH_INTERVAL_MS = 3000;
const PERF_LOG_BUFFER_LIMIT = 2000;
const PERF_LOG_ENDPOINT = "/__perf-log";

function formatPerfLogLine(sample: PerfFrameSample): string {
    const ts = new Date(sample.timestamp).toISOString();
    const heap = sample.jsHeapMb !== null ? sample.jsHeapMb.toFixed(1) : "na";
    const programs = sample.programs !== null ? String(sample.programs) : "na";
    const mode = sample.belowThreshold ? "trigger" : "capture";
    return [
        ts,
        `mode=${mode}`,
        `fps=${sample.fps.toFixed(1)}`,
        `frame=${sample.frameMs.toFixed(2)}ms`,
        `paused=${sample.paused ? 1 : 0}`,
        `units=${sample.units}`,
        `aliveP=${sample.playersAlive}`,
        `aliveE=${sample.enemiesAlive}`,
        `proj=${sample.projectiles}`,
        `dmgTxt=${sample.damageTexts}`,
        `acid=${sample.acidTiles}`,
        `sanct=${sample.sanctuaryTiles}`,
        `lights=${sample.lightsVisible}/${sample.lightsTotal}`,
        `draw=${sample.drawCalls}`,
        `tris=${sample.triangles}`,
        `geo=${sample.geometries}`,
        `tex=${sample.textures}`,
        `prog=${programs}`,
        `heapMb=${heap}`,
        `t_cache=${sample.cacheMs.toFixed(2)}`,
        `t_visual=${sample.visualMs.toFixed(2)}`,
        `t_combat=${sample.combatMs.toFixed(2)}`,
        `t_proj=${sample.projectilesMs.toFixed(2)}`,
        `t_status=${sample.statusMs.toFixed(2)}`,
        `t_fog=${sample.fogMs.toFixed(2)}`,
        `t_ai=${sample.aiMs.toFixed(2)}`,
        `t_unitAi=${sample.unitAiMs.toFixed(2)}`,
        `t_hp=${sample.hpBarsMs.toFixed(2)}`,
        `t_wall=${sample.wallMs.toFixed(2)}`,
        `t_lod=${sample.lightLodMs.toFixed(2)}`,
        `t_render=${sample.renderMs.toFixed(2)}`
    ].join(" ");
}

// =============================================================================
// GAME COMPONENT
// =============================================================================

function Game({
    onRestart, onAreaTransition, onShowHelp, onCloseHelp, helpOpen, saveLoadOpen,
    persistedPlayers, spawnPoint, spawnDirection, onSaveClick, onLoadClick, gameStateRef,
    initialOpenedChests, initialOpenedSecretDoors, initialGold, initialKilledEnemies, onReady
}: GameProps) {
    const containerRef = useRef<HTMLDivElement>(null);

    // Initial camera offset
    const initialCamOffset = useMemo(() => spawnPoint ?? getCurrentArea().defaultSpawn, [spawnPoint]);
    const [devMode, setDevMode] = useState<boolean>(loadDevMode);

    // Create initial units
    const createUnitsForArea = useCallback((): Unit[] => {
        const area = getCurrentArea();
        const spawn = spawnPoint ?? area.defaultSpawn;
        // Sort player IDs by formation order so slot 0 (tip) goes to the right unit
        const fOrder = loadFormationOrder();
        const playerIds = [...CORE_PLAYER_IDS].sort((a, b) => {
            const ai = fOrder.indexOf(a);
            const bi = fOrder.indexOf(b);
            return (ai === -1 ? 100 + a : ai) - (bi === -1 ? 100 + b : bi);
        });
        const spawnPositions = findSpawnPositions(spawn.x, spawn.z, playerIds.length, spawnDirection ?? "north");
        const INITIAL_XP_VALUES = [0, 10, 15, 20, 25, 30];

        const players: Unit[] = playerIds.map((id, i) => {
            const data = UNIT_DATA[id];
            const persisted = persistedPlayers?.find(p => p.id === id);
            const pos = spawnPositions[i] ?? { x: spawn.x, z: spawn.z };
            const initialExp = persisted?.exp ?? (INITIAL_XP_VALUES[id] ?? 0);
            const learnedSkills = devMode
                ? data.skills.map(s => s.name)
                : (persisted?.learnedSkills ?? []);
            const defaultCantripUses = data.skills
                .filter(s => s.isCantrip && s.maxUses)
                .reduce<Record<string, number>>((acc, s) => ({ ...acc, [s.name]: s.maxUses! }), {});
            return {
                id,
                x: pos.x,
                z: pos.z,
                hp: persisted?.hp ?? getEffectiveMaxHp(id),
                mana: persisted?.mana ?? data.mana,
                level: persisted?.level ?? 1,
                exp: initialExp,
                stats: persisted?.stats,
                statPoints: persisted?.statPoints,
                skillPoints: persisted?.skillPoints ?? 1,
                learnedSkills,
                team: "player" as const,
                target: null,
                aiEnabled: true,
                statusEffects: persisted?.statusEffects,
                cantripUses: { ...defaultCantripUses, ...(persisted?.cantripUses ?? {}) }
            };
        });

        const summonPersisted = (persistedPlayers ?? [])
            .filter(p => p.summonType === "ancestor_warrior" && p.hp > 0)
            .slice(0, 1);
        const forward = getForwardVectorForDirection(spawnDirection);
        const side = { x: -forward.z, z: forward.x };
        const summons: Unit[] = [];
        summonPersisted.forEach((persisted, i) => {
            const data = UNIT_DATA[persisted.id];
            if (!data) return;
            const rank = Math.floor(i / 2);
            const lane = i % 2 === 0 ? -1 : 1;
            const desiredX = spawn.x - forward.x * (3.3 + rank * 1.2) + side.x * lane * 1.2;
            const desiredZ = spawn.z - forward.z * (3.3 + rank * 1.2) + side.z * lane * 1.2;
            const pos = findNearestPassable(desiredX, desiredZ, 5) ?? { x: spawn.x, z: spawn.z };
            summons.push({
                id: persisted.id,
                x: pos.x,
                z: pos.z,
                hp: persisted.hp,
                mana: persisted.mana ?? data.mana,
                level: persisted.level ?? 1,
                exp: persisted.exp ?? 0,
                stats: persisted.stats,
                statPoints: persisted.statPoints ?? 0,
                skillPoints: persisted.skillPoints ?? 0,
                learnedSkills: persisted.learnedSkills ?? [],
                team: "player" as const,
                target: null,
                aiEnabled: true,
                statusEffects: persisted.statusEffects,
                cantripUses: persisted.cantripUses,
                summonType: persisted.summonType,
                summonedBy: persisted.summonedBy
            });
        });

        const areaId = getCurrentAreaId();
        const killedSet = initialKilledEnemies ?? new Set<string>();
        const enemies: Unit[] = [];
        area.enemySpawns.forEach((spawn, i) => {
            const enemyKey = `${areaId}-${i}`;
            if (killedSet.has(enemyKey)) return;
            const stats = ENEMY_STATS[spawn.type];
            enemies.push({
                id: 100 + i,
                x: spawn.x,
                z: spawn.z,
                hp: stats.maxHp,
                team: "enemy" as const,
                enemyType: spawn.type,
                target: null,
                aiEnabled: true,
                ...(stats.frontShield && { facing: 0 })
            });
        });

        const allUnits = [...players, ...summons, ...enemies];
        initializeUnitIdCounter(allUnits);
        return allUnits;
    }, [persistedPlayers, spawnPoint, spawnDirection, initialKilledEnemies, devMode]);

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
    const [hpBarPositions, setHpBarPositions] = useState<{ positions: Record<number, { x: number; y: number; visible: boolean }>; scale: number }>({ positions: {}, scale: 1 });
    const [skillCooldowns, setSkillCooldowns] = useState<Record<string, { end: number; duration: number }>>({});
    const [targetingMode, setTargetingMode] = useState<{ casterId: number; skill: Skill } | null>(null);
    const [consumableTargetingMode, setConsumableTargetingMode] = useState<{ userId: number; itemId: string } | null>(null);
    const [queuedActions, setQueuedActions] = useState<{ unitId: number; skillName: string }[]>([]);
    const [hoveredEnemy, setHoveredEnemy] = useState<{ id: number; x: number; y: number } | null>(null);
    const [hoveredChest, setHoveredChest] = useState<{ x: number; y: number; chestIndex: number; chestX: number; chestZ: number } | null>(null);
    const [openedChests, setOpenedChests] = useState<Set<string>>(() => initialOpenedChests ?? new Set());
    const [openedSecretDoors, setOpenedSecretDoors] = useState<Set<string>>(() => initialOpenedSecretDoors ?? new Set());
    const [gold, setGold] = useState(() => initialGold ?? 0);
    const [killedEnemies, setKilledEnemies] = useState<Set<string>>(() => initialKilledEnemies ?? new Set());
    const [hoveredPlayer, setHoveredPlayer] = useState<{ id: number; x: number; y: number } | null>(null);
    const [hoveredDoor, setHoveredDoor] = useState<{ targetArea: string; x: number; y: number } | null>(null);
    const [hoveredSecretDoor, setHoveredSecretDoor] = useState<{ x: number; y: number } | null>(null);
    const [hoveredLootBag, setHoveredLootBag] = useState<{ x: number; y: number; gold: number } | null>(null);
    const [fps, setFps] = useState(0);
    const [debug, setDebug] = useState(false);
    const [fastMove, setFastMove] = useState(false);
    const [commandMode, setCommandMode] = useState<"attackMove" | null>(null);
    const [hotbarAssignments, setHotbarAssignments] = useState<HotbarAssignments>(loadHotbarAssignments);
    const [formationOrder, setFormationOrder] = useState<number[]>(loadFormationOrder);
    const [lightingTuning, setLightingTuning] = useState<LightingTuningSettings>({ ...DEFAULT_LIGHTING_TUNING });

    // =============================================================================
    // STATE SYNC REFS
    // =============================================================================

    const selectedRef = useRef(selectedIds);
    const unitsStateRef = useRef(units);
    const pausedRef = useRef(paused);
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

    // Preload portrait images before fade-in
    const [portraitsReady, setPortraitsReady] = useState(false);
    useEffect(() => {
        preloadPortraits().then(() => setPortraitsReady(true));
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
        setUnits,
        setSkillCooldowns,
        addLog,
        defeatedThisFrame: defeatedThisFrame ?? new Set<number>(),
        sanctuaryTilesRef: { current: gameRefs.current.sanctuaryTiles },
        acidTilesRef: { current: gameRefs.current.acidTiles },
        holyTilesRef: { current: gameRefs.current.holyTiles }
    }), [sceneState, gameRefs, addLog]);

    // Execute consumable
    const executeConsumable = useCallback((unitId: number, itemId: string, targetId?: number): boolean => {
        const item = getItem(itemId);
        if (!item || !isConsumable(item)) return false;

        const userUnit = unitsStateRef.current.find(u => u.id === unitId);
        if (!userUnit || userUnit.hp <= 0) return false;

        if (item.effect === "heal") {
            const maxHp = getEffectiveMaxHp(unitId);
            if (userUnit.hp >= maxHp) return false;
            const newHp = Math.min(maxHp, userUnit.hp + item.value);
            const healed = newHp - userUnit.hp;
            updateUnit(setUnits, unitId, { hp: newHp });
            addLog(`${UNIT_DATA[unitId].name} uses ${item.name}, restoring ${healed} HP.`, "#22c55e");
        } else if (item.effect === "mana") {
            const maxMana = UNIT_DATA[unitId].maxMana ?? 0;
            const currentMana = userUnit.mana ?? 0;
            if (currentMana >= maxMana) return false;
            const newMana = Math.min(maxMana, currentMana + item.value);
            const restored = newMana - currentMana;
            updateUnit(setUnits, unitId, { mana: newMana });
            addLog(`${UNIT_DATA[unitId].name} uses ${item.name}, restoring ${restored} Mana.`, "#3b82f6");
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

            setUnits(prev => prev.map(u => {
                if (u.id !== targetId) return u;
                return { ...u, hp: item.value, x: reviveX, z: reviveZ, statusEffects: undefined, target: null };
            }));

            // Make the unit visible and reposition
            reviveUnitVisual(sceneState.unitGroups, targetId, reviveX, reviveZ);

            addLog(`${UNIT_DATA[unitId].name} uses ${item.name}, reviving ${UNIT_DATA[targetId].name}!`, "#ffd700");
            soundFns.playHeal();
            if (sceneState.scene) {
                createLightningPillar(sceneState.scene, reviveX, reviveZ, { color: "#ffd700", duration: 600, radius: 0.3, height: 10 });
            }
        }

        if (item.sound === "gulp") soundFns.playGulp();
        else if (item.sound === "crunch") soundFns.playCrunch();

        const inventory = getPartyInventory();
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

    const inputCallbacks = useMemo(() => ({
        addLog,
        getSkillContext,
        handleAreaTransition,
        onCloseHelp,
        processActionQueue: doProcessQueue,
        handleCastSkillRef
    }), [addLog, getSkillContext, handleAreaTransition, onCloseHelp, doProcessQueue]);

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
        setHpBarPositions,
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

    // Track enemy deaths for loot bags
    const prevAliveEnemiesRef = useRef<Set<number>>(new Set());
    useEffect(() => {
        const areaId = getCurrentAreaId();
        const staticEnemyMaxId = 99 + getCurrentArea().enemySpawns.length;
        const currentAlive = new Set<number>();
        const newlyDead: string[] = [];
        const newlyDeadUnits: Unit[] = [];

        for (const u of units) {
            if (u.team === "enemy" && u.id >= 100 && u.id <= staticEnemyMaxId) {
                if (u.hp > 0) {
                    currentAlive.add(u.id);
                } else if (prevAliveEnemiesRef.current.has(u.id)) {
                    const spawnIndex = u.id - 100;
                    newlyDead.push(`${areaId}-${spawnIndex}`);
                    newlyDeadUnits.push(u);
                }
            }
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
                if (u.enemyType === "baby_kraken") {
                    const g = sceneState.unitGroups[u.id];
                    const x = g ? g.position.x : u.x;
                    const z = g ? g.position.z : u.z;
                    const bag = spawnLootBag(sceneState.scene, x, z, 100);
                    gameRefs.current.lootBags.push(bag);
                    queueMicrotask(() => {
                        addLog("The Kraken Nymph drops a bag of treasure!", "#ffd700");
                    });
                }
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
                openedSecretDoors, gold, killedEnemies
            };
        };
        return () => { gameStateRef.current = null; };
    }, [buildPersistedPlayers, gameStateRef, openedSecretDoors, gold, killedEnemies]);

    // Update selection rings
    useEffect(() => {
        Object.entries(sceneState.selectRings).forEach(([id, ring]) => {
            const unit = units.find(u => u.id === Number(id));
            ring.visible = selectedIds.includes(Number(id)) && (unit?.hp ?? 0) > 0;
        });
        const selectedUnit = units.find(u => u.id === selectedIds[0]);
        const shouldShowPanel = selectedIds.length === 1 && selectedUnit?.team === "player" && (selectedUnit?.hp ?? 0) > 0;
        queueMicrotask(() => {
            setShowPanel(shouldShowPanel);
        });
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
        setUnits(prev => prev.map(u => (
            u.team === "player"
                ? { ...u, aiEnabled: enableAutoBattle }
                : u
        )));
        addLog(
            `Auto-battle ${enableAutoBattle ? "enabled" : "disabled"} for party and summons.`,
            enableAutoBattle ? "#22c55e" : "#f59e0b"
        );
    }, [addLog]);

    const handleTogglePause = useCallback(() => {
        togglePause(
            { pauseStartTimeRef, actionCooldownRef },
            { pausedRef },
            { setPaused, setSkillCooldowns },
            doProcessQueue
        );
    }, [doProcessQueue]);

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

    const handleToggleDevMode = useCallback(() => {
        const next = !devMode;
        setDevMode(next);
        saveDevMode(next);

        if (next) {
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
            addLog("Debug: Dev Mode enabled (all skills unlocked).", "#9b59b6");
        } else {
            addLog("Debug: Dev Mode disabled.", "#888");
        }
    }, [devMode, addLog]);

    const handleUpdateLightingTuning = useCallback((patch: Partial<LightingTuningSettings>) => {
        setLightingTuning(prev => ({ ...prev, ...patch }));
    }, []);

    const handleResetLightingTuning = useCallback(() => {
        setLightingTuning({ ...DEFAULT_LIGHTING_TUNING });
    }, []);

    const currentAreaId = getCurrentAreaId();
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
    // RENDER
    // =============================================================================

    const alivePlayers = units.filter(u => u.team === "player" && isCorePlayerId(u.id) && u.hp > 0).length;
    const partyAutoBattleActive = units.some(u => u.team === "player")
        && units.filter(u => u.team === "player").every(u => u.aiEnabled);
    const areaData = getCurrentArea();

    return (
        <div style={{ width: "100%", height: "100vh", position: "relative", cursor: (targetingMode || consumableTargetingMode || commandMode === "attackMove") ? "crosshair" : "default" }}>
            <div ref={containerRef} style={{ width: "100%", height: "100%", filter: paused ? "saturate(0.4) brightness(0.85)" : "none", transition: "filter 0.2s" }} />
            {selBox && <div style={{ position: "absolute", left: selBox.left, top: selBox.top, width: selBox.width, height: selBox.height, border: "1px solid #00ff00", backgroundColor: "rgba(0,255,0,0.1)", pointerEvents: "none" }} />}

            {/* HP bars */}
            {units.filter(u => u.team === "player").map(u => {
                const pos = hpBarPositions.positions[u.id];
                if (!pos?.visible) return null;
                const maxHp = sceneState.maxHp[u.id] || 1;
                const pct = Math.max(0, u.hp / maxHp);
                const color = pct > 0.5 ? "#22c55e" : pct > 0.25 ? "#eab308" : "#ef4444";
                const barWidth = Math.max(16, 24 * hpBarPositions.scale);
                const barHeight = Math.max(2, 3 * hpBarPositions.scale);
                return (
                    <div key={u.id} style={{ position: "absolute", left: pos.x - barWidth / 2, top: pos.y - barHeight / 2, width: barWidth, height: barHeight, backgroundColor: "#111", pointerEvents: "none" }}>
                        <div style={{ width: `${pct * 100}%`, height: "100%", backgroundColor: color }} />
                    </div>
                );
            })}

            {/* Tooltips */}
            {hoveredEnemy && (() => {
                const enemy = units.find(u => u.id === hoveredEnemy.id);
                if (!enemy?.enemyType || enemy.hp <= 0) return null;
                const stats = ENEMY_STATS[enemy.enemyType];
                const pct = enemy.hp / stats.maxHp;
                const status = pct >= 1 ? "Unharmed" : pct > 0.75 ? "Scuffed" : pct > 0.5 ? "Injured" : pct > 0.25 ? "Badly wounded" : "Near death";
                const statusColor = pct >= 1 ? "#22c55e" : pct > 0.75 ? "#86efac" : pct > 0.5 ? "#eab308" : pct > 0.25 ? "#f97316" : "#ef4444";
                return (
                    <div className="enemy-tooltip" style={{ left: hoveredEnemy.x + 12, top: hoveredEnemy.y - 10 }}>
                        <div className="enemy-tooltip-name">{stats.name}</div>
                        <div className="enemy-tooltip-status" style={{ color: statusColor }}>{status}</div>
                        {debug && <div className="enemy-tooltip-status" style={{ color: "#888" }}>{enemy.hp}/{stats.maxHp} HP</div>}
                    </div>
                );
            })()}

            {hoveredChest && <div className="enemy-tooltip" style={{ left: hoveredChest.x + 12, top: hoveredChest.y - 10 }}><div className="enemy-tooltip-name">{openedChests.has(`${getCurrentAreaId()}-${hoveredChest.chestIndex}`) ? "Empty Chest" : "Chest"}</div></div>}

            {hoveredPlayer && (() => {
                const player = units.find(u => u.id === hoveredPlayer.id);
                if (!player || player.hp <= 0) return null;
                const data = UNIT_DATA[player.id];
                if (!data) return null;
                const pct = player.hp / data.maxHp;
                const status = pct >= 1 ? "Unharmed" : pct > 0.75 ? "Scuffed" : pct > 0.5 ? "Injured" : pct > 0.25 ? "Badly wounded" : "Near death";
                const statusColor = pct >= 1 ? "#22c55e" : pct > 0.75 ? "#86efac" : pct > 0.5 ? "#eab308" : pct > 0.25 ? "#f97316" : "#ef4444";
                return (
                    <div className="enemy-tooltip" style={{ left: hoveredPlayer.x + 12, top: hoveredPlayer.y - 10 }}>
                        <div className="enemy-tooltip-name">{data.name}</div>
                        <div className="enemy-tooltip-status" style={{ color: statusColor }}>{status}</div>
                    </div>
                );
            })()}

            {hoveredDoor && (
                <div className="enemy-tooltip" style={{ left: hoveredDoor.x + 12, top: hoveredDoor.y - 10 }}>
                    <div className="enemy-tooltip-name">Door</div>
                    <div className="enemy-tooltip-status" style={{ color: "#4a90d9" }}>To: {AREAS[hoveredDoor.targetArea as AreaId]?.name ?? hoveredDoor.targetArea}</div>
                </div>
            )}

            {hoveredSecretDoor && <div className="enemy-tooltip" style={{ left: hoveredSecretDoor.x + 12, top: hoveredSecretDoor.y - 10 }}><div className="enemy-tooltip-name">Cracked wall</div></div>}

            {hoveredLootBag && (
                <div className="enemy-tooltip" style={{ left: hoveredLootBag.x + 12, top: hoveredLootBag.y - 10 }}>
                    <div className="enemy-tooltip-name">Loot Bag</div>
                    <div className="enemy-tooltip-status" style={{ color: "#f1c40f" }}>{hoveredLootBag.gold} Gold</div>
                </div>
            )}

            {/* FPS */}
            <div style={{ position: "absolute", top: 10, right: 10, color: "#888", fontSize: 11, opacity: 0.6 }}>{fps} fps</div>

            {/* UI Components */}
            <HUD areaName={areaData.name} areaFlavor={areaData.flavor} alivePlayers={alivePlayers} paused={paused} onTogglePause={handleTogglePause} onShowHelp={onShowHelp} onRestart={onRestart} onSaveClick={onSaveClick} onLoadClick={onLoadClick} debug={debug} onToggleDebug={() => setDebug(d => !d)} onWarpToArea={handleWarpToArea} onAddXp={handleAddXp} onStatBoost={handleStatBoost} onToggleDevMode={handleToggleDevMode} devModeEnabled={devMode} onToggleFastMove={() => setFastMove(f => !f)} fastMoveEnabled={fastMove} lightingTuning={lightingTuning} onUpdateLightingTuning={handleUpdateLightingTuning} onResetLightingTuning={handleResetLightingTuning} lightingTuningOutput={lightingTuningOutput} otherModalOpen={helpOpen || saveLoadOpen} hasSelection={selectedIds.length > 0} />
            <CombatLog log={combatLog} />
            <FormationIndicator units={units} formationOrder={formationOrder} />
            <div className="bottom-bar-container">
            <CommandBar
                commandMode={commandMode}
                onStop={handleStop}
                onHold={handleHold}
                onAttackMove={() => setCommandMode("attackMove")}
                onSelectAll={handleSelectAllPlayers}
                onDeselectAll={handleDeselectAllPlayers}
                onToggleAutoBattle={handleTogglePartyAutoBattle}
                hasSelection={selectedIds.length > 0}
                holdActive={units.some(u => selectedIds.includes(u.id) && u.holdPosition)}
                partyAutoBattleActive={partyAutoBattleActive}
            />
            <PartyBar
                units={units} selectedIds={selectedIds} onSelect={setSelectedIds} targetingMode={targetingMode}
                consumableTargetingMode={consumableTargetingMode}
                onTargetUnit={(targetUnitId) => {
                    // Handle consumable targeting (clicking dead ally portrait)
                    if (consumableTargetingMode) {
                        handleConsumableTarget(targetUnitId);
                        return;
                    }
                    if (!targetingMode || !sceneState.scene) return;
                    const skillCtx = getSkillContext();
                    handleTargetingOnUnit(
                        targetUnitId, targetingMode,
                        { actionCooldownRef, actionQueueRef, rangeIndicatorRef: { current: sceneState.rangeIndicator }, aoeIndicatorRef: { current: sceneState.aoeIndicator } },
                        { unitsStateRef: unitsStateRef as React.RefObject<Unit[]>, pausedRef },
                        { setTargetingMode, setQueuedActions },
                        sceneState.unitGroups, skillCtx, addLog
                    );
                }}
                hotbarAssignments={hotbarAssignments}
                onAssignSkill={(unitId, slotIndex, skillName) => {
                    setHotbarAssignments(prev => {
                        const unitSlots = prev[unitId] || [null, null, null, null, null];
                        const newSlots = [...unitSlots];
                        newSlots[slotIndex] = skillName;
                        const newAssignments = { ...prev, [unitId]: newSlots };
                        saveHotbarAssignments(newAssignments);
                        return newAssignments;
                    });
                }}
                onCastSkill={handleCastSkill} skillCooldowns={skillCooldowns} paused={paused}
                formationOrder={formationOrder}
                onReorderFormation={(newOrder) => { setFormationOrder(newOrder); saveFormationOrder(newOrder); }}
            />
            </div>
            {showPanel && selectedIds.length === 1 && (
                <UnitPanel
                    unitId={selectedIds[0]} units={units} onClose={() => setShowPanel(false)}
                    onToggleAI={(id) => updateUnitWith(setUnits, id, u => ({ aiEnabled: !u.aiEnabled }))}
                    onCastSkill={handleCastSkill} skillCooldowns={skillCooldowns} paused={paused}
                    queuedSkills={queuedActions.filter(q => q.unitId === selectedIds[0]).map(q => q.skillName)}
                    onUseConsumable={handleUseConsumable} consumableCooldownEnd={selectedConsumableCooldownEnd}
                    onIncrementStat={(id, stat) => setUnits(prev => prev.map(u => {
                        if (u.id === id && (u.statPoints ?? 0) > 0) {
                            const currentStats = u.stats ?? { strength: 0, dexterity: 0, vitality: 0, intelligence: 0, faith: 0 };
                            const newStats = { ...currentStats, [stat]: currentStats[stat] + 1 };
                            const updated = { ...u, statPoints: (u.statPoints ?? 0) - 1, stats: newStats };
                            if (stat === "vitality") {
                                const maxHp = getEffectiveMaxHp(u.id, updated);
                                updated.hp = Math.min(u.hp + HP_PER_VITALITY, maxHp);
                            }
                            if (stat === "intelligence") {
                                const maxMana = getEffectiveMaxMana(u.id, updated);
                                updated.mana = Math.min((u.mana ?? 0) + MP_PER_INTELLIGENCE, maxMana);
                            }
                            return updated;
                        }
                        return u;
                    }))}
                    onLearnSkill={(id, skillName) => setUnits(prev => prev.map(u => {
                        if (u.id === id && !(u.learnedSkills ?? []).includes(skillName) && (devMode || (u.skillPoints ?? 0) > 0)) {
                            return {
                                ...u,
                                skillPoints: devMode ? (u.skillPoints ?? 0) : (u.skillPoints ?? 0) - 1,
                                learnedSkills: [...(u.learnedSkills ?? []), skillName]
                            };
                        }
                        return u;
                    }))}
                    gold={gold}
                />
            )}
        </div>
    );
}

// =============================================================================
// APP WRAPPER
// =============================================================================

// Transition timing constants
const FADE_DURATION = 300; // ms for fade in/out

export default function App() {
    const [gameKey, setGameKey] = useState(0);
    const [showHelp, setShowHelp] = useState(true);
    const [persistedPlayers, setPersistedPlayers] = useState<PersistedPlayer[] | null>(null);
    const [spawnPoint, setSpawnPoint] = useState<{ x: number; z: number } | null>(null);
    const [spawnDirection, setSpawnDirection] = useState<"north" | "south" | "east" | "west" | undefined>(undefined);
    const [showSaveLoad, setShowSaveLoad] = useState(false);
    const [saveLoadMode, setSaveLoadMode] = useState<"save" | "load">("save");
    const [initialOpenedChests, setInitialOpenedChests] = useState<Set<string> | null>(null);
    const [initialOpenedSecretDoors, setInitialOpenedSecretDoors] = useState<Set<string> | null>(null);
    const [initialGold, setInitialGold] = useState<number | null>(null);
    const [initialKilledEnemies, setInitialKilledEnemies] = useState<Set<string> | null>(null);
    const [savePreviewState, setSavePreviewState] = useState<SaveSlotData | null>(null);
    const gameStateRef = useRef<(() => SaveableGameState) | null>(null);

    // Transition overlay state (starts opaque so initial load fades in from black)
    const [transitionOpacity, setTransitionOpacity] = useState(1);
    const pendingTransition = useRef<{ players: PersistedPlayer[]; targetArea: AreaId; spawn: { x: number; z: number }; direction?: "north" | "south" | "east" | "west" } | null>(null);

    const handleFullRestart = () => {
        setPersistedPlayers(null);
        setSpawnPoint(null);
        setSpawnDirection(undefined);
        setInitialOpenedChests(null);
        setInitialOpenedSecretDoors(null);
        setInitialGold(null);
        setInitialKilledEnemies(null);
        clearFogVisibilityMemory();
        initializeEquipmentState();
        setCurrentArea(DEFAULT_STARTING_AREA);
        setGameKey(k => k + 1);
    };

    const handleAreaTransition = (players: PersistedPlayer[], targetArea: AreaId, spawn: { x: number; z: number }, direction?: "north" | "south" | "east" | "west") => {
        if (!AREAS[targetArea]) {
            if (import.meta.env.DEV) {
                console.warn(`[app] Ignoring transition to unknown area "${targetArea}".`);
            }
            return;
        }
        // Store pending transition and start fade to black
        pendingTransition.current = { players, targetArea, spawn, direction };
        setTransitionOpacity(1);
        soundFns.playFootsteps();

        // After fade completes, execute the actual transition
        setTimeout(() => {
            if (pendingTransition.current) {
                const { players: p, targetArea: area, spawn: s, direction: dir } = pendingTransition.current;
                setPersistedPlayers(p);
                setSpawnPoint(s);
                setSpawnDirection(dir);
                setCurrentArea(area);
                setGameKey(k => k + 1);
            }
        }, FADE_DURATION);
    };

    const handleSceneReady = useCallback(() => {
        // Scene is ready, fade out the overlay
        pendingTransition.current = null;
        setTransitionOpacity(0);
    }, []);

    const buildCurrentSavePreview = useCallback((timestamp: number): SaveSlotData | null => {
        if (!gameStateRef.current) return null;
        const state = gameStateRef.current();
        const areaData = AREAS[state.currentAreaId];
        return {
            version: SAVE_VERSION,
            timestamp,
            slotName: areaData.name,
            players: state.players,
            currentAreaId: state.currentAreaId,
            openedChests: Array.from(state.openedChests),
            openedSecretDoors: Array.from(state.openedSecretDoors),
            killedEnemies: Array.from(state.killedEnemies),
            gold: state.gold,
            equipment: getAllEquipment(),
            inventory: getPartyInventory(),
            hotbarAssignments: loadHotbarAssignments(),
            formationOrder: loadFormationOrder()
        };
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

    const handleSave = (slot: number) => {
        if (!gameStateRef.current) return;
        const state = gameStateRef.current();
        const areaData = AREAS[state.currentAreaId];
        const timestamp = Date.now();
        const saveData: SaveSlotData = {
            version: SAVE_VERSION, timestamp, slotName: areaData.name,
            players: state.players, currentAreaId: state.currentAreaId,
            openedChests: Array.from(state.openedChests), openedSecretDoors: Array.from(state.openedSecretDoors),
            killedEnemies: Array.from(state.killedEnemies), gold: state.gold,
            equipment: getAllEquipment(), inventory: getPartyInventory(),
            hotbarAssignments: loadHotbarAssignments(), formationOrder: loadFormationOrder()
        };
        saveGame(slot, saveData);
    };

    const handleLoad = (slot: number) => {
        const saveData = loadGame(slot);
        if (!saveData) return;
        clearFogVisibilityMemory();
        setAllEquipment(saveData.equipment);
        setPartyInventory(saveData.inventory);
        setCurrentArea(saveData.currentAreaId);
        const area = AREAS[saveData.currentAreaId];
        setInitialOpenedChests(new Set(saveData.openedChests));
        setInitialOpenedSecretDoors(new Set(saveData.openedSecretDoors));
        setInitialKilledEnemies(new Set(saveData.killedEnemies ?? []));
        setInitialGold(saveData.gold);
        setPersistedPlayers(saveData.players);
        setSpawnPoint(area.defaultSpawn);
        // Restore UI state to localStorage so Game reads it on remount
        if (saveData.hotbarAssignments) saveHotbarAssignments(saveData.hotbarAssignments);
        if (saveData.formationOrder) saveFormationOrder(saveData.formationOrder);
        setGameKey(k => k + 1);
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

    return (
        <>
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
                onReady={handleSceneReady}
            />
            {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
            {showSaveLoad && <SaveLoadModal mode={saveLoadMode} onClose={closeSaveLoadModal} onSave={handleSave} onLoad={handleLoad} currentState={savePreviewState} />}
            {/* Transition overlay - fades to black during area transitions */}
            <div
                style={{
                    position: "fixed",
                    inset: 0,
                    backgroundColor: "#000",
                    opacity: transitionOpacity,
                    pointerEvents: transitionOpacity > 0 ? "all" : "none",
                    transition: `opacity ${FADE_DURATION}ms ease-in-out`,
                    zIndex: 9999
                }}
            />
        </>
    );
}
