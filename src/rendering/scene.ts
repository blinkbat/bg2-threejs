// =============================================================================
// THREE.JS SCENE SETUP
// =============================================================================

import * as THREE from "three";
import { GRID_SIZE } from "../core/constants";
import { getCurrentArea, getComputedAreaData, type AreaTransition } from "../game/areas";
import { getUnitStats } from "../game/units";
import type { Unit, UnitGroup, FogTexture } from "../core/types";

export interface DoorMesh extends THREE.Mesh {
    userData: {
        transition: AreaTransition;
    };
}

export interface SceneRefs {
    scene: THREE.Scene;
    camera: THREE.OrthographicCamera;
    renderer: THREE.WebGLRenderer;
    flames: THREE.Mesh[];
    candleLights: THREE.PointLight[];
    fogTexture: FogTexture;
    fogMesh: THREE.Mesh;
    moveMarker: THREE.Mesh;
    rangeIndicator: THREE.Mesh;
    aoeIndicator: THREE.Mesh;
    unitGroups: Record<number, UnitGroup>;
    selectRings: Record<number, THREE.Mesh>;
    unitMeshes: Record<number, THREE.Mesh>;
    unitOriginalColors: Record<number, THREE.Color>;
    maxHp: Record<number, number>;
    wallMeshes: THREE.Mesh[];
    doorMeshes: DoorMesh[];
}

export function createScene(container: HTMLDivElement, units: Unit[]): SceneRefs {
    const area = getCurrentArea();
    const computed = getComputedAreaData();

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(area.backgroundColor);

    const aspect = container.clientWidth / container.clientHeight;
    const camera = new THREE.OrthographicCamera(-15 * aspect, 15 * aspect, 15, -15, 0.1, 1000);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);

    // Lighting - use area settings
    scene.add(new THREE.AmbientLight(0xffffff, area.ambientLight));
    const dir = new THREE.DirectionalLight(0xffffff, area.directionalLight);
    dir.position.set(10, 20, 10);
    scene.add(dir);

    // Ground - base layer for non-room areas (corridors, etc)
    const groundMat = new THREE.MeshStandardMaterial({ color: area.groundColor, metalness: 0.2, roughness: 0.9 });
    const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(GRID_SIZE, GRID_SIZE),
        groundMat
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(GRID_SIZE / 2, 0, GRID_SIZE / 2);
    ground.name = "ground";
    scene.add(ground);

    // Room floors - slightly above ground to avoid z-fighting, same material properties
    area.roomFloors.forEach(r => {
        const floorMat = new THREE.MeshStandardMaterial({ color: r.color, metalness: 0.2, roughness: 0.9 });
        const floor = new THREE.Mesh(
            new THREE.PlaneGeometry(r.w, r.h),
            floorMat
        );
        floor.rotation.x = -Math.PI / 2;
        floor.position.set(r.x + r.w / 2, 0.001, r.z + r.h / 2);  // Tiny offset instead of polygonOffset
        floor.name = "ground";
        scene.add(floor);
    });

    // Torches with flames and lights (only in areas with candles)
    const flames: THREE.Mesh[] = [];
    const candleLights: THREE.PointLight[] = [];
    computed.candlePositions.forEach((pos) => {
        const candle = new THREE.Mesh(
            new THREE.CylinderGeometry(0.06, 0.08, 0.3, 8),
            new THREE.MeshStandardMaterial({ color: "#e8d4a8", metalness: 0.1, roughness: 0.9 })
        );
        candle.position.set(pos.x + pos.dx * 0.3, 1.85, pos.z + pos.dz * 0.3);
        scene.add(candle);

        const flame = new THREE.Mesh(
            new THREE.SphereGeometry(0.08, 8, 8),
            new THREE.MeshBasicMaterial({ color: "#ffcc44", transparent: true, opacity: 0.85 })
        );
        flame.position.set(pos.x + pos.dx * 0.3, 2.05, pos.z + pos.dz * 0.3);
        flame.scale.y = 1.8;
        scene.add(flame);
        flames.push(flame);

        const light = new THREE.PointLight("#ffaa44", 15, 18, 1.5);
        light.position.set(pos.x + pos.dx * 0.3, 2.05, pos.z + pos.dz * 0.3);  // Same as flame
        scene.add(light);
        candleLights.push(light);
    });

    // Treasure chests from area data
    area.chests.forEach(chest => {
        const chestGroup = new THREE.Group();
        // Chest body (main box) - dark wood
        const chestBody = new THREE.Mesh(
            new THREE.BoxGeometry(0.9, 0.5, 0.6),
            new THREE.MeshStandardMaterial({ color: "#5c3a21", metalness: 0.2, roughness: 0.8 })
        );
        chestBody.position.y = 0.25;
        chestGroup.add(chestBody);
        // Chest lid - rounded top effect with slightly lighter wood
        const chestLid = new THREE.Mesh(
            new THREE.BoxGeometry(0.95, 0.25, 0.65),
            new THREE.MeshStandardMaterial({ color: "#6b4423", metalness: 0.2, roughness: 0.7 })
        );
        chestLid.position.y = 0.625;
        chestGroup.add(chestLid);
        // Gold buckle/clasp on front - highly metallic brass/gold
        const buckle = new THREE.Mesh(
            new THREE.BoxGeometry(0.2, 0.2, 0.08),
            new THREE.MeshStandardMaterial({ color: "#d4af37", emissive: "#8b7500", emissiveIntensity: 0.6, metalness: 1.0, roughness: 0.05 })
        );
        buckle.position.set(0, 0.4, 0.32);
        chestGroup.add(buckle);
        // Mark all chest parts as "chest" for raycasting
        chestBody.name = "chest";
        chestLid.name = "chest";
        buckle.name = "chest";
        chestGroup.position.set(chest.x, 0, chest.z);
        scene.add(chestGroup);
    });

    // Trees - simple cylinders for trunk + box for foliage
    area.trees.forEach(tree => {
        const treeGroup = new THREE.Group();
        const scale = tree.size;

        // Trunk - brown cylinder
        const trunkHeight = 1.5 * scale;
        const trunkRadius = 0.15 * scale;
        const trunk = new THREE.Mesh(
            new THREE.CylinderGeometry(trunkRadius, trunkRadius * 1.2, trunkHeight, 8),
            new THREE.MeshStandardMaterial({ color: "#4a3728", metalness: 0.1, roughness: 0.9 })
        );
        trunk.position.y = trunkHeight / 2;
        treeGroup.add(trunk);

        // Foliage - green box (simple, not fancy)
        const foliageSize = 1.2 * scale;
        const foliageHeight = 1.8 * scale;
        const foliage = new THREE.Mesh(
            new THREE.BoxGeometry(foliageSize, foliageHeight, foliageSize),
            new THREE.MeshStandardMaterial({ color: "#2d5a27", metalness: 0.0, roughness: 0.8 })
        );
        foliage.position.y = trunkHeight + foliageHeight / 2 - 0.2 * scale;
        treeGroup.add(foliage);

        // Mark as obstacle for raycasting
        trunk.name = "obstacle";
        foliage.name = "obstacle";

        treeGroup.position.set(tree.x, 0, tree.z);
        scene.add(treeGroup);
    });

    // Walls - with transparent support for unit occlusion
    const wallMeshes: THREE.Mesh[] = [];
    computed.mergedObstacles.forEach((o, i) => {
        const shade = 0x2d3748 + (i % 3) * 0x050505;
        const mesh = new THREE.Mesh(
            new THREE.BoxGeometry(o.w, 2.5, o.h),
            new THREE.MeshStandardMaterial({ color: shade, metalness: 0.2, roughness: 0.8, transparent: true, opacity: 1 })
        );
        mesh.position.set(o.x + o.w / 2, 1.25, o.z + o.h / 2);
        mesh.name = "obstacle";
        scene.add(mesh);
        wallMeshes.push(mesh);
    });

    // Doors - clickable transitions to other areas
    const doorMeshes: DoorMesh[] = [];
    area.transitions.forEach(transition => {
        // Create a subtle transparent portal
        // Door dimensions: w is always the wide part (parallel to wall), h is the thin part (perpendicular)
        // For north/south facing doors: width along X, depth along Z
        // For east/west facing doors: width along Z, depth along X
        const isNorthSouth = transition.direction === "north" || transition.direction === "south";
        const doorWidth = isNorthSouth ? transition.w : transition.h;
        const doorDepth = isNorthSouth ? transition.h : transition.w;

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
        const doorLight = new THREE.PointLight("#7ab0e0", 1.2, 6, 2);
        doorLight.position.set(
            transition.x + transition.w / 2,
            1.0,
            transition.z + transition.h / 2
        );
        scene.add(doorLight);
    });

    // Grid lines - subtle, above room floors
    const gridMat = new THREE.LineBasicMaterial({ color: "#444444", transparent: true, opacity: 0.25 });
    for (let i = 0; i <= GRID_SIZE; i++) {
        scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.002, i), new THREE.Vector3(GRID_SIZE, 0.002, i)]), gridMat));
        scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(i, 0.002, 0), new THREE.Vector3(i, 0.002, GRID_SIZE)]), gridMat));
    }

    // Fog of war
    const fogCanvas = document.createElement("canvas");
    fogCanvas.width = GRID_SIZE;
    fogCanvas.height = GRID_SIZE;
    const fogCtx = fogCanvas.getContext("2d")!;
    fogCtx.fillStyle = "#000";
    fogCtx.fillRect(0, 0, GRID_SIZE, GRID_SIZE);
    const fogTextureObj = new THREE.CanvasTexture(fogCanvas);
    fogTextureObj.magFilter = THREE.NearestFilter;
    fogTextureObj.minFilter = THREE.NearestFilter;
    const fogTexture: FogTexture = { canvas: fogCanvas, ctx: fogCtx, texture: fogTextureObj };

    const fogMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(GRID_SIZE, GRID_SIZE),
        new THREE.MeshBasicMaterial({ map: fogTextureObj, transparent: true, depthWrite: false })
    );
    fogMesh.rotation.x = -Math.PI / 2;
    fogMesh.position.set(GRID_SIZE / 2, 2.6, GRID_SIZE / 2);
    fogMesh.renderOrder = 999;
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
        new THREE.MeshBasicMaterial({ color: "#3b82f6", side: THREE.DoubleSide, transparent: true, opacity: 0.2 })
    );
    rangeIndicator.rotation.x = -Math.PI / 2;
    rangeIndicator.position.y = 0.02;
    rangeIndicator.visible = false;
    rangeIndicator.userData.radius = 10;
    scene.add(rangeIndicator);

    // AOE indicator
    const aoeIndicator = new THREE.Mesh(
        new THREE.RingGeometry(0.1, 2.5, 32),
        new THREE.MeshBasicMaterial({ color: "#ff4400", side: THREE.DoubleSide, transparent: true, opacity: 0.3 })
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
    const unitMeshes: Record<number, THREE.Mesh> = {};
    const unitOriginalColors: Record<number, THREE.Color> = {};
    const maxHp: Record<number, number> = {};

    units.forEach(unit => {
        const isPlayer = unit.team === "player";
        const data = getUnitStats(unit);
        const size = (!isPlayer && 'size' in data && data.size) ? data.size : 1;
        const group = new THREE.Group();


        const boxH = isPlayer ? 1 : (size > 1 ? 1.8 : 0.6);
        const boxW = 0.6 * size;
        const boxMat = new THREE.MeshStandardMaterial({ color: data.color, metalness: 0.5, roughness: 0.4 });
        const box = new THREE.Mesh(new THREE.BoxGeometry(boxW, boxH, boxW), boxMat);
        box.position.y = boxH / 2;
        box.userData.unitId = unit.id;
        group.add(box);
        unitMeshes[unit.id] = box;
        unitOriginalColors[unit.id] = new THREE.Color(data.color);

        // All units get subtle innate light (enemies dimmer than players)
        const lightIntensity = isPlayer ? 0.15 : 0.08;
        const unitLight = new THREE.PointLight(data.color, lightIntensity, 2, 2);
        unitLight.position.y = boxH / 2;
        group.add(unitLight);

        const selInner = 0.5 * size;
        const selOuter = 0.55 * size;
        const sel = new THREE.Mesh(
            new THREE.RingGeometry(selInner, selOuter, 32),
            new THREE.MeshBasicMaterial({ color: "#00ff00", side: THREE.DoubleSide })
        );
        sel.rotation.x = -Math.PI / 2;
        sel.position.y = 0.03;
        sel.visible = false;
        group.add(sel);
        selectRings[unit.id] = sel;
        maxHp[unit.id] = data.maxHp;

        group.position.set(unit.x, 0, unit.z);
        group.userData = { unitId: unit.id, targetX: unit.x, targetZ: unit.z, attackTarget: null };
        scene.add(group);
        unitGroups[unit.id] = group as UnitGroup;
    });

    return {
        scene,
        camera,
        renderer,
        flames,
        candleLights,
        fogTexture,
        fogMesh,
        moveMarker,
        rangeIndicator,
        aoeIndicator,
        unitGroups,
        selectRings,
        unitMeshes,
        unitOriginalColors,
        maxHp,
        wallMeshes,
        doorMeshes,
    };
}

export function updateCamera(camera: THREE.OrthographicCamera, offset: { x: number; z: number }) {
    const d = 20;
    camera.position.set(offset.x + d, d, offset.z + d);
    camera.lookAt(offset.x, 0, offset.z);
}

// Opacity values for wall transparency
const WALL_OPACITY_NORMAL = 1.0;
const WALL_OPACITY_OCCLUDING = 0.25;
const WALL_OPACITY_LERP_SPEED = 0.15;  // How fast walls fade in/out

/**
 * Update wall transparency based on unit occlusion.
 * Walls that are between the camera and any unit become semi-transparent.
 */
export function updateWallTransparency(
    camera: THREE.OrthographicCamera,
    wallMeshes: THREE.Mesh[],
    unitGroups: Record<number, UnitGroup>,
    unitsState: Unit[]
): void {
    // Track which walls should be transparent this frame
    const occludingWalls = new Set<THREE.Mesh>();

    // For each alive unit, check if any wall is between camera and unit
    for (const unit of unitsState) {
        if (unit.hp <= 0) continue;
        const unitGroup = unitGroups[unit.id];
        if (!unitGroup || !unitGroup.visible) continue;

        // Get unit position in world space
        const unitPos = new THREE.Vector3(unitGroup.position.x, 0.5, unitGroup.position.z);

        // Direction from camera to unit
        const cameraPos = camera.position.clone();
        const dirToUnit = unitPos.clone().sub(cameraPos).normalize();

        // Check each wall for occlusion
        for (const wall of wallMeshes) {
            // Quick check: is wall roughly between camera and unit?
            // Use bounding box for efficiency
            const wallBox = new THREE.Box3().setFromObject(wall);

            // Create a ray from camera towards unit
            const ray = new THREE.Ray(cameraPos, dirToUnit);

            // Check if ray intersects wall bounding box
            const intersection = ray.intersectBox(wallBox, new THREE.Vector3());
            if (intersection) {
                // Check if intersection is between camera and unit
                const distToWall = cameraPos.distanceTo(intersection);
                const distToUnit = cameraPos.distanceTo(unitPos);

                if (distToWall < distToUnit) {
                    occludingWalls.add(wall);
                }
            }
        }
    }

    // Update wall opacities with smooth lerping
    for (const wall of wallMeshes) {
        const mat = wall.material as THREE.MeshStandardMaterial;
        const targetOpacity = occludingWalls.has(wall) ? WALL_OPACITY_OCCLUDING : WALL_OPACITY_NORMAL;

        // Lerp towards target opacity
        mat.opacity = mat.opacity + (targetOpacity - mat.opacity) * WALL_OPACITY_LERP_SPEED;

        // Snap to target if very close (avoid floating point drift)
        if (Math.abs(mat.opacity - targetOpacity) < 0.01) {
            mat.opacity = targetOpacity;
        }
    }
}
