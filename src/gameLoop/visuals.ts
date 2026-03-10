// =============================================================================
// VISUAL EFFECTS - Damage texts, hit flash, poison visuals, fog of war
// =============================================================================

import * as THREE from "three";
import type { Unit, DamageText, UnitGroup, FogTexture } from "../core/types";
import { FOG_SCALE, FLASH_DURATION, ENRAGED_TINT_STRENGTH } from "../core/constants";
import { hasStatusEffect } from "../combat/combatMath";
import { updateVisibility, resetVisibilityTracking } from "../ai/pathfinding";
import { getCurrentArea } from "../game/areas";
import { isEnemyHiddenFromView } from "./enemyBehaviors";
import { recycleDamageNumber } from "../combat/damageEffects";

// =============================================================================
// DAMAGE TEXT UPDATE
// =============================================================================

export function updateDamageTexts(
    damageTexts: DamageText[],
    camera: THREE.OrthographicCamera,
    scene: THREE.Scene,
    paused: boolean
): DamageText[] {
    let writeIndex = 0;
    for (let i = 0; i < damageTexts.length; i++) {
        const dt = damageTexts[i];
        dt.mesh.quaternion.copy(camera.quaternion);
        if (!paused) {
            dt.mesh.position.y += 0.02;
            dt.life -= 16;
            (dt.mesh.material as THREE.MeshBasicMaterial).opacity = dt.life / 1000;
            if (dt.life <= 0) {
                recycleDamageNumber(scene, dt.mesh);
                continue;
            }
        }
        damageTexts[writeIndex] = dt;
        writeIndex++;
    }
    damageTexts.length = writeIndex;
    return damageTexts;
}

// =============================================================================
// HIT FLASH EFFECT
// =============================================================================

// Pre-allocated color objects to avoid allocations every frame
const _flashWhite = new THREE.Color(1, 1, 1);
const _enragedTint = new THREE.Color(0xcc3300);
const _tempColor = new THREE.Color();

function isColorMaterial(material: THREE.Material): material is THREE.MeshStandardMaterial | THREE.MeshPhongMaterial | THREE.MeshBasicMaterial {
    return material instanceof THREE.MeshStandardMaterial
        || material instanceof THREE.MeshPhongMaterial
        || material instanceof THREE.MeshBasicMaterial;
}

function isSpriteMesh(mesh: THREE.Mesh): boolean {
    return mesh.userData?.isBillboard === true;
}

function getColorMaterial(mesh: THREE.Mesh): THREE.MeshStandardMaterial | THREE.MeshPhongMaterial | THREE.MeshBasicMaterial | null {
    const material = mesh.material;
    if (Array.isArray(material)) {
        for (const mat of material) {
            if (isColorMaterial(mat)) return mat;
        }
        return null;
    }
    return isColorMaterial(material) ? material : null;
}

function getSpriteBaseColor(
    colorMaterial: THREE.MeshStandardMaterial | THREE.MeshPhongMaterial | THREE.MeshBasicMaterial,
    fallbackColor: THREE.Color
): THREE.Color {
    const spriteBaseColor = colorMaterial.userData.spriteBaseColor;
    return spriteBaseColor instanceof THREE.Color ? spriteBaseColor : fallbackColor;
}

export function updateHitFlash(
    hitFlashRef: Record<number, number>,
    unitMeshRef: Record<number, THREE.Mesh>,
    unitOriginalColorRef: Record<number, THREE.Color>,
    now: number
): void {
    for (const id in hitFlashRef) {
        const numId = Number(id);
        const mesh = unitMeshRef[numId];
        const originalColor = unitOriginalColorRef[numId];
        if (!mesh || !originalColor) continue;
        const colorMaterial = getColorMaterial(mesh);
        if (!colorMaterial) continue;
        const elapsed = now - hitFlashRef[numId];

        if (elapsed > FLASH_DURATION) {
            if (isSpriteMesh(mesh)) {
                colorMaterial.color.copy(getSpriteBaseColor(colorMaterial, originalColor));
            } else {
                colorMaterial.color.copy(originalColor);
            }
            delete hitFlashRef[numId];
        } else {
            if (isSpriteMesh(mesh)) {
                // Keep sprites at base color; no runtime tinting.
                colorMaterial.color.copy(getSpriteBaseColor(colorMaterial, originalColor));
            } else {
                const t = elapsed / FLASH_DURATION;
                _tempColor.copy(_flashWhite).lerp(originalColor, t);
                colorMaterial.color.copy(_tempColor);
            }
        }
    }
}

export function updatePoisonVisuals(
    unitsState: Unit[],
    unitMeshRef: Record<number, THREE.Mesh>,
    unitOriginalColorRef: Record<number, THREE.Color>,
    hitFlashRef: Record<number, number>
): void {
    for (const unit of unitsState) {
        const mesh = unitMeshRef[unit.id];
        const originalColor = unitOriginalColorRef[unit.id];
        if (!mesh || !originalColor) continue;
        const colorMaterial = getColorMaterial(mesh);
        if (!colorMaterial) continue;

        // Skip if currently flashing (hit flash will handle the color)
        if (hitFlashRef[unit.id] !== undefined) continue;

        if (isSpriteMesh(mesh)) {
            // Keep sprites at their configured base color.
            colorMaterial.color.copy(getSpriteBaseColor(colorMaterial, originalColor));
            continue;
        }

        // Reset to original color, then overlay status tints
        colorMaterial.color.copy(originalColor);

        if (hasStatusEffect(unit, "enraged")) {
            colorMaterial.color.lerp(_enragedTint, ENRAGED_TINT_STRENGTH);
        }
    }
}

// =============================================================================
// ENERGY SHIELD BUBBLE VISUAL
// =============================================================================

const ENERGY_SHIELD_BUBBLE_NAME = "energyShieldBubble";

// Shared geometry for all shield bubbles — avoids re-creating per unit
const sharedBubbleGeometry = new THREE.SphereGeometry(0.7, 24, 16);

export function updateEnergyShieldVisuals(
    unitsState: Unit[],
    unitsRef: Record<number, UnitGroup>,
    now: number
): void {
    for (const unit of unitsState) {
        const unitGroup = unitsRef[unit.id];
        if (!unitGroup) continue;

        const effects = unit.statusEffects;
        const hasBarrier = effects !== undefined && effects.length > 0
            && effects.some(e => e.type === "energy_shield" || e.type === "divine_lattice");
        if (!hasBarrier) {
            // Fast path: remove bubble if present
            const existing = unitGroup.getObjectByName(ENERGY_SHIELD_BUBBLE_NAME) as THREE.Mesh | undefined;
            if (existing) {
                unitGroup.remove(existing);
                (existing.material as THREE.MeshBasicMaterial).dispose();
            }
            continue;
        }

        const hasDivineLattice = effects.some(e => e.type === "divine_lattice");
        const existingBubble = unitGroup.getObjectByName(ENERGY_SHIELD_BUBBLE_NAME) as THREE.Mesh | undefined;

        if (!existingBubble) {
            const bubbleColor = hasDivineLattice ? 0xffffff : 0x66ccff;
            const bubbleOpacity = hasDivineLattice ? 0.22 : 0.25;
            const bubbleMaterial = new THREE.MeshBasicMaterial({
                color: bubbleColor,
                transparent: true,
                opacity: bubbleOpacity,
                side: THREE.DoubleSide,
                depthWrite: false
            });
            const bubble = new THREE.Mesh(sharedBubbleGeometry, bubbleMaterial);
            bubble.name = ENERGY_SHIELD_BUBBLE_NAME;
            bubble.position.y = 0.5;
            unitGroup.add(bubble);
        } else {
            const bubbleMat = existingBubble.material as THREE.MeshBasicMaterial;
            if (hasDivineLattice) {
                bubbleMat.color.setHex(0xffffff);
                bubbleMat.opacity = 0.22;
            } else {
                bubbleMat.color.setHex(0x66ccff);
                bubbleMat.opacity = 0.25;
            }
            // Animate bubble - subtle pulse
            const pulse = Math.sin(now * 0.003) * 0.05 + 1;
            existingBubble.scale.setScalar(pulse);
            // Subtle rotation
            existingBubble.rotation.y += 0.01;
        }
    }
}

// =============================================================================
// FOG OF WAR UPDATE
// =============================================================================

let lastFogVisibilityKey = 0;
let hasFogVisibilityKey = false;
let lastFogAreaId: string | null = null;
const ENEMY_VIEW_FADE_LERP = 0.32;
const ENEMY_VIEW_FADE_MIN_VISIBLE = 0.02;

interface ViewFadeLightEntry {
    light: THREE.Light;
    baseIntensity: number;
}

interface ViewFadeMaterialEntry {
    material: THREE.Material;
    baseOpacity: number;
}

interface ViewFadeCache {
    lights: ViewFadeLightEntry[];
    materials: ViewFadeMaterialEntry[];
}

function computePlayerVisibilityKey(
    playerUnits: Unit[],
    unitsRef: Record<number, UnitGroup>
): number {
    let visibilityKey = 2166136261;

    for (const unit of playerUnits) {
        const group = unitsRef[unit.id];
        if (!group) continue;
        const x = Math.round(group.position.x);
        const z = Math.round(group.position.z);
        visibilityKey = Math.imul(visibilityKey ^ unit.id, 16777619);
        visibilityKey = Math.imul(visibilityKey ^ x, 16777619);
        visibilityKey = Math.imul(visibilityKey ^ z, 16777619);
    }

    return visibilityKey >>> 0;
}

function buildViewFadeCache(group: UnitGroup): ViewFadeCache {
    const lights: ViewFadeLightEntry[] = [];
    const materials: ViewFadeMaterialEntry[] = [];
    const seenMaterials = new Set<THREE.Material>();

    group.traverse(obj => {
        if (obj instanceof THREE.Light) {
            const baseIntensityRaw = obj.userData.viewFadeBaseIntensity;
            const baseIntensity = typeof baseIntensityRaw === "number" ? baseIntensityRaw : obj.intensity;
            if (typeof baseIntensityRaw !== "number") {
                obj.userData.viewFadeBaseIntensity = baseIntensity;
            }
            lights.push({ light: obj, baseIntensity });
            return;
        }

        if (!(obj instanceof THREE.Mesh)) return;
        const meshMaterials = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const material of meshMaterials) {
            if (seenMaterials.has(material)) continue;
            seenMaterials.add(material);

            const baseOpacityRaw = material.userData.viewFadeBaseOpacity;
            const baseOpacity = typeof baseOpacityRaw === "number" ? baseOpacityRaw : material.opacity;
            if (typeof baseOpacityRaw !== "number") {
                material.userData.viewFadeBaseOpacity = baseOpacity;
            }
            materials.push({ material, baseOpacity });
        }
    });

    return { lights, materials };
}

function getViewFadeCache(group: UnitGroup): ViewFadeCache {
    const childCount = group.children.length;
    const ud = group.userData as Record<string, unknown>;
    const cachedChildCountRaw = ud.viewFadeCacheChildCount;
    const cachedRaw = ud.viewFadeCache;
    if (
        cachedRaw
        && typeof cachedRaw === "object"
        && Array.isArray((cachedRaw as ViewFadeCache).lights)
        && Array.isArray((cachedRaw as ViewFadeCache).materials)
        && typeof cachedChildCountRaw === "number"
        && cachedChildCountRaw === childCount
    ) {
        return cachedRaw as ViewFadeCache;
    }

    const nextCache = buildViewFadeCache(group);
    ud.viewFadeCache = nextCache;
    ud.viewFadeCacheChildCount = childCount;
    return nextCache;
}

function applyViewFadeToGroup(group: UnitGroup, opacity: number): void {
    const clampedOpacity = THREE.MathUtils.clamp(opacity, 0, 1);
    const rawPrevious = group.userData.viewFadeOpacity;
    if (typeof rawPrevious === "number" && Math.abs(rawPrevious - clampedOpacity) < 0.001) {
        return;
    }

    group.userData.viewFadeOpacity = clampedOpacity;
    const cache = getViewFadeCache(group);

    for (const lightEntry of cache.lights) {
        const { light, baseIntensity } = lightEntry;
        light.intensity = baseIntensity * clampedOpacity;
        light.visible = clampedOpacity > ENEMY_VIEW_FADE_MIN_VISIBLE;
    }

    for (const materialEntry of cache.materials) {
        const { material, baseOpacity } = materialEntry;
        material.opacity = baseOpacity * clampedOpacity;
        if (!material.transparent && (baseOpacity < 1 || clampedOpacity < 1)) {
            material.transparent = true;
        }
    }
}

function hideEnemyGroup(group: UnitGroup): void {
    const rawOpacity = group.userData.viewFadeOpacity;
    const opacity = typeof rawOpacity === "number" ? rawOpacity : 1;
    if (!group.visible && opacity <= ENEMY_VIEW_FADE_MIN_VISIBLE) {
        return;
    }
    group.visible = false;
    applyViewFadeToGroup(group, 0);
}

function updateEnemyGroupFade(group: UnitGroup, shouldBeVisible: boolean): void {
    const rawOpacity = group.userData.viewFadeOpacity;
    const currentOpacity = typeof rawOpacity === "number" ? rawOpacity : (shouldBeVisible ? 1 : 0);
    const targetOpacity = shouldBeVisible ? 1 : 0;
    if (Math.abs(currentOpacity - targetOpacity) < 0.001) {
        if (typeof rawOpacity !== "number") {
            applyViewFadeToGroup(group, targetOpacity);
        }
        group.visible = shouldBeVisible || targetOpacity > ENEMY_VIEW_FADE_MIN_VISIBLE;
        if (!shouldBeVisible && targetOpacity <= ENEMY_VIEW_FADE_MIN_VISIBLE) {
            group.visible = false;
        }
        return;
    }

    let nextOpacity = THREE.MathUtils.lerp(currentOpacity, targetOpacity, ENEMY_VIEW_FADE_LERP);

    if (Math.abs(nextOpacity - targetOpacity) < 0.02) {
        nextOpacity = targetOpacity;
    }

    group.visible = shouldBeVisible || nextOpacity > ENEMY_VIEW_FADE_MIN_VISIBLE;
    applyViewFadeToGroup(group, nextOpacity);

    if (!shouldBeVisible && nextOpacity <= ENEMY_VIEW_FADE_MIN_VISIBLE) {
        group.visible = false;
    }
}

/**
 * Reset fog hash cache (call on game restart).
 */
export function resetFogCache(): void {
    lastFogVisibilityKey = 0;
    hasFogVisibilityKey = false;
    lastFogAreaId = null;
    resetVisibilityTracking();
}

export function updateFogOfWar(
    visibility: number[][],
    playerUnits: Unit[],
    unitsRef: Record<number, UnitGroup>,
    fogTexture: FogTexture,
    unitsState: Unit[],
    fogMesh: THREE.Mesh
): boolean {
    const area = getCurrentArea();
    if (lastFogAreaId !== area.id) {
        lastFogAreaId = area.id;
        hasFogVisibilityKey = false;
        resetVisibilityTracking();
    }

    // If area doesn't have fog of war, clear and hide it
    if (!area.hasFogOfWar) {
        fogMesh.visible = false;
        hasFogVisibilityKey = false;
        // Make all enemies visible (except hidden enemy states).
        for (const u of unitsState) {
            if (u.team !== "enemy") continue;
            const g = unitsRef[u.id];
            if (!g) continue;
            if (u.hp <= 0) {
                hideEnemyGroup(g);
                continue;
            }
            updateEnemyGroupFade(g, !isEnemyHiddenFromView(u.id));
        }
        return false;
    }

    // Ensure fog mesh is visible for areas with fog
    fogMesh.visible = true;

    const visibilityKey = computePlayerVisibilityKey(playerUnits, unitsRef);
    const shouldRecomputeVisibility = !hasFogVisibilityKey || visibilityKey !== lastFogVisibilityKey;
    let visibilityChanged = false;

    if (shouldRecomputeVisibility) {
        hasFogVisibilityKey = true;
        lastFogVisibilityKey = visibilityKey;

        const fogChanged = updateVisibility(visibility, playerUnits, { current: unitsRef });
        visibilityChanged = fogChanged;

        // Only redraw fog texture if visibility actually changed
        if (fogChanged) {

            const { ctx, texture } = fogTexture;

            ctx.clearRect(0, 0, area.gridWidth * FOG_SCALE, area.gridHeight * FOG_SCALE);

            // Simple fog rendering without expensive distance calculations
            // Use fixed alpha values - the texture filtering provides some softness
            for (let x = 0; x < area.gridWidth; x++) {
                for (let z = 0; z < area.gridHeight; z++) {
                    const vis = visibility[x][z];
                    if (vis === 2) continue;  // Visible - no fog

                    // Simple alpha: seen = 0.4, unexplored = 1.0
                    ctx.fillStyle = vis === 1 ? "rgba(0,0,0,0.4)" : "rgba(0,0,0,1)";
                    ctx.fillRect(x * FOG_SCALE, z * FOG_SCALE, FOG_SCALE, FOG_SCALE);
                }
            }

            texture.needsUpdate = true;
        }
    }

    // Hide enemies in fog (always check this) - also hide hidden enemy states.
    for (const u of unitsState) {
        if (u.team !== "enemy") continue;
        const g = unitsRef[u.id];
        if (!g) continue;
        if (u.hp <= 0) {
            hideEnemyGroup(g);
            continue;
        }
        const cx = Math.floor(g.position.x), cz = Math.floor(g.position.z);
        const vis = visibility[cx]?.[cz] ?? 0;
        const shouldBeVisible = vis === 2 && !isEnemyHiddenFromView(u.id);
        updateEnemyGroupFade(g, shouldBeVisible);
    }

    return visibilityChanged;
}

// =============================================================================
// SPRITE FACING DIRECTION
// =============================================================================

// Track previous X position and last flip time per unit
const prevX = new Map<number, number>();
const prevZ = new Map<number, number>();
const lastFlipTime = new Map<number, number>();

const FACING_MOVE_THRESHOLD = 0.01;
const FACING_FLIP_COOLDOWN = 300; // ms — prevent jittery flips

/**
 * Update facingRight on each UnitGroup based on movement direction or attack target position.
 * Movement takes priority; when idle, face toward attack target.
 * Facing changes are rate-limited to prevent jitter.
 */
export function updateSpriteFacing(
    unitsState: Unit[],
    unitsRef: Record<number, UnitGroup>
): void {
    const now = Date.now();

    for (const unit of unitsState) {
        if (unit.hp <= 0) continue;
        const g = unitsRef[unit.id];
        if (!g) continue;

        const curX = g.position.x;
        const lastX = prevX.get(unit.id);
        prevX.set(unit.id, curX);

        let wantRight: boolean | undefined;

        if (lastX !== undefined) {
            const dx = curX - lastX;
            const dz = g.position.z - (prevZ.get(unit.id) ?? g.position.z);
            // Project onto iso camera right vector (+X, -Z)
            const screenDx = dx - dz;
            if (Math.abs(screenDx) > FACING_MOVE_THRESHOLD) {
                wantRight = screenDx > 0;
            }
        }
        prevZ.set(unit.id, g.position.z);

        // Not moving — face attack target if any
        if (wantRight === undefined && g.userData.attackTarget !== null) {
            const targetG = unitsRef[g.userData.attackTarget];
            if (targetG) {
                const dx = targetG.position.x - curX;
                const dz = targetG.position.z - g.position.z;
                const screenDx = dx - dz;
                if (Math.abs(screenDx) > 0.1) {
                    wantRight = screenDx > 0;
                }
            }
        }

        // Apply with cooldown
        if (wantRight !== undefined && wantRight !== g.userData.facingRight) {
            const last = lastFlipTime.get(unit.id) ?? 0;
            if (now - last >= FACING_FLIP_COOLDOWN) {
                g.userData.facingRight = wantRight;
                lastFlipTime.set(unit.id, now);
            }
        }
    }
}

// =============================================================================
// ANCESTOR GHOST PULSE
// =============================================================================

const ANCESTOR_GHOST_PULSE_SPEED = 0.0012;
const ANCESTOR_GHOST_PULSE_AMPLITUDE = 0.3;
const ANCESTOR_GHOST_OPACITY_MIN = 0.35;
const ANCESTOR_GHOST_OPACITY_MAX = 0.62;

function findBillboardMesh(group: UnitGroup | undefined): THREE.Mesh | null {
    if (!group) return null;
    for (const child of group.children) {
        if (child instanceof THREE.Mesh && child.userData?.isBillboard === true) {
            return child;
        }
    }
    return null;
}

/**
 * Apply a subtle breathing opacity pulse to ancestor summons for a ghostly look.
 */
export function updateAncestorGhostVisuals(
    unitsState: Unit[],
    unitsRef: Record<number, UnitGroup>,
    unitMeshRef: Record<number, THREE.Mesh>,
    now: number
): void {
    for (const unit of unitsState) {
        if (unit.hp <= 0 || unit.team !== "player") {
            continue;
        }

        const isAncestorSummon = unit.summonType === "ancestor_warrior" || unit.id === 7;
        if (!isAncestorSummon) continue;

        const mesh = unitMeshRef[unit.id] ?? findBillboardMesh(unitsRef[unit.id]);
        if (!mesh) continue;

        const material = mesh.material;
        if (!(material instanceof THREE.MeshStandardMaterial) && !(material instanceof THREE.MeshBasicMaterial)) {
            continue;
        }

        const baseOpacityMaybe = material.userData.ancestorBaseOpacity;
        const baseOpacity = typeof baseOpacityMaybe === "number" ? baseOpacityMaybe : material.opacity;
        if (typeof baseOpacityMaybe !== "number") {
            material.userData.ancestorBaseOpacity = baseOpacity;
        }

        if (!material.transparent) {
            material.transparent = true;
        }

        const pulse = Math.sin(now * ANCESTOR_GHOST_PULSE_SPEED + unit.id * 0.73);
        const opacity = baseOpacity + pulse * ANCESTOR_GHOST_PULSE_AMPLITUDE;
        material.opacity = THREE.MathUtils.clamp(opacity, ANCESTOR_GHOST_OPACITY_MIN, ANCESTOR_GHOST_OPACITY_MAX);

        if (material instanceof THREE.MeshStandardMaterial) {
            const baseEmissiveMaybe = material.userData.ancestorBaseEmissiveIntensity;
            const baseEmissive = typeof baseEmissiveMaybe === "number" ? baseEmissiveMaybe : material.emissiveIntensity;
            if (typeof baseEmissiveMaybe !== "number") {
                material.userData.ancestorBaseEmissiveIntensity = baseEmissive;
            }
            const pulse01 = (pulse + 1) * 0.5;
            material.emissiveIntensity = baseEmissive * (0.92 + pulse01 * 0.16);
        }
    }
}

/**
 * Clear cached previous positions (call on area transition / game restart).
 */
export function resetSpriteFacing(): void {
    prevX.clear();
    prevZ.clear();
    lastFlipTime.clear();
}
