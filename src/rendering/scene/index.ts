// =============================================================================
// THREE.JS SCENE SETUP - Main entry point
// =============================================================================

import * as THREE from "three";
import { FOG_SCALE, DEFAULT_CANDLE_LIGHT_COLOR, DEFAULT_TORCH_LIGHT_COLOR } from "../../core/constants";
import { getCurrentArea, getComputedAreaData } from "../../game/areas";
import {
    DEFAULT_AREA_LIGHT_ANGLE,
    DEFAULT_AREA_LIGHT_BRIGHTNESS,
    DEFAULT_AREA_LIGHT_DECAY,
    DEFAULT_AREA_LIGHT_DIFFUSION,
    DEFAULT_AREA_LIGHT_HEIGHT,
    DEFAULT_AREA_LIGHT_RADIUS,
    DEFAULT_AREA_LIGHT_TINT,
    MAX_PINE_TREE_SIZE,
    MAX_TREE_SIZE,
    MIN_TREE_SIZE,
} from "../../game/areas/types";
import {
    clampTileTintPercent,
    normalizeTileLayerStack,
    normalizeTintLayerStack,
    TILE_EMPTY,
} from "../../game/areas/tileLayers";
import { getUnitStats } from "../../game/units";
import type { Unit, UnitGroup, FogTexture } from "../../core/types";

// Re-export types
export type { DoorMesh, SecretDoorMesh, ChestMeshData, SceneRefs } from "./types";
import type { DoorMesh, SecretDoorMesh, ChestMeshData, SceneRefs } from "./types";

// Re-export update functions
export {
    updateChestStates,
    updateCamera,
    updateWater,
    updateBillboards,
    updateLightLOD,
    updateWallTransparency,
    updateTreeFogVisibility,
    updateFogOccluderVisibility
} from "./updates";

// Re-export unit functions
export { getEffectiveSize, addUnitToScene, createUnitSceneGroup, ensureTexturesLoaded } from "./units";
import { createUnitSceneGroup, ensureTexturesLoaded } from "./units";

// =============================================================================
// ROUNDED CORNER FLOOR MATERIAL
// =============================================================================

/**
 * Create a MeshStandardMaterial with rounded tile corner clipping using onBeforeCompile.
 * Supports convex (outer) and concave (inner) corner cuts at once.
 */
function createRoundedFloorMaterial(
    color: string,
    outerCorners: [number, number, number, number],
    innerCorners: [number, number, number, number] = [0, 0, 0, 0],
    radius: number = 0.15,
    metalness: number = 0.2,
    roughness: number = 0.9
): THREE.MeshStandardMaterial {
    const mat = new THREE.MeshStandardMaterial({
        color,
        metalness,
        roughness,
    });

    mat.onBeforeCompile = (shader) => {
        // Add uniforms for corners and radius
        shader.uniforms.uOuterCorners = { value: new THREE.Vector4(outerCorners[0], outerCorners[1], outerCorners[2], outerCorners[3]) };
        shader.uniforms.uInnerCorners = { value: new THREE.Vector4(innerCorners[0], innerCorners[1], innerCorners[2], innerCorners[3]) };
        shader.uniforms.uRadius = { value: radius };

        // Add varying for UV in vertex shader
        shader.vertexShader = shader.vertexShader.replace(
            "#include <common>",
            `#include <common>
            varying vec2 vRoundUv;`
        );
        shader.vertexShader = shader.vertexShader.replace(
            "#include <uv_vertex>",
            `#include <uv_vertex>
            vRoundUv = uv;`
        );

        // Add corner rounding logic to fragment shader
        shader.fragmentShader = shader.fragmentShader.replace(
            "#include <common>",
            `#include <common>
            uniform vec4 uOuterCorners;
            uniform vec4 uInnerCorners;
            uniform float uRadius;
            varying vec2 vRoundUv;`
        );

        // Add discard logic early in fragment shader (before color calculations)
        shader.fragmentShader = shader.fragmentShader.replace(
            "#include <map_fragment>",
            `#include <map_fragment>

            // Rounded corner discard
            vec2 p = vRoundUv;
            float r = uRadius;

            // Top-left corner (UV: 0,1)
            if (uOuterCorners.x > 0.5 && p.x < r && p.y > 1.0 - r) {
                vec2 corner = vec2(r, 1.0 - r);
                if (length(p - corner) > r) discard;
            }
            if (uInnerCorners.x > 0.5 && p.x < r && p.y > 1.0 - r) {
                vec2 corner = vec2(0.0, 1.0);
                if (length(p - corner) < r) discard;
            }

            // Top-right corner (UV: 1,1)
            if (uOuterCorners.y > 0.5 && p.x > 1.0 - r && p.y > 1.0 - r) {
                vec2 corner = vec2(1.0 - r, 1.0 - r);
                if (length(p - corner) > r) discard;
            }
            if (uInnerCorners.y > 0.5 && p.x > 1.0 - r && p.y > 1.0 - r) {
                vec2 corner = vec2(1.0, 1.0);
                if (length(p - corner) < r) discard;
            }

            // Bottom-right corner (UV: 1,0)
            if (uOuterCorners.z > 0.5 && p.x > 1.0 - r && p.y < r) {
                vec2 corner = vec2(1.0 - r, r);
                if (length(p - corner) > r) discard;
            }
            if (uInnerCorners.z > 0.5 && p.x > 1.0 - r && p.y < r) {
                vec2 corner = vec2(1.0, 0.0);
                if (length(p - corner) < r) discard;
            }

            // Bottom-left corner (UV: 0,0)
            if (uOuterCorners.w > 0.5 && p.x < r && p.y < r) {
                vec2 corner = vec2(r, r);
                if (length(p - corner) > r) discard;
            }
            if (uInnerCorners.w > 0.5 && p.x < r && p.y < r) {
                vec2 corner = vec2(0.0, 0.0);
                if (length(p - corner) < r) discard;
            }`
        );
    };

    return mat;
}

/**
 * Check if a floor tile exists at the given position
 */
function getFloorType(char: string | undefined): string | null {
    if (!char || char === " " || char === ".") return null;
    const normalized = char.toLowerCase();
    if (normalized === "s" || normalized === "d" || normalized === "g" || normalized === "w" || normalized === "t" || normalized === "~") {
        return normalized;
    }
    return null;
}

function getFloorTypeAt(floor: string[] | string[][], x: number, z: number): string | null {
    if (z < 0 || z >= floor.length) return null;
    const row = floor[z];
    if (!row) return null;
    if (x < 0 || x >= row.length) return null;
    const char = typeof row === "string" ? row[x] : row[x];
    return getFloorType(char);
}

function isConnectedFloorType(currentType: string, neighborType: string | null): boolean {
    return neighborType === currentType;
}

interface TileCornerRounding {
    outer: [number, number, number, number];
    inner: [number, number, number, number];
}

/**
 * Determine natural outer/inner rounded corners based on cardinal + diagonal neighbors.
 */
function getNaturalTileCornerRounding(
    floor: string[] | string[][],
    x: number,
    z: number,
    currentType: string
): TileCornerRounding {
    const hasTop = isConnectedFloorType(currentType, getFloorTypeAt(floor, x, z - 1));      // -Z direction
    const hasBottom = isConnectedFloorType(currentType, getFloorTypeAt(floor, x, z + 1));   // +Z direction
    const hasLeft = isConnectedFloorType(currentType, getFloorTypeAt(floor, x - 1, z));     // -X direction
    const hasRight = isConnectedFloorType(currentType, getFloorTypeAt(floor, x + 1, z));    // +X direction

    const hasTopLeft = isConnectedFloorType(currentType, getFloorTypeAt(floor, x - 1, z - 1));
    const hasTopRight = isConnectedFloorType(currentType, getFloorTypeAt(floor, x + 1, z - 1));
    const hasBottomRight = isConnectedFloorType(currentType, getFloorTypeAt(floor, x + 1, z + 1));
    const hasBottomLeft = isConnectedFloorType(currentType, getFloorTypeAt(floor, x - 1, z + 1));

    const outer: [number, number, number, number] = [
        (!hasTop && !hasLeft && !hasTopLeft) ? 1 : 0,
        (!hasTop && !hasRight && !hasTopRight) ? 1 : 0,
        (!hasBottom && !hasRight && !hasBottomRight) ? 1 : 0,
        (!hasBottom && !hasLeft && !hasBottomLeft) ? 1 : 0,
    ];

    const inner: [number, number, number, number] = [
        (hasTop && hasLeft && !hasTopLeft) ? 1 : 0,
        (hasTop && hasRight && !hasTopRight) ? 1 : 0,
        (hasBottom && hasRight && !hasBottomRight) ? 1 : 0,
        (hasBottom && hasLeft && !hasBottomLeft) ? 1 : 0,
    ];

    return { outer, inner };
}

const FLOOR_VARIATION_BUCKET_COUNT = 7;
const floorVariationColorCache: Record<string, string> = {};

function hashNoise(x: number, z: number, seed: number): number {
    const hash = Math.sin(x * 127.1 + z * 311.7 + seed * 91.7) * 43758.5453123;
    return hash - Math.floor(hash);
}

function smoothstep01(value: number): number {
    return value * value * (3 - 2 * value);
}

function sampleSmoothNoise(x: number, z: number, scale: number, seed: number): number {
    const sx = x / scale;
    const sz = z / scale;
    const x0 = Math.floor(sx);
    const z0 = Math.floor(sz);
    const x1 = x0 + 1;
    const z1 = z0 + 1;

    const fx = sx - x0;
    const fz = sz - z0;
    const ux = smoothstep01(fx);
    const uz = smoothstep01(fz);

    const n00 = hashNoise(x0, z0, seed);
    const n10 = hashNoise(x1, z0, seed);
    const n01 = hashNoise(x0, z1, seed);
    const n11 = hashNoise(x1, z1, seed);

    const nx0 = THREE.MathUtils.lerp(n00, n10, ux);
    const nx1 = THREE.MathUtils.lerp(n01, n11, ux);
    return THREE.MathUtils.lerp(nx0, nx1, uz) * 2 - 1;
}

function getTileVariationBucket(x: number, z: number, char: string): number {
    const seed = char.charCodeAt(0);
    const macro = sampleSmoothNoise(x + 0.5, z + 0.5, 6.5, seed * 0.13 + 17.0);
    const detail = sampleSmoothNoise(x + 0.5, z + 0.5, 3.0, seed * 0.29 + 53.0);
    const blended = THREE.MathUtils.clamp(macro * 0.8 + detail * 0.2, -1, 1);
    const normalized = (blended + 1) * 0.5;
    return Math.round(normalized * (FLOOR_VARIATION_BUCKET_COUNT - 1));
}

function getVariationAmplitude(type: string): number {
    if (type === "s") return 0.022;
    if (type === "d") return 0.018;
    if (type === "g") return 0.016;
    if (type === "t") return 0.014;
    return 0.0;
}

function applyTileTintColor(baseColor: string, tintPercent: number): string {
    const clamped = clampTileTintPercent(tintPercent);
    if (clamped === 0) return baseColor;

    const color = new THREE.Color(baseColor);
    const hsl = { h: 0, s: 0, l: 0 };
    color.getHSL(hsl);
    const delta = clamped * 0.0024;
    color.setHSL(hsl.h, hsl.s, THREE.MathUtils.clamp(hsl.l + delta, 0, 1));
    return `#${color.getHexString()}`;
}

function getFloorVariantColor(baseColor: string, x: number, z: number, char: string): string {
    const type = getFloorType(char);
    if (!type || type === "w") return baseColor;

    const variationBucket = getTileVariationBucket(x, z, char);
    const cacheKey = `${baseColor}|${type}|${variationBucket}`;
    const cached = floorVariationColorCache[cacheKey];
    if (cached) return cached;

    const color = new THREE.Color(baseColor);
    const hsl = { h: 0, s: 0, l: 0 };
    color.getHSL(hsl);
    const centered = FLOOR_VARIATION_BUCKET_COUNT <= 1
        ? 0
        : (variationBucket / (FLOOR_VARIATION_BUCKET_COUNT - 1)) * 2 - 1;
    const delta = centered * getVariationAmplitude(type);
    color.setHSL(hsl.h, hsl.s, THREE.MathUtils.clamp(hsl.l + delta, 0, 1));
    const varied = `#${color.getHexString()}`;
    floorVariationColorCache[cacheKey] = varied;
    return varied;
}

function hashAreaIdToUnitRange(areaId: string): number {
    let hash = 0;
    for (let i = 0; i < areaId.length; i++) {
        hash = ((hash << 5) - hash) + areaId.charCodeAt(i);
        hash |= 0;
    }
    const normalized = Math.abs(hash % 1000) / 1000;
    return normalized;
}

function hasLitMaterial(material: THREE.Material | THREE.Material[]): boolean {
    const materials = Array.isArray(material) ? material : [material];
    return materials.some(mat =>
        mat instanceof THREE.MeshStandardMaterial ||
        mat instanceof THREE.MeshPhysicalMaterial ||
        mat instanceof THREE.MeshLambertMaterial ||
        mat instanceof THREE.MeshPhongMaterial ||
        mat instanceof THREE.MeshToonMaterial
    );
}

function applyShadowDefaults(scene: THREE.Scene): void {
    scene.traverse((object: THREE.Object3D) => {
        if (!(object instanceof THREE.Mesh)) return;
        if (!hasLitMaterial(object.material)) return;

        if (object.userData?.liquid) {
            object.castShadow = false;
            object.receiveShadow = false;
            return;
        }

        if (object.name === "ground") {
            object.castShadow = false;
            object.receiveShadow = true;
            return;
        }

        if (object.name === "lava") {
            object.castShadow = false;
            object.receiveShadow = false;
            return;
        }

        if (typeof object.userData?.unitId === "number") {
            object.castShadow = false;
            object.receiveShadow = false;
            return;
        }

        if (object.name === "obstacle") {
            object.castShadow = true;
            object.receiveShadow = true;
            return;
        }

        if (object.name === "chest" || object.name === "decoration") {
            object.castShadow = false;
            object.receiveShadow = true;
            return;
        }
    });
}

interface CandleLightSource {
    x: number;
    y: number;
    z: number;
    kind: "candle" | "torch";
    colorHex: string;
    intensity: number;
    range: number;
}

interface CandleLightCluster {
    colorHex: string;
    members: CandleLightSource[];
    weightedX: number;
    weightedY: number;
    weightedZ: number;
    totalWeight: number;
    maxRange: number;
    totalIntensity: number;
}

const CANDLE_LIGHT_CLUSTER_RADIUS = 5.5;
const CANDLE_LIGHT_CLUSTER_MAX_MEMBERS = 6;
const DIRECTIONAL_SHADOW_MAP_SIZE = 512;
const MAX_FLAME_CLUSTER_LIGHTS = 2;
const MAX_AREA_LIGHTS = 6;
const ENABLE_DOOR_POINT_LIGHTS = false;
const RENDERER_MAX_PIXEL_RATIO = 1.25;
const RENDER_ORDER_GROUND = 0;
const RENDER_ORDER_FLOOR = 10;
const RENDER_ORDER_GRID = 20;
const RENDER_ORDER_PROP = 30;
const RENDER_ORDER_FOG = 1100;

type StaticRenderTier = "ground" | "floor" | "grid";

function isSceneRenderable(object: THREE.Object3D): boolean {
    return object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points || object instanceof THREE.Sprite;
}

function readStaticRenderTier(value: unknown): StaticRenderTier | null {
    if (value === "ground" || value === "floor" || value === "grid") {
        return value;
    }
    return null;
}

function setStaticRenderTier(object: THREE.Object3D, tier: StaticRenderTier): void {
    object.userData.staticRenderTier = tier;
}

function applyStaticRenderOrder(scene: THREE.Scene): void {
    scene.traverse((object: THREE.Object3D) => {
        if (!isSceneRenderable(object)) return;
        const tier = readStaticRenderTier(object.userData.staticRenderTier);
        if (tier === "ground") {
            object.renderOrder = RENDER_ORDER_GROUND;
            return;
        }
        if (tier === "floor") {
            object.renderOrder = RENDER_ORDER_FLOOR;
            return;
        }
        if (tier === "grid") {
            object.renderOrder = RENDER_ORDER_GRID;
            return;
        }
        object.renderOrder = RENDER_ORDER_PROP;
    });
}

function normalizeHexColor(color: string | undefined, fallback: string): string {
    if (typeof color === "string" && /^#[0-9a-fA-F]{6}$/.test(color)) {
        return color.toLowerCase();
    }
    return fallback;
}

function clampFinite(value: number | undefined, min: number, max: number, fallback: number): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return fallback;
    }
    return Math.max(min, Math.min(max, value));
}

function createCluster(source: CandleLightSource): CandleLightCluster {
    return {
        colorHex: source.colorHex,
        members: [source],
        weightedX: source.x * source.intensity,
        weightedY: source.y * source.intensity,
        weightedZ: source.z * source.intensity,
        totalWeight: source.intensity,
        maxRange: source.range,
        totalIntensity: source.intensity,
    };
}

function addSourceToCluster(cluster: CandleLightCluster, source: CandleLightSource): void {
    cluster.members.push(source);
    cluster.weightedX += source.x * source.intensity;
    cluster.weightedY += source.y * source.intensity;
    cluster.weightedZ += source.z * source.intensity;
    cluster.totalWeight += source.intensity;
    cluster.maxRange = Math.max(cluster.maxRange, source.range);
    cluster.totalIntensity += source.intensity;
}

function buildCandleLightClusters(sources: CandleLightSource[]): CandleLightCluster[] {
    const clusters: CandleLightCluster[] = [];

    for (const source of sources) {
        let bestCluster: CandleLightCluster | null = null;
        let bestDistance = Number.POSITIVE_INFINITY;

        for (const cluster of clusters) {
            if (cluster.colorHex !== source.colorHex) continue;
            if (cluster.members.length >= CANDLE_LIGHT_CLUSTER_MAX_MEMBERS) continue;

            const cx = cluster.weightedX / cluster.totalWeight;
            const cz = cluster.weightedZ / cluster.totalWeight;
            const dx = source.x - cx;
            const dz = source.z - cz;
            const distance = Math.hypot(dx, dz);
            if (distance <= CANDLE_LIGHT_CLUSTER_RADIUS && distance < bestDistance) {
                bestCluster = cluster;
                bestDistance = distance;
            }
        }

        if (bestCluster) {
            addSourceToCluster(bestCluster, source);
        } else {
            clusters.push(createCluster(source));
        }
    }

    return clusters;
}

// =============================================================================
// MAIN SCENE CREATION
// =============================================================================

export function createScene(container: HTMLDivElement, units: Unit[]): SceneRefs {
    // Front-load texture decoding before building meshes
    ensureTexturesLoaded();

    const area = getCurrentArea();
    const computed = getComputedAreaData();

    const scene = new THREE.Scene();

    interface FogFootprintCell {
        x: number;
        z: number;
    }

    interface FogFootprintData {
        centerX: number;
        centerZ: number;
        radius: number;
        cells: FogFootprintCell[];
    }

    const buildFogFootprintCells = (
        centerX: number,
        centerZ: number,
        radius: number
    ): FogFootprintCell[] => {
        const paddedRadius = Math.max(0.25, radius);
        const radiusSq = paddedRadius * paddedRadius;
        const minX = Math.max(0, Math.floor(centerX - paddedRadius - 1));
        const maxX = Math.min(area.gridWidth - 1, Math.ceil(centerX + paddedRadius + 1));
        const minZ = Math.max(0, Math.floor(centerZ - paddedRadius - 1));
        const maxZ = Math.min(area.gridHeight - 1, Math.ceil(centerZ + paddedRadius + 1));
        const cells: FogFootprintCell[] = [];

        for (let x = minX; x <= maxX; x++) {
            for (let z = minZ; z <= maxZ; z++) {
                const cellCenterX = x + 0.5;
                const cellCenterZ = z + 0.5;
                const dx = cellCenterX - centerX;
                const dz = cellCenterZ - centerZ;
                if (dx * dx + dz * dz <= radiusSq) {
                    cells.push({ x, z });
                }
            }
        }

        if (cells.length === 0) {
            const fallbackX = THREE.MathUtils.clamp(Math.floor(centerX), 0, area.gridWidth - 1);
            const fallbackZ = THREE.MathUtils.clamp(Math.floor(centerZ), 0, area.gridHeight - 1);
            cells.push({ x: fallbackX, z: fallbackZ });
        }

        return cells;
    };

    const buildFogFootprintFromBounds = (bounds: THREE.Box3, padding: number): FogFootprintData => {
        const centerX = (bounds.min.x + bounds.max.x) / 2;
        const centerZ = (bounds.min.z + bounds.max.z) / 2;
        const halfWidthX = Math.max(0, (bounds.max.x - bounds.min.x) / 2);
        const halfWidthZ = Math.max(0, (bounds.max.z - bounds.min.z) / 2);
        const radius = Math.max(0.3, Math.hypot(halfWidthX, halfWidthZ) + padding);
        const cells = buildFogFootprintCells(centerX, centerZ, radius);
        return { centerX, centerZ, radius, cells };
    };

    // Create sky background - derived from area background color.
    const canvas = document.createElement("canvas");
    canvas.width = 2;
    canvas.height = 256;
    const ctx = canvas.getContext("2d")!;
    const gradient = ctx.createLinearGradient(0, 0, 0, 256);
    const backgroundBase = new THREE.Color(area.backgroundColor);
    const topColor = backgroundBase.clone().lerp(new THREE.Color("#000000"), area.id === "forest" ? 0.72 : 0.82);
    const midColor = backgroundBase.clone().lerp(new THREE.Color("#000000"), area.id === "forest" ? 0.52 : 0.68);
    const bottomColor = backgroundBase.clone().lerp(new THREE.Color("#000000"), area.id === "forest" ? 0.28 : 0.5);
    gradient.addColorStop(0, `#${topColor.getHexString()}`);
    gradient.addColorStop(0.5, `#${midColor.getHexString()}`);
    gradient.addColorStop(1, `#${bottomColor.getHexString()}`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 2, 256);
    const skyTexture = new THREE.CanvasTexture(canvas);
    scene.background = skyTexture;

    const aspect = container.clientWidth / container.clientHeight;
    const camera = new THREE.OrthographicCamera(-15 * aspect, 15 * aspect, 15, -15, 0.1, 1000);

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, RENDERER_MAX_PIXEL_RATIO));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const baseExposure = area.id === "forest" ? 1.12 : 1.1;
    renderer.toneMappingExposure = baseExposure;
    scene.userData.baseExposure = baseExposure;
    renderer.shadowMap.enabled = false;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = false;
    container.appendChild(renderer.domElement);

    // Skip atmospheric fog on FoW maps to avoid double-overlay artifacts.
    if (!area.hasFogOfWar) {
        const mapDiagonal = Math.hypot(area.gridWidth, area.gridHeight);
        const fogNear = Math.max(12, mapDiagonal * 0.35);
        const fogFar = Math.max(fogNear + 12, mapDiagonal * 1.1);
        const fogColor = new THREE.Color(area.backgroundColor).lerp(
            new THREE.Color("#0a1118"),
            area.id === "forest" ? 0.15 : 0.3
        );
        scene.fog = new THREE.Fog(fogColor, fogNear, fogFar);
    }

    // Lighting - softer fill/key ratio to avoid harsh top-down contrast.
    const ambientLight = new THREE.AmbientLight(0xffffff, area.ambientLight * 1.05);
    ambientLight.name = "ambientLight";
    ambientLight.userData.baseIntensity = ambientLight.intensity;
    scene.add(ambientLight);
    const hemi = new THREE.HemisphereLight("#a9ccff", "#283341", area.ambientLight * 0.22);
    hemi.name = "hemiLight";
    hemi.userData.baseIntensity = hemi.intensity;
    scene.add(hemi);
    const dir = new THREE.DirectionalLight("#f5eee2", area.directionalLight * 0.9);
    dir.name = "directionalLight";
    dir.position.set(area.gridWidth * 0.35, 24, area.gridHeight * 0.25);
    const dirTarget = new THREE.Object3D();
    dirTarget.position.set(area.gridWidth / 2, 0, area.gridHeight / 2);
    scene.add(dirTarget);
    dir.target = dirTarget;
    dir.castShadow = false;
    const shadowExtent = Math.max(area.gridWidth, area.gridHeight);
    dir.shadow.mapSize.set(DIRECTIONAL_SHADOW_MAP_SIZE, DIRECTIONAL_SHADOW_MAP_SIZE);
    dir.shadow.camera.left = -shadowExtent;
    dir.shadow.camera.right = shadowExtent;
    dir.shadow.camera.top = shadowExtent;
    dir.shadow.camera.bottom = -shadowExtent;
    dir.shadow.camera.near = 2;
    dir.shadow.camera.far = Math.max(120, shadowExtent * 3);
    dir.shadow.bias = -0.0002;
    dir.shadow.normalBias = 0.012;
    dir.shadow.radius = 2;
    dir.userData.baseIntensity = dir.intensity;
    dir.userData.baseShadowBias = dir.shadow.bias;
    dir.userData.baseShadowNormalBias = dir.shadow.normalBias;
    dir.userData.baseShadowRadius = dir.shadow.radius;
    scene.add(dir);

    // Ground - base layer for non-room areas (corridors, etc)
    const groundMat = new THREE.MeshStandardMaterial({ color: area.groundColor, metalness: 0.2, roughness: 0.9 });
    const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(area.gridWidth, area.gridHeight),
        groundMat
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(area.gridWidth / 2, -0.05, area.gridHeight / 2);
    ground.name = "ground";
    setStaticRenderTier(ground, "ground");
    scene.add(ground);

    // Floor and terrain tiles (layer-aware, with per-tile tint and natural rounding)
    let waterMesh: THREE.Object3D | null = null;
    let hasLiquidTiles = false;
    const liquidTiles = new THREE.Group();
    liquidTiles.name = "liquidTiles";
    scene.add(liquidTiles);

    // Shared geometry for all 1x1 floor/terrain tiles (hundreds of tiles, one geometry)
    const tileGeo = new THREE.PlaneGeometry(1, 1);
    const WATER_METALNESS = 0.52;
    const WATER_ROUGHNESS = 0.08;
    const WATER_TILE_OPACITY = 0.4;
    const TERRAIN_WATER_COLOR_SHALLOW = "#32718a";
    const TERRAIN_WATER_COLOR_DEEP = "#295f75";
    // Keep floor layers visually flat so they remain below prop/shadow layers.
    const FLOOR_LAYER_HEIGHT_STEP = 0.00004;
    const TERRAIN_LAYER_HEIGHT_STEP = 0.00005;
    const FLOOR_BASE_Y = 0.0006;
    const TERRAIN_BASE_Y = 0.0008;

    // Material pool: reuse materials for tiles with the same color (avoids ~1600 unique instances)
    const floorMatPool: Record<string, THREE.MeshStandardMaterial> = {};
    const waterMatPool: Record<string, THREE.MeshStandardMaterial> = {};
    const lavaMatPool: Record<string, THREE.MeshStandardMaterial> = {};
    function getFloorMat(color: string): THREE.MeshStandardMaterial {
        if (!floorMatPool[color]) {
            floorMatPool[color] = new THREE.MeshStandardMaterial({
                color,
                metalness: 0.2,
                roughness: 0.9
            });
        }
        return floorMatPool[color];
    }
    function getWaterMat(color: string): THREE.MeshStandardMaterial {
        if (!waterMatPool[color]) {
            waterMatPool[color] = new THREE.MeshStandardMaterial({
                color,
                metalness: WATER_METALNESS,
                roughness: WATER_ROUGHNESS,
                transparent: true,
                opacity: WATER_TILE_OPACITY,
                depthWrite: false,
            });
        }
        return waterMatPool[color];
    }
    function getLavaMat(color: string): THREE.MeshStandardMaterial {
        if (!lavaMatPool[color]) {
            lavaMatPool[color] = new THREE.MeshStandardMaterial({
                color,
                emissive: "#ff2200",
                emissiveIntensity: 0.8,
                metalness: 0.4,
                roughness: 0.3
            });
        }
        return lavaMatPool[color];
    }

    const floorColors: Record<string, string> = {
        "s": "#c2b280",  // Sand - tan
        "S": "#d4c490",  // Light sand
        "d": "#8b7355",  // Dirt - brown
        "D": "#6b5344",  // Dark dirt
        "g": "#668A5A",  // Grass - green
        "G": "#567A4A",  // Dark grass
        "w": "#5ba5b7",  // Water - light blue
        "W": "#4a8797",  // Deep water
        "t": "#707070",  // Stone - gray
        "T": "#606060",  // Dark stone
        ".": "#555555",  // Default - gray
    };
    const floorLayerStack = normalizeTileLayerStack(area.floorLayers ?? [area.floor], area.gridWidth, area.gridHeight, TILE_EMPTY);
    const terrainLayerStack = normalizeTileLayerStack(area.terrainLayers ?? [area.terrain], area.gridWidth, area.gridHeight, TILE_EMPTY);
    const floorTintLayerStack = normalizeTintLayerStack(area.floorTintLayers, floorLayerStack.length, area.gridWidth, area.gridHeight);
    const terrainTintLayerStack = normalizeTintLayerStack(area.terrainTintLayers, terrainLayerStack.length, area.gridWidth, area.gridHeight);

    for (let layerIndex = 0; layerIndex < floorLayerStack.length; layerIndex++) {
        const layer = floorLayerStack[layerIndex];
        const tintLayer = floorTintLayerStack[layerIndex];
        for (let z = 0; z < layer.length; z++) {
            for (let x = 0; x < layer[z].length; x++) {
                const char = layer[z][x];
                if (char === " " || char === TILE_EMPTY || char === undefined) continue;

                const baseColor = floorColors[char] ?? "#555555";
                const tintedColor = applyTileTintColor(baseColor, tintLayer[z]?.[x] ?? 0);
                const color = getFloorVariantColor(tintedColor, x, z, char);
                const tileType = getFloorType(char);
                const rounding = tileType ? getNaturalTileCornerRounding(layer, x, z, tileType) : { outer: [0, 0, 0, 0] as [number, number, number, number], inner: [0, 0, 0, 0] as [number, number, number, number] };
                const hasRounding = rounding.outer.some(value => value > 0) || rounding.inner.some(value => value > 0);
                const isWater = char === "w" || char === "W";

                let tileMaterial: THREE.MeshStandardMaterial;
                if (hasRounding) {
                    const innerCorners = [0, 0, 0, 0] as [number, number, number, number];
                    tileMaterial = createRoundedFloorMaterial(
                        color,
                        rounding.outer,
                        innerCorners,
                        isWater ? 0.21 : 0.24,
                        isWater ? WATER_METALNESS : 0.2,
                        isWater ? WATER_ROUGHNESS : 0.9
                    );
                } else if (isWater) {
                    tileMaterial = getWaterMat(color);
                } else {
                    tileMaterial = getFloorMat(color);
                }

                if (isWater && hasRounding) {
                    tileMaterial.transparent = true;
                    tileMaterial.opacity = WATER_TILE_OPACITY;
                    tileMaterial.depthWrite = false;
                }

                const tile = new THREE.Mesh(tileGeo, tileMaterial);
                tile.rotation.x = -Math.PI / 2;
                tile.position.set(x + 0.5, FLOOR_BASE_Y + layerIndex * FLOOR_LAYER_HEIGHT_STEP, z + 0.5);
                tile.name = "ground";
                setStaticRenderTier(tile, "floor");
                scene.add(tile);
            }
        }
    }

    for (let layerIndex = 0; layerIndex < terrainLayerStack.length; layerIndex++) {
        const layer = terrainLayerStack[layerIndex];
        const tintLayer = terrainTintLayerStack[layerIndex];
        for (let z = 0; z < layer.length; z++) {
            for (let x = 0; x < (layer[z]?.length ?? 0); x++) {
                const char = layer[z][x];
                if (char === TILE_EMPTY || char === " " || char === undefined) continue;

                if (char === "~") {
                    const lavaColor = applyTileTintColor("#ff4400", tintLayer[z]?.[x] ?? 0);
                    const rounding = getNaturalTileCornerRounding(layer, x, z, "~");
                    const hasRounding = rounding.outer.some(value => value > 0) || rounding.inner.some(value => value > 0);
                    const lavaMat = hasRounding
                        ? createRoundedFloorMaterial(
                            lavaColor,
                            rounding.outer,
                            [0, 0, 0, 0],
                            0.21,
                            0.4,
                            0.3
                        )
                        : getLavaMat(lavaColor);
                    // Keep rounded and non-rounded lava visually consistent.
                    lavaMat.emissive.set("#ff2200");
                    lavaMat.emissiveIntensity = 0.8;
                    const lavaTile = new THREE.Mesh(tileGeo, lavaMat);
                    lavaTile.rotation.x = -Math.PI / 2;
                    lavaTile.position.set(x + 0.5, TERRAIN_BASE_Y + layerIndex * TERRAIN_LAYER_HEIGHT_STEP, z + 0.5);
                    lavaTile.name = "lava";
                    setStaticRenderTier(lavaTile, "floor");
                    lavaTile.userData.liquid = {
                        liquidType: "lava",
                        wavePhase: hashNoise(x, z, hashAreaIdToUnitRange(area.id) * 1000) * Math.PI * 2,
                        waveSpeed: 1.7,
                        baseColor: lavaMat.color.clone(),
                        hotColor: new THREE.Color("#ff8a00"),
                        baseEmissiveIntensity: lavaMat.emissiveIntensity
                    };
                    liquidTiles.add(lavaTile);
                    hasLiquidTiles = true;
                    continue;
                }

                if (char === "w" || char === "W") {
                    const baseWaterColor = char === "W"
                        ? TERRAIN_WATER_COLOR_DEEP
                        : TERRAIN_WATER_COLOR_SHALLOW;
                    const terrainWaterColor = applyTileTintColor(baseWaterColor, tintLayer[z]?.[x] ?? 0);
                    const rounding = getNaturalTileCornerRounding(layer, x, z, "w");
                    const hasRounding = rounding.outer.some(value => value > 0) || rounding.inner.some(value => value > 0);
                    const waterMat = hasRounding
                        ? createRoundedFloorMaterial(
                            terrainWaterColor,
                            rounding.outer,
                            [0, 0, 0, 0],
                            0.21,
                            WATER_METALNESS,
                            WATER_ROUGHNESS
                        )
                        : getWaterMat(terrainWaterColor);

                    // Keep rounded terrain-water tiles visually consistent with pooled water tiles.
                    if (hasRounding) {
                        waterMat.transparent = true;
                        waterMat.opacity = WATER_TILE_OPACITY;
                        waterMat.depthWrite = false;
                    }

                    const tile = new THREE.Mesh(tileGeo, waterMat);
                    tile.rotation.x = -Math.PI / 2;
                    tile.position.set(x + 0.5, TERRAIN_BASE_Y + layerIndex * TERRAIN_LAYER_HEIGHT_STEP, z + 0.5);
                    tile.name = "ground";
                    setStaticRenderTier(tile, "floor");
                    scene.add(tile);
                    hasLiquidTiles = true;
                }
            }
        }
    }

    if (hasLiquidTiles) {
        waterMesh = liquidTiles;
    } else {
        scene.remove(liquidTiles);
    }

    // Candle/torch meshes + clustered lights for performance.
    const flames: THREE.Mesh[] = [];
    const candleMeshes: THREE.Mesh[] = [];  // Track candle and torch bodies for occlusion fading
    const candleLights: THREE.Light[] = [];
    const candleLightSources: CandleLightSource[] = [];

    const baseCandleMat = { color: "#e8d4a8", metalness: 0.1, roughness: 0.9, transparent: true, opacity: 1 };
    const baseTorchMat = { color: "#b2874a", metalness: 0.22, roughness: 0.72, transparent: true, opacity: 1 };
    const baseFlameMat = new THREE.MeshBasicMaterial({ color: "#ffcc44", transparent: true, opacity: 0.85 });
    const candleGeo = new THREE.CylinderGeometry(0.06, 0.08, 0.3, 6);
    const torchGeo = new THREE.CylinderGeometry(0.09, 0.12, 0.48, 7);
    const candleFlameGeo = new THREE.SphereGeometry(0.08, 5, 5);
    const torchFlameGeo = new THREE.SphereGeometry(0.13, 6, 6);

    for (let index = 0; index < computed.candlePositions.length; index++) {
        const pos = computed.candlePositions[index];
        const kind = pos.kind === "torch" ? "torch" : "candle";
        const defaultColor = kind === "torch" ? DEFAULT_TORCH_LIGHT_COLOR : DEFAULT_CANDLE_LIGHT_COLOR;
        const lightColorHex = normalizeHexColor(pos.lightColor, defaultColor);
        const offset = kind === "torch" ? 0.35 : 0.3;
        const x = pos.x + pos.dx * offset;
        const z = pos.z + pos.dz * offset;
        const bodyY = kind === "torch" ? 1.95 : 1.85;
        const flameY = kind === "torch" ? 2.24 : 2.05;

        const bodyMat = new THREE.MeshStandardMaterial(kind === "torch" ? baseTorchMat : baseCandleMat);
        const body = new THREE.Mesh(kind === "torch" ? torchGeo : candleGeo, bodyMat);
        body.position.set(x, bodyY, z);
        scene.add(body);
        candleMeshes.push(body);

        const flameMat = baseFlameMat.clone();
        const flameColor = new THREE.Color(lightColorHex).lerp(new THREE.Color("#ffdd88"), 0.22);
        flameMat.color.copy(flameColor);
        const flame = new THREE.Mesh(kind === "torch" ? torchFlameGeo : candleFlameGeo, flameMat);
        flame.position.set(x, flameY, z);
        flame.scale.y = kind === "torch" ? 2.2 : 1.8;
        scene.add(flame);
        flames.push(flame);

        candleLightSources.push({
            x,
            y: flameY + 0.38,
            z,
            kind,
            colorHex: lightColorHex,
            intensity: kind === "torch" ? 16 : 10,
            range: kind === "torch" ? 10 : 7,
        });
    }

    const lightClusters = buildCandleLightClusters(candleLightSources);
    const selectedLightClusters = [...lightClusters]
        .sort((a, b) => b.totalIntensity - a.totalIntensity)
        .slice(0, MAX_FLAME_CLUSTER_LIGHTS);

    for (const cluster of selectedLightClusters) {
        const firstMember = cluster.members[0];
        if (!firstMember) continue;
        const isSingle = cluster.members.length === 1;
        const centerX = cluster.weightedX / cluster.totalWeight;
        const centerY = cluster.weightedY / cluster.totalWeight;
        const centerZ = cluster.weightedZ / cluster.totalWeight;

        let maxDistanceFromCenter = 0;
        for (const member of cluster.members) {
            const dx = member.x - centerX;
            const dz = member.z - centerZ;
            maxDistanceFromCenter = Math.max(maxDistanceFromCenter, Math.hypot(dx, dz));
        }

        const baseIntensity = isSingle
            ? firstMember.intensity
            : Math.min(30, cluster.totalIntensity * 0.72);
        const radiusBoost = Math.log2(cluster.members.length + 1) * 0.8 + maxDistanceFromCenter * 1.6;
        const lightRange = isSingle
            ? firstMember.range
            : Math.min(18, cluster.maxRange + radiusBoost);

        const light = new THREE.PointLight(cluster.colorHex, baseIntensity, lightRange, 1.45);
        light.position.set(centerX, centerY, centerZ);
        light.userData.baseIntensity = baseIntensity;
        light.userData.flickerStrength = 0.12;
        light.userData.lightRole = "flame";
        scene.add(light);
        candleLights.push(light);
    }

    // Editor-authored high lights.
    if (area.lights) {
        const selectedAreaLights = area.lights
            .map(rawLight => ({
                x: rawLight.x,
                z: rawLight.z,
                tint: normalizeHexColor(rawLight.tint, DEFAULT_AREA_LIGHT_TINT),
                radius: clampFinite(rawLight.radius, 1, 60, DEFAULT_AREA_LIGHT_RADIUS),
                angleRad: THREE.MathUtils.degToRad(clampFinite(rawLight.angle, 5, 90, DEFAULT_AREA_LIGHT_ANGLE)),
                brightness: clampFinite(rawLight.brightness, 0, 50, DEFAULT_AREA_LIGHT_BRIGHTNESS),
                height: clampFinite(rawLight.height, 1, 30, DEFAULT_AREA_LIGHT_HEIGHT),
                diffusion: clampFinite(rawLight.diffusion, 0, 1, DEFAULT_AREA_LIGHT_DIFFUSION),
                decay: clampFinite(rawLight.decay, 0, 3, DEFAULT_AREA_LIGHT_DECAY),
            }))
            .sort((a, b) => b.brightness - a.brightness)
            .slice(0, MAX_AREA_LIGHTS);

        for (const areaLight of selectedAreaLights) {
            const spot = new THREE.SpotLight(
                areaLight.tint,
                areaLight.brightness,
                areaLight.radius,
                areaLight.angleRad,
                areaLight.diffusion,
                areaLight.decay
            );
            spot.position.set(areaLight.x, areaLight.height, areaLight.z);
            spot.target.position.set(areaLight.x, 0, areaLight.z);
            spot.castShadow = false;
            spot.userData.baseIntensity = areaLight.brightness;
            spot.userData.flickerStrength = 0;
            spot.userData.lightRole = "area";
            scene.add(spot);
            scene.add(spot.target);
            candleLights.push(spot);
        }
    }

    // Treasure chests from area data
    // Shared geometries for all chests
    const chestBodyGeo = new THREE.BoxGeometry(0.9, 0.5, 0.6);
    const chestLidGeo = new THREE.BoxGeometry(0.95, 0.25, 0.65);
    const chestBuckleGeo = new THREE.BoxGeometry(0.2, 0.2, 0.08);

    const chestMeshes: ChestMeshData[] = [];
    area.chests.forEach((chest, index) => {
        const chestGroup = new THREE.Group();
        // Chest body (main box) - dark wood
        const chestBody = new THREE.Mesh(
            chestBodyGeo,
            new THREE.MeshStandardMaterial({ color: "#5c3a21", metalness: 0.2, roughness: 0.8 })
        );
        chestBody.position.y = 0.25;
        chestGroup.add(chestBody);

        // Lid pivot - positioned at back edge of chest body top for hinge rotation
        const lidPivot = new THREE.Group();
        lidPivot.position.set(0, 0.5, -0.3);  // Back edge, top of body
        chestGroup.add(lidPivot);

        // Chest lid - offset from pivot so it rotates from back edge
        const chestLid = new THREE.Mesh(
            chestLidGeo,
            new THREE.MeshStandardMaterial({ color: "#6b4423", metalness: 0.2, roughness: 0.7 })
        );
        chestLid.position.set(0, 0.125, 0.325);  // Offset from pivot point
        lidPivot.add(chestLid);

        // Gold buckle/clasp on front - highly metallic brass/gold
        const buckle = new THREE.Mesh(
            chestBuckleGeo,
            new THREE.MeshStandardMaterial({ color: "#d4af37", emissive: "#8b7500", emissiveIntensity: 0.6, metalness: 1.0, roughness: 0.05 })
        );
        buckle.position.set(0, 0.4, 0.32);
        chestGroup.add(buckle);

        // Mark all chest parts as "chest" for raycasting with chest data
        const chestData = { chestIndex: index, chestX: chest.x, chestZ: chest.z };
        chestBody.name = "chest";
        chestBody.userData = chestData;
        chestLid.name = "chest";
        chestLid.userData = chestData;
        buckle.name = "chest";
        buckle.userData = chestData;
        chestGroup.position.set(chest.x, 0, chest.z);
        scene.add(chestGroup);

        // Store for open/close updates
        const chestKey = `${area.id}-${index}`;
        chestMeshes.push({ lidPivot, buckle, chestKey });
    });

    // Trees - cylinders for trunk + cone for pyramidal foliage
    // Various green shades and brown trunks for variety
    const foliageColors = ["#3C8B3C", "#458B64", "#5AB382", "#196419", "#59CD59", "#5B6B3E"];
    const trunkColors = ["#654321", "#8B4513", "#A0522D", "#5C4033", "#6F4E37"];
    const treeMeshes: THREE.Mesh[] = [];
    const fogOccluderMeshes: THREE.Mesh[] = [];

    // Fog mesh Y position - trees in unexplored cells will be capped below this
    const FOG_Y = 2.6;

    // Tree size multiplier - forest trees are larger
    const treeSizeMultiplier = area.id === "forest" ? 1.5 : 1.0;

    // Palm-specific colors
    const palmFoliageColors = ["#458B64", "#5AB382", "#3C8B3C", "#65AF68"];

    const registerFoliageMesh = (
        foliageMesh: THREE.Mesh,
        treeX: number,
        treeZ: number,
        fullY: number,
        fullHeight: number,
        fullRadius: number,
        trunkHeight: number,
        treePartMeshes: THREE.Mesh[]
    ): void => {
        foliageMesh.name = "tree";
        foliageMesh.userData.fullY = fullY;
        foliageMesh.userData.fullHeight = fullHeight;
        foliageMesh.userData.fullRadius = fullRadius;
        foliageMesh.userData.treeX = treeX;
        foliageMesh.userData.treeZ = treeZ;
        foliageMesh.userData.isFoliage = true;
        foliageMesh.userData.trunkHeight = trunkHeight;
        foliageMesh.userData.fogY = FOG_Y;
        scene.add(foliageMesh);
        treeMeshes.push(foliageMesh);
        treePartMeshes.push(foliageMesh);
    };

    const registerFogOccluderMesh = (
        mesh: THREE.Mesh,
        tileX: number,
        tileZ: number,
        baseY: number,
        fullHeight: number
    ): void => {
        if (fullHeight <= 0) return;
        const bounds = new THREE.Box3().setFromObject(mesh);
        const footprint = buildFogFootprintFromBounds(bounds, 0.18);

        mesh.userData.fogClipX = footprint.centerX;
        mesh.userData.fogClipZ = footprint.centerZ;
        mesh.userData.fogClipBaseY = baseY;
        mesh.userData.fogClipFullHeight = fullHeight;
        mesh.userData.fogClipFullY = mesh.position.y;
        mesh.userData.fogClipFullScaleY = mesh.scale.y;
        mesh.userData.fogClipFallbackX = tileX;
        mesh.userData.fogClipFallbackZ = tileZ;
        mesh.userData.fogFootprintCenterX = footprint.centerX;
        mesh.userData.fogFootprintCenterZ = footprint.centerZ;
        mesh.userData.fogFootprintRadius = footprint.radius;
        mesh.userData.fogFootprintCells = footprint.cells;
        fogOccluderMeshes.push(mesh);
    };

    area.trees.forEach((tree, i) => {
        const treePartMeshes: THREE.Mesh[] = [];
        const treeType = tree.type ?? "pine";
        const clampedSize = Math.max(MIN_TREE_SIZE, Math.min(MAX_TREE_SIZE, tree.size));
        const effectiveSize = treeType === "pine"
            ? Math.min(clampedSize, MAX_PINE_TREE_SIZE)
            : clampedSize;
        const scale = effectiveSize * treeSizeMultiplier;

        // Taller trees are skinnier - use inverse relationship with randomness
        // skinnyFactor ranges from ~0.6 (for large trees) to ~1.0 (for small trees)
        const randomVariance = 0.85 + Math.random() * 0.3;  // 0.85-1.15 random multiplier
        const skinnyFactor = Math.min(1.0, (1.0 / Math.sqrt(scale)) * randomVariance);

        let trunkHeight: number;
        let trunkRadius: number;
        let trunkBottomRadius: number;
        let foliageRadius: number;
        let foliageHeight: number;
        let trunkPosX = tree.x;
        let trunkPosY: number;
        let trunkPosZ = tree.z;
        let trunkRotX = 0;
        let trunkRotZ = 0;
        let palmTopX = tree.x;
        let palmTopY: number;
        let palmTopZ = tree.z;

        if (treeType === "palm") {
            // Palm: taller trunk with wider per-tree variation.
            const palmHeightScale = 0.82 + Math.random() * 1.05;
            const normalizedPalmHeight = THREE.MathUtils.clamp((palmHeightScale - 0.82) / 1.05, 0, 1);
            const canopyBaseScale = 0.9 + normalizedPalmHeight * 0.45;
            trunkHeight = 2.45 * scale * palmHeightScale;
            trunkRadius = 0.08 * scale;
            trunkBottomRadius = trunkRadius * 1.5;
            // Taller palms get broader base foliage.
            foliageRadius = 0.58 * scale * canopyBaseScale;
            foliageHeight = 2 * foliageRadius;  // Sphere diameter for fog-of-war

            // Lean each palm in a unique direction and compute top anchor point.
            const leanDirection = Math.random() * Math.PI * 2;
            const leanAngle = THREE.MathUtils.degToRad(4 + Math.random() * 8);
            trunkRotX = Math.cos(leanDirection) * leanAngle;
            trunkRotZ = Math.sin(leanDirection) * leanAngle;

            const leanQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(trunkRotX, 0, trunkRotZ));
            const trunkCenterOffset = new THREE.Vector3(0, trunkHeight / 2, 0).applyQuaternion(leanQuat);
            const trunkTopOffset = new THREE.Vector3(0, trunkHeight, 0).applyQuaternion(leanQuat);

            trunkPosX = tree.x + trunkCenterOffset.x;
            trunkPosY = trunkCenterOffset.y;
            trunkPosZ = tree.z + trunkCenterOffset.z;

            palmTopX = tree.x + trunkTopOffset.x;
            palmTopY = trunkTopOffset.y;
            palmTopZ = tree.z + trunkTopOffset.z;
        } else if (treeType === "oak") {
            // Oak: shorter thick trunk, wide round bushy foliage
            trunkHeight = 0.8 * scale;
            trunkRadius = 0.2 * scale * skinnyFactor;
            trunkBottomRadius = trunkRadius * 1.4;
            foliageRadius = 1.0 * scale * skinnyFactor;
            foliageHeight = 2 * foliageRadius;  // Sphere diameter for fog-of-war
            trunkPosY = trunkHeight / 2;
            palmTopY = trunkHeight;
        } else {
            // Pine (default): tall pyramidal cone
            trunkHeight = 1.2 * scale;
            trunkRadius = 0.15 * scale * skinnyFactor;
            trunkBottomRadius = trunkRadius * 1.3;
            foliageRadius = 0.8 * scale * skinnyFactor;
            foliageHeight = 2.5 * scale;
            trunkPosY = trunkHeight / 2;
            palmTopY = trunkHeight;
        }

        const trunkColor = trunkColors[i % trunkColors.length];
        const trunk = new THREE.Mesh(
            new THREE.CylinderGeometry(trunkRadius, trunkBottomRadius, trunkHeight, 8),
            new THREE.MeshStandardMaterial({ color: trunkColor, metalness: 0.0, roughness: 1.0, transparent: true, opacity: 1 })
        );
        trunk.position.set(trunkPosX, trunkPosY, trunkPosZ);
        if (treeType === "palm") {
            trunk.rotation.set(trunkRotX, 0, trunkRotZ);
        }
        trunk.name = "tree";
        trunk.userData.fullHeight = trunkHeight;
        trunk.userData.treeX = tree.x;
        trunk.userData.treeZ = tree.z;
        trunk.userData.isTrunk = true;
        scene.add(trunk);
        treeMeshes.push(trunk);
        treePartMeshes.push(trunk);

        // Foliage geometry depends on tree type
        const foliageColor = treeType === "palm"
            ? palmFoliageColors[i % palmFoliageColors.length]
            : foliageColors[i % foliageColors.length];
        if (treeType === "palm") {
            // Palm foliage as a sideways spiked star canopy.
            const canopyScale = 0.95 + Math.random() * 0.55;
            const starSpikes = 10 + Math.floor(Math.random() * 11);  // 10-20 points
            const starInnerRatio = 0.1 + Math.random() * 0.22;     // deeper spike insets into canopy core
            const palmFoliageHeight = foliageHeight * (1.03 + Math.random() * 0.22);
            const fullFoliageY = palmTopY + palmFoliageHeight * 0.18;
            const starOuterRadius = foliageRadius * 1.22 * canopyScale;
            const starInnerRadius = starOuterRadius * starInnerRatio;
            const starThickness = Math.max(0.06, foliageRadius * (0.14 + Math.random() * 0.09) * canopyScale);

            const palmMat = new THREE.MeshStandardMaterial({
                color: foliageColor,
                metalness: 0.0,
                roughness: 0.78,
                transparent: true,
                opacity: 1,
                emissive: "#103224",
                emissiveIntensity: 0.08
            });

            const starShape = new THREE.Shape();
            for (let p = 0; p <= starSpikes * 2; p++) {
                const angle = (p / (starSpikes * 2)) * Math.PI * 2 - Math.PI / 2;
                const radius = p % 2 === 0 ? starOuterRadius : starInnerRadius;
                const sx = Math.cos(angle) * radius;
                const sy = Math.sin(angle) * radius;
                if (p === 0) {
                    starShape.moveTo(sx, sy);
                } else {
                    starShape.lineTo(sx, sy);
                }
            }

            const starGeometry = new THREE.ExtrudeGeometry(starShape, {
                depth: starThickness,
                bevelEnabled: false
            });
            starGeometry.center();
            starGeometry.rotateX(-Math.PI / 2);

            const starFoliage = new THREE.Mesh(starGeometry, palmMat);
            const canopyTiltDir = Math.random() * Math.PI * 2;
            const canopyTilt = THREE.MathUtils.degToRad(6 + Math.random() * 8);
            const canopyTiltX = trunkRotX * 0.5 + Math.cos(canopyTiltDir) * canopyTilt;
            const canopyTiltZ = trunkRotZ * 0.5 + Math.sin(canopyTiltDir) * canopyTilt;
            starFoliage.position.set(palmTopX, fullFoliageY, palmTopZ);
            starFoliage.rotation.set(canopyTiltX, Math.random() * Math.PI * 2, canopyTiltZ);
            registerFoliageMesh(starFoliage, tree.x, tree.z, fullFoliageY, palmFoliageHeight, starOuterRadius, trunkHeight, treePartMeshes);

            const crownCore = new THREE.Mesh(
                new THREE.SphereGeometry(Math.max(0.07, foliageRadius * 0.14 * canopyScale), 7, 6),
                palmMat
            );
            crownCore.position.set(palmTopX, fullFoliageY + starThickness * 0.4, palmTopZ);
            registerFoliageMesh(crownCore, tree.x, tree.z, fullFoliageY, palmFoliageHeight, starOuterRadius, trunkHeight, treePartMeshes);
        } else {
            const foliageGeometry = treeType === "oak"
                ? new THREE.SphereGeometry(foliageRadius, 8, 6)
                : new THREE.ConeGeometry(foliageRadius, foliageHeight, 8);
            const foliage = new THREE.Mesh(
                foliageGeometry,
                new THREE.MeshStandardMaterial({ color: foliageColor, metalness: 0.0, roughness: 0.8, transparent: true, opacity: 1 })
            );
            const fullFoliageY = treeType === "oak"
                ? trunkHeight + foliageRadius * 0.7 // Sphere engulfs top of trunk
                : trunkHeight + foliageHeight / 2;  // Cone base at trunk top
            foliage.position.set(tree.x, fullFoliageY, tree.z);
            registerFoliageMesh(foliage, tree.x, tree.z, fullFoliageY, foliageHeight, foliageRadius, trunkHeight, treePartMeshes);
        }

        if (treePartMeshes.length > 0) {
            const treeBounds = new THREE.Box3().setFromObject(treePartMeshes[0]);
            for (let p = 1; p < treePartMeshes.length; p++) {
                const partBounds = new THREE.Box3().setFromObject(treePartMeshes[p]);
                treeBounds.union(partBounds);
            }

            const treeFootprint = buildFogFootprintFromBounds(treeBounds, 0.16);
            const treeObjectId = `tree-${i}`;
            for (const part of treePartMeshes) {
                part.userData.fogObjectId = treeObjectId;
                part.userData.fogFootprintCenterX = treeFootprint.centerX;
                part.userData.fogFootprintCenterZ = treeFootprint.centerZ;
                part.userData.fogFootprintRadius = treeFootprint.radius;
                part.userData.fogFootprintCells = treeFootprint.cells;
            }
        }

        // Tree shadow
        const shadowRadius = treeType === "pine"
            ? foliageRadius * 0.9
            : treeType === "palm"
                ? foliageRadius * 1.25
                : foliageRadius * 0.99;
        const treeShadow = new THREE.Mesh(
            new THREE.CircleGeometry(shadowRadius, 16),
            new THREE.MeshBasicMaterial({ color: "#000000", transparent: true, opacity: 0.25, side: THREE.DoubleSide })
        );
        treeShadow.rotation.x = -Math.PI / 2;
        treeShadow.position.set(tree.x, 0.005, tree.z);
        scene.add(treeShadow);
    });

    // Decorations - columns, broken walls, etc.
    const columnMeshes: THREE.Mesh[] = [];
    const columnGroups: THREE.Mesh[][] = [];  // Groups of column parts that fade together

    const addWeedsCluster = (
        centerX: number,
        centerZ: number,
        size: number,
        variant: "large" | "small"
    ): void => {
        const isLarge = variant === "large";
        const frondCount = isLarge ? 4 + Math.floor(Math.random() * 3) : 2 + Math.floor(Math.random() * 2);
        const palette = isLarge
            ? ["#6f9639", "#83ab47", "#98bf57", "#b0d16b"]
            : ["#7fa544", "#91b854", "#a8cb66"];
        const spreadMin = (isLarge ? 0.24 : 0.14) * size;
        const spreadMax = (isLarge ? 0.52 : 0.3) * size;
        const anchorCount = 2;
        const anchorRadius = (isLarge ? 0.22 : 0.14) * size;
        const anchors = Array(anchorCount).fill(null).map(() => {
            const a = Math.random() * Math.PI * 2;
            const r = Math.random() * anchorRadius;
            return { x: Math.cos(a) * r, z: Math.sin(a) * r };
        });

        for (let j = 0; j < frondCount; j++) {
            const angle = (j / frondCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.45;
            const lobeRadius = (isLarge ? 0.085 : 0.058) * size * (0.85 + Math.random() * 0.4);
            const baseOffset = spreadMin + Math.random() * (spreadMax - spreadMin);
            const lean = THREE.MathUtils.degToRad((isLarge ? 46 : 40) + Math.random() * 16);
            const anchor = anchors[j % anchors.length];
            const lobeScaleX = 1.25 + Math.random() * 0.55;
            const lobeScaleY = 1.75 + Math.random() * 0.65;
            const lobeScaleZ = 0.95 + Math.random() * 0.45;
            const lobeLift = lobeRadius * lobeScaleY * 0.42;
            const frondColor = palette[Math.floor(Math.random() * palette.length)];
            const useStalk = Math.random() < (isLarge ? 0.38 : 0.32);

            if (useStalk) {
                const stalkRadius = lobeRadius * (0.46 + Math.random() * 0.18);
                const stalkHeight = lobeRadius * (2.9 + Math.random() * 1.3);
                const stalk = new THREE.Mesh(
                    new THREE.CylinderGeometry(stalkRadius * 0.82, stalkRadius, stalkHeight, 9),
                    new THREE.MeshStandardMaterial({
                        color: frondColor,
                        metalness: 0.0,
                        roughness: 0.77,
                        transparent: true,
                        opacity: 0.98,
                        emissive: "#28340f",
                        emissiveIntensity: 0.06
                    })
                );
                stalk.position.set(
                    centerX + anchor.x + Math.cos(angle) * baseOffset,
                    stalkHeight * 0.5,
                    centerZ + anchor.z + Math.sin(angle) * baseOffset
                );
                stalk.rotation.y = angle + (Math.random() - 0.5) * 0.3;
                stalk.rotation.x = -lean;
                stalk.rotation.z = (Math.random() - 0.5) * 0.35;
                if (j === 0) stalk.name = "decoration";
                scene.add(stalk);

                const tipBulb = new THREE.Mesh(
                    new THREE.SphereGeometry(stalkRadius * 0.85, 8, 6),
                    new THREE.MeshStandardMaterial({
                        color: frondColor,
                        metalness: 0.0,
                        roughness: 0.76,
                        emissive: "#28340f",
                        emissiveIntensity: 0.05
                    })
                );
                tipBulb.position.set(0, stalkHeight * 0.5, 0);
                stalk.add(tipBulb);
            } else {
                const blade = new THREE.Mesh(
                    new THREE.SphereGeometry(lobeRadius, 10, 8),
                    new THREE.MeshStandardMaterial({
                        color: frondColor,
                        metalness: 0.0,
                        roughness: 0.76,
                        transparent: true,
                        opacity: 0.98,
                        emissive: "#28340f",
                        emissiveIntensity: 0.06
                    })
                );
                blade.position.set(
                    centerX + anchor.x + Math.cos(angle) * baseOffset,
                    lobeLift,
                    centerZ + anchor.z + Math.sin(angle) * baseOffset
                );
                blade.rotation.y = angle + (Math.random() - 0.5) * 0.35;
                blade.rotation.x = -lean;
                blade.rotation.z = (Math.random() - 0.5) * 0.45;
                blade.scale.set(lobeScaleX, lobeScaleY, lobeScaleZ);
                if (j === 0) blade.name = "decoration";
                scene.add(blade);

                // Optional top nub keeps silhouette playful/chunky.
                if (Math.random() < 0.45) {
                    const nub = new THREE.Mesh(
                        new THREE.SphereGeometry(lobeRadius * 0.45, 8, 6),
                        new THREE.MeshStandardMaterial({
                            color: frondColor,
                            metalness: 0.0,
                            roughness: 0.78,
                            emissive: "#28340f",
                            emissiveIntensity: 0.04
                        })
                    );
                    nub.position.set(
                        blade.position.x + Math.cos(angle) * lobeRadius * 0.2,
                        blade.position.y + lobeRadius * lobeScaleY * 0.6,
                        blade.position.z + Math.sin(angle) * lobeRadius * 0.2
                    );
                    scene.add(nub);
                }
            }
        }

        const rootCount = isLarge ? 2 : 1;
        for (let r = 0; r < rootCount; r++) {
            const rootRadius = (isLarge ? 0.05 : 0.035) * size * (0.8 + Math.random() * 0.5);
            const rootAngle = Math.random() * Math.PI * 2;
            const rootDist = Math.random() * (isLarge ? 0.08 : 0.05) * size;
            const root = new THREE.Mesh(
                new THREE.SphereGeometry(rootRadius, 9, 8),
                new THREE.MeshStandardMaterial({
                    color: isLarge ? "#8daf60" : "#95b769",
                    metalness: 0.0,
                    roughness: 0.88
                })
            );
            root.position.set(
                centerX + Math.cos(rootAngle) * rootDist,
                rootRadius * 0.65,
                centerZ + Math.sin(rootAngle) * rootDist
            );
            if (r === 0) root.name = "decoration";
            scene.add(root);
        }
    };

    if (area.decorations) {
        area.decorations.forEach(dec => {
            const size = dec.size ?? 1;

            if (dec.type === "column") {
                // Full standing column - track for transparency
                const columnRadius = 0.3 * size;
                const columnHeight = 2.5 * size;
                const column = new THREE.Mesh(
                    new THREE.CylinderGeometry(columnRadius, columnRadius * 1.1, columnHeight, 12),
                    new THREE.MeshStandardMaterial({ color: "#a6a08f", metalness: 0.1, roughness: 0.9, transparent: true })
                );
                column.position.set(dec.x, columnHeight / 2, dec.z);
                column.name = "decoration";
                scene.add(column);
                columnMeshes.push(column);
                registerFogOccluderMesh(column, dec.x, dec.z, 0, columnHeight);

                // Column base
                const base = new THREE.Mesh(
                    new THREE.CylinderGeometry(columnRadius * 1.4, columnRadius * 1.5, 0.2, 12),
                    new THREE.MeshStandardMaterial({ color: "#979080", metalness: 0.1, roughness: 0.9, transparent: true })
                );
                base.position.set(dec.x, 0.1, dec.z);
                scene.add(base);
                columnMeshes.push(base);
                registerFogOccluderMesh(base, dec.x, dec.z, 0, 0.2);

                // Column capital (top)
                const capital = new THREE.Mesh(
                    new THREE.CylinderGeometry(columnRadius * 1.3, columnRadius, 0.25, 12),
                    new THREE.MeshStandardMaterial({ color: "#b6ae9d", metalness: 0.1, roughness: 0.9, transparent: true })
                );
                capital.position.set(dec.x, columnHeight, dec.z);
                scene.add(capital);
                columnMeshes.push(capital);
                registerFogOccluderMesh(capital, dec.x, dec.z, columnHeight - 0.125, 0.25);

                // Group all parts of this column together for synchronized transparency
                columnGroups.push([column, base, capital]);
            } else if (dec.type === "broken_column") {
                // Broken/fallen column - shorter with debris
                const columnRadius = 0.3 * size;
                const columnHeight = (0.8 + Math.random() * 0.8) * size;  // Random broken height
                const column = new THREE.Mesh(
                    new THREE.CylinderGeometry(columnRadius * 0.9, columnRadius * 1.1, columnHeight, 12),
                    new THREE.MeshStandardMaterial({ color: "#958f80", metalness: 0.1, roughness: 0.95, transparent: true, opacity: 1 })
                );
                column.position.set(dec.x, columnHeight / 2, dec.z);
                column.name = "decoration";
                scene.add(column);
                columnMeshes.push(column);
                registerFogOccluderMesh(column, dec.x, dec.z, 0, columnHeight);

                // Column base (crumbled)
                const base = new THREE.Mesh(
                    new THREE.CylinderGeometry(columnRadius * 1.3, columnRadius * 1.5, 0.15, 8),
                    new THREE.MeshStandardMaterial({ color: "#878072", metalness: 0.1, roughness: 0.95, transparent: true, opacity: 1 })
                );
                base.position.set(dec.x, 0.075, dec.z);
                scene.add(base);
                columnMeshes.push(base);
                registerFogOccluderMesh(base, dec.x, dec.z, 0, 0.15);

                // Fallen debris pieces
                for (let j = 0; j < 3; j++) {
                    const debris = new THREE.Mesh(
                        new THREE.BoxGeometry(0.2 + Math.random() * 0.2, 0.15, 0.2 + Math.random() * 0.2),
                        new THREE.MeshStandardMaterial({ color: "#878072", metalness: 0.1, roughness: 0.95 })
                    );
                    const angle = Math.random() * Math.PI * 2;
                    const dist = 0.4 + Math.random() * 0.4;
                    debris.position.set(dec.x + Math.cos(angle) * dist, 0.075, dec.z + Math.sin(angle) * dist);
                    debris.rotation.y = Math.random() * Math.PI;
                    scene.add(debris);
                }
            } else if (dec.type === "broken_wall") {
                // Broken wall segment
                const wallLength = (1.5 + Math.random() * 1) * size;
                const wallHeight = (0.8 + Math.random() * 1.2) * size;
                const wallThick = 0.4 * size;

                const wall = new THREE.Mesh(
                    new THREE.BoxGeometry(wallLength, wallHeight, wallThick),
                    new THREE.MeshStandardMaterial({ color: "#8f8a79", metalness: 0.1, roughness: 0.95, transparent: true, opacity: 1 })
                );
                wall.position.set(dec.x, wallHeight / 2, dec.z);
                wall.rotation.y = dec.rotation ?? 0;
                wall.name = "decoration";
                scene.add(wall);
                columnMeshes.push(wall);
                registerFogOccluderMesh(wall, dec.x, dec.z, 0, wallHeight);

                // Rubble at base
                for (let j = 0; j < 4; j++) {
                    const rubble = new THREE.Mesh(
                        new THREE.BoxGeometry(0.15 + Math.random() * 0.25, 0.1 + Math.random() * 0.15, 0.15 + Math.random() * 0.25),
                        new THREE.MeshStandardMaterial({ color: "#7a7567", metalness: 0.1, roughness: 0.95 })
                    );
                    const offsetX = (Math.random() - 0.5) * wallLength;
                    const offsetZ = (Math.random() - 0.5) * 0.8;
                    rubble.position.set(dec.x + offsetX, 0.1, dec.z + offsetZ);
                    rubble.rotation.y = Math.random() * Math.PI;
                    scene.add(rubble);
                }
            } else if (dec.type === "rock") {
                // Large rock - irregular boulder shape
                const rockSize = 0.75 * size;  // Slightly bigger
                const rock = new THREE.Mesh(
                    new THREE.DodecahedronGeometry(rockSize, 0),
                    new THREE.MeshStandardMaterial({ color: "#9b907d", metalness: 0.1, roughness: 0.95, transparent: true, opacity: 1 })
                );
                rock.position.set(dec.x, rockSize * 0.6, dec.z);
                rock.rotation.set(Math.random() * 0.3, Math.random() * Math.PI, Math.random() * 0.3);
                rock.scale.set(1, 0.7, 1.1);  // Flatten slightly
                rock.userData.disableOcclusionFade = true;
                rock.name = "decoration";
                scene.add(rock);
                columnMeshes.push(rock);
            } else if (dec.type === "small_rock") {
                // Small rock - pebble
                const rockSize = 0.35 * size;  // Slightly bigger
                const rock = new THREE.Mesh(
                    new THREE.DodecahedronGeometry(rockSize, 0),
                    new THREE.MeshStandardMaterial({ color: "#afa38f", metalness: 0.1, roughness: 0.95 })
                );
                rock.position.set(dec.x, rockSize * 0.5, dec.z);
                rock.rotation.set(Math.random() * 0.5, Math.random() * Math.PI, Math.random() * 0.5);
                rock.scale.set(1, 0.6, 1.2);
                rock.userData.disableOcclusionFade = true;
                rock.name = "decoration";
                scene.add(rock);
            } else if (dec.type === "mushroom") {
                // Large mushroom - stem + cap with randomized proportions
                const sizeJitter = 0.8 + Math.random() * 0.4;  // 0.8-1.2x
                const stemHeight = (0.5 + Math.random() * 0.4) * size * sizeJitter;
                const stemRadius = (0.12 + Math.random() * 0.08) * size * sizeJitter;
                const capRadius = (0.4 + Math.random() * 0.3) * size * sizeJitter;
                const capColors = ["#c44", "#b33", "#a52", "#c55", "#943"];
                const capColor = capColors[Math.floor(Math.random() * capColors.length)];
                const tiltX = (Math.random() - 0.5) * 0.15;
                const tiltZ = (Math.random() - 0.5) * 0.15;

                // Stem
                const stem = new THREE.Mesh(
                    new THREE.CylinderGeometry(stemRadius * 0.8, stemRadius, stemHeight, 8),
                    new THREE.MeshStandardMaterial({ color: "#e8dcc8", metalness: 0.0, roughness: 0.9 })
                );
                stem.position.set(dec.x, stemHeight / 2, dec.z);
                stem.rotation.x = tiltX;
                stem.rotation.z = tiltZ;
                scene.add(stem);

                // Cap - dome shape with random flatness
                const capFlatness = 0.3 + Math.random() * 0.2;  // How much of hemisphere to show
                const cap = new THREE.Mesh(
                    new THREE.SphereGeometry(capRadius, 12, 8, 0, Math.PI * 2, 0, Math.PI * capFlatness),
                    new THREE.MeshStandardMaterial({ color: capColor, metalness: 0.0, roughness: 0.8 })
                );
                cap.position.set(dec.x, stemHeight, dec.z);
                cap.rotation.x = tiltX;
                cap.rotation.z = tiltZ;
                cap.name = "decoration";
                scene.add(cap);

                // Add spots to only some large mushrooms.
                if (Math.random() < 0.68) {
                    const spotCount = 4 + Math.floor(Math.random() * 6);
                    const spotColors = ["#fff8da", "#f5efcd", "#efe5bc"];
                    for (let j = 0; j < spotCount; j++) {
                        const spotSize = (0.04 + Math.random() * 0.05) * size * sizeJitter;
                        const spot = new THREE.Mesh(
                            new THREE.CircleGeometry(spotSize, 9),
                            new THREE.MeshStandardMaterial({
                                color: spotColors[Math.floor(Math.random() * spotColors.length)],
                                metalness: 0.0,
                                roughness: 0.8,
                                side: THREE.DoubleSide
                            })
                        );
                        const theta = Math.random() * Math.PI * 2;
                        const phi = Math.random() * Math.PI * capFlatness * 0.82;
                        const radial = capRadius * 0.99;
                        spot.position.set(
                            dec.x + Math.sin(phi) * Math.cos(theta) * radial,
                            stemHeight + Math.cos(phi) * radial,
                            dec.z + Math.sin(phi) * Math.sin(theta) * radial
                        );
                        // Orient spots outward from the cap center so they are visible.
                        spot.lookAt(
                            spot.position.x * 2 - dec.x,
                            spot.position.y * 2 - stemHeight,
                            spot.position.z * 2 - dec.z
                        );
                        scene.add(spot);
                    }
                }
            } else if (dec.type === "small_mushroom") {
                // Small mushroom cluster with randomized count and layout
                const clusterCount = 2 + Math.floor(Math.random() * 3);  // 2-4 mushrooms
                const capColors = ["#c66", "#a55", "#b64", "#c77", "#a44"];
                for (let j = 0; j < clusterCount; j++) {
                    const angle = (j / clusterCount) * Math.PI * 2 + Math.random() * 0.5;
                    const spread = 0.1 + Math.random() * 0.15;
                    const ox = j === 0 ? 0 : Math.cos(angle) * spread;
                    const oz = j === 0 ? 0 : Math.sin(angle) * spread;
                    const sizeJitter = 0.7 + Math.random() * 0.6;
                    const stemHeight = (0.2 + Math.random() * 0.2) * size * sizeJitter;
                    const stemRadius = (0.04 + Math.random() * 0.04) * size * sizeJitter;
                    const capRadius = (0.12 + Math.random() * 0.12) * size * sizeJitter;
                    const tiltX = (Math.random() - 0.5) * 0.2;
                    const tiltZ = (Math.random() - 0.5) * 0.2;

                    const stem = new THREE.Mesh(
                        new THREE.CylinderGeometry(stemRadius * 0.7, stemRadius, stemHeight, 6),
                        new THREE.MeshStandardMaterial({ color: "#e8dcc8", metalness: 0.0, roughness: 0.9 })
                    );
                    stem.position.set(dec.x + ox, stemHeight / 2, dec.z + oz);
                    stem.rotation.x = tiltX;
                    stem.rotation.z = tiltZ;
                    scene.add(stem);

                    const cap = new THREE.Mesh(
                        new THREE.SphereGeometry(capRadius, 8, 6, 0, Math.PI * 2, 0, Math.PI * (0.3 + Math.random() * 0.2)),
                        new THREE.MeshStandardMaterial({ color: capColors[Math.floor(Math.random() * capColors.length)], metalness: 0.0, roughness: 0.8 })
                    );
                    cap.position.set(dec.x + ox, stemHeight, dec.z + oz);
                    cap.rotation.x = tiltX;
                    cap.rotation.z = tiltZ;
                    if (j === 0) cap.name = "decoration";
                    scene.add(cap);
                }
            } else if (dec.type === "weeds") {
                // Large weeds - curved ribbon fronds with varied bend and width.
                addWeedsCluster(dec.x, dec.z, size, "large");
            } else if (dec.type === "small_weeds") {
                // Small weeds - compact variant of the same curved blade treatment.
                addWeedsCluster(dec.x, dec.z, size, "small");
            } else if (dec.type === "fern") {
                // Large bush - cluster of spheres with variation
                const colors = ["#2a6a3a", "#3a8a4e", "#4a9a5e", "#5aaa6e", "#6aba7e"];
                const bushScale = (1.0 + Math.random() * 1.2) * size;  // Varies 1.0 to 2.2

                // Bottom layer - larger, darker spheres spreading out
                const bottomCount = 5 + Math.floor(Math.random() * 3);
                for (let j = 0; j < bottomCount; j++) {
                    const angle = (j / bottomCount) * Math.PI * 2 + Math.random() * 0.5;
                    const radius = (0.25 + Math.random() * 0.15) * bushScale;
                    const sphereSize = (0.18 + Math.random() * 0.1) * bushScale;
                    const color = colors[Math.floor(Math.random() * 2)];  // Darker colors

                    const sphere = new THREE.Mesh(
                        new THREE.SphereGeometry(sphereSize, 6, 5),
                        new THREE.MeshStandardMaterial({ color, metalness: 0.0, roughness: 0.9 })
                    );
                    sphere.position.set(
                        dec.x + Math.cos(angle) * radius,
                        sphereSize * 0.7,
                        dec.z + Math.sin(angle) * radius
                    );
                    if (j === 0) sphere.name = "decoration";
                    scene.add(sphere);
                }

                // Middle layer - medium spheres
                const midCount = 4 + Math.floor(Math.random() * 3);
                for (let j = 0; j < midCount; j++) {
                    const angle = (j / midCount) * Math.PI * 2 + Math.random() * 0.6;
                    const radius = (0.1 + Math.random() * 0.15) * bushScale;
                    const sphereSize = (0.15 + Math.random() * 0.08) * bushScale;
                    const color = colors[1 + Math.floor(Math.random() * 2)];

                    const sphere = new THREE.Mesh(
                        new THREE.SphereGeometry(sphereSize, 6, 5),
                        new THREE.MeshStandardMaterial({ color, metalness: 0.0, roughness: 0.85 })
                    );
                    sphere.position.set(
                        dec.x + Math.cos(angle) * radius,
                        sphereSize + 0.15 * bushScale,
                        dec.z + Math.sin(angle) * radius
                    );
                    scene.add(sphere);
                }

                // Top layer - smaller, brighter spheres
                const topCount = 2 + Math.floor(Math.random() * 2);
                for (let j = 0; j < topCount; j++) {
                    const angle = Math.random() * Math.PI * 2;
                    const radius = Math.random() * 0.08 * bushScale;
                    const sphereSize = (0.1 + Math.random() * 0.06) * bushScale;
                    const color = colors[3 + Math.floor(Math.random() * 2)];

                    const sphere = new THREE.Mesh(
                        new THREE.SphereGeometry(sphereSize, 6, 5),
                        new THREE.MeshStandardMaterial({ color, metalness: 0.0, roughness: 0.8 })
                    );
                    sphere.position.set(
                        dec.x + Math.cos(angle) * radius,
                        0.3 * bushScale + sphereSize,
                        dec.z + Math.sin(angle) * radius
                    );
                    scene.add(sphere);
                }
            } else if (dec.type === "small_fern") {
                // Small bush - simpler cluster
                const colors = ["#3a7a4a", "#4a9a5e", "#5aaa6e", "#7aca8e"];
                const bushScale = (0.6 + Math.random() * 0.8) * size;  // Varies 0.6 to 1.4

                // Bottom spheres
                const count = 3 + Math.floor(Math.random() * 2);
                for (let j = 0; j < count; j++) {
                    const angle = (j / count) * Math.PI * 2 + Math.random() * 0.5;
                    const radius = (0.12 + Math.random() * 0.08) * bushScale;
                    const sphereSize = (0.12 + Math.random() * 0.06) * bushScale;
                    const color = colors[Math.floor(Math.random() * 2)];

                    const sphere = new THREE.Mesh(
                        new THREE.SphereGeometry(sphereSize, 5, 4),
                        new THREE.MeshStandardMaterial({ color, metalness: 0.0, roughness: 0.9 })
                    );
                    sphere.position.set(
                        dec.x + Math.cos(angle) * radius,
                        sphereSize * 0.7,
                        dec.z + Math.sin(angle) * radius
                    );
                    if (j === 0) sphere.name = "decoration";
                    scene.add(sphere);
                }

                // Top accent
                const topSize = (0.08 + Math.random() * 0.05) * bushScale;
                const topColor = colors[2 + Math.floor(Math.random() * 2)];
                const top = new THREE.Mesh(
                    new THREE.SphereGeometry(topSize, 5, 4),
                    new THREE.MeshStandardMaterial({ color: topColor, metalness: 0.0, roughness: 0.85 })
                );
                top.position.set(
                    dec.x + (Math.random() - 0.5) * 0.1 * bushScale,
                    0.15 * bushScale + topSize,
                    dec.z + (Math.random() - 0.5) * 0.1 * bushScale
                );
                scene.add(top);
            }
        });
    }

    // Walls - with transparent support for unit occlusion
    const wallMeshes: THREE.Mesh[] = [];
    computed.mergedObstacles.forEach((o, i) => {
        const shade = 0x5a677d + (i % 3) * 0x040404;
        const mesh = new THREE.Mesh(
            new THREE.BoxGeometry(o.w, 2.5, o.h),
            new THREE.MeshStandardMaterial({ color: shade, metalness: 0.2, roughness: 0.8, transparent: true, opacity: 1 })
        );
        mesh.position.set(o.x + o.w / 2, 1.25, o.z + o.h / 2);
        mesh.name = "obstacle";
        // Store bounds for secret door wall removal
        mesh.userData.bounds = { x: o.x, z: o.z, w: o.w, h: o.h };
        scene.add(mesh);
        wallMeshes.push(mesh);
    });

    // Doors - clickable transitions to other areas
    const doorMeshes: DoorMesh[] = [];
    area.transitions.forEach(transition => {
        // Create a subtle transparent portal
        // Door dimensions: w is X extent, h is Z extent (always)
        // BoxGeometry(width=X, height=Y, depth=Z)
        const doorWidth = transition.w;
        const doorDepth = transition.h;

        // Transparent portal box
        const doorMat = new THREE.MeshBasicMaterial({
            color: "#6090c0",
            transparent: true,
            opacity: 0.08,
            side: THREE.DoubleSide
        });

        const doorMesh = new THREE.Mesh(
            new THREE.BoxGeometry(doorWidth, 2.2, doorDepth),
            doorMat
        );

        doorMesh.position.set(
            transition.x + transition.w / 2,
            1.1,
            transition.z + transition.h / 2
        );
        doorMesh.name = "door";
        doorMesh.userData.transition = transition;
        scene.add(doorMesh);
        doorMeshes.push(doorMesh as unknown as DoorMesh);

        // Inner glow light - subtle point light inside the portal
        if (ENABLE_DOOR_POINT_LIGHTS) {
            const doorLight = new THREE.PointLight("#7ab0e0", 1.2, 6, 2);
            doorLight.position.set(
                transition.x + transition.w / 2,
                1.0,
                transition.z + transition.h / 2
            );
            doorLight.userData.baseIntensity = 1.2;
            doorLight.userData.flickerStrength = 0;
            doorLight.userData.lightRole = "area";
            scene.add(doorLight);
            candleLights.push(doorLight);
        }
    });

    // Secret doors - wall segment with cracks that gets removed when clicked
    const secretDoorMeshes: SecretDoorMesh[] = [];
    if (area.secretDoors) {
        area.secretDoors.forEach((secretDoor, index) => {
            const group = new THREE.Group() as SecretDoorMesh;
            const secretDoorData = { secretDoor, secretDoorIndex: index };
            const { blockingWall } = secretDoor;

            // Create the blocking wall mesh (same style as other walls)
            const wallMesh = new THREE.Mesh(
                new THREE.BoxGeometry(blockingWall.w, 2.5, blockingWall.h),
                new THREE.MeshStandardMaterial({ color: 0x5a677d, metalness: 0.2, roughness: 0.8 })
            );
            wallMesh.position.set(
                blockingWall.x + blockingWall.w / 2,
                1.25,
                blockingWall.z + blockingWall.h / 2
            );
            wallMesh.name = "secretDoor";
            wallMesh.userData = secretDoorData;
            group.add(wallMesh);

            // Create thick crack segments on an outer face of the hidden wall.
            const crackMat = new THREE.MeshBasicMaterial({ color: "#0a0a0a" });
            const crackOffsets = [
                [0.0, 0.1, 0.15, 0.9, 0.08],
                [0.15, 0.9, -0.1, 1.5, 0.08],
                [-0.1, 1.5, 0.2, 2.2, 0.08],
                [0.15, 0.9, 0.6, 1.1, 0.05],
                [0.6, 1.1, 0.9, 1.0, 0.04],
                [-0.1, 1.5, -0.5, 1.7, 0.05],
                [-0.5, 1.7, -0.8, 1.6, 0.04],
                [0.15, 0.9, -0.4, 0.6, 0.05],
            ] as const;

            // Keep cracks on an outer face but anchor them to the center tile of the secret wall.
            if (blockingWall.h > blockingWall.w) {
                const crackTileZ = blockingWall.z + Math.floor((blockingWall.h - 1) / 2);
                const crackZ = crackTileZ + 0.5;
                const crackX = blockingWall.x + blockingWall.w + 0.02;

                const makeCrack = (z1: number, y1: number, z2: number, y2: number, thickness = 0.06): THREE.Mesh => {
                    const dz = z2 - z1;
                    const dy = y2 - y1;
                    const length = Math.sqrt(dz * dz + dy * dy);
                    const angle = Math.atan2(dz, dy);
                    const crack = new THREE.Mesh(
                        new THREE.BoxGeometry(0.02, length, thickness),
                        crackMat
                    );
                    crack.position.set(crackX, (y1 + y2) / 2, (z1 + z2) / 2);
                    crack.rotation.x = angle;
                    return crack;
                };

                crackOffsets.forEach(([o1, y1, o2, y2, thickness]) => {
                    group.add(makeCrack(crackZ + o1, y1, crackZ + o2, y2, thickness));
                });
            } else {
                const crackTileX = blockingWall.x + Math.floor((blockingWall.w - 1) / 2);
                const crackX = crackTileX + 0.5;
                const crackZ = blockingWall.z + blockingWall.h + 0.02;

                const makeCrack = (x1: number, y1: number, x2: number, y2: number, thickness = 0.06): THREE.Mesh => {
                    const dx = x2 - x1;
                    const dy = y2 - y1;
                    const length = Math.hypot(dx, dy);
                    const angle = Math.atan2(dx, dy);

                    const crack = new THREE.Mesh(
                        new THREE.BoxGeometry(thickness, length, 0.02),
                        crackMat
                    );
                    crack.position.set((x1 + x2) / 2, (y1 + y2) / 2, crackZ);
                    crack.rotation.z = -angle;
                    return crack;
                };

                crackOffsets.forEach(([o1, y1, o2, y2, thickness]) => {
                    group.add(makeCrack(crackX + o1, y1, crackX + o2, y2, thickness));
                });
            }

            group.userData = secretDoorData;
            scene.add(group);
            secretDoorMeshes.push(group);
        });
    }

    // Grid lines - subtle, above room floors (darker for forest to show on green grass)
    const hasWaterTiles = [...floorLayerStack, ...terrainLayerStack]
        .some(layer => layer.some(row => row.some(char => char === "w" || char === "W")));
    const gridColor = area.id === "forest" ? "#2f4a2f" : "#3a414a";
    const baseGridOpacity = area.id === "forest" ? 0.12 : 0.08;
    const gridOpacity = hasWaterTiles ? Math.min(baseGridOpacity + 0.03, 0.16) : baseGridOpacity;
    const topFloorY = FLOOR_BASE_Y + Math.max(0, floorLayerStack.length - 1) * FLOOR_LAYER_HEIGHT_STEP;
    const topTerrainY = TERRAIN_BASE_Y + Math.max(0, terrainLayerStack.length - 1) * TERRAIN_LAYER_HEIGHT_STEP;
    const gridY = Math.max(topFloorY, topTerrainY) + 0.002;
    const gridMat = new THREE.LineBasicMaterial({
        color: gridColor,
        transparent: true,
        opacity: gridOpacity,
        depthTest: true,
        depthWrite: false,
        toneMapped: false,
    });
    // Horizontal lines (along X axis, varying Z)
    for (let z = 0; z <= area.gridHeight; z++) {
        const line = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, gridY, z), new THREE.Vector3(area.gridWidth, gridY, z)]),
            gridMat
        );
        setStaticRenderTier(line, "grid");
        scene.add(line);
    }
    // Vertical lines (along Z axis, varying X)
    for (let x = 0; x <= area.gridWidth; x++) {
        const line = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x, gridY, 0), new THREE.Vector3(x, gridY, area.gridHeight)]),
            gridMat
        );
        setStaticRenderTier(line, "grid");
        scene.add(line);
    }

    applyStaticRenderOrder(scene);

    // Fog of war (scaled resolution for smoother edges with linear filtering)
    const fogCanvas = document.createElement("canvas");
    fogCanvas.width = area.gridWidth * FOG_SCALE;
    fogCanvas.height = area.gridHeight * FOG_SCALE;
    const fogCtx = fogCanvas.getContext("2d")!;
    fogCtx.fillStyle = "#000";
    fogCtx.fillRect(0, 0, area.gridWidth * FOG_SCALE, area.gridHeight * FOG_SCALE);
    const fogTextureObj = new THREE.CanvasTexture(fogCanvas);
    fogTextureObj.magFilter = THREE.LinearFilter;
    fogTextureObj.minFilter = THREE.LinearFilter;
    fogTextureObj.colorSpace = THREE.NoColorSpace;
    fogTextureObj.generateMipmaps = false;
    const fogTexture: FogTexture = { canvas: fogCanvas, ctx: fogCtx, texture: fogTextureObj };

    const fogMaterial = new THREE.MeshBasicMaterial({
        map: fogTextureObj,
        color: "#000000",
        transparent: true,
        opacity: 1,
        depthWrite: false,
        toneMapped: false,
        fog: false,
        blending: THREE.NormalBlending,
        premultipliedAlpha: false
    });
    fogMaterial.depthTest = false;

    const fogMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(area.gridWidth, area.gridHeight),
        fogMaterial
    );
    fogMesh.rotation.x = -Math.PI / 2;
    fogMesh.position.set(area.gridWidth / 2, 2.6, area.gridHeight / 2);
    fogMesh.renderOrder = RENDER_ORDER_FOG;
    fogMesh.frustumCulled = false;
    scene.add(fogMesh);

    // Move marker
    const moveMarker = new THREE.Mesh(
        new THREE.RingGeometry(0.2, 0.3, 4),
        new THREE.MeshBasicMaterial({ color: "#ffff00", side: THREE.DoubleSide, transparent: true, opacity: 0.8 })
    );
    moveMarker.rotation.x = -Math.PI / 2;
    moveMarker.visible = false;
    scene.add(moveMarker);

    // Range indicator
    const rangeIndicator = new THREE.Mesh(
        new THREE.RingGeometry(0.1, 10, 64),
        new THREE.MeshBasicMaterial({ color: "#3b82f6", side: THREE.DoubleSide, transparent: true, opacity: 0.25 })
    );
    rangeIndicator.rotation.x = -Math.PI / 2;
    rangeIndicator.position.y = 0.02;
    rangeIndicator.visible = false;
    rangeIndicator.userData.radius = 10;
    scene.add(rangeIndicator);

    // AOE indicator
    const aoeIndicator = new THREE.Mesh(
        new THREE.RingGeometry(0.1, 2.5, 64),
        new THREE.MeshBasicMaterial({ color: "#ff4400", side: THREE.DoubleSide, transparent: true, opacity: 0.4 })
    );
    aoeIndicator.rotation.x = -Math.PI / 2;
    aoeIndicator.position.y = 0.03;
    aoeIndicator.visible = false;
    aoeIndicator.userData.innerRadius = 0.1;
    aoeIndicator.userData.outerRadius = 2.5;
    scene.add(aoeIndicator);

    // Create unit meshes
    const unitGroups: Record<number, UnitGroup> = {};
    const selectRings: Record<number, THREE.Mesh> = {};
    const targetRings: Record<number, THREE.Mesh> = {};  // Red rings for targeted enemies
    const shieldIndicators: Record<number, THREE.Mesh> = {};  // Front shield facing indicators
    const unitMeshes: Record<number, THREE.Mesh> = {};
    const unitOriginalColors: Record<number, THREE.Color> = {};
    const maxHp: Record<number, number> = {};
    const billboards: THREE.Mesh[] = [];

    units.forEach(unit => {
        // Skip dead units - don't create scene objects for them
        if (unit.hp <= 0) return;

        const data = getUnitStats(unit);
        const result = createUnitSceneGroup(scene, unit, billboards);

        unitGroups[unit.id] = result.group;
        selectRings[unit.id] = result.selectRing;
        unitMeshes[unit.id] = result.mesh;
        unitOriginalColors[unit.id] = result.baseColor.clone();
        maxHp[unit.id] = data.maxHp;

        if (result.targetRing) {
            targetRings[unit.id] = result.targetRing;
        }
        if (result.shieldIndicator) {
            shieldIndicators[unit.id] = result.shieldIndicator;
        }
    });

    applyShadowDefaults(scene);
    if (renderer.shadowMap.enabled) {
        renderer.shadowMap.needsUpdate = true;
    }

    return {
        scene,
        camera,
        renderer,
        flames,
        candleMeshes,
        candleLights,
        fogTexture,
        fogMesh,
        moveMarker,
        rangeIndicator,
        aoeIndicator,
        unitGroups,
        selectRings,
        targetRings,
        shieldIndicators,
        unitMeshes,
        unitOriginalColors,
        maxHp,
        wallMeshes,
        treeMeshes,
        fogOccluderMeshes,
        columnMeshes,
        columnGroups,
        doorMeshes,
        secretDoorMeshes,
        waterMesh,
        chestMeshes,
        billboards,
    };
}
