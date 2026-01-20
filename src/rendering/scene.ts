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
    treeMeshes: THREE.Mesh[];  // Tree foliage meshes for transparency
    doorMeshes: DoorMesh[];
}

export function createScene(container: HTMLDivElement, units: Unit[]): SceneRefs {
    const area = getCurrentArea();
    const computed = getComputedAreaData();

    const scene = new THREE.Scene();

    // Create sky gradient for all areas
    const canvas = document.createElement("canvas");
    canvas.width = 2;
    canvas.height = 256;
    const ctx = canvas.getContext("2d")!;
    const gradient = ctx.createLinearGradient(0, 0, 0, 256);

    if (area.id === "field") {
        // Darker blue gradient for outdoor field
        gradient.addColorStop(0, "#0a1520");    // Very dark blue at top
        gradient.addColorStop(0.5, "#1a3040");  // Dark blue-gray
        gradient.addColorStop(1, "#2a4a60");    // Medium dark blue at bottom (horizon)
    } else {
        // Dark slate to dark purple for dungeon
        gradient.addColorStop(0, "#1a1a2e");    // Dark purple at top
        gradient.addColorStop(0.5, "#16213e");  // Dark slate-purple
        gradient.addColorStop(1, "#1f2937");    // Dark slate at bottom
    }

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 2, 256);
    const skyTexture = new THREE.CanvasTexture(canvas);
    scene.background = skyTexture;

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

    // Trees - cylinders for trunk + cone for pyramidal foliage
    // Various green shades and brown trunks for variety
    const foliageColors = ["#228B22", "#2E8B57", "#3CB371", "#006400", "#32CD32", "#556B2F"];
    const trunkColors = ["#654321", "#8B4513", "#A0522D", "#5C4033", "#6F4E37"];
    const treeMeshes: THREE.Mesh[] = [];

    // Fog mesh Y position - trees in unexplored cells will be capped below this
    const FOG_Y = 2.6;

    area.trees.forEach((tree, i) => {
        const scale = tree.size;

        // Trunk - thick brown cylinder
        const trunkHeight = 1.2 * scale;
        const trunkRadius = 0.15 * scale;
        const trunkColor = trunkColors[i % trunkColors.length];
        const trunk = new THREE.Mesh(
            new THREE.CylinderGeometry(trunkRadius, trunkRadius * 1.3, trunkHeight, 8),
            new THREE.MeshStandardMaterial({ color: trunkColor, metalness: 0.0, roughness: 1.0, transparent: true, opacity: 1 })
        );
        trunk.position.set(tree.x, trunkHeight / 2, tree.z);
        trunk.name = "tree";
        // Store full dimensions for fog height capping
        trunk.userData.fullHeight = trunkHeight;
        trunk.userData.treeX = tree.x;
        trunk.userData.treeZ = tree.z;
        trunk.userData.isTrunk = true;
        scene.add(trunk);

        // Foliage - tall pyramidal cone with varied green colors
        const foliageRadius = 0.8 * scale;
        const foliageHeight = 2.5 * scale;
        const foliageColor = foliageColors[i % foliageColors.length];
        const foliage = new THREE.Mesh(
            new THREE.ConeGeometry(foliageRadius, foliageHeight, 8),
            new THREE.MeshStandardMaterial({ color: foliageColor, metalness: 0.0, roughness: 0.8, transparent: true, opacity: 1 })
        );
        // Store full Y position for restoration
        const fullFoliageY = trunkHeight + foliageHeight / 2;
        foliage.position.set(tree.x, fullFoliageY, tree.z);
        foliage.name = "tree";
        // Store full dimensions for fog height capping
        foliage.userData.fullY = fullFoliageY;
        foliage.userData.fullHeight = foliageHeight;
        foliage.userData.fullRadius = foliageRadius;
        foliage.userData.treeX = tree.x;
        foliage.userData.treeZ = tree.z;
        foliage.userData.isFoliage = true;
        foliage.userData.trunkHeight = trunkHeight;
        foliage.userData.fogY = FOG_Y;
        scene.add(foliage);

        // Track both trunk and foliage for transparency updates
        treeMeshes.push(trunk);
        treeMeshes.push(foliage);
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
        treeMeshes,
        doorMeshes,
    };
}

export function updateCamera(camera: THREE.OrthographicCamera, offset: { x: number; z: number }) {
    const d = 20;
    camera.position.set(offset.x + d, d, offset.z + d);
    camera.lookAt(offset.x, 0, offset.z);
}

// Opacity values for wall/tree transparency
const WALL_OPACITY_NORMAL = 1.0;
const WALL_OPACITY_OCCLUDING = 0.25;
const WALL_OPACITY_LERP_SPEED = 0.15;  // How fast walls fade in/out

/**
 * Update wall and tree transparency based on unit occlusion.
 * Walls/trees that are between the camera and any unit become semi-transparent.
 */
export function updateWallTransparency(
    camera: THREE.OrthographicCamera,
    wallMeshes: THREE.Mesh[],
    unitGroups: Record<number, UnitGroup>,
    unitsState: Unit[],
    treeMeshes?: THREE.Mesh[]
): void {
    // Combine walls and trees for occlusion checking
    const allOccluders = treeMeshes ? [...wallMeshes, ...treeMeshes] : wallMeshes;

    // Track which meshes should be transparent this frame
    const occludingMeshes = new Set<THREE.Mesh>();

    // For each alive unit, check if any wall/tree is between camera and unit
    for (const unit of unitsState) {
        if (unit.hp <= 0) continue;
        const unitGroup = unitGroups[unit.id];
        if (!unitGroup || !unitGroup.visible) continue;

        // Get unit position in world space
        const unitPos = new THREE.Vector3(unitGroup.position.x, 0.5, unitGroup.position.z);

        // Direction from camera to unit
        const cameraPos = camera.position.clone();
        const dirToUnit = unitPos.clone().sub(cameraPos).normalize();

        // Check each wall/tree for occlusion
        for (const mesh of allOccluders) {
            // Quick check: is mesh roughly between camera and unit?
            // Use bounding box for efficiency
            const meshBox = new THREE.Box3().setFromObject(mesh);

            // Create a ray from camera towards unit
            const ray = new THREE.Ray(cameraPos, dirToUnit);

            // Check if ray intersects mesh bounding box
            const intersection = ray.intersectBox(meshBox, new THREE.Vector3());
            if (intersection) {
                // Check if intersection is between camera and unit
                const distToMesh = cameraPos.distanceTo(intersection);
                const distToUnit = cameraPos.distanceTo(unitPos);

                if (distToMesh < distToUnit) {
                    occludingMeshes.add(mesh);
                }
            }
        }
    }

    // Update opacities with smooth lerping
    for (const mesh of allOccluders) {
        const mat = mesh.material as THREE.MeshStandardMaterial;
        const targetOpacity = occludingMeshes.has(mesh) ? WALL_OPACITY_OCCLUDING : WALL_OPACITY_NORMAL;

        // Lerp towards target opacity
        mat.opacity = mat.opacity + (targetOpacity - mat.opacity) * WALL_OPACITY_LERP_SPEED;

        // Snap to target if very close (avoid floating point drift)
        if (Math.abs(mat.opacity - targetOpacity) < 0.01) {
            mat.opacity = targetOpacity;
        }
    }
}

/**
 * Update tree heights based on fog of war visibility.
 * Trees in unexplored (vis=0) cells are cut below the fog layer.
 * Trees in seen or visible areas are shown at full height.
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
        const vis = visibility[tx]?.[tz] ?? 0;

        if (mesh.userData.isTrunk) {
            const fullHeight = mesh.userData.fullHeight as number;
            if (vis === 0) {
                // Unexplored - cap trunk below fog
                const cappedHeight = Math.min(fullHeight, MAX_HEIGHT_UNEXPLORED);
                mesh.scale.y = cappedHeight / fullHeight;
                mesh.position.y = cappedHeight / 2;
            } else {
                // Seen or visible - full height
                mesh.scale.y = 1;
                mesh.position.y = fullHeight / 2;
            }
        } else if (mesh.userData.isFoliage) {
            const fullY = mesh.userData.fullY as number;
            const fullHeight = mesh.userData.fullHeight as number;
            const trunkHeight = mesh.userData.trunkHeight as number;

            if (vis === 0) {
                // Unexplored - hide foliage if it would stick above fog
                const foliageBottom = fullY - fullHeight / 2;
                if (foliageBottom >= MAX_HEIGHT_UNEXPLORED) {
                    // Foliage entirely above fog - hide it
                    mesh.visible = false;
                } else {
                    // Partially clip foliage
                    mesh.visible = true;
                    const availableSpace = MAX_HEIGHT_UNEXPLORED - trunkHeight;
                    if (availableSpace <= 0) {
                        mesh.visible = false;
                    } else {
                        const scaleFactor = Math.min(1, availableSpace / fullHeight);
                        mesh.scale.y = scaleFactor;
                        mesh.position.y = trunkHeight + (fullHeight * scaleFactor) / 2;
                    }
                }
            } else {
                // Seen or visible - full height
                mesh.visible = true;
                mesh.scale.y = 1;
                mesh.position.y = fullY;
            }
        }
    }
}
