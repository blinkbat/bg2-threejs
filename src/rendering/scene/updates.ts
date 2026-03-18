// =============================================================================
// SCENE UPDATES - Functions for updating scene elements during game loop
// =============================================================================

import * as THREE from "three";
import type { Unit, UnitGroup } from "../../core/types";
import type { ChestMeshData } from "./types";
import { getGameTime } from "../../core/gameClock";

interface LiquidTileAnimationData {
    liquidType: "lava";
    wavePhase: number;
    waveSpeed: number;
    baseColor: THREE.Color;
    hotColor?: THREE.Color;
    baseEmissiveIntensity: number;
}

interface LavaBubbleGroupAnimationData {
    liquidType: "lavaBubbles";
    wavePhase: number;
    waveSpeed: number;
    baseOpacity: number;
    baseScale: number;
}

interface WaterBubbleGroupAnimationData {
    liquidType: "waterBubbles";
    wavePhase: number;
    waveSpeed: number;
    baseOpacity: number;
    baseScale: number;
}

interface LavaBubbleNodeData {
    phaseOffset: number;
    baseScale: number;
    baseY: number;
    riseAmplitude: number;
}

type LiquidAnimationData =
    | LiquidTileAnimationData
    | LavaBubbleGroupAnimationData
    | WaterBubbleGroupAnimationData;

interface LiquidBubbleNodeRef {
    mesh: THREE.Mesh;
    material: THREE.MeshBasicMaterial;
    data: LavaBubbleNodeData;
}

interface LiquidBubbleGroupRef {
    group: THREE.Object3D;
    data: LavaBubbleGroupAnimationData | WaterBubbleGroupAnimationData;
    bubbles: LiquidBubbleNodeRef[];
}

interface LiquidLavaTileRef {
    material: THREE.MeshStandardMaterial;
    data: LiquidTileAnimationData;
}

interface LiquidSharedLavaRef {
    material: THREE.MeshStandardMaterial;
    data: LiquidTileAnimationData;
}

interface LiquidUpdateCache {
    sharedLava: LiquidSharedLavaRef | null;
    lavaTiles: LiquidLavaTileRef[];
    bubbleGroups: LiquidBubbleGroupRef[];
}

const liquidUpdateCacheByRoot = new WeakMap<THREE.Object3D, LiquidUpdateCache>();

function asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== "object") return null;
    return value as Record<string, unknown>;
}

function readLiquidData(value: unknown): LiquidAnimationData | null {
    const record = asRecord(value);
    if (!record) return null;

    const liquidType = record.liquidType;
    const wavePhase = record.wavePhase;
    const waveSpeed = record.waveSpeed;
    if (typeof wavePhase !== "number" || typeof waveSpeed !== "number") return null;

    if (liquidType === "lavaBubbles" || liquidType === "waterBubbles") {
        const baseOpacity = record.baseOpacity;
        const baseScale = record.baseScale;
        if (typeof baseOpacity !== "number" || typeof baseScale !== "number") return null;
        return {
            liquidType,
            wavePhase,
            waveSpeed,
            baseOpacity,
            baseScale,
        };
    }

    if (liquidType !== "lava") return null;

    const baseColor = record.baseColor;
    const hotColor = record.hotColor;
    const baseEmissiveIntensity = record.baseEmissiveIntensity;
    if (!(baseColor instanceof THREE.Color)) return null;

    return {
        liquidType,
        wavePhase,
        waveSpeed,
        baseColor,
        hotColor: hotColor instanceof THREE.Color ? hotColor : undefined,
        baseEmissiveIntensity: typeof baseEmissiveIntensity === "number" ? baseEmissiveIntensity : 0.8,
    };
}

function readLavaBubbleNodeData(value: unknown): LavaBubbleNodeData | null {
    const record = asRecord(value);
    if (!record) return null;

    const phaseOffset = record.phaseOffset;
    const baseScale = record.baseScale;
    const baseY = record.baseY;
    const riseAmplitude = record.riseAmplitude;
    if (typeof phaseOffset !== "number" || typeof baseScale !== "number") return null;
    if (typeof baseY !== "number" || typeof riseAmplitude !== "number") return null;

    return {
        phaseOffset,
        baseScale,
        baseY,
        riseAmplitude,
    };
}

function getLiquidUpdateCache(waterMesh: THREE.Object3D): LiquidUpdateCache {
    const cached = liquidUpdateCacheByRoot.get(waterMesh);
    if (cached) return cached;

    const nextCache: LiquidUpdateCache = {
        sharedLava: null,
        lavaTiles: [],
        bubbleGroups: [],
    };

    const rootData = asRecord(waterMesh.userData);
    const sharedLavaData = readLiquidData(rootData?.sharedLava);
    if (sharedLavaData?.liquidType === "lava") {
        const sharedLavaRecord = asRecord(rootData?.sharedLava);
        const sharedMaterial = sharedLavaRecord?.material;
        if (sharedMaterial instanceof THREE.MeshStandardMaterial) {
            nextCache.sharedLava = {
                material: sharedMaterial,
                data: sharedLavaData,
            };
        }
    }

    waterMesh.traverse((obj: THREE.Object3D) => {
        const nodeData = asRecord(obj.userData);
        const liquidData = readLiquidData(nodeData?.liquid);
        if (!liquidData) return;

        if (liquidData.liquidType === "lavaBubbles" || liquidData.liquidType === "waterBubbles") {
            const bubbles: LiquidBubbleNodeRef[] = [];
            for (const child of obj.children) {
                if (!(child instanceof THREE.Mesh)) continue;
                const childMaterial = child.material;
                if (!(childMaterial instanceof THREE.MeshBasicMaterial)) continue;
                const childDataRecord = asRecord(child.userData);
                const bubbleData = readLavaBubbleNodeData(childDataRecord?.bubbleData);
                if (!bubbleData) continue;
                bubbles.push({
                    mesh: child,
                    material: childMaterial,
                    data: bubbleData,
                });
            }
            nextCache.bubbleGroups.push({
                group: obj,
                data: liquidData,
                bubbles,
            });
            return;
        }

        if (!(obj instanceof THREE.Mesh)) return;
        const material = obj.material;
        if (!(material instanceof THREE.MeshStandardMaterial)) return;
        nextCache.lavaTiles.push({
            material,
            data: liquidData,
        });
    });

    liquidUpdateCacheByRoot.set(waterMesh, nextCache);
    return nextCache;
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

const LIQUID_UPDATE_INTERVAL_MS = 50;
const LIQUID_TWO_PI = Math.PI * 2;
const LIQUID_INV_TWO_PI = 1 / LIQUID_TWO_PI;
const BUBBLE_FADE_IN_PORTION = 0.82;
let lastLiquidUpdateTime = 0;

function getCycle01(angle: number): number {
    const cycle = angle * LIQUID_INV_TWO_PI;
    return cycle - Math.floor(cycle);
}

function getAsymmetricBubbleFade(cycle01: number): number {
    if (cycle01 <= BUBBLE_FADE_IN_PORTION) {
        const t = cycle01 / BUBBLE_FADE_IN_PORTION;
        return t * t * (3 - 2 * t);
    }
    const t = (cycle01 - BUBBLE_FADE_IN_PORTION) / (1 - BUBBLE_FADE_IN_PORTION);
    const drop = 1 - t;
    return drop * drop * drop;
}

function applyLavaPulse(
    material: THREE.MeshStandardMaterial,
    liquidData: LiquidTileAnimationData,
    t: number
): void {
    const primaryWave = Math.sin(t * liquidData.waveSpeed + liquidData.wavePhase);
    const secondaryWave = Math.sin(t * (liquidData.waveSpeed * 1.6) + liquidData.wavePhase * 0.73);
    const pulse = 0.5 + (primaryWave * 0.7 + secondaryWave * 0.3) * 0.5;

    if (liquidData.baseColor && liquidData.hotColor) {
        material.color.copy(liquidData.baseColor).lerp(liquidData.hotColor, pulse * 0.35);
    }
    material.emissive.setRGB(1.0, 0.2, 0.05);
    material.emissiveIntensity = (liquidData.baseEmissiveIntensity ?? 0.8) + pulse * 0.35;
    material.roughness = 0.36 + (1 - pulse) * 0.12;
    material.metalness = 0.16;
}

function applyBubbleGroupPulse(
    bubbleGroup: LiquidBubbleGroupRef,
    t: number
): void {
    const { group, data: liquidData, bubbles } = bubbleGroup;
    const groupAngle = t * liquidData.waveSpeed + liquidData.wavePhase;
    const groupFade = getAsymmetricBubbleFade(getCycle01(groupAngle));
    const groupScale = liquidData.baseScale * (0.96 + groupFade * 0.08);
    group.scale.set(groupScale, groupScale, groupScale);

    for (const bubble of bubbles) {
        const { mesh, material, data: bubbleData } = bubble;
        const bubbleAngle = t * (liquidData.waveSpeed * 1.45) + liquidData.wavePhase + bubbleData.phaseOffset;
        const bubbleWave = Math.sin(bubbleAngle);
        const bubbleRise01 = 0.5 + bubbleWave * 0.5;
        const bubbleFade = getAsymmetricBubbleFade(getCycle01(bubbleAngle));
        material.opacity = liquidData.baseOpacity * groupFade * bubbleFade * (0.35 + bubbleRise01 * 0.65);
        const animatedScale = bubbleData.baseScale * (0.72 + bubbleRise01 * 0.48);
        mesh.scale.set(animatedScale, animatedScale, animatedScale);
        mesh.position.y = bubbleData.baseY + bubbleData.riseAmplitude * bubbleRise01;
    }
}

/**
 * Update animated liquid tiles (lava + bubble groups).
 */
export function updateWater(waterMesh: THREE.Object3D | null, time: number, camera?: THREE.Camera | null): void {
    if (!waterMesh) return;
    void camera;
    if (time - lastLiquidUpdateTime < LIQUID_UPDATE_INTERVAL_MS) return;
    lastLiquidUpdateTime = time;

    const t = time * 0.001;
    const cache = getLiquidUpdateCache(waterMesh);

    if (cache.sharedLava) {
        applyLavaPulse(cache.sharedLava.material, cache.sharedLava.data, t);
    }

    if (!cache.sharedLava) {
        for (const lavaTile of cache.lavaTiles) {
            applyLavaPulse(lavaTile.material, lavaTile.data, t);
        }
    }

    for (const bubbleGroup of cache.bubbleGroups) {
        applyBubbleGroupPulse(bubbleGroup, t);
    }
}

// =============================================================================
// WEATHER
// =============================================================================

const _rainForward = new THREE.Vector3();
const LIGHTNING_MIN_QUIET_MS = 6500;
const LIGHTNING_MAX_QUIET_MS = 14500;
const LIGHTNING_MIN_GAP_MS = 90;
const LIGHTNING_MAX_GAP_MS = 240;
const LIGHTNING_MIN_FLASH_MS = 75;
const LIGHTNING_MAX_FLASH_MS = 135;
const LIGHTNING_ATTACK_PORTION = 0.22;

interface LightningBackgroundState {
    textures: THREE.Texture[];
    nextEventTimeMs: number;
    flashStartTimeMs: number;
    flashEndTimeMs: number;
    burstFlashesRemaining: number;
    exposureBoost: number;
}

function randomInRange(min: number, max: number): number {
    return min + Math.random() * (max - min);
}

function readLightningBackgroundState(scene: THREE.Scene): { record: Record<string, unknown>; state: LightningBackgroundState; } | null {
    const record = asRecord(Reflect.get(scene.userData, "lightningBackground"));
    if (!record) return null;

    const textures = record.textures;
    const nextEventTimeMs = readFiniteNumber(record.nextEventTimeMs);
    const flashStartTimeMs = readFiniteNumber(record.flashStartTimeMs) ?? 0;
    const flashEndTimeMs = readFiniteNumber(record.flashEndTimeMs);
    const burstFlashesRemaining = readFiniteNumber(record.burstFlashesRemaining);
    const exposureBoost = readFiniteNumber(record.exposureBoost);
    if (!Array.isArray(textures) || textures.length < 2) return null;
    if (!textures.every(texture => texture instanceof THREE.Texture)) return null;
    if (nextEventTimeMs === null || flashEndTimeMs === null || burstFlashesRemaining === null || exposureBoost === null) return null;

    return {
        record,
        state: {
            textures,
            nextEventTimeMs,
            flashStartTimeMs,
            flashEndTimeMs,
            burstFlashesRemaining,
            exposureBoost,
        },
    };
}

function writeLightningBackgroundState(record: Record<string, unknown>, state: LightningBackgroundState): void {
    Reflect.set(record, "nextEventTimeMs", state.nextEventTimeMs);
    Reflect.set(record, "flashStartTimeMs", state.flashStartTimeMs);
    Reflect.set(record, "flashEndTimeMs", state.flashEndTimeMs);
    Reflect.set(record, "burstFlashesRemaining", state.burstFlashesRemaining);
    Reflect.set(record, "exposureBoost", state.exposureBoost);
}

export function updateLightning(
    scene: THREE.Scene,
    renderer: THREE.WebGLRenderer,
    time: number
): void {
    const lightningData = readLightningBackgroundState(scene);
    if (!lightningData) return;

    const { record, state } = lightningData;
    const baseExposure = readFiniteNumber(Reflect.get(scene.userData, "baseExposure")) ?? 1.1;

    if (state.flashEndTimeMs <= 0 && time >= state.nextEventTimeMs) {
        if (state.burstFlashesRemaining <= 0) {
            state.burstFlashesRemaining = 1 + Math.floor(Math.random() * 3);
        }

        state.burstFlashesRemaining -= 1;
        const useStrongFlash = state.textures.length > 2 && Math.random() < 0.38;
        const flashTexture = useStrongFlash ? state.textures[2] : state.textures[1];
        state.exposureBoost = useStrongFlash ? 0.03 : 0.015;
        state.flashStartTimeMs = time;
        state.flashEndTimeMs = time + randomInRange(LIGHTNING_MIN_FLASH_MS, LIGHTNING_MAX_FLASH_MS);
        state.nextEventTimeMs = state.burstFlashesRemaining > 0
            ? state.flashEndTimeMs + randomInRange(LIGHTNING_MIN_GAP_MS, LIGHTNING_MAX_GAP_MS)
            : state.flashEndTimeMs + randomInRange(LIGHTNING_MIN_QUIET_MS, LIGHTNING_MAX_QUIET_MS);

        scene.background = flashTexture;
    }

    if (state.flashEndTimeMs > 0) {
        const flashDurationMs = Math.max(1, state.flashEndTimeMs - state.flashStartTimeMs);
        const flashProgress = THREE.MathUtils.clamp((time - state.flashStartTimeMs) / flashDurationMs, 0, 1);
        const attackEnd = LIGHTNING_ATTACK_PORTION;
        const flashIntensity = flashProgress <= attackEnd
            ? THREE.MathUtils.smoothstep(flashProgress / attackEnd, 0, 1)
            : 1 - THREE.MathUtils.smoothstep((flashProgress - attackEnd) / (1 - attackEnd), 0, 1);

        renderer.toneMappingExposure = baseExposure + state.exposureBoost * flashIntensity;

        if (flashProgress >= 1) {
            scene.background = state.textures[0];
            renderer.toneMappingExposure = baseExposure;
            state.flashStartTimeMs = 0;
            state.flashEndTimeMs = 0;
            state.exposureBoost = 0;
        }
    } else {
        renderer.toneMappingExposure = baseExposure;
    }

    writeLightningBackgroundState(record, state);
}

export function updateRain(
    rainOverlay: THREE.Mesh | null,
    camera: THREE.OrthographicCamera | null,
    time: number
): void {
    if (!rainOverlay || !camera) return;
    const material = rainOverlay.material;
    if (!(material instanceof THREE.MeshBasicMaterial)) return;
    if (!(material.map instanceof THREE.Texture)) return;

    camera.getWorldDirection(_rainForward);
    rainOverlay.position.copy(camera.position).addScaledVector(_rainForward, 8);
    rainOverlay.quaternion.copy(camera.quaternion);

    const viewWidth = Math.abs(camera.right - camera.left);
    const viewHeight = Math.abs(camera.top - camera.bottom);
    rainOverlay.scale.set(viewWidth * 1.14, viewHeight * 1.2, 1);

    const rainTexture = material.map;
    rainTexture.repeat.set(
        Math.max(6.2, viewWidth / 3.2),
        Math.max(7.2, viewHeight / 2.6)
    );

    const t = time * 0.001;
    rainTexture.offset.x = 0;
    rainTexture.offset.y = ((t * 2.15) % 1 + 1) % 1;
}

// =============================================================================
// BILLBOARDS
// =============================================================================

/**
 * Update billboard meshes to face the camera.
 * Caches camera quaternion so we only read it once per frame instead of
 * accessing the camera object in each iteration.
 */
const _billboardQuat = new THREE.Quaternion();

export function updateBillboards(billboards: THREE.Mesh[], camera: THREE.Camera): void {
    _billboardQuat.copy(camera.quaternion);
    for (const billboard of billboards) {
        billboard.quaternion.copy(_billboardQuat);
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

/**
 * Light LOD is intentionally a no-op.
 * Keeping the active light count stable avoids shader variant churn and render hitches.
 */
export function updateLightLOD(
    candleLights: THREE.Light[],
    cameraOffset: { x: number; z: number }
): void {
    void candleLights;
    void cameraOffset;
    return;
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
    return mesh.userData.disableOcclusionFade === true;
}

function buildTreeOcclusionCircle(meshes: THREE.Mesh[]): OcclusionCircle {
    for (const mesh of meshes) {
        const centerX = readFiniteNumber(mesh.userData.fogFootprintCenterX);
        const centerZ = readFiniteNumber(mesh.userData.fogFootprintCenterZ);
        const radius = readFiniteNumber(mesh.userData.fogFootprintRadius);
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

let cachedTreeMeshesRef: THREE.Mesh[] | undefined;
let cachedTreeMeshCount = -1;
let cachedTreeOcclusionGroups: TreeOcclusionGroup[] = [];

function buildTreeOcclusionGroups(treeMeshes: THREE.Mesh[]): TreeOcclusionGroup[] {
    const treeGroupMap = new Map<string, THREE.Mesh[]>();
    const standaloneTreeMeshes: THREE.Mesh[] = [];
    const groups: TreeOcclusionGroup[] = [];

    for (const mesh of treeMeshes) {
        const fogObjectId = mesh.userData.fogObjectId;
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
        groups.push({
            meshes: group,
            circle: buildTreeOcclusionCircle(group),
        });
    }

    for (const mesh of standaloneTreeMeshes) {
        groups.push({
            meshes: [mesh],
            circle: buildTreeOcclusionCircle([mesh]),
        });
    }

    return groups;
}

function getTreeOcclusionGroups(treeMeshes?: THREE.Mesh[]): TreeOcclusionGroup[] {
    if (!treeMeshes || treeMeshes.length === 0) return [];

    if (treeMeshes === cachedTreeMeshesRef && treeMeshes.length === cachedTreeMeshCount) {
        return cachedTreeOcclusionGroups;
    }

    cachedTreeMeshesRef = treeMeshes;
    cachedTreeMeshCount = treeMeshes.length;
    cachedTreeOcclusionGroups = buildTreeOcclusionGroups(treeMeshes);
    return cachedTreeOcclusionGroups;
}

let cachedColumnGroupsRef: THREE.Mesh[][] | undefined;
let cachedColumnGroupMeshCount = -1;
let cachedGroupedColumnMeshes = new Set<THREE.Mesh>();

function countColumnGroupMeshes(columnGroups: THREE.Mesh[][]): number {
    let count = 0;
    for (const group of columnGroups) {
        count += group.length;
    }
    return count;
}

function getGroupedColumnMeshes(columnGroups?: THREE.Mesh[][]): Set<THREE.Mesh> {
    if (!columnGroups || columnGroups.length === 0) {
        cachedColumnGroupsRef = undefined;
        cachedColumnGroupMeshCount = -1;
        cachedGroupedColumnMeshes = new Set<THREE.Mesh>();
        return cachedGroupedColumnMeshes;
    }

    const totalMeshCount = countColumnGroupMeshes(columnGroups);
    if (columnGroups === cachedColumnGroupsRef && totalMeshCount === cachedColumnGroupMeshCount) {
        return cachedGroupedColumnMeshes;
    }

    const nextGroupedMeshes = new Set<THREE.Mesh>();
    for (const group of columnGroups) {
        for (const mesh of group) {
            nextGroupedMeshes.add(mesh);
        }
    }

    cachedColumnGroupsRef = columnGroups;
    cachedColumnGroupMeshCount = totalMeshCount;
    cachedGroupedColumnMeshes = nextGroupedMeshes;
    return cachedGroupedColumnMeshes;
}

// Throttle expensive ray-box tests - only recalculate every N frames
const WALL_CHECK_INTERVAL = 3;
let wallCheckFrame = WALL_CHECK_INTERVAL;
const cachedOccludingMeshes = new Set<THREE.Mesh>();
// Track which tree/column groups are already fully marked to avoid redundant .some() scans
const cachedOccludingTreeGroups = new Set<TreeOcclusionGroup>();
const cachedOccludingColumnGroups = new Set<THREE.Mesh[]>();
const OCCLUSION_HASH_SEED = 2166136261;
const OCCLUSION_HASH_PRIME = 16777619;
const OCCLUSION_CAMERA_QUANT = 4; // 0.25-world-unit quantization
let lastOcclusionCameraKey = Number.NaN;
let lastOcclusionPlayerHash = 0;
let lastOcclusionPlayerCount = -1;
let occlusionDirty = true;
let wallOpacityTransitionsActive = true;
let candleOpacityTransitionsActive = true;
let flameOpacityTransitionsActive = true;

function syncMaterialTransparency(
    material: THREE.MeshStandardMaterial | THREE.MeshBasicMaterial,
    targetOpacity: number,
    currentOpacity: number
): void {
    const shouldBeTransparent = targetOpacity < 0.999 || currentOpacity < 0.999;
    if (material.transparent !== shouldBeTransparent) {
        material.transparent = shouldBeTransparent;
        material.needsUpdate = true;
    }
}

function computePlayerOcclusionHash(
    unitsState: Unit[],
    unitGroups: Record<number, UnitGroup>
): { hash: number; count: number } {
    let hash = OCCLUSION_HASH_SEED;
    let count = 0;

    for (const unit of unitsState) {
        if (unit.team !== "player" || unit.hp <= 0) continue;
        const group = unitGroups[unit.id];
        if (!group || !group.visible) continue;

        const qx = Math.round(group.position.x * OCCLUSION_CAMERA_QUANT);
        const qz = Math.round(group.position.z * OCCLUSION_CAMERA_QUANT);
        hash = Math.imul(hash ^ unit.id, OCCLUSION_HASH_PRIME);
        hash = Math.imul(hash ^ qx, OCCLUSION_HASH_PRIME);
        hash = Math.imul(hash ^ qz, OCCLUSION_HASH_PRIME);
        count++;
    }

    return { hash: hash >>> 0, count };
}

/**
 * Update wall, tree, column, and candle transparency based on unit occlusion.
 * Objects between the camera and any unit become semi-transparent.
 * Ray-box intersection tests run only while camera/player inputs are changing
 * and are throttled to every 3rd dirty frame.
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
    let occlusionRecomputedThisFrame = false;
    const qCameraX = Math.round(camera.position.x * OCCLUSION_CAMERA_QUANT);
    const qCameraZ = Math.round(camera.position.z * OCCLUSION_CAMERA_QUANT);
    const cameraKey = qCameraX * 65536 + qCameraZ;
    const { hash: playerHash, count: playerCount } = computePlayerOcclusionHash(unitsState, unitGroups);
    const occlusionInputsChanged = cameraKey !== lastOcclusionCameraKey
        || playerHash !== lastOcclusionPlayerHash
        || playerCount !== lastOcclusionPlayerCount;

    if (occlusionInputsChanged) {
        lastOcclusionCameraKey = cameraKey;
        lastOcclusionPlayerHash = playerHash;
        lastOcclusionPlayerCount = playerCount;
        if (!occlusionDirty) {
            wallCheckFrame = WALL_CHECK_INTERVAL - 1;
        }
        occlusionDirty = true;
    }

    if (occlusionDirty) {
        wallCheckFrame++;
    }

    // Only recalculate occlusion every N frames (expensive ray-box tests)
    if (occlusionDirty && wallCheckFrame >= WALL_CHECK_INTERVAL) {
        occlusionRecomputedThisFrame = true;
        wallCheckFrame = 0;
        occlusionDirty = false;
        wallOpacityTransitionsActive = true;
        candleOpacityTransitionsActive = true;
        flameOpacityTransitionsActive = true;
        cachedOccludingMeshes.clear();
        cachedOccludingTreeGroups.clear();
        cachedOccludingColumnGroups.clear();

        _cameraPos.copy(camera.position);
        const cameraX = _cameraPos.x;
        const cameraZ = _cameraPos.z;

        const treeOcclusionGroups = getTreeOcclusionGroups(treeMeshes);
        const groupedColumnMeshes = getGroupedColumnMeshes(columnGroups);

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
                const unitX = unitGroup.position.x;
                const unitZ = unitGroup.position.z;

                for (const group of treeOcclusionGroups) {
                    if (cachedOccludingTreeGroups.has(group)) continue;
                    const groupOccludes = doesCircleOccludeSegmentXZ(
                        cameraX,
                        cameraZ,
                        unitX,
                        unitZ,
                        group.circle
                    );
                    if (groupOccludes) {
                        cachedOccludingTreeGroups.add(group);
                        for (const mesh of group.meshes) {
                            cachedOccludingMeshes.add(mesh);
                        }
                    }
                }
            }

            // Check grouped columns first so multipart structures fade together.
            if (columnGroups) {
                for (const group of columnGroups) {
                    if (cachedOccludingColumnGroups.has(group)) continue;

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
                        cachedOccludingColumnGroups.add(group);
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
                    const distToCandle = Math.hypot(dx, dz);
                    // Candle occludes if it's close to unit (within 2 units) and between camera and unit
                    if (distToCandle < 2.5) {
                        // Check if candle is between camera and unit using dot product
                        const camToUnitX = unitX - cameraX;
                        const camToUnitZ = unitZ - cameraZ;
                        const camToCandleX = candleX - cameraX;
                        const camToCandleZ = candleZ - cameraZ;
                        const dot = camToUnitX * camToCandleX + camToUnitZ * camToCandleZ;
                        const camToUnitLenSq = camToUnitX * camToUnitX + camToUnitZ * camToUnitZ;
                        const camToCandleLenSq = camToCandleX * camToCandleX + camToCandleZ * camToCandleZ;
                        if (dot > 0 && camToCandleLenSq < camToUnitLenSq) {
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

    // Update wall opacities while transitions are active or occlusion changed.
    if (occlusionRecomputedThisFrame || wallOpacityTransitionsActive) {
        let nextWallTransitionsActive = false;
        for (const mesh of wallMeshes) {
            const mat = mesh.material as THREE.MeshStandardMaterial;
            const targetOpacity = cachedOccludingMeshes.has(mesh) ? WALL_OPACITY_OCCLUDING : WALL_OPACITY_NORMAL;
            syncMaterialTransparency(mat, targetOpacity, mat.opacity);
            const delta = targetOpacity - mat.opacity;
            if (Math.abs(delta) < 0.0005) continue;
            nextWallTransitionsActive = true;
            mat.opacity += delta * WALL_OPACITY_LERP_SPEED;
            if (Math.abs(mat.opacity - targetOpacity) < 0.01) mat.opacity = targetOpacity;
            syncMaterialTransparency(mat, targetOpacity, mat.opacity);
        }
        wallOpacityTransitionsActive = nextWallTransitionsActive;
    }

    // Update tree opacities if provided
    if (treeMeshes) {
        for (const mesh of treeMeshes) {
            const meshData = mesh.userData as FogMeshUserData;
            if (meshData.isShadow) continue;
            const mat = mesh.material as THREE.MeshStandardMaterial;
            const fogState = toFogRenderState(meshData.fogRenderState);
            const fogOpacity = readFiniteNumber(meshData.fogResolvedOpacity);
            const occlusionTarget = cachedOccludingMeshes.has(mesh) ? WALL_OPACITY_OCCLUDING : WALL_OPACITY_NORMAL;
            let targetOpacity = occlusionTarget;

            if (fogOpacity !== null) {
                if (fogState === FOG_STATE_UNEXPLORED) {
                    targetOpacity = fogOpacity;
                } else {
                    targetOpacity = Math.min(fogOpacity, occlusionTarget);
                }
            }

            if (targetOpacity > 0.01) {
                mesh.visible = true;
            }

            syncMaterialTransparency(mat, targetOpacity, mat.opacity);
            const delta = targetOpacity - mat.opacity;
            if (Math.abs(delta) >= 0.0005) {
                mat.opacity += delta * WALL_OPACITY_LERP_SPEED;
                if (Math.abs(mat.opacity - targetOpacity) < 0.01) mat.opacity = targetOpacity;
            }
            syncMaterialTransparency(mat, targetOpacity, mat.opacity);

            if (fogState === FOG_STATE_UNEXPLORED && targetOpacity <= 0.01 && mat.opacity <= 0.01) {
                mesh.visible = false;
            }
        }
    }

    // Update column opacities if provided
    if (columnMeshes) {
        for (const mesh of columnMeshes) {
            const mat = mesh.material as THREE.MeshStandardMaterial;
            const meshData = mesh.userData as FogMeshUserData;
            const fogState = toFogRenderState(meshData.fogRenderState);
            const fogOpacity = readFiniteNumber(meshData.fogResolvedOpacity);
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

            syncMaterialTransparency(mat, targetOpacity, mat.opacity);
            const delta = targetOpacity - mat.opacity;
            if (Math.abs(delta) < 0.0005) continue;
            mat.opacity += delta * WALL_OPACITY_LERP_SPEED;
            if (Math.abs(mat.opacity - targetOpacity) < 0.01) mat.opacity = targetOpacity;
            syncMaterialTransparency(mat, targetOpacity, mat.opacity);
        }
    }

    // Update candle opacities if provided
    if (!candleMeshes || candleMeshes.length === 0) {
        candleOpacityTransitionsActive = false;
    } else if (occlusionRecomputedThisFrame || candleOpacityTransitionsActive) {
        let nextCandleTransitionsActive = false;
        for (const mesh of candleMeshes) {
            const mat = mesh.material as THREE.MeshStandardMaterial;
            const targetOpacity = cachedOccludingMeshes.has(mesh) ? WALL_OPACITY_OCCLUDING : WALL_OPACITY_NORMAL;
            syncMaterialTransparency(mat, targetOpacity, mat.opacity);
            const delta = targetOpacity - mat.opacity;
            if (Math.abs(delta) < 0.0005) continue;
            nextCandleTransitionsActive = true;
            mat.opacity += delta * WALL_OPACITY_LERP_SPEED;
            if (Math.abs(mat.opacity - targetOpacity) < 0.01) mat.opacity = targetOpacity;
            syncMaterialTransparency(mat, targetOpacity, mat.opacity);
        }
        candleOpacityTransitionsActive = nextCandleTransitionsActive;
    }

    // Update flame opacities if provided (use MeshBasicMaterial)
    if (!flameMeshes || flameMeshes.length === 0) {
        flameOpacityTransitionsActive = false;
    } else if (occlusionRecomputedThisFrame || flameOpacityTransitionsActive) {
        let nextFlameTransitionsActive = false;
        for (const mesh of flameMeshes) {
            const mat = mesh.material as THREE.MeshBasicMaterial;
            const baseOpacity = 0.85;  // Flame's normal opacity
            const targetOpacity = cachedOccludingMeshes.has(mesh) ? baseOpacity * WALL_OPACITY_OCCLUDING : baseOpacity;
            syncMaterialTransparency(mat, targetOpacity, mat.opacity);
            const delta = targetOpacity - mat.opacity;
            if (Math.abs(delta) < 0.0005) continue;
            nextFlameTransitionsActive = true;
            mat.opacity += delta * WALL_OPACITY_LERP_SPEED;
            if (Math.abs(mat.opacity - targetOpacity) < 0.01) mat.opacity = targetOpacity;
            syncMaterialTransparency(mat, targetOpacity, mat.opacity);
        }
        flameOpacityTransitionsActive = nextFlameTransitionsActive;
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

interface FogMeshUserData extends Record<string, unknown> {
    treeX?: number;
    treeZ?: number;
    isTrunk?: boolean;
    isFoliage?: boolean;
    isShadow?: boolean;
    fullHeight?: number;
    fullY?: number;
    fogRenderState?: number;
    fogResolvedOpacity?: number;
    fogDitherSeed?: number;
    fogTransitionDurationMs?: number;
    fogFootprintCells?: unknown;
    fogCachedFootprintCellsSource?: unknown;
    fogCachedFootprintCells?: FogFootprintCell[] | null;
    fogTransitionStartMs?: number;
    fogTransitionFromOpacity?: number;
    fogTransitionFromScaleY?: number;
    fogTransitionFromPosY?: number;
    fogClipX?: number;
    fogClipZ?: number;
    fogClipBaseY?: number;
    fogClipFullHeight?: number;
    fogClipFullY?: number;
    fogClipFullScaleY?: number;
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
    return "alphaHash" in material && typeof (material as AlphaHashCapableMaterial).alphaHash === "boolean";
}

function getFogDitherSeed(mesh: THREE.Mesh): number {
    const meshData = mesh.userData as FogMeshUserData;
    const existing = readFiniteNumber(meshData.fogDitherSeed);
    if (existing !== null) return existing;
    const seed = Math.abs(Math.sin(mesh.id * 12.9898 + 78.233)) % 1;
    meshData.fogDitherSeed = seed;
    return seed;
}

function getFogTransitionDurationMs(mesh: THREE.Mesh): number {
    const meshData = mesh.userData as FogMeshUserData;
    const existing = readFiniteNumber(meshData.fogTransitionDurationMs);
    if (existing !== null) return existing;
    const seed = getFogDitherSeed(mesh);
    const jitter = (seed * 2 - 1) * FOG_TRANSITION_JITTER_MS;
    const duration = THREE.MathUtils.clamp(FOG_TRANSITION_BASE_MS + jitter, 150, 300);
    meshData.fogTransitionDurationMs = duration;
    return duration;
}

function readFogFootprintCells(mesh: THREE.Mesh): FogFootprintCell[] | null {
    const meshData = mesh.userData as FogMeshUserData;
    const rawCells = meshData.fogFootprintCells;
    if (meshData.fogCachedFootprintCellsSource === rawCells) {
        return meshData.fogCachedFootprintCells ?? null;
    }
    if (!Array.isArray(rawCells) || rawCells.length === 0) {
        meshData.fogCachedFootprintCellsSource = rawCells;
        meshData.fogCachedFootprintCells = null;
        return null;
    }

    const cells: FogFootprintCell[] = [];
    for (const rawCell of rawCells) {
        if (!rawCell || typeof rawCell !== "object") continue;
        const cellObj = rawCell as { x?: unknown; z?: unknown };
        const x = readFiniteNumber(cellObj.x);
        const z = readFiniteNumber(cellObj.z);
        if (x === null || z === null) continue;
        cells.push({ x: Math.floor(x), z: Math.floor(z) });
    }

    const parsedCells = cells.length > 0 ? cells : null;
    meshData.fogCachedFootprintCellsSource = rawCells;
    meshData.fogCachedFootprintCells = parsedCells;
    return parsedCells;
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
    const meshData = mesh.userData as FogMeshUserData;
    return {
        opacity: readFiniteNumber(meshData.fogTransitionFromOpacity) ?? fallbackOpacity,
        scaleY: readFiniteNumber(meshData.fogTransitionFromScaleY) ?? fallbackScaleY,
        posY: readFiniteNumber(meshData.fogTransitionFromPosY) ?? fallbackPosY,
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
    const meshData = mesh.userData as FogMeshUserData;
    const previousState = toFogRenderState(meshData.fogRenderState);

    if (previousState === null) {
        meshData.fogRenderState = nextState;
        meshData.fogTransitionStartMs = now;
        meshData.fogTransitionFromOpacity = targetOpacity;
        meshData.fogTransitionFromScaleY = targetScaleY;
        meshData.fogTransitionFromPosY = targetPosY;
        return {
            opacity: targetOpacity,
            scaleY: targetScaleY,
            posY: targetPosY,
            progress: 1,
        };
    }

    if (previousState !== nextState) {
        meshData.fogRenderState = nextState;
        meshData.fogTransitionStartMs = now;
        meshData.fogTransitionFromOpacity = currentOpacity;
        meshData.fogTransitionFromScaleY = currentScaleY;
        meshData.fogTransitionFromPosY = currentPosY;
    }

    const startMs = readFiniteNumber(meshData.fogTransitionStartMs) ?? now;
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

    const seed = getFogDitherSeed(mesh);
    const ditherOffset = wantsDither ? (seed - 0.5) * FOG_DITHER_OPACITY_VARIANCE : 0;
    const resolvedOpacity = THREE.MathUtils.clamp(clampedOpacity + ditherOffset, 0, 1);
    syncMaterialTransparency(material, resolvedOpacity, material.opacity);
    material.opacity = material.transparent ? resolvedOpacity : 1;
}

/**
 * Update trees with center-cell FoW states.
 * Trees are treated as a single tile for fog reveal regardless of canopy size.
 */
export function updateTreeFogVisibility(
    treeMeshes: THREE.Mesh[],
    visibility: number[][]
): boolean {
    for (const mesh of treeMeshes) {
        const meshData = mesh.userData as FogMeshUserData;
        const treeX = readFiniteNumber(meshData.treeX) ?? mesh.position.x;
        const treeZ = readFiniteNumber(meshData.treeZ) ?? mesh.position.z;
        const centerX = Math.floor(treeX);
        const centerZ = Math.floor(treeZ);
        const fogState = toFogRenderState(visibility[centerX]?.[centerZ] ?? 0) ?? FOG_STATE_UNEXPLORED;
        meshData.fogRenderState = fogState;
        meshData.fogResolvedOpacity = fogState === FOG_STATE_UNEXPLORED ? 0 : 1;

        if (meshData.isShadow) {
            mesh.visible = fogState !== FOG_STATE_UNEXPLORED;
            continue;
        } else if (meshData.isTrunk) {
            const fullHeight = readFiniteNumber(meshData.fullHeight);
            if (fullHeight === null || fullHeight <= 0) continue;
            mesh.scale.y = 1;
            mesh.position.y = fullHeight / 2;
        } else if (meshData.isFoliage) {
            const fullY = readFiniteNumber(meshData.fullY);
            if (fullY === null) continue;
            mesh.scale.y = 1;
            mesh.position.y = fullY;
        }

        if (fogState !== FOG_STATE_UNEXPLORED) {
            mesh.visible = true;
        }
    }

    return false;
}

export function revealAllTreeMeshes(treeMeshes: THREE.Mesh[]): void {
    for (const mesh of treeMeshes) {
        const meshData = mesh.userData as FogMeshUserData;
        meshData.fogRenderState = FOG_STATE_VISIBLE;
        meshData.fogResolvedOpacity = 1;
        mesh.visible = true;

        if (meshData.isTrunk) {
            const fullHeight = readFiniteNumber(meshData.fullHeight);
            if (fullHeight !== null && fullHeight > 0) {
                mesh.scale.y = 1;
                mesh.position.y = fullHeight / 2;
            }
        } else if (meshData.isFoliage) {
            const fullY = readFiniteNumber(meshData.fullY);
            if (fullY !== null) {
                mesh.scale.y = 1;
                mesh.position.y = fullY;
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

export function revealAllFogOccluderMeshes(fogOccluderMeshes: THREE.Mesh[]): void {
    for (const mesh of fogOccluderMeshes) {
        const meshData = mesh.userData as FogMeshUserData;
        const fullY = readFiniteNumber(meshData.fogClipFullY);
        const fullScaleY = readFiniteNumber(meshData.fogClipFullScaleY);
        const mat = getFogOccluderMaterial(mesh);

        meshData.fogRenderState = FOG_STATE_VISIBLE;
        mesh.visible = true;

        if (fullScaleY !== null) {
            mesh.scale.y = fullScaleY;
        }
        if (fullY !== null) {
            mesh.position.y = fullY;
        }

        if (mat) {
            applyFogOpacity(mesh, mat, 1);
            meshData.fogResolvedOpacity = mat.opacity;
        } else {
            meshData.fogResolvedOpacity = 1;
        }
    }
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
): boolean {
    const now = getGameTime();
    const FOG_Y = 2.6;
    const MAX_HEIGHT_UNEXPLORED = FOG_Y - 0.1;
    let hasActiveTransitions = false;

    for (const mesh of fogOccluderMeshes) {
        const meshData = mesh.userData as FogMeshUserData;
        const clipX = readFiniteNumber(meshData.fogClipX);
        const clipZ = readFiniteNumber(meshData.fogClipZ);
        const baseY = readFiniteNumber(meshData.fogClipBaseY);
        const fullHeight = readFiniteNumber(meshData.fogClipFullHeight);
        const fullY = readFiniteNumber(meshData.fogClipFullY);
        const fullScaleY = readFiniteNumber(meshData.fogClipFullScaleY);

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
        if (transition.progress < 1) {
            hasActiveTransitions = true;
        }

        mesh.scale.y = transition.scaleY;
        mesh.position.y = transition.posY;
        if (mat) {
            applyFogOpacity(mesh, mat, transition.opacity);
            meshData.fogResolvedOpacity = mat.opacity;
        } else {
            meshData.fogResolvedOpacity = transition.opacity;
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

    return hasActiveTransitions;
}
