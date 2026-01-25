/**
 * BG2-STYLE ISOMETRIC TACTICS
 * Main game component - orchestrates Three.js scene and game loop
 */

import { useState, useRef, useEffect } from "react";
import * as THREE from "three";

// Constants & Types
import { GRID_SIZE, PAN_SPEED } from "./core/constants";
import type { Unit, Skill, CombatLogEntry, SelectionBox, DamageText, UnitGroup, FogTexture, Projectile, SwingAnimation, SanctuaryTile } from "./core/types";

// Game Logic
import { blocked } from "./game/dungeon";
import { getCurrentArea, setCurrentArea, AREAS, DEFAULT_STARTING_AREA, DEFAULT_SPAWN_POINT, type AreaId, type AreaTransition } from "./game/areas";
import { UNIT_DATA, ENEMY_STATS, getBasicAttackSkill } from "./game/units";
import { createScene, updateCamera, updateWallTransparency, updateTreeFogVisibility, updateLightLOD, addUnitToScene, updateWater, type DoorMesh } from "./rendering/scene";
import { soundFns } from "./audio/sound";
import { updateDynamicObstacles } from "./ai/pathfinding";
import { updateUnitCache } from "./ai/unitAI";
import { resetAllBroodMotherScreeches } from "./game/enemyState";

// Extracted modules
import { clearTargetingMode, executeSkill, type SkillExecutionContext } from "./combat/skills";
import { resetBarks } from "./combat/barks";
import { initializeUnitIdCounter } from "./gameLoop";
import {
    togglePause,
    getUnitsInBox,
    processActionQueue,
    buildMoveTargets,
    handleTargetingClick,
    handleTargetingOnUnit,
    setupTargetingMode,
    queueOrExecuteSkill,
    type ActionQueue
} from "./input";
import {
    updateDamageTexts,
    updateHitFlash,
    updateProjectiles,
    updateFogOfWar,
    resetFogCache,
    updateUnitAI,
    updateHpBarPositions,
    updateSwingAnimations,
    processStatusEffects,
    updatePoisonVisuals,
    updateShieldFacing,
    processAcidTiles,
    processSanctuaryTiles,
    clearSanctuaryTiles
} from "./gameLoop";
import type { AcidTile } from "./core/types";

// UI Components
import { PartyBar } from "./components/PartyBar";
import { UnitPanel } from "./components/UnitPanel";
import { CombatLog } from "./components/CombatLog";
import { HUD } from "./components/HUD";
import { HelpModal } from "./components/HelpModal";

// =============================================================================
// MAIN COMPONENT
// =============================================================================

// Persisted player state type (duplicated here for Game props)
interface PersistedPlayer {
    id: number;
    hp: number;
    mana?: number;
    statusEffects?: Unit["statusEffects"];
}

interface GameProps {
    onRestart: () => void;
    onAreaTransition: (players: PersistedPlayer[], targetArea: AreaId, spawn: { x: number; z: number }) => void;
    onShowHelp: () => void;
    onCloseHelp: () => void;
    helpOpen: boolean;
    persistedPlayers: PersistedPlayer[] | null;
    spawnPoint: { x: number; z: number } | null;
}

function Game({ onRestart, onAreaTransition, onShowHelp, onCloseHelp, helpOpen, persistedPlayers, spawnPoint }: GameProps) {
    // Three.js refs
    const containerRef = useRef<HTMLDivElement>(null);
    const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
    const cameraRef = useRef<THREE.OrthographicCamera | null>(null);
    const sceneRef = useRef<THREE.Scene | null>(null);
    const unitsRef = useRef<Record<number, UnitGroup>>({});
    const selectRingsRef = useRef<Record<number, THREE.Mesh>>({});
    const targetRingsRef = useRef<Record<number, THREE.Mesh>>({});
    const shieldIndicatorsRef = useRef<Record<number, THREE.Mesh>>({});
    const targetRingTimers = useRef<Record<number, number>>({});  // Track when target was set for fade
    const maxHpRef = useRef<Record<number, number>>({});
    const moveMarkerRef = useRef<THREE.Mesh | null>(null);
    const moveMarkerStartRef = useRef<number>(0);  // Track when marker was shown for fade animation
    const pathsRef = useRef<Record<number, { x: number; z: number }[]>>({});
    const fogTextureRef = useRef<FogTexture | null>(null);
    const fogMeshRef = useRef<THREE.Mesh | null>(null);
    const visibilityRef = useRef<number[][]>(Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(0)));

    // Camera & input refs
    // Initialize camera centered on spawn point (or default start)
    // Clone to avoid mutating DEFAULT_SPAWN_POINT when panning
    const initialCamOffset = spawnPoint ?? DEFAULT_SPAWN_POINT;
    const cameraOffset = useRef({ ...initialCamOffset });
    const zoomLevel = useRef(12);
    const isDragging = useRef(false);
    const didPan = useRef(false);
    const keysPressed = useRef<Set<string>>(new Set());
    const isBoxSel = useRef(false);
    const boxStart = useRef({ x: 0, y: 0 });
    const boxEnd = useRef({ x: 0, y: 0 });
    const lastMouse = useRef({ x: 0, y: 0 });
    const actionCooldownRef = useRef<Record<number, number>>({});
    const damageTexts = useRef<DamageText[]>([]);
    const hitFlashRef = useRef<Record<number, number>>({});
    const unitMeshRef = useRef<Record<number, THREE.Mesh>>({});
    const unitOriginalColorRef = useRef<Record<number, THREE.Color>>({});
    const moveStartRef = useRef<Record<number, { time: number; x: number; z: number }>>({});
    const projectilesRef = useRef<Projectile[]>([]);
    const swingAnimationsRef = useRef<SwingAnimation[]>([]);
    const rangeIndicatorRef = useRef<THREE.Mesh | null>(null);
    const aoeIndicatorRef = useRef<THREE.Mesh | null>(null);
    const wallMeshesRef = useRef<THREE.Mesh[]>([]);
    const treeMeshesRef = useRef<THREE.Mesh[]>([]);
    const doorMeshesRef = useRef<DoorMesh[]>([]);
    const waterMeshRef = useRef<THREE.Mesh | null>(null);
    const debugGridRef = useRef<THREE.Group | null>(null);
    const acidTilesRef = useRef<Map<string, AcidTile>>(new Map());
    const sanctuaryTilesRef = useRef<Map<string, SanctuaryTile>>(new Map());

    // Action queue (per-unit: last action wins)
    const actionQueueRef = useRef<ActionQueue>({});
    const processActionQueueRef = useRef<(defeatedThisFrame: Set<number>) => void>(() => {});

    // Create initial units based on area and persisted state
    const createUnitsForArea = (): Unit[] => {
        const area = getCurrentArea();

        // Create player units - either from persisted state or fresh
        const playerIds = Object.keys(UNIT_DATA).map(Number);
        const spawn = spawnPoint ?? DEFAULT_SPAWN_POINT;

        const players: Unit[] = playerIds.map((id, i) => {
            const data = UNIT_DATA[id];
            const persisted = persistedPlayers?.find(p => p.id === id);
            return {
                id,
                x: spawn.x + (i % 3) * 1.5 - 1.5,
                z: spawn.z + Math.floor(i / 3) * 1.5,
                hp: persisted?.hp ?? data.hp,
                mana: persisted?.mana ?? data.mana,
                team: "player" as const,
                target: null,
                aiEnabled: true,
                statusEffects: persisted?.statusEffects
            };
        });

        // Create enemies from area spawn data (only in dungeon for now)
        const enemies: Unit[] = area.enemySpawns.map((spawn, i) => {
            const stats = ENEMY_STATS[spawn.type];
            return {
                id: 100 + i,
                x: spawn.x,
                z: spawn.z,
                hp: stats.maxHp,
                team: "enemy" as const,
                enemyType: spawn.type,
                target: null,
                aiEnabled: true
            };
        });

        const allUnits = [...players, ...enemies];
        // Initialize unit ID counter to prevent ID collisions when spawning
        initializeUnitIdCounter(allUnits);
        return allUnits;
    };

    // React state
    const [units, setUnits] = useState<Unit[]>(createUnitsForArea);
    const [selectedIds, setSelectedIds] = useState<number[]>([]);
    const [selBox, setSelBox] = useState<SelectionBox | null>(null);
    const [showPanel, setShowPanel] = useState(false);
    const [combatLog, setCombatLog] = useState<CombatLogEntry[]>(() => [{ text: `The party enters ${getCurrentArea().name}.`, color: "#f59e0b" }]);
    const [paused, setPaused] = useState(true);
    const [hpBarPositions, setHpBarPositions] = useState<{ positions: Record<number, { x: number; y: number; visible: boolean }>; scale: number }>({ positions: {}, scale: 1 });
    const [skillCooldowns, setSkillCooldowns] = useState<Record<string, { end: number; duration: number }>>({});
    const [targetingMode, setTargetingMode] = useState<{ casterId: number; skill: Skill } | null>(null);
    const [queuedActions, setQueuedActions] = useState<{ unitId: number; skillName: string }[]>([]);
    const [hoveredEnemy, setHoveredEnemy] = useState<{ id: number; x: number; y: number } | null>(null);
    const [hoveredChest, setHoveredChest] = useState<{ x: number; y: number } | null>(null);
    const [hoveredPlayer, setHoveredPlayer] = useState<{ id: number; x: number; y: number } | null>(null);
    const [hoveredDoor, setHoveredDoor] = useState<{ targetArea: string; x: number; y: number } | null>(null);
    const [fps, setFps] = useState(0);
    const [debug, setDebug] = useState(false);
    // FPS tracking refs
    const fpsFrameCount = useRef(0);
    const fpsLastTime = useRef(Date.now());

    // Refs for accessing state in callbacks
    const selectedRef = useRef(selectedIds);
    const unitsStateRef = useRef(units);
    const pausedRef = useRef(paused);
    const targetingModeRef = useRef(targetingMode);
    const pauseStartTimeRef = useRef<number | null>(Date.now());
    const showPanelRef = useRef(showPanel);
    const helpOpenRef = useRef(helpOpen);
    const skillCooldownsRef = useRef(skillCooldowns);

    useEffect(() => { selectedRef.current = selectedIds; }, [selectedIds]);
    useEffect(() => { unitsStateRef.current = units; }, [units]);
    useEffect(() => { pausedRef.current = paused; }, [paused]);
    useEffect(() => { targetingModeRef.current = targetingMode; }, [targetingMode]);
    useEffect(() => { showPanelRef.current = showPanel; }, [showPanel]);
    useEffect(() => { helpOpenRef.current = helpOpen; }, [helpOpen]);
    useEffect(() => { skillCooldownsRef.current = skillCooldowns; }, [skillCooldowns]);

    // Debug grid effect
    useEffect(() => {
        const scene = sceneRef.current;
        if (!scene) return;

        // Remove existing debug grid
        if (debugGridRef.current) {
            scene.remove(debugGridRef.current);
            debugGridRef.current = null;
        }

        if (debug) {
            const group = new THREE.Group();
            group.name = "debugGrid";

            // Create coordinate markers every 5 units
            for (let x = 0; x <= GRID_SIZE; x += 5) {
                for (let z = 0; z <= GRID_SIZE; z += 5) {
                    // Create a small sphere at each grid point
                    const marker = new THREE.Mesh(
                        new THREE.SphereGeometry(0.08, 8, 8),
                        new THREE.MeshBasicMaterial({ color: 0xff0000 })
                    );
                    marker.position.set(x, 0.2, z);
                    group.add(marker);

                    // Create text sprite for coordinates
                    const canvas = document.createElement("canvas");
                    canvas.width = 48;
                    canvas.height = 24;
                    const ctx = canvas.getContext("2d")!;
                    ctx.fillStyle = "#ffffff";
                    ctx.font = "bold 14px monospace";
                    ctx.textAlign = "center";
                    ctx.fillText(`${x},${z}`, 24, 17);

                    const texture = new THREE.CanvasTexture(canvas);
                    const spriteMat = new THREE.SpriteMaterial({ map: texture, transparent: true });
                    const sprite = new THREE.Sprite(spriteMat);
                    sprite.position.set(x, 0.5, z);
                    sprite.scale.set(1, 0.5, 1);
                    group.add(sprite);
                }
            }

            scene.add(group);
            debugGridRef.current = group;
        }
    }, [debug]);

    const addLog = (text: string, color?: string) => setCombatLog(prev => [...prev.slice(-50), { text, color }]);

    // Skill execution context (passed to skill functions)
    // defeatedThisFrame is optional - if not provided, creates a new Set (for UI-triggered skills outside the game loop)
    const getSkillContext = (scene: THREE.Scene, defeatedThisFrame?: Set<number>): SkillExecutionContext => ({
        scene,
        unitsStateRef: unitsStateRef as React.RefObject<Unit[]>,
        unitsRef: unitsRef as React.RefObject<Record<number, UnitGroup>>,
        actionCooldownRef,
        projectilesRef,
        hitFlashRef,
        damageTexts,
        unitMeshRef: unitMeshRef as React.RefObject<Record<number, THREE.Mesh>>,
        unitOriginalColorRef: unitOriginalColorRef as React.RefObject<Record<number, THREE.Color>>,
        setUnits,
        setSkillCooldowns,
        addLog,
        defeatedThisFrame: defeatedThisFrame ?? new Set<number>(),
        sanctuaryTilesRef,
        acidTilesRef
    });

    // =============================================================================
    // THREE.JS SETUP & GAME LOOP
    // =============================================================================

    useEffect(() => {
        if (!containerRef.current) return;

        // Reset module-level caches on game restart
        resetFogCache();
        resetAllBroodMotherScreeches();
        resetBarks();

        // Clear local refs that persist between game sessions
        zoomLevel.current = 12;
        targetRingTimers.current = {};
        Object.keys(hitFlashRef.current).forEach(k => delete hitFlashRef.current[Number(k)]);
        Object.keys(moveStartRef.current).forEach(k => delete moveStartRef.current[Number(k)]);
        Object.keys(actionCooldownRef.current).forEach(k => delete actionCooldownRef.current[Number(k)]);
        Object.keys(pathsRef.current).forEach(k => delete pathsRef.current[Number(k)]);
        acidTilesRef.current.clear();  // Clear acid tiles (meshes will be in old scene)
        sanctuaryTilesRef.current.clear();  // Clear sanctuary tiles

        const sceneRefs = createScene(containerRef.current, units);
        const { scene, camera, renderer, flames, candleMeshes, candleLights, fogTexture, fogMesh, moveMarker, rangeIndicator, aoeIndicator, unitGroups, selectRings, targetRings, shieldIndicators, unitMeshes, unitOriginalColors, maxHp, wallMeshes, treeMeshes, doorMeshes, waterMesh } = sceneRefs;

        sceneRef.current = scene;
        cameraRef.current = camera;
        rendererRef.current = renderer;
        fogTextureRef.current = fogTexture;
        fogMeshRef.current = fogMesh;
        moveMarkerRef.current = moveMarker;
        rangeIndicatorRef.current = rangeIndicator;
        aoeIndicatorRef.current = aoeIndicator;
        unitsRef.current = unitGroups;
        selectRingsRef.current = selectRings;
        targetRingsRef.current = targetRings;
        shieldIndicatorsRef.current = shieldIndicators;
        unitMeshRef.current = unitMeshes;
        unitOriginalColorRef.current = unitOriginalColors;
        maxHpRef.current = maxHp;
        wallMeshesRef.current = wallMeshes;
        treeMeshesRef.current = treeMeshes;
        doorMeshesRef.current = doorMeshes;
        waterMeshRef.current = waterMesh;
        units.forEach(unit => { pathsRef.current[unit.id] = []; });

        const updateCam = () => updateCamera(camera, cameraOffset.current);
        updateCam();

        // Apply initial zoom level (camera is created with default zoom, need to sync with zoomLevel ref)
        const aspect = containerRef.current.clientWidth / containerRef.current.clientHeight;
        camera.left = -zoomLevel.current * aspect;
        camera.right = zoomLevel.current * aspect;
        camera.top = zoomLevel.current;
        camera.bottom = -zoomLevel.current;
        camera.updateProjectionMatrix();

        const raycaster = new THREE.Raycaster();
        const mouse = new THREE.Vector2();
        // Process action queue wrapper - accepts defeatedThisFrame to share with skills
        const doProcessQueue = (defeatedThisFrame: Set<number>) => {
            const skillCtx = getSkillContext(scene, defeatedThisFrame);
            processActionQueue(
                actionQueueRef,
                actionCooldownRef,
                unitsRef.current,
                pathsRef.current,
                moveStartRef.current,
                pausedRef,
                skillCtx,
                setUnits,
                setQueuedActions
            );
        };
        processActionQueueRef.current = doProcessQueue;

        // Area transition handler
        const handleAreaTransition = (transition: AreaTransition) => {
            // Extract player states to persist (HP, mana, status effects)
            const playerUnits = unitsStateRef.current.filter(u => u.team === "player");
            const persistedState: PersistedPlayer[] = playerUnits.map(u => ({
                id: u.id,
                hp: u.hp,
                mana: u.mana,
                statusEffects: u.statusEffects
            }));

            // Trigger area transition via parent - this will remount with new area
            onAreaTransition(persistedState, transition.targetArea, transition.targetSpawn);
        };

        // =============================================================================
        // INPUT HANDLERS
        // =============================================================================

        const onMouseDown = (e: MouseEvent) => {
            if (e.button === 2) {
                isDragging.current = true;
                didPan.current = false;
                lastMouse.current = { x: e.clientX, y: e.clientY };
            } else if (e.button === 0) {
                const rect = renderer.domElement.getBoundingClientRect();
                mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
                mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
                raycaster.setFromCamera(mouse, camera);
                let hitUnit = false;
                for (const h of raycaster.intersectObjects(scene.children, true)) {
                    let o: THREE.Object3D | null = h.object;
                    while (o) {
                        if (o.userData.unitId !== undefined) { hitUnit = true; break; }
                        o = o.parent;
                    }
                    if (hitUnit) break;
                }
                if (!hitUnit) {
                    isBoxSel.current = true;
                    boxStart.current = { x: e.clientX, y: e.clientY };
                    boxEnd.current = { x: e.clientX, y: e.clientY };
                }
            }
        };

        const onMouseMove = (e: MouseEvent) => {
            if (isDragging.current) {
                const dx = e.clientX - lastMouse.current.x, dy = e.clientY - lastMouse.current.y;
                if (dx !== 0 || dy !== 0) didPan.current = true;
                cameraOffset.current.x -= (dx + dy) * 0.03;
                cameraOffset.current.z -= (dy - dx) * 0.03;
                cameraOffset.current.x = Math.max(0, Math.min(GRID_SIZE, cameraOffset.current.x));
                cameraOffset.current.z = Math.max(0, Math.min(GRID_SIZE, cameraOffset.current.z));
                lastMouse.current = { x: e.clientX, y: e.clientY };
                updateCam();
            } else if (isBoxSel.current) {
                boxEnd.current = { x: e.clientX, y: e.clientY };
                const rect = renderer.domElement.getBoundingClientRect();
                setSelBox({
                    left: Math.min(boxStart.current.x, boxEnd.current.x) - rect.left,
                    top: Math.min(boxStart.current.y, boxEnd.current.y) - rect.top,
                    width: Math.abs(boxEnd.current.x - boxStart.current.x),
                    height: Math.abs(boxEnd.current.y - boxStart.current.y)
                });
            }

            // Update AOE indicator
            if (targetingModeRef.current && aoeIndicatorRef.current) {
                const rect = renderer.domElement.getBoundingClientRect();
                mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
                mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
                raycaster.setFromCamera(mouse, camera);
                for (const hit of raycaster.intersectObjects(scene.children, true)) {
                    if (hit.object.name === "ground") {
                        aoeIndicatorRef.current.position.x = hit.point.x;
                        aoeIndicatorRef.current.position.z = hit.point.z;
                        break;
                    }
                }
            }

            // Check for hovered enemy units
            const rect = renderer.domElement.getBoundingClientRect();
            mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
            raycaster.setFromCamera(mouse, camera);

            let foundEnemy: { id: number; x: number; y: number } | null = null;
            let foundChest: { x: number; y: number } | null = null;
            let foundPlayer: { id: number; x: number; y: number } | null = null;
            for (const hit of raycaster.intersectObjects(scene.children, true)) {
                const unitId = hit.object.userData?.unitId;
                if (unitId !== undefined) {
                    const unit = unitsStateRef.current.find(u => u.id === unitId);
                    if (unit && unit.hp > 0) {
                        if (unit.team === "enemy") {
                            // Check fog of war - only show tooltip if enemy is visible (visibility === 2)
                            const g = unitsRef.current[unitId];
                            if (g) {
                                const cx = Math.floor(g.position.x);
                                const cz = Math.floor(g.position.z);
                                const vis = visibilityRef.current[cx]?.[cz] ?? 0;
                                if (vis === 2) {
                                    foundEnemy = { id: unitId, x: e.clientX, y: e.clientY };
                                }
                            }
                        } else if (unit.team === "player") {
                            foundPlayer = { id: unitId, x: e.clientX, y: e.clientY };
                        }
                        break;
                    }
                }
                // Check for chest hover
                if (hit.object.name === "chest") {
                    foundChest = { x: e.clientX, y: e.clientY };
                    break;
                }
                // Check for door hover
                if (hit.object.name === "door") {
                    const transition = hit.object.userData?.transition as AreaTransition | undefined;
                    if (transition) {
                        setHoveredDoor({ targetArea: transition.targetArea, x: e.clientX, y: e.clientY });
                    }
                    break;
                }
            }
            setHoveredEnemy(foundEnemy);
            setHoveredChest(foundChest);
            setHoveredPlayer(foundPlayer);
            // Clear door hover if we didn't find one
            if (!raycaster.intersectObjects(scene.children, true).some(h => h.object.name === "door")) {
                setHoveredDoor(null);
            }
        };

        const onMouseUp = (e: MouseEvent) => {
            if (isBoxSel.current && !targetingModeRef.current) {
                const dx = Math.abs(boxEnd.current.x - boxStart.current.x);
                const dy = Math.abs(boxEnd.current.y - boxStart.current.y);
                if (dx > 5 || dy > 5) {
                    const rect = renderer.domElement.getBoundingClientRect();
                    const inBox = getUnitsInBox(unitsRef.current, unitsStateRef.current, camera, rect, boxStart.current.x, boxStart.current.y, boxEnd.current.x, boxEnd.current.y);
                    setSelectedIds(e.shiftKey ? prev => [...new Set([...prev, ...inBox])] : inBox);
                } else {
                    const rect = renderer.domElement.getBoundingClientRect();
                    mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
                    mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
                    raycaster.setFromCamera(mouse, camera);
                    for (const h of raycaster.intersectObjects(scene.children, true)) {
                        if (h.object.name === "obstacle") continue;
                        if (h.object.name === "ground" && selectedRef.current.length > 0) {
                            const gx = Math.floor(h.point.x) + 0.5, gz = Math.floor(h.point.z) + 0.5;
                            if (blocked[Math.floor(gx)]?.[Math.floor(gz)]) break;
                            if (moveMarkerRef.current) {
                                moveMarkerRef.current.position.set(gx, 0.05, gz);
                                moveMarkerRef.current.visible = true;
                                (moveMarkerRef.current.material as THREE.MeshBasicMaterial).opacity = 0.8;
                                moveMarkerStartRef.current = Date.now();
                            }
                            soundFns.playMove();

                            const moveTargets = buildMoveTargets(selectedRef.current, unitsStateRef.current, gx, gz);

                            // Queue move for each unit (per-unit queue, last action wins)
                            moveTargets.forEach(t => {
                                actionQueueRef.current[t.id] = { type: "move", targetX: t.x, targetZ: t.z };
                            });
                            if (pausedRef.current) {
                                addLog(`Move queued for ${moveTargets.length} unit${moveTargets.length !== 1 ? "s" : ""}.`, "#888");
                            }
                            break;
                        }
                    }
                }
                isBoxSel.current = false;
                setSelBox(null);
            }
            if (isBoxSel.current) {
                isBoxSel.current = false;
                setSelBox(null);
            }
            isDragging.current = false;
        };

        const onClick = (e: MouseEvent) => {
            if (e.button !== 0) return;
            const rect = renderer.domElement.getBoundingClientRect();
            mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
            raycaster.setFromCamera(mouse, camera);

            // Create skill context for this click event (not part of game loop frame)
            const skillCtx = getSkillContext(scene);

            // Handle targeting mode
            if (targetingModeRef.current) {
                for (const hit of raycaster.intersectObjects(scene.children, true)) {
                    if (handleTargetingClick(
                        hit,
                        targetingModeRef.current,
                        { actionCooldownRef, actionQueueRef, rangeIndicatorRef, aoeIndicatorRef },
                        { unitsStateRef: unitsStateRef as React.RefObject<Unit[]>, pausedRef },
                        { setTargetingMode, setQueuedActions },
                        unitsRef.current,
                        skillCtx,
                        addLog
                    )) return;
                }
                return;
            }

            // Check for door click - trigger area transition
            for (const h of raycaster.intersectObjects(scene.children, true)) {
                if (h.object.name === "door") {
                    const transition = h.object.userData?.transition as AreaTransition | undefined;
                    if (transition) {
                        // Check if all alive party members are within range of the door
                        const doorCenterX = transition.x + transition.w / 2;
                        const doorCenterZ = transition.z + transition.h / 2;
                        const doorRange = 8;  // Units must be within 8 tiles of door center

                        const alivePlayers = unitsStateRef.current.filter(u => u.team === "player" && u.hp > 0);
                        const allPlayersInRange = alivePlayers.every(player => {
                            const playerG = unitsRef.current[player.id];
                            if (!playerG) return false;
                            const dx = playerG.position.x - doorCenterX;
                            const dz = playerG.position.z - doorCenterZ;
                            return Math.sqrt(dx * dx + dz * dz) <= doorRange;
                        });

                        if (allPlayersInRange) {
                            handleAreaTransition(transition);
                        } else {
                            addLog("You must gather your party before venturing forth.", "#f59e0b");
                        }
                        return;
                    }
                }
            }

            // Normal click handling
            for (const h of raycaster.intersectObjects(scene.children, true)) {
                let o: THREE.Object3D | null = h.object;
                while (o) {
                    if (o.userData.unitId !== undefined) {
                        const id = o.userData.unitId as number;
                        const clickedUnit = unitsStateRef.current.find(u => u.id === id);
                        if (clickedUnit && clickedUnit.team === "enemy" && clickedUnit.hp > 0 && selectedRef.current.length > 0) {
                            // Set attack target and queue attack skill for all selected units
                            const targetId = clickedUnit.id;
                            const targetG = unitsRef.current[targetId];

                            // Show red target ring on the enemy (will fade out)
                            const targetRing = targetRingsRef.current[targetId];
                            if (targetRing) {
                                targetRing.visible = true;
                                (targetRing.material as THREE.MeshBasicMaterial).opacity = 1;
                                targetRingTimers.current[targetId] = Date.now();
                            }

                            selectedRef.current.forEach(uid => {
                                const casterG = unitsRef.current[uid];
                                if (casterG) {
                                    // Set persistent attack target (unit will keep attacking this enemy)
                                    casterG.userData.attackTarget = targetId;
                                    pathsRef.current[uid] = [];

                                    // Queue attack skill (works when paused or on cooldown)
                                    if (targetG) {
                                        const basicAttack = getBasicAttackSkill(uid);
                                        queueOrExecuteSkill(
                                            uid,
                                            basicAttack,
                                            targetG.position.x,
                                            targetG.position.z,
                                            { actionCooldownRef, actionQueueRef, rangeIndicatorRef, aoeIndicatorRef },
                                            { pausedRef },
                                            { setTargetingMode, setQueuedActions },
                                            skillCtx,
                                            addLog
                                        );
                                    }
                                }
                            });

                            // Update unit state to reflect targeting
                            setUnits(prev => prev.map(u =>
                                selectedRef.current.includes(u.id) ? { ...u, target: targetId } : u
                            ));
                            soundFns.playAttack();
                            return;
                        } else if (clickedUnit && clickedUnit.team === "player") {
                            setSelectedIds(e.shiftKey ? prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id] : [id]);
                            return;
                        }
                    }
                    o = o.parent;
                }
            }
        };

        const onKeyDown = (e: KeyboardEvent) => {
            if (e.code === "Space") {
                e.preventDefault();
                togglePause(
                    { pauseStartTimeRef, actionCooldownRef },
                    { pausedRef },
                    { setPaused, setSkillCooldowns },
                    doProcessQueue
                );
            }
            if (e.code === "Escape") {
                // Priority: targeting mode > help modal > unit panel > deselect all
                if (targetingModeRef.current) {
                    clearTargetingMode(setTargetingMode, rangeIndicatorRef, aoeIndicatorRef);
                } else if (helpOpenRef.current) {
                    onCloseHelp();
                } else if (showPanelRef.current) {
                    setShowPanel(false);
                } else if (selectedRef.current.length > 0) {
                    setSelectedIds([]);
                }
            }
            if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "KeyW", "KeyA", "KeyS", "KeyD"].includes(e.code)) {
                keysPressed.current.add(e.code);
            }
        };

        const onKeyUp = (e: KeyboardEvent) => { keysPressed.current.delete(e.code); };

        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            zoomLevel.current = Math.max(5, Math.min(30, zoomLevel.current + e.deltaY * 0.01));
            const aspect = containerRef.current!.clientWidth / containerRef.current!.clientHeight;
            camera.left = -zoomLevel.current * aspect;
            camera.right = zoomLevel.current * aspect;
            camera.top = zoomLevel.current;
            camera.bottom = -zoomLevel.current;
            camera.updateProjectionMatrix();
        };

        const onContextMenu = (e: MouseEvent) => {
            e.preventDefault();
            // Don't deselect if we were panning
            if (didPan.current) return;
            if (targetingModeRef.current) {
                clearTargetingMode(setTargetingMode, rangeIndicatorRef, aoeIndicatorRef);
            } else {
                // Right-click deselects all units
                setSelectedIds([]);
            }
        };

        renderer.domElement.addEventListener("click", onClick);
        renderer.domElement.addEventListener("mousedown", onMouseDown);
        renderer.domElement.addEventListener("mousemove", onMouseMove);
        renderer.domElement.addEventListener("mouseup", onMouseUp);
        renderer.domElement.addEventListener("contextmenu", onContextMenu);
        renderer.domElement.addEventListener("wheel", onWheel, { passive: false });
        window.addEventListener("keydown", onKeyDown);
        window.addEventListener("keyup", onKeyUp);

        // =============================================================================
        // GAME LOOP
        // =============================================================================

        let animId: number;
        const animate = () => {
            animId = requestAnimationFrame(animate);
            const now = Date.now();

            // FPS counter
            fpsFrameCount.current++;
            if (now - fpsLastTime.current >= 1000) {
                setFps(fpsFrameCount.current);
                fpsFrameCount.current = 0;
                fpsLastTime.current = now;
            }

            // Flickering flames - slow, intense flicker (flames and room lights are separate now)
            flames.forEach((flame, i) => {
                const flicker = 0.6 + Math.sin(now * 0.004 + i * 2) * 0.25 + Math.random() * 0.1;
                flame.scale.y = 1.6 + Math.sin(now * 0.005 + i) * 0.5;
                (flame.material as THREE.MeshBasicMaterial).opacity = flicker;
            });
            // Room lights flicker subtly (1 per room, not per candle)
            candleLights.forEach((light, i) => {
                light.intensity = 12 + Math.sin(now * 0.003 + i * 1.7) * 3 + Math.random() * 1;
            });

            // Keyboard panning
            let screenX = 0, screenY = 0;
            if (keysPressed.current.has("ArrowUp") || keysPressed.current.has("KeyW")) screenY -= 1;
            if (keysPressed.current.has("ArrowDown") || keysPressed.current.has("KeyS")) screenY += 1;
            if (keysPressed.current.has("ArrowLeft") || keysPressed.current.has("KeyA")) screenX -= 1;
            if (keysPressed.current.has("ArrowRight") || keysPressed.current.has("KeyD")) screenX += 1;
            if (screenX !== 0 || screenY !== 0) {
                const len = Math.hypot(screenX, screenY);
                const worldX = ((screenX / len) + (screenY / len)) * PAN_SPEED;
                const worldZ = (-(screenX / len) + (screenY / len)) * PAN_SPEED;
                cameraOffset.current.x = Math.max(0, Math.min(GRID_SIZE, cameraOffset.current.x + worldX));
                cameraOffset.current.z = Math.max(0, Math.min(GRID_SIZE, cameraOffset.current.z + worldZ));
                updateCam();
            }

            // Update damage texts
            damageTexts.current = updateDamageTexts(damageTexts.current, camera, scene, pausedRef.current);

            // Track units defeated this frame to prevent duplicate defeat handling
            const defeatedThisFrame = new Set<number>();

            // Update projectiles
            if (!pausedRef.current) {
                projectilesRef.current = updateProjectiles(
                    projectilesRef.current,
                    unitsRef.current,
                    unitsStateRef.current,
                    scene,
                    damageTexts.current,
                    hitFlashRef.current,
                    setUnits,
                    addLog,
                    now,
                    defeatedThisFrame
                );

                // Process status effects (poison ticks, etc.)
                processStatusEffects(
                    unitsStateRef.current,
                    unitsRef.current,
                    scene,
                    damageTexts.current,
                    hitFlashRef.current,
                    setUnits,
                    addLog,
                    now,
                    defeatedThisFrame
                );

                // Process acid tiles (damage units standing on acid)
                processAcidTiles(
                    acidTilesRef.current,
                    unitsStateRef.current,
                    unitsRef.current,
                    scene,
                    damageTexts.current,
                    hitFlashRef.current,
                    setUnits,
                    addLog,
                    now,
                    defeatedThisFrame
                );

                // Process sanctuary tiles (heal player units standing on them)
                processSanctuaryTiles(
                    sanctuaryTilesRef.current,
                    unitsStateRef.current,
                    unitsRef.current,
                    scene,
                    damageTexts.current,
                    setUnits,
                    addLog,
                    now
                );

                // Hit flash effect
                updateHitFlash(hitFlashRef.current, unitMeshRef.current, unitOriginalColorRef.current, unitsStateRef.current, now);

                // Update poison visuals (green tint for poisoned units)
                updatePoisonVisuals(unitsStateRef.current, unitMeshRef.current, unitOriginalColorRef.current, hitFlashRef.current);

                // Update shield facing for front-shielded enemies
                updateShieldFacing(unitsStateRef.current, unitsRef.current, shieldIndicatorsRef.current, setUnits);
            }

            const currentUnits = unitsStateRef.current;

            // Fog of war
            const playerUnits = currentUnits.filter(u => u.team === "player" && u.hp > 0);
            if (fogTextureRef.current && fogMeshRef.current) {
                updateFogOfWar(visibilityRef.current, playerUnits, unitsRef.current, fogTextureRef.current, currentUnits, fogMeshRef.current);
            }

            // Update tree colors based on fog visibility
            updateTreeFogVisibility(treeMeshesRef.current, visibilityRef.current);

            // Unit AI & movement
            if (!pausedRef.current) {
                // Process queued actions (skills waiting for cooldown)
                doProcessQueue(defeatedThisFrame);

                // Check for newly spawned units and add them to the scene
                currentUnits.forEach(unit => {
                    if (!unitsRef.current[unit.id] && unit.hp > 0) {
                        // This is a newly spawned unit - add it to the scene
                        addUnitToScene(
                            scene,
                            unit,
                            unitsRef.current,
                            selectRingsRef.current,
                            targetRingsRef.current,
                            shieldIndicatorsRef.current,
                            unitMeshRef.current,
                            unitOriginalColorRef.current,
                            maxHpRef.current
                        );
                        pathsRef.current[unit.id] = [];
                    }
                });

                // Update dynamic obstacle map for pathfinding (units avoid each other)
                updateDynamicObstacles(currentUnits, unitsRef.current);

                // Update unit cache for O(1) lookups in AI calculations
                updateUnitCache(currentUnits);

                currentUnits.forEach(unit => {
                    const g = unitsRef.current[unit.id];
                    if (!g || unit.hp <= 0) return;
                    updateUnitAI(
                        unit, g, unitsRef.current, currentUnits, visibilityRef.current,
                        pathsRef.current, actionCooldownRef.current, hitFlashRef.current,
                        projectilesRef.current, damageTexts.current, swingAnimationsRef.current,
                        moveStartRef.current, scene, setUnits, addLog, now,
                        defeatedThisFrame,
                        skillCooldownsRef.current, setSkillCooldowns,
                        actionQueueRef.current, setQueuedActions,
                        acidTilesRef.current
                    );
                });

                // Update swing animations
                swingAnimationsRef.current = updateSwingAnimations(swingAnimationsRef.current, scene, now);
            }

            // Animate move marker - rotate and fade out
            if (moveMarkerRef.current?.visible) {
                moveMarkerRef.current.rotation.z += 0.05;
                const markerAge = Date.now() - moveMarkerStartRef.current;
                const markerDuration = 1000;  // Linger for 1 second
                if (markerAge >= markerDuration) {
                    moveMarkerRef.current.visible = false;
                } else {
                    // Fade out over the last half of the duration
                    const fadeStart = markerDuration * 0.5;
                    if (markerAge > fadeStart) {
                        const fadeProgress = (markerAge - fadeStart) / (markerDuration - fadeStart);
                        (moveMarkerRef.current.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - fadeProgress);
                    }
                }
            }

            // Update target rings - fade out over time
            const targetRingDuration = 1500;  // 1.5 seconds total
            const targetRingFadeStart = 500;   // Start fading after 0.5 seconds
            Object.entries(targetRingTimers.current).forEach(([idStr, startTime]) => {
                const id = Number(idStr);
                const ring = targetRingsRef.current[id];
                if (!ring) return;

                const age = now - startTime;
                if (age >= targetRingDuration) {
                    ring.visible = false;
                    delete targetRingTimers.current[id];
                } else if (age > targetRingFadeStart) {
                    const fadeProgress = (age - targetRingFadeStart) / (targetRingDuration - targetRingFadeStart);
                    (ring.material as THREE.MeshBasicMaterial).opacity = 1 - fadeProgress;
                }
            });

            // Update range indicator to follow caster during targeting mode
            if (targetingModeRef.current && rangeIndicatorRef.current?.visible) {
                const casterG = unitsRef.current[targetingModeRef.current.casterId];
                if (casterG) {
                    rangeIndicatorRef.current.position.x = casterG.position.x;
                    rangeIndicatorRef.current.position.z = casterG.position.z;
                }
            }

            // HP bar positions
            const rect = renderer.domElement.getBoundingClientRect();
            setHpBarPositions(updateHpBarPositions(currentUnits, unitsRef.current, camera, rect, zoomLevel.current));

            // Update wall, tree, and candle transparency for occluded units
            updateWallTransparency(camera, wallMeshesRef.current, unitsRef.current, currentUnits, treeMeshesRef.current, candleMeshes, flames);

            // Light LOD - disable distant room lights to save GPU
            updateLightLOD(candleLights, cameraOffset.current);

            // Animated water waves
            updateWater(waterMeshRef.current, now);

            renderer.render(scene, camera);
        };
        animate();

        // Resize handler
        const onResize = () => {
            if (!containerRef.current) return;
            const w = containerRef.current.clientWidth, h = containerRef.current.clientHeight, a = w / h;
            camera.left = -zoomLevel.current * a;
            camera.right = zoomLevel.current * a;
            camera.top = zoomLevel.current;
            camera.bottom = -zoomLevel.current;
            camera.updateProjectionMatrix();
            renderer.setSize(w, h);
        };
        window.addEventListener("resize", onResize);

        return () => {
            cancelAnimationFrame(animId);
            window.removeEventListener("resize", onResize);
            window.removeEventListener("keydown", onKeyDown);
            window.removeEventListener("keyup", onKeyUp);
            renderer.domElement.removeEventListener("click", onClick);
            renderer.domElement.removeEventListener("mousedown", onMouseDown);
            renderer.domElement.removeEventListener("mousemove", onMouseMove);
            renderer.domElement.removeEventListener("mouseup", onMouseUp);
            renderer.domElement.removeEventListener("contextmenu", onContextMenu);
            renderer.domElement.removeEventListener("wheel", onWheel);
            renderer.dispose();
            containerRef.current?.removeChild(renderer.domElement);
        };
    }, []);

    // Update selection rings
    useEffect(() => {
        Object.entries(selectRingsRef.current).forEach(([id, ring]) => {
            ring.visible = selectedIds.includes(Number(id));
        });
        setShowPanel(selectedIds.length === 1 && units.find(u => u.id === selectedIds[0])?.team === "player");
    }, [selectedIds, units]);

    const alivePlayers = units.filter(u => u.team === "player" && u.hp > 0).length;
    const areaData = getCurrentArea();

    // Skill targeting handler
    const handleCastSkill = (casterId: number, skill: Skill) => {
        const caster = units.find(u => u.id === casterId);
        if (!caster || caster.hp <= 0 || (caster.mana ?? 0) < skill.manaCost) return;

        const casterG = unitsRef.current[casterId];
        if (!casterG || !sceneRef.current) return;

        // Self-targeted skills don't need targeting mode - queue or execute immediately
        if (skill.targetType === "self") {
            const skillCtx = getSkillContext(sceneRef.current);
            const cooldownEnd = actionCooldownRef.current[casterId] || 0;

            if (paused || Date.now() < cooldownEnd) {
                // Queue the skill (per-unit queue, last action wins)
                actionQueueRef.current[casterId] = {
                    type: "skill",
                    skill,
                    targetX: casterG.position.x,
                    targetZ: casterG.position.z
                };
                // Update UI state (replace any existing queued action for this unit)
                setQueuedActions(prev => [
                    ...prev.filter(q => q.unitId !== casterId),
                    { unitId: casterId, skillName: skill.name }
                ]);
                const reason = paused ? "queued" : "on cooldown";
                addLog(`${UNIT_DATA[casterId].name} queues ${skill.name} (${reason})`, "#888");
            } else {
                // Ready to cast now
                executeSkill(skillCtx, casterId, skill, casterG.position.x, casterG.position.z);
            }
            return;
        }

        setupTargetingMode(casterId, skill, casterG, rangeIndicatorRef, aoeIndicatorRef, setTargetingMode);
    };

    // Toggle pause handler for HUD button
    const handleTogglePause = () => {
        togglePause(
            { pauseStartTimeRef, actionCooldownRef },
            { pausedRef },
            { setPaused, setSkillCooldowns },
            processActionQueueRef.current
        );
    };

    // Debug warp to any area
    const handleWarpToArea = (areaId: AreaId) => {
        // Extract player states to persist (HP, mana, status effects)
        const playerUnits = unitsStateRef.current.filter(u => u.team === "player");
        const persistedState: PersistedPlayer[] = playerUnits.map(u => ({
            id: u.id,
            hp: u.hp,
            mana: u.mana,
            statusEffects: u.statusEffects
        }));

        // Use default spawn point for debug warps
        onAreaTransition(persistedState, areaId, DEFAULT_SPAWN_POINT);
    };

    return (
        <div style={{ width: "100%", height: "100vh", position: "relative", cursor: targetingMode ? "crosshair" : "default" }}>
            <div ref={containerRef} style={{ width: "100%", height: "100%", filter: paused ? "saturate(0.4) brightness(0.85)" : "none", transition: "filter 0.2s" }} />
            {selBox && <div style={{ position: "absolute", left: selBox.left, top: selBox.top, width: selBox.width, height: selBox.height, border: "1px solid #00ff00", backgroundColor: "rgba(0,255,0,0.1)", pointerEvents: "none" }} />}
            {/* DOM-based HP bars (player units only) */}
            {units.filter(u => u.team === "player").map(u => {
                const pos = hpBarPositions.positions[u.id];
                if (!pos?.visible) return null;
                const maxHp = maxHpRef.current[u.id] || 1;
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
            {/* Enemy tooltip on hover */}
            {hoveredEnemy && (() => {
                const enemy = units.find(u => u.id === hoveredEnemy.id);
                if (!enemy || !enemy.enemyType || enemy.hp <= 0) return null;
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
            {/* Chest tooltip on hover */}
            {hoveredChest && (
                <div className="enemy-tooltip" style={{ left: hoveredChest.x + 12, top: hoveredChest.y - 10 }}>
                    <div className="enemy-tooltip-name">Chest</div>
                </div>
            )}
            {/* Player unit tooltip on hover */}
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
            {/* Door tooltip on hover */}
            {hoveredDoor && (
                <div className="enemy-tooltip" style={{ left: hoveredDoor.x + 12, top: hoveredDoor.y - 10 }}>
                    <div className="enemy-tooltip-name">Door</div>
                    <div className="enemy-tooltip-status" style={{ color: "#4a90d9" }}>To: {AREAS[hoveredDoor.targetArea as AreaId]?.name ?? hoveredDoor.targetArea}</div>
                </div>
            )}
            {/* FPS counter */}
            <div style={{ position: "absolute", top: 10, right: 10, color: "#888", fontSize: 11, fontFamily: "monospace", opacity: 0.6 }}>
                {fps} fps
            </div>
            <HUD areaName={areaData.name} areaFlavor={areaData.flavor} alivePlayers={alivePlayers} paused={paused} onTogglePause={handleTogglePause} onShowHelp={onShowHelp} onRestart={onRestart} debug={debug} onToggleDebug={() => setDebug(d => !d)} onWarpToArea={handleWarpToArea} />
            <CombatLog log={combatLog} />
            <PartyBar
                units={units}
                selectedIds={selectedIds}
                onSelect={setSelectedIds}
                targetingMode={targetingMode}
                onTargetUnit={(targetUnitId) => {
                    if (!targetingMode || !sceneRef.current) return;
                    const skillCtx = getSkillContext(sceneRef.current);
                    handleTargetingOnUnit(
                        targetUnitId,
                        targetingMode,
                        { actionCooldownRef, actionQueueRef, rangeIndicatorRef, aoeIndicatorRef },
                        { unitsStateRef: unitsStateRef as React.RefObject<Unit[]>, pausedRef },
                        { setTargetingMode, setQueuedActions },
                        unitsRef.current,
                        skillCtx,
                        addLog
                    );
                }}
            />
            {showPanel && selectedIds.length === 1 && <UnitPanel
                unitId={selectedIds[0]}
                units={units}
                onClose={() => setShowPanel(false)}
                onToggleAI={(id) => setUnits(prev => prev.map(u => u.id === id ? { ...u, aiEnabled: !u.aiEnabled } : u))}
                onCastSkill={handleCastSkill}
                skillCooldowns={skillCooldowns}
                paused={paused}
                queuedSkills={queuedActions.filter(q => q.unitId === selectedIds[0]).map(q => q.skillName)}
                // unitCooldownEnd={actionCooldownRef.current[selectedIds[0]] || 0}
            />}
        </div>
    );
}

// Wrapper component that handles restart by remounting Game
export default function App() {
    const [gameKey, setGameKey] = useState(0);
    const [showHelp, setShowHelp] = useState(true); // Show help on initial page load
    // Persisted player state survives area transitions
    const [persistedPlayers, setPersistedPlayers] = useState<PersistedPlayer[] | null>(null);
    const [spawnPoint, setSpawnPoint] = useState<{ x: number; z: number } | null>(null);

    // Full restart (resets player state too)
    const handleFullRestart = () => {
        setPersistedPlayers(null);
        setSpawnPoint(null);
        setCurrentArea(DEFAULT_STARTING_AREA);
        setGameKey(k => k + 1);
    };

    // Area transition (preserves player state)
    const handleAreaTransition = (players: PersistedPlayer[], targetArea: AreaId, spawn: { x: number; z: number }) => {
        setPersistedPlayers(players);
        setSpawnPoint(spawn);
        setCurrentArea(targetArea);
        setGameKey(k => k + 1);  // Remount with new area
    };

    return (
        <>
            <Game
                key={gameKey}
                onRestart={handleFullRestart}
                onAreaTransition={handleAreaTransition}
                onShowHelp={() => setShowHelp(true)}
                onCloseHelp={() => setShowHelp(false)}
                helpOpen={showHelp}
                persistedPlayers={persistedPlayers}
                spawnPoint={spawnPoint}
            />
            {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
        </>
    );
}
