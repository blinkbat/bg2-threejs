// =============================================================================
// VISUAL EFFECTS - Damage texts, hit flash, poison visuals, fog of war
// =============================================================================

import * as THREE from "three";
import type { Unit, DamageText, UnitGroup, FogTexture } from "../core/types";
import { FOG_SCALE, FLASH_DURATION, ENRAGED_TINT_STRENGTH } from "../core/constants";
import { hasStatusEffect } from "../combat/combatMath";
import { updateVisibility } from "../ai/pathfinding";
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
    return damageTexts.filter(dt => {
        dt.mesh.quaternion.copy(camera.quaternion);
        if (!paused) {
            dt.mesh.position.y += 0.02;
            dt.life -= 16;
            (dt.mesh.material as THREE.MeshBasicMaterial).opacity = dt.life / 1000;
            if (dt.life <= 0) {
                recycleDamageNumber(scene, dt.mesh);
                return false;
            }
        }
        return true;
    });
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
    const spriteBaseColor = Reflect.get(colorMaterial.userData, "spriteBaseColor");
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

export function updateEnergyShieldVisuals(
    unitsState: Unit[],
    unitsRef: Record<number, UnitGroup>,
    now: number
): void {
    for (const unit of unitsState) {
        const unitGroup = unitsRef[unit.id];
        if (!unitGroup) continue;

        const hasShield = hasStatusEffect(unit, "energyShield");
        const hasDivineLattice = hasStatusEffect(unit, "divine_lattice");
        const hasBarrier = hasShield || hasDivineLattice;
        const existingBubble = unitGroup.getObjectByName(ENERGY_SHIELD_BUBBLE_NAME) as THREE.Mesh | undefined;

        if (hasBarrier && !existingBubble) {
            const bubbleColor = hasDivineLattice ? 0xffffff : 0x66ccff;
            const bubbleOpacity = hasDivineLattice ? 0.22 : 0.25;
            // Create bubble
            const bubbleGeometry = new THREE.SphereGeometry(0.7, 24, 16);
            const bubbleMaterial = new THREE.MeshBasicMaterial({
                color: bubbleColor,
                transparent: true,
                opacity: bubbleOpacity,
                side: THREE.DoubleSide,
                depthWrite: false
            });
            const bubble = new THREE.Mesh(bubbleGeometry, bubbleMaterial);
            bubble.name = ENERGY_SHIELD_BUBBLE_NAME;
            bubble.position.y = 0.5;  // Center on unit
            unitGroup.add(bubble);
        } else if (!hasBarrier && existingBubble) {
            // Remove bubble
            unitGroup.remove(existingBubble);
            existingBubble.geometry.dispose();
            (existingBubble.material as THREE.MeshBasicMaterial).dispose();
        } else if (hasBarrier && existingBubble) {
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

// Cache for fog change detection - simple hash of visible cells
let lastFogHash = 0;
let lastFogVisibilityKey = 0;
let hasFogVisibilityKey = false;
let lastFogAreaId: string | null = null;
const ENEMY_VIEW_FADE_LERP = 0.32;
const ENEMY_VIEW_FADE_MIN_VISIBLE = 0.02;

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

function applyViewFadeToGroup(group: UnitGroup, opacity: number): void {
    const clampedOpacity = THREE.MathUtils.clamp(opacity, 0, 1);
    group.userData.viewFadeOpacity = clampedOpacity;

    group.traverse(obj => {
        if (obj instanceof THREE.Light) {
            const baseIntensityRaw = Reflect.get(obj.userData, "viewFadeBaseIntensity");
            const baseIntensity = typeof baseIntensityRaw === "number" ? baseIntensityRaw : obj.intensity;
            if (typeof baseIntensityRaw !== "number") {
                obj.userData.viewFadeBaseIntensity = baseIntensity;
            }
            obj.intensity = baseIntensity * clampedOpacity;
            obj.visible = clampedOpacity > ENEMY_VIEW_FADE_MIN_VISIBLE;
            return;
        }

        if (!(obj instanceof THREE.Mesh)) return;
        const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const material of materials) {
            const baseOpacityRaw = Reflect.get(material.userData, "viewFadeBaseOpacity");
            const baseOpacity = typeof baseOpacityRaw === "number" ? baseOpacityRaw : material.opacity;
            if (typeof baseOpacityRaw !== "number") {
                material.userData.viewFadeBaseOpacity = baseOpacity;
            }
            material.opacity = baseOpacity * clampedOpacity;
            if (!material.transparent && (baseOpacity < 1 || clampedOpacity < 1)) {
                material.transparent = true;
            }
        }
    });
}

function updateEnemyGroupFade(group: UnitGroup, shouldBeVisible: boolean): void {
    const rawOpacity = Reflect.get(group.userData, "viewFadeOpacity");
    const currentOpacity = typeof rawOpacity === "number" ? rawOpacity : (shouldBeVisible ? 1 : 0);
    const targetOpacity = shouldBeVisible ? 1 : 0;
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
    lastFogHash = 0;
    lastFogVisibilityKey = 0;
    hasFogVisibilityKey = false;
    lastFogAreaId = null;
}

export function updateFogOfWar(
    visibility: number[][],
    playerUnits: Unit[],
    unitsRef: Record<number, UnitGroup>,
    fogTexture: FogTexture,
    unitsState: Unit[],
    fogMesh: THREE.Mesh
): void {
    const area = getCurrentArea();
    if (lastFogAreaId !== area.id) {
        lastFogAreaId = area.id;
        lastFogHash = 0;
        hasFogVisibilityKey = false;
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
                g.visible = false;
                applyViewFadeToGroup(g, 0);
                continue;
            }
            updateEnemyGroupFade(g, !isEnemyHiddenFromView(u.id));
        }
        return;
    }

    // Ensure fog mesh is visible for areas with fog
    fogMesh.visible = true;

    const visibilityKey = computePlayerVisibilityKey(playerUnits, unitsRef);
    const shouldRecomputeVisibility = !hasFogVisibilityKey || visibilityKey !== lastFogVisibilityKey;

    if (shouldRecomputeVisibility) {
        hasFogVisibilityKey = true;
        lastFogVisibilityKey = visibilityKey;

        updateVisibility(visibility, playerUnits, { current: unitsRef });

        // FNV-style rolling hash to detect visibility changes with low collision risk.
        let fogHash = 2166136261;
        for (let x = 0; x < area.gridWidth; x++) {
            for (let z = 0; z < area.gridHeight; z++) {
                const vis = visibility[x]?.[z] ?? 0;
                const mixed = (x * 73856093) ^ (z * 19349663) ^ vis;
                fogHash = Math.imul(fogHash ^ mixed, 16777619);
            }
        }
        fogHash >>>= 0;

        // Only redraw fog texture if visibility changed
        if (fogHash !== lastFogHash) {
            lastFogHash = fogHash;

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
            g.visible = false;
            applyViewFadeToGroup(g, 0);
            continue;
        }
        const cx = Math.floor(g.position.x), cz = Math.floor(g.position.z);
        const vis = visibility[cx]?.[cz] ?? 0;
        const shouldBeVisible = vis === 2 && !isEnemyHiddenFromView(u.id);
        updateEnemyGroupFade(g, shouldBeVisible);
    }
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
