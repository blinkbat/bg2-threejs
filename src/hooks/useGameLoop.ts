/**
 * Hook for managing the game loop (requestAnimationFrame)
 * Extracts game loop logic from App.tsx for better organization
 */

import { useEffect, useRef, useCallback } from "react";
import * as THREE from "three";
import {
    PAN_SPEED,
    ANCESTOR_AURA_DAMAGE_BONUS,
    ANCESTOR_AURA_RANGE,
    COLORS,
    VISHAS_EYES_ORB_HEAL_RADIUS,
    VISHAS_EYES_ORB_HEAL_RANGE
} from "../core/constants";
import { getGameTime, updateGameClock } from "../core/gameClock";
import { updateEffectAnimations } from "../core/effectScheduler";
import { getCurrentArea } from "../game/areas";
import type { Unit, UnitGroup } from "../core/types";
import { ENEMY_STATS } from "../game/enemyStats";
import { getEffectiveMaxHp } from "../game/playerUnits";
import { getEffectivePlayerHpRegen } from "../game/equipmentState";
import { createLiveUnitsDispatch } from "../core/stateUtils";
import { updateCamera, updateLightning, updateWater, updateRain, updateWallTransparency, updateTreeFogVisibility, updateFogOccluderVisibility, revealAllTreeMeshes, revealAllFogOccluderMeshes, updateLightLOD, addUnitToScene, updateBillboards, updateHpBarBillboards, updateHpBars } from "../rendering/scene";
import { updateDynamicObstacles } from "../ai/pathfinding";
import { updateAvoidanceCache, updateTargetingCache } from "../ai/unitAI";
import { buildUnitSpatialFrame, type UnitSpatialEntry } from "../ai/spatialCache";
import { updateUnitCache } from "../game/unitQuery";
import { clearUnitStatsCache } from "../game/units";
import { getUnitRadius, isInRange } from "../rendering/range";
import {
    updateDamageTexts,
    updateHitFlash,
    updateProjectiles,
    pruneStaleVolleys,
    updateFogOfWar,
    updateUnitAI,
    updateSwingAnimations,
    processStatusEffects,
    updatePoisonVisuals,
    updateEnergyShieldVisuals,
    updateShieldFacing,
    processAcidTiles,
    createAcidPool,
    processSanctuaryTiles,
    processHolyTiles,
    processSmokeTiles,
    processFireTiles,
    processChargeAttacks,
    processFireBreaths,
    processCurses,
    processGlares,
    updateLeaps,
    updateTentacles,
    updateSubmergedKrakens,
    processShadePhases,
    updateSpriteFacing,
    updateAncestorGhostVisuals,
    removeBumpOffsets,
    applyBumpOffsets
} from "../gameLoop";
import { createAnimatedRing, handleUnitDefeat, spawnDamageNumber } from "../combat/damageEffects";
import type { ActionQueue } from "../input";
import type { ThreeSceneState, GameRefs } from "./useThreeScene";

// =============================================================================
// TYPES
// =============================================================================

/** Scene state with required (non-null) core objects - use when scene is initialized */
export type InitializedSceneState = ThreeSceneState & {
    scene: THREE.Scene;
    camera: THREE.OrthographicCamera;
    renderer: THREE.WebGLRenderer;
};

interface GameLoopStateRefs {
    unitsStateRef: React.MutableRefObject<Unit[]>;
    pausedRef: React.MutableRefObject<boolean>;
    targetingModeRef: React.MutableRefObject<{ casterId: number; skill: import("../core/types").Skill } | null>;
    skillCooldownsRef: React.MutableRefObject<Record<string, { end: number; duration: number }>>;
    actionQueueRef: React.MutableRefObject<ActionQueue>;
}

interface GameLoopCallbacks {
    setUnits: React.Dispatch<React.SetStateAction<Unit[]>>;
    setFps: React.Dispatch<React.SetStateAction<number>>;
    setSkillCooldowns: React.Dispatch<React.SetStateAction<Record<string, { end: number; duration: number }>>>;
    setQueuedActions: React.Dispatch<React.SetStateAction<{ unitId: number; skillName: string }[]>>;
    addLog: (text: string, color?: string) => void;
    processActionQueue: (defeatedThisFrame: Set<number>) => void;
    onPerfSample?: (sample: PerfFrameSample) => void;
}

interface UseGameLoopOptions {
    sceneState: InitializedSceneState | null;
    gameRefs: React.MutableRefObject<GameRefs>;
    stateRefs: GameLoopStateRefs;
    callbacks: GameLoopCallbacks;
    keysPressed: React.MutableRefObject<Set<string>>;
    debugFogOfWarDisabled: boolean;
}

export interface PerfFrameSample {
    timestamp: number;
    frameMs: number;
    fps: number;
    belowThreshold: boolean;
    paused: boolean;
    units: number;
    playersAlive: number;
    enemiesAlive: number;
    projectiles: number;
    damageTexts: number;
    acidTiles: number;
    sanctuaryTiles: number;
    lightsTotal: number;
    lightsVisible: number;
    drawCalls: number;
    triangles: number;
    geometries: number;
    textures: number;
    programs: number | null;
    jsHeapMb: number | null;
    cacheMs: number;
    visualMs: number;
    combatMs: number;
    projectilesMs: number;
    statusMs: number;
    fogMs: number;
    aiMs: number;
    unitAiMs: number;
    wallMs: number;
    lightLodMs: number;
    renderMs: number;
}

// =============================================================================
// VISUAL UPDATES (run every frame, even when paused)
// =============================================================================

const PERF_SAMPLE_FPS_THRESHOLD = 45;
const PERF_CAPTURE_WINDOW_MS = 5000;
const FPS_UI_SAMPLE_WINDOW_MS = 500;

function getProgramCount(info: THREE.WebGLInfo): number | null {
    const programs = Reflect.get(info, "programs");
    return Array.isArray(programs) ? programs.length : null;
}

function getJsHeapUsedMb(): number | null {
    const perf = Reflect.get(globalThis, "performance");
    if (!perf || typeof perf !== "object") return null;

    const memory = Reflect.get(perf, "memory");
    if (!memory || typeof memory !== "object") return null;

    const usedBytes = Reflect.get(memory, "usedJSHeapSize");
    if (typeof usedBytes !== "number" || !Number.isFinite(usedBytes)) return null;

    return usedBytes / (1024 * 1024);
}

function updateVisualEffects(
    sceneState: InitializedSceneState,
    gameRefs: GameRefs
): void {
    const { doorMeshes, waystoneMeshes } = sceneState;
    const now = getGameTime() * 0.001;

    // Door hover glow effect
    doorMeshes.forEach(doorMesh => {
        const mat = doorMesh.material as THREE.MeshBasicMaterial;
        const isHovered = doorMesh.userData.transition.targetArea === gameRefs.hoveredDoor;
        const targetOpacity = isHovered ? 0.35 : 0.08;
        mat.opacity += (targetOpacity - mat.opacity) * 0.15;
    });

    // Waystones gently bob and pulse to read as magical landmarks.
    waystoneMeshes.forEach(waystoneMesh => {
        const bob = Math.sin(now * 1.6 + waystoneMesh.userData.floatPhase) * 0.14;
        const pulse = 0.5 + 0.5 * Math.sin(now * 2.3 + waystoneMesh.userData.floatPhase);
        waystoneMesh.userData.floatGroup.position.y = waystoneMesh.userData.floatBaseY + bob;
        waystoneMesh.userData.floatGroup.rotation.y += 0.006;
        const glowMaterial = waystoneMesh.userData.glowRing.material as THREE.MeshBasicMaterial;
        glowMaterial.opacity = 0.16 + pulse * 0.08;
        waystoneMesh.userData.pointLight.intensity = 1.7 + pulse * 0.5;
    });
}

function updateKeyboardPanning(
    keysPressed: Set<string>,
    cameraOffset: { x: number; z: number },
    _camera: THREE.OrthographicCamera,
    updateCam: () => void
): void {
    let screenX = 0, screenY = 0;
    if (keysPressed.has("ArrowUp")) screenY -= 1;
    if (keysPressed.has("ArrowDown")) screenY += 1;
    if (keysPressed.has("ArrowLeft")) screenX -= 1;
    if (keysPressed.has("ArrowRight")) screenX += 1;

    if (screenX !== 0 || screenY !== 0) {
        const len = Math.hypot(screenX, screenY);
        const worldX = ((screenX / len) + (screenY / len)) * PAN_SPEED;
        const worldZ = (-(screenX / len) + (screenY / len)) * PAN_SPEED;
        const area = getCurrentArea();
        cameraOffset.x = Math.max(0, Math.min(area.gridWidth, cameraOffset.x + worldX));
        cameraOffset.z = Math.max(0, Math.min(area.gridHeight, cameraOffset.z + worldZ));
        updateCam();
    }
}

function updateMarkerAnimations(
    moveMarker: THREE.Mesh | null,
    moveMarkerStart: number,
    targetRings: Record<number, THREE.Mesh>,
    targetRingTimers: Record<number, number>,
    now: number
): void {
    // Animate move marker - rotate and fade out
    if (moveMarker?.visible) {
        moveMarker.rotation.z += 0.05;
        const markerAge = now - moveMarkerStart;
        const markerDuration = 1000;  // Linger for 1 second
        if (markerAge >= markerDuration) {
            moveMarker.visible = false;
        } else {
            // Fade out over the last half of the duration
            const fadeStart = markerDuration * 0.5;
            if (markerAge > fadeStart) {
                const fadeProgress = (markerAge - fadeStart) / (markerDuration - fadeStart);
                (moveMarker.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - fadeProgress);
            }
        }
    }

    // Update target rings - fade out over time
    const targetRingDuration = 1500;
    const targetRingFadeStart = 500;
    for (const idStr in targetRingTimers) {
        const id = Number(idStr);
        const ring = targetRings[id];
        if (!ring) continue;

        const age = now - targetRingTimers[id];
        if (age >= targetRingDuration) {
            ring.visible = false;
            delete targetRingTimers[id];
        } else if (age > targetRingFadeStart) {
            const fadeProgress = (age - targetRingFadeStart) / (targetRingDuration - targetRingFadeStart);
            (ring.material as THREE.MeshBasicMaterial).opacity = 1 - fadeProgress;
        }
    }
}

function updateRangeIndicator(
    targetingMode: { casterId: number; skill: import("../core/types").Skill } | null,
    rangeIndicator: THREE.Mesh | null,
    unitGroups: Record<number, UnitGroup>
): void {
    if (targetingMode && rangeIndicator?.visible) {
        const casterG = unitGroups[targetingMode.casterId];
        if (casterG) {
            rangeIndicator.position.x = casterG.position.x;
            rangeIndicator.position.z = casterG.position.z;
        }
    }
}

function updateAncestorAuraBonuses(
    units: Unit[],
    unitGroups: Record<number, UnitGroup>,
    setUnits: React.Dispatch<React.SetStateAction<Unit[]>>
): void {
    const auraSources: { id: number; x: number; z: number }[] = [];
    for (const u of units) {
        if (u.team === "player" && u.hp > 0 && u.summonType === "ancestor_warrior") {
            const group = unitGroups[u.id];
            auraSources.push({
                id: u.id,
                x: group?.position.x ?? u.x,
                z: group?.position.z ?? u.z
            });
        }
    }

    let changed = false;
    const nextBonusById: Record<number, number> = {};

    for (const unit of units) {
        if (unit.team !== "player") continue;

        let nextBonus = 0;
        if (unit.hp > 0 && auraSources.length > 0) {
            const unitGroup = unitGroups[unit.id];
            const unitX = unitGroup?.position.x ?? unit.x;
            const unitZ = unitGroup?.position.z ?? unit.z;

            for (const source of auraSources) {
                if (source.id === unit.id) continue;
                const dist = Math.hypot(unitX - source.x, unitZ - source.z);
                if (dist <= ANCESTOR_AURA_RANGE) {
                    nextBonus = ANCESTOR_AURA_DAMAGE_BONUS;
                    break;
                }
            }
        }

        const prevBonus = unit.auraDamageBonus ?? 0;
        nextBonusById[unit.id] = nextBonus;
        if (prevBonus !== nextBonus) {
            changed = true;
        }
    }

    if (!changed) return;

    setUnits(prev => prev.map(u => {
        if (u.team !== "player") return u;
        const nextBonus = nextBonusById[u.id] ?? 0;
        if ((u.auraDamageBonus ?? 0) === nextBonus) return u;
        return { ...u, auraDamageBonus: nextBonus };
    }));
}

function processEquipmentHpRegen(
    units: Unit[],
    unitGroups: Record<number, UnitGroup>,
    setUnits: React.Dispatch<React.SetStateAction<Unit[]>>,
    now: number
): void {
    const healingById = new Map<number, number>();

    for (const unit of units) {
        if (unit.team !== "player" || unit.hp <= 0) continue;

        const unitGroup = unitGroups[unit.id];
        if (!unitGroup) continue;
        const regenState = unitGroup.userData as typeof unitGroup.userData & {
            equipmentRegenNextTick?: number;
            equipmentRegenSignature?: string;
        };

        const regen = getEffectivePlayerHpRegen(unit.id);
        if (!regen) {
            delete regenState.equipmentRegenNextTick;
            delete regenState.equipmentRegenSignature;
            continue;
        }

        const signature = `${regen.amount}:${regen.interval}`;
        if (regenState.equipmentRegenSignature !== signature) {
            regenState.equipmentRegenSignature = signature;
            regenState.equipmentRegenNextTick = now + regen.interval;
            continue;
        }

        const nextTick = regenState.equipmentRegenNextTick;
        if (nextTick === undefined) {
            regenState.equipmentRegenNextTick = now + regen.interval;
            continue;
        }

        const maxHp = getEffectiveMaxHp(unit.id, unit);
        if (unit.hp >= maxHp) {
            regenState.equipmentRegenNextTick = now + regen.interval;
            continue;
        }

        if (now >= nextTick) {
            healingById.set(unit.id, regen.amount);
            regenState.equipmentRegenNextTick = nextTick + regen.interval;
        }
    }

    if (healingById.size === 0) return;

    setUnits(prev => prev.map(unit => {
        const healAmount = healingById.get(unit.id);
        if (!healAmount || unit.hp <= 0) return unit;
        const maxHp = getEffectiveMaxHp(unit.id, unit);
        if (unit.hp >= maxHp) return unit;
        return { ...unit, hp: Math.min(maxHp, unit.hp + healAmount) };
    }));
}

function processEnemyDeathAcidPools(
    units: Unit[],
    previousHpByIdRef: React.MutableRefObject<Map<number, number>>,
    unitGroups: Record<number, UnitGroup>,
    scene: THREE.Scene,
    acidTiles: Map<string, import("../core/types").AcidTile>,
    damageTexts: import("../core/types").DamageText[],
    setUnits: React.Dispatch<React.SetStateAction<Unit[]>>,
    now: number,
    gameNow: number,
    addLog: (text: string, color?: string) => void
): void {
    const rollHeal = (): number => {
        const [minHeal, maxHeal] = VISHAS_EYES_ORB_HEAL_RANGE;
        return Math.floor(Math.random() * (maxHeal - minHeal + 1)) + minHeal;
    };

    const triggerVishasEyeBurst = (orbUnit: Unit, centerX: number, centerZ: number, expired: boolean): void => {
        const healById = new Map<number, number>();

        for (const target of units) {
            if (target.team !== "player" || target.hp <= 0 || target.id === orbUnit.id) continue;
            const maxHp = getEffectiveMaxHp(target.id, target);
            if (target.hp >= maxHp) continue;
            const targetGroup = unitGroups[target.id];
            const targetX = targetGroup?.position.x ?? target.x;
            const targetZ = targetGroup?.position.z ?? target.z;
            const targetRadius = getUnitRadius(target);
            if (!isInRange(centerX, centerZ, targetX, targetZ, targetRadius, VISHAS_EYES_ORB_HEAL_RADIUS)) {
                continue;
            }
            healById.set(target.id, rollHeal());
        }

        if (healById.size === 0) return;

        setUnits(prev => prev.map(unit => {
            const healAmount = healById.get(unit.id);
            if (!healAmount || unit.hp <= 0) return unit;
            const maxHp = getEffectiveMaxHp(unit.id, unit);
            return { ...unit, hp: Math.min(maxHp, unit.hp + healAmount) };
        }));

        for (const [unitId, healAmount] of healById.entries()) {
            const targetGroup = unitGroups[unitId];
            if (!targetGroup) continue;
            spawnDamageNumber(
                scene,
                targetGroup.position.x,
                targetGroup.position.z,
                healAmount,
                COLORS.logHeal,
                damageTexts,
                true
            );
        }

        createAnimatedRing(scene, centerX, centerZ, COLORS.dmgHoly, {
            innerRadius: 0.2,
            outerRadius: 0.44,
            maxScale: VISHAS_EYES_ORB_HEAL_RADIUS + 0.6,
            duration: 320
        });

        addLog(
            expired
                ? `A Visha's Eye fades and restores nearby allies.`
                : `A Visha's Eye shatters, restoring nearby allies.`,
            COLORS.logHeal
        );
    };

    const previousHpById = previousHpByIdRef.current;

    for (const unit of units) {
        const previousHp = previousHpById.get(unit.id);
        const diedThisFrame = previousHp !== undefined && previousHp > 0 && unit.hp <= 0;
        if (!diedThisFrame) continue;

        if (unit.team === "player" && unit.summonType === "vishas_eye_orb") {
            const unitGroup = unitGroups[unit.id];
            const centerX = unitGroup?.position.x ?? unit.x;
            const centerZ = unitGroup?.position.z ?? unit.z;
            const expired = unit.summonExpireAt !== undefined && gameNow >= unit.summonExpireAt;
            triggerVishasEyeBurst(unit, centerX, centerZ, expired);
        }

        if (unit.team !== "enemy" || !unit.enemyType) {
            continue;
        }

        const enemyStats = ENEMY_STATS[unit.enemyType];
        const deathPool = enemyStats.deathAcidPool;
        if (!deathPool) {
            continue;
        }

        const unitGroup = unitGroups[unit.id];
        const centerX = unitGroup?.position.x ?? unit.x;
        const centerZ = unitGroup?.position.z ?? unit.z;

        const touchedTiles = createAcidPool(
            scene,
            acidTiles,
            centerX,
            centerZ,
            unit.id,
            now,
            deathPool.radius,
            deathPool.duration
        );
        if (touchedTiles > 0) {
            addLog(`${enemyStats.name} bursts into acid!`, COLORS.acidText);
        }
    }

    // Update the map in-place for next frame
    previousHpById.clear();
    for (const unit of units) {
        previousHpById.set(unit.id, unit.hp);
    }
}

function expireVishasEyeSummons(
    units: Unit[],
    unitGroups: Record<number, UnitGroup>,
    setUnits: React.Dispatch<React.SetStateAction<Unit[]>>,
    addLog: (text: string, color?: string) => void,
    gameNow: number
): void {
    const expiringOrbs = units.filter(unit =>
        unit.team === "player"
        && unit.summonType === "vishas_eye_orb"
        && unit.hp > 0
        && unit.summonExpireAt !== undefined
        && gameNow >= unit.summonExpireAt
    );

    if (expiringOrbs.length === 0) return;

    const expiringIds = new Set<number>(expiringOrbs.map(unit => unit.id));
    setUnits(prev => prev.map(unit => (expiringIds.has(unit.id) ? { ...unit, hp: 0, statusEffects: undefined } : unit)));

    for (const orb of expiringOrbs) {
        const orbGroup = unitGroups[orb.id];
        if (!orbGroup) continue;
        handleUnitDefeat(orb.id, orbGroup, unitGroups, addLog, "Visha's Eye", true);
    }
}

// =============================================================================
// HOOK
// =============================================================================

export function useGameLoop({
    sceneState,
    gameRefs,
    stateRefs,
    callbacks,
    keysPressed,
    debugFogOfWarDisabled
}: UseGameLoopOptions): void {
    // FPS tracking refs
    const fpsFrameCount = useRef(0);
    const fpsLastTime = useRef<number | null>(null);
    const perfCaptureUntilRef = useRef(0);
    const previousHpByIdRef = useRef<Map<number, number>>(new Map());

    const updateCam = useCallback(() => {
        if (sceneState?.camera) {
            updateCamera(sceneState.camera, gameRefs.current.cameraOffset);
        }
    }, [sceneState, gameRefs]);

    useEffect(() => {
        if (!sceneState) {
            return;
        }

        const {
            scene, camera, renderer, flames, candleLights, fogTexture, fogMesh, moveMarker,
            rangeIndicator, unitGroups, selectRings, targetRings, shieldIndicators,
            unitMeshes, unitOriginalColors, maxHp, wallMeshes, treeMeshes, fogOccluderMeshes,
            columnMeshes, columnGroups, billboards, candleMeshes, waterMesh, rainOverlay,
            hpBarGroups
        } = sceneState;

        let animId: number;
        const playerUnitsBuffer: Unit[] = [];
        const spatialAliveEntriesBuffer: UnitSpatialEntry[] = [];
        const spatialTargetingEntriesBuffer: UnitSpatialEntry[] = [];
        let fogVisualTransitionsActive = true;
        previousHpByIdRef.current = new Map(stateRefs.unitsStateRef.current.map(unit => [unit.id, unit.hp]));
        const setUnitsLive = createLiveUnitsDispatch(callbacks.setUnits, stateRefs.unitsStateRef);

        fpsFrameCount.current = 0;
        fpsLastTime.current = null;

        const animate = (rafNow: number) => {
            const frameStart = performance.now();
            animId = requestAnimationFrame(animate);
            const now = Date.now();
            updateGameClock();
            const gameNow = getGameTime();
            const refs = gameRefs.current;
            const isPaused = stateRefs.pausedRef.current;

            // Snapshot units and populate O(1) lookup caches for all systems this frame
            let currentUnits = stateRefs.unitsStateRef.current;
            const initialUnitsSnapshot = currentUnits;
            let sectionStart = performance.now();
            updateUnitCache(currentUnits);
            clearUnitStatsCache();
            const cacheMs = performance.now() - sectionStart;

            if (!isPaused) {
                expireVishasEyeSummons(
                    currentUnits,
                    unitGroups,
                    setUnitsLive,
                    callbacks.addLog,
                    gameNow
                );
            }

            processEnemyDeathAcidPools(
                currentUnits,
                previousHpByIdRef,
                unitGroups,
                scene,
                refs.acidTiles,
                refs.damageTexts,
                setUnitsLive,
                now,
                gameNow,
                callbacks.addLog
            );

            // FPS counter
            if (fpsLastTime.current === null) {
                fpsLastTime.current = rafNow;
            }
            fpsFrameCount.current++;
            const fpsElapsedMs = rafNow - fpsLastTime.current;
            if (fpsElapsedMs >= FPS_UI_SAMPLE_WINDOW_MS) {
                const measuredFps = fpsFrameCount.current * (1000 / fpsElapsedMs);
                callbacks.setFps(Math.round(measuredFps));
                fpsFrameCount.current = 0;
                fpsLastTime.current = rafNow;
            }

            // Visual effects (doors), camera panning, and damage text updates
            sectionStart = performance.now();
            updateVisualEffects(sceneState, refs);
            updateKeyboardPanning(keysPressed.current, refs.cameraOffset, camera, updateCam);
            refs.damageTexts = updateDamageTexts(refs.damageTexts, camera, scene, isPaused);
            let visualMs = performance.now() - sectionStart;

            // Track units defeated this frame
            const defeatedThisFrame = new Set<number>();
            let projectilesMs = 0;
            let statusMs = 0;
            let combatMs = 0;

            // Game logic updates (only when not paused)
            if (!isPaused) {
                const combatStart = performance.now();
                updateAncestorAuraBonuses(currentUnits, unitGroups, setUnitsLive);
                processEquipmentHpRegen(currentUnits, unitGroups, setUnitsLive, now);

                // Update projectiles
                sectionStart = performance.now();
                refs.projectiles = updateProjectiles(
                    refs.projectiles,
                    unitGroups,
                    currentUnits,
                    scene,
                    refs.damageTexts,
                    refs.hitFlash,
                    setUnitsLive,
                    callbacks.addLog,
                    now,
                    defeatedThisFrame
                );
                projectilesMs = performance.now() - sectionStart;
                pruneStaleVolleys(now);

                // Process status effects
                sectionStart = performance.now();
                processStatusEffects(
                    currentUnits,
                    unitGroups,
                    scene,
                    refs.damageTexts,
                    refs.hitFlash,
                    setUnitsLive,
                    callbacks.addLog,
                    now,
                    defeatedThisFrame
                );
                statusMs = performance.now() - sectionStart;

                // Process acid tiles
                processAcidTiles(
                    refs.acidTiles,
                    currentUnits,
                    unitGroups,
                    scene,
                    refs.damageTexts,
                    refs.hitFlash,
                    setUnitsLive,
                    callbacks.addLog,
                    now,
                    defeatedThisFrame
                );

                // Process sanctuary tiles
                processSanctuaryTiles(
                    refs.sanctuaryTiles,
                    currentUnits,
                    unitGroups,
                    scene,
                    refs.damageTexts,
                    setUnitsLive,
                    callbacks.addLog,
                    now
                );

                // Process holy tiles
                processHolyTiles(
                    refs.holyTiles,
                    currentUnits,
                    unitGroups,
                    scene,
                    refs.damageTexts,
                    refs.hitFlash,
                    setUnitsLive,
                    callbacks.addLog,
                    now,
                    defeatedThisFrame
                );

                // Process smoke tiles
                processSmokeTiles(
                    refs.smokeTiles,
                    currentUnits,
                    unitGroups,
                    scene,
                    setUnitsLive,
                    now
                );

                // Process fire tiles
                processFireTiles(
                    refs.fireTiles,
                    currentUnits,
                    unitGroups,
                    scene,
                    refs.damageTexts,
                    refs.hitFlash,
                    setUnitsLive,
                    callbacks.addLog,
                    now,
                    defeatedThisFrame
                );

                // Process charge attacks
                processChargeAttacks(
                    scene,
                    currentUnits,
                    unitGroups,
                    refs.damageTexts,
                    refs.hitFlash,
                    setUnitsLive,
                    callbacks.addLog,
                    now,
                    defeatedThisFrame
                );

                // Process necromancer curses
                processCurses(
                    scene,
                    currentUnits,
                    unitGroups,
                    refs.damageTexts,
                    refs.hitFlash,
                    setUnitsLive,
                    callbacks.addLog,
                    now,
                    defeatedThisFrame
                );

                // Process fire breaths
                processFireBreaths(
                    scene,
                    currentUnits,
                    unitGroups,
                    refs.damageTexts,
                    refs.hitFlash,
                    setUnitsLive,
                    callbacks.addLog,
                    now,
                    defeatedThisFrame
                );

                // Process basilisk glares
                processGlares(
                    scene,
                    currentUnits,
                    unitGroups,
                    refs.damageTexts,
                    refs.hitFlash,
                    setUnitsLive,
                    callbacks.addLog,
                    now,
                    defeatedThisFrame
                );

                // Update leaps
                updateLeaps(
                    now,
                    unitGroups,
                    stateRefs.unitsStateRef as React.MutableRefObject<Unit[]>,
                    setUnitsLive,
                    { current: refs.hitFlash } as React.MutableRefObject<Record<number, number>>,
                    callbacks.addLog,
                    scene,
                    refs.damageTexts,
                    defeatedThisFrame
                );

                // Update tentacles
                updateTentacles(now, unitGroups, setUnitsLive, callbacks.addLog);

                // Update submerged krakens
                updateSubmergedKrakens(now, unitGroups, callbacks.addLog);

                // Update Wandering Shade phase timing
                processShadePhases(now, currentUnits, callbacks.addLog);

                // Update energy shield visuals
                updateEnergyShieldVisuals(currentUnits, unitGroups, gameNow);

                // Update shield facing
                updateShieldFacing(currentUnits, unitGroups, shieldIndicators, setUnitsLive);
                combatMs = performance.now() - combatStart;
            }

            // Re-snapshot after combat mutations so FoW/AI consume fresh unit state.
            currentUnits = stateRefs.unitsStateRef.current;
            if (currentUnits !== initialUnitsSnapshot) {
                updateUnitCache(currentUnits);
                clearUnitStatsCache();
            }

            // Visual updates (run even when paused)
            sectionStart = performance.now();
            updateHitFlash(refs.hitFlash, unitMeshes, unitOriginalColors, now);
            updatePoisonVisuals(currentUnits, unitMeshes, unitOriginalColors, refs.hitFlash);
            visualMs += performance.now() - sectionStart;

            // Fog of war
            sectionStart = performance.now();
            // Reuse array to avoid per-frame allocation (typically 4-6 player units)
            playerUnitsBuffer.length = 0;
            for (let i = 0; i < currentUnits.length; i++) {
                const u = currentUnits[i];
                if (u.team === "player" && u.hp > 0) playerUnitsBuffer.push(u);
            }
            const playerUnits = playerUnitsBuffer;
            let fogVisibilityChanged = false;
                if (fogTexture && fogMesh) {
                    fogVisibilityChanged = updateFogOfWar(
                        refs.visibility,
                        playerUnits,
                        unitGroups,
                        fogTexture,
                        currentUnits,
                        fogMesh,
                        debugFogOfWarDisabled
                    );
                }

                if (getCurrentArea().hasFogOfWar && !debugFogOfWarDisabled) {
                    // Update tree and tall obstacle visibility only when visibility changes
                    // or while previous transitions are still animating.
                    if (fogVisibilityChanged || fogVisualTransitionsActive) {
                        const treeTransitionsActive = updateTreeFogVisibility(treeMeshes, refs.visibility);
                        const occluderTransitionsActive = updateFogOccluderVisibility(fogOccluderMeshes, refs.visibility);
                        fogVisualTransitionsActive = treeTransitionsActive || occluderTransitionsActive;
                    }
                } else {
                    revealAllTreeMeshes(treeMeshes);
                    revealAllFogOccluderMeshes(fogOccluderMeshes);
                    fogVisualTransitionsActive = false;
                }
            const fogMs = performance.now() - sectionStart;
            let aiMs = 0;
            let unitAiMs = 0;

            // Unit AI & movement (only when not paused)
            if (!isPaused) {
                const aiStart = performance.now();
                callbacks.processActionQueue(defeatedThisFrame);

                // Check for newly spawned units
                for (let i = 0; i < currentUnits.length; i++) {
                    const unit = currentUnits[i];
                    if (!unitGroups[unit.id] && unit.hp > 0) {
                        addUnitToScene(
                            scene,
                            unit,
                            unitGroups,
                            selectRings,
                            targetRings,
                            shieldIndicators,
                            unitMeshes,
                            unitOriginalColors,
                            maxHp,
                            billboards,
                            hpBarGroups
                        );
                        refs.paths[unit.id] = [];
                    }
                }

                // Remove visual bump offsets before AI reads positions
                removeBumpOffsets(unitGroups);

                // Update pathfinding obstacles
                const spatialFrame = buildUnitSpatialFrame(
                    currentUnits,
                    unitGroups,
                    defeatedThisFrame,
                    {
                        aliveEntries: spatialAliveEntriesBuffer,
                        targetingEntries: spatialTargetingEntriesBuffer
                    }
                );
                updateDynamicObstacles(currentUnits, unitGroups, undefined, spatialFrame);
                updateTargetingCache(currentUnits, unitGroups, defeatedThisFrame, spatialFrame);
                updateAvoidanceCache(currentUnits, unitGroups, spatialFrame);

                // Update each unit's AI
                sectionStart = performance.now();
                for (let i = 0; i < currentUnits.length; i++) {
                    const unit = currentUnits[i];
                    const g = unitGroups[unit.id];
                    if (!g || unit.hp <= 0) continue;
                    updateUnitAI(
                        unit, g, unitGroups, currentUnits, refs.visibility,
                        refs.paths, refs.actionCooldown, refs.hitFlash,
                        refs.projectiles, refs.damageTexts, refs.swingAnimations,
                        refs.moveStart, scene, setUnitsLive, callbacks.addLog, now,
                        defeatedThisFrame,
                        stateRefs.skillCooldownsRef.current, callbacks.setSkillCooldowns,
                        stateRefs.actionQueueRef.current, callbacks.setQueuedActions,
                        refs.acidTiles
                    );
                }
                unitAiMs = performance.now() - sectionStart;

                // Update swing animations
                refs.swingAnimations = updateSwingAnimations(refs.swingAnimations, scene, now);

                // Sprite facing reads true positions (before bump offsets)
                updateSpriteFacing(currentUnits, unitGroups);

                // Re-apply bump offsets for rendering
                applyBumpOffsets(unitGroups, now);
                aiMs = performance.now() - aiStart;
            }

            // Marker animations
            sectionStart = performance.now();
            updateMarkerAnimations(moveMarker, refs.moveMarkerStart, targetRings, refs.targetRingTimers, now);
            updateRangeIndicator(stateRefs.targetingModeRef.current, rangeIndicator, unitGroups);
            updateLightning(scene, renderer, gameNow);
            updateWater(waterMesh, gameNow, camera);
            updateRain(rainOverlay, camera, gameNow);
            visualMs += performance.now() - sectionStart;

            // Shared transient effect animations (rings, beams, flash overlays, etc.)
            updateEffectAnimations(gameNow);

            // Wall/tree/candle transparency
            sectionStart = performance.now();
            updateWallTransparency(camera, wallMeshes, unitGroups, currentUnits, treeMeshes, columnMeshes, columnGroups, candleMeshes, flames);
            const wallMs = performance.now() - sectionStart;

            // Light LOD
            sectionStart = performance.now();
            updateLightLOD(candleLights, refs.cameraOffset);
            const lightLodMs = performance.now() - sectionStart;

            sectionStart = performance.now();
            updateAncestorGhostVisuals(currentUnits, unitGroups, unitMeshes, gameNow);

            // Billboard rotation + HP bars
            updateBillboards(billboards, camera);
            updateHpBarBillboards(hpBarGroups);
            updateHpBars(hpBarGroups, unitGroups, currentUnits, maxHp);
            visualMs += performance.now() - sectionStart;

            // Render
            sectionStart = performance.now();
            renderer.render(scene, camera);
            const renderMs = performance.now() - sectionStart;

            const frameMs = performance.now() - frameStart;
            const fps = frameMs > 0 ? 1000 / frameMs : 0;
            const belowThreshold = fps < PERF_SAMPLE_FPS_THRESHOLD;
            if (belowThreshold) {
                perfCaptureUntilRef.current = now + PERF_CAPTURE_WINDOW_MS;
            }
            if (callbacks.onPerfSample && now <= perfCaptureUntilRef.current) {
                let playersAlive = 0;
                let enemiesAlive = 0;
                for (const unit of currentUnits) {
                    if (unit.hp <= 0) continue;
                    if (unit.team === "player") {
                        playersAlive++;
                    } else if (unit.team === "enemy") {
                        enemiesAlive++;
                    }
                }

                let lightsVisible = 0;
                for (const light of candleLights) {
                    if (light.visible) lightsVisible++;
                }

                callbacks.onPerfSample?.({
                    timestamp: now,
                    frameMs,
                    fps,
                    belowThreshold,
                    paused: isPaused,
                    units: currentUnits.length,
                    playersAlive,
                    enemiesAlive,
                    projectiles: refs.projectiles.length,
                    damageTexts: refs.damageTexts.length,
                    acidTiles: refs.acidTiles.size,
                    sanctuaryTiles: refs.sanctuaryTiles.size,
                    lightsTotal: candleLights.length,
                    lightsVisible,
                    drawCalls: renderer.info.render.calls,
                    triangles: renderer.info.render.triangles,
                    geometries: renderer.info.memory.geometries,
                    textures: renderer.info.memory.textures,
                    programs: getProgramCount(renderer.info),
                    jsHeapMb: getJsHeapUsedMb(),
                    cacheMs,
                    visualMs,
                    combatMs,
                    projectilesMs,
                    statusMs,
                    fogMs,
                    aiMs,
                    unitAiMs,
                    wallMs,
                    lightLodMs,
                    renderMs
                });
            }
        };

        // Schedule first frame instead of calling animate() directly
        // This prevents running game logic multiple times if the effect restarts
        animId = requestAnimationFrame(animate);

        return () => {
            cancelAnimationFrame(animId);
        };
    }, [sceneState, gameRefs, stateRefs, callbacks, keysPressed, updateCam, debugFogOfWarDisabled]);
}
