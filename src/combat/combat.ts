// =============================================================================
// COMBAT HELPERS - Damage numbers, defeat handling, projectiles
// =============================================================================

import * as THREE from "three";
import type { DamageText, UnitGroup, Unit } from "../core/types";
import { PROJECTILE_CONFIG, COLORS, RING_EXPAND_DURATION } from "../core/constants";
import { getUnitRadius, isInRange } from "../rendering/range";
import { distanceToPoint } from "../game/geometry";
import { soundFns } from "../audio/sound";
import { cleanupUnitState } from "../ai/movement";
import { cleanupEnemyKiteCooldown } from "../game/enemyState";
import { logDefeated, applyPoison, applySlowed, hasStatusEffect, isUnitAlive } from "./combatMath";
import { tryKillBark } from "./barks";
import { getNextUnitId } from "../core/unitIds";
import { ENEMY_STATS, getXpForLevel } from "../game/units";

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
            animationId = requestAnimationFrame(animate);
        } else {
            dispose();
        }
    };
    animationId = requestAnimationFrame(animate);

    return dispose;
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
    setUnits: React.Dispatch<React.SetStateAction<Unit[]>>;
    addLog: (text: string, color?: string) => void;
    now: number;
    defeatedThisFrame?: Set<number>;
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
    const { scene, damageTexts, hitFlashRef, unitsRef, setUnits, addLog, now, defeatedThisFrame } = ctx;
    const { poison, slow, color = COLORS.damageEnemy, skipDefeatTracking = false, attackerName, hitMessage, targetUnit, attackerPosition } = options;

    const newHp = Math.max(0, currentHp - damage);

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
        spawnDamageNumber(scene, targetGroup.position.x, targetGroup.position.z, damage, color, damageTexts);

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

    // Visual effects
    hitFlashRef[targetId] = now;
    spawnDamageNumber(scene, targetGroup.position.x, targetGroup.position.z, damage, color, damageTexts);

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
        // Bark on kill (only for player attackers)
        if (attackerName) {
            tryKillBark(attackerName, addLog);
        }
        // Award XP to all living player units when an enemy dies
        if (targetUnit && targetUnit.team === "enemy" && targetUnit.enemyType) {
            const expReward = ENEMY_STATS[targetUnit.enemyType].expReward;
            if (expReward > 0) {
                const leveledUp: string[] = [];
                setUnits(prev => prev.map(u => {
                    if (u.team === "player" && u.hp > 0) {
                        const newExp = (u.exp ?? 0) + expReward;
                        const currentLevel = u.level ?? 1;
                        const xpForNext = getXpForLevel(currentLevel + 1);

                        // Check for level-up
                        if (newExp >= xpForNext) {
                            leveledUp.push(u.id.toString());
                            return {
                                ...u,
                                exp: newExp,
                                level: currentLevel + 1,
                                statPoints: (u.statPoints ?? 0) + 3,
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
                if (leveledUp.length > 0) {
                    addLog(`Level up! +3 stat points available.`, "#ffd700");
                    soundFns.playLevelUp();
                }
            }
        }
    }

    return newHp;
}

/**
 * Spawn a floating damage number at the given position
 * @param isHeal - If true, shows + prefix instead of - prefix
 */
export function spawnDamageNumber(
    scene: THREE.Scene,
    x: number,
    z: number,
    damage: number,
    color: string,
    damageTexts: DamageText[],
    isHeal: boolean = false
): void {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 32;
    const ctx = canvas.getContext("2d")!;
    ctx.font = "bold 24px monospace";
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    const prefix = isHeal ? "+" : "-";
    ctx.fillText(`${prefix}${damage}`, 32, 24);

    const texture = new THREE.CanvasTexture(canvas);
    const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(0.8, 0.4),
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
