/**
 * Hook for initializing and managing the Three.js scene
 * Extracts scene setup logic from App.tsx for better organization
 */

import { useRef, useEffect, useState } from "react";
import * as THREE from "three";
import { getCurrentArea, getCurrentAreaId } from "../game/areas";
import type { Unit, FogTexture, Projectile, SwingAnimation, DamageText, UnitGroup, SanctuaryTile, HolyTile, SmokeTile, FireTile } from "../core/types";
import type { AcidTile, LootBag } from "../core/types";
import { createScene, updateChestStates, updateCamera, type DoorMesh, type WaystoneMesh, type SecretDoorMesh, type ChestMeshData } from "../rendering/scene";
import { disposeLoadedTextures } from "../rendering/scene/units";
import { resetFogCache, resetSpriteFacing, clearChargeAttacks, clearFireBreaths, clearCurses, clearGlares, clearLeaps, clearTentacles, clearShadePhases, clearSubmergedKrakens, resetLootBagIds, resetProjectileState } from "../gameLoop";
import { resetAllBroodMotherScreeches, resetAllEnemyKiteCooldowns, resetAllEnemyKitingState } from "../game/enemyState";
import { resetAllMovementState } from "../ai/movement";
import { resetVisibilityTracking } from "../ai/pathfinding";
import { resetBarks } from "../combat/barks";
import { loadFogVisibility, saveFogVisibility } from "../game/fogMemory";
import { clearEffectAnimations } from "../core/effectScheduler";

/** All refs needed for Three.js scene management */
export interface ThreeSceneState {
    // Core Three.js objects
    scene: THREE.Scene | null;
    camera: THREE.OrthographicCamera | null;
    renderer: THREE.WebGLRenderer | null;

    // Visual elements
    flames: THREE.Mesh[];
    candleMeshes: THREE.Mesh[];
    candleLights: THREE.Light[];
    fogTexture: FogTexture | null;
    fogMesh: THREE.Mesh | null;
    moveMarker: THREE.Mesh | null;
    rangeIndicator: THREE.Mesh | null;
    aoeIndicator: THREE.Mesh | null;

    // Unit-related
    unitGroups: Record<number, UnitGroup>;
    selectRings: Record<number, THREE.Mesh>;
    targetRings: Record<number, THREE.Mesh>;
    shieldIndicators: Record<number, THREE.Mesh>;
    unitMeshes: Record<number, THREE.Mesh>;
    unitOriginalColors: Record<number, THREE.Color>;
    maxHp: Record<number, number>;

    // Environment
    wallMeshes: THREE.Mesh[];
    treeMeshes: THREE.Mesh[];
    fogOccluderMeshes: THREE.Mesh[];
    columnMeshes: THREE.Mesh[];
    columnGroups: THREE.Mesh[][];
    doorMeshes: DoorMesh[];
    waystoneMeshes: WaystoneMesh[];
    secretDoorMeshes: SecretDoorMesh[];
    waterMesh: THREE.Object3D | null;
    rainOverlay: THREE.Mesh | null;
    chestMeshes: ChestMeshData[];
    billboards: THREE.Mesh[];
}

/** Mutable refs for game state that persists across frames */
export interface GameRefs {
    // Timing
    targetRingTimers: Record<number, number>;
    moveMarkerStart: number;
    moveStart: Record<number, { time: number; x: number; z: number }>;

    // Combat
    actionCooldown: Record<number, number>;
    hitFlash: Record<number, number>;
    projectiles: Projectile[];
    swingAnimations: SwingAnimation[];
    damageTexts: DamageText[];

    // Pathing
    paths: Record<number, { x: number; z: number }[]>;

    // Visibility
    visibility: number[][];

    // Environment state
    acidTiles: Map<string, AcidTile>;
    sanctuaryTiles: Map<string, SanctuaryTile>;
    holyTiles: Map<string, HolyTile>;
    smokeTiles: Map<string, SmokeTile>;
    fireTiles: Map<string, FireTile>;
    lootBags: LootBag[];
    hoveredDoor: string | null;

    // Camera
    cameraOffset: { x: number; z: number };
    zoomLevel: number;

    // Debug
    debugGrid: THREE.Group | null;
}

interface UseThreeSceneOptions {
    containerRef: React.RefObject<HTMLDivElement | null>;
    units: Unit[];
    openedChests: Set<string>;
    initialCameraOffset: { x: number; z: number };
    skipNextFogSaveOnUnmountRef: React.MutableRefObject<boolean>;
}

interface UseThreeSceneResult {
    sceneState: ThreeSceneState;
    gameRefs: React.MutableRefObject<GameRefs>;
    isInitialized: boolean;
}

function createEmptySceneState(): ThreeSceneState {
    return {
        scene: null,
        camera: null,
        renderer: null,
        flames: [],
        candleMeshes: [],
        candleLights: [],
        fogTexture: null,
        fogMesh: null,
        moveMarker: null,
        rangeIndicator: null,
        aoeIndicator: null,
        unitGroups: {},
        selectRings: {},
        targetRings: {},
        shieldIndicators: {},
        unitMeshes: {},
        unitOriginalColors: {},
        maxHp: {},
        wallMeshes: [],
        treeMeshes: [],
        fogOccluderMeshes: [],
        columnMeshes: [],
        columnGroups: [],
        doorMeshes: [],
        waystoneMeshes: [],
        secretDoorMeshes: [],
        waterMesh: null,
        rainOverlay: null,
        chestMeshes: [],
        billboards: []
    };
}

const MATERIAL_TEXTURE_KEYS = [
    "map",
    "alphaMap",
    "aoMap",
    "bumpMap",
    "displacementMap",
    "emissiveMap",
    "envMap",
    "lightMap",
    "metalnessMap",
    "normalMap",
    "roughnessMap",
    "specularMap",
] as const;

function disposeCanvasTexture(texture: THREE.Texture, disposedTextures: Set<THREE.Texture>): void {
    if (!(texture instanceof THREE.CanvasTexture)) return;
    if (disposedTextures.has(texture)) return;
    disposedTextures.add(texture);
    texture.dispose();
}

function asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== "object") return null;
    return value as Record<string, unknown>;
}

function disposeMaterial(
    material: THREE.Material,
    disposedMaterials: Set<THREE.Material>,
    disposedTextures: Set<THREE.Texture>
): void {
    if (disposedMaterials.has(material)) return;
    disposedMaterials.add(material);

    for (const key of MATERIAL_TEXTURE_KEYS) {
        const texture = Reflect.get(material, key);
        if (texture instanceof THREE.Texture) {
            disposeCanvasTexture(texture, disposedTextures);
        }
    }

    material.dispose();
}

function disposeSceneResources(scene: THREE.Scene): void {
    const disposedGeometries = new Set<THREE.BufferGeometry>();
    const disposedMaterials = new Set<THREE.Material>();
    const disposedTextures = new Set<THREE.Texture>();

    scene.traverse((object: THREE.Object3D) => {
        if (!(object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points)) {
            return;
        }

        const geometry = object.geometry;
        if (geometry && !disposedGeometries.has(geometry)) {
            disposedGeometries.add(geometry);
            geometry.dispose();
        }

        const material = object.material;
        if (Array.isArray(material)) {
            material.forEach(mat => disposeMaterial(mat, disposedMaterials, disposedTextures));
        } else if (material) {
            disposeMaterial(material, disposedMaterials, disposedTextures);
        }
    });

    if (scene.background instanceof THREE.Texture) {
        disposeCanvasTexture(scene.background, disposedTextures);
    }
    if (scene.environment instanceof THREE.Texture) {
        disposeCanvasTexture(scene.environment, disposedTextures);
    }

    const sceneData = asRecord(scene.userData);
    const lightningBackground = asRecord(sceneData?.lightningBackground);
    const lightningTextures = lightningBackground?.textures;
    if (Array.isArray(lightningTextures)) {
        for (const texture of lightningTextures) {
            if (texture instanceof THREE.Texture) {
                disposeCanvasTexture(texture, disposedTextures);
            }
        }
    }

    scene.clear();
}

/**
 * Initialize and manage the Three.js scene
 * Handles scene creation, cleanup, and provides refs for game state
 */
export function useThreeScene({
    containerRef,
    units,
    openedChests,
    initialCameraOffset,
    skipNextFogSaveOnUnmountRef,
}: UseThreeSceneOptions): UseThreeSceneResult {
    const initialArea = getCurrentArea();
    const initialAreaId = getCurrentAreaId();

    // Scene state
    const [sceneState, setSceneState] = useState<ThreeSceneState>(() => createEmptySceneState());
    const initialUnitsRef = useRef<Unit[]>(units);
    const initialOpenedChestsRef = useRef<Set<string>>(openedChests);

    // Game state refs (mutable values that persist across frames)
    const gameRefsRef = useRef<GameRefs>({
        targetRingTimers: {},
        moveMarkerStart: 0,
        moveStart: {},
        actionCooldown: {},
        hitFlash: {},
        projectiles: [],
        swingAnimations: [],
        damageTexts: [],
        paths: {},
        visibility: loadFogVisibility(initialAreaId, initialArea.gridWidth, initialArea.gridHeight),
        acidTiles: new Map(),
        sanctuaryTiles: new Map(),
        holyTiles: new Map(),
        smokeTiles: new Map(),
        fireTiles: new Map(),
        lootBags: [],
        hoveredDoor: null,
        cameraOffset: { ...initialCameraOffset },
        zoomLevel: 12,
        debugGrid: null
    });

    const [isInitialized, setIsInitialized] = useState(false);

    // Initialize scene
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        const areaIdAtMount = getCurrentAreaId();

        // Reset module-level caches and runtime state for this scene mount
        resetFogCache();
        resetSpriteFacing();
        disposeLoadedTextures();
        resetAllBroodMotherScreeches();
        resetAllEnemyKiteCooldowns();
        resetAllEnemyKitingState();
        resetAllMovementState();
        resetVisibilityTracking();
        resetBarks();
        clearEffectAnimations();

        // Clear local refs that persist between game sessions
        const gameRefs = gameRefsRef.current;
        gameRefs.zoomLevel = 12;
        gameRefs.targetRingTimers = {};
        gameRefs.hitFlash = {};
        gameRefs.moveStart = {};
        gameRefs.actionCooldown = {};
        gameRefs.paths = {};
        gameRefs.acidTiles.clear();
        gameRefs.sanctuaryTiles.clear();
        gameRefs.holyTiles.clear();
        gameRefs.smokeTiles.clear();
        gameRefs.fireTiles.clear();
        clearChargeAttacks();
        clearFireBreaths();
        clearCurses();
        clearGlares();
        clearLeaps();
        clearTentacles();
        clearShadePhases();
        clearSubmergedKrakens();
        resetProjectileState();
        gameRefs.lootBags = [];
        resetLootBagIds();
        gameRefs.damageTexts = [];
        gameRefs.projectiles = [];
        gameRefs.swingAnimations = [];

        // Create the scene
        const sceneRefs = createScene(container, initialUnitsRef.current);

        // Populate scene state
        const initializedState: ThreeSceneState = {
            scene: sceneRefs.scene,
            camera: sceneRefs.camera,
            renderer: sceneRefs.renderer,
            flames: sceneRefs.flames,
            candleMeshes: sceneRefs.candleMeshes,
            candleLights: sceneRefs.candleLights,
            fogTexture: sceneRefs.fogTexture,
            fogMesh: sceneRefs.fogMesh,
            moveMarker: sceneRefs.moveMarker,
            rangeIndicator: sceneRefs.rangeIndicator,
            aoeIndicator: sceneRefs.aoeIndicator,
            unitGroups: sceneRefs.unitGroups,
            selectRings: sceneRefs.selectRings,
            targetRings: sceneRefs.targetRings,
            shieldIndicators: sceneRefs.shieldIndicators,
            unitMeshes: sceneRefs.unitMeshes,
            unitOriginalColors: sceneRefs.unitOriginalColors,
            maxHp: sceneRefs.maxHp,
            wallMeshes: sceneRefs.wallMeshes,
            treeMeshes: sceneRefs.treeMeshes,
            fogOccluderMeshes: sceneRefs.fogOccluderMeshes,
            columnMeshes: sceneRefs.columnMeshes,
            columnGroups: sceneRefs.columnGroups,
            doorMeshes: sceneRefs.doorMeshes,
            waystoneMeshes: sceneRefs.waystoneMeshes,
            secretDoorMeshes: sceneRefs.secretDoorMeshes,
            waterMesh: sceneRefs.waterMesh,
            rainOverlay: sceneRefs.rainOverlay,
            chestMeshes: sceneRefs.chestMeshes,
            billboards: sceneRefs.billboards
        };
        setSceneState(initializedState);

        // Initialize unit paths
        initialUnitsRef.current.forEach(unit => {
            gameRefs.paths[unit.id] = [];
        });

        // Apply initial chest open states
        updateChestStates(initializedState.chestMeshes, initialOpenedChestsRef.current);

        // Apply initial zoom and camera position
        const camera = initializedState.camera;
        if (camera) {
            const aspect = container.clientWidth / container.clientHeight;
            camera.left = -gameRefs.zoomLevel * aspect;
            camera.right = gameRefs.zoomLevel * aspect;
            camera.top = gameRefs.zoomLevel;
            camera.bottom = -gameRefs.zoomLevel;
            camera.updateProjectionMatrix();
            updateCamera(camera, gameRefs.cameraOffset);
        }

        setIsInitialized(true);

        // Cleanup
        return () => {
            if (skipNextFogSaveOnUnmountRef.current) {
                skipNextFogSaveOnUnmountRef.current = false;
            } else {
                saveFogVisibility(areaIdAtMount, gameRefs.visibility);
            }
            clearEffectAnimations();
            disposeSceneResources(sceneRefs.scene);
            if (sceneRefs.renderer) {
                sceneRefs.renderer.dispose();
                if (sceneRefs.renderer.domElement.parentElement === container) {
                    container.removeChild(sceneRefs.renderer.domElement);
                }
            }
            setSceneState(createEmptySceneState());
            setIsInitialized(false);
        };
    }, [containerRef, skipNextFogSaveOnUnmountRef]); // Refs are stable; this still initializes once per mount

    return { sceneState, gameRefs: gameRefsRef, isInitialized };
}
