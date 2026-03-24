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
    normalizeTileLayerStack,
    normalizeTintLayerStack,
    TILE_EMPTY,
} from "../../game/areas/tileLayers";
import { getUnitStats } from "../../game/units";
import type { Unit, UnitGroup, FogTexture } from "../../core/types";
import {
    applyTileTintColor,
    createRoundedFloorMaterial,
    getFloorType,
    getFloorVariantColor,
    getNaturalTileCornerRounding,
    hashNoise,
} from "./floorUtils";
import {
    buildCandleLightClusters,
    clampFinite,
    normalizeHexColor,
    type CandleLightSource,
} from "./lightUtils";
import {
    applyShadowDefaults,
    applyStaticRenderOrder,
    buildFogFootprintFromBounds,
    createSkyTexture,
    createSkyTextureWithLightnessBoost,
    DIRECTIONAL_SHADOW_MAP_SIZE,
    ENABLE_DOOR_POINT_LIGHTS,
    hashAreaIdToUnitRange,
    MAX_AREA_LIGHTS,
    MAX_FLAME_CLUSTER_LIGHTS,
    RENDER_ORDER_FOG,
    RENDERER_MAX_PIXEL_RATIO,
    setStaticRenderTier,
} from "./sceneSetupHelpers";

// Re-export types
export type { DoorMesh, WaystoneMesh, SecretDoorMesh, ChestMeshData } from "./types";
import type { DoorMesh, WaystoneMesh, SecretDoorMesh, ChestMeshData, SceneRefs } from "./types";

// Re-export update functions
export {
    updateChestStates,
    updateCamera,
    updateLightning,
    updateWater,
    updateRain,
    updateBillboards,
    updateHpBarBillboards,
    updateHpBars,
    updateLightLOD,
    updateWallTransparency,
    updateTreeFogVisibility,
    updateFogOccluderVisibility,
    revealAllTreeMeshes,
    revealAllFogOccluderMeshes
} from "./updates";

// Re-export unit functions
export { addUnitToScene } from "./units";
import { buildDecorationsScene } from "./decorations";
import { createUnitSceneGroup, ensureTexturesLoaded } from "./units";

function attachUserData<TObject extends THREE.Object3D, TUserData extends Record<string, unknown>>(
    object: TObject,
    userData: TUserData
): TObject & { userData: TUserData } {
    object.userData = userData;
    return Object.assign(object, { userData });
}

// =============================================================================
// MAIN SCENE CREATION
// =============================================================================

function createRainTexture(): THREE.CanvasTexture {
    const canvas = document.createElement("canvas");
    canvas.width = 80;
    canvas.height = 128;
    const ctx = canvas.getContext("2d")!;
    const rainSlantX = 5.5;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineCap = "round";

    for (let index = 0; index < 22; index++) {
        const startX = ((index * 17) % (canvas.width + 16)) - 8;
        const startY = ((index * 23) % (canvas.height + 32)) - 16;
        const length = 13 + (index % 4) * 3;
        const alpha = index % 6 === 0 ? 0.56 : 0.42;

        ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
        ctx.lineWidth = index % 5 === 0 ? 0.16 : 0.12;
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(startX + rainSlantX, startY + length);
        ctx.stroke();
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}

export function createScene(container: HTMLDivElement, units: Unit[]): SceneRefs {
    // Front-load texture decoding before building meshes
    ensureTexturesLoaded(units);

    const area = getCurrentArea();
    const computed = getComputedAreaData();
    const hasRainEffect = area.sceneEffects?.rain === true;
    const hasLightningEffect = area.sceneEffects?.lightning === true;

    const scene = new THREE.Scene();
    const baseSkyTexture = createSkyTexture(area.backgroundColor, area.id === "forest");
    scene.background = baseSkyTexture;
    if (hasLightningEffect) {
        scene.userData.lightningBackground = {
            textures: [
                baseSkyTexture,
                createSkyTextureWithLightnessBoost(area.backgroundColor, 0.035),
                createSkyTextureWithLightnessBoost(area.backgroundColor, 0.07),
            ],
            nextEventTimeMs: 3500 + Math.random() * 6500,
            flashStartTimeMs: 0,
            flashEndTimeMs: 0,
            burstFlashesRemaining: 0,
            exposureBoost: 0,
        };
    }

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
    let rainOverlay: THREE.Mesh | null = null;
    let hasLiquidTiles = false;
    const liquidTiles = new THREE.Group();
    liquidTiles.name = "liquidTiles";
    scene.add(liquidTiles);

    // Shared geometry for all 1x1 floor/terrain tiles (hundreds of tiles, one geometry)
    const tileGeo = new THREE.PlaneGeometry(1, 1);
    const tileInstanceRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
    const tileInstanceScale = new THREE.Vector3(1, 1, 1);
    const WATER_METALNESS = 0.52;
    const WATER_ROUGHNESS = 0.08;
    const WATER_TILE_OPACITY = 0.4;
    const WATER_BUBBLE_DENSITY = 0.2;
    const WATER_BUBBLE_GROUP_Y_OFFSET = 0.0048;
    const WATER_BUBBLE_BASE_OPACITY = 0.32;
    const WATER_BUBBLE_COLOR = "#ffffff";
    const WATER_BUBBLE_SCALE_MIN = 0.72;
    const WATER_BUBBLE_SCALE_MAX = 2.65;
    const WATER_BUBBLE_SCALE_CURVE = 2.0;
    const LAVA_BUBBLE_GROUP_Y_OFFSET = 0.0054;
    const LAVA_BUBBLE_DENSITY = 0.24;
    const LAVA_BUBBLE_BASE_OPACITY = 0.37;
    const LAVA_BUBBLE_COLOR = "#7a2a14";
    const LAVA_BUBBLE_SCALE_MIN = 0.82;
    const LAVA_BUBBLE_SCALE_MAX = 2.8;
    const LAVA_BUBBLE_SCALE_CURVE = 1.9;
    const TERRAIN_WATER_COLOR_SHALLOW = "#32718a";
    const TERRAIN_WATER_COLOR_DEEP = "#295f75";
    const TERRAIN_WATER_Y_OFFSET = -0.12;
    // Keep floor layers visually flat so they remain below prop/shadow layers.
    const FLOOR_LAYER_HEIGHT_STEP = 0.00004;
    const TERRAIN_LAYER_HEIGHT_STEP = 0.00005;
    const FLOOR_BASE_Y = 0.0006;
    const TERRAIN_BASE_Y = 0.0008;

    // Material pool: reuse materials for tiles with the same color (avoids ~1600 unique instances)
    const floorMatPool: Record<string, THREE.MeshStandardMaterial> = {};
    const waterMatPool: Record<string, THREE.MeshStandardMaterial> = {};
    const lavaMatPool: Record<string, THREE.MeshStandardMaterial> = {};
    const roundedTileMatPool: Record<string, THREE.MeshStandardMaterial> = {};
    const batchedTileMatrices = new Map<THREE.MeshStandardMaterial, THREE.Matrix4[]>();
    const lavaBubbleGeo = new THREE.RingGeometry(0.046, 0.074, 16);
    const areaIdUnitRange = hashAreaIdToUnitRange(area.id);

    function isTerrainWater(value: string | undefined): boolean {
        return value === "w" || value === "W";
    }

    function isSurroundedByTerrainWater(layer: string[][], x: number, z: number): boolean {
        return isTerrainWater(layer[z - 1]?.[x])
            && isTerrainWater(layer[z + 1]?.[x])
            && isTerrainWater(layer[z]?.[x - 1])
            && isTerrainWater(layer[z]?.[x + 1]);
    }

    function isTerrainLava(value: string | undefined): boolean {
        return value === "~";
    }

    function isSurroundedByTerrainLava(layer: string[][], x: number, z: number): boolean {
        return isTerrainLava(layer[z - 1]?.[x])
            && isTerrainLava(layer[z + 1]?.[x])
            && isTerrainLava(layer[z]?.[x - 1])
            && isTerrainLava(layer[z]?.[x + 1]);
    }
    const skipRaycast: THREE.Object3D["raycast"] = () => undefined;
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
    function serializeCornerMask(mask: [number, number, number, number]): string {
        return `${mask[0]}${mask[1]}${mask[2]}${mask[3]}`;
    }
    function getRoundedTileMat(
        color: string,
        outerCorners: [number, number, number, number],
        innerCorners: [number, number, number, number],
        radius: number,
        metalness: number,
        roughness: number
    ): THREE.MeshStandardMaterial {
        const key = [
            color,
            serializeCornerMask(outerCorners),
            serializeCornerMask(innerCorners),
            radius.toFixed(3),
            metalness.toFixed(3),
            roughness.toFixed(3)
        ].join("|");
        const cached = roundedTileMatPool[key];
        if (cached) return cached;

        const next = createRoundedFloorMaterial(
            color,
            outerCorners,
            innerCorners,
            radius,
            metalness,
            roughness
        );
        roundedTileMatPool[key] = next;
        return next;
    }
    function queueBatchedTile(
        material: THREE.MeshStandardMaterial,
        x: number,
        y: number,
        z: number
    ): void {
        const existing = batchedTileMatrices.get(material);
        if (existing) {
            existing.push(new THREE.Matrix4().compose(
                new THREE.Vector3(x + 0.5, y, z + 0.5),
                tileInstanceRotation,
                tileInstanceScale
            ));
            return;
        }

        batchedTileMatrices.set(material, [
            new THREE.Matrix4().compose(
                new THREE.Vector3(x + 0.5, y, z + 0.5),
                tileInstanceRotation,
                tileInstanceScale
            )
        ]);
    }
    function flushBatchedTiles(): void {
        for (const [material, matrices] of batchedTileMatrices.entries()) {
            const instanced = new THREE.InstancedMesh(tileGeo, material, matrices.length);
            instanced.name = "ground";
            instanced.instanceMatrix.setUsage(THREE.StaticDrawUsage);
            for (let index = 0; index < matrices.length; index++) {
                instanced.setMatrixAt(index, matrices[index]);
            }
            instanced.computeBoundingSphere();
            setStaticRenderTier(instanced, "floor");
            scene.add(instanced);
        }
        batchedTileMatrices.clear();
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
                    tileMaterial = getRoundedTileMat(
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

                const tileY = FLOOR_BASE_Y + layerIndex * FLOOR_LAYER_HEIGHT_STEP;
                if (!hasRounding) {
                    queueBatchedTile(tileMaterial, x, tileY, z);
                } else {
                    const tile = new THREE.Mesh(tileGeo, tileMaterial);
                    tile.rotation.x = -Math.PI / 2;
                    tile.position.set(x + 0.5, tileY, z + 0.5);
                    tile.name = "ground";
                    setStaticRenderTier(tile, "floor");
                    scene.add(tile);
                }
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
                        ? getRoundedTileMat(
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
                        wavePhase: hashNoise(x, z, areaIdUnitRange * 1000) * Math.PI * 2,
                        waveSpeed: 1.7,
                        baseColor: lavaMat.color.clone(),
                        hotColor: new THREE.Color("#ff8a00"),
                        baseEmissiveIntensity: lavaMat.emissiveIntensity
                    };
                    liquidTiles.add(lavaTile);
                    hasLiquidTiles = true;

                    const bubbleSeed = areaIdUnitRange * 1400 + layerIndex * 157;
                    if (!isSurroundedByTerrainLava(layer, x, z)) {
                        continue;
                    }
                    const bubblePresence = hashNoise(x, z, bubbleSeed + 5);
                    if (bubblePresence > LAVA_BUBBLE_DENSITY) {
                        continue;
                    }

                    const bubbleGroup = new THREE.Group();
                    bubbleGroup.name = "lavaBubbles";
                    bubbleGroup.raycast = skipRaycast;
                    bubbleGroup.position.set(
                        x + 0.5,
                        TERRAIN_BASE_Y + layerIndex * TERRAIN_LAYER_HEIGHT_STEP + LAVA_BUBBLE_GROUP_Y_OFFSET,
                        z + 0.5
                    );
                    bubbleGroup.userData.liquid = {
                        liquidType: "lavaBubbles",
                        wavePhase: hashNoise(x, z, bubbleSeed + 17) * Math.PI * 2,
                        waveSpeed: 0.9 + hashNoise(x, z, bubbleSeed + 31) * 0.45,
                        baseOpacity: LAVA_BUBBLE_BASE_OPACITY,
                        baseScale: 1.02 + hashNoise(x, z, bubbleSeed + 43) * 0.22,
                    };

                    const bubbleCount = 2 + Math.floor(hashNoise(x, z, bubbleSeed + 59) * 2);
                    for (let bubbleIndex = 0; bubbleIndex < bubbleCount; bubbleIndex++) {
                        const bubbleMat = new THREE.MeshBasicMaterial({
                            color: LAVA_BUBBLE_COLOR,
                            transparent: true,
                            opacity: 0,
                            depthWrite: false,
                            toneMapped: false,
                        });
                        const bubble = new THREE.Mesh(lavaBubbleGeo, bubbleMat);
                        const bubbleAngle = hashNoise(x, z, bubbleSeed + 71 + bubbleIndex * 17) * Math.PI * 2;
                        const bubbleRadius = 0.055 + hashNoise(x, z, bubbleSeed + 83 + bubbleIndex * 19) * 0.145;
                        const bubbleScaleNoise = hashNoise(x, z, bubbleSeed + 97 + bubbleIndex * 23);
                        const bubbleScale = THREE.MathUtils.lerp(
                            LAVA_BUBBLE_SCALE_MIN,
                            LAVA_BUBBLE_SCALE_MAX,
                            Math.pow(bubbleScaleNoise, LAVA_BUBBLE_SCALE_CURVE)
                        );
                        bubble.position.set(
                            Math.cos(bubbleAngle) * bubbleRadius,
                            0,
                            Math.sin(bubbleAngle) * bubbleRadius
                        );
                        bubble.rotation.x = -Math.PI / 2;
                        bubble.scale.setScalar(bubbleScale);
                        bubble.name = "lavaBubble";
                        bubble.raycast = skipRaycast;
                        setStaticRenderTier(bubble, "floor");
                        bubble.userData.bubbleData = {
                            phaseOffset: hashNoise(x, z, bubbleSeed + 113 + bubbleIndex * 29) * Math.PI * 2,
                            baseScale: bubbleScale,
                            baseY: 0,
                            riseAmplitude: 0.012 + hashNoise(x, z, bubbleSeed + 127 + bubbleIndex * 31) * 0.02,
                        };
                        bubbleGroup.add(bubble);
                    }

                    liquidTiles.add(bubbleGroup);
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
                        ? getRoundedTileMat(
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

                    const tileY = TERRAIN_BASE_Y + layerIndex * TERRAIN_LAYER_HEIGHT_STEP + TERRAIN_WATER_Y_OFFSET;
                    if (!hasRounding) {
                        queueBatchedTile(waterMat, x, tileY, z);
                    } else {
                        const tile = new THREE.Mesh(tileGeo, waterMat);
                        tile.rotation.x = -Math.PI / 2;
                        tile.position.set(x + 0.5, tileY, z + 0.5);
                        tile.name = "ground";
                        setStaticRenderTier(tile, "floor");
                        scene.add(tile);
                    }
                    hasLiquidTiles = true;

                    const bubbleSeed = areaIdUnitRange * 1000 + layerIndex * 97;
                    if (!isSurroundedByTerrainWater(layer, x, z)) {
                        continue;
                    }
                    const bubblePresence = hashNoise(x, z, bubbleSeed + 7);
                    if (bubblePresence > WATER_BUBBLE_DENSITY) {
                        continue;
                    }
                    const bubbleGroup = new THREE.Group();
                    bubbleGroup.name = "waterBubbles";
                    bubbleGroup.raycast = skipRaycast;
                    bubbleGroup.position.set(
                        x + 0.5,
                        TERRAIN_BASE_Y + layerIndex * TERRAIN_LAYER_HEIGHT_STEP + TERRAIN_WATER_Y_OFFSET + WATER_BUBBLE_GROUP_Y_OFFSET,
                        z + 0.5
                    );
                    bubbleGroup.userData.liquid = {
                        liquidType: "waterBubbles",
                        wavePhase: hashNoise(x, z, bubbleSeed + 17) * Math.PI * 2,
                        waveSpeed: 0.78 + hashNoise(x, z, bubbleSeed + 31) * 0.35,
                        baseOpacity: WATER_BUBBLE_BASE_OPACITY,
                        baseScale: 0.96 + hashNoise(x, z, bubbleSeed + 43) * 0.2,
                    };

                    const bubbleCount = 2 + Math.floor(hashNoise(x, z, bubbleSeed + 59) * 2);
                    for (let bubbleIndex = 0; bubbleIndex < bubbleCount; bubbleIndex++) {
                        const bubbleMat = new THREE.MeshBasicMaterial({
                            color: WATER_BUBBLE_COLOR,
                            transparent: true,
                            opacity: 0,
                            depthWrite: false,
                            toneMapped: false,
                        });
                        const bubble = new THREE.Mesh(lavaBubbleGeo, bubbleMat);
                        const bubbleAngle = hashNoise(x, z, bubbleSeed + 71 + bubbleIndex * 17) * Math.PI * 2;
                        const bubbleRadius = 0.045 + hashNoise(x, z, bubbleSeed + 83 + bubbleIndex * 19) * 0.13;
                        const bubbleScaleNoise = hashNoise(x, z, bubbleSeed + 97 + bubbleIndex * 23);
                        const bubbleScale = THREE.MathUtils.lerp(
                            WATER_BUBBLE_SCALE_MIN,
                            WATER_BUBBLE_SCALE_MAX,
                            Math.pow(bubbleScaleNoise, WATER_BUBBLE_SCALE_CURVE)
                        );
                        bubble.position.set(
                            Math.cos(bubbleAngle) * bubbleRadius,
                            0,
                            Math.sin(bubbleAngle) * bubbleRadius
                        );
                        bubble.rotation.x = -Math.PI / 2;
                        bubble.scale.setScalar(bubbleScale);
                        bubble.name = "waterBubble";
                        bubble.raycast = skipRaycast;
                        setStaticRenderTier(bubble, "floor");
                        bubble.userData.bubbleData = {
                            phaseOffset: hashNoise(x, z, bubbleSeed + 113 + bubbleIndex * 29) * Math.PI * 2,
                            baseScale: bubbleScale,
                            baseY: 0,
                            riseAmplitude: 0.009 + hashNoise(x, z, bubbleSeed + 127 + bubbleIndex * 31) * 0.016,
                        };
                        bubbleGroup.add(bubble);
                    }
                    liquidTiles.add(bubbleGroup);
                }
            }
        }
    }

    flushBatchedTiles();

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
    const CHEST_BODY_WIDTH = 0.9;
    const CHEST_BODY_HEIGHT = 0.5;
    const CHEST_BODY_DEPTH = 0.6;
    const CHEST_WALL_THICKNESS = 0.07;
    const CHEST_WALL_HEIGHT = CHEST_BODY_HEIGHT - CHEST_WALL_THICKNESS;
    const CHEST_INNER_FLOOR_HEIGHT = 0.024;
    const CHEST_INNER_FLOOR_WIDTH = CHEST_BODY_WIDTH - CHEST_WALL_THICKNESS * 2 - 0.03;
    const CHEST_INNER_FLOOR_DEPTH = CHEST_BODY_DEPTH - CHEST_WALL_THICKNESS * 2 - 0.03;

    const chestBaseGeo = new THREE.BoxGeometry(CHEST_BODY_WIDTH, CHEST_WALL_THICKNESS, CHEST_BODY_DEPTH);
    const chestSideGeo = new THREE.BoxGeometry(CHEST_WALL_THICKNESS, CHEST_WALL_HEIGHT, CHEST_BODY_DEPTH);
    const chestFrontBackGeo = new THREE.BoxGeometry(CHEST_BODY_WIDTH - CHEST_WALL_THICKNESS * 2, CHEST_WALL_HEIGHT, CHEST_WALL_THICKNESS);
    const chestInnerFloorGeo = new THREE.BoxGeometry(CHEST_INNER_FLOOR_WIDTH, CHEST_INNER_FLOOR_HEIGHT, CHEST_INNER_FLOOR_DEPTH);
    const chestLidGeo = new THREE.BoxGeometry(0.95, 0.25, 0.65);
    const chestBuckleGeo = new THREE.BoxGeometry(0.2, 0.2, 0.08);
    const chestBodyMaterial = new THREE.MeshStandardMaterial({ color: "#5c3a21", metalness: 0.2, roughness: 0.8 });
    const chestLidMaterial = new THREE.MeshStandardMaterial({ color: "#6b4423", metalness: 0.2, roughness: 0.7 });
    const chestInteriorMaterial = new THREE.MeshStandardMaterial({ color: "#1b1009", metalness: 0.05, roughness: 0.92 });
    const chestBuckleMaterial = new THREE.MeshStandardMaterial({
        color: "#d4af37",
        emissive: "#8b7500",
        emissiveIntensity: 0.6,
        metalness: 1.0,
        roughness: 0.05,
    });

    const chestMeshes: ChestMeshData[] = [];
    area.chests.forEach((chest, index) => {
        const chestGroup = new THREE.Group();
        const chestBody = new THREE.Group();
        chestGroup.add(chestBody);

        const chestBase = new THREE.Mesh(chestBaseGeo, chestBodyMaterial);
        chestBase.position.y = CHEST_WALL_THICKNESS / 2;
        chestBody.add(chestBase);

        const chestLeftWall = new THREE.Mesh(chestSideGeo, chestBodyMaterial);
        chestLeftWall.position.set(
            -CHEST_BODY_WIDTH / 2 + CHEST_WALL_THICKNESS / 2,
            CHEST_WALL_THICKNESS + CHEST_WALL_HEIGHT / 2,
            0
        );
        chestBody.add(chestLeftWall);

        const chestRightWall = new THREE.Mesh(chestSideGeo, chestBodyMaterial);
        chestRightWall.position.set(
            CHEST_BODY_WIDTH / 2 - CHEST_WALL_THICKNESS / 2,
            CHEST_WALL_THICKNESS + CHEST_WALL_HEIGHT / 2,
            0
        );
        chestBody.add(chestRightWall);

        const chestFrontWall = new THREE.Mesh(chestFrontBackGeo, chestBodyMaterial);
        chestFrontWall.position.set(
            0,
            CHEST_WALL_THICKNESS + CHEST_WALL_HEIGHT / 2,
            CHEST_BODY_DEPTH / 2 - CHEST_WALL_THICKNESS / 2
        );
        chestBody.add(chestFrontWall);

        const chestBackWall = new THREE.Mesh(chestFrontBackGeo, chestBodyMaterial);
        chestBackWall.position.set(
            0,
            CHEST_WALL_THICKNESS + CHEST_WALL_HEIGHT / 2,
            -CHEST_BODY_DEPTH / 2 + CHEST_WALL_THICKNESS / 2
        );
        chestBody.add(chestBackWall);

        const chestInnerFloor = new THREE.Mesh(chestInnerFloorGeo, chestInteriorMaterial);
        chestInnerFloor.position.y = CHEST_WALL_THICKNESS + CHEST_INNER_FLOOR_HEIGHT / 2;
        chestBody.add(chestInnerFloor);

        // Lid pivot - positioned at back edge of chest body top for hinge rotation
        const lidPivot = new THREE.Group();
        lidPivot.position.set(0, 0.5, -0.3);  // Back edge, top of body
        chestGroup.add(lidPivot);

        // Chest lid - offset from pivot so it rotates from back edge
        const chestLid = new THREE.Mesh(
            chestLidGeo,
            chestLidMaterial
        );
        chestLid.position.set(0, 0.125, 0.325);  // Offset from pivot point
        lidPivot.add(chestLid);

        // Gold buckle/clasp on front - highly metallic brass/gold
        const buckle = new THREE.Mesh(
            chestBuckleGeo,
            chestBuckleMaterial
        );
        buckle.position.set(0, 0.4, 0.32);
        chestGroup.add(buckle);

        // Mark all chest parts as "chest" for raycasting with chest data
        const chestData = { chestIndex: index, chestX: chest.x, chestZ: chest.z, chestDecorOnly: chest.decorOnly === true };
        chestBase.name = "chest";
        chestBase.userData = chestData;
        chestLeftWall.name = "chest";
        chestLeftWall.userData = chestData;
        chestRightWall.name = "chest";
        chestRightWall.userData = chestData;
        chestFrontWall.name = "chest";
        chestFrontWall.userData = chestData;
        chestBackWall.name = "chest";
        chestBackWall.userData = chestData;
        chestInnerFloor.name = "chest";
        chestInnerFloor.userData = chestData;
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
        const footprint = buildFogFootprintFromBounds(bounds, 0.18, area.gridWidth, area.gridHeight);

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
            const fullFoliageY = palmTopY;
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

            const treeFootprint = buildFogFootprintFromBounds(treeBounds, 0.16, area.gridWidth, area.gridHeight);
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
            new THREE.MeshBasicMaterial({ color: "#000000", transparent: true, opacity: 0.25, depthWrite: false, side: THREE.DoubleSide })
        );
        treeShadow.renderOrder = 10;
        treeShadow.rotation.x = -Math.PI / 2;
        treeShadow.position.set(tree.x, 0.005, tree.z);
        treeShadow.name = "tree";
        treeShadow.userData.treeX = tree.x;
        treeShadow.userData.treeZ = tree.z;
        treeShadow.userData.isShadow = true;
        treeShadow.visible = false;
        scene.add(treeShadow);
        treeMeshes.push(treeShadow);
        treePartMeshes.push(treeShadow);
    });

    const { columnGroups, columnMeshes } = buildDecorationsScene(
        scene,
        area.decorations,
        registerFogOccluderMesh
    );

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
            depthWrite: false,
            side: THREE.DoubleSide
        });

        const doorData: DoorMesh["userData"] = { transition };
        const doorMesh = attachUserData(new THREE.Mesh(
            new THREE.BoxGeometry(doorWidth, 2.2, doorDepth),
            doorMat
        ), doorData);

        doorMesh.position.set(
            transition.x + transition.w / 2,
            1.1,
            transition.z + transition.h / 2
        );
        doorMesh.name = "door";
        scene.add(doorMesh);
        doorMeshes.push(doorMesh);

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

    const waystoneMeshes: WaystoneMesh[] = [];
    if (area.waystones) {
        area.waystones.forEach((waystone, index) => {
            const waystoneGroup = new THREE.Group();
            waystoneGroup.position.set(waystone.x, 0, waystone.z);
            waystoneGroup.name = "waystone";

            const glowRing = new THREE.Mesh(
                new THREE.RingGeometry(0.5, 0.86, 28),
                new THREE.MeshBasicMaterial({
                    color: "#48b6ff",
                    transparent: true,
                    opacity: 0.2,
                    depthWrite: false,
                    side: THREE.DoubleSide,
                })
            );
            glowRing.rotation.x = -Math.PI / 2;
            glowRing.position.y = 0.035;
            glowRing.name = "waystone";
            waystoneGroup.add(glowRing);

            const floatGroup = new THREE.Group();
            const floatBaseY = 1.42;
            floatGroup.position.y = floatBaseY;
            floatGroup.name = "waystone";
            waystoneGroup.add(floatGroup);

            const crystalMaterial = new THREE.MeshStandardMaterial({
                color: "#7ad1ff",
                emissive: "#1e78ff",
                emissiveIntensity: 0.95,
                metalness: 0.08,
                roughness: 0.16,
                transparent: true,
                opacity: 0.94,
            });
            const crystal = new THREE.Mesh(
                new THREE.OctahedronGeometry(0.66, 0),
                crystalMaterial
            );
            crystal.scale.set(0.82, 1.42, 0.82);
            crystal.name = "waystone";
            floatGroup.add(crystal);

            const innerCrystal = new THREE.Mesh(
                new THREE.OctahedronGeometry(0.32, 0),
                new THREE.MeshStandardMaterial({
                    color: "#d9f2ff",
                    emissive: "#5ec8ff",
                    emissiveIntensity: 1.3,
                    metalness: 0.02,
                    roughness: 0.08,
                    transparent: true,
                    opacity: 0.82,
                })
            );
            innerCrystal.scale.set(0.78, 1.55, 0.78);
            innerCrystal.name = "waystone";
            floatGroup.add(innerCrystal);

            const pointLight = new THREE.PointLight("#4fb6ff", 1.8, 8.5, 1.75);
            pointLight.position.set(0, 0.1, 0);
            pointLight.userData.baseIntensity = 1.8;
            pointLight.userData.flickerStrength = 0;
            pointLight.userData.lightRole = "area";
            floatGroup.add(pointLight);
            candleLights.push(pointLight);

            const waystoneData: WaystoneMesh["userData"] = {
                waystone,
                waystoneIndex: index,
                floatGroup,
                floatBaseY,
                floatPhase: index * 0.9,
                glowRing,
                pointLight,
            };
            const typedWaystoneGroup = attachUserData(waystoneGroup, waystoneData);
            glowRing.userData = waystoneData;
            floatGroup.userData = waystoneData;
            crystal.userData = waystoneData;
            innerCrystal.userData = waystoneData;
            pointLight.userData = { ...pointLight.userData, ...waystoneData };

            scene.add(typedWaystoneGroup);
            waystoneMeshes.push(typedWaystoneGroup);
        });
    }

    // Secret doors - wall segment with cracks that gets removed when clicked
    const secretDoorMeshes: SecretDoorMesh[] = [];
    if (area.secretDoors) {
        area.secretDoors.forEach((secretDoor, index) => {
            const group = new THREE.Group();
            const secretDoorData: SecretDoorMesh["userData"] = { secretDoor, secretDoorIndex: index };
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

            const typedGroup = attachUserData(group, secretDoorData);
            scene.add(typedGroup);
            secretDoorMeshes.push(typedGroup);
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
    const totalGridLines = area.gridHeight + area.gridWidth + 2;
    const gridPositions = new Float32Array(totalGridLines * 2 * 3);
    let gridOffset = 0;
    // Horizontal lines (along X axis, varying Z)
    for (let z = 0; z <= area.gridHeight; z++) {
        gridPositions[gridOffset++] = 0;
        gridPositions[gridOffset++] = gridY;
        gridPositions[gridOffset++] = z;
        gridPositions[gridOffset++] = area.gridWidth;
        gridPositions[gridOffset++] = gridY;
        gridPositions[gridOffset++] = z;
    }
    // Vertical lines (along Z axis, varying X)
    for (let x = 0; x <= area.gridWidth; x++) {
        gridPositions[gridOffset++] = x;
        gridPositions[gridOffset++] = gridY;
        gridPositions[gridOffset++] = 0;
        gridPositions[gridOffset++] = x;
        gridPositions[gridOffset++] = gridY;
        gridPositions[gridOffset++] = area.gridHeight;
    }
    const gridGeometry = new THREE.BufferGeometry();
    gridGeometry.setAttribute("position", new THREE.BufferAttribute(gridPositions, 3));
    const gridLines = new THREE.LineSegments(gridGeometry, gridMat);
    setStaticRenderTier(gridLines, "grid");
    scene.add(gridLines);

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

    if (hasRainEffect) {
        const rainTexture = createRainTexture();
        const rainMaterial = new THREE.MeshBasicMaterial({
            map: rainTexture,
            color: "#d9e5ec",
            transparent: true,
            opacity: 0.84,
            depthWrite: false,
            toneMapped: false,
            fog: false
        });
        rainMaterial.depthTest = false;

        rainOverlay = new THREE.Mesh(
            new THREE.PlaneGeometry(1, 1),
            rainMaterial
        );
        rainOverlay.name = "rainOverlay";
        rainOverlay.renderOrder = RENDER_ORDER_FOG - 4;
        rainOverlay.frustumCulled = false;
        scene.add(rainOverlay);
    }

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
    const hpBarGroups: Record<number, THREE.Group> = {};

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
        if (result.hpBarGroup) {
            hpBarGroups[unit.id] = result.hpBarGroup;
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
        waystoneMeshes,
        secretDoorMeshes,
        waterMesh,
        rainOverlay,
        chestMeshes,
        billboards,
        hpBarGroups,
    };
}

