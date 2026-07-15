import * as THREE from "three";

// =============================================================================
// PALM CANOPY - Arching folded fronds merged into a single geometry
// =============================================================================

export interface PalmCanopyOptions {
    frondCount: number;
    frondLength: number;
    frondWidth: number;     // Half-width scale of a frond at its widest point
    droop: number;          // How far tips sink below the crown (fraction of length)
    baseColor: THREE.Color;
    random: () => number;
}

const FROND_SEGMENTS = 5;

/**
 * Build one merged geometry containing every frond of a palm crown.
 * Each frond is an inverted-V strip that climbs away from the crown, arcs
 * over, and droops below it. Per-frond tint variation is baked into vertex
 * colors so the whole canopy stays a single draw call.
 */
export function createPalmCanopyGeometry(options: PalmCanopyOptions): THREE.BufferGeometry {
    const { frondCount, frondLength, frondWidth, droop, baseColor, random } = options;
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];

    const hsl = { h: 0, s: 0, l: 0 };
    baseColor.getHSL(hsl);

    for (let f = 0; f < frondCount; f++) {
        const yaw = (f / frondCount) * Math.PI * 2 + (random() - 0.5) * 0.5;
        const length = frondLength * (0.82 + random() * 0.36);
        const width = frondWidth * (0.8 + random() * 0.4);
        const rise = 0.5 + random() * 0.25;                 // Initial climb slope
        const sag = droop + random() * 0.18 + rise * 0.5;   // Guarantees tips end below the crown

        const dirX = Math.cos(yaw);
        const dirZ = Math.sin(yaw);
        const sideX = -dirZ;
        const sideZ = dirX;

        const frondColor = new THREE.Color().setHSL(
            (hsl.h + (random() - 0.5) * 0.03 + 1) % 1,
            THREE.MathUtils.clamp(hsl.s + (random() - 0.5) * 0.12, 0, 1),
            THREE.MathUtils.clamp(hsl.l + (random() - 0.5) * 0.1, 0, 1)
        );

        const baseIndex = positions.length / 3;
        for (let s = 0; s <= FROND_SEGMENTS; s++) {
            const t = s / FROND_SEGMENTS;
            const radial = length * t;
            const y = length * (rise * t - sag * t * t);
            const w = width * (t * (1 - t) * 2.4 + 0.14 * (1 - t));
            const fold = w * 0.5;

            const cx = dirX * radial;
            const cz = dirZ * radial;
            // Left edge, raised center ridge, right edge (inverted-V cross-section)
            positions.push(cx + sideX * w, y - fold, cz + sideZ * w);
            positions.push(cx, y + fold * 0.35, cz);
            positions.push(cx - sideX * w, y - fold, cz - sideZ * w);

            // Darker toward the crown so the canopy center reads shaded.
            const shade = 0.82 + 0.18 * Math.min(1, t * 2.2);
            for (let v = 0; v < 3; v++) {
                colors.push(frondColor.r * shade, frondColor.g * shade, frondColor.b * shade);
            }
        }

        for (let s = 0; s < FROND_SEGMENTS; s++) {
            const row = baseIndex + s * 3;
            const next = row + 3;
            indices.push(row, next, row + 1, row + 1, next, next + 1);
            indices.push(row + 1, next + 1, row + 2, row + 2, next + 1, next + 2);
        }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
}
