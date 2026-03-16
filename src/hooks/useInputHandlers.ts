/**
 * Hook for handling all input events (mouse, keyboard, wheel)
 * Extracts input handling logic from App.tsx for better organization
 */

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { hideAll as hideAllTippy } from "tippy.js";
import type { Unit, Skill, UnitGroup, SelectionBox, LootPickupEntry, LootPickupRequest } from "../core/types";
import type { SecretDoorMesh } from "../rendering/scene";
import type { LootBag } from "../core/types";
import { updateCamera } from "../rendering/scene";
import { blocked } from "../game/dungeon";
import { getCurrentArea, getBlocked, isTerrainBlocked, type AreaTransition } from "../game/areas";
import { getUnitById } from "../game/unitQuery";
import { getBasicAttackSkill, getAllSkills, isCorePlayerId } from "../game/playerUnits";
import { getItem } from "../game/items";
import { isKey } from "../core/types";
import { soundFns } from "../audio";
import { clearPathCache } from "../ai/pathfinding";
import { isInRange, getUnitRadius } from "../rendering/range";
import { removeLootBag } from "../gameLoop";
import { isEnemyUntargetable } from "../gameLoop/enemyBehaviors";
import {
    togglePause,
    getUnitsInBox,
    buildMoveTargets,
    handleTargetingClick,
    queueOrExecuteSkill,
    stopSelectedUnits,
    toggleHoldPositionForSelectedUnits,
    computeDragLineTiles,
    type ActionQueue
} from "../input";
import { clearTargetingMode, type SkillExecutionContext } from "../combat/skills";
import { disposeBasicMesh } from "../rendering/disposal";
import { distanceToPoint } from "../game/geometry";
import { getPartyInventory, setPartyInventory } from "../game/equipmentState";
import { removeFromInventory, addToInventory } from "../game/equipment";
import { buildEffectiveFormationOrder } from "../game/formationOrder";
import type { HotbarAssignments } from "./hotbarStorage";
import { scheduleEffectAnimation } from "../core/effectScheduler";

// =============================================================================
// TYPES
// =============================================================================

interface InputSceneRefs {
    scene: THREE.Scene;
    camera: THREE.OrthographicCamera;
    renderer: THREE.WebGLRenderer;
    unitGroups: Record<number, UnitGroup>;
    targetRings: Record<number, THREE.Mesh>;
    moveMarker: THREE.Mesh | null;
    rangeIndicator: THREE.Mesh | null;
    aoeIndicator: THREE.Mesh | null;
    secretDoorMeshes: SecretDoorMesh[];
}

export interface InputGameRefs {
    cameraOffset: { x: number; z: number };
    zoomLevel: number;
    targetRingTimers: Record<number, number>;
    moveMarkerStart: number;
    moveStart: Record<number, { time: number; x: number; z: number }>;
    paths: Record<number, { x: number; z: number }[]>;
    actionCooldown: Record<number, number>;
    visibility: number[][];
    lootBags: LootBag[];
}

interface InputStateRefs {
    unitsStateRef: React.MutableRefObject<Unit[]>;
    selectedRef: React.MutableRefObject<number[]>;
    pausedRef: React.MutableRefObject<boolean>;
    pauseToggleLockedRef: React.MutableRefObject<boolean>;
    targetingModeRef: React.MutableRefObject<{ casterId: number; skill: Skill; displacementTargetId?: number } | null>;
    consumableTargetingModeRef: React.MutableRefObject<{ userId: number; itemId: string } | null>;
    showPanelRef: React.MutableRefObject<boolean>;
    infoModalOpenRef: React.MutableRefObject<boolean>;
    openedChestsRef: React.MutableRefObject<Set<string>>;
    hotbarAssignmentsRef: React.MutableRefObject<HotbarAssignments>;
    pauseStartTimeRef: React.MutableRefObject<number | null>;
    formationOrderRef: React.MutableRefObject<number[]>;
    commandModeRef: React.MutableRefObject<"attackMove" | null>;
}

interface InputMutableRefs {
    actionQueueRef: React.MutableRefObject<ActionQueue>;
    actionCooldownRef: React.MutableRefObject<Record<number, number>>;
    keysPressed: React.MutableRefObject<Set<string>>;
    isDragging: React.MutableRefObject<boolean>;
    didPan: React.MutableRefObject<boolean>;
    isBoxSel: React.MutableRefObject<boolean>;
    boxStart: React.MutableRefObject<{ x: number; y: number }>;
    boxEnd: React.MutableRefObject<{ x: number; y: number }>;
    lastMouse: React.MutableRefObject<{ x: number; y: number }>;
}

interface InputSetters {
    setSelectedIds: React.Dispatch<React.SetStateAction<number[]>>;
    setSelBox: React.Dispatch<React.SetStateAction<SelectionBox | null>>;
    setUnits: React.Dispatch<React.SetStateAction<Unit[]>>;
    setPaused: React.Dispatch<React.SetStateAction<boolean>>;
    setTargetingMode: React.Dispatch<React.SetStateAction<{ casterId: number; skill: Skill; displacementTargetId?: number } | null>>;
    setConsumableTargetingMode: React.Dispatch<React.SetStateAction<{ userId: number; itemId: string } | null>>;
    setSkillCooldowns: React.Dispatch<React.SetStateAction<Record<string, { end: number; duration: number }>>>;
    setQueuedActions: React.Dispatch<React.SetStateAction<{ unitId: number; skillName: string }[]>>;
    setShowPanel: React.Dispatch<React.SetStateAction<boolean>>;
    setHoveredEnemy: React.Dispatch<React.SetStateAction<{ id: number; x: number; y: number } | null>>;
    setHoveredChest: React.Dispatch<React.SetStateAction<{ x: number; y: number; chestIndex: number; chestX: number; chestZ: number } | null>>;
    setHoveredPlayer: React.Dispatch<React.SetStateAction<{ id: number; x: number; y: number } | null>>;
    setHoveredDoor: React.Dispatch<React.SetStateAction<{ targetArea: string; x: number; y: number } | null>>;
    setHoveredSecretDoor: React.Dispatch<React.SetStateAction<{ x: number; y: number } | null>>;
    setHoveredLootBag: React.Dispatch<React.SetStateAction<{ x: number; y: number; gold: number; hasItems: boolean } | null>>;
    setOpenedChests: React.Dispatch<React.SetStateAction<Set<string>>>;
    setOpenedSecretDoors: React.Dispatch<React.SetStateAction<Set<string>>>;
    setGold: React.Dispatch<React.SetStateAction<number>>;
    setCommandMode: React.Dispatch<React.SetStateAction<"attackMove" | null>>;
}

interface InputCallbacks {
    addLog: (text: string, color?: string) => void;
    getSkillContext: (defeatedThisFrame?: Set<number>) => SkillExecutionContext;
    handleAreaTransition: (transition: AreaTransition) => void;
    onNpcEngaged: (unitId: number) => void;
    onCloseInfoModal: () => void;
    openLootPickupModal: (request: LootPickupRequest) => void;
    processActionQueue: (defeatedThisFrame: Set<number>) => void;
    handleCastSkillRef: React.MutableRefObject<((unitId: number, skill: Skill) => void) | null>;
}

interface UseInputHandlersOptions {
    containerRef: React.RefObject<HTMLDivElement | null>;
    sceneRefs: InputSceneRefs | null;
    gameRefs: React.MutableRefObject<InputGameRefs>;
    stateRefs: InputStateRefs;
    mutableRefs: InputMutableRefs;
    setters: InputSetters;
    callbacks: InputCallbacks;
}

const DIRECT_MOVE_SAMPLE_DENSITY = 4;
const NPC_ENGAGE_RANGE = 3.5;
const HOVER_ROOT_REBUILD_INTERVAL_MS = 140;
const TOOLTIP_ENEMY_HEIGHT_OFFSET = 1.35;
const TOOLTIP_PLAYER_HEIGHT_OFFSET = 1.45;
const TOOLTIP_CHEST_HEIGHT = 0.9;
const TOOLTIP_DOOR_HEIGHT = 1.0;
const TOOLTIP_SECRET_DOOR_HEIGHT = 1.2;
const TOOLTIP_LOOT_BAG_HEIGHT = 0.7;
const INVALID_MOVE_MARKER_DURATION_MS = 420;
const INVALID_MOVE_MARKER_COLOR = "#ef4444";
const INVALID_MOVE_MARKER_START_SCALE = 0.75;
const INVALID_MOVE_MARKER_END_SCALE = 1.05;
const INVALID_MOVE_MARKER_WIDTH = 0.14;
const INVALID_MOVE_MARKER_LENGTH = 0.82;
const INVALID_MOVE_MARKER_Y = 0.055;

interface ChestHitData {
    chestIndex: number;
    chestX: number;
    chestZ: number;
    chestDecorOnly?: boolean;
}

/**
 * Use direct movement only when the straight segment is clear of hard or
 * terrain blockers. This keeps open-field movement snappy without forcing
 * units to run directly into obstacles.
 */
function canUseDirectMove(g: UnitGroup, targetX: number, targetZ: number): boolean {
    const startX = g.position.x;
    const startZ = g.position.z;
    const dx = targetX - startX;
    const dz = targetZ - startZ;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.75) {
        return true;
    }

    const steps = Math.max(1, Math.ceil(dist * DIRECT_MOVE_SAMPLE_DENSITY));
    for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const sampleX = startX + dx * t;
        const sampleZ = startZ + dz * t;
        const cellX = Math.floor(sampleX);
        const cellZ = Math.floor(sampleZ);
        const row = blocked[cellX];
        if (!row || row[cellZ] === undefined) {
            return false;
        }
        if (row[cellZ] || isTerrainBlocked(cellX, cellZ)) {
            return false;
        }
    }

    return true;
}

function showInvalidMoveIndicator(scene: THREE.Scene, worldX: number, worldZ: number): void {
    const geometry = new THREE.PlaneGeometry(INVALID_MOVE_MARKER_WIDTH, INVALID_MOVE_MARKER_LENGTH);
    const material = new THREE.MeshBasicMaterial({
        color: INVALID_MOVE_MARKER_COLOR,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
        toneMapped: false,
    });
    const indicator = new THREE.Group();
    indicator.position.set(worldX, INVALID_MOVE_MARKER_Y, worldZ);
    indicator.scale.setScalar(INVALID_MOVE_MARKER_START_SCALE);

    const armA = new THREE.Mesh(geometry, material);
    armA.rotation.x = -Math.PI / 2;
    armA.rotation.z = Math.PI / 4;
    armA.renderOrder = 150;
    indicator.add(armA);

    const armB = new THREE.Mesh(geometry, material);
    armB.rotation.x = -Math.PI / 2;
    armB.rotation.z = -Math.PI / 4;
    armB.renderOrder = 150;
    indicator.add(armB);

    scene.add(indicator);

    let startTime: number | null = null;
    scheduleEffectAnimation((gameNow) => {
        if (startTime === null) {
            startTime = gameNow;
        }

        const elapsed = gameNow - startTime;
        const progress = Math.min(1, elapsed / INVALID_MOVE_MARKER_DURATION_MS);
        const eased = 1 - Math.pow(1 - progress, 3);
        const scale = INVALID_MOVE_MARKER_START_SCALE
            + (INVALID_MOVE_MARKER_END_SCALE - INVALID_MOVE_MARKER_START_SCALE) * eased;

        indicator.scale.setScalar(scale);
        indicator.position.y = INVALID_MOVE_MARKER_Y + 0.03 * Math.sin(progress * Math.PI);
        material.opacity = 0.9 * (1 - progress);

        if (progress >= 1) {
            scene.remove(indicator);
            geometry.dispose();
            material.dispose();
            return true;
        }

        return false;
    });
}

// =============================================================================
// HOOK
// =============================================================================

export function useInputHandlers({
    containerRef,
    sceneRefs,
    gameRefs,
    stateRefs,
    mutableRefs,
    setters,
    callbacks
}: UseInputHandlersOptions): void {
    const raycasterRef = useRef(new THREE.Raycaster());
    const mouseRef = useRef(new THREE.Vector2());
    const lastHoverRootsBuildRef = useRef(0);
    const staticHoverRaycastRootsRef = useRef<THREE.Object3D[]>([]);
    const hoverRaycastRootsRef = useRef<THREE.Object3D[]>([]);
    const unitRaycastRootsRef = useRef<THREE.Object3D[]>([]);
    const interactionRaycastRootsRef = useRef<THREE.Object3D[]>([]);
    const aliveHoverUnitIdsRef = useRef<Set<number>>(new Set());
    const hoveredEnemyRef = useRef<{ id: number; x: number; y: number } | null>(null);
    const hoveredChestRef = useRef<{ x: number; y: number; chestIndex: number; chestX: number; chestZ: number } | null>(null);
    const hoveredPlayerRef = useRef<{ id: number; x: number; y: number } | null>(null);
    const hoveredDoorRef = useRef<{ targetArea: string; x: number; y: number } | null>(null);
    const hoveredSecretDoorRef = useRef<{ x: number; y: number } | null>(null);
    const hoveredLootBagRef = useRef<{ x: number; y: number; gold: number; hasItems: boolean } | null>(null);
    // Drag-line targeting state (Wall of Fire etc.)
    const dragLineStateRef = useRef<{
        startX: number;
        startZ: number;
        previewMeshes: THREE.Mesh[];
    } | null>(null);
    // Timestamp of last drag-line execution — suppresses the click event that follows mouseup
    const dragLineExecutedAtRef = useRef(0);

    useEffect(() => {
        if (!sceneRefs || !containerRef.current) return;

        const { scene, camera, renderer, unitGroups, targetRings, moveMarker, rangeIndicator, aoeIndicator, secretDoorMeshes } = sceneRefs;
        const raycaster = raycasterRef.current;
        const mouse = mouseRef.current;
        const tooltipProjection = new THREE.Vector3();
        const staticHoverNames = new Set(["ground", "chest", "door", "secretDoor"]);
        const staticHoverRaycastRoots: THREE.Object3D[] = [];
        scene.traverse(obj => {
            if (!staticHoverNames.has(obj.name)) return;
            if (obj.name === "chest" && obj.userData?.chestDecorOnly === true) return;
            staticHoverRaycastRoots.push(obj);
        });
        staticHoverRaycastRootsRef.current = staticHoverRaycastRoots;
        lastHoverRootsBuildRef.current = 0;

        const refreshAliveUnitIds = (): Set<number> => {
            const aliveUnitIds = aliveHoverUnitIdsRef.current;
            aliveUnitIds.clear();
            for (const unit of stateRefs.unitsStateRef.current) {
                if (unit.hp <= 0) continue;
                aliveUnitIds.add(unit.id);
            }
            return aliveUnitIds;
        };

        const rebuildUnitRaycastRoots = (): THREE.Object3D[] => {
            const unitRaycastRoots = unitRaycastRootsRef.current;
            unitRaycastRoots.length = 0;
            const aliveUnitIds = refreshAliveUnitIds();

            for (const unitIdKey in unitGroups) {
                const unitId = Number(unitIdKey);
                const unitGroup = unitGroups[unitId];
                if (!unitGroup || !unitGroup.visible) continue;
                if (!aliveUnitIds.has(unitId)) continue;
                unitRaycastRoots.push(unitGroup);
            }

            return unitRaycastRoots;
        };

        const rebuildInteractionRaycastRoots = (): THREE.Object3D[] => {
            const interactionRaycastRoots = interactionRaycastRootsRef.current;
            interactionRaycastRoots.length = 0;

            for (const staticRoot of staticHoverRaycastRootsRef.current) {
                interactionRaycastRoots.push(staticRoot);
            }
            for (const bag of gameRefs.current.lootBags) {
                interactionRaycastRoots.push(bag.mesh);
            }
            for (const secretDoor of secretDoorMeshes) {
                interactionRaycastRoots.push(secretDoor);
            }

            return interactionRaycastRoots;
        };

        const updateCam = () => updateCamera(camera, gameRefs.current.cameraOffset);
        const closeAllTooltips = () => {
            hideAllTippy({ duration: 0 });
            hoveredEnemyRef.current = null;
            hoveredChestRef.current = null;
            hoveredPlayerRef.current = null;
            hoveredDoorRef.current = null;
            hoveredSecretDoorRef.current = null;
            hoveredLootBagRef.current = null;
            setters.setHoveredEnemy(null);
            setters.setHoveredChest(null);
            setters.setHoveredPlayer(null);
            setters.setHoveredDoor(null);
            setters.setHoveredSecretDoor(null);
            setters.setHoveredLootBag(null);
        };

        // =============================================================================
        // DRAG-LINE TARGETING HELPERS
        // =============================================================================
        const DRAG_PREVIEW_COLOR = 0xcc4400;
        const DRAG_PREVIEW_OPACITY = 0.4;
        const DRAG_PREVIEW_Y = 0.03;

        const clearDragLinePreview = (): void => {
            const state = dragLineStateRef.current;
            if (!state) return;
            for (const mesh of state.previewMeshes) {
                disposeBasicMesh(scene, mesh);
            }
            dragLineStateRef.current = null;
        };

        const updateDragLinePreview = (endX: number, endZ: number): void => {
            const state = dragLineStateRef.current;
            if (!state) return;
            const targeting = stateRefs.targetingModeRef.current;
            if (!targeting) return;

            const maxTiles = targeting.skill.maxTiles ?? 5;
            const tiles = computeDragLineTiles(state.startX, state.startZ, endX, endZ, maxTiles);

            // Remove excess preview meshes
            while (state.previewMeshes.length > tiles.length) {
                const mesh = state.previewMeshes.pop()!;
                disposeBasicMesh(scene, mesh);
            }
            // Create/update preview meshes
            for (let i = 0; i < tiles.length; i++) {
                if (i < state.previewMeshes.length) {
                    // Reposition existing mesh
                    state.previewMeshes[i].position.set(tiles[i].x + 0.5, DRAG_PREVIEW_Y, tiles[i].z + 0.5);
                } else {
                    // Create new preview mesh
                    const geo = new THREE.CircleGeometry(0.45, 16);
                    const mat = new THREE.MeshBasicMaterial({
                        color: DRAG_PREVIEW_COLOR,
                        transparent: true,
                        opacity: DRAG_PREVIEW_OPACITY,
                        side: THREE.DoubleSide
                    });
                    const mesh = new THREE.Mesh(geo, mat);
                    mesh.rotation.x = -Math.PI / 2;
                    mesh.position.set(tiles[i].x + 0.5, DRAG_PREVIEW_Y, tiles[i].z + 0.5);
                    mesh.name = "dragLinePreview";
                    scene.add(mesh);
                    state.previewMeshes.push(mesh);
                }
            }
        };

        // =============================================================================
        // MOUSE DOWN
        // =============================================================================
        const onMouseDown = (e: MouseEvent) => {
            if (e.button === 2) {
                // Right-click cancels drag-line targeting
                if (dragLineStateRef.current) {
                    clearDragLinePreview();
                }
                closeAllTooltips();
                mutableRefs.isDragging.current = true;
                mutableRefs.didPan.current = false;
                mutableRefs.lastMouse.current = { x: e.clientX, y: e.clientY };
            } else if (e.button === 0) {
                // Check if we're in drag-line targeting mode
                const targeting = stateRefs.targetingModeRef.current;
                if (targeting && targeting.skill.targetType === "drag_line") {
                    const rect = renderer.domElement.getBoundingClientRect();
                    mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
                    mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
                    raycaster.setFromCamera(mouse, camera);
                    for (const hit of raycaster.intersectObjects(rebuildInteractionRaycastRoots(), true)) {
                        if (hit.object.name !== "ground") continue;
                        const casterG = unitGroups[targeting.casterId];
                        if (!casterG) break;
                        const dist = distanceToPoint(casterG.position, hit.point.x, hit.point.z);
                        if (dist > targeting.skill.range) {
                            callbacks.addLog(`${stateRefs.unitsStateRef.current.find(u => u.id === targeting.casterId)?.team === "player" ? "Wizard" : "Caster"}: Target out of range!`, "#888");
                            break;
                        }
                        // Start drag
                        dragLineStateRef.current = {
                            startX: hit.point.x,
                            startZ: hit.point.z,
                            previewMeshes: []
                        };
                        // Create initial preview at start tile
                        updateDragLinePreview(hit.point.x, hit.point.z);
                        // Hide AOE indicator during drag (we show preview tiles instead)
                        if (aoeIndicator) aoeIndicator.visible = false;
                        break;
                    }
                    return; // Don't start box selection
                }

                const rect = renderer.domElement.getBoundingClientRect();
                mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
                mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
                raycaster.setFromCamera(mouse, camera);
                const hitUnit = raycaster.intersectObjects(rebuildUnitRaycastRoots(), true).length > 0;
                if (!hitUnit) {
                    mutableRefs.isBoxSel.current = true;
                    mutableRefs.boxStart.current = { x: e.clientX, y: e.clientY };
                    mutableRefs.boxEnd.current = { x: e.clientX, y: e.clientY };
                }
            }
        };

        // =============================================================================
        // MOUSE MOVE
        // =============================================================================
        const onMouseMove = (e: MouseEvent) => {
            if (mutableRefs.isDragging.current) {
                const dx = e.clientX - mutableRefs.lastMouse.current.x;
                const dy = e.clientY - mutableRefs.lastMouse.current.y;
                if (dx !== 0 || dy !== 0) mutableRefs.didPan.current = true;
                gameRefs.current.cameraOffset.x -= (dx + dy) * 0.03;
                gameRefs.current.cameraOffset.z -= (dy - dx) * 0.03;
                const area = getCurrentArea();
                gameRefs.current.cameraOffset.x = Math.max(0, Math.min(area.gridWidth, gameRefs.current.cameraOffset.x));
                gameRefs.current.cameraOffset.z = Math.max(0, Math.min(area.gridHeight, gameRefs.current.cameraOffset.z));
                mutableRefs.lastMouse.current = { x: e.clientX, y: e.clientY };
                updateCam();
            } else if (mutableRefs.isBoxSel.current) {
                mutableRefs.boxEnd.current = { x: e.clientX, y: e.clientY };
                const bw = Math.abs(mutableRefs.boxEnd.current.x - mutableRefs.boxStart.current.x);
                const bh = Math.abs(mutableRefs.boxEnd.current.y - mutableRefs.boxStart.current.y);
                if (bw > 12 || bh > 12) {
                    const rect = renderer.domElement.getBoundingClientRect();
                    setters.setSelBox({
                        left: Math.min(mutableRefs.boxStart.current.x, mutableRefs.boxEnd.current.x) - rect.left,
                        top: Math.min(mutableRefs.boxStart.current.y, mutableRefs.boxEnd.current.y) - rect.top,
                        width: bw,
                        height: bh
                    });
                } else {
                    setters.setSelBox(null);
                }
            }

            if (mutableRefs.isDragging.current || mutableRefs.isBoxSel.current) {
                return;
            }

            // Update drag-line preview during drag
            if (dragLineStateRef.current) {
                const rect = renderer.domElement.getBoundingClientRect();
                mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
                mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
                raycaster.setFromCamera(mouse, camera);
                for (const hit of raycaster.intersectObjects(rebuildInteractionRaycastRoots(), true)) {
                    if (hit.object.name !== "ground") continue;
                    updateDragLinePreview(hit.point.x, hit.point.z);
                    break;
                }
                return; // Don't process hover tooltips during drag
            }

            const hoverNow = performance.now();
            const rect = renderer.domElement.getBoundingClientRect();
            const projectTooltipPosition = (worldX: number, worldY: number, worldZ: number): { x: number; y: number } => {
                tooltipProjection.set(worldX, worldY, worldZ).project(camera);
                return {
                    x: rect.left + (tooltipProjection.x + 1) * rect.width * 0.5,
                    y: rect.top + (-tooltipProjection.y + 1) * rect.height * 0.5
                };
            };
            mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
            raycaster.setFromCamera(mouse, camera);
            const hoverRoots = hoverRaycastRootsRef.current;
            if (
                hoverRoots.length === 0
                || hoverNow - lastHoverRootsBuildRef.current >= HOVER_ROOT_REBUILD_INTERVAL_MS
            ) {
                hoverRoots.length = 0;
                for (const unitRoot of rebuildUnitRaycastRoots()) {
                    hoverRoots.push(unitRoot);
                }
                for (const interactionRoot of rebuildInteractionRaycastRoots()) {
                    hoverRoots.push(interactionRoot);
                }
                lastHoverRootsBuildRef.current = hoverNow;
            }
            const hits = raycaster.intersectObjects(hoverRoots, true);

            // Update AOE indicator position
            if (stateRefs.targetingModeRef.current && aoeIndicator) {
                for (const hit of hits) {
                    if (hit.object.name !== "ground") continue;
                    if (aoeIndicator.userData.isLine) {
                        // Line AOE: position at caster, rotate toward cursor
                        const casterG = unitGroups[stateRefs.targetingModeRef.current.casterId];
                        if (casterG) {
                            aoeIndicator.position.x = casterG.position.x;
                            aoeIndicator.position.z = casterG.position.z;
                            const angle = Math.atan2(
                                hit.point.z - casterG.position.z,
                                hit.point.x - casterG.position.x
                            );
                            aoeIndicator.rotation.z = -angle;
                        }
                    } else {
                        // Circular AOE: follow cursor
                        aoeIndicator.position.x = hit.point.x;
                        aoeIndicator.position.z = hit.point.z;
                    }
                    break;
                }
            }

            // Check for hovered objects

            let foundEnemy: { id: number; x: number; y: number } | null = null;
            let foundChest: { x: number; y: number; chestIndex: number; chestX: number; chestZ: number } | null = null;
            let foundPlayer: { id: number; x: number; y: number } | null = null;
            let foundDoor: { targetArea: string; x: number; y: number } | null = null;
            let foundSecretDoor: { x: number; y: number } | null = null;
            let foundLootBag: { x: number; y: number; gold: number; hasItems: boolean } | null = null;

            for (const hit of hits) {
                const unitId = hit.object.userData?.unitId;
                if (unitId !== undefined) {
                    const unit = getUnitById(unitId) ?? stateRefs.unitsStateRef.current.find(u => u.id === unitId);
                    if (unit && unit.hp > 0) {
                        if (unit.team === "enemy" || unit.team === "neutral") {
                            const g = unitGroups[unitId];
                            if (g) {
                                const cx = Math.floor(g.position.x);
                                const cz = Math.floor(g.position.z);
                                const vis = gameRefs.current.visibility[cx]?.[cz] ?? 0;
                                if (vis === 2) {
                                    const anchor = projectTooltipPosition(
                                        g.position.x,
                                        g.position.y + TOOLTIP_ENEMY_HEIGHT_OFFSET,
                                        g.position.z
                                    );
                                    foundEnemy = { id: unitId, x: anchor.x, y: anchor.y };
                                }
                            }
                        } else if (unit.team === "player") {
                            const g = unitGroups[unitId];
                            if (g) {
                                const anchor = projectTooltipPosition(
                                    g.position.x,
                                    g.position.y + TOOLTIP_PLAYER_HEIGHT_OFFSET,
                                    g.position.z
                                );
                                foundPlayer = { id: unitId, x: anchor.x, y: anchor.y };
                            }
                        }
                        break;
                    }
                }
                if (hit.object.name === "chest" && hit.object.userData?.chestIndex !== undefined) {
                    const { chestIndex, chestX, chestZ, chestDecorOnly } = hit.object.userData as ChestHitData;
                    if (chestDecorOnly) continue;
                    const anchor = projectTooltipPosition(chestX + 0.5, TOOLTIP_CHEST_HEIGHT, chestZ + 0.5);
                    foundChest = { x: anchor.x, y: anchor.y, chestIndex, chestX, chestZ };
                    break;
                }
                if (hit.object.name === "door") {
                    const transition = hit.object.userData?.transition as AreaTransition | undefined;
                    if (transition) {
                        const anchor = projectTooltipPosition(
                            transition.x + transition.w * 0.5,
                            TOOLTIP_DOOR_HEIGHT,
                            transition.z + transition.h * 0.5
                        );
                        foundDoor = { targetArea: transition.targetArea, x: anchor.x, y: anchor.y };
                    }
                    break;
                }
                if (hit.object.name === "secretDoor" && hit.object.userData?.secretDoor?.blockingWall) {
                    const blockingWall = (hit.object.userData as {
                        secretDoor?: { blockingWall?: { x: number; z: number; w: number; h: number } };
                    }).secretDoor?.blockingWall;
                    if (blockingWall) {
                        const anchor = projectTooltipPosition(
                            blockingWall.x + blockingWall.w * 0.5,
                            TOOLTIP_SECRET_DOOR_HEIGHT,
                            blockingWall.z + blockingWall.h * 0.5
                        );
                        foundSecretDoor = { x: anchor.x, y: anchor.y };
                    }
                    break;
                }
                if (hit.object.name === "lootBag" && hit.object.userData?.lootBagId !== undefined) {
                    const bagId = hit.object.userData.lootBagId;
                    const bag = gameRefs.current.lootBags.find(b => b.id === bagId);
                    if (bag) {
                        const anchor = projectTooltipPosition(bag.x, TOOLTIP_LOOT_BAG_HEIGHT, bag.z);
                        foundLootBag = {
                            x: anchor.x,
                            y: anchor.y,
                            gold: bag.gold,
                            hasItems: (bag.items?.length ?? 0) > 0
                        };
                    }
                    break;
                }
            }

            const previousEnemy = hoveredEnemyRef.current;
            if (
                previousEnemy?.id !== foundEnemy?.id
                || previousEnemy?.x !== foundEnemy?.x
                || previousEnemy?.y !== foundEnemy?.y
            ) {
                hoveredEnemyRef.current = foundEnemy;
                setters.setHoveredEnemy(foundEnemy);
            }

            const previousChest = hoveredChestRef.current;
            if (
                previousChest?.chestIndex !== foundChest?.chestIndex
                || previousChest?.chestX !== foundChest?.chestX
                || previousChest?.chestZ !== foundChest?.chestZ
                || previousChest?.x !== foundChest?.x
                || previousChest?.y !== foundChest?.y
            ) {
                hoveredChestRef.current = foundChest;
                setters.setHoveredChest(foundChest);
            }

            const previousPlayer = hoveredPlayerRef.current;
            if (
                previousPlayer?.id !== foundPlayer?.id
                || previousPlayer?.x !== foundPlayer?.x
                || previousPlayer?.y !== foundPlayer?.y
            ) {
                hoveredPlayerRef.current = foundPlayer;
                setters.setHoveredPlayer(foundPlayer);
            }

            const previousDoor = hoveredDoorRef.current;
            if (
                previousDoor?.targetArea !== foundDoor?.targetArea
                || previousDoor?.x !== foundDoor?.x
                || previousDoor?.y !== foundDoor?.y
            ) {
                hoveredDoorRef.current = foundDoor;
                setters.setHoveredDoor(foundDoor);
            }

            const previousSecretDoor = hoveredSecretDoorRef.current;
            if (
                previousSecretDoor?.x !== foundSecretDoor?.x
                || previousSecretDoor?.y !== foundSecretDoor?.y
            ) {
                hoveredSecretDoorRef.current = foundSecretDoor;
                setters.setHoveredSecretDoor(foundSecretDoor);
            }

            const previousLootBag = hoveredLootBagRef.current;
            if (
                previousLootBag?.x !== foundLootBag?.x
                || previousLootBag?.y !== foundLootBag?.y
                || previousLootBag?.gold !== foundLootBag?.gold
                || previousLootBag?.hasItems !== foundLootBag?.hasItems
            ) {
                hoveredLootBagRef.current = foundLootBag;
                setters.setHoveredLootBag(foundLootBag);
            }
        };

        // =============================================================================
        // MOUSE UP
        // =============================================================================
        const onMouseUp = (e: MouseEvent) => {
            // Complete drag-line targeting
            if (dragLineStateRef.current && e.button === 0) {
                const dragState = dragLineStateRef.current;
                const targeting = stateRefs.targetingModeRef.current;
                if (targeting) {
                    // Raycast to get final cursor position
                    const rect = renderer.domElement.getBoundingClientRect();
                    mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
                    mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
                    raycaster.setFromCamera(mouse, camera);
                    let endX = dragState.startX;
                    let endZ = dragState.startZ;
                    for (const hit of raycaster.intersectObjects(rebuildInteractionRaycastRoots(), true)) {
                        if (hit.object.name !== "ground") continue;
                        endX = hit.point.x;
                        endZ = hit.point.z;
                        break;
                    }

                    const maxTiles = targeting.skill.maxTiles ?? 5;
                    const tiles = computeDragLineTiles(dragState.startX, dragState.startZ, endX, endZ, maxTiles);
                    const skillCtx = callbacks.getSkillContext();

                    queueOrExecuteSkill(
                        targeting.casterId,
                        targeting.skill,
                        dragState.startX,
                        dragState.startZ,
                        { actionCooldownRef: mutableRefs.actionCooldownRef, actionQueueRef: mutableRefs.actionQueueRef, rangeIndicatorRef: { current: rangeIndicator }, aoeIndicatorRef: { current: aoeIndicator } },
                        { pausedRef: stateRefs.pausedRef },
                        { setTargetingMode: setters.setTargetingMode, setQueuedActions: setters.setQueuedActions },
                        skillCtx,
                        callbacks.addLog,
                        undefined,
                        tiles
                    );

                    dragLineExecutedAtRef.current = Date.now();
                }
                clearDragLinePreview();
                return;
            }

            if (mutableRefs.isBoxSel.current && !stateRefs.targetingModeRef.current) {
                const dx = Math.abs(mutableRefs.boxEnd.current.x - mutableRefs.boxStart.current.x);
                const dy = Math.abs(mutableRefs.boxEnd.current.y - mutableRefs.boxStart.current.y);
                if (dx > 12 || dy > 12) {
                    const rect = renderer.domElement.getBoundingClientRect();
                    const inBox = getUnitsInBox(
                        unitGroups, stateRefs.unitsStateRef.current, camera, rect,
                        mutableRefs.boxStart.current.x, mutableRefs.boxStart.current.y,
                        mutableRefs.boxEnd.current.x, mutableRefs.boxEnd.current.y
                    );
                    setters.setSelectedIds(e.shiftKey ? prev => [...new Set([...prev, ...inBox])] : inBox);
                } else {
                    const rect = renderer.domElement.getBoundingClientRect();
                    mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
                    mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
                    raycaster.setFromCamera(mouse, camera);
                    for (const h of raycaster.intersectObjects(rebuildInteractionRaycastRoots(), true)) {
                        if (h.object.name === "obstacle") continue;
                        if (h.object.name !== "ground") {
                            break;
                        }
                        if (stateRefs.selectedRef.current.length > 0) {
                            const gx = Math.floor(h.point.x) + 0.5;
                            const gz = Math.floor(h.point.z) + 0.5;
                            if (blocked[Math.floor(gx)]?.[Math.floor(gz)] || isTerrainBlocked(Math.floor(gx), Math.floor(gz))) {
                                showInvalidMoveIndicator(scene, gx, gz);
                                break;
                            }
                            if (moveMarker) {
                                moveMarker.position.set(gx, 0.05, gz);
                                moveMarker.visible = true;
                                (moveMarker.material as THREE.MeshBasicMaterial).opacity = 0.8;
                                gameRefs.current.moveMarkerStart = Date.now();
                            }
                            soundFns.playMove();
                            const isAttackMove = stateRefs.commandModeRef.current === "attackMove";
                            const moveTargets = buildMoveTargets(stateRefs.selectedRef.current, stateRefs.unitsStateRef.current, unitGroups, gx, gz, stateRefs.formationOrderRef.current);
                            // Row-based speed ramp: each unit crawls until the row
                            // ahead is in place, then snaps to full speed.
                            // Wedge rows: [0] | [1,2] | [3,4,5] | ...
                            // Row N starts at index N*(N+1)/2
                            const getRow = (i: number) => Math.floor((-1 + Math.sqrt(1 + 8 * i)) / 2);
                            const queueNow = Date.now();
                            moveTargets.forEach((t, i) => {
                                const unitG = unitGroups[t.id];
                                const directMove = unitG ? canUseDirectMove(unitG, t.x, t.z) : false;
                                const notBefore = t.delay > 0 ? queueNow + t.delay : undefined;
                                mutableRefs.actionQueueRef.current[t.id] = {
                                    type: "move",
                                    targetX: t.x,
                                    targetZ: t.z,
                                    direct: directMove,
                                    notBefore,
                                    attackMove: isAttackMove || undefined
                                };
                                if (unitG) {
                                    unitG.userData.attackTarget = null;
                                    unitG.userData.pendingMove = true;
                                    unitG.userData.moveTarget = { x: t.x, z: t.z };
                                    delete unitG.userData.formationRegroupAttempted;
                                    if (isAttackMove) {
                                        unitG.userData.attackMoveTarget = { x: t.x, z: t.z };
                                    } else {
                                        delete unitG.userData.attackMoveTarget;
                                    }
                                    const row = getRow(i);
                                    if (row > 0) {
                                        // Watch first unit of the previous row
                                        const prevRowStart = (row - 1) * row / 2;
                                        const ahead = moveTargets[prevRowStart];
                                        const aheadG = unitGroups[ahead.id];
                                        if (aheadG) {
                                            const leaderStartDist = Math.max(0.001, Math.hypot(ahead.x - aheadG.position.x, ahead.z - aheadG.position.z));
                                            const myStartDist = Math.max(0.001, Math.hypot(t.x - unitG.position.x, t.z - unitG.position.z));
                                            unitG.userData.formationRamp = {
                                                leaderId: ahead.id,
                                                leaderTargetX: ahead.x,
                                                leaderTargetZ: ahead.z,
                                                leaderStartDist,
                                                myStartDist,
                                            };
                                        } else {
                                            delete unitG.userData.formationRamp;
                                        }
                                    } else {
                                        delete unitG.userData.formationRamp;
                                    }
                                }
                            });
                            // Clear hold stance on move command
                            const moveIds = moveTargets.map(t => t.id);
                            setters.setUnits(prev => prev.map(u =>
                                moveIds.includes(u.id) && u.holdPosition ? { ...u, holdPosition: false } : u
                            ));
                            // Reset command mode after issuing the command
                            if (isAttackMove) {
                                setters.setCommandMode(null);
                            }
                            if (stateRefs.pausedRef.current) {
                                callbacks.addLog(`Move queued for ${moveTargets.length} unit${moveTargets.length !== 1 ? "s" : ""}.`, "#888");
                            }
                        }
                        break;
                    }
                }
                mutableRefs.isBoxSel.current = false;
                setters.setSelBox(null);
            }
            if (mutableRefs.isBoxSel.current) {
                mutableRefs.isBoxSel.current = false;
                setters.setSelBox(null);
            }
            mutableRefs.isDragging.current = false;
        };

        // =============================================================================
        // CLICK
        // =============================================================================
        const onClick = (e: MouseEvent) => {
            if (e.button !== 0) return;
            // Suppress click that follows a drag-line mouseup
            if (Date.now() - dragLineExecutedAtRef.current < 100) return;
            const rect = renderer.domElement.getBoundingClientRect();
            mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
            raycaster.setFromCamera(mouse, camera);

            const skillCtx = callbacks.getSkillContext();

            // Handle consumable targeting mode (dead units not in scene, cancel on click)
            if (stateRefs.consumableTargetingModeRef.current) {
                setters.setConsumableTargetingMode(null);
                return;
            }

            // Handle targeting mode
            if (stateRefs.targetingModeRef.current) {
                const targetingRaycastRoots = rebuildInteractionRaycastRoots();
                for (const unitRoot of rebuildUnitRaycastRoots()) {
                    targetingRaycastRoots.push(unitRoot);
                }
                for (const hit of raycaster.intersectObjects(targetingRaycastRoots, true)) {
                    if (handleTargetingClick(
                        hit,
                        stateRefs.targetingModeRef.current,
                        { actionCooldownRef: mutableRefs.actionCooldownRef, actionQueueRef: mutableRefs.actionQueueRef, rangeIndicatorRef: { current: rangeIndicator }, aoeIndicatorRef: { current: aoeIndicator } },
                        { unitsStateRef: stateRefs.unitsStateRef as React.RefObject<Unit[]>, pausedRef: stateRefs.pausedRef },
                        { setTargetingMode: setters.setTargetingMode, setQueuedActions: setters.setQueuedActions },
                        unitGroups, skillCtx, callbacks.addLog
                    )) return;
                }
                return;
            }

            // Check for interactable objects
            for (const h of raycaster.intersectObjects(rebuildInteractionRaycastRoots(), true)) {
                // Door click
                if (h.object.name === "door") {
                    const transition = h.object.userData?.transition as AreaTransition | undefined;
                    if (transition) {
                        const doorCenterX = transition.x + transition.w / 2;
                        const doorCenterZ = transition.z + transition.h / 2;
                        const doorRange = 8;
                        const alivePlayers = stateRefs.unitsStateRef.current.filter(u => u.team === "player" && u.hp > 0);
                        const allPlayersInRange = alivePlayers.every(player => {
                            const playerG = unitGroups[player.id];
                            if (!playerG) return false;
                            return isInRange(doorCenterX, doorCenterZ, playerG.position.x, playerG.position.z, getUnitRadius(player), doorRange);
                        });
                        if (allPlayersInRange) {
                            callbacks.handleAreaTransition(transition);
                        } else {
                            callbacks.addLog("You must gather your party before venturing forth.", "#f59e0b");
                        }
                        return;
                    }
                }

                // Chest click
                if (h.object.name === "chest" && h.object.userData?.chestIndex !== undefined) {
                    const chestData = h.object.userData as ChestHitData;
                    if (chestData.chestDecorOnly) {
                        continue;
                    }
                    handleChestClick(chestData, stateRefs, unitGroups, setters, callbacks);
                    return;
                }

                // Loot bag click
                if (h.object.name === "lootBag" && h.object.userData?.lootBagId !== undefined) {
                    const lootBagData = h.object.userData as { lootBagId: number; lootBagX: number; lootBagZ: number };
                    handleLootBagClick(lootBagData, scene, stateRefs, unitGroups, setters, callbacks, gameRefs);
                    return;
                }

                // Secret door click
                if (h.object.name === "secretDoor" && h.object.userData?.secretDoorIndex !== undefined) {
                    const secretDoorData = h.object.userData as { secretDoor: { hint?: string; blockingWall: { x: number; z: number; w: number; h: number }; x: number; z: number }; secretDoorIndex: number };
                    handleSecretDoorClick(secretDoorData, scene, secretDoorMeshes, stateRefs, unitGroups, setters, callbacks);
                    return;
                }
            }

            // Unit click (selection/attack)
            for (const h of raycaster.intersectObjects(rebuildUnitRaycastRoots(), true)) {
                let o: THREE.Object3D | null = h.object;
                while (o) {
                    if (o.userData.unitId !== undefined) {
                        const id = o.userData.unitId as number;
                        const clickedUnit = stateRefs.unitsStateRef.current.find(u => u.id === id);
                        if (
                            clickedUnit
                            && clickedUnit.team === "neutral"
                            && clickedUnit.hp > 0
                        ) {
                            const npcGroup = unitGroups[id];
                            if (!npcGroup) return;
                            const playerNearby = isAnyAlivePlayerWithinRange(
                                stateRefs.unitsStateRef,
                                unitGroups,
                                npcGroup.position.x,
                                npcGroup.position.z,
                                NPC_ENGAGE_RANGE
                            );
                            if (!playerNearby) {
                                callbacks.addLog("You need to get closer to speak to them.", "#f59e0b");
                                return;
                            }
                            callbacks.onNpcEngaged(id);
                            return;
                        }
                        if (
                            clickedUnit
                            && clickedUnit.team === "enemy"
                            && clickedUnit.hp > 0
                            && !isEnemyUntargetable(clickedUnit.id)
                            && stateRefs.selectedRef.current.length > 0
                        ) {
                            handleEnemyClick(clickedUnit, unitGroups, targetRings, gameRefs, stateRefs, mutableRefs, setters, callbacks, skillCtx);
                            return;
                        } else if (clickedUnit && clickedUnit.team === "player") {
                            setters.setSelectedIds(e.shiftKey ? prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id] : [id]);
                            return;
                        }
                    }
                    o = o.parent;
                }
            }
        };

        // =============================================================================
        // KEYBOARD
        // =============================================================================
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.code === "Space") {
                e.preventDefault();
                if (stateRefs.pauseToggleLockedRef.current && stateRefs.pausedRef.current) {
                    return;
                }
                togglePause(
                    {
                        pauseStartTimeRef: stateRefs.pauseStartTimeRef,
                        actionCooldownRef: mutableRefs.actionCooldownRef,
                        actionQueueRef: mutableRefs.actionQueueRef,
                        moveStartRef: { current: gameRefs.current.moveStart }
                    },
                    { pausedRef: stateRefs.pausedRef },
                    { setPaused: setters.setPaused, setSkillCooldowns: setters.setSkillCooldowns },
                    callbacks.processActionQueue
                );
            }
            if (e.code === "Escape") {
                if (dragLineStateRef.current) {
                    clearDragLinePreview();
                }
                if (stateRefs.commandModeRef?.current) {
                    setters.setCommandMode(null);
                } else if (stateRefs.consumableTargetingModeRef.current) {
                    setters.setConsumableTargetingMode(null);
                } else if (stateRefs.targetingModeRef.current) {
                    clearTargetingMode(setters.setTargetingMode, { current: rangeIndicator }, { current: aoeIndicator });
                } else if (stateRefs.infoModalOpenRef.current) {
                    callbacks.onCloseInfoModal();
                } else if (stateRefs.showPanelRef.current) {
                    setters.setShowPanel(false);
                } else if (stateRefs.selectedRef.current.length > 0) {
                    setters.setSelectedIds([]);
                }
            }
            if (["Digit1", "Digit2", "Digit3", "Digit4", "Digit5"].includes(e.code)) {
                const slotIndex = parseInt(e.code.charAt(5)) - 1;
                const selected = stateRefs.selectedRef.current;
                if (selected.length === 1) {
                    const unitId = selected[0];
                    const slots = stateRefs.hotbarAssignmentsRef.current[unitId] || [null, null, null, null, null];
                    const skillName = slots[slotIndex];
                    if (skillName) {
                        const unit = stateRefs.unitsStateRef.current.find(u => u.id === unitId);
                        const skills = getAllSkills(unitId, unit);
                        const skill = skills.find(s => s.name === skillName);
                        if (skill) callbacks.handleCastSkillRef.current?.(unitId, skill);
                    }
                }
            }
            if (["F1", "F2", "F3", "F4", "F5", "F6"].includes(e.code)) {
                e.preventDefault();
                const slotIndex = parseInt(e.code.charAt(1)) - 1;
                const playerUnits = stateRefs.unitsStateRef.current.filter(u => u.team === "player" && isCorePlayerId(u.id));
                const playerIds = playerUnits.map(u => u.id);
                const effective = buildEffectiveFormationOrder(playerIds, stateRefs.formationOrderRef.current);
                const unitId = effective[slotIndex];
                if (unitId !== undefined) {
                    const unit = playerUnits.find(u => u.id === unitId);
                    if (unit && unit.hp > 0) {
                        setters.setSelectedIds([unitId]);
                    }
                }
            }
            // Command hotkeys (S=stop, H=hold, A=attack-move, M=move)
            if (e.code === "KeyS" && !stateRefs.targetingModeRef.current) {
                stopSelectedUnits({
                    selectedIds: stateRefs.selectedRef.current,
                    unitGroups,
                    pathsRef: gameRefs.current.paths,
                    actionQueueRef: mutableRefs.actionQueueRef.current,
                    setQueuedActions: setters.setQueuedActions,
                    setUnits: setters.setUnits
                });
            }
            if (e.code === "KeyH" && !stateRefs.targetingModeRef.current) {
                toggleHoldPositionForSelectedUnits(
                    {
                        selectedIds: stateRefs.selectedRef.current,
                        unitGroups,
                        pathsRef: gameRefs.current.paths,
                        actionQueueRef: mutableRefs.actionQueueRef.current,
                        setQueuedActions: setters.setQueuedActions,
                        setUnits: setters.setUnits
                    },
                    stateRefs.unitsStateRef.current
                );
            }
            if (e.code === "KeyA" && !stateRefs.targetingModeRef.current) {
                if (stateRefs.selectedRef.current.length > 0) {
                    setters.setCommandMode("attackMove");
                }
            }
            if (e.code === "KeyM" && !stateRefs.targetingModeRef.current) {
                setters.setCommandMode(null);
            }
            if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) {
                mutableRefs.keysPressed.current.add(e.code);
            }
        };

        const onKeyUp = (e: KeyboardEvent) => { mutableRefs.keysPressed.current.delete(e.code); };

        // =============================================================================
        // WHEEL & CONTEXT MENU & RESIZE
        // =============================================================================
        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            gameRefs.current.zoomLevel = Math.max(5, Math.min(30, gameRefs.current.zoomLevel + e.deltaY * 0.01));
            const aspect = containerRef.current!.clientWidth / containerRef.current!.clientHeight;
            camera.left = -gameRefs.current.zoomLevel * aspect;
            camera.right = gameRefs.current.zoomLevel * aspect;
            camera.top = gameRefs.current.zoomLevel;
            camera.bottom = -gameRefs.current.zoomLevel;
            camera.updateProjectionMatrix();
        };

        const onContextMenu = (e: MouseEvent) => {
            e.preventDefault();
            if (mutableRefs.didPan.current) return;
            if (stateRefs.consumableTargetingModeRef.current) {
                setters.setConsumableTargetingMode(null);
            } else if (stateRefs.targetingModeRef.current) {
                clearTargetingMode(setters.setTargetingMode, { current: rangeIndicator }, { current: aoeIndicator });
            }
        };

        const onResize = () => {
            if (!containerRef.current) return;
            const w = containerRef.current.clientWidth, h = containerRef.current.clientHeight, a = w / h;
            camera.left = -gameRefs.current.zoomLevel * a;
            camera.right = gameRefs.current.zoomLevel * a;
            camera.top = gameRefs.current.zoomLevel;
            camera.bottom = -gameRefs.current.zoomLevel;
            camera.updateProjectionMatrix();
            renderer.setSize(w, h);
        };

        // Attach listeners
        renderer.domElement.addEventListener("click", onClick);
        renderer.domElement.addEventListener("mousedown", onMouseDown);
        window.addEventListener("mousemove", onMouseMove);
        window.addEventListener("mouseup", onMouseUp);
        renderer.domElement.addEventListener("contextmenu", onContextMenu);
        renderer.domElement.addEventListener("wheel", onWheel, { passive: false });
        window.addEventListener("keydown", onKeyDown);
        window.addEventListener("keyup", onKeyUp);
        window.addEventListener("resize", onResize);

        return () => {
            renderer.domElement.removeEventListener("click", onClick);
            renderer.domElement.removeEventListener("mousedown", onMouseDown);
            window.removeEventListener("mousemove", onMouseMove);
            window.removeEventListener("mouseup", onMouseUp);
            renderer.domElement.removeEventListener("contextmenu", onContextMenu);
            renderer.domElement.removeEventListener("wheel", onWheel);
            window.removeEventListener("keydown", onKeyDown);
            window.removeEventListener("keyup", onKeyUp);
            window.removeEventListener("resize", onResize);
        };
    }, [sceneRefs, containerRef, gameRefs, stateRefs, mutableRefs, setters, callbacks]);
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function isAnyAlivePlayerWithinRange(
    unitsStateRef: React.MutableRefObject<Unit[]>,
    unitGroups: Record<number, UnitGroup>,
    centerX: number,
    centerZ: number,
    range: number
): boolean {
    for (const unit of unitsStateRef.current) {
        if (unit.team !== "player" || unit.hp <= 0) continue;
        const playerG = unitGroups[unit.id];
        if (!playerG) continue;
        if (isInRange(centerX, centerZ, playerG.position.x, playerG.position.z, getUnitRadius(unit), range)) {
            return true;
        }
    }
    return false;
}

function formatLootLabel(name: string, quantity: number = 1): string {
    return quantity > 1 ? `${quantity}x ${name}` : name;
}

function handleChestClick(
    userData: ChestHitData,
    stateRefs: InputStateRefs,
    unitGroups: Record<number, UnitGroup>,
    setters: InputSetters,
    callbacks: InputCallbacks
): void {
    const { chestIndex, chestX, chestZ } = userData;
    const area = getCurrentArea();
    const chestKey = `${area.id}-${chestIndex}`;

    if (stateRefs.openedChestsRef.current.has(chestKey)) {
        callbacks.addLog("This chest is empty.", "#888");
        return;
    }

    const chestRange = 3.5;
    const playerNearby = isAnyAlivePlayerWithinRange(
        stateRefs.unitsStateRef,
        unitGroups,
        chestX,
        chestZ,
        chestRange
    );

    if (!playerNearby) {
        callbacks.addLog("You need to get closer to open this chest.", "#f59e0b");
        return;
    }

    const chest = area.chests[chestIndex];
    if (!chest) return;
    if (chest.decorOnly) return;

    const chestGold = chest.gold ?? 0;
    const lootEntries: LootPickupEntry[] = [];
    const lootMessages: string[] = [];
    let keyItemIdToConsume: string | null = null;
    let keyItemName = "key";

    if (chest.locked && chest.requiredKeyId) {
        const inventory = getPartyInventory();
        const keyEntry = inventory.items.find(entry => {
            const item = getItem(entry.itemId);
            return item && isKey(item) && item.keyId === chest.requiredKeyId;
        });
        if (!keyEntry) {
            callbacks.addLog("This chest is locked. You need the right key.", "#ef4444");
            return;
        }
        keyItemIdToConsume = keyEntry.itemId;
        keyItemName = getItem(keyEntry.itemId)?.name ?? "key";
    }

    if (chestGold > 0) {
        const goldLabel = `${chestGold} gold`;
        lootEntries.push({ label: goldLabel, tone: "gold" });
        lootMessages.push(goldLabel);
    }

    for (const content of chest.contents) {
        const item = getItem(content.itemId);
        if (item) {
            const itemLabel = formatLootLabel(item.name, content.quantity);
            lootEntries.push({ label: itemLabel, tone: "item", itemId: content.itemId });
            lootMessages.push(itemLabel);
        }
    }

    const applyChestLoot = (): void => {
        let currentInventory = getPartyInventory();

        if (keyItemIdToConsume) {
            currentInventory = removeFromInventory(currentInventory, keyItemIdToConsume, 1);
            callbacks.addLog(`Used ${keyItemName} to unlock the chest.`, "#f59e0b");
        }

        if (chestGold > 0) {
            setters.setGold(prev => prev + chestGold);
        }

        for (const content of chest.contents) {
            const item = getItem(content.itemId);
            if (item) {
                currentInventory = addToInventory(currentInventory, content.itemId, content.quantity);
            }
        }

        setPartyInventory(currentInventory);
        setters.setOpenedChests(prev => new Set([...prev, chestKey]));

        callbacks.addLog(
            lootMessages.length > 0 ? `Found: ${lootMessages.join(", ")}` : "The chest was empty.",
            lootMessages.length > 0 ? "#4ade80" : "#888"
        );
        soundFns.playAttack();
    };

    if (lootEntries.length === 0) {
        applyChestLoot();
        return;
    }

    callbacks.openLootPickupModal({
        sourceLabel: "Chest",
        entries: lootEntries,
        onTake: applyChestLoot
    });
}

function handleLootBagClick(
    userData: { lootBagId: number; lootBagX: number; lootBagZ: number },
    scene: THREE.Scene,
    stateRefs: InputStateRefs,
    unitGroups: Record<number, UnitGroup>,
    setters: InputSetters,
    callbacks: InputCallbacks,
    gameRefs: React.MutableRefObject<InputGameRefs>
): void {
    const { lootBagId, lootBagX, lootBagZ } = userData;
    const bagIndex = gameRefs.current.lootBags.findIndex(b => b.id === lootBagId);
    if (bagIndex === -1) return;

    const lootRange = 3.5;
    const playerNearby = isAnyAlivePlayerWithinRange(
        stateRefs.unitsStateRef,
        unitGroups,
        lootBagX,
        lootBagZ,
        lootRange
    );

    if (!playerNearby) {
        callbacks.addLog("You need to get closer to open this.", "#f59e0b");
        return;
    }

    const bag = gameRefs.current.lootBags[bagIndex];
    const lootMessages: string[] = [];
    const lootEntries: LootPickupEntry[] = [];
    const bagItems = bag.items ?? [];
    const itemCounts = new Map<string, number>();

    if (bag.gold > 0) {
        const goldLabel = `${bag.gold} gold`;
        lootEntries.push({ label: goldLabel, tone: "gold" });
        lootMessages.push(goldLabel);
    }

    for (const itemId of bagItems) {
        itemCounts.set(itemId, (itemCounts.get(itemId) ?? 0) + 1);
    }

    for (const [itemId, quantity] of itemCounts) {
        const item = getItem(itemId);
        const itemName = item?.name ?? itemId;
        const itemLabel = formatLootLabel(itemName, quantity);
        lootEntries.push({ label: itemLabel, tone: "item", itemId });
        lootMessages.push(itemLabel);
    }

    const applyLootBagLoot = (): void => {
        if (bag.gold > 0) {
            setters.setGold(prev => prev + bag.gold);
        }

        if (bagItems.length > 0) {
            let inventory = getPartyInventory();

            for (const itemId of bagItems) {
                inventory = addToInventory(inventory, itemId, 1);
            }
            setPartyInventory(inventory);
        }

        callbacks.addLog(
            lootMessages.length > 0 ? `Found: ${lootMessages.join(", ")}` : "The bag was empty.",
            lootMessages.length > 0 ? "#ffd700" : "#888"
        );

        removeLootBag(scene, bag);
        gameRefs.current.lootBags.splice(bagIndex, 1);
        soundFns.playGold();
    };

    if (lootEntries.length === 0) {
        applyLootBagLoot();
        return;
    }

    callbacks.openLootPickupModal({
        sourceLabel: "Looted Corpse",
        entries: lootEntries,
        onTake: applyLootBagLoot
    });
}

function handleSecretDoorClick(
    userData: { secretDoor: { hint?: string; blockingWall: { x: number; z: number; w: number; h: number }; x: number; z: number }; secretDoorIndex: number },
    scene: THREE.Scene,
    secretDoorMeshes: SecretDoorMesh[],
    stateRefs: InputStateRefs,
    unitGroups: Record<number, UnitGroup>,
    setters: InputSetters,
    callbacks: InputCallbacks
): void {
    const { secretDoor, secretDoorIndex } = userData;
    const area = getCurrentArea();
    const secretDoorKey = `${area.id}-secret-${secretDoorIndex}`;

    const meshGroup = secretDoorMeshes[secretDoorIndex];
    if (!meshGroup || !meshGroup.parent) {
        callbacks.addLog("The passage is already open.", "#888");
        return;
    }

    const doorRange = 3.5;
    const crackTileX = secretDoor.blockingWall.x + Math.floor((secretDoor.blockingWall.w - 1) / 2);
    const crackTileZ = secretDoor.blockingWall.z + Math.floor((secretDoor.blockingWall.h - 1) / 2);
    const crackCenterX = crackTileX + 0.5;
    const crackCenterZ = crackTileZ + 0.5;
    const playerNearby = isAnyAlivePlayerWithinRange(
        stateRefs.unitsStateRef,
        unitGroups,
        crackCenterX,
        crackCenterZ,
        doorRange
    );

    if (!playerNearby) {
        callbacks.addLog("You need to get closer to inspect this.", "#f59e0b");
        return;
    }

    if (secretDoor.hint) callbacks.addLog(secretDoor.hint, "#4ade80");

    setters.setOpenedSecretDoors(prev => new Set([...prev, secretDoorKey]));
    scene.remove(meshGroup);

    const wallX = Math.floor(secretDoor.blockingWall.x);
    const wallZ = Math.floor(secretDoor.blockingWall.z);
    const wallW = Math.max(1, Math.floor(secretDoor.blockingWall.w));
    const wallH = Math.max(1, Math.floor(secretDoor.blockingWall.h));
    const blockedGrid = getBlocked();
    for (let x = wallX; x < wallX + wallW; x++) {
        for (let z = wallZ; z < wallZ + wallH; z++) {
            if (x >= 0 && x < blockedGrid.length && z >= 0 && z < blockedGrid[0].length) {
                blockedGrid[x][z] = false;
            }
        }
    }

    clearPathCache();
    soundFns.playSecretDiscovered();
}

function handleEnemyClick(
    clickedUnit: Unit,
    unitGroups: Record<number, UnitGroup>,
    targetRings: Record<number, THREE.Mesh>,
    gameRefs: React.MutableRefObject<InputGameRefs>,
    stateRefs: InputStateRefs,
    mutableRefs: InputMutableRefs,
    setters: InputSetters,
    callbacks: InputCallbacks,
    skillCtx: SkillExecutionContext
): void {
    if (isEnemyUntargetable(clickedUnit.id)) {
        callbacks.addLog("Target cannot be targeted right now.", "#888");
        return;
    }

    const targetId = clickedUnit.id;
    const targetG = unitGroups[targetId];
    const targetRing = targetRings[targetId];

    if (targetRing) {
        targetRing.visible = true;
        (targetRing.material as THREE.MeshBasicMaterial).opacity = 1;
        gameRefs.current.targetRingTimers[targetId] = Date.now();
    }

    stateRefs.selectedRef.current.forEach(uid => {
        const casterG = unitGroups[uid];
        if (casterG) {
            casterG.userData.attackTarget = targetId;
            gameRefs.current.paths[uid] = [];
            if (targetG) {
                const basicAttack = getBasicAttackSkill(uid);
                queueOrExecuteSkill(
                    uid, basicAttack, targetG.position.x, targetG.position.z,
                    { actionCooldownRef: mutableRefs.actionCooldownRef, actionQueueRef: mutableRefs.actionQueueRef, rangeIndicatorRef: { current: null }, aoeIndicatorRef: { current: null } },
                    { pausedRef: stateRefs.pausedRef },
                    { setTargetingMode: setters.setTargetingMode, setQueuedActions: setters.setQueuedActions },
                    skillCtx, callbacks.addLog, targetId
                );
            }
        }
    });

    setters.setUnits(prev => prev.map(u => stateRefs.selectedRef.current.includes(u.id) ? { ...u, target: targetId } : u));
    soundFns.playAttack();
}

