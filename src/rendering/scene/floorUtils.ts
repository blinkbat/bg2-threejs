import * as THREE from "three";
import { clampTileTintPercent } from "../../game/areas/tileLayers";

interface TileCornerRounding {
    outer: [number, number, number, number];
    inner: [number, number, number, number];
}

/**
 * Create a MeshStandardMaterial with rounded tile corner clipping using onBeforeCompile.
 * Supports convex (outer) and concave (inner) corner cuts at once.
 */
export function createRoundedFloorMaterial(
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
export function getFloorType(char: string | undefined): string | null {
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

/**
 * Determine natural outer/inner rounded corners based on cardinal + diagonal neighbors.
 */
export function getNaturalTileCornerRounding(
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

export function hashNoise(x: number, z: number, seed: number): number {
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

export function applyTileTintColor(baseColor: string, tintPercent: number): string {
    const clamped = clampTileTintPercent(tintPercent);
    if (clamped === 0) return baseColor;

    const color = new THREE.Color(baseColor);
    const hsl = { h: 0, s: 0, l: 0 };
    color.getHSL(hsl);
    const delta = clamped * 0.0024;
    color.setHSL(hsl.h, hsl.s, THREE.MathUtils.clamp(hsl.l + delta, 0, 1));
    return `#${color.getHexString()}`;
}

export function getFloorVariantColor(baseColor: string, x: number, z: number, char: string): string {
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
