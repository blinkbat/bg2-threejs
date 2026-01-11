/**
 * BG2-STYLE ISOMETRIC TACTICS
 * Main game component - orchestrates Three.js scene and game loop
 */

import { useState, useRef, useEffect } from "react";
import * as THREE from "three";

// Constants & Types
import { GRID_SIZE, ATTACK_RANGE, ATTACK_COOLDOWN, MOVE_SPEED, UNIT_RADIUS, PAN_SPEED } from "./constants";
import type { Unit, UnitData, CombatLogEntry, SelectionBox, DamageText, FogTexture, UnitGroup } from "./types";

// Game Logic
import { blocked, candlePositions, mergedObstacles, roomFloors } from "./dungeon";
import { findPath, updateVisibility } from "./pathfinding";
import { UNIT_DATA, KOBOLD_STATS, createInitialUnits, rollDamage, rollD20 } from "./units";

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

    // React state
    const [units, setUnits] = useState<Unit[]>(createInitialUnits);
    const [selectedIds, setSelectedIds] = useState<number[]>([]);
    const [selBox, setSelBox] = useState<SelectionBox | null>(null);
    const [showPanel, setShowPanel] = useState(false);
    const [combatLog, setCombatLog] = useState<CombatLogEntry[]>([{ text: "Combat begins!", color: "#f59e0b" }]);
    const [paused, setPaused] = useState(false);
    const [hpBarPositions, setHpBarPositions] = useState<{ positions: Record<number, { x: number; y: number; visible: boolean }>; scale: number }>({ positions: {}, scale: 1 });

    // Refs for accessing state in callbacks
    const selectedRef = useRef(selectedIds);
    const unitsStateRef = useRef(units);
    const pausedRef = useRef(paused);

    useEffect(() => { selectedRef.current = selectedIds; }, [selectedIds]);
    useEffect(() => { unitsStateRef.current = units; }, [units]);
    useEffect(() => { pausedRef.current = paused; }, [paused]);

    const addLog = (text: string, color?: string) => setCombatLog(prev => [...prev.slice(-50), { text, color }]);

    // 8-bit style sound effects using Web Audio API with natural randomness
    const audioCtxRef = useRef<AudioContext | null>(null);
    const getAudioCtx = () => {
        if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
        return audioCtxRef.current;
    };
    const rand = (base: number, variance: number) => base * (1 + (Math.random() - 0.5) * variance);
    const playTone = (freq: number, duration: number, volume: number, type: OscillatorType, freqEnd?: number, filterFreq?: number) => {
        const ctx = getAudioCtx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const filter = ctx.createBiquadFilter();

        // Randomize duration and volume slightly
        const dur = rand(duration, 0.3);
        const vol = rand(volume, 0.2);

        osc.type = type;
        osc.frequency.setValueAtTime(freq, ctx.currentTime);
        // Add slight detune for character (±15 cents)
        osc.detune.setValueAtTime((Math.random() - 0.5) * 30, ctx.currentTime);
        if (freqEnd !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(freqEnd, 20), ctx.currentTime + dur);

        // Low-pass filter with randomized cutoff
        filter.type = "lowpass";
        filter.frequency.setValueAtTime(filterFreq ? rand(filterFreq, 0.4) : rand(4000, 0.3), ctx.currentTime);
        filter.Q.setValueAtTime(rand(1, 0.5), ctx.currentTime);

        gain.gain.setValueAtTime(vol, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + dur);
    };
    const soundFnsRef = useRef({
        playMove: () => playTone(800, 0.06, 0.12, "square", undefined, 3000),
        playAttack: () => playTone(440, 0.08, 0.15, "square", 330, 2500),
        playHit: () => playTone(120, 0.15, 0.25, "sawtooth", 40, 800),
        playMiss: () => playTone(200, 0.12, 0.1, "triangle", 400, 2000),
    });

    // =============================================================================
    // THREE.JS SETUP & GAME LOOP
    // =============================================================================

    useEffect(() => {
        if (!containerRef.current) return;

        // Scene setup
        const scene = new THREE.Scene();
        scene.background = new THREE.Color("#0d1117");
        sceneRef.current = scene;

        const aspect = containerRef.current.clientWidth / containerRef.current.clientHeight;
        const camera = new THREE.OrthographicCamera(-15 * aspect, 15 * aspect, 15, -15, 0.1, 1000);
        cameraRef.current = camera;

        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
        renderer.setPixelRatio(window.devicePixelRatio);
        containerRef.current.appendChild(renderer.domElement);
        rendererRef.current = renderer;

        // Lighting - brighter ambient and directional
        scene.add(new THREE.AmbientLight(0xffffff, 0.15));
        const dir = new THREE.DirectionalLight(0xffffff, 0.25);
        dir.position.set(10, 20, 10);
        scene.add(dir);

        // Ground - slightly metallic for light reflection
        const ground = new THREE.Mesh(new THREE.PlaneGeometry(GRID_SIZE, GRID_SIZE), new THREE.MeshStandardMaterial({ color: "#12121a", metalness: 0.3, roughness: 0.7 }));
        ground.rotation.x = -Math.PI / 2;
        ground.position.set(GRID_SIZE / 2, 0, GRID_SIZE / 2);
        ground.name = "ground";
        scene.add(ground);

        // Room floors - polished stone look
        roomFloors.forEach(r => {
            const floor = new THREE.Mesh(new THREE.PlaneGeometry(r.w, r.h), new THREE.MeshStandardMaterial({ color: r.color, metalness: 0.4, roughness: 0.6 }));
            floor.rotation.x = -Math.PI / 2;
            floor.position.set(r.x + r.w / 2, 0.01, r.z + r.h / 2);
            floor.name = "ground";
            scene.add(floor);
        });

        // Torch lights with candle + flickering flame
        const flames: THREE.Mesh[] = [];
        const candleLights: THREE.PointLight[] = [];
        candlePositions.forEach((pos) => {
            const candle = new THREE.Mesh(
                new THREE.CylinderGeometry(0.06, 0.08, 0.3, 8),
                new THREE.MeshStandardMaterial({ color: "#e8d4a8", metalness: 0.1, roughness: 0.9 })
            );
            candle.position.set(pos.x + pos.dx * 0.3, 1.85, pos.z + pos.dz * 0.3);
            scene.add(candle);

            const flame = new THREE.Mesh(
                new THREE.SphereGeometry(0.08, 8, 8),
                new THREE.MeshBasicMaterial({ color: "#ffcc44", transparent: true, opacity: 0.85 })
            );
            flame.position.set(pos.x + pos.dx * 0.3, 2.05, pos.z + pos.dz * 0.3);
            flame.scale.y = 1.8;
            scene.add(flame);
            flames.push(flame);

            const light = new THREE.PointLight("#ffaa44", 5, 18, 1.2);
            light.position.set(pos.x + pos.dx * 1.5, 2.2, pos.z + pos.dz * 1.5);
            scene.add(light);
            candleLights.push(light);
        });

        // Walls - slight sheen
        mergedObstacles.forEach((o, i) => {
            const shade = 0x2d3748 + (i % 3) * 0x050505;
            const mesh = new THREE.Mesh(new THREE.BoxGeometry(o.w, 2.5, o.h), new THREE.MeshStandardMaterial({ color: shade, metalness: 0.2, roughness: 0.8 }));
            mesh.position.set(o.x + o.w / 2, 1.25, o.z + o.h / 2);
            mesh.name = "obstacle";
            scene.add(mesh);
        });

        // Grid lines
        const gridMat = new THREE.LineBasicMaterial({ color: "#333" });
        for (let i = 0; i <= GRID_SIZE; i++) {
            scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.01, i), new THREE.Vector3(GRID_SIZE, 0.01, i)]), gridMat));
            scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(i, 0.01, 0), new THREE.Vector3(i, 0.01, GRID_SIZE)]), gridMat));
        }

        // Fog of war
        const fogCanvas = document.createElement("canvas");
        fogCanvas.width = GRID_SIZE;
        fogCanvas.height = GRID_SIZE;
        const fogCtx = fogCanvas.getContext("2d")!;
        fogCtx.fillStyle = "#000";
        fogCtx.fillRect(0, 0, GRID_SIZE, GRID_SIZE);
        const fogTexture = new THREE.CanvasTexture(fogCanvas);
        fogTexture.magFilter = THREE.NearestFilter;
        fogTexture.minFilter = THREE.NearestFilter;
        fogTextureRef.current = { canvas: fogCanvas, ctx: fogCtx, texture: fogTexture };

        const fogMesh = new THREE.Mesh(
            new THREE.PlaneGeometry(GRID_SIZE, GRID_SIZE),
            new THREE.MeshBasicMaterial({ map: fogTexture, transparent: true, depthWrite: false })
        );
        fogMesh.rotation.x = -Math.PI / 2;
        fogMesh.position.set(GRID_SIZE / 2, 2.6, GRID_SIZE / 2);
        fogMesh.renderOrder = 999;
        scene.add(fogMesh);
        fogMeshRef.current = fogMesh;

        // Move marker
        const marker = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.3, 4), new THREE.MeshBasicMaterial({ color: "#ffff00", side: THREE.DoubleSide, transparent: true, opacity: 0.8 }));
        marker.rotation.x = -Math.PI / 2;
        marker.visible = false;
        scene.add(marker);
        moveMarkerRef.current = marker;

        // Create unit meshes
        units.forEach(unit => {
            const isPlayer = unit.team === "player";
            const data = isPlayer ? UNIT_DATA[unit.id] : KOBOLD_STATS;
            const group = new THREE.Group();

            const base = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.45, 32), new THREE.MeshBasicMaterial({ color: isPlayer ? "#444" : "#660000", side: THREE.DoubleSide, transparent: true, opacity: 0.5 }));
            base.rotation.x = -Math.PI / 2;
            base.position.y = 0.02;
            group.add(base);

            const boxH = isPlayer ? 1 : 0.6;
            const boxMat = new THREE.MeshStandardMaterial({ color: data.color, metalness: 0.5, roughness: 0.5 });
            const box = new THREE.Mesh(new THREE.BoxGeometry(0.6, boxH, 0.6), boxMat);
            box.position.y = boxH / 2;
            box.userData.unitId = unit.id;
            group.add(box);
            unitMeshRef.current[unit.id] = box;
            unitOriginalColorRef.current[unit.id] = new THREE.Color(data.color);

            const sel = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.55, 32), new THREE.MeshBasicMaterial({ color: "#00ff00", side: THREE.DoubleSide }));
            sel.rotation.x = -Math.PI / 2;
            sel.position.y = 0.03;
            sel.visible = false;
            group.add(sel);
            selectRingsRef.current[unit.id] = sel;
            maxHpRef.current[unit.id] = data.maxHp;

            group.position.set(unit.x, 0, unit.z);
            group.userData = { unitId: unit.id, targetX: unit.x, targetZ: unit.z, attackTarget: null };
            scene.add(group);
            unitsRef.current[unit.id] = group as UnitGroup;
            pathsRef.current[unit.id] = [];
        });

        // Camera helper
        const updateCamera = () => {
            const d = 20;
            camera.position.set(cameraOffset.current.x + d, d, cameraOffset.current.z + d);
            camera.lookAt(cameraOffset.current.x, 0, cameraOffset.current.z);
        };
        updateCamera();

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
                updateCamera();
            } else if (isBoxSel.current) {
                boxEnd.current = { x: e.clientX, y: e.clientY };
                const rect = renderer.domElement.getBoundingClientRect();
                setSelBox({ left: Math.min(boxStart.current.x, boxEnd.current.x) - rect.left, top: Math.min(boxStart.current.y, boxEnd.current.y) - rect.top, width: Math.abs(boxEnd.current.x - boxStart.current.x), height: Math.abs(boxEnd.current.y - boxStart.current.y) });
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
                            soundFnsRef.current.playMove();
                            let idx = 0;
                            selectedRef.current.forEach(uid => {
                                const u = unitsStateRef.current.find(u => u.id === uid);
                                if (u && u.hp > 0) {
                                    const ox = (idx % 3 - 1) * 1.2, oz = Math.floor(idx / 3) * 1.2;
                                    idx++;
                                    const tx = Math.max(0.5, Math.min(GRID_SIZE - 0.5, gx + ox));
                                    const tz = Math.max(0.5, Math.min(GRID_SIZE - 0.5, gz + oz));
                                    assignPath(uid, tx, tz);
                                    if (unitsRef.current[uid]) unitsRef.current[uid].userData.attackTarget = null;
                                }
                            });
                            setUnits(prev => prev.map(u => selectedRef.current.includes(u.id) ? { ...u, target: null } : u));
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
            for (const h of raycaster.intersectObjects(scene.children, true)) {
                let o: THREE.Object3D | null = h.object;
                while (o) {
                    if (o.userData.unitId !== undefined) {
                        const id = o.userData.unitId as number;
                        const clickedUnit = unitsStateRef.current.find(u => u.id === id);
                        if (clickedUnit && clickedUnit.team === "enemy" && clickedUnit.hp > 0 && selectedRef.current.length > 0) {
                            selectedRef.current.forEach(uid => {
                                if (unitsRef.current[uid]) unitsRef.current[uid].userData.attackTarget = id;
                                pathsRef.current[uid] = [];
                            });
                            setUnits(prev => prev.map(u => selectedRef.current.includes(u.id) ? { ...u, target: id } : u));
                            soundFnsRef.current.playAttack();
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
            if (e.code === "Space") { e.preventDefault(); pausedRef.current = !pausedRef.current; setPaused(p => !p); }
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
        renderer.domElement.addEventListener("contextmenu", (e) => e.preventDefault());
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
                updateCamera();
            }


            // Floating damage text
            damageTexts.current = damageTexts.current.filter(dt => {
                dt.mesh.position.y += 0.02;
                dt.life -= 16;
                (dt.mesh.material as THREE.MeshBasicMaterial).opacity = dt.life / 1000;
                if (dt.life <= 0) { scene.remove(dt.mesh); return false; }
                dt.mesh.quaternion.copy(camera.quaternion);
                return true;
            });

            // Update projectiles
            const currentUnitsForProjectiles = unitsStateRef.current;
            projectilesRef.current = projectilesRef.current.filter(proj => {
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
                    const roll = rollD20();
                    const hitNeeded = attackerData.thac0 - targetData.ac;

                    if (roll >= hitNeeded || roll === 20) {
                        const dmg = rollDamage(attackerData.damage[0], attackerData.damage[1]);
                        setUnits(prev => prev.map(u => u.id === targetUnit.id ? { ...u, hp: u.hp - dmg } : u));
                        hitFlashRef.current[targetUnit.id] = now;
                        soundFnsRef.current.playHit();
                        addLog(`${attackerData.name} hits ${targetData.name} for ${dmg} damage! (${roll})`, "#4ade80");

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
                        soundFnsRef.current.playMiss();
                        addLog(`${attackerData.name} misses ${targetData.name}. (${roll})`, "#888");
                    }

                    scene.remove(proj.mesh);
                    return false;
                }

                // Move projectile
                proj.mesh.position.x += (dx / dist) * proj.speed;
                proj.mesh.position.z += (dz / dist) * proj.speed;
                return true;
            });

            // Hit flash effect - flash white then fade back to original color
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
                                        soundFnsRef.current.playAttack();
                                    } else {
                                        // Melee attack - instant damage
                                        const targetData = targetU.team === "player" ? UNIT_DATA[targetU.id] : KOBOLD_STATS;
                                        const roll = rollD20();
                                        const hitNeeded = data.thac0 - targetData.ac;
                                        if (roll >= hitNeeded || roll === 20) {
                                            const dmg = rollDamage(data.damage[0], data.damage[1]);
                                            setUnits(prev => prev.map(u => u.id === targetU.id ? { ...u, hp: u.hp - dmg } : u));
                                            hitFlashRef.current[targetU.id] = now;
                                            soundFnsRef.current.playHit();
                                            addLog(`${data.name} hits ${targetData.name} for ${dmg} damage! (${roll})`, isPlayer ? "#4ade80" : "#f87171");
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
                                            soundFnsRef.current.playMiss();
                                            addLog(`${data.name} misses ${targetData.name}. (${roll})`, "#888");
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

    return (
        <div style={{ width: "100%", height: "100vh", position: "relative" }}>
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
            <HUD aliveEnemies={aliveEnemies} alivePlayers={alivePlayers} paused={paused} onTogglePause={() => setPaused(p => !p)} />
            <CombatLog log={combatLog} />
            <PartyBar units={units} selectedIds={selectedIds} onSelect={setSelectedIds} />
            {showPanel && selectedIds.length === 1 && <UnitPanel unitId={selectedIds[0]} units={units} onClose={() => setShowPanel(false)} onToggleAI={(id) => setUnits(prev => prev.map(u => u.id === id ? { ...u, aiEnabled: !u.aiEnabled } : u))} />}
        </div>
    );
}
