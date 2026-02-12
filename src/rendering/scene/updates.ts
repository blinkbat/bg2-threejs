// =============================================================================
// SCENE UPDATES - Functions for updating scene elements during game loop
// =============================================================================

import * as THREE from "three";
import type { Unit, UnitGroup } from "../../core/types";
import type { ChestMeshData } from "./types";

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
 * Update water (no-op for now).
 */
export function updateWater(_waterMesh: THREE.Mesh | null, _time: number): void {
    // Simple blue water - no animation
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

/**
 * Update tree heights based on fog of war visibility.
 * Trees in unexplored (vis=0) cells are cut below the fog layer.
 * Trees in seen or visible areas are shown at full height with fade-in.
 */
export function updateTreeFogVisibility(
    treeMeshes: THREE.Mesh[],
    visibility: number[][]
): void {
    const FOG_Y = 2.6;
    const MAX_HEIGHT_UNEXPLORED = FOG_Y - 0.1;  // Cap just below fog

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
                // Unexplored - cap trunk below fog
                const cappedHeight = Math.min(fullHeight, MAX_HEIGHT_UNEXPLORED);
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
            const fullHeight = mesh.userData.fullHeight as number;
            const trunkHeight = mesh.userData.trunkHeight as number;

            if (!treeDiscovered) {
                // Unexplored - hide foliage if it would stick above fog
                const foliageBottom = fullY - fullHeight / 2;
                if (foliageBottom >= MAX_HEIGHT_UNEXPLORED) {
                    // Foliage entirely above fog - hide it
                    mesh.visible = false;
                    mat.opacity = 0;
                } else {
                    // Partially clip foliage
                    mesh.visible = true;
                    const availableSpace = MAX_HEIGHT_UNEXPLORED - trunkHeight;
                    if (availableSpace <= 0) {
                        mesh.visible = false;
                        mat.opacity = 0;
                    } else {
                        const scaleFactor = Math.min(1, availableSpace / fullHeight);
                        mesh.scale.y = scaleFactor;
                        mesh.position.y = trunkHeight + (fullHeight * scaleFactor) / 2;
                    }
                }
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
