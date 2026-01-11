/**
 * BG2-STYLE ISOMETRIC TACTICS
 * Main game component - orchestrates Three.js scene and game loop
 */

import { useState, useRef, useEffect } from "react";
import * as THREE from "three";

// Constants & Types
import { GRID_SIZE, ATTACK_RANGE, ATTACK_COOLDOWN, MOVE_SPEED, UNIT_RADIUS, PAN_SPEED } from "./constants";
import type { Unit, UnitData, Skill, CombatLogEntry, SelectionBox, DamageText, UnitGroup, FogTexture } from "./types";

// Game Logic
import { blocked } from "./dungeon";
import { findPath, updateVisibility } from "./pathfinding";
import { UNIT_DATA, KOBOLD_STATS, createInitialUnits, rollDamage, rollHit } from "./units";

// Scene & Sound
import { createScene, updateCamera } from "./scene";
import { soundFns } from "./sound";

// UI Components
import { PartyBar } from "./components/PartyBar";
import { UnitPanel } from "./components/UnitPanel";
import { CombatLog } from "./components/CombatLog";
import { HUD } from "./components/HUD";

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export default function App() {
    // Three.js refs
    const containerRef = useRef<HTMLDivElement>(null);
    const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
    const cameraRef = useRef<THREE.OrthographicCamera | null>(null);
    const sceneRef = useRef<THREE.Scene | null>(null);
    const unitsRef = useRef<Record<number, UnitGroup>>({});
    const selectRingsRef = useRef<Record<number, THREE.Mesh>>({});
    const maxHpRef = useRef<Record<number, number>>({});
    const moveMarkerRef = useRef<THREE.Mesh | null>(null);
    const pathsRef = useRef<Record<number, { x: number; z: number }[]>>({});
    const fogTextureRef = useRef<FogTexture | null>(null);
    const fogMeshRef = useRef<THREE.Mesh | null>(null);
    const visibilityRef = useRef<number[][]>(Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(0)));

    // Camera & input refs
    const cameraOffset = useRef({ x: 6, z: 6 });
    const zoomLevel = useRef(10);
    const isDragging = useRef(false);
    const keysPressed = useRef<Set<string>>(new Set());
    const isBoxSel = useRef(false);
    const boxStart = useRef({ x: 0, y: 0 });
    const boxEnd = useRef({ x: 0, y: 0 });
    const lastMouse = useRef({ x: 0, y: 0 });
    const lastAttack = useRef<Record<number, number>>({});
    const damageTexts = useRef<DamageText[]>([]);
    const hitFlashRef = useRef<Record<number, number>>({});
    const unitMeshRef = useRef<Record<number, THREE.Mesh>>({});
    const unitOriginalColorRef = useRef<Record<number, THREE.Color>>({});
    const moveStartRef = useRef<Record<number, { time: number; x: number; z: number }>>({});
    const projectilesRef = useRef<{ mesh: THREE.Mesh; targetId: number; attackerId: number; speed: number }[]>([]);
    const rangeIndicatorRef = useRef<THREE.Mesh | null>(null);
    const aoeIndicatorRef = useRef<THREE.Mesh | null>(null);

    // Action queue for paused state - actions are queued and executed on unpause
    type QueuedAction =
        | { type: "skill"; casterId: number; skill: Skill; targetX: number; targetZ: number }
        | { type: "move"; unitIds: number[]; targets: { id: number; x: number; z: number }[] }
        | { type: "attack"; unitIds: number[]; targetId: number };
    const actionQueueRef = useRef<QueuedAction[]>([]);
    const processActionQueueRef = useRef<() => void>(() => {});

    // React state
    const [units, setUnits] = useState<Unit[]>(createInitialUnits);
    const [selectedIds, setSelectedIds] = useState<number[]>([]);
    const [selBox, setSelBox] = useState<SelectionBox | null>(null);
    const [showPanel, setShowPanel] = useState(false);
    const [combatLog, setCombatLog] = useState<CombatLogEntry[]>([{ text: "Combat begins!", color: "#f59e0b" }]);
    const [paused, setPaused] = useState(false);
    const [hpBarPositions, setHpBarPositions] = useState<{ positions: Record<number, { x: number; y: number; visible: boolean }>; scale: number }>({ positions: {}, scale: 1 });
    const [skillCooldowns, setSkillCooldowns] = useState<Record<string, number>>({});
    const [targetingMode, setTargetingMode] = useState<{ casterId: number; skill: Skill } | null>(null);

    // Refs for accessing state in callbacks
    const selectedRef = useRef(selectedIds);
    const unitsStateRef = useRef(units);
    const pausedRef = useRef(paused);
    const targetingModeRef = useRef(targetingMode);

    useEffect(() => { selectedRef.current = selectedIds; }, [selectedIds]);
    useEffect(() => { unitsStateRef.current = units; }, [units]);
    useEffect(() => { pausedRef.current = paused; }, [paused]);
    useEffect(() => { targetingModeRef.current = targetingMode; }, [targetingMode]);

    const addLog = (text: string, color?: string) => setCombatLog(prev => [...prev.slice(-50), { text, color }]);

    // =============================================================================
    // THREE.JS SETUP & GAME LOOP
    // =============================================================================

    useEffect(() => {
        if (!containerRef.current) return;

        // Create scene using extracted module
        const sceneRefs = createScene(containerRef.current, units);
        const { scene, camera, renderer, flames, candleLights, fogTexture, fogMesh, moveMarker, rangeIndicator, aoeIndicator, unitGroups, selectRings, unitMeshes, unitOriginalColors, maxHp } = sceneRefs;

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
        unitMeshRef.current = unitMeshes;
        unitOriginalColorRef.current = unitOriginalColors;
        maxHpRef.current = maxHp;
        units.forEach(unit => { pathsRef.current[unit.id] = []; });

        // Camera update helper
        const updateCam = () => updateCamera(camera, cameraOffset.current);
        updateCam();

        // Input handling
        const raycaster = new THREE.Raycaster();
        const mouse = new THREE.Vector2();

        const getUnitsInBox = (x1: number, y1: number, x2: number, y2: number): number[] => {
            const minX = Math.min(x1, x2), maxX = Math.max(x1, x2), minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
            const rect = renderer.domElement.getBoundingClientRect();
            const sel: number[] = [];
            Object.entries(unitsRef.current).forEach(([id, g]) => {
                const u = unitsStateRef.current.find(u => u.id === Number(id));
                if (!u || u.team !== "player" || u.hp <= 0) return;
                const p = new THREE.Vector3(g.position.x, 0.5, g.position.z).project(camera);
                const sx = ((p.x + 1) / 2) * rect.width + rect.left;
                const sy = ((-p.y + 1) / 2) * rect.height + rect.top;
                if (sx >= minX && sx <= maxX && sy >= minY && sy <= maxY) sel.push(Number(id));
            });
            return sel;
        };

        const assignPath = (unitId: number, targetX: number, targetZ: number) => {
            const g = unitsRef.current[unitId];
            if (!g) return;
            const path = findPath(g.position.x, g.position.z, targetX, targetZ);
            pathsRef.current[unitId] = path ? path.slice(1) : [];
            // Track move start for timeout detection
            if (path && path.length > 0) {
                moveStartRef.current[unitId] = { time: Date.now(), x: g.position.x, z: g.position.z };
            }
        };

        // Execute a skill (used for immediate cast and queued actions)
        const executeSkill = (casterId: number, skill: Skill, targetX: number, targetZ: number) => {
            const caster = unitsStateRef.current.find(u => u.id === casterId);
            const casterG = unitsRef.current[casterId];
            if (!caster || !casterG || caster.hp <= 0) return;
            if ((caster.mana ?? 0) < skill.manaCost) {
                addLog(`${UNIT_DATA[casterId].name}: Not enough mana!`, "#888");
                return;
            }

            if (skill.type === "damage" && skill.targetType === "aoe") {
                // Deduct mana and set cooldown
                setUnits(prev => prev.map(u => u.id === casterId ? { ...u, mana: (u.mana ?? 0) - skill.manaCost } : u));
                setSkillCooldowns(prev => ({ ...prev, [`${casterId}-${skill.name}`]: Date.now() + skill.cooldown }));

                // Create projectile toward target location
                const projectile = new THREE.Mesh(
                    new THREE.SphereGeometry(0.2, 12, 12),
                    new THREE.MeshBasicMaterial({ color: skill.projectileColor || "#ff4400" })
                );
                projectile.position.set(casterG.position.x, 0.8, casterG.position.z);
                scene.add(projectile);

                projectilesRef.current.push({
                    mesh: projectile,
                    targetId: -1,
                    attackerId: casterId,
                    speed: 0.25,
                    // @ts-expect-error - extending projectile type for AOE
                    isAoe: true,
                    aoeRadius: skill.aoeRadius,
                    damage: skill.value,
                    targetPos: { x: targetX, z: targetZ }
                });

                addLog(`${UNIT_DATA[casterId].name} casts ${skill.name}!`, "#ff6600");
                soundFns.playAttack();
            } else if (skill.type === "heal" && skill.targetType === "ally") {
                // For heal, find closest ally to target position
                const allies = unitsStateRef.current.filter(u => u.team === "player" && u.hp > 0);
                let closestAllyId: number | null = null;
                let closestDist = 2;

                allies.forEach(ally => {
                    const ag = unitsRef.current[ally.id];
                    if (!ag) return;
                    const d = Math.hypot(ag.position.x - targetX, ag.position.z - targetZ);
                    if (d < closestDist) {
                        closestDist = d;
                        closestAllyId = ally.id;
                    }
                });

                if (closestAllyId === null) {
                    addLog(`${UNIT_DATA[casterId].name}: No ally at that location!`, "#888");
                    return;
                }

                const targetAlly = unitsStateRef.current.find(u => u.id === closestAllyId);
                if (targetAlly && targetAlly.hp >= UNIT_DATA[targetAlly.id].maxHp) {
                    addLog(`${UNIT_DATA[casterId].name}: ${UNIT_DATA[closestAllyId].name} is at full health!`, "#888");
                    return;
                }

                // Deduct mana and set cooldown
                setUnits(prev => prev.map(u => u.id === casterId ? { ...u, mana: (u.mana ?? 0) - skill.manaCost } : u));
                setSkillCooldowns(prev => ({ ...prev, [`${casterId}-${skill.name}`]: Date.now() + skill.cooldown }));

                // Apply heal
                const healAmount = rollDamage(skill.value[0], skill.value[1]);
                const targetData = UNIT_DATA[closestAllyId];
                const healTargetId = closestAllyId;
                setUnits(prev => prev.map(u => u.id === healTargetId ? { ...u, hp: Math.min(targetData.maxHp, u.hp + healAmount) } : u));

                addLog(`${UNIT_DATA[casterId].name} heals ${targetData.name} for ${healAmount}!`, "#22c55e");

                // Visual effect - green flash
                const targetG = unitsRef.current[closestAllyId];
                if (targetG) {
                    const mesh = unitMeshRef.current[closestAllyId];
                    if (mesh) {
                        (mesh.material as THREE.MeshStandardMaterial).color.set("#22ff22");
                        setTimeout(() => {
                            const orig = unitOriginalColorRef.current[healTargetId];
                            if (orig) (mesh.material as THREE.MeshStandardMaterial).color.copy(orig);
                        }, 200);
                    }
                }
            }
        };

        // Execute attack targeting (used for immediate and queued actions)
        const executeAttack = (unitIds: number[], targetId: number) => {
            unitIds.forEach(uid => {
                if (unitsRef.current[uid]) unitsRef.current[uid].userData.attackTarget = targetId;
                pathsRef.current[uid] = [];
            });
            setUnits(prev => prev.map(u => unitIds.includes(u.id) ? { ...u, target: targetId } : u));
            soundFns.playAttack();
        };

        // Execute move command (used for immediate and queued actions)
        const executeMove = (targets: { id: number; x: number; z: number }[]) => {
            targets.forEach(t => {
                assignPath(t.id, t.x, t.z);
                if (unitsRef.current[t.id]) unitsRef.current[t.id].userData.attackTarget = null;
            });
            setUnits(prev => prev.map(u => targets.some(t => t.id === u.id) ? { ...u, target: null } : u));
        };

        // Process queued actions (called when unpausing)
        const processActionQueue = () => {
            while (actionQueueRef.current.length > 0) {
                const action = actionQueueRef.current.shift()!;
                if (action.type === "skill") {
                    executeSkill(action.casterId, action.skill, action.targetX, action.targetZ);
                } else if (action.type === "attack") {
                    executeAttack(action.unitIds, action.targetId);
                } else if (action.type === "move") {
                    executeMove(action.targets);
                }
            }
        };
        processActionQueueRef.current = processActionQueue;

        const onMouseDown = (e: MouseEvent) => {
            if (e.button === 2) { isDragging.current = true; lastMouse.current = { x: e.clientX, y: e.clientY }; }
            else if (e.button === 0) {
                const rect = renderer.domElement.getBoundingClientRect();
                mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
                mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
                raycaster.setFromCamera(mouse, camera);
                let hitUnit = false;
                for (const h of raycaster.intersectObjects(scene.children, true)) {
                    let o: THREE.Object3D | null = h.object;
                    while (o) { if (o.userData.unitId !== undefined) { hitUnit = true; break; } o = o.parent; }
                    if (hitUnit) break;
                }
                if (!hitUnit) { isBoxSel.current = true; boxStart.current = { x: e.clientX, y: e.clientY }; boxEnd.current = { x: e.clientX, y: e.clientY }; }
            }
        };

        const onMouseMove = (e: MouseEvent) => {
            if (isDragging.current) {
                const dx = e.clientX - lastMouse.current.x, dy = e.clientY - lastMouse.current.y;
                cameraOffset.current.x -= (dx + dy) * 0.03;
                cameraOffset.current.z -= (dy - dx) * 0.03;
                cameraOffset.current.x = Math.max(0, Math.min(GRID_SIZE, cameraOffset.current.x));
                cameraOffset.current.z = Math.max(0, Math.min(GRID_SIZE, cameraOffset.current.z));
                lastMouse.current = { x: e.clientX, y: e.clientY };
                updateCam();
            } else if (isBoxSel.current) {
                boxEnd.current = { x: e.clientX, y: e.clientY };
                const rect = renderer.domElement.getBoundingClientRect();
                setSelBox({ left: Math.min(boxStart.current.x, boxEnd.current.x) - rect.left, top: Math.min(boxStart.current.y, boxEnd.current.y) - rect.top, width: Math.abs(boxEnd.current.x - boxStart.current.x), height: Math.abs(boxEnd.current.y - boxStart.current.y) });
            }

            // Update AOE indicator position when in targeting mode
            if (targetingModeRef.current && aoeIndicatorRef.current) {
                const rect = renderer.domElement.getBoundingClientRect();
                mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
                mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
                raycaster.setFromCamera(mouse, camera);
                const intersects = raycaster.intersectObjects(scene.children, true);
                for (const hit of intersects) {
                    if (hit.object.name === "ground") {
                        aoeIndicatorRef.current.position.x = hit.point.x;
                        aoeIndicatorRef.current.position.z = hit.point.z;
                        break;
                    }
                }
            }
        };

        const onMouseUp = (e: MouseEvent) => {
            if (isBoxSel.current) {
                const dx = Math.abs(boxEnd.current.x - boxStart.current.x), dy = Math.abs(boxEnd.current.y - boxStart.current.y);
                if (dx > 5 || dy > 5) {
                    const inBox = getUnitsInBox(boxStart.current.x, boxStart.current.y, boxEnd.current.x, boxEnd.current.y);
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
                                setTimeout(() => { if (moveMarkerRef.current) moveMarkerRef.current.visible = false; }, 500);
                            }
                            soundFns.playMove();

                            // Build move targets
                            const moveTargets: { id: number; x: number; z: number }[] = [];
                            let idx = 0;
                            selectedRef.current.forEach(uid => {
                                const u = unitsStateRef.current.find(u => u.id === uid);
                                if (u && u.hp > 0) {
                                    const ox = (idx % 3 - 1) * 1.2, oz = Math.floor(idx / 3) * 1.2;
                                    idx++;
                                    const tx = Math.max(0.5, Math.min(GRID_SIZE - 0.5, gx + ox));
                                    const tz = Math.max(0.5, Math.min(GRID_SIZE - 0.5, gz + oz));
                                    moveTargets.push({ id: uid, x: tx, z: tz });
                                }
                            });

                            if (pausedRef.current) {
                                // Queue move for when unpaused
                                actionQueueRef.current.push({ type: "move", unitIds: moveTargets.map(t => t.id), targets: moveTargets });
                                addLog(`Move queued for ${moveTargets.length} unit(s)`, "#888");
                            } else {
                                executeMove(moveTargets);
                            }
                            break;
                        }
                    }
                }
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

            // Handle targeting mode click (queue if paused)
            if (targetingModeRef.current) {
                const { casterId, skill } = targetingModeRef.current;
                const caster = unitsStateRef.current.find(u => u.id === casterId);
                const casterG = unitsRef.current[casterId];

                if (!caster || !casterG || caster.hp <= 0) {
                    setTargetingMode(null);
                    if (rangeIndicatorRef.current) rangeIndicatorRef.current.visible = false;
                    if (aoeIndicatorRef.current) aoeIndicatorRef.current.visible = false;
                    return;
                }

                // Find where on the ground we clicked
                for (const hit of raycaster.intersectObjects(scene.children, true)) {
                    if (hit.object.name === "ground") {
                        const targetX = hit.point.x;
                        const targetZ = hit.point.z;
                        const dist = Math.hypot(targetX - casterG.position.x, targetZ - casterG.position.z);

                        // Check if in range
                        if (dist > skill.range) {
                            addLog(`${UNIT_DATA[casterId].name}: Target out of range!`, "#888");
                            return;
                        }

                        // Queue the skill if paused
                        if (pausedRef.current) {
                            actionQueueRef.current.push({ type: "skill", casterId, skill, targetX, targetZ });
                            addLog(`${UNIT_DATA[casterId].name} prepares ${skill.name}... (queued)`, "#888");
                            // Exit targeting mode
                            setTargetingMode(null);
                            if (rangeIndicatorRef.current) rangeIndicatorRef.current.visible = false;
                            if (aoeIndicatorRef.current) aoeIndicatorRef.current.visible = false;
                            return;
                        }

                        // Execute skill immediately
                        executeSkill(casterId, skill, targetX, targetZ);

                        // Exit targeting mode
                        setTargetingMode(null);
                        if (rangeIndicatorRef.current) rangeIndicatorRef.current.visible = false;
                        if (aoeIndicatorRef.current) aoeIndicatorRef.current.visible = false;
                        return;
                    }
                }
                return;
            }

            // Normal click handling
            for (const h of raycaster.intersectObjects(scene.children, true)) {
                let o: THREE.Object3D | null = h.object;
                while (o) {
                    if (o.userData.unitId !== undefined) {
                        const id = o.userData.unitId as number;
                        const clickedUnit = unitsStateRef.current.find(u => u.id === id);
                        if (clickedUnit && clickedUnit.team === "enemy" && clickedUnit.hp > 0 && selectedRef.current.length > 0) {
                            const unitIds = [...selectedRef.current];
                            if (pausedRef.current) {
                                // Queue attack for when unpaused
                                actionQueueRef.current.push({ type: "attack", unitIds, targetId: id });
                                addLog(`Attack queued on ${KOBOLD_STATS.name}`, "#888");
                            } else {
                                executeAttack(unitIds, id);
                            }
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
                const waspaused = pausedRef.current;
                pausedRef.current = !pausedRef.current;
                setPaused(p => !p);
                // Process queued actions when unpausing
                if (waspaused && !pausedRef.current) {
                    processActionQueue();
                }
            }
            if (e.code === "Escape" && targetingModeRef.current) {
                setTargetingMode(null);
                if (rangeIndicatorRef.current) rangeIndicatorRef.current.visible = false;
                if (aoeIndicatorRef.current) aoeIndicatorRef.current.visible = false;
            }
            if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "KeyW", "KeyA", "KeyS", "KeyD"].includes(e.code)) {
                keysPressed.current.add(e.code);
            }
        };
        const onKeyUp = (e: KeyboardEvent) => {
            keysPressed.current.delete(e.code);
        };
        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            zoomLevel.current = Math.max(5, Math.min(30, zoomLevel.current + e.deltaY * 0.01));
            const aspect = containerRef.current!.clientWidth / containerRef.current!.clientHeight;
            camera.left = -zoomLevel.current * aspect; camera.right = zoomLevel.current * aspect;
            camera.top = zoomLevel.current; camera.bottom = -zoomLevel.current;
            camera.updateProjectionMatrix();
        };

        renderer.domElement.addEventListener("click", onClick);
        renderer.domElement.addEventListener("mousedown", onMouseDown);
        renderer.domElement.addEventListener("mousemove", onMouseMove);
        renderer.domElement.addEventListener("mouseup", onMouseUp);
        renderer.domElement.addEventListener("contextmenu", (e) => {
            e.preventDefault();
            // Cancel targeting mode on right-click
            if (targetingModeRef.current) {
                setTargetingMode(null);
                if (rangeIndicatorRef.current) rangeIndicatorRef.current.visible = false;
                if (aoeIndicatorRef.current) aoeIndicatorRef.current.visible = false;
            }
        });
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

            // Flickering flames and lights
            flames.forEach((flame, i) => {
                const flicker = 0.7 + Math.sin(now * 0.015 + i * 2) * 0.15 + Math.random() * 0.15;
                flame.scale.y = 1.5 + Math.sin(now * 0.02 + i) * 0.3;
                (flame.material as THREE.MeshBasicMaterial).opacity = flicker;
                // Flicker the light intensity to match (subtle)
                const lightFlicker = 5 + Math.sin(now * 0.008 + i * 1.7) * 0.3 + Math.random() * 0.2;
                candleLights[i].intensity = lightFlicker;
            });

            // Keyboard panning (screen-space)
            let screenX = 0, screenY = 0;
            if (keysPressed.current.has("ArrowUp") || keysPressed.current.has("KeyW")) screenY -= 1;
            if (keysPressed.current.has("ArrowDown") || keysPressed.current.has("KeyS")) screenY += 1;
            if (keysPressed.current.has("ArrowLeft") || keysPressed.current.has("KeyA")) screenX -= 1;
            if (keysPressed.current.has("ArrowRight") || keysPressed.current.has("KeyD")) screenX += 1;
            if (screenX !== 0 || screenY !== 0) {
                const len = Math.hypot(screenX, screenY);
                const normX = screenX / len, normY = screenY / len;
                const worldX = (normX + normY) * PAN_SPEED;
                const worldZ = (-normX + normY) * PAN_SPEED;
                cameraOffset.current.x = Math.max(0, Math.min(GRID_SIZE, cameraOffset.current.x + worldX));
                cameraOffset.current.z = Math.max(0, Math.min(GRID_SIZE, cameraOffset.current.z + worldZ));
                updateCam();
            }


            // Floating damage text (keep billboarding even when paused, but freeze animation)
            damageTexts.current = damageTexts.current.filter(dt => {
                dt.mesh.quaternion.copy(camera.quaternion);
                if (!pausedRef.current) {
                    dt.mesh.position.y += 0.02;
                    dt.life -= 16;
                    (dt.mesh.material as THREE.MeshBasicMaterial).opacity = dt.life / 1000;
                    if (dt.life <= 0) { scene.remove(dt.mesh); return false; }
                }
                return true;
            });

            // Update projectiles (freeze when paused)
            const currentUnitsForProjectiles = unitsStateRef.current;
            if (pausedRef.current) {
                // Skip projectile updates when paused - they freeze in place
            } else {
            projectilesRef.current = projectilesRef.current.filter(proj => {
                // @ts-expect-error - AOE projectile extensions
                const isAoe = proj.isAoe as boolean | undefined;
                // @ts-expect-error - AOE projectile extensions
                const targetPos = proj.targetPos as { x: number; z: number } | undefined;

                // AOE projectile (like Fireball)
                if (isAoe && targetPos) {
                    const dx = targetPos.x - proj.mesh.position.x;
                    const dz = targetPos.z - proj.mesh.position.z;
                    const dist = Math.hypot(dx, dz);

                    if (dist < 0.3) {
                        // @ts-expect-error - AOE projectile extensions
                        const aoeRadius = proj.aoeRadius as number;
                        // @ts-expect-error - AOE projectile extensions
                        const damage = proj.damage as [number, number];
                        const attackerData = UNIT_DATA[proj.attackerId];

                        // Create explosion effect
                        const explosion = new THREE.Mesh(
                            new THREE.RingGeometry(0.1, aoeRadius, 32),
                            new THREE.MeshBasicMaterial({ color: "#ff4400", transparent: true, opacity: 0.6, side: THREE.DoubleSide })
                        );
                        explosion.rotation.x = -Math.PI / 2;
                        explosion.position.set(targetPos.x, 0.1, targetPos.z);
                        scene.add(explosion);
                        setTimeout(() => scene.remove(explosion), 300);

                        // Deal damage to all enemies in radius
                        let hitCount = 0;
                        currentUnitsForProjectiles.filter(u => u.team === "enemy" && u.hp > 0).forEach(enemy => {
                            const eg = unitsRef.current[enemy.id];
                            if (!eg) return;
                            const enemyDist = Math.hypot(eg.position.x - targetPos.x, eg.position.z - targetPos.z);
                            if (enemyDist <= aoeRadius) {
                                const rawDmg = rollDamage(damage[0], damage[1]);
                                const dmg = Math.max(1, rawDmg - KOBOLD_STATS.armor);
                                setUnits(prev => prev.map(u => u.id === enemy.id ? { ...u, hp: u.hp - dmg } : u));
                                hitFlashRef.current[enemy.id] = now;
                                hitCount++;

                                // Spawn damage number
                                const dmgCanvas = document.createElement("canvas");
                                dmgCanvas.width = 64; dmgCanvas.height = 32;
                                const dctx = dmgCanvas.getContext("2d")!;
                                dctx.font = "bold 24px monospace";
                                dctx.fillStyle = "#ff6600";
                                dctx.textAlign = "center";
                                dctx.fillText(`-${dmg}`, 32, 24);
                                const tex = new THREE.CanvasTexture(dmgCanvas);
                                const sprite = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.4), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
                                sprite.position.set(eg.position.x, 1.5, eg.position.z);
                                scene.add(sprite);
                                damageTexts.current.push({ mesh: sprite, life: 1000 });

                                const newHp = Math.max(0, enemy.hp - dmg);
                                if (newHp <= 0) {
                                    addLog(`${KOBOLD_STATS.name} is defeated!`, "#f59e0b");
                                    eg.visible = false;
                                    Object.values(unitsRef.current).forEach((ug: UnitGroup) => {
                                        if (ug.userData.attackTarget === enemy.id) ug.userData.attackTarget = null;
                                    });
                                }
                            }
                        });

                        if (hitCount > 0) {
                            soundFns.playHit();
                            addLog(`${attackerData.name}'s Fireball hits ${hitCount} enemies!`, "#ff6600");
                        }

                        scene.remove(proj.mesh);
                        return false;
                    }

                    // Move projectile
                    proj.mesh.position.x += (dx / dist) * proj.speed;
                    proj.mesh.position.z += (dz / dist) * proj.speed;
                    return true;
                }

                // Regular projectile (single target)
                const targetUnit = currentUnitsForProjectiles.find(u => u.id === proj.targetId);
                const targetG = unitsRef.current[proj.targetId];
                const attackerUnit = currentUnitsForProjectiles.find(u => u.id === proj.attackerId);

                // Remove if target or attacker is gone
                if (!targetUnit || !targetG || targetUnit.hp <= 0 || !attackerUnit) {
                    scene.remove(proj.mesh);
                    return false;
                }

                // Move toward target
                const dx = targetG.position.x - proj.mesh.position.x;
                const dz = targetG.position.z - proj.mesh.position.z;
                const dist = Math.hypot(dx, dz);

                if (dist < 0.3) {
                    // Hit! Apply damage
                    const attackerData = UNIT_DATA[proj.attackerId];
                    const targetData = targetUnit.team === "player" ? UNIT_DATA[targetUnit.id] : KOBOLD_STATS;

                    if (rollHit(attackerData.accuracy)) {
                        const rawDmg = rollDamage(attackerData.damage[0], attackerData.damage[1]);
                        const dmg = Math.max(1, rawDmg - targetData.armor);
                        setUnits(prev => prev.map(u => u.id === targetUnit.id ? { ...u, hp: u.hp - dmg } : u));
                        hitFlashRef.current[targetUnit.id] = now;
                        soundFns.playHit();
                        addLog(`${attackerData.name} hits ${targetData.name} for ${dmg} damage!`, "#4ade80");

                        // Spawn damage number
                        const dmgCanvas = document.createElement("canvas");
                        dmgCanvas.width = 64; dmgCanvas.height = 32;
                        const dctx = dmgCanvas.getContext("2d")!;
                        dctx.font = "bold 24px monospace";
                        dctx.fillStyle = "#4ade80";
                        dctx.textAlign = "center";
                        dctx.fillText(`-${dmg}`, 32, 24);
                        const tex = new THREE.CanvasTexture(dmgCanvas);
                        const sprite = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.4), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
                        sprite.position.set(targetG.position.x, 1.5, targetG.position.z);
                        scene.add(sprite);
                        damageTexts.current.push({ mesh: sprite, life: 1000 });

                        const newHp = Math.max(0, targetUnit.hp - dmg);
                        if (newHp <= 0) {
                            addLog(`${targetData.name} is defeated!`, "#f59e0b");
                            targetG.visible = false;
                            Object.values(unitsRef.current).forEach((ug: UnitGroup) => {
                                if (ug.userData.attackTarget === targetUnit.id) ug.userData.attackTarget = null;
                            });
                        }
                    } else {
                        soundFns.playMiss();
                        addLog(`${attackerData.name} misses ${targetData.name}.`, "#888");
                    }

                    scene.remove(proj.mesh);
                    return false;
                }

                // Move projectile
                proj.mesh.position.x += (dx / dist) * proj.speed;
                proj.mesh.position.z += (dz / dist) * proj.speed;
                return true;
            });
            }

            // Hit flash effect - flash white then fade back to original color (freeze when paused)
            if (!pausedRef.current) {
                const FLASH_DURATION = 200;
                Object.entries(hitFlashRef.current).forEach(([id, hitTime]) => {
                    const mesh = unitMeshRef.current[Number(id)];
                    const originalColor = unitOriginalColorRef.current[Number(id)];
                    if (!mesh || !originalColor) return;
                    const elapsed = now - hitTime;
                    if (elapsed > FLASH_DURATION) {
                        (mesh.material as THREE.MeshStandardMaterial).color.copy(originalColor);
                        delete hitFlashRef.current[Number(id)];
                    } else {
                        const t = elapsed / FLASH_DURATION;
                        const flashColor = new THREE.Color(1, 1, 1).lerp(originalColor, t);
                        (mesh.material as THREE.MeshStandardMaterial).color.copy(flashColor);
                    }
                });
            }

            const currentUnits = unitsStateRef.current;

            // Update fog of war
            const playerUnits = currentUnits.filter(u => u.team === "player" && u.hp > 0);
            updateVisibility(visibilityRef.current, playerUnits, unitsRef);

            if (!fogTextureRef.current) return;
            const { ctx, texture } = fogTextureRef.current;
            ctx.clearRect(0, 0, GRID_SIZE, GRID_SIZE);
            for (let x = 0; x < GRID_SIZE; x++) {
                for (let z = 0; z < GRID_SIZE; z++) {
                    const vis = visibilityRef.current[x][z];
                    if (vis === 2) continue;
                    ctx.fillStyle = vis === 1 ? "rgba(0,0,0,0.5)" : "rgba(0,0,0,0.95)";
                    ctx.fillRect(x, z, 1, 1);
                }
            }
            texture.needsUpdate = true;

            // Hide enemies in fog
            currentUnits.filter(u => u.team === "enemy").forEach(u => {
                const g = unitsRef.current[u.id];
                if (!g) return;
                const cx = Math.floor(g.position.x), cz = Math.floor(g.position.z);
                const vis = visibilityRef.current[cx]?.[cz] ?? 0;
                g.visible = u.hp > 0 && vis === 2;
            });

            // Game logic (when not paused)
            if (!pausedRef.current) {
                const allGroups = Object.entries(unitsRef.current);

                currentUnits.forEach(unit => {
                    const g = unitsRef.current[unit.id];
                    if (!g || unit.hp <= 0) return;

                    const isPlayer = unit.team === "player";
                    const data = isPlayer ? UNIT_DATA[unit.id] : KOBOLD_STATS;

                    // AI targeting (enemies always, players when aiEnabled)
                    const shouldAutoTarget = isPlayer ? unit.aiEnabled : true;
                    const currentTarget = g.userData.attackTarget;

                    // Check if current target is still valid
                    let targetStillValid = false;
                    if (currentTarget !== null && currentTarget !== undefined) {
                        const targetUnit = currentUnits.find(u => u.id === currentTarget);
                        targetStillValid = targetUnit !== undefined && targetUnit.hp > 0;
                        if (!targetStillValid) {
                            g.userData.attackTarget = null;
                        }
                    }

                    // Find new target if we should auto-target and have no valid target
                    // Players only auto-target when idle (no active move path) - allows repositioning
                    const hasActivePath = pathsRef.current[unit.id]?.length > 0;
                    const canAutoTarget = shouldAutoTarget && !targetStillValid && (!isPlayer || !hasActivePath);
                    if (canAutoTarget) {
                        const aggroRange = isPlayer ? 12 : KOBOLD_STATS.aggroRange;
                        const enemyTeam = isPlayer ? "enemy" : "player";
                        let nearest: number | null = null, nearestDist = aggroRange;
                        currentUnits.filter(u => u.team === enemyTeam && u.hp > 0).forEach(enemy => {
                            const eg = unitsRef.current[enemy.id];
                            if (!eg) return;
                            // For players, check visibility array; for enemies, check if player visible
                            const enemyX = Math.floor(eg.position.x), enemyZ = Math.floor(eg.position.z);
                            const canSee = isPlayer
                                ? (visibilityRef.current[enemyX]?.[enemyZ] === 2)
                                : true; // Enemies can always see players
                            if (canSee) {
                                const d = Math.hypot(g.position.x - eg.position.x, g.position.z - eg.position.z);
                                if (d < nearestDist) { nearestDist = d; nearest = enemy.id; }
                            }
                        });
                        if (nearest !== null) {
                            g.userData.attackTarget = nearest;
                            pathsRef.current[unit.id] = [];
                        }
                    }

                    let targetX = g.position.x, targetZ = g.position.z;

                    if (g.userData.attackTarget) {
                        const targetG = unitsRef.current[g.userData.attackTarget];
                        const targetU = currentUnits.find(u => u.id === g.userData.attackTarget);
                        if (targetG && targetU && targetU.hp > 0) {
                            targetX = targetG.position.x;
                            targetZ = targetG.position.z;
                            const dist = Math.hypot(targetX - g.position.x, targetZ - g.position.z);
                            const isRanged = isPlayer && 'range' in data && data.range !== undefined;
                            const unitRange = isRanged ? (data as UnitData).range! : ATTACK_RANGE;
                            // Clear path when in range - ranged units should stop moving
                            if (dist <= unitRange && pathsRef.current[unit.id]?.length > 0) {
                                pathsRef.current[unit.id] = [];
                            }
                            if (dist <= unitRange) {
                                if (!lastAttack.current[unit.id] || now - lastAttack.current[unit.id] > ATTACK_COOLDOWN) {
                                    lastAttack.current[unit.id] = now;
                                    // Ranged attack - spawn projectile
                                    if (isRanged && (data as UnitData).projectileColor) {
                                        const rangedData = data as UnitData;
                                        const projectile = new THREE.Mesh(
                                            new THREE.SphereGeometry(0.1, 8, 8),
                                            new THREE.MeshBasicMaterial({ color: rangedData.projectileColor })
                                        );
                                        projectile.position.set(g.position.x, 0.7, g.position.z);
                                        scene.add(projectile);
                                        projectilesRef.current.push({ mesh: projectile, targetId: targetU.id, attackerId: unit.id, speed: 0.3 });
                                        soundFns.playAttack();
                                    } else {
                                        // Melee attack - instant damage
                                        const targetData = targetU.team === "player" ? UNIT_DATA[targetU.id] : KOBOLD_STATS;
                                        if (rollHit(data.accuracy)) {
                                            const rawDmg = rollDamage(data.damage[0], data.damage[1]);
                                            const dmg = Math.max(1, rawDmg - targetData.armor);
                                            setUnits(prev => prev.map(u => u.id === targetU.id ? { ...u, hp: u.hp - dmg } : u));
                                            hitFlashRef.current[targetU.id] = now;
                                            soundFns.playHit();
                                            addLog(`${data.name} hits ${targetData.name} for ${dmg} damage!`, isPlayer ? "#4ade80" : "#f87171");
                                            const dmgCanvas = document.createElement("canvas");
                                            dmgCanvas.width = 64; dmgCanvas.height = 32;
                                            const dctx = dmgCanvas.getContext("2d")!;
                                            dctx.font = "bold 24px monospace";
                                            dctx.fillStyle = isPlayer ? "#4ade80" : "#f87171";
                                            dctx.textAlign = "center";
                                            dctx.fillText(`-${dmg}`, 32, 24);
                                            const tex = new THREE.CanvasTexture(dmgCanvas);
                                            const sprite = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.4), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
                                            sprite.position.set(targetG.position.x, 1.5, targetG.position.z);
                                            scene.add(sprite);
                                            damageTexts.current.push({ mesh: sprite, life: 1000 });
                                            const newHp = Math.max(0, targetU.hp - dmg);
                                            if (newHp <= 0) {
                                                addLog(`${targetData.name} is defeated!`, "#f59e0b");
                                                targetG.visible = false;
                                                Object.values(unitsRef.current).forEach((ug: UnitGroup) => { if (ug.userData.attackTarget === targetU.id) ug.userData.attackTarget = null; });
                                            }
                                        } else {
                                            soundFns.playMiss();
                                            addLog(`${data.name} misses ${targetData.name}.`, "#888");
                                        }
                                    }
                                }
                                return;
                            } else {
                                if (!pathsRef.current[unit.id]?.length || Math.random() < 0.02) {
                                    const path = findPath(g.position.x, g.position.z, targetX, targetZ);
                                    pathsRef.current[unit.id] = path ? path.slice(1) : [];
                                }
                            }
                        } else {
                            g.userData.attackTarget = null;
                        }
                    }

                    const path = pathsRef.current[unit.id];
                    if (path && path.length > 0) {
                        targetX = path[0].x;
                        targetZ = path[0].z;
                        if (Math.hypot(targetX - g.position.x, targetZ - g.position.z) < 0.3) {
                            path.shift();
                            // Update move start when making progress
                            moveStartRef.current[unit.id] = { time: now, x: g.position.x, z: g.position.z };
                        }
                        // Timeout: if stuck for 2 seconds without progress, give up
                        const moveStart = moveStartRef.current[unit.id];
                        if (moveStart && now - moveStart.time > 2000) {
                            const movedDist = Math.hypot(g.position.x - moveStart.x, g.position.z - moveStart.z);
                            if (movedDist < 0.5) {
                                // Stuck - clear path and become idle
                                pathsRef.current[unit.id] = [];
                                delete moveStartRef.current[unit.id];
                            }
                        }
                    }

                    const dx = targetX - g.position.x;
                    const dz = targetZ - g.position.z;
                    const distToTarget = Math.hypot(dx, dz);

                    if (distToTarget > 0.1) {
                        let desiredX = dx / distToTarget, desiredZ = dz / distToTarget;
                        let avoidX = 0, avoidZ = 0;

                        allGroups.forEach(([otherId, otherG]) => {
                            if (String(unit.id) === otherId) return;
                            const otherU = currentUnits.find(u => u.id === Number(otherId));
                            if (!otherU || otherU.hp <= 0) return;
                            const ox = otherG.position.x - g.position.x, oz = otherG.position.z - g.position.z;
                            const oDist = Math.hypot(ox, oz);
                            if (oDist < UNIT_RADIUS * 4 && oDist > 0.01) {
                                const dot = (ox * desiredX + oz * desiredZ) / oDist;
                                if (dot > 0) {
                                    const cross = desiredX * oz - desiredZ * ox;
                                    const perpX = cross > 0 ? -desiredZ : desiredZ;
                                    const perpZ = cross > 0 ? desiredX : -desiredX;
                                    const strength = (UNIT_RADIUS * 4 - oDist) / (UNIT_RADIUS * 4);
                                    avoidX += perpX * strength * 2;
                                    avoidZ += perpZ * strength * 2;
                                }
                                if (oDist < UNIT_RADIUS * 2.2) {
                                    const sepStrength = (UNIT_RADIUS * 2.2 - oDist) / (UNIT_RADIUS * 2);
                                    avoidX -= (ox / oDist) * sepStrength * 3;
                                    avoidZ -= (oz / oDist) * sepStrength * 3;
                                }
                            }
                        });

                        let moveX = desiredX + avoidX, moveZ = desiredZ + avoidZ;
                        const moveMag = Math.hypot(moveX, moveZ);
                        if (moveMag > 0.01) {
                            moveX = (moveX / moveMag) * MOVE_SPEED;
                            moveZ = (moveZ / moveMag) * MOVE_SPEED;
                            const newX = g.position.x + moveX, newZ = g.position.z + moveZ;
                            const cellX = Math.floor(newX), cellZ = Math.floor(newZ);
                            if (!blocked[cellX]?.[cellZ]) {
                                g.position.x = Math.max(0.5, Math.min(GRID_SIZE - 0.5, newX));
                                g.position.z = Math.max(0.5, Math.min(GRID_SIZE - 0.5, newZ));
                            }
                        }
                    }
                });
            }

            if (moveMarkerRef.current?.visible) moveMarkerRef.current.rotation.z += 0.05;

            // Update HP bar screen positions
            const rect = renderer.domElement.getBoundingClientRect();
            const newPositions: Record<number, { x: number; y: number; visible: boolean }> = {};
            currentUnits.forEach(u => {
                const g = unitsRef.current[u.id];
                if (!g) return;
                const isPlayer = u.team === "player";
                const boxH = isPlayer ? 1 : 0.6;
                const worldPos = new THREE.Vector3(g.position.x, boxH + 0.4, g.position.z);
                worldPos.project(camera);
                const x = (worldPos.x * 0.5 + 0.5) * rect.width;
                const y = (-worldPos.y * 0.5 + 0.5) * rect.height;
                newPositions[u.id] = { x, y, visible: g.visible && u.hp > 0 };
            });
            // Scale based on zoom (10 is default zoom, smaller zoom = closer = bigger bars)
            const scale = 10 / zoomLevel.current;
            setHpBarPositions({ positions: newPositions, scale });

            renderer.render(scene, camera);
        };
        animate();

        // Resize handler
        const onResize = () => {
            if (!containerRef.current) return;
            const w = containerRef.current.clientWidth, h = containerRef.current.clientHeight, a = w / h;
            camera.left = -zoomLevel.current * a; camera.right = zoomLevel.current * a;
            camera.top = zoomLevel.current; camera.bottom = -zoomLevel.current;
            camera.updateProjectionMatrix();
            renderer.setSize(w, h);
        };
        window.addEventListener("resize", onResize);

        // Cleanup
        return () => {
            cancelAnimationFrame(animId);
            window.removeEventListener("resize", onResize);
            window.removeEventListener("keydown", onKeyDown);
            window.removeEventListener("keyup", onKeyUp);
            renderer.domElement.removeEventListener("wheel", onWheel);
            renderer.dispose();
            containerRef.current?.removeChild(renderer.domElement);
        };
    }, []);

    // Update selection rings
    useEffect(() => {
        Object.entries(selectRingsRef.current).forEach(([id, ring]) => { ring.visible = selectedIds.includes(Number(id)); });
        setShowPanel(selectedIds.length === 1 && units.find(u => u.id === selectedIds[0])?.team === "player");
    }, [selectedIds, units]);

    const aliveEnemies = units.filter(u => u.team === "enemy" && u.hp > 0).length;
    const alivePlayers = units.filter(u => u.team === "player" && u.hp > 0).length;

    // Skill targeting handler - enters targeting mode
    const handleCastSkill = (casterId: number, skill: Skill) => {
        // Allow entering targeting mode while paused - action will be queued
        const caster = units.find(u => u.id === casterId);
        if (!caster || caster.hp <= 0 || (caster.mana ?? 0) < skill.manaCost) return;

        const casterG = unitsRef.current[casterId];
        if (!casterG) return;

        // Enter targeting mode
        setTargetingMode({ casterId, skill });

        // Show range indicator around caster
        if (rangeIndicatorRef.current) {
            // Update geometry to match skill range
            rangeIndicatorRef.current.geometry.dispose();
            rangeIndicatorRef.current.geometry = new THREE.RingGeometry(0.1, skill.range, 64);
            rangeIndicatorRef.current.position.x = casterG.position.x;
            rangeIndicatorRef.current.position.z = casterG.position.z;
            rangeIndicatorRef.current.visible = true;
        }

        // Show AOE indicator if applicable
        if (aoeIndicatorRef.current) {
            if (skill.aoeRadius) {
                aoeIndicatorRef.current.geometry.dispose();
                aoeIndicatorRef.current.geometry = new THREE.RingGeometry(0.1, skill.aoeRadius, 32);
                (aoeIndicatorRef.current.material as THREE.MeshBasicMaterial).color.set(skill.type === "heal" ? "#22c55e" : "#ff4400");
                aoeIndicatorRef.current.visible = true;
            } else {
                // Single target - show small indicator
                aoeIndicatorRef.current.geometry.dispose();
                aoeIndicatorRef.current.geometry = new THREE.RingGeometry(0.3, 0.5, 32);
                (aoeIndicatorRef.current.material as THREE.MeshBasicMaterial).color.set(skill.type === "heal" ? "#22c55e" : "#ff4400");
                aoeIndicatorRef.current.visible = true;
            }
        }
    };

    return (
        <div style={{ width: "100%", height: "100vh", position: "relative", cursor: targetingMode ? "crosshair" : "default" }}>
            <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
            {selBox && <div style={{ position: "absolute", left: selBox.left, top: selBox.top, width: selBox.width, height: selBox.height, border: "1px solid #00ff00", backgroundColor: "rgba(0,255,0,0.1)", pointerEvents: "none" }} />}
            {/* DOM-based HP bars */}
            {units.map(u => {
                const pos = hpBarPositions.positions[u.id];
                if (!pos?.visible) return null;
                const maxHp = maxHpRef.current[u.id] || 1;
                const pct = Math.max(0, u.hp / maxHp);
                const color = pct > 0.5 ? "#22c55e" : pct > 0.25 ? "#eab308" : "#ef4444";
                const barWidth = 24 * hpBarPositions.scale;
                const barHeight = 3 * hpBarPositions.scale;
                return (
                    <div key={u.id} style={{ position: "absolute", left: pos.x - barWidth / 2, top: pos.y - barHeight / 2, width: barWidth, height: barHeight, backgroundColor: "#111", border: "1px solid #333", pointerEvents: "none" }}>
                        <div style={{ width: `${pct * 100}%`, height: "100%", backgroundColor: color }} />
                    </div>
                );
            })}
            <HUD aliveEnemies={aliveEnemies} alivePlayers={alivePlayers} paused={paused} onTogglePause={() => {
                const wasPaused = paused;
                pausedRef.current = !paused;
                setPaused(p => !p);
                if (wasPaused) processActionQueueRef.current();
            }} />
            <CombatLog log={combatLog} />
            <PartyBar units={units} selectedIds={selectedIds} onSelect={setSelectedIds} />
            {showPanel && selectedIds.length === 1 && <UnitPanel unitId={selectedIds[0]} units={units} onClose={() => setShowPanel(false)} onToggleAI={(id) => setUnits(prev => prev.map(u => u.id === id ? { ...u, aiEnabled: !u.aiEnabled } : u))} onCastSkill={handleCastSkill} skillCooldowns={skillCooldowns} />}
        </div>
    );
}
