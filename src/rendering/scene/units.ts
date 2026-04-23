// =============================================================================
// UNIT CREATION - Create unit meshes, sprites, and selection indicators
// =============================================================================

import * as THREE from "three";
import type { Unit, UnitGroup } from "../../core/types";
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
import necromancerSpriteUrl from "../../assets/necromancer.png";
import skeletonWarriorSpriteUrl from "../../assets/skeleton_warrior.png";
import spineSpitterSpriteUrl from "../../assets/spine_spitter.png";
import undeadKnightSpriteUrl from "../../assets/undead_knight.png";

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Calculate effective size for a unit, accounting for amoeba split scaling
 */
function getEffectiveSize(unit: Unit, baseSize: number): number {
    if (unit.enemyType === "giant_amoeba" && unit.splitCount !== undefined) {
        // Each split reduces size: 2.0 → 1.4 → 1.0 → 0.7
        const scaleFactor = Math.pow(0.7, unit.splitCount);
        return baseSize * scaleFactor;
    }
    return baseSize;
}

// =============================================================================
// SPRITE TEXTURES (lazy-loaded and reused)
// =============================================================================

type SpriteTextureKey =
    | "wizard"
    | "barbarian"
    | "cleric"
    | "paladin"
    | "thief"
    | "monk"
    | "vampire_bat"
    | "basilisk_youngling"
    | "bloated_corpse"
    | "fire_imp"
    | "occultist_pygmy"
    | "wandering_shade"
    | "acid_slug"
    | "amoeba_lg"
    | "amoeba_md"
    | "amoeba_sm"
    | "armored_crab"
    | "broodling"
    | "brood_mother"
    | "corrupted_druid"
    | "crabling"
    | "feral_hound"
    | "kobold_archer"
    | "kobold_warrior"
    | "kobold_witch_doctor"
    | "kraken_tentacle"
    | "kraken_body"
    | "necromancer"
    | "skeleton_warrior"
    | "spine_spitter"
    | "undead_knight";

const SPRITE_TEXTURE_URLS: Record<SpriteTextureKey, string> = {
    wizard: wizardSpriteUrl,
    barbarian: barbarianSpriteUrl,
    cleric: clericSpriteUrl,
    paladin: paladinSpriteUrl,
    thief: thiefSpriteUrl,
    monk: monkSpriteUrl,
    vampire_bat: vampireBatSpriteUrl,
    basilisk_youngling: basiliskYounglingSpriteUrl,
    bloated_corpse: bloatedCorpseSpriteUrl,
    fire_imp: fireImpSpriteUrl,
    occultist_pygmy: occultistPygmySpriteUrl,
    wandering_shade: wanderingShadeSpriteUrl,
    acid_slug: acidSlugSpriteUrl,
    amoeba_lg: amoebaLgSpriteUrl,
    amoeba_md: amoebaMdSpriteUrl,
    amoeba_sm: amoebaSmSpriteUrl,
    armored_crab: armoredCrabSpriteUrl,
    broodling: broodlingSpriteUrl,
    brood_mother: broodMotherSpriteUrl,
    corrupted_druid: corruptedDruidSpriteUrl,
    crabling: crablingSpriteUrl,
    feral_hound: feralHoundSpriteUrl,
    kobold_archer: koboldArcherSpriteUrl,
    kobold_warrior: koboldWarriorSpriteUrl,
    kobold_witch_doctor: koboldWitchDoctorSpriteUrl,
    kraken_tentacle: krakenTentacleSpriteUrl,
    kraken_body: krakenBodySpriteUrl,
    necromancer: necromancerSpriteUrl,
    skeleton_warrior: skeletonWarriorSpriteUrl,
    spine_spitter: spineSpitterSpriteUrl,
    undead_knight: undeadKnightSpriteUrl,
};

const loadedSpriteTextures: Partial<Record<SpriteTextureKey, THREE.Texture>> = {};
const sharedTextureLoader = new THREE.TextureLoader();

function loadFilteredTexture(url: string): THREE.Texture {
    const tex = sharedTextureLoader.load(url);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    return tex;
}

function getOrLoadSpriteTexture(textureKey: SpriteTextureKey): THREE.Texture {
    const cached = loadedSpriteTextures[textureKey];
    if (cached) return cached;
    const next = loadFilteredTexture(SPRITE_TEXTURE_URLS[textureKey]);
    loadedSpriteTextures[textureKey] = next;
    return next;
}

/** Dispose all cached sprite textures. */
export function disposeLoadedTextures(): void {
    for (const textureKey of Object.keys(loadedSpriteTextures) as SpriteTextureKey[]) {
        const texture = loadedSpriteTextures[textureKey];
        if (texture) {
            texture.dispose();
        }
        delete loadedSpriteTextures[textureKey];
    }
}

function resolveSpriteTextureKey(unit: Unit): SpriteTextureKey | null {
    if (unit.team === "player") {
        const playerTextureByUnitId: Partial<Record<number, SpriteTextureKey>> = {
            1: "barbarian",
            2: "paladin",
            3: "thief",
            4: "wizard",
            5: "monk",
            6: "cleric",
            7: "barbarian",
        };
        return playerTextureByUnitId[unit.id] ?? null;
    }

    if (!unit.enemyType) {
        return null;
    }

    if (unit.enemyType === "giant_amoeba") {
        const splitCount = unit.splitCount ?? 0;
        if (splitCount === 0) return "amoeba_lg";
        if (splitCount === 1) return "amoeba_md";
        return "amoeba_sm";
    }

    const enemyTextureByType: Record<string, SpriteTextureKey> = {
        acid_slug: "acid_slug",
        armored_crab: "armored_crab",
        baby_kraken: "kraken_body",
        basilisk: "basilisk_youngling",
        bat: "vampire_bat",
        bloated_corpse: "bloated_corpse",
        brood_mother: "brood_mother",
        broodling: "broodling",
        chittering_crabling: "crabling",
        corrupt_druid: "corrupted_druid",
        feral_hound: "feral_hound",
        innkeeper: "monk",
        kobold: "kobold_warrior",
        kobold_archer: "kobold_archer",
        kobold_witch_doctor: "kobold_witch_doctor",
        kraken_tentacle: "kraken_tentacle",
        magma_imp: "fire_imp",
        necromancer: "necromancer",
        skeleton_warrior: "skeleton_warrior",
        occultist_pygmy: "occultist_pygmy",
        spine_spitter: "spine_spitter",
        undead_knight: "undead_knight",
        wandering_shade: "wandering_shade",
    };

    return enemyTextureByType[unit.enemyType] ?? null;
}

function ensureTextureLoadedForUnit(unit: Unit): void {
    const textureKey = resolveSpriteTextureKey(unit);
    if (!textureKey) return;
    getOrLoadSpriteTexture(textureKey);
}

/**
 * Load textures required by currently active units.
 * Keeps startup cost proportional to the current area content.
 */
export function ensureTexturesLoaded(units: Unit[]): void {
    for (const unit of units) {
        ensureTextureLoadedForUnit(unit);
    }
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

interface SpriteTemplate extends Omit<SpriteConfig, "texture"> {
    textureKey: SpriteTextureKey;
}

const PLAYER_SPRITE_TEMPLATES: Partial<Record<number, SpriteTemplate>> = {
    1: { textureKey: "barbarian", width: 196, height: 195, color: 0xdda298, spriteHeight: 1.8, offsetX: -0.1 },  // Barbarian - moderate brighten
    2: { textureKey: "paladin", width: 128, height: 196, color: 0xe3c07a, spriteHeight: 1.8 },    // Paladin - moderate brighten
    3: { textureKey: "thief", width: 128, height: 196, color: 0xc49ccd, spriteHeight: 1.8, offsetX: 0.06 },  // Thief - moderate brighten
    4: { textureKey: "wizard", width: 110, height: 196, color: 0x84bfdc, spriteHeight: 1.8 },     // Wizard - moderate brighten
    5: { textureKey: "monk", width: 128, height: 196, color: 0x79c59c, spriteHeight: 1.8, offsetX: -0.1 },  // Monk - moderate brighten
    6: { textureKey: "cleric", width: 128, height: 196, color: 0xc4ccd2, spriteHeight: 1.8 },   // Cleric - lightly desaturated
    7: { textureKey: "barbarian", width: 196, height: 195, color: 0xdfcfbb, spriteHeight: 2.0, offsetX: -0.1, brightness: 0.09, opacity: 0.3 }, // Ancestor summon - moderate brighten
};

function applySpriteToneMix(
    material: THREE.MeshStandardMaterial,
    toneMix: number = 0
): void {
    const clampedToneMix = Math.max(0, Math.min(1, toneMix));
    if (clampedToneMix <= 0.0001) {
        return;
    }

    const toneMixLiteral = clampedToneMix.toFixed(4);
    material.customProgramCacheKey = () => `sprite_tone_mix_${toneMixLiteral}`;
    material.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace(
            "#include <common>",
            [
                "#include <common>",
                `#define SPRITE_TONE_MIX ${toneMixLiteral}`,
            ].join("\n")
        );

        // Keep alpha test behavior on the default one-sample texture path,
        // then apply optional grayscale-to-color remap.
        shader.fragmentShader = shader.fragmentShader.replace(
            "#include <alphatest_fragment>",
            [
                "if ( diffuseColor.a < alphaTest ) discard;",
                "float gray = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));",
                "vec3 toned = gray * diffuse;",
                "diffuseColor.rgb = mix(diffuseColor.rgb, toned, SPRITE_TONE_MIX);",
            ].join("\n")
        );
    };
}

const ENEMY_SPRITE_TEMPLATES: Record<string, SpriteTemplate> = {
    acid_slug: { textureKey: "acid_slug", width: 160, height: 128, color: 0xa9e735, spriteHeight: 1.4, offsetY: -0.3, shadowSize: 0.6 },
    armored_crab: { textureKey: "armored_crab", width: 160, height: 128, color: 0xdf8fb3, spriteHeight: 1.8, offsetY: -0.22, shadowSize: 0.7 }, // slightly lighter and less saturated; lowered on shadow
    baby_kraken: { textureKey: "kraken_body", width: 128, height: 128, color: 0xb090c8, spriteHeight: 2.5, offsetY: -0.16 },
    basilisk: { textureKey: "basilisk_youngling", width: 238, height: 191, color: 0xd8e381, spriteHeight: 2.95, offsetY: -0.14, emissiveIntensity: 0.0, shadowSize: 1.05, toneMix: 1.0 }, // brighter, paler yellow-green; slightly smaller and lower
    bat: { textureKey: "vampire_bat", width: 128, height: 128, color: 0xba8678, spriteHeight: 1.4 }, // light red-brown
    bloated_corpse: { textureKey: "bloated_corpse", width: 128, height: 128, color: 0x7ab13b, spriteHeight: 2.45, shadowSize: 0.68 },
    brood_mother: { textureKey: "brood_mother", width: 164, height: 128, color: 0xae7ac2, spriteHeight: 2.25, offsetY: -0.12, shadowSize: 0.74 }, // lowered on shadow
    broodling: { textureKey: "broodling", width: 128, height: 128, color: 0xa079b4, spriteHeight: 1.0, shadowSize: 0.32 },
    chittering_crabling: { textureKey: "crabling", width: 128, height: 128, color: 0xec816c, spriteHeight: 1.15, offsetY: -0.14, shadowSize: 0.45 }, // lighter red
    corrupt_druid: { textureKey: "corrupted_druid", width: 96, height: 128, color: 0x598950, spriteHeight: 2.75, shadowSize: 0.52 }, // brighter, less saturated
    feral_hound: { textureKey: "feral_hound", width: 188, height: 128, color: 0xc2a17a, spriteHeight: 1.45, shadowSize: 0.55 },
    giant_amoeba_lg: { textureKey: "amoeba_lg", width: 128, height: 128, color: 0x14e063, spriteHeight: 2.4, opacity: 0.42 },
    giant_amoeba_md: { textureKey: "amoeba_md", width: 128, height: 128, color: 0x14e063, spriteHeight: 1.7, offsetY: -0.10, opacity: 0.42 },
    giant_amoeba_sm: { textureKey: "amoeba_sm", width: 128, height: 128, color: 0x14e063, spriteHeight: 1.2, offsetY: -0.14, opacity: 0.42 },
    innkeeper: { textureKey: "monk", width: 128, height: 196, color: 0xc18a52, spriteHeight: 1.95, shadowSize: 0.45 },
    kobold: { textureKey: "kobold_warrior", width: 128, height: 128, color: 0xc39976, spriteHeight: 1.85, offsetX: 0.06, shadowSize: 0.44 }, // light brown; slightly right
    kobold_archer: { textureKey: "kobold_archer", width: 128, height: 128, color: 0xad611c, spriteHeight: 1.85, shadowSize: 0.44 }, // touch brighter
    kobold_witch_doctor: { textureKey: "kobold_witch_doctor", width: 128, height: 128, color: 0x9576bf, spriteHeight: 1.85, shadowSize: 0.44 }, // brighter, less saturated
    magma_imp: { textureKey: "fire_imp", width: 128, height: 128, color: 0xf68b5a, spriteHeight: 1.85, shadowSize: 0.42 }, // lighter orange-red; larger sprite
    occultist_pygmy: { textureKey: "occultist_pygmy", width: 128, height: 128, color: 0x8d4a07, spriteHeight: 1.45, shadowSize: 0.38 },
    kraken_tentacle: { textureKey: "kraken_tentacle", width: 80, height: 128, color: 0x9880b8, spriteHeight: 2.0 },
    necromancer: { textureKey: "necromancer", width: 385, height: 620, color: 0xb08bb7, spriteHeight: 3.6, shadowSize: 0.62 },
    skeleton_warrior: { textureKey: "skeleton_warrior", width: 439, height: 556, color: 0x9a9060, spriteHeight: 2.45, shadowSize: 0.52 },
    spine_spitter: { textureKey: "spine_spitter", width: 363, height: 264, color: 0xc5a15c, spriteHeight: 1.35, offsetY: -0.12, shadowSize: 0.46 },
    undead_knight: { textureKey: "undead_knight", width: 105, height: 128, color: 0x6f8bb5, spriteHeight: 3.5, shadowSize: 0.7 }, // less saturated blue
    wandering_shade: { textureKey: "wandering_shade", width: 128, height: 128, color: 0xa0b0d8, spriteHeight: 2.0, shadowSize: 0.48, opacity: 0.55 },
};

function resolveEnemySpriteTemplate(unit: Unit): SpriteTemplate | undefined {
    if (!unit.enemyType) return undefined;
    if (unit.enemyType === "giant_amoeba") {
        const splitCount = unit.splitCount ?? 0;
        if (splitCount === 0) return ENEMY_SPRITE_TEMPLATES.giant_amoeba_lg;
        if (splitCount === 1) return ENEMY_SPRITE_TEMPLATES.giant_amoeba_md;
        return ENEMY_SPRITE_TEMPLATES.giant_amoeba_sm;
    }
    return ENEMY_SPRITE_TEMPLATES[unit.enemyType];
}

export function getEnemySpriteTintHex(enemyType: string): string | null {
    const key = enemyType === "giant_amoeba" ? "giant_amoeba_lg" : enemyType;
    const template = ENEMY_SPRITE_TEMPLATES[key];
    if (!template) return null;
    return `#${template.color.toString(16).padStart(6, "0")}`;
}

function toSpriteConfig(template: SpriteTemplate | undefined): SpriteConfig | undefined {
    if (!template) return undefined;
    const { textureKey, ...rest } = template;
    return {
        ...rest,
        texture: getOrLoadSpriteTexture(textureKey),
    };
}

// =============================================================================
// SPRITE CONFIG RESOLUTION
// =============================================================================

function resolveSpriteConfig(unit: Unit): SpriteConfig | undefined {
    ensureTextureLoadedForUnit(unit);

    // Player sprites are keyed by unit ID, but only for the player team.
    if (unit.team === "player") {
        return toSpriteConfig(PLAYER_SPRITE_TEMPLATES[unit.id]);
    }

    return toSpriteConfig(resolveEnemySpriteTemplate(unit));
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
    hpBarGroup?: THREE.Group;
}

// =============================================================================
// HP BAR MESHES
// =============================================================================

const HP_BAR_WIDTH = 0.8;
const HP_BAR_HEIGHT = 0.08;
const HP_BAR_Y_OFFSET = 2.2;

function createHpBarGroup(): THREE.Group {
    const group = new THREE.Group();
    group.position.set(0, 0, 0);

    const bgGeom = new THREE.PlaneGeometry(HP_BAR_WIDTH, HP_BAR_HEIGHT);
    const bgMat = new THREE.MeshBasicMaterial({
        color: 0x121222,
        depthTest: false,
        transparent: true,
        toneMapped: false,
    });
    const bg = new THREE.Mesh(bgGeom, bgMat);
    bg.renderOrder = 1200;
    group.add(bg);

    const fillGeom = new THREE.PlaneGeometry(HP_BAR_WIDTH, HP_BAR_HEIGHT);
    fillGeom.translate(HP_BAR_WIDTH / 2, 0, 0);
    const fillMat = new THREE.MeshBasicMaterial({
        color: 0x22c55e,
        depthTest: false,
        transparent: true,
        toneMapped: false,
    });
    const fill = new THREE.Mesh(fillGeom, fillMat);
    fill.position.set(-HP_BAR_WIDTH / 2, 0, 0.001);
    fill.renderOrder = 1201;
    group.add(fill);

    group.userData.fillMesh = fill;
    return group;
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
        applySpriteToneMix(planeMat, spriteConfig.toneMix ?? 0);
        const plane = new THREE.Mesh(new THREE.PlaneGeometry(spriteWidth, spriteHeight), planeMat);
        plane.position.y = spriteHeight / 2 + (spriteConfig.offsetY ?? 0);
        plane.position.x = spriteConfig.offsetX ?? 0;
        plane.userData.unitId = unit.id;
        plane.userData.isBillboard = true;
        group.add(plane);
        billboards.push(plane);
        unitMesh = plane;
        billboard = plane;
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

    // HP bar (player units only) — added to scene root (not group) so renderOrder is global
    let hpBarGroup: THREE.Group | undefined;
    if (isPlayer) {
        hpBarGroup = createHpBarGroup();
        hpBarGroup.position.set(unit.x, flyHeight + HP_BAR_Y_OFFSET, unit.z);
        scene.add(hpBarGroup);
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
        billboard,
        hpBarGroup,
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
    billboards?: THREE.Mesh[],
    hpBarGroups?: Record<number, THREE.Group>
): void {
    const result = buildUnitGroup(scene, unit, billboards);
    const data = getUnitStats(unit);

    unitGroups[unit.id] = result.group;
    unitMeshes[unit.id] = result.mesh;
    unitOriginalColors[unit.id] = result.baseColor.clone();
    selectRings[unit.id] = result.selectRing;
    maxHp[unit.id] = data.maxHp;

    if (result.targetRing) {
        targetRings[unit.id] = result.targetRing;
    }
    if (result.shieldIndicator) {
        shieldIndicators[unit.id] = result.shieldIndicator;
    }
    if (result.hpBarGroup && hpBarGroups) {
        hpBarGroups[unit.id] = result.hpBarGroup;
    }
}
