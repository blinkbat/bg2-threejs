// =============================================================================
// SCENE UPDATES - Functions for updating scene elements during game loop
// =============================================================================

import * as THREE from "three";
import type { Unit, UnitGroup } from "../../core/types";
import type { ChestMeshData } from "./types";

interface LiquidTileAnimationData {
    liquidType: "water" | "lava";
    baseY: number;
    wavePhase: number;
    waveSpeed: number;
    baseColor: THREE.Color;
    hotColor?: THREE.Color;
    baseEmissiveIntensity: number;
}

function readLiquidData(value: unknown): LiquidTileAnimationData | null {
    if (!value || typeof value !== "object") return null;

    const liquidType = Reflect.get(value, "liquidType");
    const baseY = Reflect.get(value, "baseY");
    const wavePhase = Reflect.get(value, "wavePhase");
    const waveSpeed = Reflect.get(value, "waveSpeed");
    const baseColor = Reflect.get(value, "baseColor");
    const hotColor = Reflect.get(value, "hotColor");
    const baseEmissiveIntensity = Reflect.get(value, "baseEmissiveIntensity");

    if (liquidType !== "water" && liquidType !== "lava") return null;
    if (typeof baseY !== "number" || typeof wavePhase !== "number" || typeof waveSpeed !== "number") return null;
    if (!(baseColor instanceof THREE.Color)) return null;

    return {
        liquidType,
        baseY,
        wavePhase,
        waveSpeed,
        baseColor,
        hotColor: hotColor instanceof THREE.Color ? hotColor : undefined,
        baseEmissiveIntensity: typeof baseEmissiveIntensity === "number" ? baseEmissiveIntensity : 0.8,
    };
}

// =============================================================================
// CHEST STATE
// =============================================================================

/** Update chest open/closed state based on opened chests set */
export function updateChestStates(chestMeshes: ChestMeshData[], openedChests: Set<string>): void {
    for (const chest of chestMeshes) {
        const isOpen = openedChests.has(chest.chestKey);
        // Rotate lid open (about -110 degrees on X axis) or closed
        chest.lidPivot.rotation.x = isOpen ? -1.92 : 0;  // ~-110 degrees
        // Hide buckle when open
        chest.buckle.visible = !isOpen;
    }
}

// =============================================================================
// CAMERA
// =============================================================================

export function updateCamera(camera: THREE.OrthographicCamera, offset: { x: number; z: number }): void {
    const d = 20;
    camera.position.set(offset.x + d, d, offset.z + d);
    camera.lookAt(offset.x, 0, offset.z);
}

// =============================================================================
// WATER
// =============================================================================

/**
 * Update animated liquid tiles (water + lava).
 */
export function updateWater(waterMesh: THREE.Object3D | null, time: number): void {
    if (!waterMesh) return;

    const t = time * 0.001;
    waterMesh.traverse((obj: THREE.Object3D) => {
        if (!(obj instanceof THREE.Mesh)) return;

        const liquidData = readLiquidData(obj.userData?.liquid);
        if (!liquidData) return;

        const mat = obj.material;
        if (!(mat instanceof THREE.MeshStandardMaterial)) return;

        const primaryWave = Math.sin(t * liquidData.waveSpeed + liquidData.wavePhase);
        const secondaryWave = Math.sin(t * (liquidData.waveSpeed * 1.6) + liquidData.wavePhase * 0.73);

        if (liquidData.liquidType === "water") {
            const shimmer = 0.5 + (primaryWave * 0.4 + secondaryWave * 0.6) * 0.5;
            mat.emissive.setRGB(0.02, 0.06, 0.09);
            mat.emissiveIntensity = 0.03 + shimmer * 0.045;
            mat.roughness = 0.52 + (1 - shimmer) * 0.08;
            mat.metalness = 0.08;
            return;
        }

        const pulse = 0.5 + (primaryWave * 0.7 + secondaryWave * 0.3) * 0.5;
        if (liquidData.baseColor && liquidData.hotColor) {
            mat.color.copy(liquidData.baseColor).lerp(liquidData.hotColor, pulse * 0.35);
        }
        mat.emissive.setRGB(1.0, 0.2, 0.05);
        mat.emissiveIntensity = (liquidData.baseEmissiveIntensity ?? 0.8) + pulse * 0.35;
        mat.roughness = 0.36 + (1 - pulse) * 0.12;
        mat.metalness = 0.16;
    });
}

// =============================================================================
// BILLBOARDS
// =============================================================================

/**
 * Update billboard meshes to face the camera.
 */
export function updateBillboards(billboards: THREE.Mesh[], camera: THREE.Camera): void {
    for (const billboard of billboards) {
        billboard.quaternion.copy(camera.quaternion);
        const group = billboard.parent as UnitGroup | null;
        if (group?.userData?.facingRight === false) {
            billboard.scale.x = -Math.abs(billboard.scale.x);
        } else {
            billboard.scale.x = Math.abs(billboard.scale.x);
        }
    }
}

// =============================================================================
// LIGHT LOD
// =============================================================================

// Light LOD: only enable lights within this distance of camera focus
const LIGHT_LOD_DISTANCE = 25;

/**
 * Update light LOD - disable lights that are far from camera to save GPU cycles.
 * Since we now have ~9 room lights instead of 72, this is less critical but still helpful.
 */
export function updateLightLOD(
    candleLights: THREE.PointLight[],
    cameraOffset: { x: number; z: number }
): void {
    for (const light of candleLights) {
        const dx = light.position.x - cameraOffset.x;
        const dz = light.position.z - cameraOffset.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        // Enable light if within LOD distance, disable if far away
        light.visible = dist < LIGHT_LOD_DISTANCE;
    }
}

// =============================================================================
// WALL TRANSPARENCY / OCCLUSION
// =============================================================================

// Opacity values for wall/tree transparency
const WALL_OPACITY_NORMAL = 1.0;
const WALL_OPACITY_OCCLUDING = 0.25;
const WALL_OPACITY_LERP_SPEED = 0.15;  // How fast walls fade in/out

// Reusable objects to avoid allocations every frame
const _unitPos = new THREE.Vector3();
const _cameraPos = new THREE.Vector3();
const _dirToUnit = new THREE.Vector3();
const _intersection = new THREE.Vector3();
const _ray = new THREE.Ray();
const _meshBox = new THREE.Box3();

/** Get or compute a cached bounding box for a static mesh. */
function getCachedBox(mesh: THREE.Mesh): THREE.Box3 {
    let cached = mesh.userData.cachedBox as THREE.Box3 | undefined;
    if (!cached) {
        cached = new THREE.Box3().setFromObject(mesh);
        mesh.userData.cachedBox = cached;
    }
    _meshBox.copy(cached);
    return _meshBox;
}

// Throttle expensive ray-box tests - only recalculate every N frames
const WALL_CHECK_INTERVAL = 3;
let wallCheckFrame = 0;
let cachedOccludingMeshes = new Set<THREE.Mesh>();

/**
 * Update wall, tree, column, and candle transparency based on unit occlusion.
 * Objects between the camera and any unit become semi-transparent.
 * Ray-box intersection tests are throttled to every 3rd frame for performance.
 */
export function updateWallTransparency(
    camera: THREE.OrthographicCamera,
    wallMeshes: THREE.Mesh[],
    unitGroups: Record<number, UnitGroup>,
    unitsState: Unit[],
    treeMeshes?: THREE.Mesh[],
    columnMeshes?: THREE.Mesh[],
    columnGroups?: THREE.Mesh[][],
    candleMeshes?: THREE.Mesh[],
    flameMeshes?: THREE.Mesh[]
): void {
    wallCheckFrame++;

    // Only recalculate occlusion every N frames (expensive ray-box tests)
    if (wallCheckFrame >= WALL_CHECK_INTERVAL) {
        wallCheckFrame = 0;
        cachedOccludingMeshes.clear();

        _cameraPos.copy(camera.position);

        // Only check player units for occlusion (enemies don't need wall transparency)
        for (const unit of unitsState) {
            if (unit.hp <= 0 || unit.team !== "player") continue;
            const unitGroup = unitGroups[unit.id];
            if (!unitGroup || !unitGroup.visible) continue;

            _unitPos.set(unitGroup.position.x, 0.5, unitGroup.position.z);
            _dirToUnit.subVectors(_unitPos, _cameraPos).normalize();
            _ray.set(_cameraPos, _dirToUnit);

            const distToUnit = _cameraPos.distanceTo(_unitPos);

            // Check walls
            for (const mesh of wallMeshes) {
                if (cachedOccludingMeshes.has(mesh)) continue;  // Already marked
                getCachedBox(mesh);
                if (_ray.intersectBox(_meshBox, _intersection)) {
                    if (_cameraPos.distanceTo(_intersection) < distToUnit) {
                        cachedOccludingMeshes.add(mesh);
                    }
                }
            }

            // Check trees if provided
            if (treeMeshes) {
                for (const mesh of treeMeshes) {
                    if (cachedOccludingMeshes.has(mesh)) continue;
                    getCachedBox(mesh);
                    if (_ray.intersectBox(_meshBox, _intersection)) {
                        if (_cameraPos.distanceTo(_intersection) < distToUnit) {
                            cachedOccludingMeshes.add(mesh);
                        }
                    }
                }
            }

            // Check columns if provided - use groups so all parts fade together
            if (columnGroups) {
                for (const group of columnGroups) {
                    // Skip if already marked
                    if (group.some(mesh => cachedOccludingMeshes.has(mesh))) continue;
                    // Check if any part of the column is occluding
                    let groupOccludes = false;
                    for (const mesh of group) {
                        getCachedBox(mesh);
                        if (_ray.intersectBox(_meshBox, _intersection)) {
                            if (_cameraPos.distanceTo(_intersection) < distToUnit) {
                                groupOccludes = true;
                                break;
                            }
                        }
                    }
                    // If any part occludes, mark ALL parts of the column
                    if (groupOccludes) {
                        for (const mesh of group) {
                            cachedOccludingMeshes.add(mesh);
                        }
                    }
                }
            } else if (columnMeshes) {
                // Fallback: check individual meshes if no groups provided
                for (const mesh of columnMeshes) {
                    if (cachedOccludingMeshes.has(mesh)) continue;
                    getCachedBox(mesh);
                    if (_ray.intersectBox(_meshBox, _intersection)) {
                        if (_cameraPos.distanceTo(_intersection) < distToUnit) {
                            cachedOccludingMeshes.add(mesh);
                        }
                    }
                }
            }

            // Check candles if provided (use simple distance check - candles are small)
            if (candleMeshes) {
                for (let i = 0; i < candleMeshes.length; i++) {
                    const candle = candleMeshes[i];
                    if (cachedOccludingMeshes.has(candle)) continue;
                    // Simple proximity check: if candle is between camera and unit
                    const candleX = candle.position.x;
                    const candleZ = candle.position.z;
                    const unitX = unitGroup.position.x;
                    const unitZ = unitGroup.position.z;
                    // Check if candle is roughly in front of unit from camera's perspective
                    const dx = candleX - unitX;
                    const dz = candleZ - unitZ;
                    const distToCandle = Math.sqrt(dx * dx + dz * dz);
                    // Candle occludes if it's close to unit (within 2 units) and between camera and unit
                    if (distToCandle < 2.5) {
                        // Check if candle is between camera and unit using dot product
                        const camToUnit = { x: unitX - _cameraPos.x, z: unitZ - _cameraPos.z };
                        const camToCandle = { x: candleX - _cameraPos.x, z: candleZ - _cameraPos.z };
                        const dot = camToUnit.x * camToCandle.x + camToUnit.z * camToCandle.z;
                        const camToUnitLen = Math.sqrt(camToUnit.x * camToUnit.x + camToUnit.z * camToUnit.z);
                        const camToCandleLen = Math.sqrt(camToCandle.x * camToCandle.x + camToCandle.z * camToCandle.z);
                        if (dot > 0 && camToCandleLen < camToUnitLen) {
                            cachedOccludingMeshes.add(candle);
                            // Also mark corresponding flame
                            if (flameMeshes && flameMeshes[i]) {
                                cachedOccludingMeshes.add(flameMeshes[i]);
                            }
                        }
                    }
                }
            }
        }
    }

    // Update wall opacities every frame (smooth lerp using cached occlusion data)
    for (const mesh of wallMeshes) {
        const mat = mesh.material as THREE.MeshStandardMaterial;
        const targetOpacity = cachedOccludingMeshes.has(mesh) ? WALL_OPACITY_OCCLUDING : WALL_OPACITY_NORMAL;
        mat.opacity += (targetOpacity - mat.opacity) * WALL_OPACITY_LERP_SPEED;
        if (Math.abs(mat.opacity - targetOpacity) < 0.01) mat.opacity = targetOpacity;
    }

    // Update tree opacities if provided
    if (treeMeshes) {
        for (const mesh of treeMeshes) {
            const mat = mesh.material as THREE.MeshStandardMaterial;
            const targetOpacity = cachedOccludingMeshes.has(mesh) ? WALL_OPACITY_OCCLUDING : WALL_OPACITY_NORMAL;
            mat.opacity += (targetOpacity - mat.opacity) * WALL_OPACITY_LERP_SPEED;
            if (Math.abs(mat.opacity - targetOpacity) < 0.01) mat.opacity = targetOpacity;
        }
    }

    // Update column opacities if provided
    if (columnMeshes) {
        for (const mesh of columnMeshes) {
            const mat = mesh.material as THREE.MeshStandardMaterial;
            const targetOpacity = cachedOccludingMeshes.has(mesh) ? WALL_OPACITY_OCCLUDING : WALL_OPACITY_NORMAL;
            mat.opacity += (targetOpacity - mat.opacity) * WALL_OPACITY_LERP_SPEED;
            if (Math.abs(mat.opacity - targetOpacity) < 0.01) mat.opacity = targetOpacity;
        }
    }

    // Update candle opacities if provided
    if (candleMeshes) {
        for (const mesh of candleMeshes) {
            const mat = mesh.material as THREE.MeshStandardMaterial;
            const targetOpacity = cachedOccludingMeshes.has(mesh) ? WALL_OPACITY_OCCLUDING : WALL_OPACITY_NORMAL;
            mat.opacity += (targetOpacity - mat.opacity) * WALL_OPACITY_LERP_SPEED;
            if (Math.abs(mat.opacity - targetOpacity) < 0.01) mat.opacity = targetOpacity;
        }
    }

    // Update flame opacities if provided (use MeshBasicMaterial)
    if (flameMeshes) {
        for (const mesh of flameMeshes) {
            const mat = mesh.material as THREE.MeshBasicMaterial;
            const baseOpacity = 0.85;  // Flame's normal opacity
            const targetOpacity = cachedOccludingMeshes.has(mesh) ? baseOpacity * WALL_OPACITY_OCCLUDING : baseOpacity;
            mat.opacity += (targetOpacity - mat.opacity) * WALL_OPACITY_LERP_SPEED;
            if (Math.abs(mat.opacity - targetOpacity) < 0.01) mat.opacity = targetOpacity;
        }
    }
}

// =============================================================================
// TREE FOG VISIBILITY
// =============================================================================

// Fade speed for tree foliage reveal
const TREE_FADE_SPEED = 0.08;
const FOG_OCCLUDER_FADE_SPEED = 0.08;

/**
 * Update tree heights based on fog of war visibility.
 * Trees in unexplored (vis=0) cells are cut below the fog layer.
 * Trees in seen or visible areas are shown at full height with fade-in.
 */
export function updateTreeFogVisibility(
    treeMeshes: THREE.Mesh[],
    visibility: number[][]
): void {
    const UNEXPLORED_TRUNK_STUMP_HEIGHT = 0.42;

    for (const mesh of treeMeshes) {
        const tx = Math.floor(mesh.userData.treeX ?? mesh.position.x);
        const tz = Math.floor(mesh.userData.treeZ ?? mesh.position.z);
        const mat = mesh.material as THREE.MeshStandardMaterial;

        // Track previous visibility state for fade-in detection
        const wasExplored = mesh.userData.wasExplored as boolean | undefined;

        // Tree is discovered if the base cell is explored - reveals the whole tree
        const treeDiscovered = (visibility[tx]?.[tz] ?? 0) > 0;

        if (mesh.userData.isTrunk) {
            const fullHeight = mesh.userData.fullHeight as number;
            if (!treeDiscovered) {
                // Unexplored - keep only a short stump to avoid floating half-trees at fog edge.
                const cappedHeight = Math.min(fullHeight, UNEXPLORED_TRUNK_STUMP_HEIGHT);
                mesh.scale.y = cappedHeight / fullHeight;
                mesh.position.y = cappedHeight / 2;
                mesh.userData.wasExplored = false;
            } else {
                // Discovered - full height
                mesh.scale.y = 1;
                mesh.position.y = fullHeight / 2;
                mesh.userData.wasExplored = true;
            }
        } else if (mesh.userData.isFoliage) {
            const fullY = mesh.userData.fullY as number;

            if (!treeDiscovered) {
                // Unexplored - hide all canopy parts; reveal once base cell is discovered.
                mesh.visible = false;
                mat.opacity = 0;
                mesh.userData.wasExplored = false;
            } else {
                // Discovered - full height with fade-in
                mesh.visible = true;
                mesh.scale.y = 1;
                mesh.position.y = fullY;

                // Fade in if just revealed
                if (!wasExplored) {
                    mat.opacity = 0;
                }
                // Lerp opacity towards 1
                if (mat.opacity < 1) {
                    mat.opacity = Math.min(1, mat.opacity + TREE_FADE_SPEED);
                }

                mesh.userData.wasExplored = true;
            }
        }
    }
}

function getFogOccluderMaterial(mesh: THREE.Mesh): THREE.MeshStandardMaterial | THREE.MeshBasicMaterial | null {
    const mat = mesh.material;
    if (Array.isArray(mat)) return null;
    if (mat instanceof THREE.MeshStandardMaterial || mat instanceof THREE.MeshBasicMaterial) {
        return mat;
    }
    return null;
}

/**
 * Clip tall non-tree meshes (columns/walls) under unexplored fog.
 * Once a cell is discovered (vis > 0), the mesh restores to full height.
 */
export function updateFogOccluderVisibility(
    fogOccluderMeshes: THREE.Mesh[],
    visibility: number[][]
): void {
    const FOG_Y = 2.6;
    const MAX_HEIGHT_UNEXPLORED = FOG_Y - 0.1;

    for (const mesh of fogOccluderMeshes) {
        const clipX = mesh.userData.fogClipX as number | undefined;
        const clipZ = mesh.userData.fogClipZ as number | undefined;
        const baseY = mesh.userData.fogClipBaseY as number | undefined;
        const fullHeight = mesh.userData.fogClipFullHeight as number | undefined;
        const fullY = mesh.userData.fogClipFullY as number | undefined;
        const fullScaleY = mesh.userData.fogClipFullScaleY as number | undefined;

        if (
            clipX === undefined
            || clipZ === undefined
            || baseY === undefined
            || fullHeight === undefined
            || fullY === undefined
            || fullScaleY === undefined
        ) {
            continue;
        }

        const tx = Math.floor(clipX);
        const tz = Math.floor(clipZ);
        const discovered = (visibility[tx]?.[tz] ?? 0) > 0;
        const wasExplored = mesh.userData.fogClipWasExplored as boolean | undefined;
        const mat = getFogOccluderMaterial(mesh);

        if (!discovered) {
            const availableSpace = MAX_HEIGHT_UNEXPLORED - baseY;
            if (availableSpace <= 0) {
                mesh.visible = false;
                if (mat) mat.opacity = 0;
            } else {
                const scaleFactor = Math.min(1, availableSpace / fullHeight);
                mesh.visible = scaleFactor > 0;
                if (mesh.visible) {
                    mesh.scale.y = fullScaleY * scaleFactor;
                    mesh.position.y = baseY + (fullHeight * scaleFactor) / 2;
                    if (mat) mat.opacity = 1;
                } else if (mat) {
                    mat.opacity = 0;
                }
            }
            mesh.userData.fogClipWasExplored = false;
            continue;
        }

        mesh.visible = true;
        mesh.scale.y = fullScaleY;
        mesh.position.y = fullY;
        if (mat) {
            if (!wasExplored) {
                mat.opacity = 0;
            }
            if (mat.opacity < 1) {
                mat.opacity = Math.min(1, mat.opacity + FOG_OCCLUDER_FADE_SPEED);
            }
        }
        mesh.userData.fogClipWasExplored = true;
    }
}
