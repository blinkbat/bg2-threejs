/**
 * Hook for handling all input events (mouse, keyboard, wheel)
 * Extracts input handling logic from App.tsx for better organization
 */

import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { Unit, Skill, UnitGroup, SelectionBox } from "../core/types";
import type { SecretDoorMesh } from "../rendering/scene";
import type { LootBag } from "../core/types";
import { updateCamera } from "../rendering/scene";
import { blocked } from "../game/dungeon";
import { getCurrentArea, getBlocked, isTerrainBlocked, type AreaTransition } from "../game/areas";
import { getBasicAttackSkill, getAllSkills } from "../game/playerUnits";
import { getItem } from "../game/items";
import { isKey } from "../core/types";
import { soundFns } from "../audio";
import { clearPathCache } from "../ai/pathfinding";
import { removeLootBag } from "../gameLoop";
import {
    togglePause,
    getUnitsInBox,
    buildMoveTargets,
    handleTargetingClick,
    queueOrExecuteSkill,
    type ActionQueue
} from "../input";
import { clearTargetingMode, type SkillExecutionContext } from "../combat/skills";
import { getPartyInventory, setPartyInventory } from "../game/equipmentState";
import { removeFromInventory, addToInventory } from "../game/equipment";
import type { HotbarAssignments } from "../components/SkillHotbar";

// =============================================================================
// TYPES
// =============================================================================

export interface InputSceneRefs {
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
    paths: Record<number, { x: number; z: number }[]>;
    actionCooldown: Record<number, number>;
    visibility: number[][];
    lootBags: LootBag[];
}

export interface InputStateRefs {
    unitsStateRef: React.MutableRefObject<Unit[]>;
    selectedRef: React.MutableRefObject<number[]>;
    pausedRef: React.MutableRefObject<boolean>;
    targetingModeRef: React.MutableRefObject<{ casterId: number; skill: Skill } | null>;
    consumableTargetingModeRef: React.MutableRefObject<{ userId: number; itemId: string } | null>;
    showPanelRef: React.MutableRefObject<boolean>;
    helpOpenRef: React.MutableRefObject<boolean>;
    openedChestsRef: React.MutableRefObject<Set<string>>;
    hotbarAssignmentsRef: React.MutableRefObject<HotbarAssignments>;
    pauseStartTimeRef: React.MutableRefObject<number | null>;
    formationOrderRef: React.MutableRefObject<number[]>;
}

export interface InputMutableRefs {
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

export interface InputSetters {
    setSelectedIds: React.Dispatch<React.SetStateAction<number[]>>;
    setSelBox: React.Dispatch<React.SetStateAction<SelectionBox | null>>;
    setUnits: React.Dispatch<React.SetStateAction<Unit[]>>;
    setPaused: React.Dispatch<React.SetStateAction<boolean>>;
    setTargetingMode: React.Dispatch<React.SetStateAction<{ casterId: number; skill: Skill } | null>>;
    setConsumableTargetingMode: React.Dispatch<React.SetStateAction<{ userId: number; itemId: string } | null>>;
    setSkillCooldowns: React.Dispatch<React.SetStateAction<Record<string, { end: number; duration: number }>>>;
    setQueuedActions: React.Dispatch<React.SetStateAction<{ unitId: number; skillName: string }[]>>;
    setShowPanel: React.Dispatch<React.SetStateAction<boolean>>;
    setHoveredEnemy: React.Dispatch<React.SetStateAction<{ id: number; x: number; y: number } | null>>;
    setHoveredChest: React.Dispatch<React.SetStateAction<{ x: number; y: number; chestIndex: number; chestX: number; chestZ: number } | null>>;
    setHoveredPlayer: React.Dispatch<React.SetStateAction<{ id: number; x: number; y: number } | null>>;
    setHoveredDoor: React.Dispatch<React.SetStateAction<{ targetArea: string; x: number; y: number } | null>>;
    setHoveredSecretDoor: React.Dispatch<React.SetStateAction<{ x: number; y: number } | null>>;
    setHoveredLootBag: React.Dispatch<React.SetStateAction<{ x: number; y: number; gold: number } | null>>;
    setOpenedChests: React.Dispatch<React.SetStateAction<Set<string>>>;
    setOpenedSecretDoors: React.Dispatch<React.SetStateAction<Set<string>>>;
    setGold: React.Dispatch<React.SetStateAction<number>>;
}

export interface InputCallbacks {
    addLog: (text: string, color?: string) => void;
    getSkillContext: (defeatedThisFrame?: Set<number>) => SkillExecutionContext;
    handleAreaTransition: (transition: AreaTransition) => void;
    onCloseHelp: () => void;
    processActionQueue: (defeatedThisFrame: Set<number>) => void;
    handleCastSkillRef: React.MutableRefObject<((unitId: number, skill: Skill) => void) | null>;
}

export interface UseInputHandlersOptions {
    containerRef: React.RefObject<HTMLDivElement | null>;
    sceneRefs: InputSceneRefs | null;
    gameRefs: React.MutableRefObject<InputGameRefs>;
    stateRefs: InputStateRefs;
    mutableRefs: InputMutableRefs;
    setters: InputSetters;
    callbacks: InputCallbacks;
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

    useEffect(() => {
        if (!sceneRefs || !containerRef.current) return;

        const { scene, camera, renderer, unitGroups, targetRings, moveMarker, rangeIndicator, aoeIndicator, secretDoorMeshes } = sceneRefs;
        const raycaster = raycasterRef.current;
        const mouse = mouseRef.current;

        const updateCam = () => updateCamera(camera, gameRefs.current.cameraOffset);

        // =============================================================================
        // MOUSE DOWN
        // =============================================================================
        const onMouseDown = (e: MouseEvent) => {
            if (e.button === 2) {
                mutableRefs.isDragging.current = true;
                mutableRefs.didPan.current = false;
                mutableRefs.lastMouse.current = { x: e.clientX, y: e.clientY };
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
                const rect = renderer.domElement.getBoundingClientRect();
                setters.setSelBox({
                    left: Math.min(mutableRefs.boxStart.current.x, mutableRefs.boxEnd.current.x) - rect.left,
                    top: Math.min(mutableRefs.boxStart.current.y, mutableRefs.boxEnd.current.y) - rect.top,
                    width: Math.abs(mutableRefs.boxEnd.current.x - mutableRefs.boxStart.current.x),
                    height: Math.abs(mutableRefs.boxEnd.current.y - mutableRefs.boxStart.current.y)
                });
            }

            // Update AOE indicator position
            if (stateRefs.targetingModeRef.current && aoeIndicator) {
                const rect = renderer.domElement.getBoundingClientRect();
                mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
                mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
                raycaster.setFromCamera(mouse, camera);
                for (const hit of raycaster.intersectObjects(scene.children, true)) {
                    if (hit.object.name === "ground") {
                        aoeIndicator.position.x = hit.point.x;
                        aoeIndicator.position.z = hit.point.z;
                        break;
                    }
                }
            }

            // Check for hovered objects
            const rect = renderer.domElement.getBoundingClientRect();
            mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
            raycaster.setFromCamera(mouse, camera);

            let foundEnemy: { id: number; x: number; y: number } | null = null;
            let foundChest: { x: number; y: number; chestIndex: number; chestX: number; chestZ: number } | null = null;
            let foundPlayer: { id: number; x: number; y: number } | null = null;

            for (const hit of raycaster.intersectObjects(scene.children, true)) {
                const unitId = hit.object.userData?.unitId;
                if (unitId !== undefined) {
                    const unit = stateRefs.unitsStateRef.current.find(u => u.id === unitId);
                    if (unit && unit.hp > 0) {
                        if (unit.team === "enemy") {
                            const g = unitGroups[unitId];
                            if (g) {
                                const cx = Math.floor(g.position.x);
                                const cz = Math.floor(g.position.z);
                                const vis = gameRefs.current.visibility[cx]?.[cz] ?? 0;
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
                if (hit.object.name === "chest" && hit.object.userData?.chestIndex !== undefined) {
                    const { chestIndex, chestX, chestZ } = hit.object.userData;
                    foundChest = { x: e.clientX, y: e.clientY, chestIndex, chestX, chestZ };
                    break;
                }
                if (hit.object.name === "door") {
                    const transition = hit.object.userData?.transition as AreaTransition | undefined;
                    if (transition) {
                        setters.setHoveredDoor({ targetArea: transition.targetArea, x: e.clientX, y: e.clientY });
                    }
                    break;
                }
                if (hit.object.name === "secretDoor") {
                    setters.setHoveredSecretDoor({ x: e.clientX, y: e.clientY });
                    break;
                }
                if (hit.object.name === "lootBag" && hit.object.userData?.lootBagId !== undefined) {
                    const bagId = hit.object.userData.lootBagId;
                    const bag = gameRefs.current.lootBags.find(b => b.id === bagId);
                    if (bag) {
                        setters.setHoveredLootBag({ x: e.clientX, y: e.clientY, gold: bag.gold });
                    }
                    break;
                }
            }

            setters.setHoveredEnemy(foundEnemy);
            setters.setHoveredChest(foundChest);
            setters.setHoveredPlayer(foundPlayer);

            const hits = raycaster.intersectObjects(scene.children, true);
            if (!hits.some(h => h.object.name === "door")) setters.setHoveredDoor(null);
            if (!hits.some(h => h.object.name === "secretDoor")) setters.setHoveredSecretDoor(null);
            if (!hits.some(h => h.object.name === "lootBag")) setters.setHoveredLootBag(null);
        };

        // =============================================================================
        // MOUSE UP
        // =============================================================================
        const onMouseUp = (e: MouseEvent) => {
            if (mutableRefs.isBoxSel.current && !stateRefs.targetingModeRef.current) {
                const dx = Math.abs(mutableRefs.boxEnd.current.x - mutableRefs.boxStart.current.x);
                const dy = Math.abs(mutableRefs.boxEnd.current.y - mutableRefs.boxStart.current.y);
                if (dx > 5 || dy > 5) {
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
                    for (const h of raycaster.intersectObjects(scene.children, true)) {
                        if (h.object.name === "obstacle") continue;
                        if (h.object.name === "ground" && stateRefs.selectedRef.current.length > 0) {
                            const gx = Math.floor(h.point.x) + 0.5;
                            const gz = Math.floor(h.point.z) + 0.5;
                            if (blocked[Math.floor(gx)]?.[Math.floor(gz)] || isTerrainBlocked(Math.floor(gx), Math.floor(gz))) break;
                            if (moveMarker) {
                                moveMarker.position.set(gx, 0.05, gz);
                                moveMarker.visible = true;
                                (moveMarker.material as THREE.MeshBasicMaterial).opacity = 0.8;
                                gameRefs.current.moveMarkerStart = Date.now();
                            }
                            soundFns.playMove();
                            const moveTargets = buildMoveTargets(stateRefs.selectedRef.current, stateRefs.unitsStateRef.current, unitGroups, gx, gz, stateRefs.formationOrderRef.current);
                            const useDirectMove = moveTargets.length > 1;
                            const moveNow = Date.now();
                            moveTargets.forEach(t => {
                                const notBefore = t.delay ? moveNow + t.delay : undefined;
                                mutableRefs.actionQueueRef.current[t.id] = { type: "move", targetX: t.x, targetZ: t.z, direct: useDirectMove, notBefore };
                                // Clear attack target immediately so delayed rows don't keep
                                // fighting while waiting for their notBefore to arrive
                                if (unitGroups[t.id]) {
                                    unitGroups[t.id].userData.attackTarget = null;
                                    unitGroups[t.id].userData.pendingMove = true;
                                }
                            });
                            if (stateRefs.pausedRef.current) {
                                callbacks.addLog(`Move queued for ${moveTargets.length} unit${moveTargets.length !== 1 ? "s" : ""}.`, "#888");
                            }
                            break;
                        }
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
                for (const hit of raycaster.intersectObjects(scene.children, true)) {
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
            for (const h of raycaster.intersectObjects(scene.children, true)) {
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
                            const dx = playerG.position.x - doorCenterX;
                            const dz = playerG.position.z - doorCenterZ;
                            return Math.sqrt(dx * dx + dz * dz) <= doorRange;
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
                    const chestData = h.object.userData as { chestIndex: number; chestX: number; chestZ: number };
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
            for (const h of raycaster.intersectObjects(scene.children, true)) {
                let o: THREE.Object3D | null = h.object;
                while (o) {
                    if (o.userData.unitId !== undefined) {
                        const id = o.userData.unitId as number;
                        const clickedUnit = stateRefs.unitsStateRef.current.find(u => u.id === id);
                        if (clickedUnit && clickedUnit.team === "enemy" && clickedUnit.hp > 0 && stateRefs.selectedRef.current.length > 0) {
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
                togglePause(
                    { pauseStartTimeRef: stateRefs.pauseStartTimeRef, actionCooldownRef: mutableRefs.actionCooldownRef },
                    { pausedRef: stateRefs.pausedRef },
                    { setPaused: setters.setPaused, setSkillCooldowns: setters.setSkillCooldowns },
                    callbacks.processActionQueue
                );
            }
            if (e.code === "Escape") {
                if (stateRefs.consumableTargetingModeRef.current) {
                    setters.setConsumableTargetingMode(null);
                } else if (stateRefs.targetingModeRef.current) {
                    clearTargetingMode(setters.setTargetingMode, { current: rangeIndicator }, { current: aoeIndicator });
                } else if (stateRefs.helpOpenRef.current) {
                    callbacks.onCloseHelp();
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
                        const skills = getAllSkills(unitId);
                        const skill = skills.find(s => s.name === skillName);
                        if (skill) callbacks.handleCastSkillRef.current?.(unitId, skill);
                    }
                }
            }
            if (["F1", "F2", "F3", "F4", "F5", "F6"].includes(e.code)) {
                e.preventDefault();
                const slotIndex = parseInt(e.code.charAt(1)) - 1;
                const playerUnits = stateRefs.unitsStateRef.current.filter(u => u.team === "player");
                const playerIds = playerUnits.map(u => u.id);
                const order = stateRefs.formationOrderRef.current;
                // Build effective order: saved order filtered to living, then append unknowns
                const effective = order.filter(id => playerIds.includes(id));
                for (const id of playerIds) {
                    if (!effective.includes(id)) effective.push(id);
                }
                const unitId = effective[slotIndex];
                if (unitId !== undefined) {
                    const unit = playerUnits.find(u => u.id === unitId);
                    if (unit && unit.hp > 0) {
                        setters.setSelectedIds([unitId]);
                    }
                }
            }
            if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "KeyW", "KeyA", "KeyS", "KeyD"].includes(e.code)) {
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

function handleChestClick(
    userData: { chestIndex: number; chestX: number; chestZ: number },
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

    const chestRange = 2.5;
    const alivePlayers = stateRefs.unitsStateRef.current.filter(u => u.team === "player" && u.hp > 0);
    const playerNearby = alivePlayers.some(player => {
        const playerG = unitGroups[player.id];
        if (!playerG) return false;
        return Math.sqrt((playerG.position.x - chestX) ** 2 + (playerG.position.z - chestZ) ** 2) <= chestRange;
    });

    if (!playerNearby) {
        callbacks.addLog("You need to get closer to open this chest.", "#f59e0b");
        return;
    }

    const chest = area.chests[chestIndex];
    if (!chest) return;

    if (chest.locked && chest.requiredKeyId) {
        const inventory = getPartyInventory();
        const hasKey = inventory.items.some(entry => {
            const item = getItem(entry.itemId);
            return item && isKey(item) && item.keyId === chest.requiredKeyId;
        });
        if (!hasKey) {
            callbacks.addLog("This chest is locked. You need the right key.", "#ef4444");
            return;
        }
        const keyEntry = inventory.items.find(entry => {
            const item = getItem(entry.itemId);
            return item && isKey(item) && item.keyId === chest.requiredKeyId;
        });
        if (keyEntry) {
            const newInventory = removeFromInventory(inventory, keyEntry.itemId, 1);
            setPartyInventory(newInventory);
            const keyItem = getItem(keyEntry.itemId);
            callbacks.addLog(`Used ${keyItem?.name ?? "key"} to unlock the chest.`, "#f59e0b");
        }
    }

    const lootMessages: string[] = [];
    let currentInventory = getPartyInventory();

    if (chest.gold && chest.gold > 0) {
        setters.setGold(prev => prev + chest.gold!);
        lootMessages.push(`${chest.gold} gold`);
    }

    for (const content of chest.contents) {
        const item = getItem(content.itemId);
        if (item) {
            currentInventory = addToInventory(currentInventory, content.itemId, content.quantity);
            lootMessages.push(`${content.quantity > 1 ? `${content.quantity}x ` : ""}${item.name}`);
        }
    }

    setPartyInventory(currentInventory);
    setters.setOpenedChests(prev => new Set([...prev, chestKey]));

    callbacks.addLog(lootMessages.length > 0 ? `Found: ${lootMessages.join(", ")}` : "The chest was empty.", lootMessages.length > 0 ? "#4ade80" : "#888");
    soundFns.playAttack();
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

    const lootRange = 2.5;
    const alivePlayers = stateRefs.unitsStateRef.current.filter(u => u.team === "player" && u.hp > 0);
    const playerNearby = alivePlayers.some(player => {
        const playerG = unitGroups[player.id];
        if (!playerG) return false;
        return Math.sqrt((playerG.position.x - lootBagX) ** 2 + (playerG.position.z - lootBagZ) ** 2) <= lootRange;
    });

    if (!playerNearby) {
        callbacks.addLog("You need to get closer to open this.", "#f59e0b");
        return;
    }

    const bag = gameRefs.current.lootBags[bagIndex];
    if (bag.gold > 0) {
        setters.setGold(prev => prev + bag.gold);
        callbacks.addLog(`Found: ${bag.gold} gold`, "#ffd700");
    }

    removeLootBag(scene, bag);
    gameRefs.current.lootBags.splice(bagIndex, 1);
    soundFns.playGold();
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

    const doorRange = 2.5;
    const alivePlayers = stateRefs.unitsStateRef.current.filter(u => u.team === "player" && u.hp > 0);
    const playerNearby = alivePlayers.some(player => {
        const playerG = unitGroups[player.id];
        if (!playerG) return false;
        return Math.sqrt((playerG.position.x - (secretDoor.x + 0.5)) ** 2 + (playerG.position.z - (secretDoor.z + 0.5)) ** 2) <= doorRange;
    });

    if (!playerNearby) {
        callbacks.addLog("You need to get closer to inspect this.", "#f59e0b");
        return;
    }

    if (secretDoor.hint) callbacks.addLog(secretDoor.hint, "#4ade80");

    setters.setOpenedSecretDoors(prev => new Set([...prev, secretDoorKey]));
    scene.remove(meshGroup);

    const { blockingWall } = secretDoor;
    const blockedGrid = getBlocked();
    for (let x = blockingWall.x; x < blockingWall.x + blockingWall.w; x++) {
        for (let z = blockingWall.z; z < blockingWall.z + blockingWall.h; z++) {
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
                    skillCtx, callbacks.addLog
                );
            }
        }
    });

    setters.setUnits(prev => prev.map(u => stateRefs.selectedRef.current.includes(u.id) ? { ...u, target: targetId } : u));
    soundFns.playAttack();
}
