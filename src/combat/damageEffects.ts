// =============================================================================
// COMBAT HELPERS - Damage numbers, defeat handling, projectiles
// =============================================================================

import * as THREE from "three";
import type { DamageText, UnitGroup, Unit, DamageType } from "../core/types";
import {
    PROJECTILE_CONFIG,
    COLORS,
    RING_EXPAND_DURATION,
    HIGHLAND_DEFENSE_INTERCEPT_CAP,
    HIGHLAND_DEFENSE_INTERCEPT_COOLDOWN,
    HIGHLAND_DEFENSE_RANGE
} from "../core/constants";
import { getUnitRadius, isInRange } from "../rendering/range";
import { distanceToPoint } from "../game/geometry";
import { soundFns } from "../audio";
import { cleanupUnitState } from "../ai/movement";
import { cleanupEnemyKiteCooldown } from "../game/enemyState";
import { getGameTime } from "../core/gameClock";
import { getUnitStats } from "../game/units";
import { scheduleEffectAnimation } from "../core/effectScheduler";
import { applySyncedUnitUpdate, applySyncedUnitsUpdate } from "../core/stateUtils";
import { logDefeated, applyPoison, applyBurn, applySlowed, hasStatusEffect, isUnitAlive } from "./combatMath";
import { tryKillBark } from "./barks";
import { getNextUnitId } from "../core/unitIds";
import { ENEMY_STATS, getAmoebaMaxHpForSplitCount } from "../game/enemyStats";
import { UNIT_DATA, getXpForLevel, getEffectiveMaxHp, getEffectiveMaxMana } from "../game/playerUnits";
import { LEVEL_UP_HP, LEVEL_UP_MANA, LEVEL_UP_STAT_POINTS, LEVEL_UP_SKILL_POINTS } from "../game/statBonuses";
import { trySubmergeKraken } from "../gameLoop/enemyBehaviors/submerge";
import { isEnemyUntargetable } from "../gameLoop/enemyBehaviors/untargetable";
import { getCurrentArea } from "../game/areas";

// =============================================================================
// PROJECTILE CREATION
// =============================================================================

type ProjectileType = "aoe" | "ranged" | "enemy";
type ProjectileVisualType = ProjectileType;

/**
 * Create a projectile mesh with standardized configuration
 */
// Shared sphere geometries per projectile type (never disposed)
const projectileGeos: Partial<Record<ProjectileType, THREE.SphereGeometry>> = {};
const projectileBaseMaterials: Record<ProjectileType, THREE.MeshPhongMaterial> = {
    aoe: new THREE.MeshPhongMaterial({
        color: "#ff4400",
        emissive: "#7a1800",
        emissiveIntensity: 0.55,
        shininess: 90,
        transparent: true,
        opacity: 0.94
    }),
    ranged: new THREE.MeshPhongMaterial({
        color: "#a0522d",
        emissive: "#2a1308",
        emissiveIntensity: 0.28,
        shininess: 70,
        transparent: true,
        opacity: 0.95
    }),
    enemy: new THREE.MeshPhongMaterial({
        color: "#f08a5d",
        emissive: "#4a1f10",
        emissiveIntensity: 0.3,
        shininess: 65,
        transparent: true,
        opacity: 0.95
    })
};

function createProjectileMaterial(type: ProjectileType, colorHex: string): THREE.MeshPhongMaterial {
    const material = projectileBaseMaterials[type].clone();
    const color = new THREE.Color(colorHex);
    material.color.copy(color);
    const emissiveFactor = type === "aoe" ? 0.38 : 0.24;
    material.emissive.copy(color).multiplyScalar(emissiveFactor);
    return material;
}

function getProjectileGeo(type: ProjectileType): THREE.SphereGeometry {
    let geo = projectileGeos[type];
    if (!geo) {
        const config = PROJECTILE_CONFIG[type];
        geo = new THREE.SphereGeometry(config.radius, config.segments, config.segments);
        projectileGeos[type] = geo;
    }
    return geo;
}

export function createProjectile(
    scene: THREE.Scene,
    type: ProjectileType,
    x: number,
    z: number,
    color?: string
): THREE.Mesh {
    const config = PROJECTILE_CONFIG[type];
    const projectileColor = color || ('defaultColor' in config ? config.defaultColor : "#ffffff");

    const projectile = new THREE.Mesh(
        getProjectileGeo(type),
        createProjectileMaterial(type, projectileColor)
    );
    projectile.position.set(x, config.height, z);
    if (type === "aoe") {
        projectile.scale.set(1.18, 1.18, 1.18);
    }
    projectile.userData.sharedGeometry = true;
    projectile.userData.projectileVisualType = type as ProjectileVisualType;
    projectile.userData.visualPhase = Math.random() * Math.PI * 2;
    scene.add(projectile);

    return projectile;
}

/**
 * Get projectile speed for a given type
 */
export function getProjectileSpeed(type: ProjectileType): number {
    return PROJECTILE_CONFIG[type].speed;
}

// =============================================================================
// EXPANDING MESH ANIMATION (rings, arcs)
// =============================================================================

// Shared ring geometries keyed by "inner,outer"
const ringGeoCache: Map<string, THREE.RingGeometry> = new Map();
const RING_SEGMENTS = 48;

function getRingGeo(inner: number, outer: number): THREE.RingGeometry {
    const key = `${inner},${outer}`;
    let geo = ringGeoCache.get(key);
    if (!geo) {
        geo = new THREE.RingGeometry(inner, outer, RING_SEGMENTS);
        ringGeoCache.set(key, geo);
    }
    return geo;
}

interface ExpandingMeshConfig {
    duration?: number;
    initialOpacity?: number;
    maxScale?: number;
    baseRadius?: number;
}

/**
 * Create and animate an expanding ring visual effect.
 * Consolidates the common pattern of RingGeometry + MeshBasicMaterial + animateExpandingMesh.
 */
export function createAnimatedRing(
    scene: THREE.Scene,
    x: number,
    z: number,
    color: string,
    config: {
        innerRadius?: number;
        outerRadius?: number;
        duration?: number;
        initialOpacity?: number;
        maxScale: number;
        y?: number;
    }
): void {
    const {
        innerRadius = 0.5,
        outerRadius = 0.7,
        duration = RING_EXPAND_DURATION,
        initialOpacity = 0.8,
        maxScale,
        y = 0.1
    } = config;

    const ring = new THREE.Mesh(
        getRingGeo(innerRadius, outerRadius),
        new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: initialOpacity,
            side: THREE.DoubleSide,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: -1,
            polygonOffsetUnits: -1,
            toneMapped: false
        })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, y, z);
    ring.renderOrder = 140;
    ring.userData.sharedGeometry = true;
    scene.add(ring);

    animateExpandingMesh(scene, ring, {
        duration,
        initialOpacity,
        maxScale,
        baseRadius: outerRadius
    });
}

/**
 * Animate a mesh expanding and fading out, then dispose it.
 * Used for taunt rings, swipe arcs, etc.
 * Returns a cancel function to stop the animation early.
 */
export function animateExpandingMesh(
    scene: THREE.Scene,
    mesh: THREE.Mesh,
    config: ExpandingMeshConfig = {}
): () => void {
    const {
        duration = RING_EXPAND_DURATION,
        initialOpacity = 0.8,
        maxScale = 1,
        baseRadius = 0.6
    } = config;

    const startTime = getGameTime();
    let disposed = false;
    let cancelScheduledAnimation: (() => void) | null = null;

    const cleanup = () => {
        scene.remove(mesh);
        if (mesh.userData.sharedGeometry !== true) {
            mesh.geometry.dispose();
        }
        (mesh.material as THREE.MeshBasicMaterial).dispose();
    };

    const dispose = () => {
        if (disposed) return;
        disposed = true;
        if (cancelScheduledAnimation) {
            cancelScheduledAnimation();
            cancelScheduledAnimation = null;
        }
        cleanup();
    };

    cancelScheduledAnimation = scheduleEffectAnimation((gameNow) => {
        if (disposed) {
            return true;
        }

        const elapsed = gameNow - startTime;
        const t = Math.min(1, elapsed / duration);
        const currentScale = baseRadius + (maxScale - baseRadius) * t;
        mesh.scale.set(currentScale / baseRadius, currentScale / baseRadius, 1);
        (mesh.material as THREE.MeshBasicMaterial).opacity = initialOpacity * (1 - t);

        if (t < 1) {
            return false;
        }

        disposed = true;
        cleanup();
        cancelScheduledAnimation = null;
        return true;
    });

    return dispose;
}

/**
 * Create a lightning pillar visual effect - a thin vertical column of white light
 * that flashes brightly then fades.
 */
export function createLightningPillar(
    scene: THREE.Scene,
    x: number,
    z: number,
    config: {
        color?: string;
        duration?: number;
        radius?: number;
        height?: number;
    } = {}
): void {
    const {
        color = "#ffffff",
        duration = 300,
        radius = 0.15,
        height = 8
    } = config;

    // Create the pillar cylinder
    const pillar = new THREE.Mesh(
        new THREE.CylinderGeometry(radius, radius, height, 8),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1.0 })
    );
    pillar.position.set(x, height / 2, z);
    scene.add(pillar);

    // Create a bright glow ring at the base
    const glow = new THREE.Mesh(
        new THREE.RingGeometry(0.1, 0.6, 16),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, side: THREE.DoubleSide })
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.set(x, 0.15, z);
    scene.add(glow);

    const startTime = getGameTime();
    const pillarMaterial = pillar.material as THREE.MeshBasicMaterial;
    const glowMaterial = glow.material as THREE.MeshBasicMaterial;

    scheduleEffectAnimation((gameNow) => {
        const elapsed = gameNow - startTime;
        const t = Math.min(1, elapsed / duration);

        // Flash bright at start, then fade
        const flashT = t < 0.2 ? 1 : (1 - (t - 0.2) / 0.8);
        pillarMaterial.opacity = flashT;
        glowMaterial.opacity = flashT * 0.8;

        // Expand glow ring slightly
        const glowScale = 1 + t * 0.5;
        glow.scale.set(glowScale, glowScale, 1);

        if (t < 1) {
            return false;
        }

        scene.remove(pillar);
        scene.remove(glow);
        pillar.geometry.dispose();
        pillarMaterial.dispose();
        glow.geometry.dispose();
        glowMaterial.dispose();
        return true;
    });
}

// =============================================================================
// TARGET FILTERING
// =============================================================================

/**
 * Get all alive units of a specific team within range of a position.
 * Uses hitbox-aware range checking.
 */
export function getAliveUnitsInRange(
    units: Unit[],
    unitsRef: Record<number, UnitGroup>,
    team: "player" | "enemy",
    x: number,
    z: number,
    range: number,
    defeatedThisFrame?: Set<number>
): { unit: Unit; group: UnitGroup; dist: number }[] {
    const results: { unit: Unit; group: UnitGroup; dist: number }[] = [];

    for (const unit of units) {
        if (unit.team !== team || !isUnitAlive(unit, defeatedThisFrame)) continue;

        const g = unitsRef[unit.id];
        if (!g) continue;

        const unitRadius = getUnitRadius(unit);
        if (isInRange(x, z, g.position.x, g.position.z, unitRadius, range)) {
            const dist = distanceToPoint(g.position, x, z);
            results.push({ unit, group: g, dist });
        }
    }

    return results;
}

// =============================================================================
// UNIFIED DAMAGE APPLICATION
// =============================================================================

export interface DamageContext {
    scene: THREE.Scene;
    damageTexts: DamageText[];
    hitFlashRef: Record<number, number>;
    unitsRef: Record<number, UnitGroup>;
    unitsStateRef: React.RefObject<Unit[]>;
    setUnits: React.Dispatch<React.SetStateAction<Unit[]>>;
    addLog: (text: string, color?: string) => void;
    now: number;
    defeatedThisFrame?: Set<number>;
}

/**
 * Build a DamageContext from common game loop parameters.
 * Wraps a plain unitsState array into a RefObject for DamageContext compatibility.
 */
export function buildDamageContext(
    scene: THREE.Scene,
    damageTexts: DamageText[],
    hitFlashRef: Record<number, number>,
    unitsRef: Record<number, UnitGroup>,
    unitsState: Unit[],
    setUnits: React.Dispatch<React.SetStateAction<Unit[]>>,
    addLog: (text: string, color?: string) => void,
    now: number,
    defeatedThisFrame?: Set<number>
): DamageContext {
    const unitsStateRef = { current: unitsState } as React.RefObject<Unit[]>;
    return { scene, damageTexts, hitFlashRef, unitsRef, unitsStateRef, setUnits, addLog, now, defeatedThisFrame };
}

/**
 * Apply lifesteal healing to an attacker after dealing damage.
 * Heals the attacker and spawns a green heal number above them.
 */
export function applyLifesteal(
    scene: THREE.Scene,
    damageTexts: DamageText[],
    setUnits: React.Dispatch<React.SetStateAction<Unit[]>>,
    attackerId: number,
    attackerX: number,
    attackerZ: number,
    healAmount: number
): void {
    if (healAmount <= 0) return;
    setUnits(prev => prev.map(u => {
        if (u.id !== attackerId) return u;
        const maxHp = u.team === "player"
            ? getEffectiveMaxHp(u.id, u)
            : getUnitStats(u).maxHp;
        return { ...u, hp: Math.min(u.hp + healAmount, maxHp) };
    }));
    spawnDamageNumber(scene, attackerX, attackerZ, healAmount, COLORS.logHeal, damageTexts, true);
}

interface DamageOptions {
    poison?: { sourceId: number; damagePerTick?: number };  // Optional custom poison damage
    burn?: { sourceId: number; damagePerTick?: number; duration?: number };  // Optional burn damage-over-time
    slow?: { sourceId: number };  // Apply slow debuff (1.5x cooldowns, 0.5x move speed)
    color?: string;
    skipDefeatTracking?: boolean;
    attackerName?: string;  // For bark system - name of the player unit dealing damage
    hitMessage?: { text: string; color: string };  // Log hit message before defeat message
    targetUnit?: Unit;  // Full unit data for special mechanics (e.g., amoeba split)
    attackerPosition?: { x: number; z: number };  // Position of attacker (for shield facing)
    damageType?: DamageType;  // Type of damage (for energy shield - chaos does 2x)
    isCrit?: boolean;  // Whether this was a critical hit (shows gold damage text)
    attackerId?: number;  // Unit ID of the attacker (used for retaliation effects)
    isMeleeHit?: boolean;  // Whether this hit was melee contact (for thorns)
    skipHighlandDefense?: boolean;  // Internal: bypass ally-damage interception checks
}

function getUnitDisplayName(unit: Unit): string {
    if (unit.team === "player") {
        return UNIT_DATA[unit.id]?.name ?? "Unknown";
    }
    if (unit.enemyType) {
        return ENEMY_STATS[unit.enemyType]?.name ?? "Unknown";
    }
    return "Unknown";
}

/**
 * Apply damage to a unit with all side effects (state update, flash, damage number, defeat check).
 * Reads current HP from unitsStateRef internally — callers just specify the raw damage amount.
 */
export function applyDamageToUnit(
    ctx: DamageContext,
    targetId: number,
    targetGroup: UnitGroup,
    damage: number,
    targetName: string,
    options: DamageOptions = {}
): void {
    const { scene, damageTexts, hitFlashRef, unitsRef, unitsStateRef, setUnits, addLog, now, defeatedThisFrame } = ctx;
    const {
        poison,
        burn,
        slow,
        color = COLORS.damageEnemy,
        skipDefeatTracking = false,
        attackerName,
        hitMessage,
        targetUnit,
        attackerPosition,
        damageType,
        isCrit = false,
        attackerId,
        isMeleeHit = false,
        skipHighlandDefense = false
    } = options;

    // Floor negative damage to zero so it can never heal the target.
    damage = Math.max(0, damage);

    // Area-wide invulnerability (testing rooms, etc.)
    if (getCurrentArea().invulnerable) return;

    // Skip already-defeated targets this frame
    if (defeatedThisFrame?.has(targetId)) return;

    // Untargetable enemy states are invulnerable.
    if (isEnemyUntargetable(targetId)) return;

    // Read current state from ref
    const refUnit = unitsStateRef.current?.find(u => u.id === targetId) ?? targetUnit;
    const targetState = refUnit ?? targetUnit;

    // Full damage immunity (e.g. Dodge or Divine Lattice)
    if (refUnit && (hasStatusEffect(refUnit, "invul") || hasStatusEffect(refUnit, "divine_lattice"))) {
        spawnDamageNumber(scene, targetGroup.position.x, targetGroup.position.z, 0, "#ffffff", damageTexts);
        return;
    }

    // Read current HP — bail if already dead
    const currentHp = refUnit?.hp ?? 0;
    if (currentHp <= 0) return;

    // Check for energy shield absorption
    const energyShield = refUnit?.statusEffects?.find(e => e.type === "energy_shield");

    let effectiveDamage = damage;
    let shieldAbsorbed = 0;
    let shieldDepleted = false;

    if (energyShield && energyShield.shieldAmount && energyShield.shieldAmount > 0) {
        // Chaos damage does 2x to energy shield
        const shieldDamage = damageType === "chaos" ? damage * 2 : damage;

        if (shieldDamage >= energyShield.shieldAmount) {
            // Shield is depleted - calculate overflow
            shieldAbsorbed = energyShield.shieldAmount;
            const overflowShieldDamage = shieldDamage - energyShield.shieldAmount;
            // Convert overflow back to regular damage (halved if it was chaos)
            effectiveDamage = damageType === "chaos" ? Math.ceil(overflowShieldDamage / 2) : overflowShieldDamage;
            shieldDepleted = true;
        } else {
            // Shield absorbs all damage
            shieldAbsorbed = shieldDamage;
            effectiveDamage = 0;
        }
    }

    // Highland Defense: nearby barbarian can redirect part of this damage.
    if (
        !skipHighlandDefense
        && refUnit
        && refUnit.team === "player"
        && effectiveDamage > 0
    ) {
        let chosenDefender: { unit: Unit; group: UnitGroup; distance: number; remaining: number } | null = null;

        for (const candidate of unitsStateRef.current) {
            if (candidate.team !== "player" || candidate.hp <= 0 || candidate.id === targetId) continue;
            if (UNIT_DATA[candidate.id]?.class !== "Barbarian") continue;

            const status = candidate.statusEffects?.find(e => e.type === "highland_defense");
            if (!status) continue;

            const remaining = Math.max(0, status.interceptRemaining ?? HIGHLAND_DEFENSE_INTERCEPT_CAP);
            const cooldownEnd = status.interceptCooldownEnd ?? 0;
            if (remaining <= 0 || now < cooldownEnd) continue;

            const defenderGroup = unitsRef[candidate.id];
            if (!defenderGroup) continue;

            if (!isInRange(defenderGroup.position.x, defenderGroup.position.z, targetGroup.position.x, targetGroup.position.z, getUnitRadius(candidate), HIGHLAND_DEFENSE_RANGE)) continue;
            const distance = Math.hypot(
                defenderGroup.position.x - targetGroup.position.x,
                defenderGroup.position.z - targetGroup.position.z
            );

            if (!chosenDefender || distance < chosenDefender.distance) {
                chosenDefender = { unit: candidate, group: defenderGroup, distance, remaining };
            }
        }

        if (chosenDefender) {
            const defenderName = getUnitDisplayName(chosenDefender.unit);
            const rawRedirect = Math.max(1, Math.ceil(effectiveDamage / 2));
            const redirectDamage = Math.min(rawRedirect, chosenDefender.remaining);
            const preventedDamage = Math.min(effectiveDamage, redirectDamage * 2);
            const remainingAfter = Math.max(0, chosenDefender.remaining - redirectDamage);
            const cooldownEnd = now + HIGHLAND_DEFENSE_INTERCEPT_COOLDOWN;

            if (redirectDamage > 0 && preventedDamage > 0) {
                effectiveDamage -= preventedDamage;
                const defenderId = chosenDefender.unit.id;

                applySyncedUnitsUpdate(unitsStateRef, setUnits, prev => prev.map(u => {
                    if (u.id !== defenderId) return u;
                    const effects = (u.statusEffects ?? [])
                        .map(e => e.type === "highland_defense"
                            ? { ...e, interceptRemaining: remainingAfter, interceptCooldownEnd: cooldownEnd }
                            : e
                        )
                        .filter(e => !(e.type === "highland_defense" && remainingAfter <= 0));
                    return { ...u, statusEffects: effects.length > 0 ? effects : undefined };
                }));

                applyDamageToUnit(ctx, chosenDefender.unit.id, chosenDefender.group, redirectDamage, defenderName, {
                    color: COLORS.highlandDefenseText,
                    hitMessage: {
                        text: `${defenderName} intercepts ${preventedDamage} damage for ${targetName}!`,
                        color: COLORS.highlandDefenseText
                    },
                    targetUnit: chosenDefender.unit,
                    attackerId,
                    attackerPosition: { x: targetGroup.position.x, z: targetGroup.position.z },
                    damageType,
                    skipHighlandDefense: true
                });

                if (remainingAfter <= 0) {
                    addLog(`${defenderName}'s Highland Defense is exhausted.`, COLORS.highlandDefenseText);
                }
            }
        }
    }

    const projectedHp = Math.max(0, currentHp - effectiveDamage);

    // Check for amoeba split mechanic: split on death only if a smaller stage exists.
    // The spawned children always start at their stage max HP.
    const shouldSplit = targetState?.enemyType === "giant_amoeba" &&
        projectedHp <= 0 &&
        (targetState.splitCount ?? 0) < (ENEMY_STATS.giant_amoeba.maxSplitCount ?? 3);

    if (shouldSplit && targetState) {
        // Amoeba splits! Original dies, two smaller ones spawn
        const currentSplitCount = targetState.splitCount ?? 0;
        const newSplitCount = currentSplitCount + 1;

        const splitHp = getAmoebaMaxHpForSplitCount(newSplitCount);

        // Spawn positions - offset from original position
        const offsetDist = 0.8;
        const angle1 = Math.random() * Math.PI * 2;
        const angle2 = angle1 + Math.PI;  // Opposite direction

        const spawn1: Unit = {
            id: getNextUnitId(),
            x: targetGroup.position.x + Math.cos(angle1) * offsetDist,
            z: targetGroup.position.z + Math.sin(angle1) * offsetDist,
            hp: splitHp,
            team: "enemy",
            enemyType: "giant_amoeba",
            target: null,
            aiEnabled: true,
            splitCount: newSplitCount
        };

        const spawn2: Unit = {
            id: getNextUnitId(),
            x: targetGroup.position.x + Math.cos(angle2) * offsetDist,
            z: targetGroup.position.z + Math.sin(angle2) * offsetDist,
            hp: splitHp,
            team: "enemy",
            enemyType: "giant_amoeba",
            target: null,
            aiEnabled: true,
            splitCount: newSplitCount
        };

        // Update state: kill original, spawn two new ones
        applySyncedUnitsUpdate(unitsStateRef, setUnits, prev => [
            ...prev.map(u => {
                if (u.id !== targetId) return u;
                return { ...u, hp: 0, statusEffects: undefined };  // Kill the original
            }),
            spawn1,
            spawn2
        ]);

        // Visual feedback
        hitFlashRef[targetId] = now;
        spawnDamageNumber(scene, targetGroup.position.x, targetGroup.position.z, damage, color, damageTexts, false, isCrit);

        // Play gushing sound for the split
        soundFns.playGush();

        // Log the split
        const sizeDesc = newSplitCount === 1 ? "smaller" : newSplitCount === 2 ? "small" : "tiny";
        addLog(`The ${targetName} splits into two ${sizeDesc} amoebas!`, "#3cb371");

        // Mark original as defeated
        if (defeatedThisFrame && !skipDefeatTracking) {
            defeatedThisFrame.add(targetId);
        }
        handleUnitDefeat(targetId, targetGroup, unitsRef, addLog, targetName, true);  // Silent defeat

        return;  // Original is now dead
    }

    // Normal damage handling (non-amoeba or can't split)
    const updatedTarget = applySyncedUnitUpdate(unitsStateRef, setUnits, targetId, u => {
        let updated = { ...u, hp: Math.max(0, u.hp - effectiveDamage) };
        if (updated.hp <= 0) {
            return { ...updated, statusEffects: undefined };
        }

        // Update energy shield status effect
        if (shieldAbsorbed > 0 && updated.statusEffects) {
            if (shieldDepleted) {
                // Remove the depleted energy shield
                updated = {
                    ...updated,
                    statusEffects: updated.statusEffects.filter(e => e.type !== "energy_shield")
                };
            } else {
                // Reduce shield amount
                updated = {
                    ...updated,
                    statusEffects: updated.statusEffects.map(e =>
                        e.type === "energy_shield"
                            ? { ...e, shieldAmount: (e.shieldAmount ?? 0) - shieldAbsorbed }
                            : e
                    )
                };
            }
        }

        // Shielded units are immune to poison
        if (poison && !hasStatusEffect(u, "shielded")) {
            updated = applyPoison(updated, poison.sourceId, now, poison.damagePerTick);
        }
        if (burn) {
            updated = applyBurn(updated, burn.sourceId, now, burn.damagePerTick, burn.duration);
        }
        // Apply slow debuff
        if (slow) {
            updated = applySlowed(updated, slow.sourceId, now);
        }
        // Wake from sleep on any damage
        if (hasStatusEffect(updated, "sleep")) {
            updated = {
                ...updated,
                statusEffects: (updated.statusEffects ?? []).filter(e => e.type !== "sleep")
            };
        }
        return updated;
    });
    const newHp = updatedTarget?.hp ?? 0;

    // Log energy shield effects
    if (shieldAbsorbed > 0) {
        if (shieldDepleted) {
            addLog(`${targetName}'s Energy Shield shatters!`, "#9966ff");
        }
    }

    // Visual effects
    hitFlashRef[targetId] = now;
    // Show absorbed damage differently if shield took it
    const displayDamage = shieldAbsorbed > 0 ? damage : effectiveDamage;
    const displayColor = shieldAbsorbed > 0 && effectiveDamage === 0 ? "#66ccff" : color;
    spawnDamageNumber(scene, targetGroup.position.x, targetGroup.position.z, displayDamage, displayColor, damageTexts, false, isCrit);

    // Track when this unit last took damage (for AI kiting decisions)
    targetGroup.userData.lastHitTime = now;

    // Track damage source position (for shield facing - knight turns toward attackers)
    if (attackerPosition) {
        targetGroup.userData.lastDamageSource = { x: attackerPosition.x, z: attackerPosition.z, time: now };
    }

    // Log hit message before defeat message (if provided)
    if (hitMessage) {
        addLog(hitMessage.text, hitMessage.color);
    }

    // Thorns retaliation: reflect damage to the melee attacker.
    if (isMeleeHit && attackerId !== undefined && attackerId !== targetId && refUnit && hasStatusEffect(refUnit, "thorns")) {
        const attackerUnit = unitsStateRef.current.find(u => u.id === attackerId);
        const attackerGroup = unitsRef[attackerId];
        const thornsEffect = refUnit.statusEffects?.find(e => e.type === "thorns");
        const thornsDamage = Math.max(1, thornsEffect?.thornsDamage ?? 2);

        if (attackerUnit && attackerGroup && attackerUnit.hp > 0) {
            const attackerDataName = getUnitDisplayName(attackerUnit);

            applyDamageToUnit(ctx, attackerId, attackerGroup, thornsDamage, attackerDataName, {
                color: COLORS.thornsText,
                hitMessage: { text: `${targetName}'s thorns strike back for ${thornsDamage}!`, color: COLORS.thornsText },
                targetUnit: attackerUnit,
                attackerName: targetName,
                attackerPosition: { x: targetGroup.position.x, z: targetGroup.position.z },
                damageType: "physical"
            });
        }
    }

    // Blood Mark lifesteal: when a player melee-hits a blood_marked enemy, heal the attacker.
    if (isMeleeHit && attackerId !== undefined && refUnit && hasStatusEffect(refUnit, "blood_marked")) {
        const attackerUnit = unitsStateRef.current.find(u => u.id === attackerId && u.team === "player" && u.hp > 0);
        const attackerGroup = unitsRef[attackerId];
        if (attackerUnit && attackerGroup) {
            const bloodEffect = refUnit.statusEffects?.find(e => e.type === "blood_marked");
            const lifestealPct = bloodEffect?.lifestealPercent ?? 0.35;
            const healAmount = Math.max(1, Math.floor(effectiveDamage * lifestealPct));
            applyLifesteal(scene, damageTexts, setUnits, attackerId, attackerGroup.position.x, attackerGroup.position.z, healAmount);
        }
    }

    // Defeat handling
    if (newHp <= 0) {
        if (defeatedThisFrame && !skipDefeatTracking) {
            defeatedThisFrame.add(targetId);
        }
        handleUnitDefeat(targetId, targetGroup, unitsRef, addLog, targetName);
        // Bark on kill (only when player kills an enemy, not when enemy kills player)
        if (attackerName && targetUnit?.team === "enemy") {
            tryKillBark(attackerName, addLog);
        }
        // Award XP to all living player units when an enemy dies
        if (targetState && targetState.team === "enemy" && targetState.enemyType) {
            const expReward = ENEMY_STATS[targetState.enemyType]?.expReward ?? 0;
            if (expReward > 0) {
                // Compute level ups BEFORE state update using ref
                const currentUnits = unitsStateRef.current ?? [];
                const leveledUpIds: number[] = [];
                for (const u of currentUnits) {
                    if (u.team === "player" && u.hp > 0) {
                        const newExp = (u.exp ?? 0) + expReward;
                        const currentLevel = u.level ?? 1;
                        const xpForNext = getXpForLevel(currentLevel + 1);
                        if (newExp >= xpForNext) {
                            leveledUpIds.push(u.id);
                        }
                    }
                }

                // Update state
                applySyncedUnitsUpdate(unitsStateRef, setUnits, prev => prev.map(u => {
                    if (u.team === "player" && u.hp > 0) {
                        const newExp = (u.exp ?? 0) + expReward;
                        const currentLevel = u.level ?? 1;
                        const xpForNext = getXpForLevel(currentLevel + 1);
                        if (newExp >= xpForNext) {
                            const maxHp = getEffectiveMaxHp(u.id, u);
                            const maxMana = getEffectiveMaxMana(u.id, u);
                            return {
                                ...u,
                                exp: newExp,
                                level: currentLevel + 1,
                                statPoints: (u.statPoints ?? 0) + LEVEL_UP_STAT_POINTS,
                                skillPoints: (u.skillPoints ?? 0) + LEVEL_UP_SKILL_POINTS,
                                hp: Math.min(u.hp + LEVEL_UP_HP, maxHp),
                                mana: Math.min((u.mana ?? 0) + LEVEL_UP_MANA, maxMana),
                                stats: u.stats ?? {
                                    strength: 0,
                                    dexterity: 0,
                                    vitality: 0,
                                    intelligence: 0,
                                    faith: 0
                                }
                            };
                        }
                        return { ...u, exp: newExp };
                    }
                    return u;
                }));

                addLog(`Party gained ${expReward} Experience!`, "#9b59b6");

                // Level-up effects
                if (leveledUpIds.length > 0) {
                    addLog(`Level up! +${LEVEL_UP_STAT_POINTS} stat points available.`, "#ffd700");
                    soundFns.playLevelUp();
                    for (const unitId of leveledUpIds) {
                        const unitGroup = unitsRef[unitId];
                        if (unitGroup) {
                            createLightningPillar(scene, unitGroup.position.x, unitGroup.position.z, {
                                color: "#ffd700",
                                duration: 600,
                                radius: 0.3,
                                height: 10
                            });
                        }
                    }
                }
            }

            // Handle kraken tentacle death - damage parent kraken
            if (targetState.enemyType === "kraken_tentacle" && targetState.spawnedBy !== undefined) {
                const parentKraken = unitsStateRef.current.find(u => u.id === targetState.spawnedBy && u.hp > 0);
                if (parentKraken) {
                    const krakenG = unitsRef[parentKraken.id];
                    if (krakenG) {
                        const krakenStats = ENEMY_STATS.baby_kraken;
                        const tentacleDamage = krakenStats.tentacleSkill?.damageToParent ?? 15;
                        // Recursively apply damage to the kraken (skip defeat tracking since this is bonus damage)
                        applyDamageToUnit(
                            { scene, damageTexts, hitFlashRef, unitsRef, unitsStateRef, setUnits, addLog, now, defeatedThisFrame },
                            parentKraken.id, krakenG, tentacleDamage, krakenStats.name,
                            {
                                color: COLORS.damageEnemy,
                                hitMessage: { text: `The severed tentacle damages ${krakenStats.name} for ${tentacleDamage}!`, color: "#ff6600" },
                                targetUnit: parentKraken
                            }
                        );
                    }
                }
            }
        }
    }

    // Check if kraken should submerge after taking damage
    if (newHp > 0 && targetState?.enemyType === "baby_kraken") {
        trySubmergeKraken({ ...targetState, hp: newHp }, unitsRef, addLog, now);
    }

}

// =============================================================================
// DAMAGE NUMBER POOLING — reuse canvas/texture/mesh instead of creating new ones
// =============================================================================

const normalPlaneGeo = new THREE.PlaneGeometry(0.8, 0.4);
const critPlaneGeo = new THREE.PlaneGeometry(1.2, 0.6);
const normalDmgPool: THREE.Mesh[] = [];
const critDmgPool: THREE.Mesh[] = [];
const DMG_POOL_MAX = 20;
const DAMAGE_TEXT_RENDER_ORDER = 900;

function acquireDmgMesh(isCrit: boolean): THREE.Mesh {
    const pool = isCrit ? critDmgPool : normalDmgPool;
    if (pool.length > 0) {
        const mesh = pool.pop()!;
        const material = mesh.material as THREE.MeshBasicMaterial;
        material.opacity = 1;
        mesh.renderOrder = DAMAGE_TEXT_RENDER_ORDER;
        return mesh;
    }
    const canvas = document.createElement("canvas");
    canvas.width = isCrit ? 96 : 64;
    canvas.height = isCrit ? 48 : 32;
    const texture = new THREE.CanvasTexture(canvas);
    texture.generateMipmaps = false;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.colorSpace = THREE.SRGBColorSpace;

    const mesh = new THREE.Mesh(
        isCrit ? critPlaneGeo : normalPlaneGeo,
        new THREE.MeshBasicMaterial({
            map: texture,
            transparent: true,
            depthWrite: false,
            depthTest: true,
            alphaTest: 0.02,
            toneMapped: false
        })
    );
    mesh.renderOrder = DAMAGE_TEXT_RENDER_ORDER;
    return mesh;
}

/** Return a damage number mesh to the pool for reuse. */
export function recycleDamageNumber(scene: THREE.Scene, mesh: THREE.Mesh): void {
    scene.remove(mesh);
    const isCrit = mesh.geometry === critPlaneGeo;
    const pool = isCrit ? critDmgPool : normalDmgPool;
    if (pool.length < DMG_POOL_MAX) {
        pool.push(mesh);
    } else {
        const mat = mesh.material as THREE.MeshBasicMaterial;
        if (mat.map) mat.map.dispose();
        mat.dispose();
    }
}

/**
 * Spawn a floating damage number at the given position
 * @param isHeal - If true, shows + prefix instead of - prefix
 * @param isCrit - If true, shows larger gold "CRIT!" text
 */
export function spawnDamageNumber(
    scene: THREE.Scene,
    x: number,
    z: number,
    damage: number,
    color: string,
    damageTexts: DamageText[],
    isHeal: boolean = false,
    isCrit: boolean = false
): void {
    const mesh = acquireDmgMesh(isCrit);
    const texture = (mesh.material as THREE.MeshBasicMaterial).map as THREE.CanvasTexture;
    const canvas = texture.image as HTMLCanvasElement;
    const ctx = canvas.getContext("2d")!;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = isCrit ? "600 28px \"DM Mono\"" : "600 24px \"DM Mono\"";
    ctx.fillStyle = isCrit ? COLORS.damageCrit : color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const prefix = isHeal ? "+" : "-";
    const text = isCrit ? `${prefix}${damage}!` : `${prefix}${damage}`;
    ctx.lineWidth = isCrit ? 3 : 2;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.7)";
    ctx.strokeText(text, canvas.width / 2, canvas.height / 2);
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);
    texture.needsUpdate = true;

    mesh.position.set(x, 1.5, z);
    scene.add(mesh);
    damageTexts.push({ mesh, life: 1000 });
}

/**
 * Show damage visual effects - hit flash, damage number, and log message.
 * Consolidates the common pattern of: hitFlashRef[id] = now + spawnDamageNumber + addLog
 */
export function showDamageVisual(
    scene: THREE.Scene,
    unitId: number,
    unitX: number,
    unitZ: number,
    damage: number,
    color: string,
    hitFlashRef: Record<number, number>,
    damageTexts: DamageText[],
    addLog: (text: string, color?: string) => void,
    logMessage: string,
    now: number
): void {
    hitFlashRef[unitId] = now;
    spawnDamageNumber(scene, unitX, unitZ, damage, color, damageTexts);
    addLog(logMessage, color);
}

/**
 * Handle unit defeat - hide unit, clear targeting from all units
 */
export function handleUnitDefeat(
    targetId: number,
    targetGroup: UnitGroup,
    unitsRef: Record<number, UnitGroup>,
    addLog: (text: string, color?: string) => void,
    targetName: string,
    silent: boolean = false
): void {
    if (!silent) {
        addLog(logDefeated(targetName), "#f59e0b");
        soundFns.playDeath();
    }
    targetGroup.visible = false;

    // Clear attack targets pointing to defeated unit
    Object.values(unitsRef).forEach((ug: UnitGroup) => {
        if (ug.userData.attackTarget === targetId) {
            ug.userData.attackTarget = null;
        }
    });

    // Clean up state for defeated unit
    cleanupUnitState(targetId);
    cleanupEnemyKiteCooldown(targetId);
}
