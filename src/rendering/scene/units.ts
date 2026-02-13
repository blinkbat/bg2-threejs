// =============================================================================
// UNIT CREATION - Create unit meshes, sprites, and selection indicators
// =============================================================================

import * as THREE from "three";
import type { Unit, UnitGroup, EnemyStats } from "../../core/types";
import { getUnitStats } from "../../game/units";

// Import player sprite textures
import wizardSpriteUrl from "../../assets/wizard.png";
import barbarianSpriteUrl from "../../assets/barbarian.png";
import clericSpriteUrl from "../../assets/cleric.png";
import paladinSpriteUrl from "../../assets/paladin.png";
import thiefSpriteUrl from "../../assets/thief.png";
import monkSpriteUrl from "../../assets/monk.png";

// Import enemy sprite textures
import vampireBatSpriteUrl from "../../assets/vampire-bat.png";
import acidSlugSpriteUrl from "../../assets/acid-slug.png";
import amoebaLgSpriteUrl from "../../assets/amoeba-lg.png";
import amoebaMdSpriteUrl from "../../assets/amoeba-md.png";
import amoebaSmSpriteUrl from "../../assets/amoeba-sm.png";
import krakenTentacleSpriteUrl from "../../assets/kraken-tentacle.png";
import krakenBodySpriteUrl from "../../assets/kraken-body.png";

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
let vampireBatTexture: THREE.Texture;
let acidSlugTexture: THREE.Texture;
let amoebaLgTexture: THREE.Texture;
let amoebaMdTexture: THREE.Texture;
let amoebaSmTexture: THREE.Texture;
let krakenTentacleTexture: THREE.Texture;
let krakenBodyTexture: THREE.Texture;

function loadFilteredTexture(url: string): THREE.Texture {
    const tex = new THREE.TextureLoader().load(url);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    return tex;
}

/** Eagerly load all sprite textures. Call early to avoid first-frame pop-in. */
export function ensureTexturesLoaded(): void {
    if (texturesLoaded) return;

    wizardTexture = loadFilteredTexture(wizardSpriteUrl);
    barbarianTexture = loadFilteredTexture(barbarianSpriteUrl);
    clericTexture = loadFilteredTexture(clericSpriteUrl);
    paladinTexture = loadFilteredTexture(paladinSpriteUrl);
    thiefTexture = loadFilteredTexture(thiefSpriteUrl);
    monkTexture = loadFilteredTexture(monkSpriteUrl);
    vampireBatTexture = loadFilteredTexture(vampireBatSpriteUrl);
    acidSlugTexture = loadFilteredTexture(acidSlugSpriteUrl);
    amoebaLgTexture = loadFilteredTexture(amoebaLgSpriteUrl);
    amoebaMdTexture = loadFilteredTexture(amoebaMdSpriteUrl);
    amoebaSmTexture = loadFilteredTexture(amoebaSmSpriteUrl);
    krakenTentacleTexture = loadFilteredTexture(krakenTentacleSpriteUrl);
    krakenBodyTexture = loadFilteredTexture(krakenBodySpriteUrl);

    texturesLoaded = true;
}

interface SpriteConfig {
    texture: THREE.Texture;
    width: number;
    height: number;
    offsetX?: number;
    offsetY?: number;       // Vertical offset (negative = lower on shadow)
    color?: number;
    spriteHeight?: number;  // Override default 1.8 sprite height
    brightness?: number;    // Emissive boost for dark textures (0-1)
    shadowSize?: number;    // Override shadow radius
    opacity?: number;       // Transparency (0-1, default 1)
}

function getSpriteConfigs(): Record<number, SpriteConfig> {
    ensureTexturesLoaded();
    return {
        1: { texture: barbarianTexture, width: 196, height: 195, offsetX: -0.1, brightness: 0.07 },  // Barbarian
        2: { texture: paladinTexture, width: 128, height: 196, brightness: 0.07 },    // Paladin
        3: { texture: thiefTexture, width: 128, height: 196, offsetX: 0.1, brightness: 0.07 },  // Thief
        4: { texture: wizardTexture, width: 110, height: 196, brightness: 0.07 },     // Wizard
        5: { texture: monkTexture, width: 128, height: 196, offsetX: -0.1, brightness: 0.07 },       // Monk
        6: { texture: clericTexture, width: 128, height: 196, color: 0xcccccc, brightness: 0.07 },   // Cleric
        7: { texture: barbarianTexture, width: 196, height: 195, offsetX: -0.1, color: 0xe8d6b8, brightness: 0.09, spriteHeight: 2.0, opacity: 0.3 }, // Ancestor summon
    };
}

function applySpriteEdgeBlur(material: THREE.MeshStandardMaterial, textureWidth: number, textureHeight: number): void {
    material.customProgramCacheKey = () => "sprite_edge_blur";
    material.onBeforeCompile = (shader) => {
        shader.uniforms.uTexelSize = {
            value: new THREE.Vector2(1.0 / textureWidth, 1.0 / textureHeight)
        };
        shader.fragmentShader = shader.fragmentShader.replace(
            "#include <common>",
            "#include <common>\nuniform vec2 uTexelSize;"
        );
        shader.fragmentShader = shader.fragmentShader.replace(
            "#include <alphatest_fragment>",
            [
                "{",
                "    float alphaMul = opacity;",
                "    float a = texture2D(map, vMapUv).a * alphaMul;",
                "    float aL = texture2D(map, vMapUv + vec2(-1.0, 0.0) * uTexelSize).a * alphaMul;",
                "    float aR = texture2D(map, vMapUv + vec2( 1.0, 0.0) * uTexelSize).a * alphaMul;",
                "    float aU = texture2D(map, vMapUv + vec2(0.0,  1.0) * uTexelSize).a * alphaMul;",
                "    float aD = texture2D(map, vMapUv + vec2(0.0, -1.0) * uTexelSize).a * alphaMul;",
                "    float blurA = (a * 2.0 + aL + aR + aU + aD) / 6.0;",
                "    if (blurA < 0.01) discard;",
                "    diffuseColor.a = blurA;",
                "}",
            ].join("\n")
        );
    };
}

function getEnemySpriteConfigs(): Record<string, SpriteConfig> {
    ensureTexturesLoaded();
    return {
        bat: { texture: vampireBatTexture, width: 128, height: 128, spriteHeight: 1.4, color: 0xd2b48c, brightness: 0.2 },
        acid_slug: { texture: acidSlugTexture, width: 160, height: 128, spriteHeight: 1.4, brightness: 0.15, offsetY: -0.3, shadowSize: 0.6 },
        giant_amoeba_lg: { texture: amoebaLgTexture, width: 128, height: 128, spriteHeight: 2.4, opacity: 0.25 },
        giant_amoeba_md: { texture: amoebaMdTexture, width: 128, height: 128, spriteHeight: 1.7, opacity: 0.25 },
        giant_amoeba_sm: { texture: amoebaSmTexture, width: 128, height: 128, spriteHeight: 1.2, opacity: 0.25 },
        kraken_tentacle: { texture: krakenTentacleTexture, width: 80, height: 128, spriteHeight: 2.0, color: 0xd8c0e8 },
        baby_kraken: { texture: krakenBodyTexture, width: 128, height: 128, spriteHeight: 2.5, color: 0xd8c0e8 },
    };
}

// =============================================================================
// SPRITE CONFIG RESOLUTION
// =============================================================================

function resolveSpriteConfig(unit: Unit): SpriteConfig | undefined {
    const spriteConfigs = getSpriteConfigs();
    const enemySpriteConfigs = getEnemySpriteConfigs();

    // Player sprites are keyed by unit ID
    if (spriteConfigs[unit.id]) return spriteConfigs[unit.id];

    // Enemy sprites keyed by type (amoebas vary by split count)
    let enemySpriteKey: string | undefined = unit.enemyType;
    if (unit.enemyType === "giant_amoeba") {
        const splitCount = unit.splitCount ?? 0;
        if (splitCount === 0) enemySpriteKey = "giant_amoeba_lg";
        else if (splitCount === 1) enemySpriteKey = "giant_amoeba_md";
        else enemySpriteKey = "giant_amoeba_sm";
    }
    return enemySpriteKey ? enemySpriteConfigs[enemySpriteKey] : undefined;
}

// =============================================================================
// SHARED UNIT GROUP BUILDER
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
 * Build a complete unit group with mesh, shadow, light, rings, and shield indicator.
 * Single source of truth for unit visual creation — used by both initial scene setup
 * and dynamic spawning.
 */
function buildUnitGroup(
    scene: THREE.Scene,
    unit: Unit,
    billboards?: THREE.Mesh[]
): UnitCreationResult {
    const isPlayer = unit.team === "player";
    const data = getUnitStats(unit);
    const baseSize = (!isPlayer && "size" in data && data.size) ? data.size : 1;
    const size = getEffectiveSize(unit, baseSize);
    const group = new THREE.Group();

    const boxH = isPlayer ? 1 : (size > 1 ? 1.8 : 0.6);
    const boxW = 0.6 * size;
    const isAmoeba = unit.enemyType === "giant_amoeba";

    const spriteConfig = resolveSpriteConfig(unit);

    let unitMesh: THREE.Mesh;
    let billboard: THREE.Mesh | undefined;

    if (spriteConfig && billboards) {
        // Billboard plane that faces the camera and responds to lighting
        const spriteHeight = spriteConfig.spriteHeight ?? 1.8;
        const spriteWidth = spriteHeight * (spriteConfig.width / spriteConfig.height);
        const emissiveBoost = Math.min(0.2, 0.09 + (spriteConfig.brightness ?? 0.06));
        const spriteLightingBase = {
            emissiveIntensity: emissiveBoost,
            metalness: 0.02,
            roughness: 0.92
        };
        const planeMat = new THREE.MeshStandardMaterial({
            map: spriteConfig.texture,
            color: spriteConfig.color ?? 0xffffff,
            transparent: true,
            alphaTest: 0.01,
            opacity: spriteConfig.opacity ?? 1,
            side: THREE.DoubleSide,
            metalness: spriteLightingBase.metalness,
            roughness: spriteLightingBase.roughness,
            emissive: spriteConfig.color ?? 0xffffff,
            emissiveIntensity: spriteLightingBase.emissiveIntensity,
            emissiveMap: spriteConfig.texture,
        });
        planeMat.userData.spriteLightingBase = spriteLightingBase;
        applySpriteEdgeBlur(planeMat, spriteConfig.width, spriteConfig.height);
        const plane = new THREE.Mesh(new THREE.PlaneGeometry(spriteWidth, spriteHeight), planeMat);
        plane.position.y = spriteHeight / 2 + (spriteConfig.offsetY ?? 0);
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
            opacity: isAmoeba ? 0.25 : 1.0
        });
        const box = new THREE.Mesh(new THREE.BoxGeometry(boxW, boxH, boxW), boxMat);
        box.position.y = boxH / 2;
        box.userData.unitId = unit.id;
        group.add(box);
        unitMesh = box;
    }
    unitMesh.castShadow = false;
    unitMesh.receiveShadow = false;

    // Determine fly height early (needed for shadow positioning)
    const isFlying = !isPlayer && "flying" in data && data.flying;
    const flyHeight = isFlying ? 1.2 : 0;

    // Unit shadow - simple dark circle under unit
    // For flying units, offset shadow down so it stays on the ground
    const shadowRadius = spriteConfig?.shadowSize ?? boxW * 0.6;
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
// PUBLIC API
// =============================================================================

/**
 * Create a unit's scene group with mesh, selection ring, and other indicators.
 * Used during initial area setup for all units.
 */
export function createUnitSceneGroup(
    scene: THREE.Scene,
    unit: Unit,
    billboards: THREE.Mesh[]
): UnitCreationResult {
    return buildUnitGroup(scene, unit, billboards);
}

/**
 * Dynamically add a unit to the scene (for spawned units like broodlings).
 * Wires the created meshes into the provided ref dictionaries.
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
    maxHp: Record<number, number>,
    billboards?: THREE.Mesh[]
): void {
    const result = buildUnitGroup(scene, unit, billboards);
    const data = getUnitStats(unit);

    unitGroups[unit.id] = result.group;
    unitMeshes[unit.id] = result.mesh;
    unitOriginalColors[unit.id] = new THREE.Color(data.color);
    selectRings[unit.id] = result.selectRing;
    maxHp[unit.id] = (data as EnemyStats).maxHp ?? data.maxHp;

    if (result.targetRing) {
        targetRings[unit.id] = result.targetRing;
    }
    if (result.shieldIndicator) {
        shieldIndicators[unit.id] = result.shieldIndicator;
    }
}
