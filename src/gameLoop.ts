// =============================================================================
// GAME LOOP - Animation, projectiles, unit AI, movement
// =============================================================================

import * as THREE from "three";
import type { Unit, UnitData, UnitGroup, DamageText, Projectile, FogTexture, SwingAnimation, StatusEffect, EnemyStats, EnemySkill } from "./types";
import { GRID_SIZE, ATTACK_RANGE, MOVE_SPEED, HIT_DETECTION_RADIUS, FLASH_DURATION } from "./constants";
import { getUnitRadius, isInRange } from "./range";
import { blocked } from "./dungeon";
import { findPath, updateVisibility } from "./pathfinding";
import { getUnitStats, rollDamage, rollHit } from "./units";
import { spawnDamageNumber, handleUnitDefeat } from "./combat";
import { soundFns } from "./sound";
import { disposeBasicMesh, disposeTexturedMesh } from "./disposal";

// =============================================================================
// TYPES
// =============================================================================

export interface GameLoopRefs {
    unitsRef: React.RefObject<Record<number, UnitGroup>>;
    pathsRef: React.MutableRefObject<Record<number, { x: number; z: number }[]>>;
    visibilityRef: React.MutableRefObject<number[][]>;
    actionCooldownRef: React.MutableRefObject<Record<number, number>>;
    damageTexts: React.MutableRefObject<DamageText[]>;
    hitFlashRef: React.MutableRefObject<Record<number, number>>;
    unitMeshRef: React.RefObject<Record<number, THREE.Mesh>>;
    unitOriginalColorRef: React.RefObject<Record<number, THREE.Color>>;
    moveStartRef: React.MutableRefObject<Record<number, { time: number; x: number; z: number }>>;
    projectilesRef: React.MutableRefObject<Projectile[]>;
    fogTextureRef: React.RefObject<FogTexture | null>;
    moveMarkerRef: React.RefObject<THREE.Mesh | null>;
}

// Enemy skill cooldowns - tracked separately from basic attack
const enemySkillCooldowns: Record<number, number> = {};

// Track when units gave up on a path to prevent immediate retry
const gaveUpUntil: Record<number, number> = {};

// Throttle target acquisition - don't scan for targets every frame
const lastTargetScan: Record<number, number> = {};
const TARGET_SCAN_INTERVAL = 500; // ms between target scans

// Track targets that enemies couldn't reach (to avoid repeatedly targeting them)
const unreachableTargets: Record<number, { targetId: number; until: number }[]> = {};
const UNREACHABLE_COOLDOWN = 5000; // Don't retry unreachable target for 5 seconds

export interface GameLoopState {
    unitsStateRef: React.RefObject<Unit[]>;
    pausedRef: React.MutableRefObject<boolean>;
}

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
                disposeTexturedMesh(scene, dt.mesh);
                return false;
            }
        }
        return true;
    });
}

// =============================================================================
// HIT FLASH EFFECT
// =============================================================================

export function updateHitFlash(
    hitFlashRef: Record<number, number>,
    unitMeshRef: Record<number, THREE.Mesh>,
    unitOriginalColorRef: Record<number, THREE.Color>,
    unitsState: Unit[],
    now: number
): void {
    Object.entries(hitFlashRef).forEach(([id, hitTime]) => {
        const mesh = unitMeshRef[Number(id)];
        const originalColor = unitOriginalColorRef[Number(id)];
        if (!mesh || !originalColor) return;
        const elapsed = now - hitTime;

        // Get the target color (original or poison-tinted)
        const unit = unitsState.find(u => u.id === Number(id));
        const isPoisoned = unit?.statusEffects?.some(e => e.type === "poison");
        const targetColor = isPoisoned
            ? new THREE.Color(originalColor).lerp(new THREE.Color("#4a7c4a"), 0.4)
            : originalColor;

        if (elapsed > FLASH_DURATION) {
            (mesh.material as THREE.MeshStandardMaterial).color.copy(targetColor);
            delete hitFlashRef[Number(id)];
        } else {
            const t = elapsed / FLASH_DURATION;
            const flashColor = new THREE.Color(1, 1, 1).lerp(targetColor, t);
            (mesh.material as THREE.MeshStandardMaterial).color.copy(flashColor);
        }
    });
}

export function updatePoisonVisuals(
    unitsState: Unit[],
    unitMeshRef: Record<number, THREE.Mesh>,
    unitOriginalColorRef: Record<number, THREE.Color>,
    hitFlashRef: Record<number, number>
): void {
    unitsState.forEach(unit => {
        const mesh = unitMeshRef[unit.id];
        const originalColor = unitOriginalColorRef[unit.id];
        if (!mesh || !originalColor) return;

        // Skip if currently flashing (hit flash will handle the color)
        if (hitFlashRef[unit.id] !== undefined) return;

        const isPoisoned = unit.statusEffects?.some(e => e.type === "poison");

        if (isPoisoned) {
            // Apply green poison tint
            const poisonColor = new THREE.Color(originalColor).lerp(new THREE.Color("#4a7c4a"), 0.4);
            (mesh.material as THREE.MeshStandardMaterial).color.copy(poisonColor);
        } else {
            // Restore original color
            (mesh.material as THREE.MeshStandardMaterial).color.copy(originalColor);
        }
    });
}

// =============================================================================
// STATUS EFFECT HELPERS
// =============================================================================

const POISON_DURATION = 8000;      // 8 seconds
const POISON_TICK_INTERVAL = 1000; // tick every 1 second
const POISON_DAMAGE_PER_TICK = 2;  // 2 damage per tick

/**
 * Check if poison should be applied and return whether it will be applied.
 * Does NOT call setUnits - caller should combine with damage update.
 */
function shouldApplyPoison(
    attackerData: EnemyStats
): boolean {
    if (!('poisonChance' in attackerData) || !attackerData.poisonChance) return false;
    return Math.random() * 100 < attackerData.poisonChance;
}

/**
 * Apply poison effect to a unit's status effects array.
 * Returns the updated statusEffects array.
 */
function applyPoisonToUnit(
    existingEffects: StatusEffect[] | undefined,
    attackerId: number,
    now: number
): StatusEffect[] {
    const effects = existingEffects || [];
    const existingPoison = effects.find(e => e.type === "poison");

    if (existingPoison) {
        // Refresh duration
        return effects.map(e =>
            e.type === "poison"
                ? { ...e, duration: POISON_DURATION, lastTick: now }
                : e
        );
    }

    // Apply new poison
    const newPoison: StatusEffect = {
        type: "poison",
        duration: POISON_DURATION,
        tickInterval: POISON_TICK_INTERVAL,
        lastTick: now,
        damagePerTick: POISON_DAMAGE_PER_TICK,
        sourceId: attackerId
    };

    return [...effects, newPoison];
}

export function processStatusEffects(
    unitsState: Unit[],
    unitsRef: Record<number, UnitGroup>,
    scene: THREE.Scene,
    damageTexts: DamageText[],
    hitFlashRef: Record<number, number>,
    setUnits: React.Dispatch<React.SetStateAction<Unit[]>>,
    addLog: (text: string, color?: string) => void,
    now: number,
    defeatedThisFrame: Set<number>
): void {
    unitsState.forEach(unit => {
        if (unit.hp <= 0 || defeatedThisFrame.has(unit.id)) return;
        if (!unit.statusEffects || unit.statusEffects.length === 0) return;

        const unitG = unitsRef[unit.id];
        if (!unitG) return;

        const data = getUnitStats(unit);

        unit.statusEffects.forEach(effect => {
            if (effect.type === "poison") {
                // Check if it's time for a tick
                if (now - effect.lastTick >= effect.tickInterval) {
                    // Deal poison damage
                    const dmg = effect.damagePerTick;
                    // Calculate newHp BEFORE setUnits to avoid race condition
                    const newHp = Math.max(0, unit.hp - dmg);

                    setUnits(prev => prev.map(u => {
                        if (u.id !== unit.id) return u;

                        const updatedEffects = (u.statusEffects || []).map(e => {
                            if (e.type === "poison") {
                                const newDuration = e.duration - effect.tickInterval;
                                return { ...e, duration: newDuration, lastTick: now };
                            }
                            return e;
                        }).filter(e => e.duration > 0);

                        return {
                            ...u,
                            hp: newHp,
                            statusEffects: updatedEffects.length > 0 ? updatedEffects : undefined
                        };
                    }));

                    hitFlashRef[unit.id] = now;
                    spawnDamageNumber(scene, unitG.position.x, unitG.position.z, dmg, "#7cba7c", damageTexts);

                    if (newHp <= 0) {
                        defeatedThisFrame.add(unit.id);
                        handleUnitDefeat(unit.id, unitG, unitsRef, addLog, data.name);
                    }
                }
            }
        });
    });
}

// =============================================================================
// PROJECTILE UPDATES
// =============================================================================

function disposeProjectile(scene: THREE.Scene, proj: Projectile): void {
    disposeBasicMesh(scene, proj.mesh);
}

export function updateProjectiles(
    projectilesRef: Projectile[],
    unitsRef: Record<number, UnitGroup>,
    unitsState: Unit[],
    scene: THREE.Scene,
    damageTexts: DamageText[],
    hitFlashRef: Record<number, number>,
    setUnits: React.Dispatch<React.SetStateAction<Unit[]>>,
    addLog: (text: string, color?: string) => void,
    now: number,
    defeatedThisFrame: Set<number>
): Projectile[] {
    return projectilesRef.filter(proj => {
        // AOE projectile (like Fireball)
        if (proj.type === "aoe") {
            const { targetPos, aoeRadius, damage } = proj;
            const dx = targetPos.x - proj.mesh.position.x;
            const dz = targetPos.z - proj.mesh.position.z;
            const dist = Math.hypot(dx, dz);

            if (dist < HIT_DETECTION_RADIUS) {
                const attackerUnit = unitsState.find(u => u.id === proj.attackerId);
                const attackerData = attackerUnit ? getUnitStats(attackerUnit) : null;

                // Create explosion effect
                const explosion = new THREE.Mesh(
                    new THREE.RingGeometry(0.1, aoeRadius, 32),
                    new THREE.MeshBasicMaterial({ color: "#ff4400", transparent: true, opacity: 0.6, side: THREE.DoubleSide })
                );
                explosion.rotation.x = -Math.PI / 2;
                explosion.position.set(targetPos.x, 0.1, targetPos.z);
                scene.add(explosion);
                setTimeout(() => disposeBasicMesh(scene, explosion), 300);
                soundFns.playExplosion();

                // Deal damage to ALL units in radius (friendly fire!)
                let hitCount = 0;
                unitsState.filter(u => u.hp > 0 && !defeatedThisFrame.has(u.id)).forEach(target => {
                    const tg = unitsRef[target.id];
                    if (!tg) return;
                    const targetDist = Math.hypot(tg.position.x - targetPos.x, tg.position.z - targetPos.z);
                    if (targetDist <= aoeRadius) {
                        const targetData = getUnitStats(target);
                        const rawDmg = rollDamage(damage[0], damage[1]);
                        const dmg = Math.max(1, rawDmg - targetData.armor);
                        // Calculate newHp BEFORE setUnits to avoid stale state
                        const newHp = Math.max(0, target.hp - dmg);

                        setUnits(prev => prev.map(u => u.id === target.id ? { ...u, hp: newHp } : u));
                        hitFlashRef[target.id] = now;
                        hitCount++;

                        spawnDamageNumber(scene, tg.position.x, tg.position.z, dmg, target.team === "player" ? "#f87171" : "#ff6600", damageTexts);

                        if (newHp <= 0) {
                            defeatedThisFrame.add(target.id);
                            handleUnitDefeat(target.id, tg, unitsRef, addLog, targetData.name);
                        }
                    }
                });

                if (hitCount > 0) {
                    soundFns.playHit();
                    addLog(`${attackerData?.name ?? "Unknown"}'s Fireball hits ${hitCount} targets!`, "#ff6600");
                }

                disposeProjectile(scene, proj);
                return false;
            }

            // Move projectile
            proj.mesh.position.x += (dx / dist) * proj.speed;
            proj.mesh.position.z += (dz / dist) * proj.speed;
            return true;
        }

        // Regular projectile (single target)
        if (proj.type !== "basic") return true;
        const targetUnit = unitsState.find(u => u.id === proj.targetId);
        const targetG = unitsRef[proj.targetId];
        const attackerUnit = unitsState.find(u => u.id === proj.attackerId);

        if (!targetUnit || !targetG || targetUnit.hp <= 0 || defeatedThisFrame.has(proj.targetId) || !attackerUnit) {
            disposeProjectile(scene, proj);
            return false;
        }

        const dx = targetG.position.x - proj.mesh.position.x;
        const dz = targetG.position.z - proj.mesh.position.z;
        const dist = Math.hypot(dx, dz);

        if (dist < HIT_DETECTION_RADIUS) {
            const attackerData = getUnitStats(attackerUnit);
            const targetData = getUnitStats(targetUnit);
            const logColor = attackerUnit.team === "player" ? "#4ade80" : "#f87171";

            if (rollHit(attackerData.accuracy)) {
                const rawDmg = rollDamage(attackerData.damage[0], attackerData.damage[1]);
                const dmg = Math.max(1, rawDmg - targetData.armor);
                // Calculate newHp BEFORE setUnits to avoid stale state
                const newHp = Math.max(0, targetUnit.hp - dmg);

                // Check poison before setUnits to combine into single state update
                const applyPoison = attackerUnit.team === "enemy" && shouldApplyPoison(attackerData as EnemyStats);

                // Single setUnits call for both damage and poison
                setUnits(prev => prev.map(u => {
                    if (u.id !== targetUnit.id) return u;
                    let updated = { ...u, hp: newHp };
                    if (applyPoison) {
                        updated.statusEffects = applyPoisonToUnit(u.statusEffects, attackerUnit.id, now);
                    }
                    return updated;
                }));

                hitFlashRef[targetUnit.id] = now;
                soundFns.playHit();
                addLog(`${attackerData.name} hits ${targetData.name} for ${dmg} damage!`, logColor);
                spawnDamageNumber(scene, targetG.position.x, targetG.position.z, dmg, logColor, damageTexts);

                if (applyPoison) {
                    addLog(`${targetData.name} is poisoned!`, "#7cba7c");
                }

                if (newHp <= 0) {
                    defeatedThisFrame.add(targetUnit.id);
                    handleUnitDefeat(targetUnit.id, targetG, unitsRef, addLog, targetData.name);
                }
            } else {
                soundFns.playMiss();
                addLog(`${attackerData.name} misses ${targetData.name}.`, "#888");
            }

            disposeProjectile(scene, proj);
            return false;
        }

        proj.mesh.position.x += (dx / dist) * proj.speed;
        proj.mesh.position.z += (dz / dist) * proj.speed;
        return true;
    });
}

// =============================================================================
// FOG OF WAR UPDATE
// =============================================================================

export function updateFogOfWar(
    visibility: number[][],
    playerUnits: Unit[],
    unitsRef: Record<number, UnitGroup>,
    fogTexture: FogTexture,
    unitsState: Unit[]
): void {
    updateVisibility(visibility, playerUnits, { current: unitsRef });

    const { ctx, texture } = fogTexture;
    ctx.clearRect(0, 0, GRID_SIZE, GRID_SIZE);
    for (let x = 0; x < GRID_SIZE; x++) {
        for (let z = 0; z < GRID_SIZE; z++) {
            const vis = visibility[x][z];
            if (vis === 2) continue;
            ctx.fillStyle = vis === 1 ? "rgba(0,0,0,0.5)" : "rgba(0,0,0,0.95)";
            ctx.fillRect(x, z, 1, 1);
        }
    }
    texture.needsUpdate = true;

    // Hide enemies in fog
    unitsState.filter(u => u.team === "enemy").forEach(u => {
        const g = unitsRef[u.id];
        if (!g) return;
        const cx = Math.floor(g.position.x), cz = Math.floor(g.position.z);
        const vis = visibility[cx]?.[cz] ?? 0;
        g.visible = u.hp > 0 && vis === 2;
    });
}

// =============================================================================
// ENEMY SKILL EXECUTION
// =============================================================================

function executeEnemySwipe(
    _unit: Unit,
    g: UnitGroup,
    skill: EnemySkill,
    enemyData: EnemyStats,
    unitsRef: Record<number, UnitGroup>,
    unitsState: Unit[],
    scene: THREE.Scene,
    damageTexts: DamageText[],
    hitFlashRef: Record<number, number>,
    setUnits: React.Dispatch<React.SetStateAction<Unit[]>>,
    addLog: (text: string, color?: string) => void,
    now: number,
    defeatedThisFrame: Set<number>
): boolean {
    // Find up to maxTargets player units within range
    const targets: { unit: Unit; group: UnitGroup; dist: number }[] = [];

    unitsState.filter(u => u.team === "player" && u.hp > 0 && !defeatedThisFrame.has(u.id)).forEach(target => {
        const tg = unitsRef[target.id];
        if (!tg) return;
        const targetRadius = getUnitRadius(target);
        if (isInRange(g.position.x, g.position.z, tg.position.x, tg.position.z, targetRadius, skill.range)) {
            const dist = Math.hypot(tg.position.x - g.position.x, tg.position.z - g.position.z);
            targets.push({ unit: target, group: tg, dist });
        }
    });

    // Need at least 1 target
    if (targets.length === 0) return false;

    // Sort by distance and take up to maxTargets
    targets.sort((a, b) => a.dist - b.dist);
    const hitTargets = targets.slice(0, skill.maxTargets);

    // Visual effect - wide arc swipe
    const swipeArc = new THREE.Mesh(
        new THREE.RingGeometry(0.3, skill.range, 32, 1, -Math.PI / 2, Math.PI),
        new THREE.MeshBasicMaterial({ color: "#ff4444", transparent: true, opacity: 0.6, side: THREE.DoubleSide })
    );
    swipeArc.rotation.x = -Math.PI / 2;
    swipeArc.position.set(g.position.x, 0.2, g.position.z);

    // Rotate arc to face the primary target
    if (hitTargets.length > 0) {
        const angle = Math.atan2(
            hitTargets[0].group.position.z - g.position.z,
            hitTargets[0].group.position.x - g.position.x
        );
        swipeArc.rotation.z = angle;
    }
    scene.add(swipeArc);

    // Animate the swipe
    const startTime = now;
    const animateDuration = 300;
    const animateSwipe = () => {
        const elapsed = Date.now() - startTime;
        const t = Math.min(1, elapsed / animateDuration);
        (swipeArc.material as THREE.MeshBasicMaterial).opacity = 0.6 * (1 - t);
        swipeArc.scale.set(1 + t * 0.3, 1 + t * 0.3, 1);

        if (t < 1) {
            requestAnimationFrame(animateSwipe);
        } else {
            scene.remove(swipeArc);
            swipeArc.geometry.dispose();
            (swipeArc.material as THREE.MeshBasicMaterial).dispose();
        }
    };
    requestAnimationFrame(animateSwipe);

    // Play sound
    soundFns.playHit();

    // Deal damage to all targets
    let hitCount = 0;
    hitTargets.forEach(({ unit: target, group: tg }) => {
        const targetData = getUnitStats(target);

        if (rollHit(enemyData.accuracy)) {
            const rawDmg = rollDamage(skill.damage[0], skill.damage[1]);
            const dmg = Math.max(1, rawDmg - targetData.armor);
            // Calculate newHp BEFORE setUnits to avoid stale state
            const newHp = Math.max(0, target.hp - dmg);

            setUnits(prev => prev.map(u => u.id === target.id ? { ...u, hp: newHp } : u));
            hitFlashRef[target.id] = now;
            hitCount++;

            spawnDamageNumber(scene, tg.position.x, tg.position.z, dmg, "#ff4444", damageTexts);

            if (newHp <= 0) {
                defeatedThisFrame.add(target.id);
                handleUnitDefeat(target.id, tg, unitsRef, addLog, targetData.name);
            }
        }
    });

    if (hitCount > 0) {
        addLog(`${enemyData.name}'s ${skill.name} hits ${hitCount} target${hitCount > 1 ? 's' : ''}!`, "#ff4444");
    } else {
        addLog(`${enemyData.name}'s ${skill.name} misses!`, "#888");
    }

    return true;
}

// =============================================================================
// MELEE SWING ANIMATION
// =============================================================================

const SWING_DURATION = 150;

export function spawnSwingIndicator(
    scene: THREE.Scene,
    attackerG: UnitGroup,
    targetG: UnitGroup,
    isPlayer: boolean,
    swingAnimations: SwingAnimation[],
    now: number
): void {
    const swingDot = new THREE.Mesh(
        new THREE.SphereGeometry(0.08, 8, 8),
        new THREE.MeshBasicMaterial({ color: isPlayer ? "#ffffff" : "#ff6666" })
    );
    const startAngle = Math.atan2(
        targetG.position.z - attackerG.position.z,
        targetG.position.x - attackerG.position.x
    ) - Math.PI / 3;
    swingDot.position.set(
        attackerG.position.x + Math.cos(startAngle) * 0.5,
        0.7,
        attackerG.position.z + Math.sin(startAngle) * 0.5
    );
    scene.add(swingDot);

    swingAnimations.push({
        mesh: swingDot,
        attackerX: attackerG.position.x,
        attackerZ: attackerG.position.z,
        startAngle,
        startTime: now,
        duration: SWING_DURATION
    });
}

export function updateSwingAnimations(
    swingAnimations: SwingAnimation[],
    scene: THREE.Scene,
    now: number
): SwingAnimation[] {
    return swingAnimations.filter(swing => {
        const elapsed = now - swing.startTime;
        const t = Math.min(1, elapsed / swing.duration);
        const angle = swing.startAngle + (Math.PI * 2 / 3) * t;
        swing.mesh.position.x = swing.attackerX + Math.cos(angle) * 0.5;
        swing.mesh.position.z = swing.attackerZ + Math.sin(angle) * 0.5;

        if (t >= 1) {
            disposeBasicMesh(scene, swing.mesh);
            return false;
        }
        return true;
    });
}

// =============================================================================
// UNIT AI & MOVEMENT
// =============================================================================

export function updateUnitAI(
    unit: Unit,
    g: UnitGroup,
    unitsRef: Record<number, UnitGroup>,
    unitsState: Unit[],
    visibility: number[][],
    pathsRef: Record<number, { x: number; z: number }[]>,
    actionCooldownRef: Record<number, number>,
    hitFlashRef: Record<number, number>,
    projectilesRef: Projectile[],
    damageTexts: DamageText[],
    swingAnimations: SwingAnimation[],
    moveStartRef: Record<number, { time: number; x: number; z: number }>,
    scene: THREE.Scene,
    setUnits: React.Dispatch<React.SetStateAction<Unit[]>>,
    setSkillCooldowns: React.Dispatch<React.SetStateAction<Record<string, { end: number; duration: number }>>>,
    addLog: (text: string, color?: string) => void,
    now: number,
    defeatedThisFrame: Set<number>
): void {
    const isPlayer = unit.team === "player";
    const data = getUnitStats(unit);

    // AI targeting
    const shouldAutoTarget = isPlayer ? unit.aiEnabled : true;
    const currentTarget = g.userData.attackTarget;

    // Check if current target is still valid
    let targetStillValid = false;
    if (currentTarget !== null && currentTarget !== undefined) {
        const targetUnit = unitsState.find(u => u.id === currentTarget);
        targetStillValid = targetUnit !== undefined && targetUnit.hp > 0 && !defeatedThisFrame.has(currentTarget);
        if (!targetStillValid) {
            g.userData.attackTarget = null;
        }
    }

    // Find new target (throttled to avoid scanning every frame)
    const hasActivePath = pathsRef[unit.id]?.length > 0;
    const isExecutingMoveCommand = hasActivePath && g.userData.attackTarget === null;
    const canAutoTarget = shouldAutoTarget && !targetStillValid && !isExecutingMoveCommand;
    const lastScan = lastTargetScan[unit.id] || 0;
    const canScanForTargets = now - lastScan >= TARGET_SCAN_INTERVAL;

    if (canAutoTarget && canScanForTargets) {
        lastTargetScan[unit.id] = now;
        const aggroRange = isPlayer ? 12 : (data as { aggroRange: number }).aggroRange;
        const enemyTeam = isPlayer ? "enemy" : "player";
        let nearest: number | null = null, nearestDist = aggroRange;

        // For enemies, get list of targets they recently couldn't reach
        const blockedTargets = !isPlayer && unreachableTargets[unit.id]
            ? unreachableTargets[unit.id].filter(e => e.until > now).map(e => e.targetId)
            : [];

        unitsState.filter(u => u.team === enemyTeam && u.hp > 0).forEach(enemy => {
            // Skip targets that this enemy recently couldn't reach
            if (blockedTargets.includes(enemy.id)) return;

            const eg = unitsRef[enemy.id];
            if (!eg) return;
            const enemyX = Math.floor(eg.position.x), enemyZ = Math.floor(eg.position.z);
            const canSee = isPlayer ? (visibility[enemyX]?.[enemyZ] === 2) : true;
            if (canSee) {
                const d = Math.hypot(g.position.x - eg.position.x, g.position.z - eg.position.z);
                if (d < nearestDist) { nearestDist = d; nearest = enemy.id; }
            }
        });

        if (nearest !== null) {
            // Don't start new path if we recently gave up (prevents jitter)
            const recentlyGaveUp = gaveUpUntil[unit.id] && now < gaveUpUntil[unit.id];
            if (!recentlyGaveUp) {
                g.userData.attackTarget = nearest;
                const targetG = unitsRef[nearest];
                if (targetG) {
                    const path = findPath(g.position.x, g.position.z, targetG.position.x, targetG.position.z);
                    pathsRef[unit.id] = path ? path.slice(1) : [];
                    if (path && path.length > 0) {
                        moveStartRef[unit.id] = { time: now, x: g.position.x, z: g.position.z };
                    }
                } else {
                    pathsRef[unit.id] = [];
                }
            }
        }
    }

    let targetX = g.position.x, targetZ = g.position.z;

    if (g.userData.attackTarget) {
        const targetG = unitsRef[g.userData.attackTarget];
        const targetU = unitsState.find(u => u.id === g.userData.attackTarget);

        if (targetG && targetU && targetU.hp > 0) {
            targetX = targetG.position.x;
            targetZ = targetG.position.z;
            const isRanged = 'range' in data && data.range !== undefined;
            const unitRange = isRanged ? (data as { range: number }).range : ATTACK_RANGE;

            // Use hitbox-aware range: if closest edge of target is in range, we can attack
            const targetRadius = getUnitRadius(targetU);
            const inAttackRange = isInRange(g.position.x, g.position.z, targetX, targetZ, targetRadius, unitRange);

            if (inAttackRange && pathsRef[unit.id]?.length > 0) {
                pathsRef[unit.id] = [];
            }

            if (inAttackRange) {
                const cooldownEnd = actionCooldownRef[unit.id] || 0;
                if (now >= cooldownEnd) {
                    // Check if enemy has a skill and it's ready
                    if (!isPlayer && 'skill' in data && data.skill) {
                        const skill = data.skill;
                        const skillCooldownEnd = enemySkillCooldowns[unit.id] || 0;

                        // Use skill if: cooldown ready AND targets in range (hitbox-aware)
                        const inSkillRange = isInRange(g.position.x, g.position.z, targetX, targetZ, targetRadius, skill.range);
                        if (now >= skillCooldownEnd && inSkillRange) {
                            // Count potential targets (using hitbox-aware range)
                            const potentialTargets = unitsState.filter(u =>
                                u.team === "player" && u.hp > 0 && !defeatedThisFrame.has(u.id)
                            ).filter(u => {
                                const tg = unitsRef[u.id];
                                if (!tg) return false;
                                const uRadius = getUnitRadius(u);
                                return isInRange(g.position.x, g.position.z, tg.position.x, tg.position.z, uRadius, skill.range);
                            });

                            // Use skill if there are 2+ targets, or randomly with 1 target
                            if (potentialTargets.length >= 2 || (potentialTargets.length === 1 && Math.random() < 0.3)) {
                                const executed = executeEnemySwipe(
                                    unit, g, skill, data as EnemyStats,
                                    unitsRef, unitsState, scene, damageTexts,
                                    hitFlashRef, setUnits, addLog, now, defeatedThisFrame
                                );
                                if (executed) {
                                    enemySkillCooldowns[unit.id] = now + skill.cooldown;
                                    actionCooldownRef[unit.id] = now + data.attackCooldown;
                                    return;
                                }
                            }
                        }
                    }

                    const attackCooldownEnd = now + data.attackCooldown;
                    actionCooldownRef[unit.id] = attackCooldownEnd;

                    if (isPlayer) {
                        const cooldownData = { end: attackCooldownEnd, duration: data.attackCooldown };
                        const skillCooldownUpdates: Record<string, { end: number; duration: number }> = { [`${unit.id}-Attack`]: cooldownData };
                        (data as UnitData).skills.forEach(s => { skillCooldownUpdates[`${unit.id}-${s.name}`] = cooldownData; });
                        setSkillCooldowns(prev => ({ ...prev, ...skillCooldownUpdates }));
                    }

                    if (isRanged && 'projectileColor' in data && data.projectileColor) {
                        const projectile = new THREE.Mesh(
                            new THREE.SphereGeometry(0.1, 8, 8),
                            new THREE.MeshBasicMaterial({ color: data.projectileColor as string })
                        );
                        projectile.position.set(g.position.x, 0.7, g.position.z);
                        scene.add(projectile);
                        projectilesRef.push({ type: "basic", mesh: projectile, targetId: targetU.id, attackerId: unit.id, speed: 0.3 });
                        soundFns.playAttack();
                    } else {
                        // Melee attack
                        const targetData = getUnitStats(targetU);
                        spawnSwingIndicator(scene, g, targetG, isPlayer, swingAnimations, now);

                        if (rollHit(data.accuracy)) {
                            const rawDmg = rollDamage(data.damage[0], data.damage[1]);
                            const dmg = Math.max(1, rawDmg - targetData.armor);
                            // Calculate newHp BEFORE setUnits to avoid stale state
                            const newHp = Math.max(0, targetU.hp - dmg);

                            setUnits(prev => prev.map(u => u.id === targetU.id ? { ...u, hp: newHp } : u));
                            hitFlashRef[targetU.id] = now;
                            soundFns.playHit();
                            const dmgColor = isPlayer ? "#4ade80" : "#f87171";
                            addLog(`${data.name} hits ${targetData.name} for ${dmg} damage!`, dmgColor);
                            spawnDamageNumber(scene, targetG.position.x, targetG.position.z, dmg, dmgColor, damageTexts);

                            if (newHp <= 0) {
                                defeatedThisFrame.add(targetU.id);
                                handleUnitDefeat(targetU.id, targetG, unitsRef, addLog, targetData.name);
                            }
                        } else {
                            soundFns.playMiss();
                            addLog(`${data.name} misses ${targetData.name}.`, "#888");
                        }
                    }
                }
                return;
            } else {
                // Recalculate path if needed (but not if we recently gave up)
                const recentlyGaveUp = gaveUpUntil[unit.id] && now < gaveUpUntil[unit.id];
                if (!recentlyGaveUp) {
                    const currentPath = pathsRef[unit.id];
                    let needsNewPath = !currentPath?.length;
                    if (!needsNewPath && currentPath && currentPath.length > 0) {
                        const pathEnd = currentPath[currentPath.length - 1];
                        const distToPathEnd = Math.hypot(pathEnd.x - targetX, pathEnd.z - targetZ);
                        needsNewPath = distToPathEnd > 2;
                    }
                    if (needsNewPath) {
                        const path = findPath(g.position.x, g.position.z, targetX, targetZ);
                        pathsRef[unit.id] = path ? path.slice(1) : [];
                        if (path && path.length > 0) {
                            moveStartRef[unit.id] = { time: now, x: g.position.x, z: g.position.z };
                        }
                    }
                }
            }
        } else {
            g.userData.attackTarget = null;
        }
    }

    // Path following
    const path = pathsRef[unit.id];
    if (path && path.length > 0) {
        targetX = path[0].x;
        targetZ = path[0].z;
        if (Math.hypot(targetX - g.position.x, targetZ - g.position.z) < 0.3) {
            path.shift();
            moveStartRef[unit.id] = { time: now, x: g.position.x, z: g.position.z };
        }
        // Stuck timeout - give up if barely moving
        const moveStart = moveStartRef[unit.id];
        if (moveStart) {
            const timeSinceStart = now - moveStart.time;
            const movedDist = Math.hypot(g.position.x - moveStart.x, g.position.z - moveStart.z);
            // Give up faster if really stuck (moved less than 0.2 in 1 second)
            const isReallyStuck = timeSinceStart > 1000 && movedDist < 0.2;
            const isStuck = timeSinceStart > 2000 && movedDist < 0.5;
            if (isReallyStuck || isStuck) {
                pathsRef[unit.id] = [];
                delete moveStartRef[unit.id];
                // Prevent immediate path recalculation - wait 1.5 seconds before retrying
                gaveUpUntil[unit.id] = now + 1500;

                // For enemies: clear current target and mark it as unreachable so they find a closer one
                if (!isPlayer && g.userData.attackTarget !== null) {
                    const failedTargetId = g.userData.attackTarget;
                    g.userData.attackTarget = null;
                    // Mark this target as unreachable for a while
                    if (!unreachableTargets[unit.id]) {
                        unreachableTargets[unit.id] = [];
                    }
                    // Clean up expired entries and add new one
                    unreachableTargets[unit.id] = unreachableTargets[unit.id]
                        .filter(entry => entry.until > now);
                    unreachableTargets[unit.id].push({
                        targetId: failedTargetId,
                        until: now + UNREACHABLE_COOLDOWN
                    });
                    // Allow immediate target re-scan to find closer target
                    lastTargetScan[unit.id] = 0;
                }
            }
        }
    }

    // Movement with avoidance
    const dx = targetX - g.position.x;
    const dz = targetZ - g.position.z;
    const distToTarget = Math.hypot(dx, dz);

    if (distToTarget > 0.1) {
        let desiredX = dx / distToTarget, desiredZ = dz / distToTarget;
        let avoidX = 0, avoidZ = 0;

        const myRadius = getUnitRadius(unit);
        Object.entries(unitsRef).forEach(([otherId, otherG]) => {
            if (String(unit.id) === otherId) return;
            const otherU = unitsState.find(u => u.id === Number(otherId));
            if (!otherU || otherU.hp <= 0) return;
            const otherRadius = getUnitRadius(otherU);
            const combinedRadius = myRadius + otherRadius;
            const ox = otherG.position.x - g.position.x, oz = otherG.position.z - g.position.z;
            const oDist = Math.hypot(ox, oz);

            if (oDist < combinedRadius * 1.5 && oDist > 0.01) {
                // Check if this unit is roughly in our path (dot product > 0 means ahead of us)
                const dot = (ox * desiredX + oz * desiredZ) / oDist;

                // Hard separation when overlapping - push directly away
                if (oDist < combinedRadius) {
                    const sepStrength = (combinedRadius - oDist) / combinedRadius;
                    avoidX -= (ox / oDist) * sepStrength * 2;
                    avoidZ -= (oz / oDist) * sepStrength * 2;
                }
                // Steering when unit is ahead and close - use unit ID to pick consistent side
                else if (dot > 0.3) {
                    const steerStrength = (combinedRadius * 1.5 - oDist) / (combinedRadius * 0.5);
                    // Use XOR of unit IDs to determine which unit steers which way
                    // This prevents both units from steering the same direction
                    const steerRight = (unit.id ^ Number(otherId)) % 2 === 0;
                    const perpX = steerRight ? -desiredZ : desiredZ;
                    const perpZ = steerRight ? desiredX : -desiredX;
                    avoidX += perpX * steerStrength * 0.5;
                    avoidZ += perpZ * steerStrength * 0.5;
                }
            }
        });

        let moveX = desiredX + avoidX, moveZ = desiredZ + avoidZ;
        const moveMag = Math.hypot(moveX, moveZ);
        if (moveMag > 0.01) {
            moveX = (moveX / moveMag) * MOVE_SPEED;
            moveZ = (moveZ / moveMag) * MOVE_SPEED;
            const newX = g.position.x + moveX, newZ = g.position.z + moveZ;
            const cellX = Math.floor(newX), cellZ = Math.floor(newZ);
            if (!blocked[cellX]?.[cellZ]) {
                g.position.x = Math.max(0.5, Math.min(GRID_SIZE - 0.5, newX));
                g.position.z = Math.max(0.5, Math.min(GRID_SIZE - 0.5, newZ));
            }
        }
    }
}

// =============================================================================
// HP BAR POSITIONS
// =============================================================================

export function updateHpBarPositions(
    unitsState: Unit[],
    unitsRef: Record<number, UnitGroup>,
    camera: THREE.OrthographicCamera,
    rendererRect: DOMRect,
    zoomLevel: number
): { positions: Record<number, { x: number; y: number; visible: boolean }>; scale: number } {
    const positions: Record<number, { x: number; y: number; visible: boolean }> = {};

    unitsState.forEach(u => {
        const g = unitsRef[u.id];
        if (!g) return;
        const isPlayer = u.team === "player";
        const data = getUnitStats(u);
        const size = (!isPlayer && 'size' in data && data.size) ? data.size : 1;
        const boxH = isPlayer ? 1 : (size > 1 ? 1.8 : 0.6);
        const worldPos = new THREE.Vector3(g.position.x, boxH + 0.4, g.position.z);
        worldPos.project(camera);
        const x = (worldPos.x * 0.5 + 0.5) * rendererRect.width;
        const y = (-worldPos.y * 0.5 + 0.5) * rendererRect.height;
        positions[u.id] = { x, y, visible: g.visible && u.hp > 0 };
    });

    const scale = 10 / zoomLevel;
    return { positions, scale };
}
