// =============================================================================
// UNIT CREATION - Create unit meshes, sprites, and selection indicators
// =============================================================================

import * as THREE from "three";
import type { Unit, UnitGroup } from "../../core/types";
import { getUnitStats } from "../../game/units";

// Import player sprite textures
import wizardSpriteUrl from "../../assets/wizard.png";
import barbarianSpriteUrl from "../../assets/barbarian.png";
import clericSpriteUrl from "../../assets/cleric.png";
import paladinSpriteUrl from "../../assets/paladin.png";
import thiefSpriteUrl from "../../assets/thief.png";
import monkSpriteUrl from "../../assets/monk.png";

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Calculate effective size for a unit, accounting for amoeba split scaling
 */
export function getEffectiveSize(unit: Unit, baseSize: number): number {
    if (unit.enemyType === "giant_amoeba" && unit.splitCount !== undefined) {
        // Each split reduces size: 2.0 → 1.4 → 1.0 → 0.7
        const scaleFactor = Math.pow(0.7, unit.splitCount);
        return baseSize * scaleFactor;
    }
    return baseSize;
}

// =============================================================================
// SPRITE TEXTURES (loaded once, reused)
// =============================================================================

let texturesLoaded = false;
let wizardTexture: THREE.Texture;
let barbarianTexture: THREE.Texture;
let clericTexture: THREE.Texture;
let paladinTexture: THREE.Texture;
let thiefTexture: THREE.Texture;
let monkTexture: THREE.Texture;

function ensureTexturesLoaded(): void {
    if (texturesLoaded) return;

    wizardTexture = new THREE.TextureLoader().load(wizardSpriteUrl);
    wizardTexture.magFilter = THREE.NearestFilter;
    wizardTexture.minFilter = THREE.NearestFilter;

    barbarianTexture = new THREE.TextureLoader().load(barbarianSpriteUrl);
    barbarianTexture.magFilter = THREE.NearestFilter;
    barbarianTexture.minFilter = THREE.NearestFilter;

    clericTexture = new THREE.TextureLoader().load(clericSpriteUrl);
    clericTexture.magFilter = THREE.NearestFilter;
    clericTexture.minFilter = THREE.NearestFilter;

    paladinTexture = new THREE.TextureLoader().load(paladinSpriteUrl);
    paladinTexture.magFilter = THREE.NearestFilter;
    paladinTexture.minFilter = THREE.NearestFilter;

    thiefTexture = new THREE.TextureLoader().load(thiefSpriteUrl);
    thiefTexture.magFilter = THREE.NearestFilter;
    thiefTexture.minFilter = THREE.NearestFilter;

    monkTexture = new THREE.TextureLoader().load(monkSpriteUrl);
    monkTexture.magFilter = THREE.NearestFilter;
    monkTexture.minFilter = THREE.NearestFilter;

    texturesLoaded = true;
}

interface SpriteConfig {
    texture: THREE.Texture;
    width: number;
    height: number;
    offsetX?: number;
    color?: number;
    emissive?: number;
}

function getSpriteConfigs(): Record<number, SpriteConfig> {
    ensureTexturesLoaded();
    return {
        1: { texture: barbarianTexture, width: 157, height: 195, offsetX: -0.1, emissive: 0.07 },  // Barbarian
        2: { texture: paladinTexture, width: 128, height: 196 },    // Paladin
        3: { texture: thiefTexture, width: 128, height: 196, offsetX: 0.1, emissive: 0.07 },  // Thief
        4: { texture: wizardTexture, width: 110, height: 196, emissive: 0.05 },     // Wizard
        5: { texture: monkTexture, width: 128, height: 196, offsetX: -0.1 },       // Monk
        6: { texture: clericTexture, width: 128, height: 196, color: 0xcccccc },   // Cleric (slightly darker)
    };
}

// =============================================================================
// UNIT MESH CREATION
// =============================================================================

interface UnitCreationResult {
    group: UnitGroup;
    mesh: THREE.Mesh;
    selectRing: THREE.Mesh;
    targetRing?: THREE.Mesh;
    shieldIndicator?: THREE.Mesh;
    billboard?: THREE.Mesh;
}

/**
 * Create a unit's scene group with mesh, selection ring, and other indicators.
 */
export function createUnitSceneGroup(
    scene: THREE.Scene,
    unit: Unit,
    billboards: THREE.Mesh[]
): UnitCreationResult {
    const isPlayer = unit.team === "player";
    const data = getUnitStats(unit);
    const baseSize = (!isPlayer && "size" in data && data.size) ? data.size : 1;
    const size = getEffectiveSize(unit, baseSize);
    const group = new THREE.Group();

    const boxH = isPlayer ? 1 : (size > 1 ? 1.8 : 0.6);
    const boxW = 0.6 * size;
    const isAmoeba = unit.enemyType === "giant_amoeba";

    const spriteConfigs = getSpriteConfigs();
    const spriteConfig = spriteConfigs[unit.id];

    let unitMesh: THREE.Mesh;
    let billboard: THREE.Mesh | undefined;

    if (spriteConfig) {
        // Player billboard plane that faces the camera and responds to lighting
        const spriteHeight = 1.8;
        const spriteWidth = spriteHeight * (spriteConfig.width / spriteConfig.height);
        const planeMat = new THREE.MeshStandardMaterial({
            map: spriteConfig.texture,
            color: spriteConfig.color ?? 0xffffff,
            transparent: true,
            alphaTest: 0.5,
            side: THREE.DoubleSide,
            metalness: 0,
            roughness: 1,
            emissive: 0xffffff,
            emissiveIntensity: spriteConfig.emissive ?? 0,
            emissiveMap: spriteConfig.emissive ? spriteConfig.texture : undefined
        });
        const plane = new THREE.Mesh(new THREE.PlaneGeometry(spriteWidth, spriteHeight), planeMat);
        plane.position.y = spriteHeight / 2;
        plane.position.x = spriteConfig.offsetX ?? 0;
        plane.userData.unitId = unit.id;
        plane.userData.isBillboard = true;
        group.add(plane);
        billboards.push(plane);
        unitMesh = plane;
        billboard = plane;
    } else if (unit.enemyType === "kraken_tentacle") {
        // Tentacles use cone geometry (pointing up)
        const coneMat = new THREE.MeshStandardMaterial({
            color: data.color,
            metalness: 0.3,
            roughness: 0.6
        });
        const cone = new THREE.Mesh(new THREE.ConeGeometry(boxW * 0.5, boxH * 1.5, 8), coneMat);
        cone.position.y = boxH * 0.75;
        cone.userData.unitId = unit.id;
        group.add(cone);
        unitMesh = cone;
    } else {
        // Other units use box meshes
        const boxMat = new THREE.MeshStandardMaterial({
            color: data.color,
            metalness: isAmoeba ? 0.1 : 0.5,
            roughness: isAmoeba ? 0.2 : 0.4,
            transparent: isAmoeba,
            opacity: isAmoeba ? 0.6 : 1.0
        });
        const box = new THREE.Mesh(new THREE.BoxGeometry(boxW, boxH, boxW), boxMat);
        box.position.y = boxH / 2;
        box.userData.unitId = unit.id;
        group.add(box);
        unitMesh = box;
    }

    // Determine fly height early (needed for shadow positioning)
    const isFlying = !isPlayer && "flying" in data && data.flying;
    const flyHeight = isFlying ? 1.2 : 0;

    // Unit shadow - simple dark circle under unit
    // For flying units, offset shadow down so it stays on the ground
    const shadowRadius = boxW * 0.6;
    const shadow = new THREE.Mesh(
        new THREE.CircleGeometry(shadowRadius, 16),
        new THREE.MeshBasicMaterial({ color: "#000000", transparent: true, opacity: 0.3, side: THREE.DoubleSide })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.004 - flyHeight;
    group.add(shadow);

    // All units get subtle innate light (enemies dimmer than players)
    const lightIntensity = isPlayer ? 0.15 : 0.08;
    const unitLight = new THREE.PointLight(data.color, lightIntensity, 2, 2);
    unitLight.position.y = boxH / 2;
    group.add(unitLight);

    // Selection ring
    const selInner = 0.5 * size;
    const selOuter = 0.55 * size;
    const selectRing = new THREE.Mesh(
        new THREE.RingGeometry(selInner, selOuter, 32),
        new THREE.MeshBasicMaterial({ color: "#00ff00", side: THREE.DoubleSide })
    );
    selectRing.rotation.x = -Math.PI / 2;
    selectRing.position.y = 0.03;
    selectRing.visible = false;
    group.add(selectRing);

    // Target ring (red) for enemies - shows when player targets them
    let targetRing: THREE.Mesh | undefined;
    let shieldIndicator: THREE.Mesh | undefined;

    if (!isPlayer) {
        targetRing = new THREE.Mesh(
            new THREE.RingGeometry(selInner, selOuter, 32),
            new THREE.MeshBasicMaterial({ color: "#ff0000", side: THREE.DoubleSide, transparent: true, opacity: 1 })
        );
        targetRing.rotation.x = -Math.PI / 2;
        targetRing.position.y = 0.03;
        targetRing.visible = false;
        group.add(targetRing);

        // Front shield indicator - half-disc showing protected direction
        if ("frontShield" in data && data.frontShield) {
            const shieldRadius = size * 0.7;
            // CircleGeometry with thetaStart and thetaLength creates a sector
            // thetaStart = -PI/2 (pointing forward), thetaLength = PI (180 degrees = half circle)
            const shieldGeom = new THREE.CircleGeometry(shieldRadius, 16, -Math.PI / 2, Math.PI);
            const shieldMat = new THREE.MeshBasicMaterial({
                color: "#4488ff",
                transparent: true,
                opacity: 0.4,
                side: THREE.DoubleSide
            });
            shieldIndicator = new THREE.Mesh(shieldGeom, shieldMat);
            shieldIndicator.rotation.x = -Math.PI / 2;
            shieldIndicator.position.y = 0.02;
            group.add(shieldIndicator);
        }
    }

    // Set position (flyHeight determined earlier for shadow)
    group.position.set(unit.x, flyHeight, unit.z);
    group.userData = { unitId: unit.id, targetX: unit.x, targetZ: unit.z, attackTarget: null, flyHeight };
    scene.add(group);

    return {
        group: group as UnitGroup,
        mesh: unitMesh,
        selectRing,
        targetRing,
        shieldIndicator,
        billboard
    };
}

// =============================================================================
// ADD UNIT TO SCENE (for dynamically spawned units)
// =============================================================================

/**
 * Dynamically add a unit to the scene (for spawned units like broodlings).
 * Returns the group and mesh so they can be tracked in refs.
 */
export function addUnitToScene(
    scene: THREE.Scene,
    unit: Unit,
    unitGroups: Record<number, UnitGroup>,
    selectRings: Record<number, THREE.Mesh>,
    targetRings: Record<number, THREE.Mesh>,
    shieldIndicators: Record<number, THREE.Mesh>,
    unitMeshes: Record<number, THREE.Mesh>,
    unitOriginalColors: Record<number, THREE.Color>,
    maxHp: Record<number, number>
): void {
    const isPlayer = unit.team === "player";
    const data = getUnitStats(unit);
    const baseSize = (!isPlayer && "size" in data && data.size) ? data.size : 1;
    const size = getEffectiveSize(unit, baseSize);
    const group = new THREE.Group();

    const boxH = isPlayer ? 1 : (size > 1 ? 1.8 : 0.6);
    const boxW = 0.6 * size;
    const isAmoeba = unit.enemyType === "giant_amoeba";
    const isTentacle = unit.enemyType === "kraken_tentacle";

    let unitMesh: THREE.Mesh;
    if (isTentacle) {
        // Tentacles use cone geometry (pointing up)
        const coneMat = new THREE.MeshStandardMaterial({
            color: data.color,
            metalness: 0.3,
            roughness: 0.6
        });
        const cone = new THREE.Mesh(new THREE.ConeGeometry(boxW * 0.5, boxH * 1.5, 8), coneMat);
        cone.position.y = boxH * 0.75;
        cone.userData.unitId = unit.id;
        group.add(cone);
        unitMesh = cone;
    } else {
        const boxMat = new THREE.MeshStandardMaterial({
            color: data.color,
            metalness: isAmoeba ? 0.1 : 0.5,
            roughness: isAmoeba ? 0.2 : 0.4,
            transparent: isAmoeba,
            opacity: isAmoeba ? 0.6 : 1.0
        });
        const box = new THREE.Mesh(new THREE.BoxGeometry(boxW, boxH, boxW), boxMat);
        box.position.y = boxH / 2;
        box.userData.unitId = unit.id;
        group.add(box);
        unitMesh = box;
    }
    unitMeshes[unit.id] = unitMesh;
    unitOriginalColors[unit.id] = new THREE.Color(data.color);

    // Determine fly height early (needed for shadow positioning)
    const isFlying = !isPlayer && "flying" in data && data.flying;
    const flyHeight = isFlying ? 1.2 : 0;

    // Unit shadow - simple dark circle under unit
    // For flying units, offset shadow down so it stays on the ground
    const shadowRadius = boxW * 0.6;
    const shadow = new THREE.Mesh(
        new THREE.CircleGeometry(shadowRadius, 16),
        new THREE.MeshBasicMaterial({ color: "#000000", transparent: true, opacity: 0.3, side: THREE.DoubleSide })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.004 - flyHeight;
    group.add(shadow);

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

    // Target ring (red) for enemies - shows when player targets them
    if (!isPlayer) {
        const targetRing = new THREE.Mesh(
            new THREE.RingGeometry(selInner, selOuter, 32),
            new THREE.MeshBasicMaterial({ color: "#ff0000", side: THREE.DoubleSide, transparent: true, opacity: 1 })
        );
        targetRing.rotation.x = -Math.PI / 2;
        targetRing.position.y = 0.03;
        targetRing.visible = false;
        group.add(targetRing);
        targetRings[unit.id] = targetRing;

        // Front shield indicator - half-disc showing protected direction
        if ("frontShield" in data && data.frontShield) {
            const shieldRadius = size * 0.7;
            const shieldGeom = new THREE.CircleGeometry(shieldRadius, 16, -Math.PI / 2, Math.PI);
            const shieldMat = new THREE.MeshBasicMaterial({
                color: "#4488ff",
                transparent: true,
                opacity: 0.4,
                side: THREE.DoubleSide
            });
            const shieldDisc = new THREE.Mesh(shieldGeom, shieldMat);
            shieldDisc.rotation.x = -Math.PI / 2;
            shieldDisc.position.y = 0.02;
            group.add(shieldDisc);
            shieldIndicators[unit.id] = shieldDisc;
        }
    }

    maxHp[unit.id] = data.maxHp;

    // Set position (flyHeight determined earlier for shadow)
    group.position.set(unit.x, flyHeight, unit.z);
    group.userData = { unitId: unit.id, targetX: unit.x, targetZ: unit.z, attackTarget: null, flyHeight };
    scene.add(group);
    unitGroups[unit.id] = group as UnitGroup;
}
