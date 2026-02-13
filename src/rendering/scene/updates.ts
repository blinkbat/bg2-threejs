// =============================================================================
// SCENE UPDATES - Functions for updating scene elements during game loop
// =============================================================================

import * as THREE from "three";
import type { Unit, UnitGroup } from "../../core/types";
import type { ChestMeshData } from "./types";

interface LiquidTileAnimationData {
    liquidType: "lava";
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

    if (liquidType !== "lava") return null;
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
 * Update animated liquid tiles (lava only).
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
const _treeUnionBox = new THREE.Box3();

interface OcclusionCircle {
    x: number;
    z: number;
    radius: number;
}

interface TreeOcclusionGroup {
    meshes: THREE.Mesh[];
    circle: OcclusionCircle;
}

const TREE_OCCLUSION_RADIUS_PAD = 0.2;

/** Get or compute a cached bounding box for a static mesh. */
function getStableCachedBox(mesh: THREE.Mesh): THREE.Box3 {
    let cached = mesh.userData.cachedBox as THREE.Box3 | undefined;
    if (!cached) {
        cached = new THREE.Box3().setFromObject(mesh);
        mesh.userData.cachedBox = cached;
    }
    return cached;
}

/** Get a copy of cached bounds into a reusable temp box. */
function getCachedBox(mesh: THREE.Mesh): THREE.Box3 {
    _meshBox.copy(getStableCachedBox(mesh));
    return _meshBox;
}

function isOcclusionFadeDisabled(mesh: THREE.Mesh): boolean {
    return Reflect.get(mesh.userData, "disableOcclusionFade") === true;
}

function buildTreeOcclusionCircle(meshes: THREE.Mesh[]): OcclusionCircle {
    for (const mesh of meshes) {
        const centerX = readFiniteNumber(Reflect.get(mesh.userData, "fogFootprintCenterX"));
        const centerZ = readFiniteNumber(Reflect.get(mesh.userData, "fogFootprintCenterZ"));
        const radius = readFiniteNumber(Reflect.get(mesh.userData, "fogFootprintRadius"));
        if (centerX !== null && centerZ !== null && radius !== null && radius > 0) {
            return { x: centerX, z: centerZ, radius: radius + TREE_OCCLUSION_RADIUS_PAD };
        }
    }

    _treeUnionBox.makeEmpty();
    for (const mesh of meshes) {
        _treeUnionBox.union(getStableCachedBox(mesh));
    }
    if (_treeUnionBox.isEmpty()) {
        const fallback = meshes[0];
        return { x: fallback.position.x, z: fallback.position.z, radius: 0.8 };
    }

    const centerX = (_treeUnionBox.min.x + _treeUnionBox.max.x) * 0.5;
    const centerZ = (_treeUnionBox.min.z + _treeUnionBox.max.z) * 0.5;
    const halfWidthX = Math.max(0, (_treeUnionBox.max.x - _treeUnionBox.min.x) * 0.5);
    const halfWidthZ = Math.max(0, (_treeUnionBox.max.z - _treeUnionBox.min.z) * 0.5);
    const radius = Math.max(0.6, Math.hypot(halfWidthX, halfWidthZ) + TREE_OCCLUSION_RADIUS_PAD);

    return { x: centerX, z: centerZ, radius };
}

/**
 * Fast XZ occlusion test for orthographic isometric view.
 * Returns true when the camera->unit segment passes through the tree circle.
 */
function doesCircleOccludeSegmentXZ(
    cameraX: number,
    cameraZ: number,
    unitX: number,
    unitZ: number,
    circle: OcclusionCircle
): boolean {
    const segX = unitX - cameraX;
    const segZ = unitZ - cameraZ;
    const segLenSq = segX * segX + segZ * segZ;
    if (segLenSq <= 0.0001) return false;

    const relX = circle.x - cameraX;
    const relZ = circle.z - cameraZ;
    const t = (relX * segX + relZ * segZ) / segLenSq;
    if (t <= 0 || t >= 1) return false;

    const closestX = cameraX + segX * t;
    const closestZ = cameraZ + segZ * t;
    const dx = circle.x - closestX;
    const dz = circle.z - closestZ;
    return dx * dx + dz * dz <= circle.radius * circle.radius;
}

// Throttle expensive ray-box tests - only recalculate every N frames
const WALL_CHECK_INTERVAL = 3;
let wallCheckFrame = 0;
const cachedOccludingMeshes = new Set<THREE.Mesh>();

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

        const treeOcclusionGroups: TreeOcclusionGroup[] = [];
        const groupedColumnMeshes = new Set<THREE.Mesh>();
        if (columnGroups) {
            for (const group of columnGroups) {
                for (const mesh of group) {
                    groupedColumnMeshes.add(mesh);
                }
            }
        }

        if (treeMeshes) {
            const treeGroupMap = new Map<string, THREE.Mesh[]>();
            const standaloneTreeMeshes: THREE.Mesh[] = [];
            for (const mesh of treeMeshes) {
                const fogObjectId = Reflect.get(mesh.userData, "fogObjectId");
                if (typeof fogObjectId === "string" && fogObjectId.length > 0) {
                    const existingGroup = treeGroupMap.get(fogObjectId);
                    if (existingGroup) {
                        existingGroup.push(mesh);
                    } else {
                        treeGroupMap.set(fogObjectId, [mesh]);
                    }
                } else {
                    standaloneTreeMeshes.push(mesh);
                }
            }

            for (const group of treeGroupMap.values()) {
                treeOcclusionGroups.push({
                    meshes: group,
                    circle: buildTreeOcclusionCircle(group),
                });
            }

            for (const mesh of standaloneTreeMeshes) {
                treeOcclusionGroups.push({
                    meshes: [mesh],
                    circle: buildTreeOcclusionCircle([mesh]),
                });
            }
        }

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
            if (treeOcclusionGroups.length > 0) {
                const cameraX = _cameraPos.x;
                const cameraZ = _cameraPos.z;
                const unitX = unitGroup.position.x;
                const unitZ = unitGroup.position.z;

                for (const group of treeOcclusionGroups) {
                    if (group.meshes.some(mesh => cachedOccludingMeshes.has(mesh))) continue;
                    const groupOccludes = doesCircleOccludeSegmentXZ(
                        cameraX,
                        cameraZ,
                        unitX,
                        unitZ,
                        group.circle
                    );
                    if (groupOccludes) {
                        for (const mesh of group.meshes) {
                            cachedOccludingMeshes.add(mesh);
                        }
                    }
                }
            }

            // Check grouped columns first so multipart structures fade together.
            if (columnGroups) {
                for (const group of columnGroups) {
                    // Skip if already marked
                    if (group.some(mesh => cachedOccludingMeshes.has(mesh))) continue;

                    // Check if any part of the group is occluding
                    let groupOccludes = false;
                    for (const mesh of group) {
                        if (isOcclusionFadeDisabled(mesh)) continue;
                        getCachedBox(mesh);
                        if (_ray.intersectBox(_meshBox, _intersection)) {
                            if (_cameraPos.distanceTo(_intersection) < distToUnit) {
                                groupOccludes = true;
                                break;
                            }
                        }
                    }

                    // If any part occludes, mark ALL parts of the group
                    if (groupOccludes) {
                        for (const mesh of group) {
                            cachedOccludingMeshes.add(mesh);
                        }
                    }
                }
            }

            // Check standalone tall meshes that are not part of an explicit group.
            if (columnMeshes) {
                for (const mesh of columnMeshes) {
                    if (groupedColumnMeshes.has(mesh)) continue;
                    if (cachedOccludingMeshes.has(mesh)) continue;
                    if (isOcclusionFadeDisabled(mesh)) continue;
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
            const fogState = toFogRenderState(Reflect.get(mesh.userData, "fogRenderState"));
            const fogOpacity = readFiniteNumber(Reflect.get(mesh.userData, "fogResolvedOpacity"));
            const occlusionTarget = cachedOccludingMeshes.has(mesh) ? WALL_OPACITY_OCCLUDING : WALL_OPACITY_NORMAL;
            let targetOpacity = occlusionTarget;

            if (fogOpacity !== null) {
                if (fogState === FOG_STATE_UNEXPLORED) {
                    targetOpacity = fogOpacity;
                } else {
                    targetOpacity = Math.min(fogOpacity, occlusionTarget);
                }
            }

            mat.opacity += (targetOpacity - mat.opacity) * WALL_OPACITY_LERP_SPEED;
            if (Math.abs(mat.opacity - targetOpacity) < 0.01) mat.opacity = targetOpacity;
        }
    }

    // Update column opacities if provided
    if (columnMeshes) {
        for (const mesh of columnMeshes) {
            const mat = mesh.material as THREE.MeshStandardMaterial;
            const fogState = toFogRenderState(Reflect.get(mesh.userData, "fogRenderState"));
            const fogOpacity = readFiniteNumber(Reflect.get(mesh.userData, "fogResolvedOpacity"));
            const occlusionTarget = isOcclusionFadeDisabled(mesh)
                ? WALL_OPACITY_NORMAL
                : (cachedOccludingMeshes.has(mesh) ? WALL_OPACITY_OCCLUDING : WALL_OPACITY_NORMAL);
            let targetOpacity = occlusionTarget;

            if (fogOpacity !== null) {
                if (fogState === FOG_STATE_UNEXPLORED) {
                    targetOpacity = fogOpacity;
                } else {
                    targetOpacity = Math.min(fogOpacity, occlusionTarget);
                }
            }

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

type FogRenderState = 0 | 1 | 2;

interface FogFootprintCell {
    x: number;
    z: number;
}

interface FogTransitionSnapshot {
    opacity: number;
    scaleY: number;
    posY: number;
}

interface FogTransitionResult {
    opacity: number;
    scaleY: number;
    posY: number;
    progress: number;
}

const FOG_STATE_UNEXPLORED: FogRenderState = 0;
const FOG_STATE_REVEALED_NOT_VISIBLE: FogRenderState = 1;
const FOG_STATE_VISIBLE: FogRenderState = 2;

const UNEXPLORED_TRUNK_STUMP_HEIGHT = 0.42;
const FOG_TRANSITION_BASE_MS = 220;
const FOG_TRANSITION_JITTER_MS = 40;
const FOG_DITHER_OPACITY_VARIANCE = 0.04;

interface AlphaHashCapableMaterial extends THREE.Material {
    alphaHash: boolean;
}

function readFiniteNumber(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toFogRenderState(value: unknown): FogRenderState | null {
    if (value === FOG_STATE_UNEXPLORED) return FOG_STATE_UNEXPLORED;
    if (value === FOG_STATE_REVEALED_NOT_VISIBLE) return FOG_STATE_REVEALED_NOT_VISIBLE;
    if (value === FOG_STATE_VISIBLE) return FOG_STATE_VISIBLE;
    return null;
}

function isAlphaHashCapableMaterial(material: THREE.Material): material is AlphaHashCapableMaterial {
    return "alphaHash" in material && typeof Reflect.get(material, "alphaHash") === "boolean";
}

function getFogDitherSeed(mesh: THREE.Mesh): number {
    const existing = readFiniteNumber(Reflect.get(mesh.userData, "fogDitherSeed"));
    if (existing !== null) return existing;
    const seed = Math.abs(Math.sin(mesh.id * 12.9898 + 78.233)) % 1;
    mesh.userData.fogDitherSeed = seed;
    return seed;
}

function getFogTransitionDurationMs(mesh: THREE.Mesh): number {
    const existing = readFiniteNumber(Reflect.get(mesh.userData, "fogTransitionDurationMs"));
    if (existing !== null) return existing;
    const seed = getFogDitherSeed(mesh);
    const jitter = (seed * 2 - 1) * FOG_TRANSITION_JITTER_MS;
    const duration = THREE.MathUtils.clamp(FOG_TRANSITION_BASE_MS + jitter, 150, 300);
    mesh.userData.fogTransitionDurationMs = duration;
    return duration;
}

function readFogFootprintCells(mesh: THREE.Mesh): FogFootprintCell[] | null {
    const rawCells = Reflect.get(mesh.userData, "fogFootprintCells");
    if (!Array.isArray(rawCells) || rawCells.length === 0) return null;

    const cells: FogFootprintCell[] = [];
    for (const rawCell of rawCells) {
        if (!rawCell || typeof rawCell !== "object") continue;
        const x = readFiniteNumber(Reflect.get(rawCell, "x"));
        const z = readFiniteNumber(Reflect.get(rawCell, "z"));
        if (x === null || z === null) continue;
        cells.push({ x: Math.floor(x), z: Math.floor(z) });
    }

    return cells.length > 0 ? cells : null;
}

function resolveFogStateFromVisibility(
    mesh: THREE.Mesh,
    visibility: number[][],
    fallbackX: number,
    fallbackZ: number
): FogRenderState {
    let maxVis = 0;
    const footprintCells = readFogFootprintCells(mesh);

    if (footprintCells) {
        for (const cell of footprintCells) {
            const vis = visibility[cell.x]?.[cell.z] ?? 0;
            if (vis > maxVis) maxVis = vis;
            if (maxVis === FOG_STATE_VISIBLE) break;
        }
    } else {
        const tx = Math.floor(fallbackX);
        const tz = Math.floor(fallbackZ);
        maxVis = visibility[tx]?.[tz] ?? 0;
    }

    if (maxVis >= FOG_STATE_VISIBLE) return FOG_STATE_VISIBLE;
    if (maxVis >= FOG_STATE_REVEALED_NOT_VISIBLE) return FOG_STATE_REVEALED_NOT_VISIBLE;
    return FOG_STATE_UNEXPLORED;
}

function readFogTransitionSnapshot(
    mesh: THREE.Mesh,
    fallbackOpacity: number,
    fallbackScaleY: number,
    fallbackPosY: number
): FogTransitionSnapshot {
    return {
        opacity: readFiniteNumber(Reflect.get(mesh.userData, "fogTransitionFromOpacity")) ?? fallbackOpacity,
        scaleY: readFiniteNumber(Reflect.get(mesh.userData, "fogTransitionFromScaleY")) ?? fallbackScaleY,
        posY: readFiniteNumber(Reflect.get(mesh.userData, "fogTransitionFromPosY")) ?? fallbackPosY,
    };
}

function computeFogTransition(
    mesh: THREE.Mesh,
    nextState: FogRenderState,
    now: number,
    currentOpacity: number,
    currentScaleY: number,
    currentPosY: number,
    targetOpacity: number,
    targetScaleY: number,
    targetPosY: number
): FogTransitionResult {
    const previousState = toFogRenderState(Reflect.get(mesh.userData, "fogRenderState"));

    if (previousState === null) {
        mesh.userData.fogRenderState = nextState;
        mesh.userData.fogTransitionStartMs = now;
        mesh.userData.fogTransitionFromOpacity = targetOpacity;
        mesh.userData.fogTransitionFromScaleY = targetScaleY;
        mesh.userData.fogTransitionFromPosY = targetPosY;
        return {
            opacity: targetOpacity,
            scaleY: targetScaleY,
            posY: targetPosY,
            progress: 1,
        };
    }

    if (previousState !== nextState) {
        mesh.userData.fogRenderState = nextState;
        mesh.userData.fogTransitionStartMs = now;
        mesh.userData.fogTransitionFromOpacity = currentOpacity;
        mesh.userData.fogTransitionFromScaleY = currentScaleY;
        mesh.userData.fogTransitionFromPosY = currentPosY;
    }

    const startMs = readFiniteNumber(Reflect.get(mesh.userData, "fogTransitionStartMs")) ?? now;
    const durationMs = getFogTransitionDurationMs(mesh);
    const rawProgress = THREE.MathUtils.clamp((now - startMs) / durationMs, 0, 1);
    const easedProgress = rawProgress * rawProgress * (3 - 2 * rawProgress);
    const fromSnapshot = readFogTransitionSnapshot(mesh, currentOpacity, currentScaleY, currentPosY);

    return {
        opacity: THREE.MathUtils.lerp(fromSnapshot.opacity, targetOpacity, easedProgress),
        scaleY: THREE.MathUtils.lerp(fromSnapshot.scaleY, targetScaleY, easedProgress),
        posY: THREE.MathUtils.lerp(fromSnapshot.posY, targetPosY, easedProgress),
        progress: rawProgress,
    };
}

function applyFogOpacity(
    mesh: THREE.Mesh,
    material: THREE.MeshStandardMaterial | THREE.MeshBasicMaterial,
    opacity: number
): void {
    const clampedOpacity = THREE.MathUtils.clamp(opacity, 0, 1);
    const wantsDither = clampedOpacity > 0 && clampedOpacity < 1;
    if (isAlphaHashCapableMaterial(material)) {
        material.alphaHash = wantsDither;
    }
    material.transparent = true;

    const seed = getFogDitherSeed(mesh);
    const ditherOffset = wantsDither ? (seed - 0.5) * FOG_DITHER_OPACITY_VARIANCE : 0;
    material.opacity = THREE.MathUtils.clamp(clampedOpacity + ditherOffset, 0, 1);
}

/**
 * Update trees with object-level FoW states:
 * - `unexplored`: short trunk stump, no canopy
 * - `revealed_not_visible`: full tree
 * - `visible`: full tree
 */
export function updateTreeFogVisibility(
    treeMeshes: THREE.Mesh[],
    visibility: number[][]
): void {
    const now = Date.now();

    for (const mesh of treeMeshes) {
        const treeX = readFiniteNumber(Reflect.get(mesh.userData, "treeX")) ?? mesh.position.x;
        const treeZ = readFiniteNumber(Reflect.get(mesh.userData, "treeZ")) ?? mesh.position.z;
        const fogState = resolveFogStateFromVisibility(mesh, visibility, treeX, treeZ);
        const mat = mesh.material as THREE.MeshStandardMaterial;

        if (mesh.userData.isTrunk) {
            const fullHeight = readFiniteNumber(Reflect.get(mesh.userData, "fullHeight"));
            if (fullHeight === null || fullHeight <= 0) continue;

            const stumpHeight = Math.min(fullHeight, UNEXPLORED_TRUNK_STUMP_HEIGHT);
            const stumpScaleY = stumpHeight / fullHeight;
            const stumpPosY = stumpHeight / 2;

            let targetScaleY = 1;
            let targetPosY = fullHeight / 2;
            let targetOpacity = 1;

            if (fogState === FOG_STATE_UNEXPLORED) {
                targetScaleY = stumpScaleY;
                targetPosY = stumpPosY;
                targetOpacity = 1;
            } else {
                targetScaleY = 1;
                targetPosY = fullHeight / 2;
                targetOpacity = 1;
            }

            const transition = computeFogTransition(
                mesh,
                fogState,
                now,
                mat.opacity,
                mesh.scale.y,
                mesh.position.y,
                targetOpacity,
                targetScaleY,
                targetPosY
            );

            mesh.visible = true;
            mesh.scale.y = transition.scaleY;
            mesh.position.y = transition.posY;
            applyFogOpacity(mesh, mat, transition.opacity);
            mesh.userData.fogResolvedOpacity = mat.opacity;
        } else if (mesh.userData.isFoliage) {
            const fullY = readFiniteNumber(Reflect.get(mesh.userData, "fullY"));
            if (fullY === null) continue;

            let targetOpacity = 0;
            if (fogState === FOG_STATE_REVEALED_NOT_VISIBLE || fogState === FOG_STATE_VISIBLE) {
                targetOpacity = 1;
            }

            if (fogState !== FOG_STATE_UNEXPLORED) {
                mesh.visible = true;
            }

            const transition = computeFogTransition(
                mesh,
                fogState,
                now,
                mat.opacity,
                mesh.scale.y,
                mesh.position.y,
                targetOpacity,
                1,
                fullY
            );

            mesh.scale.y = transition.scaleY;
            mesh.position.y = transition.posY;
            applyFogOpacity(mesh, mat, transition.opacity);
            mesh.userData.fogResolvedOpacity = mat.opacity;

            if (fogState === FOG_STATE_UNEXPLORED && transition.progress >= 1 && mat.opacity <= 0.01) {
                mesh.visible = false;
            } else {
                mesh.visible = true;
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
 * Update tall non-tree meshes with object-level FoW states:
 * - `unexplored`: clipped below fog plane
 * - `revealed_not_visible`: full mesh
 * - `visible`: full mesh
 */
export function updateFogOccluderVisibility(
    fogOccluderMeshes: THREE.Mesh[],
    visibility: number[][]
): void {
    const now = Date.now();
    const FOG_Y = 2.6;
    const MAX_HEIGHT_UNEXPLORED = FOG_Y - 0.1;

    for (const mesh of fogOccluderMeshes) {
        const clipX = readFiniteNumber(Reflect.get(mesh.userData, "fogClipX"));
        const clipZ = readFiniteNumber(Reflect.get(mesh.userData, "fogClipZ"));
        const baseY = readFiniteNumber(Reflect.get(mesh.userData, "fogClipBaseY"));
        const fullHeight = readFiniteNumber(Reflect.get(mesh.userData, "fogClipFullHeight"));
        const fullY = readFiniteNumber(Reflect.get(mesh.userData, "fogClipFullY"));
        const fullScaleY = readFiniteNumber(Reflect.get(mesh.userData, "fogClipFullScaleY"));

        if (
            clipX === null
            || clipZ === null
            || baseY === null
            || fullHeight === null
            || fullY === null
            || fullScaleY === null
        ) {
            continue;
        }

        const fogState = resolveFogStateFromVisibility(mesh, visibility, clipX, clipZ);
        const mat = getFogOccluderMaterial(mesh);
        let targetOpacity = 1;
        let targetScaleY = fullScaleY;
        let targetPosY = fullY;
        let targetVisible = true;

        if (fogState === FOG_STATE_UNEXPLORED) {
            const availableSpace = MAX_HEIGHT_UNEXPLORED - baseY;
            if (availableSpace <= 0) {
                targetVisible = false;
                targetOpacity = 0;
                targetScaleY = 0;
                targetPosY = baseY;
            } else {
                const scaleFactor = Math.min(1, availableSpace / fullHeight);
                targetVisible = scaleFactor > 0;
                targetOpacity = targetVisible ? 1 : 0;
                targetScaleY = fullScaleY * scaleFactor;
                targetPosY = baseY + (fullHeight * scaleFactor) / 2;
            }
        } else {
            targetVisible = true;
            targetOpacity = 1;
            targetScaleY = fullScaleY;
            targetPosY = fullY;
        }

        if (targetVisible) {
            mesh.visible = true;
        }

        const currentOpacity = mat ? mat.opacity : 1;
        const transition = computeFogTransition(
            mesh,
            fogState,
            now,
            currentOpacity,
            mesh.scale.y,
            mesh.position.y,
            targetOpacity,
            targetScaleY,
            targetPosY
        );

        mesh.scale.y = transition.scaleY;
        mesh.position.y = transition.posY;
        if (mat) {
            applyFogOpacity(mesh, mat, transition.opacity);
            mesh.userData.fogResolvedOpacity = mat.opacity;
        } else {
            mesh.userData.fogResolvedOpacity = transition.opacity;
        }

        if (!targetVisible && transition.progress >= 1) {
            const opacityNow = mat ? mat.opacity : transition.opacity;
            if (opacityNow <= 0.01 && mesh.scale.y <= 0.001) {
                mesh.visible = false;
            } else {
                mesh.visible = true;
            }
        } else {
            mesh.visible = true;
        }
    }
}
