/**
 * Hook for managing the game loop (requestAnimationFrame)
 * Extracts game loop logic from App.tsx for better organization
 */

import { useEffect, useRef, useCallback } from "react";
import * as THREE from "three";
import { PAN_SPEED, ANCESTOR_AURA_DAMAGE_BONUS, ANCESTOR_AURA_RANGE } from "../core/constants";
import { updateGameClock } from "../core/gameClock";
import { getCurrentArea } from "../game/areas";
import type { Unit, UnitGroup } from "../core/types";
import { updateCamera, updateWallTransparency, updateTreeFogVisibility, updateFogOccluderVisibility, updateLightLOD, addUnitToScene, updateWater, updateBillboards } from "../rendering/scene";
import { updateDynamicObstacles } from "../ai/pathfinding";
import { updateUnitCache } from "../game/unitQuery";
import { clearUnitStatsCache } from "../game/units";
import {
    updateDamageTexts,
    updateHitFlash,
    updateProjectiles,
    updateFogOfWar,
    updateUnitAI,
    updateHpBarPositions,
    updateSwingAnimations,
    processStatusEffects,
    updatePoisonVisuals,
    updateEnergyShieldVisuals,
    updateShieldFacing,
    processAcidTiles,
    processSanctuaryTiles,
    processChargeAttacks,
    processFireBreaths,
    processCurses,
    processGlares,
    updateLeaps,
    updateTentacles,
    updateSubmergedKrakens,
    updateSpriteFacing,
    updateAncestorGhostVisuals
} from "../gameLoop";
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

export interface GameLoopStateRefs {
    unitsStateRef: React.MutableRefObject<Unit[]>;
    pausedRef: React.MutableRefObject<boolean>;
    targetingModeRef: React.MutableRefObject<{ casterId: number; skill: import("../core/types").Skill } | null>;
    skillCooldownsRef: React.MutableRefObject<Record<string, { end: number; duration: number }>>;
    actionQueueRef: React.MutableRefObject<ActionQueue>;
}

export interface GameLoopCallbacks {
    setUnits: React.Dispatch<React.SetStateAction<Unit[]>>;
    setFps: React.Dispatch<React.SetStateAction<number>>;
    setHpBarPositions: React.Dispatch<React.SetStateAction<{ positions: Record<number, { x: number; y: number; visible: boolean }>; scale: number }>>;
    setSkillCooldowns: React.Dispatch<React.SetStateAction<Record<string, { end: number; duration: number }>>>;
    setQueuedActions: React.Dispatch<React.SetStateAction<{ unitId: number; skillName: string }[]>>;
    addLog: (text: string, color?: string) => void;
    processActionQueue: (defeatedThisFrame: Set<number>) => void;
}

export interface UseGameLoopOptions {
    sceneState: InitializedSceneState | null;
    gameRefs: React.MutableRefObject<GameRefs>;
    stateRefs: GameLoopStateRefs;
    callbacks: GameLoopCallbacks;
    keysPressed: React.MutableRefObject<Set<string>>;
}

// =============================================================================
// VISUAL UPDATES (run every frame, even when paused)
// =============================================================================

function updateVisualEffects(
    sceneState: InitializedSceneState,
    gameRefs: GameRefs,
    now: number
): void {
    const { flames, candleLights, doorMeshes } = sceneState;

    // Flickering flames - slow, intense flicker
    flames.forEach((flame: THREE.Mesh, i: number) => {
        const flicker = 0.6 + Math.sin(now * 0.004 + i * 2) * 0.25 + Math.random() * 0.1;
        flame.scale.y = 1.6 + Math.sin(now * 0.005 + i) * 0.5;
        (flame.material as THREE.MeshBasicMaterial).opacity = flicker;
    });

    // Room lights flicker subtly
    candleLights.forEach((light: THREE.PointLight, i: number) => {
        light.intensity = 12 + Math.sin(now * 0.003 + i * 1.7) * 3 + Math.random() * 1;
    });

    // Door hover glow effect
    doorMeshes.forEach(doorMesh => {
        const mat = doorMesh.material as THREE.MeshBasicMaterial;
        const isHovered = doorMesh.userData.transition.targetArea === gameRefs.hoveredDoor;
        const targetOpacity = isHovered ? 0.35 : 0.08;
        mat.opacity += (targetOpacity - mat.opacity) * 0.15;
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
    Object.entries(targetRingTimers).forEach(([idStr, startTime]) => {
        const id = Number(idStr);
        const ring = targetRings[id];
        if (!ring) return;

        const age = now - startTime;
        if (age >= targetRingDuration) {
            ring.visible = false;
            delete targetRingTimers[id];
        } else if (age > targetRingFadeStart) {
            const fadeProgress = (age - targetRingFadeStart) / (targetRingDuration - targetRingFadeStart);
            (ring.material as THREE.MeshBasicMaterial).opacity = 1 - fadeProgress;
        }
    });
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
    const auraSources = units
        .filter(u => u.team === "player" && u.hp > 0 && u.summonType === "ancestor_warrior")
        .map(u => {
            const group = unitGroups[u.id];
            return {
                id: u.id,
                x: group?.position.x ?? u.x,
                z: group?.position.z ?? u.z
            };
        });

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

// =============================================================================
// HOOK
// =============================================================================

export function useGameLoop({
    sceneState,
    gameRefs,
    stateRefs,
    callbacks,
    keysPressed
}: UseGameLoopOptions): void {
    // FPS tracking refs
    const fpsFrameCount = useRef(0);
    const fpsLastTime = useRef(Date.now());

    const updateCam = useCallback(() => {
        if (sceneState?.camera) {
            updateCamera(sceneState.camera, gameRefs.current.cameraOffset);
        }
    }, [sceneState?.camera, gameRefs]);

    useEffect(() => {
        if (!sceneState) return;

        const {
            scene, camera, renderer, flames, candleLights, fogTexture, fogMesh, moveMarker,
            rangeIndicator, unitGroups, selectRings, targetRings, shieldIndicators,
            unitMeshes, unitOriginalColors, maxHp, wallMeshes, treeMeshes, fogOccluderMeshes,
            columnMeshes, columnGroups, waterMesh, billboards, candleMeshes
        } = sceneState;

        let animId: number;
        let hpBarFrame = 0;
        let cachedRect = renderer.domElement.getBoundingClientRect();

        const animate = () => {
            animId = requestAnimationFrame(animate);
            const now = Date.now();
            updateGameClock();
            const refs = gameRefs.current;

            // Snapshot units and populate O(1) lookup caches for all systems this frame
            const currentUnits = stateRefs.unitsStateRef.current;
            updateUnitCache(currentUnits);
            clearUnitStatsCache();

            // FPS counter
            fpsFrameCount.current++;
            if (now - fpsLastTime.current >= 1000) {
                callbacks.setFps(fpsFrameCount.current);
                fpsFrameCount.current = 0;
                fpsLastTime.current = now;
            }

            // Visual effects (flames, lights, doors)
            updateVisualEffects(sceneState, refs, now);

            // Keyboard panning
            updateKeyboardPanning(keysPressed.current, refs.cameraOffset, camera, updateCam);

            // Update damage texts
            refs.damageTexts = updateDamageTexts(refs.damageTexts, camera, scene, stateRefs.pausedRef.current);

            // Track units defeated this frame
            const defeatedThisFrame = new Set<number>();

            // Game logic updates (only when not paused)
            if (!stateRefs.pausedRef.current) {
                updateAncestorAuraBonuses(currentUnits, unitGroups, callbacks.setUnits);

                // Update projectiles
                refs.projectiles = updateProjectiles(
                    refs.projectiles,
                    unitGroups,
                    currentUnits,
                    scene,
                    refs.damageTexts,
                    refs.hitFlash,
                    callbacks.setUnits,
                    callbacks.addLog,
                    now,
                    defeatedThisFrame
                );

                // Process status effects
                processStatusEffects(
                    currentUnits,
                    unitGroups,
                    scene,
                    refs.damageTexts,
                    refs.hitFlash,
                    callbacks.setUnits,
                    callbacks.addLog,
                    now,
                    defeatedThisFrame
                );

                // Process acid tiles
                processAcidTiles(
                    refs.acidTiles,
                    currentUnits,
                    unitGroups,
                    scene,
                    refs.damageTexts,
                    refs.hitFlash,
                    callbacks.setUnits,
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
                    callbacks.setUnits,
                    callbacks.addLog,
                    now
                );

                // Process charge attacks
                processChargeAttacks(
                    scene,
                    currentUnits,
                    unitGroups,
                    refs.damageTexts,
                    refs.hitFlash,
                    callbacks.setUnits,
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
                    callbacks.setUnits,
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
                    callbacks.setUnits,
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
                    callbacks.setUnits,
                    callbacks.addLog,
                    now,
                    defeatedThisFrame
                );

                // Update leaps
                updateLeaps(
                    now,
                    unitGroups,
                    stateRefs.unitsStateRef as React.MutableRefObject<Unit[]>,
                    callbacks.setUnits,
                    { current: refs.hitFlash } as React.MutableRefObject<Record<number, number>>,
                    callbacks.addLog,
                    scene,
                    refs.damageTexts,
                    defeatedThisFrame
                );

                // Update tentacles
                updateTentacles(now, currentUnits, unitGroups, callbacks.setUnits, callbacks.addLog);

                // Update submerged krakens
                updateSubmergedKrakens(now, currentUnits, unitGroups, callbacks.addLog);

                // Update energy shield visuals
                updateEnergyShieldVisuals(currentUnits, unitGroups, now);

                // Update shield facing
                updateShieldFacing(currentUnits, unitGroups, shieldIndicators, callbacks.setUnits);
            }

            // Visual updates (run even when paused)
            updateHitFlash(refs.hitFlash, unitMeshes, unitOriginalColors, now);
            updatePoisonVisuals(currentUnits, unitMeshes, unitOriginalColors, refs.hitFlash);

            // Fog of war
            const playerUnits = currentUnits.filter(u => u.team === "player" && u.hp > 0);
            if (fogTexture && fogMesh) {
                updateFogOfWar(refs.visibility, playerUnits, unitGroups, fogTexture, currentUnits, fogMesh);
            }

            if (getCurrentArea().hasFogOfWar) {
                // Update tree and tall obstacle visibility based on fog
                updateTreeFogVisibility(treeMeshes, refs.visibility);
                updateFogOccluderVisibility(fogOccluderMeshes, refs.visibility);
            }

            // Unit AI & movement (only when not paused)
            if (!stateRefs.pausedRef.current) {
                callbacks.processActionQueue(defeatedThisFrame);

                // Check for newly spawned units
                currentUnits.forEach(unit => {
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
                            billboards
                        );
                        refs.paths[unit.id] = [];
                    }
                });

                // Update pathfinding obstacles
                updateDynamicObstacles(currentUnits, unitGroups);

                // Update each unit's AI
                currentUnits.forEach(unit => {
                    const g = unitGroups[unit.id];
                    if (!g || unit.hp <= 0) return;
                    updateUnitAI(
                        unit, g, unitGroups, currentUnits, refs.visibility,
                        refs.paths, refs.actionCooldown, refs.hitFlash,
                        refs.projectiles, refs.damageTexts, refs.swingAnimations,
                        refs.moveStart, scene, callbacks.setUnits, callbacks.addLog, now,
                        defeatedThisFrame,
                        stateRefs.skillCooldownsRef.current, callbacks.setSkillCooldowns,
                        stateRefs.actionQueueRef.current, callbacks.setQueuedActions,
                        refs.acidTiles
                    );
                });

                // Update swing animations
                refs.swingAnimations = updateSwingAnimations(refs.swingAnimations, scene, now);
            }

            // Marker animations
            updateMarkerAnimations(moveMarker, refs.moveMarkerStart, targetRings, refs.targetRingTimers, now);

            // Range indicator follows caster
            updateRangeIndicator(stateRefs.targetingModeRef.current, rangeIndicator, unitGroups);

            // HP bar positions (rect measurement cached — only re-measured every 60 frames)
            hpBarFrame++;
            if (hpBarFrame % 60 === 0) {
                cachedRect = renderer.domElement.getBoundingClientRect();
            }
            callbacks.setHpBarPositions(updateHpBarPositions(currentUnits, unitGroups, camera, cachedRect, refs.zoomLevel));

            // Wall/tree/candle transparency
            updateWallTransparency(camera, wallMeshes, unitGroups, currentUnits, treeMeshes, columnMeshes, columnGroups, candleMeshes, flames);

            // Light LOD
            updateLightLOD(candleLights, refs.cameraOffset);

            // Water animation
            updateWater(waterMesh, now);

            // Sprite facing direction (before billboard rotation so scale is current)
            updateSpriteFacing(currentUnits, unitGroups);
            updateAncestorGhostVisuals(currentUnits, unitGroups, unitMeshes, now);

            // Billboard rotation
            updateBillboards(billboards, camera);

            // Render
            renderer.render(scene, camera);
        };

        // Schedule first frame instead of calling animate() directly
        // This prevents running game logic multiple times if the effect restarts
        animId = requestAnimationFrame(animate);

        return () => {
            cancelAnimationFrame(animId);
        };
    }, [sceneState, gameRefs, stateRefs, callbacks, keysPressed, updateCam]);
}
