// =============================================================================
// THREE.JS SCENE SETUP - Main entry point
// =============================================================================

import * as THREE from "three";
import { GRID_SIZE, FOG_SCALE } from "../../core/constants";
import { getCurrentArea, getComputedAreaData } from "../../game/areas";
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
    updateTreeFogVisibility
} from "./updates";

// Re-export unit functions
export { getEffectiveSize, addUnitToScene, createUnitSceneGroup } from "./units";
import { createUnitSceneGroup } from "./units";

// =============================================================================
// MAIN SCENE CREATION
// =============================================================================

export function createScene(container: HTMLDivElement, units: Unit[]): SceneRefs {
    const area = getCurrentArea();
    const computed = getComputedAreaData();

    const scene = new THREE.Scene();

    // Create sky background - gradient for both outdoor and dungeon
    const canvas = document.createElement("canvas");
    canvas.width = 2;
    canvas.height = 256;
    const ctx = canvas.getContext("2d")!;
    const gradient = ctx.createLinearGradient(0, 0, 0, 256);
    if (area.id === "forest") {
        gradient.addColorStop(0, "#0a1520");    // Very dark blue at top
        gradient.addColorStop(0.5, "#1a3040");  // Dark blue-gray
        gradient.addColorStop(1, "#2a4a60");    // Medium dark blue at bottom (horizon)
    } else {
        // Dungeon gradient - very dark with subtle color variation
        gradient.addColorStop(0, "#020204");    // Almost black at top
        gradient.addColorStop(0.5, "#050508");  // Very dark blue-gray
        gradient.addColorStop(1, "#08080c");    // Slightly lighter at bottom
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
    // For coast, detect water floors by color and skip them (we'll create animated water instead)
    const waterColors = ["#5f9ea0", "#4682b4"];  // Shallow and deep water colors
    let waterMesh: THREE.Mesh | null = null;

    // Lava colors that should render higher for visibility
    const lavaColors = ["#ff4500", "#ff5500", "#ff6600"];

    area.roomFloors.forEach(r => {
        // Skip water floors on coast - we'll render them with animated shader
        if (area.id === "coast" && waterColors.includes(r.color)) {
            return;
        }
        const isLava = lavaColors.includes(r.color.toLowerCase());
        const floorMat = new THREE.MeshStandardMaterial({
            color: r.color,
            metalness: isLava ? 0.1 : 0.2,
            roughness: isLava ? 0.4 : 0.9,
            emissive: isLava ? r.color : "#000000",
            emissiveIntensity: isLava ? 0.5 : 0
        });
        const floor = new THREE.Mesh(
            new THREE.PlaneGeometry(r.w, r.h),
            floorMat
        );
        floor.rotation.x = -Math.PI / 2;
        // Lava renders higher for guaranteed visibility above fog
        const yPos = isLava ? 0.05 : 0.001;
        floor.position.set(r.x + r.w / 2, yPos, r.z + r.h / 2);
        floor.name = "ground";
        scene.add(floor);
    });

    // Create water for coast area - gradient from shallow to deep
    if (area.id === "coast") {
        const waterW = 48;
        const waterH = 15;
        const waterX = 1;
        const waterZ = 1;

        // Create gradient texture using canvas
        const waterCanvas = document.createElement("canvas");
        waterCanvas.width = 1;
        waterCanvas.height = 256;
        const waterCtx = waterCanvas.getContext("2d")!;
        const waterGradient = waterCtx.createLinearGradient(0, 0, 0, 256);
        waterGradient.addColorStop(0, "#0a1820");   // Deep (far from shore) - very dark
        waterGradient.addColorStop(0.5, "#1a3a4a"); // Mid - dark blue
        waterGradient.addColorStop(1, "#4a8090");   // Shallow (near shore) - teal
        waterCtx.fillStyle = waterGradient;
        waterCtx.fillRect(0, 0, 1, 256);

        const waterTexture = new THREE.CanvasTexture(waterCanvas);
        const waterMat = new THREE.MeshBasicMaterial({ map: waterTexture });
        waterMesh = new THREE.Mesh(new THREE.PlaneGeometry(waterW, waterH), waterMat);
        waterMesh.rotation.x = -Math.PI / 2;
        waterMesh.position.set(waterX + waterW / 2, 0.002, waterZ + waterH / 2);
        waterMesh.name = "water";
        scene.add(waterMesh);
    }

    // Torches with flames and lights (only in areas with candles)
    // PERF OPTIMIZATION: Use 1 light per room instead of per-candle (~72 -> ~9 lights)
    const flames: THREE.Mesh[] = [];
    const candleMeshes: THREE.Mesh[] = [];  // Track candle bodies for occlusion fading
    const candleLights: THREE.PointLight[] = [];

    // Share materials across all candles for better batching
    // Each candle needs its own material instance for individual opacity control
    const baseCandleMat = { color: "#e8d4a8", metalness: 0.1, roughness: 0.9, transparent: true, opacity: 1 };
    const flameMat = new THREE.MeshBasicMaterial({ color: "#ffcc44", transparent: true, opacity: 0.85 });
    const candleGeo = new THREE.CylinderGeometry(0.06, 0.08, 0.3, 6);
    const flameGeo = new THREE.SphereGeometry(0.08, 4, 4);

    // Group candles by room and create 1 light per room (at room center)
    const roomLightsCreated = new Set<string>();

    computed.candlePositions.forEach((pos) => {
        // Each candle needs its own material for individual opacity
        const candleMat = new THREE.MeshStandardMaterial(baseCandleMat);
        const candle = new THREE.Mesh(candleGeo, candleMat);
        candle.position.set(pos.x + pos.dx * 0.3, 1.85, pos.z + pos.dz * 0.3);
        scene.add(candle);
        candleMeshes.push(candle);

        // Flame also needs own material for individual opacity
        const flameMatInstance = flameMat.clone();
        const flame = new THREE.Mesh(flameGeo, flameMatInstance);
        flame.position.set(pos.x + pos.dx * 0.3, 2.05, pos.z + pos.dz * 0.3);
        flame.scale.y = 1.8;
        scene.add(flame);
        flames.push(flame);

        // Find which room this candle belongs to and create 1 light per room
        for (const room of area.rooms) {
            // Check if candle is on this room's wall (within 2 cells of room boundary)
            const inRoomX = pos.x >= room.x - 2 && pos.x <= room.x + room.w + 1;
            const inRoomZ = pos.z >= room.z - 2 && pos.z <= room.z + room.h + 1;
            if (inRoomX && inRoomZ) {
                const roomKey = `${room.x},${room.z}`;
                if (!roomLightsCreated.has(roomKey)) {
                    roomLightsCreated.add(roomKey);
                    // Create 1 light at room center with larger radius to cover whole room
                    const roomCenterX = room.x + room.w / 2;
                    const roomCenterZ = room.z + room.h / 2;
                    const roomSize = Math.max(room.w, room.h);
                    const light = new THREE.PointLight("#ffaa44", 15, roomSize * 0.8, 1.5);
                    light.position.set(roomCenterX, 2.5, roomCenterZ);
                    scene.add(light);
                    candleLights.push(light);
                }
                break;
            }
        }
    });

    // Treasure chests from area data
    const chestMeshes: ChestMeshData[] = [];
    area.chests.forEach((chest, index) => {
        const chestGroup = new THREE.Group();
        // Chest body (main box) - dark wood
        const chestBody = new THREE.Mesh(
            new THREE.BoxGeometry(0.9, 0.5, 0.6),
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
            new THREE.BoxGeometry(0.95, 0.25, 0.65),
            new THREE.MeshStandardMaterial({ color: "#6b4423", metalness: 0.2, roughness: 0.7 })
        );
        chestLid.position.set(0, 0.125, 0.325);  // Offset from pivot point
        lidPivot.add(chestLid);

        // Gold buckle/clasp on front - highly metallic brass/gold
        const buckle = new THREE.Mesh(
            new THREE.BoxGeometry(0.2, 0.2, 0.08),
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
    const foliageColors = ["#228B22", "#2E8B57", "#3CB371", "#006400", "#32CD32", "#556B2F"];
    const trunkColors = ["#654321", "#8B4513", "#A0522D", "#5C4033", "#6F4E37"];
    const treeMeshes: THREE.Mesh[] = [];

    // Fog mesh Y position - trees in unexplored cells will be capped below this
    const FOG_Y = 2.6;

    // Tree size multiplier - forest trees are larger
    const treeSizeMultiplier = area.id === "forest" ? 1.5 : 1.0;

    area.trees.forEach((tree, i) => {
        const scale = tree.size * treeSizeMultiplier;

        // Taller trees are skinnier - use inverse relationship with randomness
        // skinnyFactor ranges from ~0.6 (for large trees) to ~1.0 (for small trees)
        const randomVariance = 0.85 + Math.random() * 0.3;  // 0.85-1.15 random multiplier
        const skinnyFactor = Math.min(1.0, (1.0 / Math.sqrt(scale)) * randomVariance);

        // Trunk - thick brown cylinder (skinnier for tall trees)
        const trunkHeight = 1.2 * scale;
        const trunkRadius = 0.15 * scale * skinnyFactor;
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

        // Foliage - tall pyramidal cone with varied green colors (skinnier for tall trees)
        const foliageRadius = 0.8 * scale * skinnyFactor;
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

        // Tree shadow - simple dark circle on ground
        const shadowRadius = foliageRadius * 0.9;
        const treeShadow = new THREE.Mesh(
            new THREE.CircleGeometry(shadowRadius, 16),
            new THREE.MeshBasicMaterial({ color: "#000000", transparent: true, opacity: 0.25, side: THREE.DoubleSide })
        );
        treeShadow.rotation.x = -Math.PI / 2;
        treeShadow.position.set(tree.x, 0.005, tree.z);
        scene.add(treeShadow);
        foliage.userData.trunkHeight = trunkHeight;
        foliage.userData.fogY = FOG_Y;
        scene.add(foliage);

        // Track both trunk and foliage for transparency updates
        treeMeshes.push(trunk);
        treeMeshes.push(foliage);
    });

    // Decorations - columns, broken walls, etc.
    const columnMeshes: THREE.Mesh[] = [];
    const columnGroups: THREE.Mesh[][] = [];  // Groups of column parts that fade together
    if (area.decorations) {
        area.decorations.forEach(dec => {
            const size = dec.size ?? 1;

            if (dec.type === "column") {
                // Full standing column - track for transparency
                const columnRadius = 0.3 * size;
                const columnHeight = 2.5 * size;
                const column = new THREE.Mesh(
                    new THREE.CylinderGeometry(columnRadius, columnRadius * 1.1, columnHeight, 12),
                    new THREE.MeshStandardMaterial({ color: "#8b8b7a", metalness: 0.1, roughness: 0.9, transparent: true })
                );
                column.position.set(dec.x, columnHeight / 2, dec.z);
                column.name = "decoration";
                scene.add(column);
                columnMeshes.push(column);

                // Column base
                const base = new THREE.Mesh(
                    new THREE.CylinderGeometry(columnRadius * 1.4, columnRadius * 1.5, 0.2, 12),
                    new THREE.MeshStandardMaterial({ color: "#7a7a6a", metalness: 0.1, roughness: 0.9, transparent: true })
                );
                base.position.set(dec.x, 0.1, dec.z);
                scene.add(base);
                columnMeshes.push(base);

                // Column capital (top)
                const capital = new THREE.Mesh(
                    new THREE.CylinderGeometry(columnRadius * 1.3, columnRadius, 0.25, 12),
                    new THREE.MeshStandardMaterial({ color: "#9a9a8a", metalness: 0.1, roughness: 0.9, transparent: true })
                );
                capital.position.set(dec.x, columnHeight, dec.z);
                scene.add(capital);
                columnMeshes.push(capital);

                // Group all parts of this column together for synchronized transparency
                columnGroups.push([column, base, capital]);
            } else if (dec.type === "broken_column") {
                // Broken/fallen column - shorter with debris
                const columnRadius = 0.3 * size;
                const columnHeight = (0.8 + Math.random() * 0.8) * size;  // Random broken height
                const column = new THREE.Mesh(
                    new THREE.CylinderGeometry(columnRadius * 0.9, columnRadius * 1.1, columnHeight, 12),
                    new THREE.MeshStandardMaterial({ color: "#7a7a6a", metalness: 0.1, roughness: 0.95 })
                );
                column.position.set(dec.x, columnHeight / 2, dec.z);
                column.name = "decoration";
                scene.add(column);

                // Column base (crumbled)
                const base = new THREE.Mesh(
                    new THREE.CylinderGeometry(columnRadius * 1.3, columnRadius * 1.5, 0.15, 8),
                    new THREE.MeshStandardMaterial({ color: "#6a6a5a", metalness: 0.1, roughness: 0.95 })
                );
                base.position.set(dec.x, 0.075, dec.z);
                scene.add(base);

                // Fallen debris pieces
                for (let j = 0; j < 3; j++) {
                    const debris = new THREE.Mesh(
                        new THREE.BoxGeometry(0.2 + Math.random() * 0.2, 0.15, 0.2 + Math.random() * 0.2),
                        new THREE.MeshStandardMaterial({ color: "#6a6a5a", metalness: 0.1, roughness: 0.95 })
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
                    new THREE.MeshStandardMaterial({ color: "#5a5a4a", metalness: 0.1, roughness: 0.95 })
                );
                wall.position.set(dec.x, wallHeight / 2, dec.z);
                wall.rotation.y = dec.rotation ?? 0;
                wall.name = "decoration";
                scene.add(wall);

                // Rubble at base
                for (let j = 0; j < 4; j++) {
                    const rubble = new THREE.Mesh(
                        new THREE.BoxGeometry(0.15 + Math.random() * 0.25, 0.1 + Math.random() * 0.15, 0.15 + Math.random() * 0.25),
                        new THREE.MeshStandardMaterial({ color: "#4a4a3a", metalness: 0.1, roughness: 0.95 })
                    );
                    const offsetX = (Math.random() - 0.5) * wallLength;
                    const offsetZ = (Math.random() - 0.5) * 0.8;
                    rubble.position.set(dec.x + offsetX, 0.1, dec.z + offsetZ);
                    rubble.rotation.y = Math.random() * Math.PI;
                    scene.add(rubble);
                }
            }
        });
    }

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
        const doorLight = new THREE.PointLight("#7ab0e0", 1.2, 6, 2);
        doorLight.position.set(
            transition.x + transition.w / 2,
            1.0,
            transition.z + transition.h / 2
        );
        scene.add(doorLight);
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
                new THREE.MeshStandardMaterial({ color: 0x2d3748, metalness: 0.2, roughness: 0.8 })
            );
            wallMesh.position.set(
                blockingWall.x + blockingWall.w / 2,
                1.25,
                blockingWall.z + blockingWall.h / 2
            );
            wallMesh.name = "secretDoor";
            wallMesh.userData = secretDoorData;
            group.add(wallMesh);

            // Create thick crack segments on the north face using thin boxes
            const crackMat = new THREE.MeshBasicMaterial({ color: "#0a0a0a" });
            const crackX = blockingWall.x + blockingWall.w / 2;
            const crackZ = blockingWall.z + blockingWall.h + 0.02;

            // Helper to create a crack segment between two points
            const makeCrack = (x1: number, y1: number, x2: number, y2: number, thickness = 0.06) => {
                const dx = x2 - x1;
                const dy = y2 - y1;
                const length = Math.sqrt(dx * dx + dy * dy);
                const angle = Math.atan2(dx, dy);

                const crack = new THREE.Mesh(
                    new THREE.BoxGeometry(thickness, length, 0.02),
                    crackMat
                );
                crack.position.set((x1 + x2) / 2, (y1 + y2) / 2, crackZ);
                crack.rotation.z = -angle;
                return crack;
            };

            // Main vertical crack (zigzag pattern)
            group.add(makeCrack(crackX, 0.1, crackX + 0.15, 0.9, 0.08));
            group.add(makeCrack(crackX + 0.15, 0.9, crackX - 0.1, 1.5, 0.08));
            group.add(makeCrack(crackX - 0.1, 1.5, crackX + 0.2, 2.2, 0.08));

            // Branch cracks
            group.add(makeCrack(crackX + 0.15, 0.9, crackX + 0.6, 1.1, 0.05));
            group.add(makeCrack(crackX + 0.6, 1.1, crackX + 0.9, 1.0, 0.04));
            group.add(makeCrack(crackX - 0.1, 1.5, crackX - 0.5, 1.7, 0.05));
            group.add(makeCrack(crackX - 0.5, 1.7, crackX - 0.8, 1.6, 0.04));
            group.add(makeCrack(crackX + 0.15, 0.9, crackX - 0.4, 0.6, 0.05));

            group.userData = secretDoorData;
            scene.add(group);
            secretDoorMeshes.push(group);
        });
    }

    // Grid lines - subtle, above room floors (darker for forest to show on green grass)
    const gridColor = area.id === "forest" ? "#1a3a1a" : "#444444";
    const gridOpacity = area.id === "forest" ? 0.35 : 0.25;
    const gridMat = new THREE.LineBasicMaterial({ color: gridColor, transparent: true, opacity: gridOpacity });
    for (let i = 0; i <= GRID_SIZE; i++) {
        scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.002, i), new THREE.Vector3(GRID_SIZE, 0.002, i)]), gridMat));
        scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(i, 0.002, 0), new THREE.Vector3(i, 0.002, GRID_SIZE)]), gridMat));
    }

    // Fog of war (scaled resolution for smoother edges with linear filtering)
    const fogCanvas = document.createElement("canvas");
    fogCanvas.width = GRID_SIZE * FOG_SCALE;
    fogCanvas.height = GRID_SIZE * FOG_SCALE;
    const fogCtx = fogCanvas.getContext("2d")!;
    fogCtx.fillStyle = "#000";
    fogCtx.fillRect(0, 0, GRID_SIZE * FOG_SCALE, GRID_SIZE * FOG_SCALE);
    const fogTextureObj = new THREE.CanvasTexture(fogCanvas);
    fogTextureObj.magFilter = THREE.LinearFilter;
    fogTextureObj.minFilter = THREE.LinearFilter;
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
        unitOriginalColors[unit.id] = new THREE.Color(data.color);
        maxHp[unit.id] = data.maxHp;

        if (result.targetRing) {
            targetRings[unit.id] = result.targetRing;
        }
        if (result.shieldIndicator) {
            shieldIndicators[unit.id] = result.shieldIndicator;
        }
    });

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
        columnMeshes,
        columnGroups,
        doorMeshes,
        secretDoorMeshes,
        waterMesh,
        chestMeshes,
        billboards,
    };
}
