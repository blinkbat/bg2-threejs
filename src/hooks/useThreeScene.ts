/**
 * Hook for initializing and managing the Three.js scene
 * Extracts scene setup logic from App.tsx for better organization
 */

import { useRef, useEffect, useState } from "react";
import * as THREE from "three";
import { getCurrentArea } from "../game/areas";
import type { Unit, FogTexture, Projectile, SwingAnimation, DamageText, UnitGroup, SanctuaryTile } from "../core/types";
import type { AcidTile, LootBag } from "../core/types";
import { createScene, updateChestStates, updateCamera, type DoorMesh, type SecretDoorMesh, type ChestMeshData } from "../rendering/scene";
import { resetFogCache, resetSpriteFacing, clearChargeAttacks, clearCurses, clearGlares, clearLeaps, clearTentacles, resetLootBagIds } from "../gameLoop";
import { resetAllBroodMotherScreeches } from "../game/enemyState";
import { resetBarks } from "../combat/barks";
import { initializeEquipmentState } from "../game/equipmentState";

/** All refs needed for Three.js scene management */
export interface ThreeSceneState {
    // Core Three.js objects
    scene: THREE.Scene | null;
    camera: THREE.OrthographicCamera | null;
    renderer: THREE.WebGLRenderer | null;

    // Visual elements
    flames: THREE.Mesh[];
    candleMeshes: THREE.Mesh[];
    candleLights: THREE.PointLight[];
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
    columnMeshes: THREE.Mesh[];
    columnGroups: THREE.Mesh[][];
    doorMeshes: DoorMesh[];
    secretDoorMeshes: SecretDoorMesh[];
    waterMesh: THREE.Mesh | null;
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
    lootBags: LootBag[];
    hoveredDoor: string | null;

    // Camera
    cameraOffset: { x: number; z: number };
    zoomLevel: number;

    // Debug
    debugGrid: THREE.Group | null;
}

export interface UseThreeSceneOptions {
    containerRef: React.RefObject<HTMLDivElement | null>;
    units: Unit[];
    openedChests: Set<string>;
    initialCameraOffset: { x: number; z: number };
}

export interface UseThreeSceneResult {
    sceneState: ThreeSceneState;
    gameRefs: React.MutableRefObject<GameRefs>;
    isInitialized: boolean;
}

/**
 * Initialize and manage the Three.js scene
 * Handles scene creation, cleanup, and provides refs for game state
 */
export function useThreeScene({
    containerRef,
    units,
    openedChests,
    initialCameraOffset
}: UseThreeSceneOptions): UseThreeSceneResult {
    // Scene state ref (populated during initialization)
    const sceneStateRef = useRef<ThreeSceneState>({
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
        columnMeshes: [],
        columnGroups: [],
        doorMeshes: [],
        secretDoorMeshes: [],
        waterMesh: null,
        chestMeshes: [],
        billboards: []
    });

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
        visibility: Array(getCurrentArea().gridWidth).fill(null).map(() => Array(getCurrentArea().gridHeight).fill(0)),
        acidTiles: new Map(),
        sanctuaryTiles: new Map(),
        lootBags: [],
        hoveredDoor: null,
        cameraOffset: { ...initialCameraOffset },
        zoomLevel: 12,
        debugGrid: null
    });

    const [isInitialized, setIsInitialized] = useState(false);

    // Initialize scene
    useEffect(() => {
        if (!containerRef.current) return;

        // Reset module-level caches on game restart
        resetFogCache();
        resetSpriteFacing();
        resetAllBroodMotherScreeches();
        resetBarks();
        initializeEquipmentState();

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
        clearChargeAttacks();
        clearCurses();
        clearGlares();
        clearLeaps();
        clearTentacles();
        gameRefs.lootBags = [];
        resetLootBagIds();
        gameRefs.damageTexts = [];
        gameRefs.projectiles = [];
        gameRefs.swingAnimations = [];

        // Create the scene
        const sceneRefs = createScene(containerRef.current, units);

        // Populate scene state
        const state = sceneStateRef.current;
        state.scene = sceneRefs.scene;
        state.camera = sceneRefs.camera;
        state.renderer = sceneRefs.renderer;
        state.flames = sceneRefs.flames;
        state.candleMeshes = sceneRefs.candleMeshes;
        state.candleLights = sceneRefs.candleLights;
        state.fogTexture = sceneRefs.fogTexture;
        state.fogMesh = sceneRefs.fogMesh;
        state.moveMarker = sceneRefs.moveMarker;
        state.rangeIndicator = sceneRefs.rangeIndicator;
        state.aoeIndicator = sceneRefs.aoeIndicator;
        state.unitGroups = sceneRefs.unitGroups;
        state.selectRings = sceneRefs.selectRings;
        state.targetRings = sceneRefs.targetRings;
        state.shieldIndicators = sceneRefs.shieldIndicators;
        state.unitMeshes = sceneRefs.unitMeshes;
        state.unitOriginalColors = sceneRefs.unitOriginalColors;
        state.maxHp = sceneRefs.maxHp;
        state.wallMeshes = sceneRefs.wallMeshes;
        state.treeMeshes = sceneRefs.treeMeshes;
        state.columnMeshes = sceneRefs.columnMeshes;
        state.columnGroups = sceneRefs.columnGroups;
        state.doorMeshes = sceneRefs.doorMeshes;
        state.secretDoorMeshes = sceneRefs.secretDoorMeshes;
        state.waterMesh = sceneRefs.waterMesh;
        state.chestMeshes = sceneRefs.chestMeshes;
        state.billboards = sceneRefs.billboards;

        // Initialize unit paths
        units.forEach(unit => {
            gameRefs.paths[unit.id] = [];
        });

        // Apply initial chest open states
        updateChestStates(state.chestMeshes, openedChests);

        // Apply initial zoom and camera position
        const camera = state.camera;
        const container = containerRef.current;
        if (camera && container) {
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
            if (state.renderer) {
                state.renderer.dispose();
                containerRef.current?.removeChild(state.renderer.domElement);
            }
            setIsInitialized(false);
        };
    }, []); // Only run once on mount

    return {
        sceneState: sceneStateRef.current,
        gameRefs: gameRefsRef,
        isInitialized
    };
}
