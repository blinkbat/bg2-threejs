/**
 * BG2-STYLE ISOMETRIC TACTICS
 * Main game component - orchestrates Three.js scene and game loop
 */

import { useState, useRef, useEffect } from "react";
import * as THREE from "three";

// Constants & Types
import { GRID_SIZE, PAN_SPEED } from "./constants";
import type { Unit, Skill, CombatLogEntry, SelectionBox, DamageText, UnitGroup, FogTexture, Projectile, SwingAnimation } from "./types";

// Game Logic
import { blocked } from "./dungeon";
import { ENEMY_STATS, createInitialUnits } from "./units";
import { createScene, updateCamera } from "./scene";
import { soundFns } from "./sound";

// Extracted modules
import { clearTargetingMode, type SkillExecutionContext } from "./skills";
import { disposeGeometry } from "./disposal";
import {
    togglePause,
    executeMove,
    executeAttack,
    getUnitsInBox,
    processActionQueue,
    buildMoveTargets,
    handleTargetingClick,
    type QueuedAction
} from "./input";
import {
    updateDamageTexts,
    updateHitFlash,
    updateProjectiles,
    updateFogOfWar,
    updateUnitAI,
    updateHpBarPositions,
    updateSwingAnimations,
    processStatusEffects,
    updatePoisonVisuals
} from "./gameLoop";

// UI Components
import { PartyBar } from "./components/PartyBar";
import { UnitPanel } from "./components/UnitPanel";
import { CombatLog } from "./components/CombatLog";
import { HUD } from "./components/HUD";
import { HelpModal } from "./components/HelpModal";

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

    // Action queue
    const actionQueueRef = useRef<QueuedAction[]>([]);
    const processActionQueueRef = useRef<() => void>(() => {});

    // React state
    const [units, setUnits] = useState<Unit[]>(createInitialUnits);
    const [selectedIds, setSelectedIds] = useState<number[]>([]);
    const [selBox, setSelBox] = useState<SelectionBox | null>(null);
    const [showPanel, setShowPanel] = useState(false);
    const [combatLog, setCombatLog] = useState<CombatLogEntry[]>([{ text: "Combat begins!", color: "#f59e0b" }]);
    const [paused, setPaused] = useState(true);
    const [hpBarPositions, setHpBarPositions] = useState<{ positions: Record<number, { x: number; y: number; visible: boolean }>; scale: number }>({ positions: {}, scale: 1 });
    const [skillCooldowns, setSkillCooldowns] = useState<Record<string, { end: number; duration: number }>>({});
    const [targetingMode, setTargetingMode] = useState<{ casterId: number; skill: Skill } | null>(null);
    const [queuedActions, setQueuedActions] = useState<{ unitId: number; skillName: string }[]>([]);
    const [showHelp, setShowHelp] = useState(true);

    // Refs for accessing state in callbacks
    const selectedRef = useRef(selectedIds);
    const unitsStateRef = useRef(units);
    const pausedRef = useRef(paused);
    const targetingModeRef = useRef(targetingMode);
    const pauseStartTimeRef = useRef<number | null>(Date.now());

    useEffect(() => { selectedRef.current = selectedIds; }, [selectedIds]);
    useEffect(() => { unitsStateRef.current = units; }, [units]);
    useEffect(() => { pausedRef.current = paused; }, [paused]);
    useEffect(() => { targetingModeRef.current = targetingMode; }, [targetingMode]);

    const addLog = (text: string, color?: string) => setCombatLog(prev => [...prev.slice(-50), { text, color }]);

    // Skill execution context (passed to skill functions)
    const getSkillContext = (scene: THREE.Scene): SkillExecutionContext => ({
        scene,
        unitsStateRef: unitsStateRef as React.RefObject<Unit[]>,
        unitsRef: unitsRef as React.RefObject<Record<number, UnitGroup>>,
        actionCooldownRef,
        projectilesRef,
        unitMeshRef: unitMeshRef as React.RefObject<Record<number, THREE.Mesh>>,
        unitOriginalColorRef: unitOriginalColorRef as React.RefObject<Record<number, THREE.Color>>,
        setUnits,
        setSkillCooldowns,
        addLog
    });

    // =============================================================================
    // THREE.JS SETUP & GAME LOOP
    // =============================================================================

    useEffect(() => {
        if (!containerRef.current) return;

        const sceneRefs = createScene(containerRef.current, units);
        const { scene, camera, renderer, flames, candleLights, fogTexture, moveMarker, rangeIndicator, aoeIndicator, unitGroups, selectRings, unitMeshes, unitOriginalColors, maxHp } = sceneRefs;

        sceneRef.current = scene;
        cameraRef.current = camera;
        rendererRef.current = renderer;
        fogTextureRef.current = fogTexture;
        moveMarkerRef.current = moveMarker;
        rangeIndicatorRef.current = rangeIndicator;
        aoeIndicatorRef.current = aoeIndicator;
        unitsRef.current = unitGroups;
        selectRingsRef.current = selectRings;
        unitMeshRef.current = unitMeshes;
        unitOriginalColorRef.current = unitOriginalColors;
        maxHpRef.current = maxHp;
        units.forEach(unit => { pathsRef.current[unit.id] = []; });

        const updateCam = () => updateCamera(camera, cameraOffset.current);
        updateCam();

        const raycaster = new THREE.Raycaster();
        const mouse = new THREE.Vector2();
        const skillCtx = getSkillContext(scene);

        // Process action queue wrapper
        const doProcessQueue = () => {
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

        // =============================================================================
        // INPUT HANDLERS
        // =============================================================================

        const onMouseDown = (e: MouseEvent) => {
            if (e.button === 2) {
                isDragging.current = true;
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
                                setTimeout(() => { if (moveMarkerRef.current) moveMarkerRef.current.visible = false; }, 500);
                            }
                            soundFns.playMove();

                            const moveTargets = buildMoveTargets(selectedRef.current, unitsStateRef.current, gx, gz);

                            if (pausedRef.current) {
                                actionQueueRef.current.push({ type: "move", unitIds: moveTargets.map(t => t.id), targets: moveTargets });
                                addLog(`Move queued for ${moveTargets.length} unit(s)`, "#888");
                            } else {
                                executeMove(unitsRef.current, pathsRef.current, moveStartRef.current, setUnits, moveTargets);
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
                                actionQueueRef.current.push({ type: "attack", unitIds, targetId: id });
                                const enemyName = clickedUnit.enemyType ? ENEMY_STATS[clickedUnit.enemyType].name : "Enemy";
                                addLog(`Attack queued on ${enemyName}`, "#888");
                            } else {
                                executeAttack(unitsRef.current, pathsRef.current, setUnits, unitIds, id);
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
                togglePause(
                    { pauseStartTimeRef, actionCooldownRef },
                    { pausedRef },
                    { setPaused, setSkillCooldowns },
                    doProcessQueue
                );
            }
            if (e.code === "Escape" && targetingModeRef.current) {
                clearTargetingMode(setTargetingMode, rangeIndicatorRef, aoeIndicatorRef);
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

        renderer.domElement.addEventListener("click", onClick);
        renderer.domElement.addEventListener("mousedown", onMouseDown);
        renderer.domElement.addEventListener("mousemove", onMouseMove);
        renderer.domElement.addEventListener("mouseup", onMouseUp);
        renderer.domElement.addEventListener("contextmenu", (e) => {
            e.preventDefault();
            if (targetingModeRef.current) {
                clearTargetingMode(setTargetingMode, rangeIndicatorRef, aoeIndicatorRef);
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

            // Flickering flames
            flames.forEach((flame, i) => {
                const flicker = 0.7 + Math.sin(now * 0.015 + i * 2) * 0.15 + Math.random() * 0.15;
                flame.scale.y = 1.5 + Math.sin(now * 0.02 + i) * 0.3;
                (flame.material as THREE.MeshBasicMaterial).opacity = flicker;
                candleLights[i].intensity = 5 + Math.sin(now * 0.008 + i * 1.7) * 0.3 + Math.random() * 0.2;
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

                // Hit flash effect
                updateHitFlash(hitFlashRef.current, unitMeshRef.current, unitOriginalColorRef.current, unitsStateRef.current, now);

                // Update poison visuals (green tint for poisoned units)
                updatePoisonVisuals(unitsStateRef.current, unitMeshRef.current, unitOriginalColorRef.current, hitFlashRef.current);
            }

            const currentUnits = unitsStateRef.current;

            // Fog of war
            const playerUnits = currentUnits.filter(u => u.team === "player" && u.hp > 0);
            if (fogTextureRef.current) {
                updateFogOfWar(visibilityRef.current, playerUnits, unitsRef.current, fogTextureRef.current, currentUnits);
            }

            // Unit AI & movement
            if (!pausedRef.current) {
                // Process queued actions (skills waiting for cooldown)
                doProcessQueue();

                currentUnits.forEach(unit => {
                    const g = unitsRef.current[unit.id];
                    if (!g || unit.hp <= 0) return;
                    updateUnitAI(
                        unit, g, unitsRef.current, currentUnits, visibilityRef.current,
                        pathsRef.current, actionCooldownRef.current, hitFlashRef.current,
                        projectilesRef.current, damageTexts.current, swingAnimationsRef.current,
                        moveStartRef.current, scene, setUnits, setSkillCooldowns, addLog, now,
                        defeatedThisFrame
                    );
                });

                // Update swing animations
                swingAnimationsRef.current = updateSwingAnimations(swingAnimationsRef.current, scene, now);
            }

            if (moveMarkerRef.current?.visible) moveMarkerRef.current.rotation.z += 0.05;

            // HP bar positions
            const rect = renderer.domElement.getBoundingClientRect();
            setHpBarPositions(updateHpBarPositions(currentUnits, unitsRef.current, camera, rect, zoomLevel.current));

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

    const aliveEnemies = units.filter(u => u.team === "enemy" && u.hp > 0).length;
    const alivePlayers = units.filter(u => u.team === "player" && u.hp > 0).length;

    // Skill targeting handler
    const handleCastSkill = (casterId: number, skill: Skill) => {
        const caster = units.find(u => u.id === casterId);
        if (!caster || caster.hp <= 0 || (caster.mana ?? 0) < skill.manaCost) return;

        const casterG = unitsRef.current[casterId];
        if (!casterG) return;

        setTargetingMode({ casterId, skill });

        if (rangeIndicatorRef.current) {
            // Only recreate geometry if radius changed
            const currentRadius = rangeIndicatorRef.current.userData.radius;
            if (currentRadius !== skill.range) {
                disposeGeometry(rangeIndicatorRef.current);
                rangeIndicatorRef.current.geometry = new THREE.RingGeometry(0.1, skill.range, 64);
                rangeIndicatorRef.current.userData.radius = skill.range;
            }
            rangeIndicatorRef.current.position.x = casterG.position.x;
            rangeIndicatorRef.current.position.z = casterG.position.z;
            rangeIndicatorRef.current.visible = true;
        }

        if (aoeIndicatorRef.current) {
            const targetRadius = skill.aoeRadius || 0.5;
            const innerRadius = skill.aoeRadius ? 0.1 : 0.3;
            const currentOuter = aoeIndicatorRef.current.userData.outerRadius;
            const currentInner = aoeIndicatorRef.current.userData.innerRadius;
            // Only recreate geometry if radius changed
            if (currentOuter !== targetRadius || currentInner !== innerRadius) {
                disposeGeometry(aoeIndicatorRef.current);
                aoeIndicatorRef.current.geometry = new THREE.RingGeometry(innerRadius, targetRadius, 32);
                aoeIndicatorRef.current.userData.outerRadius = targetRadius;
                aoeIndicatorRef.current.userData.innerRadius = innerRadius;
            }
            (aoeIndicatorRef.current.material as THREE.MeshBasicMaterial).color.set(skill.type === "heal" ? "#22c55e" : "#ff4400");
            aoeIndicatorRef.current.visible = true;
        }
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

    return (
        <div style={{ width: "100%", height: "100vh", position: "relative", cursor: targetingMode ? "crosshair" : "default" }}>
            <div ref={containerRef} style={{ width: "100%", height: "100%", filter: paused ? "saturate(0.4) brightness(0.85)" : "none", transition: "filter 0.2s" }} />
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
            <HUD aliveEnemies={aliveEnemies} alivePlayers={alivePlayers} paused={paused} onTogglePause={handleTogglePause} onShowHelp={() => setShowHelp(true)} />
            <CombatLog log={combatLog} />
            <PartyBar units={units} selectedIds={selectedIds} onSelect={setSelectedIds} />
            {showPanel && selectedIds.length === 1 && <UnitPanel
                unitId={selectedIds[0]}
                units={units}
                onClose={() => setShowPanel(false)}
                onToggleAI={(id) => setUnits(prev => prev.map(u => u.id === id ? { ...u, aiEnabled: !u.aiEnabled } : u))}
                onCastSkill={handleCastSkill}
                skillCooldowns={skillCooldowns}
                paused={paused}
                queuedSkills={queuedActions.filter(q => q.unitId === selectedIds[0]).map(q => q.skillName)}
            />}
            {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
        </div>
    );
}
