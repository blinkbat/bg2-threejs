import * as THREE from "three";

const RENDER_ORDER_GROUND = 0;
const RENDER_ORDER_FLOOR = 10;
const RENDER_ORDER_GRID = 20;
const RENDER_ORDER_PROP = 30;

type StaticRenderTier = "ground" | "floor" | "grid";

function isSceneRenderable(object: THREE.Object3D): boolean {
    return object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points || object instanceof THREE.Sprite;
}

function readStaticRenderTier(value: unknown): StaticRenderTier | null {
    if (value === "ground" || value === "floor" || value === "grid") {
        return value;
    }
    return null;
}

function hasLitMaterial(material: THREE.Material | THREE.Material[]): boolean {
    const materials = Array.isArray(material) ? material : [material];
    return materials.some(mat =>
        mat instanceof THREE.MeshStandardMaterial ||
        mat instanceof THREE.MeshPhysicalMaterial ||
        mat instanceof THREE.MeshLambertMaterial ||
        mat instanceof THREE.MeshPhongMaterial ||
        mat instanceof THREE.MeshToonMaterial
    );
}

export const DIRECTIONAL_SHADOW_MAP_SIZE = 512;
export const MAX_FLAME_CLUSTER_LIGHTS = 2;
export const MAX_AREA_LIGHTS = 6;
export const ENABLE_DOOR_POINT_LIGHTS = false;
export const RENDERER_MAX_PIXEL_RATIO = 1.25;
export const RENDER_ORDER_FOG = 1100;

export interface FogFootprintCell {
    x: number;
    z: number;
}

export interface FogFootprintData {
    centerX: number;
    centerZ: number;
    radius: number;
    cells: FogFootprintCell[];
}

export function hashAreaIdToUnitRange(areaId: string): number {
    let hash = 0;
    for (let i = 0; i < areaId.length; i++) {
        hash = ((hash << 5) - hash) + areaId.charCodeAt(i);
        hash |= 0;
    }
    const normalized = Math.abs(hash % 1000) / 1000;
    return normalized;
}

export function applyShadowDefaults(scene: THREE.Scene): void {
    scene.traverse((object: THREE.Object3D) => {
        if (!(object instanceof THREE.Mesh)) return;
        if (!hasLitMaterial(object.material)) return;

        if (object.userData?.liquid) {
            object.castShadow = false;
            object.receiveShadow = false;
            return;
        }

        if (object.name === "ground") {
            object.castShadow = false;
            object.receiveShadow = true;
            return;
        }

        if (object.name === "lava") {
            object.castShadow = false;
            object.receiveShadow = false;
            return;
        }

        if (typeof object.userData?.unitId === "number") {
            object.castShadow = false;
            object.receiveShadow = false;
            return;
        }

        if (object.name === "obstacle") {
            object.castShadow = true;
            object.receiveShadow = true;
            return;
        }

        if (object.name === "chest" || object.name === "decoration") {
            object.castShadow = false;
            object.receiveShadow = true;
            return;
        }
    });
}

export function setStaticRenderTier(object: THREE.Object3D, tier: StaticRenderTier): void {
    object.userData.staticRenderTier = tier;
}

export function applyStaticRenderOrder(scene: THREE.Scene): void {
    scene.traverse((object: THREE.Object3D) => {
        if (!isSceneRenderable(object)) return;
        const tier = readStaticRenderTier(object.userData.staticRenderTier);
        if (tier === "ground") {
            object.renderOrder = RENDER_ORDER_GROUND;
            return;
        }
        if (tier === "floor") {
            object.renderOrder = RENDER_ORDER_FLOOR;
            return;
        }
        if (tier === "grid") {
            object.renderOrder = RENDER_ORDER_GRID;
            return;
        }
        object.renderOrder = RENDER_ORDER_PROP;
    });
}

export function buildFogFootprintCells(
    centerX: number,
    centerZ: number,
    radius: number,
    gridWidth: number,
    gridHeight: number
): FogFootprintCell[] {
    const paddedRadius = Math.max(0.25, radius);
    const radiusSq = paddedRadius * paddedRadius;
    const minX = Math.max(0, Math.floor(centerX - paddedRadius - 1));
    const maxX = Math.min(gridWidth - 1, Math.ceil(centerX + paddedRadius + 1));
    const minZ = Math.max(0, Math.floor(centerZ - paddedRadius - 1));
    const maxZ = Math.min(gridHeight - 1, Math.ceil(centerZ + paddedRadius + 1));
    const cells: FogFootprintCell[] = [];

    for (let x = minX; x <= maxX; x++) {
        for (let z = minZ; z <= maxZ; z++) {
            const cellCenterX = x + 0.5;
            const cellCenterZ = z + 0.5;
            const dx = cellCenterX - centerX;
            const dz = cellCenterZ - centerZ;
            if (dx * dx + dz * dz <= radiusSq) {
                cells.push({ x, z });
            }
        }
    }

    if (cells.length === 0) {
        const fallbackX = THREE.MathUtils.clamp(Math.floor(centerX), 0, gridWidth - 1);
        const fallbackZ = THREE.MathUtils.clamp(Math.floor(centerZ), 0, gridHeight - 1);
        cells.push({ x: fallbackX, z: fallbackZ });
    }

    return cells;
}

export function buildFogFootprintFromBounds(
    bounds: THREE.Box3,
    padding: number,
    gridWidth: number,
    gridHeight: number
): FogFootprintData {
    const centerX = (bounds.min.x + bounds.max.x) / 2;
    const centerZ = (bounds.min.z + bounds.max.z) / 2;
    const halfWidthX = Math.max(0, (bounds.max.x - bounds.min.x) / 2);
    const halfWidthZ = Math.max(0, (bounds.max.z - bounds.min.z) / 2);
    const radius = Math.max(0.3, Math.hypot(halfWidthX, halfWidthZ) + padding);
    const cells = buildFogFootprintCells(centerX, centerZ, radius, gridWidth, gridHeight);
    return { centerX, centerZ, radius, cells };
}

export function createSkyTexture(backgroundColor: string, isForestArea: boolean): THREE.CanvasTexture {
    const canvas = document.createElement("canvas");
    canvas.width = 2;
    canvas.height = 256;
    const ctx = canvas.getContext("2d")!;
    const gradient = ctx.createLinearGradient(0, 0, 0, 256);
    const backgroundBase = new THREE.Color(backgroundColor);
    const topColor = backgroundBase.clone().lerp(new THREE.Color("#000000"), isForestArea ? 0.72 : 0.82);
    const midColor = backgroundBase.clone().lerp(new THREE.Color("#000000"), isForestArea ? 0.52 : 0.68);
    const bottomColor = backgroundBase.clone().lerp(new THREE.Color("#000000"), isForestArea ? 0.28 : 0.5);
    gradient.addColorStop(0, `#${topColor.getHexString()}`);
    gradient.addColorStop(0.5, `#${midColor.getHexString()}`);
    gradient.addColorStop(1, `#${bottomColor.getHexString()}`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 2, 256);
    return new THREE.CanvasTexture(canvas);
}
