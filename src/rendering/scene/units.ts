// =============================================================================
// UNIT CREATION - Create unit meshes, sprites, and selection indicators
// =============================================================================

import * as THREE from "three";
import type { Unit, UnitGroup, EnemyStats } from "../../core/types";
import { SPRITE_DEFAULT_BRIGHTNESS } from "../../core/constants";
import { getUnitStats } from "../../game/units";
import { getUnitColor } from "../../game/unitColors";

// Import player sprite textures
import wizardSpriteUrl from "../../assets/wizard.png";
import barbarianSpriteUrl from "../../assets/barbarian.png";
import clericSpriteUrl from "../../assets/cleric.png";
import paladinSpriteUrl from "../../assets/paladin.png";
import thiefSpriteUrl from "../../assets/thief.png";
import monkSpriteUrl from "../../assets/monk.png";

// Import enemy sprite textures
import vampireBatSpriteUrl from "../../assets/vampire-bat.png";
import basiliskYounglingSpriteUrl from "../../assets/basilisk_youngling.png";
import bloatedCorpseSpriteUrl from "../../assets/bloated_corpse.png";
import fireImpSpriteUrl from "../../assets/fire_imp.png";
import occultistPygmySpriteUrl from "../../assets/occultist_pygmy.png";
import wanderingShadeSpriteUrl from "../../assets/wandering_shade.png";
import acidSlugSpriteUrl from "../../assets/acid-slug.png";
import amoebaLgSpriteUrl from "../../assets/amoeba-lg.png";
import amoebaMdSpriteUrl from "../../assets/amoeba-md.png";
import amoebaSmSpriteUrl from "../../assets/amoeba-sm.png";
import broodlingSpriteUrl from "../../assets/broodling.png";
import broodMotherSpriteUrl from "../../assets/brood_mother.png";
import corruptedDruidSpriteUrl from "../../assets/corrupted_druid.png";
import armoredCrabSpriteUrl from "../../assets/armored_crab.png";
import crablingSpriteUrl from "../../assets/crabling.png";
import feralHoundSpriteUrl from "../../assets/feral_hound.png";
import koboldArcherSpriteUrl from "../../assets/kobold_archer.png";
import koboldWarriorSpriteUrl from "../../assets/kobold_warrior.png";
import koboldWitchDoctorSpriteUrl from "../../assets/kobold_witch_doctor.png";
import krakenTentacleSpriteUrl from "../../assets/kraken-tentacle.png";
import krakenBodySpriteUrl from "../../assets/kraken-body.png";
import undeadKnightSpriteUrl from "../../assets/undead_knight.png";

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
let basiliskYounglingTexture: THREE.Texture;
let bloatedCorpseTexture: THREE.Texture;
let fireImpTexture: THREE.Texture;
let occultistPygmyTexture: THREE.Texture;
let wanderingShadeTexture: THREE.Texture;
let acidSlugTexture: THREE.Texture;
let amoebaLgTexture: THREE.Texture;
let amoebaMdTexture: THREE.Texture;
let amoebaSmTexture: THREE.Texture;
let armoredCrabTexture: THREE.Texture;
let broodlingTexture: THREE.Texture;
let broodMotherTexture: THREE.Texture;
let corruptedDruidTexture: THREE.Texture;
let crablingTexture: THREE.Texture;
let feralHoundTexture: THREE.Texture;
let koboldArcherTexture: THREE.Texture;
let koboldWarriorTexture: THREE.Texture;
let koboldWitchDoctorTexture: THREE.Texture;
let krakenTentacleTexture: THREE.Texture;
let krakenBodyTexture: THREE.Texture;
let undeadKnightTexture: THREE.Texture;

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
    basiliskYounglingTexture = loadFilteredTexture(basiliskYounglingSpriteUrl);
    bloatedCorpseTexture = loadFilteredTexture(bloatedCorpseSpriteUrl);
    fireImpTexture = loadFilteredTexture(fireImpSpriteUrl);
    occultistPygmyTexture = loadFilteredTexture(occultistPygmySpriteUrl);
    wanderingShadeTexture = loadFilteredTexture(wanderingShadeSpriteUrl);
    acidSlugTexture = loadFilteredTexture(acidSlugSpriteUrl);
    amoebaLgTexture = loadFilteredTexture(amoebaLgSpriteUrl);
    amoebaMdTexture = loadFilteredTexture(amoebaMdSpriteUrl);
    amoebaSmTexture = loadFilteredTexture(amoebaSmSpriteUrl);
    armoredCrabTexture = loadFilteredTexture(armoredCrabSpriteUrl);
    broodlingTexture = loadFilteredTexture(broodlingSpriteUrl);
    broodMotherTexture = loadFilteredTexture(broodMotherSpriteUrl);
    corruptedDruidTexture = loadFilteredTexture(corruptedDruidSpriteUrl);
    crablingTexture = loadFilteredTexture(crablingSpriteUrl);
    feralHoundTexture = loadFilteredTexture(feralHoundSpriteUrl);
    koboldArcherTexture = loadFilteredTexture(koboldArcherSpriteUrl);
    koboldWarriorTexture = loadFilteredTexture(koboldWarriorSpriteUrl);
    koboldWitchDoctorTexture = loadFilteredTexture(koboldWitchDoctorSpriteUrl);
    krakenTentacleTexture = loadFilteredTexture(krakenTentacleSpriteUrl);
    krakenBodyTexture = loadFilteredTexture(krakenBodySpriteUrl);
    undeadKnightTexture = loadFilteredTexture(undeadKnightSpriteUrl);

    texturesLoaded = true;
}

interface SpriteConfig {
    texture: THREE.Texture;
    width: number;
    height: number;
    color: number;
    offsetX?: number;
    offsetY?: number;       // Vertical offset (negative = lower on shadow)
    spriteHeight?: number;  // Override default 1.8 sprite height
    brightness?: number;    // Emissive boost override (default SPRITE_DEFAULT_BRIGHTNESS)
    emissiveIntensity?: number;  // Optional direct emissive intensity override
    shadowSize?: number;    // Override shadow radius
    opacity?: number;       // Transparency (0-1, default 1)
    toneMix?: number;       // 0-1 grayscale-to-color remap strength
}

function getSpriteConfigs(): Record<number, SpriteConfig> {
    ensureTexturesLoaded();
    return {
        1: { texture: barbarianTexture, width: 196, height: 195, color: 0xd08a7f, spriteHeight: 1.8, offsetX: -0.1 },  // Barbarian - lighter, lightly desaturated
        2: { texture: paladinTexture, width: 128, height: 196, color: 0xd8b062, spriteHeight: 1.8 },    // Paladin - lighter, lightly desaturated
        3: { texture: thiefTexture, width: 128, height: 196, color: 0xb487c0, spriteHeight: 1.8, offsetX: 0.1 },  // Thief - lightly desaturated
        4: { texture: wizardTexture, width: 110, height: 196, color: 0x68abd7, spriteHeight: 1.8 },     // Wizard - lighter, lightly desaturated
        5: { texture: monkTexture, width: 128, height: 196, color: 0x59b382, spriteHeight: 1.8, offsetX: -0.1 },  // Monk - lightly desaturated
        6: { texture: clericTexture, width: 128, height: 196, color: 0xc4ccd2, spriteHeight: 1.8 },   // Cleric - lightly desaturated
        7: { texture: barbarianTexture, width: 196, height: 195, color: 0xd4c3aa, spriteHeight: 2.0, offsetX: -0.1, brightness: 0.09, opacity: 0.3 }, // Ancestor summon
    };
}

function applySpriteEdgeBlur(
    material: THREE.MeshStandardMaterial,
    textureWidth: number,
    textureHeight: number,
    toneMix: number = 0
): void {
    const texelX = (1 / textureWidth).toFixed(8);
    const texelY = (1 / textureHeight).toFixed(8);
    const clampedToneMix = Math.max(0, Math.min(1, toneMix));
    const toneMixLiteral = clampedToneMix.toFixed(4);
    material.customProgramCacheKey = () => `sprite_edge_blur_${textureWidth}x${textureHeight}_${toneMixLiteral}`;
    material.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace(
            "#include <common>",
            [
                "#include <common>",
                `#define SPRITE_TEXEL_X ${texelX}`,
                `#define SPRITE_TEXEL_Y ${texelY}`,
                `#define SPRITE_TONE_MIX ${toneMixLiteral}`,
            ].join("\n")
        );
        // 2D Gaussian blur over a 5-texel-wide kernel (13 samples):
        // center + 4 cardinal at 1tx + 4 diagonal at 1tx + 4 cardinal at 2tx
        // Weights approximate a Gaussian: center=4, card1=2, diag1=1, card2=1 → /20
        shader.fragmentShader = shader.fragmentShader.replace(
            "#include <alphatest_fragment>",
            [
                "{",
                "    float am = opacity;",
                "    vec2 ts = vec2(SPRITE_TEXEL_X, SPRITE_TEXEL_Y);",
                "    float a   = texture2D(map, vMapUv).a * am;",
                "    float aL1 = texture2D(map, vMapUv + vec2(-1.0, 0.0) * ts).a * am;",
                "    float aR1 = texture2D(map, vMapUv + vec2( 1.0, 0.0) * ts).a * am;",
                "    float aU1 = texture2D(map, vMapUv + vec2(0.0,  1.0) * ts).a * am;",
                "    float aD1 = texture2D(map, vMapUv + vec2(0.0, -1.0) * ts).a * am;",
                "    float aL2 = texture2D(map, vMapUv + vec2(-2.0, 0.0) * ts).a * am;",
                "    float aR2 = texture2D(map, vMapUv + vec2( 2.0, 0.0) * ts).a * am;",
                "    float aU2 = texture2D(map, vMapUv + vec2(0.0,  2.0) * ts).a * am;",
                "    float aD2 = texture2D(map, vMapUv + vec2(0.0, -2.0) * ts).a * am;",
                "    float aDL = texture2D(map, vMapUv + vec2(-1.0, -1.0) * ts).a * am;",
                "    float aDR = texture2D(map, vMapUv + vec2( 1.0, -1.0) * ts).a * am;",
                "    float aUL = texture2D(map, vMapUv + vec2(-1.0,  1.0) * ts).a * am;",
                "    float aUR = texture2D(map, vMapUv + vec2( 1.0,  1.0) * ts).a * am;",
                "    float blurA = (a * 4.0 + (aL1 + aR1 + aU1 + aD1) * 2.0 + (aDL + aDR + aUL + aUR) + (aL2 + aR2 + aU2 + aD2)) / 20.0;",
                "    if (blurA < 0.15) discard;",
                "    diffuseColor.a = blurA;",
                "    float gray = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));",
                "    vec3 toned = gray * diffuse;",
                "    diffuseColor.rgb = mix(diffuseColor.rgb, toned, SPRITE_TONE_MIX);",
                "}",
            ].join("\n")
        );
    };
}

function getEnemySpriteConfigs(): Record<string, SpriteConfig> {
    ensureTexturesLoaded();
    return {
        acid_slug: { texture: acidSlugTexture, width: 160, height: 128, color: 0xa9e735, spriteHeight: 1.4, offsetY: -0.3, shadowSize: 0.6 },
        armored_crab: { texture: armoredCrabTexture, width: 160, height: 128, color: 0xdf8fb3, spriteHeight: 1.8, offsetY: -0.22, shadowSize: 0.7 }, // slightly lighter and less saturated; lowered on shadow
        baby_kraken: { texture: krakenBodyTexture, width: 128, height: 128, color: 0xa85ae3, spriteHeight: 2.5, offsetY: -0.16 },
        basilisk: { texture: basiliskYounglingTexture, width: 238, height: 191, color: 0xd8e381, spriteHeight: 2.95, offsetY: -0.14, emissiveIntensity: 0.0, shadowSize: 1.05, toneMix: 1.0 }, // brighter, paler yellow-green; slightly smaller and lower
        bat: { texture: vampireBatTexture, width: 128, height: 128, color: 0xba8678, spriteHeight: 1.4 }, // light red-brown
        bloated_corpse: { texture: bloatedCorpseTexture, width: 128, height: 128, color: 0x7ab13b, spriteHeight: 2.05, shadowSize: 0.62 },
        brood_mother: { texture: broodMotherTexture, width: 164, height: 128, color: 0xae7ac2, spriteHeight: 2.25, offsetY: -0.12, shadowSize: 0.74 }, // lowered on shadow
        broodling: { texture: broodlingTexture, width: 128, height: 128, color: 0xa079b4, spriteHeight: 1.0, shadowSize: 0.32 },
        chittering_crabling: { texture: crablingTexture, width: 128, height: 128, color: 0xec816c, spriteHeight: 1.15, offsetY: -0.14, shadowSize: 0.45 }, // lighter red
        corrupt_druid: { texture: corruptedDruidTexture, width: 96, height: 128, color: 0x598950, spriteHeight: 2.35 }, // brighter, less saturated
        feral_hound: { texture: feralHoundTexture, width: 188, height: 128, color: 0xc2a17a, spriteHeight: 1.45, shadowSize: 0.55 },
        giant_amoeba_lg: { texture: amoebaLgTexture, width: 128, height: 128, color: 0x14e063, spriteHeight: 2.4, opacity: 0.42 },
        giant_amoeba_md: { texture: amoebaMdTexture, width: 128, height: 128, color: 0x14e063, spriteHeight: 1.7, offsetY: -0.10, opacity: 0.42 },
        giant_amoeba_sm: { texture: amoebaSmTexture, width: 128, height: 128, color: 0x14e063, spriteHeight: 1.2, offsetY: -0.14, opacity: 0.42 },
        innkeeper: { texture: monkTexture, width: 128, height: 196, color: 0xc18a52, spriteHeight: 1.95, shadowSize: 0.45 },
        kobold: { texture: koboldWarriorTexture, width: 128, height: 128, color: 0xc39976, spriteHeight: 1.61, offsetX: 0.06, shadowSize: 0.4 }, // light brown; slightly right
        kobold_archer: { texture: koboldArcherTexture, width: 128, height: 128, color: 0xad611c, spriteHeight: 1.61, shadowSize: 0.4 }, // touch brighter
        kobold_witch_doctor: { texture: koboldWitchDoctorTexture, width: 128, height: 128, color: 0x9576bf, spriteHeight: 1.61, shadowSize: 0.4 }, // brighter, less saturated
        magma_imp: { texture: fireImpTexture, width: 128, height: 128, color: 0xf68b5a, spriteHeight: 1.85, shadowSize: 0.42 }, // lighter orange-red; larger sprite
        occultist_pygmy: { texture: occultistPygmyTexture, width: 128, height: 128, color: 0x8d4a07, spriteHeight: 1.0, shadowSize: 0.32 },
        kraken_tentacle: { texture: krakenTentacleTexture, width: 80, height: 128, color: 0x924adb, spriteHeight: 2.0 },
        undead_knight: { texture: undeadKnightTexture, width: 105, height: 128, color: 0x6f8bb5, spriteHeight: 3.5, shadowSize: 0.7 }, // less saturated blue
        wandering_shade: { texture: wanderingShadeTexture, width: 128, height: 128, color: 0x748ec9, spriteHeight: 2.05, shadowSize: 0.44, opacity: 0.68 },
    };
}

// =============================================================================
// SPRITE CONFIG RESOLUTION
// =============================================================================

function resolveSpriteConfig(unit: Unit): SpriteConfig | undefined {
    const playerSpriteConfigs = getSpriteConfigs();
    const enemySpriteConfigs = getEnemySpriteConfigs();

    // Player sprites are keyed by unit ID, but only for the player team.
    if (unit.team === "player") {
        return playerSpriteConfigs[unit.id];
    }

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
    baseColor: THREE.Color;
    selectRing: THREE.Mesh;
    targetRing?: THREE.Mesh;
    shieldIndicator?: THREE.Mesh;
    billboard?: THREE.Mesh;
}

const UNIT_RING_SEGMENTS = 64;

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
    const fallbackShape = isPlayer && "shape" in data ? data.shape : "box";
    const unitColor = getUnitColor(unit);

    const spriteConfig = resolveSpriteConfig(unit);
    const resolvedBaseColor = new THREE.Color(unitColor);

    let unitMesh: THREE.Mesh;
    let billboard: THREE.Mesh | undefined;

    if (spriteConfig && billboards) {
        // Billboard plane that faces the camera and responds to lighting
        const spriteHeight = spriteConfig.spriteHeight ?? 1.8;
        const spriteWidth = spriteHeight * (spriteConfig.width / spriteConfig.height);
        const spriteColor = spriteConfig.color;
        resolvedBaseColor.setHex(spriteColor);
        const emissiveBoost = spriteConfig.emissiveIntensity ?? Math.min(0.2, 0.09 + (spriteConfig.brightness ?? SPRITE_DEFAULT_BRIGHTNESS));
        const spriteLightingBase = {
            emissiveIntensity: emissiveBoost,
            metalness: 0.02,
            roughness: 0.92
        };
        const planeMat = new THREE.MeshStandardMaterial({
            map: spriteConfig.texture,
            color: spriteColor,
            transparent: true,
            alphaTest: 0.01,
            opacity: spriteConfig.opacity ?? 1,
            side: THREE.DoubleSide,
            metalness: spriteLightingBase.metalness,
            roughness: spriteLightingBase.roughness,
            emissive: spriteColor,
            emissiveIntensity: spriteLightingBase.emissiveIntensity,
            emissiveMap: spriteConfig.texture,
        });
        planeMat.userData.spriteLightingBase = spriteLightingBase;
        planeMat.userData.spriteBaseColor = new THREE.Color(spriteColor);
        applySpriteEdgeBlur(planeMat, spriteConfig.width, spriteConfig.height, spriteConfig.toneMix ?? 0);
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
            color: unitColor,
            metalness: 0.3,
            roughness: 0.6
        });
        const cone = new THREE.Mesh(new THREE.ConeGeometry(boxW * 0.5, boxH * 1.5, 8), coneMat);
        cone.position.y = boxH * 0.75;
        cone.userData.unitId = unit.id;
        group.add(cone);
        unitMesh = cone;
    } else {
        // Fallback meshes for units without sprites.
        const fallbackMat = new THREE.MeshStandardMaterial({
            color: unitColor,
            emissive: fallbackShape === "sphere" ? new THREE.Color(unitColor) : new THREE.Color(0x000000),
            emissiveIntensity: fallbackShape === "sphere" ? 0.32 : 0,
            metalness: isAmoeba ? 0.1 : 0.5,
            roughness: isAmoeba ? 0.2 : 0.4,
            transparent: isAmoeba,
            opacity: isAmoeba ? 0.58 : 1.0
        });
        if (fallbackShape === "sphere") {
            const radius = Math.max(0.16, size * 0.34);
            const sphere = new THREE.Mesh(new THREE.SphereGeometry(radius, 16, 12), fallbackMat);
            sphere.position.y = radius + 0.08;
            sphere.userData.unitId = unit.id;
            group.add(sphere);
            unitMesh = sphere;
        } else {
            const box = new THREE.Mesh(new THREE.BoxGeometry(boxW, boxH, boxW), fallbackMat);
            box.position.y = boxH / 2;
            box.userData.unitId = unit.id;
            group.add(box);
            unitMesh = box;
        }
    }
    unitMesh.castShadow = false;
    unitMesh.receiveShadow = false;

    // Determine fly height early (needed for shadow positioning)
    const isFlying = !isPlayer && "flying" in data && data.flying;
    const flyHeight = isFlying ? 1.2 : (unit.flyHeight ?? 0);

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

    // Per-unit point lights are disabled to keep light count stable and low.

    // Selection ring
    const selInner = 0.5 * size;
    const selOuter = 0.54 * size;
    const selectRing = new THREE.Mesh(
        new THREE.RingGeometry(selInner, selOuter, UNIT_RING_SEGMENTS),
        new THREE.MeshBasicMaterial({
            color: "#00ff00",
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.95,
            depthTest: true,
            depthWrite: false,
            toneMapped: false,
            polygonOffset: true,
            polygonOffsetFactor: -2,
            polygonOffsetUnits: -2
        })
    );
    selectRing.rotation.x = -Math.PI / 2;
    selectRing.position.y = 0.05;
    selectRing.renderOrder = 200;
    selectRing.visible = false;
    group.add(selectRing);

    // Target ring (red) for enemies - shows when player targets them
    let targetRing: THREE.Mesh | undefined;
    let shieldIndicator: THREE.Mesh | undefined;

    if (unit.team === "enemy") {
        targetRing = new THREE.Mesh(
            new THREE.RingGeometry(selInner, selOuter, UNIT_RING_SEGMENTS),
            new THREE.MeshBasicMaterial({
                color: "#ff0000",
                side: THREE.DoubleSide,
                transparent: true,
                opacity: 0.95,
                depthTest: true,
                depthWrite: false,
                toneMapped: false,
                polygonOffset: true,
                polygonOffsetFactor: -2,
                polygonOffsetUnits: -2
            })
        );
        targetRing.rotation.x = -Math.PI / 2;
        targetRing.position.y = 0.05;
        targetRing.renderOrder = 200;
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
        baseColor: resolvedBaseColor,
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
    unitOriginalColors[unit.id] = result.baseColor.clone();
    selectRings[unit.id] = result.selectRing;
    maxHp[unit.id] = (data as EnemyStats).maxHp ?? data.maxHp;

    if (result.targetRing) {
        targetRings[unit.id] = result.targetRing;
    }
    if (result.shieldIndicator) {
        shieldIndicators[unit.id] = result.shieldIndicator;
    }
}
