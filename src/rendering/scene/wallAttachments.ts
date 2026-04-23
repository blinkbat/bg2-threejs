// =============================================================================
// WALL ATTACHMENTS - Vines, tapestries, and other meshes that hang on wall faces
// =============================================================================
//
// These decorations are placed on wall tiles (blocked cells) and render against
// whichever wall face(s) are adjacent to walkable tiles. Each attachment is
// linked to its parent merged wall so opacity and visibility can follow the
// wall during occlusion fades and secret-door reveals.

import * as THREE from "three";
import type { Decoration } from "../../game/areas/types";
import type { WallAttachmentMesh } from "./types";

function tagAttachment(mesh: THREE.Mesh, parentWall: THREE.Mesh, baseOpacity: number): WallAttachmentMesh {
    const userData = { parentWall, baseOpacity };
    mesh.userData = userData;
    return Object.assign(mesh, { userData }) as WallAttachmentMesh;
}

interface FaceDirection {
    dx: number;
    dz: number;
}

const FACE_DIRECTIONS: readonly FaceDirection[] = [
    { dx: 1, dz: 0 },
    { dx: -1, dz: 0 },
    { dx: 0, dz: 1 },
    { dx: 0, dz: -1 },
];

const VINE_PALETTE = ["#4d7f2a", "#6f9639", "#83ab47", "#567a33"];
const TAPESTRY_CLOTH_COLORS = ["#8a2a2a", "#2f3f8a", "#5a3a7a", "#2f6a48"];
const TAPESTRY_TRIM_COLOR = "#d4a84a";

const WALL_TOP_Y = 2.5;
const FACE_OFFSET = 0.02;

function hash01(x: number, z: number, salt: number): number {
    const n = Math.sin(x * 374.1 + z * 921.7 + salt * 71.3) * 43758.5453;
    return n - Math.floor(n);
}

function findParentWall(wallMeshes: THREE.Mesh[], tileX: number, tileZ: number): THREE.Mesh | null {
    for (const mesh of wallMeshes) {
        const bounds = mesh.userData.bounds as { x: number; z: number; w: number; h: number } | undefined;
        if (!bounds) continue;
        if (
            tileX >= bounds.x
            && tileX < bounds.x + bounds.w
            && tileZ >= bounds.z
            && tileZ < bounds.z + bounds.h
        ) {
            return mesh;
        }
    }
    return null;
}

function buildVineCluster(
    scene: THREE.Scene,
    parentWall: THREE.Mesh,
    tileX: number,
    tileZ: number,
    face: FaceDirection,
    attachments: WallAttachmentMesh[]
): void {
    // Face normal points from wall tile into the walkable neighbor.
    // The vine surface sits at the boundary between the two tiles.
    const faceCenterX = tileX + 0.5 + face.dx * 0.5;
    const faceCenterZ = tileZ + 0.5 + face.dz * 0.5;
    const offsetX = face.dx * FACE_OFFSET;
    const offsetZ = face.dz * FACE_OFFSET;

    const leafCount = 7;
    for (let i = 0; i < leafCount; i++) {
        const t = i / (leafCount - 1);
        const rand = hash01(tileX + i * 0.37, tileZ + i * 0.91, face.dx * 13 + face.dz * 29);
        const y = WALL_TOP_Y - 0.15 - t * 2.0;
        // Jitter along the wall face (tangent direction)
        const tangentX = -face.dz;
        const tangentZ = face.dx;
        const lateralJitter = (rand - 0.5) * 0.7;
        const leaf = new THREE.Mesh(
            new THREE.SphereGeometry(0.18 + rand * 0.09, 6, 5),
            new THREE.MeshStandardMaterial({
                color: VINE_PALETTE[Math.floor(rand * VINE_PALETTE.length) % VINE_PALETTE.length],
                roughness: 0.85,
                metalness: 0.0,
                transparent: true,
                opacity: 1,
                emissive: "#1a2a10",
                emissiveIntensity: 0.05,
            })
        );
        leaf.scale.set(
            1.2 + rand * 0.4,
            0.55 + rand * 0.25,
            0.35
        );
        leaf.position.set(
            faceCenterX + offsetX + tangentX * lateralJitter,
            y,
            faceCenterZ + offsetZ + tangentZ * lateralJitter
        );
        leaf.castShadow = false;
        leaf.receiveShadow = false;
        leaf.name = "wallVineLeaf";
        scene.add(leaf);
        attachments.push(tagAttachment(leaf, parentWall, 1));
    }
}

function buildTapestry(
    scene: THREE.Scene,
    parentWall: THREE.Mesh,
    tileX: number,
    tileZ: number,
    face: FaceDirection,
    attachments: WallAttachmentMesh[]
): void {
    const faceCenterX = tileX + 0.5 + face.dx * 0.5;
    const faceCenterZ = tileZ + 0.5 + face.dz * 0.5;
    const offsetX = face.dx * FACE_OFFSET;
    const offsetZ = face.dz * FACE_OFFSET;
    const tangentX = -face.dz;
    const tangentZ = face.dx;

    const rand = hash01(tileX, tileZ, face.dx * 17 + face.dz * 37);
    const cloth = TAPESTRY_CLOTH_COLORS[Math.floor(rand * TAPESTRY_CLOTH_COLORS.length) % TAPESTRY_CLOTH_COLORS.length];

    const clothWidth = 0.75;
    const clothHeight = 1.85;
    const clothTopY = WALL_TOP_Y - 0.2;
    const clothCenterY = clothTopY - clothHeight / 2;

    // Main cloth - a thin box so it casts correctly regardless of face direction
    const clothGeo = new THREE.BoxGeometry(
        Math.abs(tangentX) > 0 ? clothWidth : 0.04,
        clothHeight,
        Math.abs(tangentZ) > 0 ? clothWidth : 0.04
    );
    const clothMesh = new THREE.Mesh(
        clothGeo,
        new THREE.MeshStandardMaterial({
            color: cloth,
            roughness: 0.9,
            metalness: 0.0,
            transparent: true,
            opacity: 1,
        })
    );
    clothMesh.position.set(
        faceCenterX + offsetX,
        clothCenterY,
        faceCenterZ + offsetZ
    );
    clothMesh.name = "wallTapestryCloth";
    scene.add(clothMesh);
    attachments.push(tagAttachment(clothMesh, parentWall, 1));

    // Top rod / trim piece
    const rodGeo = new THREE.BoxGeometry(
        Math.abs(tangentX) > 0 ? clothWidth + 0.12 : 0.06,
        0.1,
        Math.abs(tangentZ) > 0 ? clothWidth + 0.12 : 0.06
    );
    const rodMesh = new THREE.Mesh(
        rodGeo,
        new THREE.MeshStandardMaterial({
            color: TAPESTRY_TRIM_COLOR,
            roughness: 0.5,
            metalness: 0.4,
            transparent: true,
            opacity: 1,
        })
    );
    rodMesh.position.set(
        faceCenterX + offsetX,
        clothTopY + 0.05,
        faceCenterZ + offsetZ
    );
    rodMesh.name = "wallTapestryRod";
    scene.add(rodMesh);
    attachments.push(tagAttachment(rodMesh, parentWall, 1));

    // Bottom trim stripe
    const trimGeo = new THREE.BoxGeometry(
        Math.abs(tangentX) > 0 ? clothWidth : 0.05,
        0.08,
        Math.abs(tangentZ) > 0 ? clothWidth : 0.05
    );
    const trimMesh = new THREE.Mesh(
        trimGeo,
        new THREE.MeshStandardMaterial({
            color: TAPESTRY_TRIM_COLOR,
            roughness: 0.55,
            metalness: 0.35,
            transparent: true,
            opacity: 1,
        })
    );
    trimMesh.position.set(
        faceCenterX + offsetX,
        clothCenterY - clothHeight / 2 + 0.06,
        faceCenterZ + offsetZ
    );
    trimMesh.name = "wallTapestryTrim";
    scene.add(trimMesh);
    attachments.push(tagAttachment(trimMesh, parentWall, 1));
}

/**
 * Build vine and tapestry meshes for decorations placed on wall tiles.
 * For each wall-attached decoration, spawns geometry on every wall face whose
 * neighbor tile is walkable.
 */
export function buildWallAttachments(
    scene: THREE.Scene,
    decorations: readonly Decoration[] | undefined,
    wallMeshes: THREE.Mesh[],
    blocked: boolean[][],
    gridWidth: number,
    gridHeight: number
): WallAttachmentMesh[] {
    const attachments: WallAttachmentMesh[] = [];
    if (!decorations) return attachments;

    for (const deco of decorations) {
        if (deco.type !== "wall_vines" && deco.type !== "tapestry") continue;
        const tileX = Math.floor(deco.x);
        const tileZ = Math.floor(deco.z);
        if (tileX < 0 || tileZ < 0 || tileX >= gridWidth || tileZ >= gridHeight) continue;
        // Decoration must sit on a wall tile; otherwise there's nothing to attach to.
        if (!blocked[tileX][tileZ]) continue;

        const parentWall = findParentWall(wallMeshes, tileX, tileZ);
        if (!parentWall) continue;

        for (const face of FACE_DIRECTIONS) {
            const nx = tileX + face.dx;
            const nz = tileZ + face.dz;
            if (nx < 0 || nz < 0 || nx >= gridWidth || nz >= gridHeight) continue;
            if (blocked[nx][nz]) continue;  // neighbor is another wall; no visible face here

            if (deco.type === "wall_vines") {
                buildVineCluster(scene, parentWall, tileX, tileZ, face, attachments);
            } else {
                buildTapestry(scene, parentWall, tileX, tileZ, face, attachments);
            }
        }
    }

    return attachments;
}
