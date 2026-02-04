/**
 * BG2-STYLE ISOMETRIC TACTICS
 * Main game component - orchestrates Three.js scene and game loop via hooks
 */

import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import * as THREE from "three";

// Constants & Types
import { GRID_SIZE, setDebugSpeedMultiplier } from "./core/constants";
import type { Unit, Skill, CombatLogEntry, SelectionBox, CharacterStats } from "./core/types";

// Game Logic
import { getCurrentArea, getCurrentAreaId, setCurrentArea, AREAS, DEFAULT_STARTING_AREA, DEFAULT_SPAWN_POINT, type AreaId, type AreaTransition } from "./game/areas";
import { UNIT_DATA, ENEMY_STATS } from "./game/units";
import { initializeEquipmentState, getPartyInventory, setPartyInventory, getAllEquipment, setAllEquipment } from "./game/equipmentState";
import { removeFromInventory } from "./game/equipment";
import { getItem } from "./game/items";
import { isConsumable } from "./core/types";
import { getEffectiveMaxHp } from "./game/units";
import { updateChestStates } from "./rendering/scene";
import { soundFns } from "./audio";
import { findSpawnPositions } from "./ai/pathfinding";

// Extracted modules
import { executeSkill, type SkillExecutionContext } from "./combat/skills";
import { setupTargetingMode } from "./input";
import { createLightningPillar } from "./combat/damageEffects";
import { getXpForLevel } from "./game/playerUnits";
import { initializeUnitIdCounter, spawnLootBag } from "./gameLoop";
import {
    togglePause,
    processActionQueue,
    handleTargetingOnUnit,
    type ActionQueue
} from "./input";

// Hooks
import { useThreeScene, useGameLoop, useInputHandlers, type InitializedSceneState, type InputGameRefs } from "./hooks";

// UI Components
import { PartyBar } from "./components/PartyBar";
import { UnitPanel } from "./components/UnitPanel";
import { type HotbarAssignments, loadHotbarAssignments, saveHotbarAssignments } from "./components/SkillHotbar";
import { CombatLog } from "./components/CombatLog";
import { HUD } from "./components/HUD";
import { HelpModal } from "./components/HelpModal";
import { SaveLoadModal } from "./components/SaveLoadModal";
import { type SaveSlotData, SAVE_VERSION, saveGame, loadGame } from "./game/saveLoad";

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
    statusEffects?: Unit["statusEffects"];
}

interface GameProps {
    onRestart: () => void;
    onAreaTransition: (players: PersistedPlayer[], targetArea: AreaId, spawn: { x: number; z: number }) => void;
    onShowHelp: () => void;
    onCloseHelp: () => void;
    helpOpen: boolean;
    saveLoadOpen: boolean;
    persistedPlayers: PersistedPlayer[] | null;
    spawnPoint: { x: number; z: number } | null;
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

// =============================================================================
// GAME COMPONENT
// =============================================================================

function Game({
    onRestart, onAreaTransition, onShowHelp, onCloseHelp, helpOpen, saveLoadOpen,
    persistedPlayers, spawnPoint, onSaveClick, onLoadClick, gameStateRef,
    initialOpenedChests, initialOpenedSecretDoors, initialGold, initialKilledEnemies, onReady
}: GameProps) {
    const containerRef = useRef<HTMLDivElement>(null);

    // Initial camera offset
    const initialCamOffset = useMemo(() => spawnPoint ?? DEFAULT_SPAWN_POINT, [spawnPoint]);

    // Create initial units
    const createUnitsForArea = useCallback((): Unit[] => {
        const area = getCurrentArea();
        const playerIds = Object.keys(UNIT_DATA).map(Number);
        const spawn = spawnPoint ?? DEFAULT_SPAWN_POINT;
        const spawnPositions = findSpawnPositions(spawn.x, spawn.z, playerIds.length);
        const INITIAL_XP_VALUES = [0, 10, 15, 20, 25, 30];

        const players: Unit[] = playerIds.map((id, i) => {
            const data = UNIT_DATA[id];
            const persisted = persistedPlayers?.find(p => p.id === id);
            const pos = spawnPositions[i] ?? { x: spawn.x, z: spawn.z };
            const initialExp = persisted?.exp ?? (INITIAL_XP_VALUES[i] ?? 0);
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
                team: "player" as const,
                target: null,
                aiEnabled: true,
                statusEffects: persisted?.statusEffects
            };
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

        const allUnits = [...players, ...enemies];
        initializeUnitIdCounter(allUnits);
        return allUnits;
    }, [persistedPlayers, spawnPoint, initialKilledEnemies]);

    // =============================================================================
    // REACT STATE
    // =============================================================================

    const [units, setUnits] = useState<Unit[]>(createUnitsForArea);
    const [selectedIds, setSelectedIds] = useState<number[]>(() => Object.keys(UNIT_DATA).map(Number));
    const [selBox, setSelBox] = useState<SelectionBox | null>(null);
    const [showPanel, setShowPanel] = useState(false);
    const [combatLog, setCombatLog] = useState<CombatLogEntry[]>(() => [{ text: `The party enters ${getCurrentArea().name}.`, color: "#f59e0b" }]);
    const [paused, setPaused] = useState(true);
    const [hpBarPositions, setHpBarPositions] = useState<{ positions: Record<number, { x: number; y: number; visible: boolean }>; scale: number }>({ positions: {}, scale: 1 });
    const [skillCooldowns, setSkillCooldowns] = useState<Record<string, { end: number; duration: number }>>({});
    const [targetingMode, setTargetingMode] = useState<{ casterId: number; skill: Skill } | null>(null);
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
    const [hotbarAssignments, setHotbarAssignments] = useState<HotbarAssignments>(loadHotbarAssignments);

    // =============================================================================
    // STATE SYNC REFS
    // =============================================================================

    const selectedRef = useRef(selectedIds);
    const unitsStateRef = useRef(units);
    const pausedRef = useRef(paused);
    const targetingModeRef = useRef(targetingMode);
    const pauseStartTimeRef = useRef<number | null>(Date.now());
    const showPanelRef = useRef(showPanel);
    const helpOpenRef = useRef(helpOpen);
    const skillCooldownsRef = useRef(skillCooldowns);
    const openedChestsRef = useRef(openedChests);
    const hotbarAssignmentsRef = useRef(hotbarAssignments);
    const handleCastSkillRef = useRef<((unitId: number, skill: Skill) => void) | null>(null);

    // Sync refs with state
    useEffect(() => { selectedRef.current = selectedIds; }, [selectedIds]);
    useEffect(() => { unitsStateRef.current = units; }, [units]);
    useEffect(() => { pausedRef.current = paused; }, [paused]);
    useEffect(() => { targetingModeRef.current = targetingMode; }, [targetingMode]);
    useEffect(() => { showPanelRef.current = showPanel; }, [showPanel]);
    useEffect(() => { helpOpenRef.current = helpOpen; }, [helpOpen]);
    useEffect(() => { skillCooldownsRef.current = skillCooldowns; }, [skillCooldowns]);
    useEffect(() => { openedChestsRef.current = openedChests; }, [openedChests]);
    useEffect(() => { hotbarAssignmentsRef.current = hotbarAssignments; }, [hotbarAssignments]);

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

    // =============================================================================
    // USE THREE SCENE HOOK
    // =============================================================================

    const { sceneState, gameRefs, isInitialized } = useThreeScene({
        containerRef,
        units,
        openedChests,
        initialCameraOffset: initialCamOffset
    });

    // Notify parent when scene is ready
    useEffect(() => {
        if (isInitialized && onReady) {
            onReady();
        }
    }, [isInitialized, onReady]);

    // Sync hoveredDoor to gameRefs
    useEffect(() => {
        if (gameRefs.current) {
            gameRefs.current.hoveredDoor = hoveredDoor?.targetArea ?? null;
        }
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

    // =============================================================================
    // CALLBACKS
    // =============================================================================

    const addLog = useCallback((text: string, color?: string) => {
        setCombatLog(prev => [...prev.slice(-50), { text, color }]);
    }, []);

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
        acidTilesRef: { current: gameRefs.current.acidTiles }
    }), [sceneState, gameRefs, addLog]);

    // Execute consumable
    const executeConsumable = useCallback((unitId: number, itemId: string): boolean => {
        const item = getItem(itemId);
        if (!item || !isConsumable(item)) return false;

        const targetUnit = unitsStateRef.current.find(u => u.id === unitId);
        if (!targetUnit || targetUnit.hp <= 0) return false;

        if (item.effect === "heal") {
            const maxHp = getEffectiveMaxHp(unitId);
            if (targetUnit.hp >= maxHp) return false;
            const newHp = Math.min(maxHp, targetUnit.hp + item.value);
            const healed = newHp - targetUnit.hp;
            setUnits(prev => prev.map(u => u.id === unitId ? { ...u, hp: newHp } : u));
            addLog(`${UNIT_DATA[unitId].name} uses ${item.name}, restoring ${healed} HP.`, "#22c55e");
        } else if (item.effect === "mana") {
            const maxMana = UNIT_DATA[unitId].maxMana ?? 0;
            const currentMana = targetUnit.mana ?? 0;
            if (currentMana >= maxMana) return false;
            const newMana = Math.min(maxMana, currentMana + item.value);
            const restored = newMana - currentMana;
            setUnits(prev => prev.map(u => u.id === unitId ? { ...u, mana: newMana } : u));
            addLog(`${UNIT_DATA[unitId].name} uses ${item.name}, restoring ${restored} Mana.`, "#3b82f6");
        } else if (item.effect === "exp") {
            const newExp = (targetUnit.exp ?? 0) + item.value;
            const currentLevel = targetUnit.level ?? 1;
            const xpForNext = getXpForLevel(currentLevel + 1);

            if (newExp >= xpForNext) {
                setUnits(prev => prev.map(u => {
                    if (u.id !== unitId) return u;
                    return {
                        ...u, exp: newExp, level: currentLevel + 1, statPoints: (u.statPoints ?? 0) + 3,
                        hp: u.hp + 2, mana: (u.mana ?? 0) + 1,
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
                setUnits(prev => prev.map(u => u.id === unitId ? { ...u, exp: newExp } : u));
                addLog(`${UNIT_DATA[unitId].name} reads ${item.name}, gaining ${item.value} XP.`, "#9b59b6");
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

    // Area transition handler
    const handleAreaTransition = useCallback((transition: AreaTransition) => {
        const playerUnits = unitsStateRef.current.filter(u => u.team === "player");
        const persistedState: PersistedPlayer[] = playerUnits.map(u => ({
            id: u.id, hp: u.hp, mana: u.mana, level: u.level, exp: u.exp,
            stats: u.stats, statPoints: u.statPoints, statusEffects: u.statusEffects
        }));
        onAreaTransition(persistedState, transition.targetArea, transition.targetSpawn);
    }, [onAreaTransition]);

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

    useInputHandlers({
        containerRef,
        sceneRefs: inputSceneRefs,
        gameRefs: gameRefs as React.MutableRefObject<InputGameRefs>,
        stateRefs: {
            unitsStateRef, selectedRef, pausedRef, targetingModeRef,
            showPanelRef, helpOpenRef, openedChestsRef, hotbarAssignmentsRef, pauseStartTimeRef
        },
        mutableRefs: {
            actionQueueRef, actionCooldownRef, keysPressed,
            isDragging, didPan, isBoxSel, boxStart, boxEnd, lastMouse
        },
        setters: {
            setSelectedIds, setSelBox, setUnits, setPaused, setTargetingMode,
            setSkillCooldowns, setQueuedActions, setShowPanel, setHoveredEnemy,
            setHoveredChest, setHoveredPlayer, setHoveredDoor, setHoveredSecretDoor,
            setHoveredLootBag, setOpenedChests, setOpenedSecretDoors, setGold
        },
        callbacks: {
            addLog, getSkillContext, handleAreaTransition, onCloseHelp,
            processActionQueue: doProcessQueue, handleCastSkillRef
        }
    });

    // =============================================================================
    // GAME LOOP HOOK
    // =============================================================================

    const gameLoopSceneState = useMemo((): InitializedSceneState | null => {
        if (!isInitialized || !sceneState.scene || !sceneState.camera || !sceneState.renderer) return null;
        return sceneState as InitializedSceneState;
    }, [isInitialized, sceneState]);

    useGameLoop({
        sceneState: gameLoopSceneState,
        gameRefs,
        stateRefs: {
            unitsStateRef, pausedRef, targetingModeRef, skillCooldownsRef, actionQueueRef
        },
        callbacks: {
            setUnits, setFps, setHpBarPositions, setSkillCooldowns, setQueuedActions,
            addLog, processActionQueue: doProcessQueue
        },
        keysPressed,
        containerRef
    });

    // =============================================================================
    // EFFECTS
    // =============================================================================

    // Track enemy deaths for loot bags
    const prevAliveEnemiesRef = useRef<Set<number>>(new Set());
    useEffect(() => {
        const areaId = getCurrentAreaId();
        const currentAlive = new Set<number>();
        const newlyDead: string[] = [];
        const newlyDeadUnits: Unit[] = [];

        for (const u of units) {
            if (u.team === "enemy" && u.id >= 100) {
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
            setKilledEnemies(prev => {
                const next = new Set(prev);
                for (const key of newlyDead) next.add(key);
                return next;
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
                    addLog("The Kraken Nymph drops a bag of treasure!", "#ffd700");
                }
            }
        }

        prevAliveEnemiesRef.current = currentAlive;
    }, [units, sceneState.scene, sceneState.unitGroups, gameRefs, addLog]);

    // Expose game state for save
    useEffect(() => {
        gameStateRef.current = () => {
            const playerUnits = unitsStateRef.current.filter(u => u.team === "player");
            return {
                players: playerUnits.map(u => ({
                    id: u.id, hp: u.hp, mana: u.mana, level: u.level, exp: u.exp,
                    stats: u.stats, statPoints: u.statPoints, statusEffects: u.statusEffects
                })),
                currentAreaId: getCurrentAreaId(),
                openedChests: openedChestsRef.current,
                openedSecretDoors, gold, killedEnemies
            };
        };
        return () => { gameStateRef.current = null; };
    }, [gameStateRef, openedSecretDoors, gold, killedEnemies]);

    // Update selection rings
    useEffect(() => {
        Object.entries(sceneState.selectRings).forEach(([id, ring]) => {
            const unit = units.find(u => u.id === Number(id));
            ring.visible = selectedIds.includes(Number(id)) && (unit?.hp ?? 0) > 0;
        });
        const selectedUnit = units.find(u => u.id === selectedIds[0]);
        setShowPanel(selectedIds.length === 1 && selectedUnit?.team === "player" && (selectedUnit?.hp ?? 0) > 0);
    }, [selectedIds, units, sceneState.selectRings]);

    // Debug grid
    useEffect(() => {
        const scene = sceneState.scene;
        if (!scene) return;
        if (gameRefs.current.debugGrid) {
            scene.remove(gameRefs.current.debugGrid);
            gameRefs.current.debugGrid = null;
        }
        if (debug) {
            const group = new THREE.Group();
            group.name = "debugGrid";
            for (let x = 0; x <= GRID_SIZE; x += 5) {
                for (let z = 0; z <= GRID_SIZE; z += 5) {
                    const marker = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 8), new THREE.MeshBasicMaterial({ color: 0xff0000 }));
                    marker.position.set(x, 0.2, z);
                    group.add(marker);
                    const canvas = document.createElement("canvas");
                    canvas.width = 48; canvas.height = 24;
                    const ctx = canvas.getContext("2d")!;
                    ctx.fillStyle = "#ffffff"; ctx.font = "bold 14px monospace"; ctx.textAlign = "center";
                    ctx.fillText(`${x},${z}`, 24, 17);
                    const texture = new THREE.CanvasTexture(canvas);
                    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true }));
                    sprite.position.set(x, 0.5, z);
                    sprite.scale.set(1, 0.5, 1);
                    group.add(sprite);
                }
            }
            scene.add(group);
            gameRefs.current.debugGrid = group;
        }
    }, [debug, sceneState.scene, gameRefs]);

    // =============================================================================
    // SKILL HANDLERS
    // =============================================================================

    const handleCastSkill = useCallback((casterId: number, skill: Skill) => {
        const caster = units.find(u => u.id === casterId);
        if (!caster || caster.hp <= 0 || (caster.mana ?? 0) < skill.manaCost) return;
        const casterG = sceneState.unitGroups[casterId];
        if (!casterG || !sceneState.scene) return;

        if (skill.targetType === "self") {
            const skillCtx = getSkillContext();
            const cooldownEnd = actionCooldownRef.current[casterId] || 0;
            if (paused || Date.now() < cooldownEnd) {
                actionQueueRef.current[casterId] = { type: "skill", skill, targetX: casterG.position.x, targetZ: casterG.position.z };
                setQueuedActions(prev => [...prev.filter(q => q.unitId !== casterId), { unitId: casterId, skillName: skill.name }]);
                addLog(`${UNIT_DATA[casterId].name} queues ${skill.name} (${paused ? "queued" : "on cooldown"})`, "#888");
            } else {
                executeSkill(skillCtx, casterId, skill, casterG.position.x, casterG.position.z);
            }
            return;
        }

        setupTargetingMode(casterId, skill, casterG, { current: sceneState.rangeIndicator }, { current: sceneState.aoeIndicator }, setTargetingMode);
    }, [units, sceneState, paused, getSkillContext, addLog]);

    handleCastSkillRef.current = handleCastSkill;

    const handleTogglePause = useCallback(() => {
        togglePause(
            { pauseStartTimeRef, actionCooldownRef },
            { pausedRef },
            { setPaused, setSkillCooldowns },
            doProcessQueue
        );
    }, [doProcessQueue]);

    const handleUseConsumable = useCallback((itemId: string, targetUnitId: number) => {
        const item = getItem(itemId);
        if (!item || !isConsumable(item)) return;
        const targetUnit = units.find(u => u.id === targetUnitId);
        if (!targetUnit || targetUnit.hp <= 0) return;

        const now = Date.now();
        const cooldownEnd = actionCooldownRef.current[targetUnitId] || 0;
        if (paused || now < cooldownEnd) {
            actionQueueRef.current[targetUnitId] = { type: "consumable", itemId };
            setQueuedActions(prev => [...prev.filter(q => q.unitId !== targetUnitId), { unitId: targetUnitId, skillName: item.name }]);
            addLog(`${UNIT_DATA[targetUnitId].name} prepares ${item.name}... (${paused ? "queued" : "on cooldown"})`, "#888");
            return;
        }
        executeConsumable(targetUnitId, itemId);
    }, [units, paused, addLog, executeConsumable]);

    const handleWarpToArea = useCallback((areaId: AreaId) => {
        const playerUnits = unitsStateRef.current.filter(u => u.team === "player");
        const persistedState: PersistedPlayer[] = playerUnits.map(u => ({
            id: u.id, hp: u.hp, mana: u.mana, level: u.level, exp: u.exp,
            stats: u.stats, statPoints: u.statPoints, statusEffects: u.statusEffects
        }));
        onAreaTransition(persistedState, areaId, AREAS[areaId].defaultSpawn);
    }, [onAreaTransition]);

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
                    return {
                        ...u, exp: newExp, level: currentLevel + 1, statPoints: (u.statPoints ?? 0) + 3,
                        hp: u.hp + 2, mana: (u.mana ?? 0) + 1,
                        stats: u.stats ?? { strength: 0, dexterity: 0, vitality: 0, intelligence: 0, faith: 0 }
                    };
                }
                return { ...u, exp: newExp };
            }
            return u;
        }));

        addLog(`Debug: Party gained ${amount} XP!`, "#9b59b6");
        if (leveledUpIds.length > 0) {
            addLog("Level up! +3 stat points available.", "#ffd700");
            soundFns.playLevelUp();
            for (const unitId of leveledUpIds) {
                const unitGroup = sceneState.unitGroups[unitId];
                if (unitGroup) createLightningPillar(scene, unitGroup.position.x, unitGroup.position.z, { color: "#ffd700", duration: 600, radius: 0.3, height: 10 });
            }
        }
    }, [sceneState, addLog]);

    // =============================================================================
    // RENDER
    // =============================================================================

    const alivePlayers = units.filter(u => u.team === "player" && u.hp > 0).length;
    const areaData = getCurrentArea();

    return (
        <div style={{ width: "100%", height: "100vh", position: "relative", cursor: targetingMode ? "crosshair" : "default" }}>
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

            {hoveredChest && <div className="enemy-tooltip" style={{ left: hoveredChest.x + 12, top: hoveredChest.y - 10 }}><div className="enemy-tooltip-name">Chest</div></div>}

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
            <div style={{ position: "absolute", top: 10, right: 10, color: "#888", fontSize: 11, fontFamily: "monospace", opacity: 0.6 }}>{fps} fps</div>

            {/* UI Components */}
            <HUD areaName={areaData.name} areaFlavor={areaData.flavor} alivePlayers={alivePlayers} paused={paused} onTogglePause={handleTogglePause} onPause={() => setPaused(true)} onShowHelp={onShowHelp} onRestart={onRestart} onSaveClick={onSaveClick} onLoadClick={onLoadClick} debug={debug} onToggleDebug={() => setDebug(d => !d)} onWarpToArea={handleWarpToArea} onAddXp={handleAddXp} onToggleFastMove={() => setFastMove(f => !f)} fastMoveEnabled={fastMove} otherModalOpen={helpOpen || saveLoadOpen} hasSelection={selectedIds.length > 0} />
            <CombatLog log={combatLog} />
            <PartyBar
                units={units} selectedIds={selectedIds} onSelect={setSelectedIds} targetingMode={targetingMode}
                onTargetUnit={(targetUnitId) => {
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
            />
            {showPanel && selectedIds.length === 1 && (
                <UnitPanel
                    unitId={selectedIds[0]} units={units} onClose={() => setShowPanel(false)}
                    onToggleAI={(id) => setUnits(prev => prev.map(u => u.id === id ? { ...u, aiEnabled: !u.aiEnabled } : u))}
                    onCastSkill={handleCastSkill} skillCooldowns={skillCooldowns} paused={paused}
                    queuedSkills={queuedActions.filter(q => q.unitId === selectedIds[0]).map(q => q.skillName)}
                    onUseConsumable={handleUseConsumable} consumableCooldownEnd={actionCooldownRef.current[selectedIds[0]] || 0}
                    onIncrementStat={(id, stat) => setUnits(prev => prev.map(u => {
                        if (u.id === id && (u.statPoints ?? 0) > 0) {
                            const currentStats = u.stats ?? { strength: 0, dexterity: 0, vitality: 0, intelligence: 0, faith: 0 };
                            const hpBonus = stat === "vitality" ? 2 : 0;
                            return { ...u, hp: u.hp + hpBonus, statPoints: (u.statPoints ?? 0) - 1, stats: { ...currentStats, [stat]: currentStats[stat] + 1 } };
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
    const [showSaveLoad, setShowSaveLoad] = useState(false);
    const [saveLoadMode, setSaveLoadMode] = useState<"save" | "load">("save");
    const [initialOpenedChests, setInitialOpenedChests] = useState<Set<string> | null>(null);
    const [initialOpenedSecretDoors, setInitialOpenedSecretDoors] = useState<Set<string> | null>(null);
    const [initialGold, setInitialGold] = useState<number | null>(null);
    const [initialKilledEnemies, setInitialKilledEnemies] = useState<Set<string> | null>(null);
    const gameStateRef = useRef<(() => SaveableGameState) | null>(null);

    // Transition overlay state
    const [transitionOpacity, setTransitionOpacity] = useState(0);
    const pendingTransition = useRef<{ players: PersistedPlayer[]; targetArea: AreaId; spawn: { x: number; z: number } } | null>(null);

    const handleFullRestart = () => {
        setPersistedPlayers(null);
        setSpawnPoint(null);
        setInitialOpenedChests(null);
        setInitialOpenedSecretDoors(null);
        setInitialGold(null);
        setInitialKilledEnemies(null);
        initializeEquipmentState();
        setCurrentArea(DEFAULT_STARTING_AREA);
        setGameKey(k => k + 1);
    };

    const handleAreaTransition = (players: PersistedPlayer[], targetArea: AreaId, spawn: { x: number; z: number }) => {
        // Store pending transition and start fade to black
        pendingTransition.current = { players, targetArea, spawn };
        setTransitionOpacity(1);
        soundFns.playFootsteps();

        // After fade completes, execute the actual transition
        setTimeout(() => {
            if (pendingTransition.current) {
                const { players: p, targetArea: area, spawn: s } = pendingTransition.current;
                setPersistedPlayers(p);
                setSpawnPoint(s);
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

    const handleSave = (slot: number) => {
        if (!gameStateRef.current) return;
        const state = gameStateRef.current();
        const areaData = AREAS[state.currentAreaId];
        const saveData: SaveSlotData = {
            version: SAVE_VERSION, timestamp: Date.now(), slotName: areaData.name,
            players: state.players, currentAreaId: state.currentAreaId,
            openedChests: Array.from(state.openedChests), openedSecretDoors: Array.from(state.openedSecretDoors),
            killedEnemies: Array.from(state.killedEnemies), gold: state.gold,
            equipment: getAllEquipment(), inventory: getPartyInventory()
        };
        saveGame(slot, saveData);
    };

    const handleLoad = (slot: number) => {
        const saveData = loadGame(slot);
        if (!saveData) return;
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
        setGameKey(k => k + 1);
    };

    const getCurrentSaveState = (): SaveSlotData | null => {
        if (!gameStateRef.current) return null;
        const state = gameStateRef.current();
        const areaData = AREAS[state.currentAreaId];
        return {
            version: SAVE_VERSION, timestamp: Date.now(), slotName: areaData.name,
            players: state.players, currentAreaId: state.currentAreaId,
            openedChests: Array.from(state.openedChests), openedSecretDoors: Array.from(state.openedSecretDoors),
            killedEnemies: Array.from(state.killedEnemies), gold: state.gold,
            equipment: getAllEquipment(), inventory: getPartyInventory()
        };
    };

    return (
        <>
            <Game
                key={gameKey} onRestart={handleFullRestart} onAreaTransition={handleAreaTransition}
                onShowHelp={() => setShowHelp(true)} onCloseHelp={() => setShowHelp(false)}
                helpOpen={showHelp} saveLoadOpen={showSaveLoad}
                persistedPlayers={persistedPlayers} spawnPoint={spawnPoint}
                onSaveClick={() => { setSaveLoadMode("save"); setShowSaveLoad(true); }}
                onLoadClick={() => { setSaveLoadMode("load"); setShowSaveLoad(true); }}
                gameStateRef={gameStateRef}
                initialOpenedChests={initialOpenedChests} initialOpenedSecretDoors={initialOpenedSecretDoors}
                initialGold={initialGold} initialKilledEnemies={initialKilledEnemies}
                onReady={handleSceneReady}
            />
            {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
            {showSaveLoad && <SaveLoadModal mode={saveLoadMode} onClose={() => setShowSaveLoad(false)} onSave={handleSave} onLoad={handleLoad} currentState={getCurrentSaveState()} />}
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
