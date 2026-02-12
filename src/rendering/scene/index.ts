// =============================================================================
// THREE.JS SCENE SETUP - Main entry point
// =============================================================================

import * as THREE from "three";
import { FOG_SCALE } from "../../core/constants";
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
export { getEffectiveSize, addUnitToScene, createUnitSceneGroup, ensureTexturesLoaded } from "./units";
import { createUnitSceneGroup, ensureTexturesLoaded } from "./units";

// =============================================================================
// ROUNDED CORNER FLOOR MATERIAL
// =============================================================================

/**
 * Create a MeshStandardMaterial with rounded outer corners using onBeforeCompile
 * This preserves all standard lighting while adding corner rounding
 */
function createRoundedFloorMaterial(
    color: string,
    corners: [number, number, number, number],
    radius: number = 0.15
): THREE.MeshStandardMaterial {
    const mat = new THREE.MeshStandardMaterial({
        color,
        metalness: 0.2,
        roughness: 0.9,
        transparent: true,
    });

    mat.onBeforeCompile = (shader) => {
        // Add uniforms for corners and radius
        shader.uniforms.uCorners = { value: new THREE.Vector4(corners[0], corners[1], corners[2], corners[3]) };
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
            uniform vec4 uCorners;
            uniform float uRadius;
            varying vec2 vRoundUv;`
        );

        // Add discard logic early in fragment shader (before color calculations)
        shader.fragmentShader = shader.fragmentShader.replace(
            "#include <map_fragment>",
            `#include <map_fragment>

            // Rounded corner discard (outer/convex corners)
            vec2 p = vRoundUv;
            float r = uRadius;

            // Top-left corner (UV: 0,1)
            if (uCorners.x > 0.5 && p.x < r && p.y > 1.0 - r) {
                vec2 corner = vec2(r, 1.0 - r);
                if (length(p - corner) > r) discard;
            }

            // Top-right corner (UV: 1,1)
            if (uCorners.y > 0.5 && p.x > 1.0 - r && p.y > 1.0 - r) {
                vec2 corner = vec2(1.0 - r, 1.0 - r);
                if (length(p - corner) > r) discard;
            }

            // Bottom-right corner (UV: 1,0)
            if (uCorners.z > 0.5 && p.x > 1.0 - r && p.y < r) {
                vec2 corner = vec2(1.0 - r, r);
                if (length(p - corner) > r) discard;
            }

            // Bottom-left corner (UV: 0,0)
            if (uCorners.w > 0.5 && p.x < r && p.y < r) {
                vec2 corner = vec2(r, r);
                if (length(p - corner) > r) discard;
            }`
        );
    };

    return mat;
}

/**
 * Check if a floor tile exists at the given position
 */
function hasFloorAt(floor: string[] | string[][], x: number, z: number): boolean {
    if (z < 0 || z >= floor.length) return false;
    const row = floor[z];
    if (!row) return false;
    if (x < 0 || x >= row.length) return false;
    const char = typeof row === "string" ? row[x] : row[x];
    return char !== " " && char !== "." && char !== undefined;
}

/**
 * Determine which corners of a floor tile should be rounded based on neighbors
 * A corner is rounded if both adjacent edges AND the diagonal are empty
 * Returns [topLeft, topRight, bottomRight, bottomLeft]
 */
function getFloorCornerFlags(floor: string[] | string[][], x: number, z: number): [number, number, number, number] {
    // In Three.js with rotated plane: +Z is "down" on screen, -Z is "up"
    // UV coords: (0,0) = bottom-left, (1,1) = top-right
    // After rotation, this maps to world coords

    const hasTop = hasFloorAt(floor, x, z - 1);      // -Z direction
    const hasBottom = hasFloorAt(floor, x, z + 1);   // +Z direction
    const hasLeft = hasFloorAt(floor, x - 1, z);     // -X direction
    const hasRight = hasFloorAt(floor, x + 1, z);    // +X direction

    const hasTopLeft = hasFloorAt(floor, x - 1, z - 1);
    const hasTopRight = hasFloorAt(floor, x + 1, z - 1);
    const hasBottomLeft = hasFloorAt(floor, x - 1, z + 1);
    const hasBottomRight = hasFloorAt(floor, x + 1, z + 1);

    // Round a corner only if both adjacent edges AND diagonal are empty
    // In UV space after plane rotation:
    // - Top-left UV (0,1) = world (-X, -Z) corner
    // - Top-right UV (1,1) = world (+X, -Z) corner
    // - Bottom-right UV (1,0) = world (+X, +Z) corner
    // - Bottom-left UV (0,0) = world (-X, +Z) corner

    const roundTopLeft = (!hasTop && !hasLeft && !hasTopLeft) ? 1 : 0;
    const roundTopRight = (!hasTop && !hasRight && !hasTopRight) ? 1 : 0;
    const roundBottomRight = (!hasBottom && !hasRight && !hasBottomRight) ? 1 : 0;
    const roundBottomLeft = (!hasBottom && !hasLeft && !hasBottomLeft) ? 1 : 0;

    return [roundTopLeft, roundTopRight, roundBottomRight, roundBottomLeft];
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
        new THREE.PlaneGeometry(area.gridWidth, area.gridHeight),
        groundMat
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(area.gridWidth / 2, 0, area.gridHeight / 2);
    ground.name = "ground";
    scene.add(ground);

    // Floor tiles - render based on floor grid
    // Floor types: s=sand, d=dirt, g=grass, w=water, t=stone, .=default (gray)
    let waterMesh: THREE.Mesh | null = null;

    // Shared geometry for all 1x1 floor/terrain tiles (hundreds of tiles, one geometry)
    const tileGeo = new THREE.PlaneGeometry(1, 1);

    // Material pool: reuse materials for tiles with the same color (avoids ~1600 unique instances)
    const floorMatPool: Record<string, THREE.MeshStandardMaterial> = {};
    const waterMatPool: Record<string, THREE.MeshStandardMaterial> = {};
    function getFloorMat(color: string): THREE.MeshStandardMaterial {
        if (!floorMatPool[color]) {
            floorMatPool[color] = new THREE.MeshStandardMaterial({ color, metalness: 0.2, roughness: 0.9 });
        }
        return floorMatPool[color];
    }
    function getWaterMat(color: string): THREE.MeshStandardMaterial {
        if (!waterMatPool[color]) {
            waterMatPool[color] = new THREE.MeshStandardMaterial({ color, metalness: 0.3, roughness: 0.4 });
        }
        return waterMatPool[color];
    }

    const floorColors: Record<string, string> = {
        "s": "#c2b280",  // Sand - tan
        "S": "#d4c490",  // Light sand
        "d": "#8b7355",  // Dirt - brown
        "D": "#6b5344",  // Dark dirt
        "g": "#5a8a4a",  // Grass - green
        "G": "#4a7a3a",  // Dark grass
        "w": "#4a90a0",  // Water - light blue
        "W": "#3a7080",  // Deep water
        "t": "#707070",  // Stone - gray
        "T": "#606060",  // Dark stone
        ".": "#555555",  // Default - gray
    };

    // Render floor tiles with rounded corners
    if (area.floor && area.floor.length > 0) {
        for (let z = 0; z < area.floor.length; z++) {
            for (let x = 0; x < area.floor[z].length; x++) {
                const char = area.floor[z][x];
                if (char === " " || char === "." || char === undefined) continue;  // Skip empty/default tiles

                const color = floorColors[char] ?? "#555555";
                const isWater = char === "w" || char === "W";

                let tile: THREE.Mesh;

                if (isWater) {
                    // Water tiles - no rounding
                    tile = new THREE.Mesh(tileGeo, getWaterMat(color));
                } else {
                    // Land gets outer corner rounding at edges
                    const corners = getFloorCornerFlags(area.floor, x, z);
                    const hasRounding = corners.some(c => c > 0);

                    if (hasRounding) {
                        // Rounded tiles need unique materials (per-tile shader uniforms)
                        const roundedMat = createRoundedFloorMaterial(color, corners, 0.3);
                        tile = new THREE.Mesh(tileGeo, roundedMat);
                    } else {
                        tile = new THREE.Mesh(tileGeo, getFloorMat(color));
                    }
                }

                tile.rotation.x = -Math.PI / 2;
                tile.position.set(x + 0.5, 0.001, z + 0.5);
                tile.name = "ground";
                scene.add(tile);
            }
        }
    }

    // Render lava and water from terrain layer (~ = lava, w = water)
    if (area.terrain && area.terrain.length > 0) {
        const lavaMat = new THREE.MeshStandardMaterial({
            color: "#ff4400",
            emissive: "#ff2200",
            emissiveIntensity: 0.8,
            metalness: 0.4,
            roughness: 0.3,
        });
        const terrainWaterMat = new THREE.MeshStandardMaterial({
            color: "#1a3848",
            metalness: 0.3,
            roughness: 0.4,
        });
        for (let z = 0; z < area.terrain.length; z++) {
            for (let x = 0; x < (area.terrain[z]?.length ?? 0); x++) {
                const char = area.terrain[z][x];
                if (char === "~") {
                    const tile = new THREE.Mesh(tileGeo, lavaMat);
                    tile.rotation.x = -Math.PI / 2;
                    tile.position.set(x + 0.5, 0.002, z + 0.5);
                    tile.name = "lava";
                    scene.add(tile);
                } else if (char === "w") {
                    const tile = new THREE.Mesh(tileGeo, terrainWaterMat);
                    tile.rotation.x = -Math.PI / 2;
                    tile.position.set(x + 0.5, 0.002, z + 0.5);
                    tile.name = "ground";
                    scene.add(tile);
                }
            }
        }
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

    computed.candlePositions.forEach((pos, index) => {
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

        // Create one light per candle cluster (every 4th candle to reduce light count)
        if (index % 4 === 0) {
            const light = new THREE.PointLight("#ffaa44", 12, 8, 1.5);
            light.position.set(pos.x + pos.dx * 0.3, 2.5, pos.z + pos.dz * 0.3);
            scene.add(light);
            candleLights.push(light);
        }
    });

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
    const foliageColors = ["#228B22", "#2E8B57", "#3CB371", "#006400", "#32CD32", "#556B2F"];
    const trunkColors = ["#654321", "#8B4513", "#A0522D", "#5C4033", "#6F4E37"];
    const treeMeshes: THREE.Mesh[] = [];

    // Fog mesh Y position - trees in unexplored cells will be capped below this
    const FOG_Y = 2.6;

    // Tree size multiplier - forest trees are larger
    const treeSizeMultiplier = area.id === "forest" ? 1.5 : 1.0;

    // Palm-specific colors
    const palmFoliageColors = ["#2E8B57", "#3CB371", "#228B22", "#4CAF50"];

    area.trees.forEach((tree, i) => {
        const scale = tree.size * treeSizeMultiplier;
        const treeType = tree.type ?? "pine";

        // Taller trees are skinnier - use inverse relationship with randomness
        // skinnyFactor ranges from ~0.6 (for large trees) to ~1.0 (for small trees)
        const randomVariance = 0.85 + Math.random() * 0.3;  // 0.85-1.15 random multiplier
        const skinnyFactor = Math.min(1.0, (1.0 / Math.sqrt(scale)) * randomVariance);

        let trunkHeight: number;
        let trunkRadius: number;
        let trunkBottomRadius: number;
        let foliageRadius: number;
        let foliageHeight: number;

        if (treeType === "palm") {
            // Palm: tall thin trunk, small round foliage cluster at top
            trunkHeight = 1.8 * scale;
            trunkRadius = 0.08 * scale;
            trunkBottomRadius = trunkRadius * 1.5;
            foliageRadius = 0.5 * scale;
            foliageHeight = 2 * foliageRadius;  // Sphere diameter for fog-of-war
        } else if (treeType === "oak") {
            // Oak: shorter thick trunk, wide round bushy foliage
            trunkHeight = 0.8 * scale;
            trunkRadius = 0.2 * scale * skinnyFactor;
            trunkBottomRadius = trunkRadius * 1.4;
            foliageRadius = 1.0 * scale * skinnyFactor;
            foliageHeight = 2 * foliageRadius;  // Sphere diameter for fog-of-war
        } else {
            // Pine (default): tall pyramidal cone
            trunkHeight = 1.2 * scale;
            trunkRadius = 0.15 * scale * skinnyFactor;
            trunkBottomRadius = trunkRadius * 1.3;
            foliageRadius = 0.8 * scale * skinnyFactor;
            foliageHeight = 2.5 * scale;
        }

        const trunkColor = trunkColors[i % trunkColors.length];
        const trunk = new THREE.Mesh(
            new THREE.CylinderGeometry(trunkRadius, trunkBottomRadius, trunkHeight, 8),
            new THREE.MeshStandardMaterial({ color: trunkColor, metalness: 0.0, roughness: 1.0, transparent: true, opacity: 1 })
        );
        trunk.position.set(tree.x, trunkHeight / 2, tree.z);
        trunk.name = "tree";
        trunk.userData.fullHeight = trunkHeight;
        trunk.userData.treeX = tree.x;
        trunk.userData.treeZ = tree.z;
        trunk.userData.isTrunk = true;
        scene.add(trunk);

        // Foliage geometry depends on tree type
        const foliageColor = treeType === "palm"
            ? palmFoliageColors[i % palmFoliageColors.length]
            : foliageColors[i % foliageColors.length];

        let foliageGeometry: THREE.BufferGeometry;
        if (treeType === "palm") {
            foliageGeometry = new THREE.SphereGeometry(foliageRadius, 8, 6);
        } else if (treeType === "oak") {
            foliageGeometry = new THREE.SphereGeometry(foliageRadius, 8, 6);
        } else {
            foliageGeometry = new THREE.ConeGeometry(foliageRadius, foliageHeight, 8);
        }

        const foliage = new THREE.Mesh(
            foliageGeometry,
            new THREE.MeshStandardMaterial({ color: foliageColor, metalness: 0.0, roughness: 0.8, transparent: true, opacity: 1 })
        );
        const fullFoliageY = treeType === "palm"
            ? trunkHeight + foliageRadius          // Sphere sits on top of trunk
            : treeType === "oak"
                ? trunkHeight + foliageRadius * 0.7 // Sphere engulfs top of trunk
                : trunkHeight + foliageHeight / 2;  // Cone base at trunk top
        foliage.position.set(tree.x, fullFoliageY, tree.z);
        foliage.name = "tree";
        foliage.userData.fullY = fullFoliageY;
        foliage.userData.fullHeight = foliageHeight;
        foliage.userData.fullRadius = foliageRadius;
        foliage.userData.treeX = tree.x;
        foliage.userData.treeZ = tree.z;
        foliage.userData.isFoliage = true;

        // Tree shadow
        const shadowRadius = (treeType === "pine" ? foliageRadius : foliageRadius * 1.1) * 0.9;
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
            } else if (dec.type === "rock") {
                // Large rock - irregular boulder shape
                const rockSize = 0.75 * size;  // Slightly bigger
                const rock = new THREE.Mesh(
                    new THREE.DodecahedronGeometry(rockSize, 0),
                    new THREE.MeshStandardMaterial({ color: "#5a5040", metalness: 0.1, roughness: 0.95 })
                );
                rock.position.set(dec.x, rockSize * 0.6, dec.z);
                rock.rotation.set(Math.random() * 0.3, Math.random() * Math.PI, Math.random() * 0.3);
                rock.scale.set(1, 0.7, 1.1);  // Flatten slightly
                rock.name = "decoration";
                scene.add(rock);
            } else if (dec.type === "small_rock") {
                // Small rock - pebble
                const rockSize = 0.35 * size;  // Slightly bigger
                const rock = new THREE.Mesh(
                    new THREE.DodecahedronGeometry(rockSize, 0),
                    new THREE.MeshStandardMaterial({ color: "#6a6050", metalness: 0.1, roughness: 0.95 })
                );
                rock.position.set(dec.x, rockSize * 0.5, dec.z);
                rock.rotation.set(Math.random() * 0.5, Math.random() * Math.PI, Math.random() * 0.5);
                rock.scale.set(1, 0.6, 1.2);
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

                // White spots on cap (random count)
                const spotCount = 3 + Math.floor(Math.random() * 5);
                for (let j = 0; j < spotCount; j++) {
                    const spotSize = (0.04 + Math.random() * 0.04) * size * sizeJitter;
                    const spot = new THREE.Mesh(
                        new THREE.CircleGeometry(spotSize, 8),
                        new THREE.MeshBasicMaterial({ color: "#fff" })
                    );
                    const theta = Math.random() * Math.PI * 2;
                    const phi = Math.random() * Math.PI * capFlatness * 0.85;
                    spot.position.set(
                        dec.x + Math.sin(phi) * Math.cos(theta) * capRadius * 0.95,
                        stemHeight + Math.cos(phi) * capRadius * 0.95,
                        dec.z + Math.sin(phi) * Math.sin(theta) * capRadius * 0.95
                    );
                    spot.lookAt(dec.x, stemHeight, dec.z);
                    scene.add(spot);
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
            } else if (dec.type === "seaweed") {
                // Large seaweed - multiple fronds radiating from center
                const seaweedColor = "#2a6030";
                const frondCount = 6;
                for (let j = 0; j < frondCount; j++) {
                    const angle = (j / frondCount) * Math.PI * 2 + Math.random() * 0.3;
                    const frondLength = (0.5 + Math.random() * 0.2) * size;
                    const frondWidth = 0.15 * size;

                    // Each frond is a thin box tilted outward
                    const frond = new THREE.Mesh(
                        new THREE.BoxGeometry(frondWidth, 0.02, frondLength),
                        new THREE.MeshStandardMaterial({ color: seaweedColor, metalness: 0.0, roughness: 0.9, side: THREE.DoubleSide })
                    );
                    frond.position.set(
                        dec.x + Math.cos(angle) * frondLength * 0.4,
                        0.15 * size,
                        dec.z + Math.sin(angle) * frondLength * 0.4
                    );
                    frond.rotation.y = angle;
                    frond.rotation.x = -0.6;  // Tilt outward
                    scene.add(frond);
                }
                // Center stem
                const stem = new THREE.Mesh(
                    new THREE.CylinderGeometry(0.03 * size, 0.05 * size, 0.2 * size, 6),
                    new THREE.MeshStandardMaterial({ color: "#3a4030", metalness: 0.0, roughness: 0.9 })
                );
                stem.position.set(dec.x, 0.1 * size, dec.z);
                stem.name = "decoration";
                scene.add(stem);
            } else if (dec.type === "small_seaweed") {
                // Small seaweed - fewer, smaller fronds
                const seaweedColor = "#3a7040";
                const frondCount = 4;
                for (let j = 0; j < frondCount; j++) {
                    const angle = (j / frondCount) * Math.PI * 2 + Math.random() * 0.4;
                    const frondLength = (0.25 + Math.random() * 0.1) * size;
                    const frondWidth = 0.08 * size;

                    const frond = new THREE.Mesh(
                        new THREE.BoxGeometry(frondWidth, 0.015, frondLength),
                        new THREE.MeshStandardMaterial({ color: seaweedColor, metalness: 0.0, roughness: 0.9, side: THREE.DoubleSide })
                    );
                    frond.position.set(
                        dec.x + Math.cos(angle) * frondLength * 0.35,
                        0.08 * size,
                        dec.z + Math.sin(angle) * frondLength * 0.35
                    );
                    frond.rotation.y = angle;
                    frond.rotation.x = -0.5;
                    if (j === 0) frond.name = "decoration";
                    scene.add(frond);
                }
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
    // Horizontal lines (along X axis, varying Z)
    for (let z = 0; z <= area.gridHeight; z++) {
        scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.002, z), new THREE.Vector3(area.gridWidth, 0.002, z)]), gridMat));
    }
    // Vertical lines (along Z axis, varying X)
    for (let x = 0; x <= area.gridWidth; x++) {
        scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x, 0.002, 0), new THREE.Vector3(x, 0.002, area.gridHeight)]), gridMat));
    }

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
    const fogTexture: FogTexture = { canvas: fogCanvas, ctx: fogCtx, texture: fogTextureObj };

    const fogMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(area.gridWidth, area.gridHeight),
        new THREE.MeshBasicMaterial({ map: fogTextureObj, transparent: true, depthWrite: false })
    );
    fogMesh.rotation.x = -Math.PI / 2;
    fogMesh.position.set(area.gridWidth / 2, 2.6, area.gridHeight / 2);
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
        new THREE.MeshBasicMaterial({ color: "#3b82f6", side: THREE.DoubleSide, transparent: true, opacity: 0.25 })
    );
    rangeIndicator.rotation.x = -Math.PI / 2;
    rangeIndicator.position.y = 0.02;
    rangeIndicator.visible = false;
    rangeIndicator.userData.radius = 10;
    scene.add(rangeIndicator);

    // AOE indicator
    const aoeIndicator = new THREE.Mesh(
        new THREE.RingGeometry(0.1, 2.5, 32),
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
