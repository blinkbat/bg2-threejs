// =============================================================================
// SCENE TYPES - Interfaces for scene creation and references
// =============================================================================

import * as THREE from "three";
import type { AreaTransition, SecretDoor, Waystone } from "../../game/areas";
import type { UnitGroup, FogTexture } from "../../core/types";

export interface WallAttachmentMesh extends THREE.Mesh {
    userData: {
        parentWall: THREE.Mesh;
        baseOpacity: number;
    };
}

export interface DoorMesh extends THREE.Mesh {
    userData: {
        transition: AreaTransition;
    };
}

export interface SecretDoorMesh extends THREE.Group {
    userData: {
        secretDoor: SecretDoor;
        secretDoorIndex: number;
    };
}

export interface WaystoneMesh extends THREE.Group {
    userData: {
        waystone: Waystone;
        waystoneIndex: number;
        floatGroup: THREE.Group;
        floatBaseY: number;
        floatPhase: number;
        glowRing: THREE.Mesh;
        pointLight: THREE.PointLight;
    };
}

export interface ChestMeshData {
    lidPivot: THREE.Group;  // Pivot point for lid rotation
    buckle: THREE.Mesh;     // Buckle to hide when open
    chestKey: string;       // "areaId-index" key for tracking
}

export interface SceneRefs {
    scene: THREE.Scene;
    camera: THREE.OrthographicCamera;
    renderer: THREE.WebGLRenderer;
    flames: THREE.Mesh[];
    candleMeshes: THREE.Mesh[];  // Candle body meshes for occlusion transparency
    candleLights: THREE.Light[];
    fogTexture: FogTexture;
    fogMesh: THREE.Mesh;
    moveMarker: THREE.Mesh;
    rangeIndicator: THREE.Mesh;
    aoeIndicator: THREE.Mesh;
    unitGroups: Record<number, UnitGroup>;
    selectRings: Record<number, THREE.Mesh>;
    targetRings: Record<number, THREE.Mesh>;  // Red rings for targeted enemies
    shieldIndicators: Record<number, THREE.Mesh>;  // Front shield facing indicators
    unitMeshes: Record<number, THREE.Mesh>;
    unitOriginalColors: Record<number, THREE.Color>;
    maxHp: Record<number, number>;
    wallMeshes: THREE.Mesh[];
    wallAttachments: WallAttachmentMesh[];  // Vines/tapestries hung on wall faces
    treeMeshes: THREE.Mesh[];  // Tree foliage meshes for transparency
    fogOccluderMeshes: THREE.Mesh[];  // Tall non-tree meshes clipped under unexplored fog
    columnMeshes: THREE.Mesh[];  // Column meshes for transparency
    columnGroups: THREE.Mesh[][];  // Groups of column parts (body, base, capital) that fade together
    doorMeshes: DoorMesh[];
    waystoneMeshes: WaystoneMesh[];
    secretDoorMeshes: SecretDoorMesh[];  // Hidden doors that reveal caves when clicked
    waterMesh: THREE.Object3D | null;  // Animated liquid tiles (water/lava)
    rainOverlay: THREE.Mesh | null;  // Lightweight camera-facing weather overlay
    chestMeshes: ChestMeshData[];  // Chest lid pivots for open/close animation
    billboards: THREE.Mesh[];  // Billboard meshes that face the camera
    hpBarGroups: Record<number, THREE.Group>;  // Player HP bar billboard groups
}
