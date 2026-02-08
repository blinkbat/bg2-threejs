// =============================================================================
// COMBAT HELPERS - Damage numbers, defeat handling, projectiles
// =============================================================================

import * as THREE from "three";
import type { DamageText, UnitGroup, Unit, DamageType } from "../core/types";
import { PROJECTILE_CONFIG, COLORS, RING_EXPAND_DURATION } from "../core/constants";
import { getUnitRadius, isInRange } from "../rendering/range";
import { distanceToPoint } from "../game/geometry";
import { soundFns } from "../audio";
import { cleanupUnitState } from "../ai/movement";
import { cleanupEnemyKiteCooldown } from "../game/enemyState";
import { logDefeated, applyPoison, applySlowed, hasStatusEffect, isUnitAlive } from "./combatMath";
import { tryKillBark } from "./barks";
import { getNextUnitId } from "../core/unitIds";
import { ENEMY_STATS } from "../game/enemyStats";
import { getXpForLevel } from "../game/playerUnits";
import { trySubmergeKraken, isKrakenSubmerged } from "../gameLoop/enemyBehaviors";

// =============================================================================
// PROJECTILE CREATION
// =============================================================================

export type ProjectileType = "aoe" | "ranged" | "enemy";

/**
 * Create a projectile mesh with standardized configuration
 */
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
        new THREE.SphereGeometry(config.radius, config.segments, config.segments),
        new THREE.MeshBasicMaterial({ color: projectileColor })
    );
    projectile.position.set(x, config.height, z);
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

export interface ExpandingMeshConfig {
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
    }
): void {
    const {
        innerRadius = 0.5,
        outerRadius = 0.7,
        duration = RING_EXPAND_DURATION,
        initialOpacity = 0.8,
        maxScale
    } = config;

    const ring = new THREE.Mesh(
        new THREE.RingGeometry(innerRadius, outerRadius, 32),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: initialOpacity, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.1, z);
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

    const startTime = Date.now();
    let animationId: number | null = null;
    let disposed = false;

    const dispose = () => {
        if (disposed) return;
        disposed = true;
        if (animationId !== null) {
            cancelAnimationFrame(animationId);
            animationId = null;
        }
        scene.remove(mesh);
        mesh.geometry.dispose();
        (mesh.material as THREE.MeshBasicMaterial).dispose();
    };

    const animate = () => {
        if (disposed) return;

        const elapsed = Date.now() - startTime;
        const t = Math.min(1, elapsed / duration);
        const currentScale = baseRadius + (maxScale - baseRadius) * t;
        mesh.scale.set(currentScale / baseRadius, currentScale / baseRadius, 1);
        (mesh.material as THREE.MeshBasicMaterial).opacity = initialOpacity * (1 - t);

        if (t < 1) {
            requestAnimationFrame(animate);
        } else {
            dispose();
        }
    };
    requestAnimationFrame(animate);

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

    const startTime = Date.now();

    const animate = () => {
        const elapsed = Date.now() - startTime;
        const t = Math.min(1, elapsed / duration);

        // Flash bright at start, then fade
        const flashT = t < 0.2 ? 1 : (1 - (t - 0.2) / 0.8);
        (pillar.material as THREE.MeshBasicMaterial).opacity = flashT;
        (glow.material as THREE.MeshBasicMaterial).opacity = flashT * 0.8;

        // Expand glow ring slightly
        const glowScale = 1 + t * 0.5;
        glow.scale.set(glowScale, glowScale, 1);

        if (t < 1) {
            requestAnimationFrame(animate);
        } else {
            scene.remove(pillar);
            scene.remove(glow);
            pillar.geometry.dispose();
            (pillar.material as THREE.MeshBasicMaterial).dispose();
            glow.geometry.dispose();
            (glow.material as THREE.MeshBasicMaterial).dispose();
        }
    };
    requestAnimationFrame(animate);
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
    healAmount: number,
    maxHp: number
): void {
    if (healAmount <= 0) return;
    setUnits(prev => prev.map(u => {
        if (u.id !== attackerId) return u;
        return { ...u, hp: Math.min(u.hp + healAmount, maxHp) };
    }));
    spawnDamageNumber(scene, attackerX, attackerZ, healAmount, COLORS.logHeal, damageTexts, true);
}

export interface DamageOptions {
    poison?: { sourceId: number; damagePerTick?: number };  // Optional custom poison damage
    slow?: { sourceId: number };  // Apply slow debuff (1.5x cooldowns, 0.5x move speed)
    color?: string;
    skipDefeatTracking?: boolean;
    attackerName?: string;  // For bark system - name of the player unit dealing damage
    hitMessage?: { text: string; color: string };  // Log hit message before defeat message
    targetUnit?: Unit;  // Full unit data for special mechanics (e.g., amoeba split)
    attackerPosition?: { x: number; z: number };  // Position of attacker (for shield facing)
    damageType?: DamageType;  // Type of damage (for energy shield - chaos does 2x)
    isCrit?: boolean;  // Whether this was a critical hit (shows gold damage text)
}

/**
 * Apply damage to a unit with all side effects (state update, flash, damage number, defeat check)
 * Returns the new HP value
 */
export function applyDamageToUnit(
    ctx: DamageContext,
    targetId: number,
    targetGroup: UnitGroup,
    currentHp: number,
    damage: number,
    targetName: string,
    options: DamageOptions = {}
): number {
    const { scene, damageTexts, hitFlashRef, unitsRef, unitsStateRef, setUnits, addLog, now, defeatedThisFrame } = ctx;
    const { poison, slow, color = COLORS.damageEnemy, skipDefeatTracking = false, attackerName, hitMessage, targetUnit, attackerPosition, damageType, isCrit = false } = options;

    // Submerged krakens are invulnerable
    if (isKrakenSubmerged(targetId)) {
        return currentHp;
    }

    // Check for energy shield absorption
    const currentUnit = targetUnit ?? unitsStateRef.current?.find(u => u.id === targetId);
    const energyShield = currentUnit?.statusEffects?.find(e => e.type === "energyShield");

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

    const newHp = Math.max(0, currentHp - effectiveDamage);

    // Check for amoeba split mechanic
    const shouldSplit = targetUnit?.enemyType === "giant_amoeba" &&
        newHp > 0 &&  // Survived the hit
        (targetUnit.splitCount ?? 0) < (ENEMY_STATS.giant_amoeba.maxSplitCount ?? 3);

    if (shouldSplit && targetUnit) {
        // Amoeba splits! Original dies, two smaller ones spawn
        const currentSplitCount = targetUnit.splitCount ?? 0;
        const newSplitCount = currentSplitCount + 1;

        // Calculate HP for split offspring (divide remaining HP, minimum 1)
        const splitHp = Math.max(1, Math.floor(newHp / 2));

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
        setUnits(prev => [
            ...prev.map(u => {
                if (u.id !== targetId) return u;
                return { ...u, hp: 0 };  // Kill the original
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

        return 0;  // Original is now dead
    }

    // Normal damage handling (non-amoeba or can't split)
    setUnits(prev => prev.map(u => {
        if (u.id !== targetId) return u;
        let updated = { ...u, hp: newHp };

        // Update energy shield status effect
        if (shieldAbsorbed > 0 && updated.statusEffects) {
            if (shieldDepleted) {
                // Remove the depleted energy shield
                updated = {
                    ...updated,
                    statusEffects: updated.statusEffects.filter(e => e.type !== "energyShield")
                };
            } else {
                // Reduce shield amount
                updated = {
                    ...updated,
                    statusEffects: updated.statusEffects.map(e =>
                        e.type === "energyShield"
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
        // Apply slow debuff
        if (slow) {
            updated = applySlowed(updated, slow.sourceId, now);
        }
        return updated;
    }));

    // Log energy shield effects
    if (shieldAbsorbed > 0) {
        if (shieldDepleted) {
            addLog(`${targetName}'s Energy Shield shatters!`, "#9966ff");
        }
    }

    // Visual effects
    hitFlashRef[targetId] = now;
    // Show absorbed damage differently if shield took it
    const displayDamage = shieldAbsorbed > 0 ? damage : damage;
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
        if (targetUnit && targetUnit.team === "enemy" && targetUnit.enemyType) {
            const expReward = ENEMY_STATS[targetUnit.enemyType].expReward;
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
                setUnits(prev => prev.map(u => {
                    if (u.team === "player" && u.hp > 0) {
                        const newExp = (u.exp ?? 0) + expReward;
                        const currentLevel = u.level ?? 1;
                        const xpForNext = getXpForLevel(currentLevel + 1);
                        if (newExp >= xpForNext) {
                            return {
                                ...u,
                                exp: newExp,
                                level: currentLevel + 1,
                                statPoints: (u.statPoints ?? 0) + 5,
                                hp: u.hp + 2,
                                mana: (u.mana ?? 0) + 1,
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

                addLog(`Party gained ${expReward} XP!`, "#9b59b6");

                // Level-up effects
                if (leveledUpIds.length > 0) {
                    addLog(`Level up! +3 stat points available.`, "#ffd700");
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
            if (targetUnit.enemyType === "kraken_tentacle" && targetUnit.spawnedBy !== undefined) {
                const parentKraken = unitsStateRef.current.find(u => u.id === targetUnit.spawnedBy && u.hp > 0);
                if (parentKraken) {
                    const krakenG = unitsRef[parentKraken.id];
                    if (krakenG) {
                        const krakenStats = ENEMY_STATS.baby_kraken;
                        const tentacleDamage = krakenStats.tentacleSkill?.damageToParent ?? 15;
                        // Recursively apply damage to the kraken (skip defeat tracking since this is bonus damage)
                        applyDamageToUnit(
                            { scene, damageTexts, hitFlashRef, unitsRef, unitsStateRef, setUnits, addLog, now, defeatedThisFrame },
                            parentKraken.id, krakenG, parentKraken.hp, tentacleDamage, krakenStats.name,
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
    if (newHp > 0 && targetUnit?.enemyType === "baby_kraken") {
        trySubmergeKraken({ ...targetUnit, hp: newHp }, unitsRef, addLog, now);
    }

    return newHp;
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
    const canvas = document.createElement("canvas");
    canvas.width = isCrit ? 96 : 64;
    canvas.height = isCrit ? 48 : 32;
    const ctx = canvas.getContext("2d")!;
    ctx.font = isCrit ? "bold 28px monospace" : "bold 24px monospace";
    ctx.fillStyle = isCrit ? COLORS.damageCrit : color;
    ctx.textAlign = "center";
    const prefix = isHeal ? "+" : "-";
    const text = isCrit ? `${prefix}${damage}!` : `${prefix}${damage}`;
    ctx.fillText(text, canvas.width / 2, isCrit ? 36 : 24);

    const texture = new THREE.CanvasTexture(canvas);
    const planeWidth = isCrit ? 1.2 : 0.8;
    const planeHeight = isCrit ? 0.6 : 0.4;
    const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(planeWidth, planeHeight),
        new THREE.MeshBasicMaterial({ map: texture, transparent: true })
    );
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
