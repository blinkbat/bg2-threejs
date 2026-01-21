// =============================================================================
// GAME LOOP - Animation, projectiles, unit AI, movement
// =============================================================================

import * as THREE from "three";
import type { Unit, UnitGroup, DamageText, Projectile, FogTexture, SwingAnimation, EnemyStats, EnemySkill, EnemyHealSkill, EnemySpawnSkill, MagicMissileProjectile, TrapProjectile, StatusEffect } from "./core/types";
import {
    GRID_SIZE, HIT_DETECTION_RADIUS, FLASH_DURATION,
    SWING_DURATION, COLORS, SKILL_SINGLE_TARGET_CHANCE, POISON_TINT_STRENGTH
} from "./core/constants";
import { getUnitRadius, isInRange } from "./rendering/range";
import { updateVisibility } from "./ai/pathfinding";
import { getCurrentArea } from "./game/areas";
import { tryKite, type KiteContext } from "./ai/targeting";
import {
    runTargetingPhase, runPathFollowingPhase, runMovementPhase, recalculatePathIfNeeded,
    type TargetingContext, type PathContext, type MovementContext
} from "./ai/unitAI";
import { getUnitStats, getBasicAttackSkill, getAttackRange, ENEMY_STATS } from "./game/units";
import type { ActionQueue } from "./input";
import { calculateDamage, calculateDistance, getDirectionAndDistance, rollHit, shouldApplyPoison, hasPoisonEffect, hasStunnedEffect, hasPinnedEffect, getEffectiveArmor, logHit, logMiss, logPoisoned, logAoeHit, logAoeMiss, getDamageColor, logTrapTriggered } from "./combat/combatMath";
import { BUFF_TICK_INTERVAL } from "./core/constants";
import { SWIPE_ANIMATE_DURATION } from "./core/constants";
import { spawnDamageNumber, handleUnitDefeat, createProjectile, getProjectileSpeed, applyDamageToUnit, animateExpandingMesh, getAliveUnitsInRange, type DamageContext } from "./combat/combat";
import { soundFns } from "./audio/sound";
import { disposeBasicMesh, disposeTexturedMesh } from "./rendering/disposal";
import { isEnemyKiting, clearEnemyKiting, hasBroodMotherScreeched, markBroodMotherScreeched } from "./game/enemyState";

// =============================================================================
// MAGIC WAVE VOLLEY TRACKING
// =============================================================================

// Track hits and damage for each Magic Wave volley
interface VolleyStats {
    hits: number;
    totalDamage: number;
    missilesResolved: number;
    totalMissiles: number;
    attackerName: string;
}
const magicWaveVolleys: Map<number, VolleyStats> = new Map();

// =============================================================================
// UNIT ID COUNTER - Prevents ID collision when spawning units
// =============================================================================

let nextUnitId = 1000;  // Start high to avoid collision with initial party IDs

/** Get the next unique unit ID for spawning */
export function getNextUnitId(): number {
    return nextUnitId++;
}

/** Initialize the unit ID counter based on existing units (call on game start/restart) */
export function initializeUnitIdCounter(units: Unit[]): void {
    const maxId = Math.max(...units.map(u => u.id), 0);
    nextUnitId = maxId + 1;
}

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

// Pre-allocated color objects to avoid allocations every frame
const _flashWhite = new THREE.Color(1, 1, 1);
const _tempColor = new THREE.Color();
const _targetColor = new THREE.Color();
const _poisonColor = new THREE.Color(COLORS.poison);

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

        // Get the target color (original or poison-tinted) - reuse _targetColor
        const unit = unitsState.find(u => u.id === Number(id));
        const isPoisoned = unit ? hasPoisonEffect(unit) : false;
        if (isPoisoned) {
            _targetColor.copy(originalColor).lerp(_poisonColor, POISON_TINT_STRENGTH);
        } else {
            _targetColor.copy(originalColor);
        }

        if (elapsed > FLASH_DURATION) {
            (mesh.material as THREE.MeshStandardMaterial).color.copy(_targetColor);
            delete hitFlashRef[Number(id)];
        } else {
            const t = elapsed / FLASH_DURATION;
            // Reuse _tempColor: start with white, lerp to target
            _tempColor.copy(_flashWhite).lerp(_targetColor, t);
            (mesh.material as THREE.MeshStandardMaterial).color.copy(_tempColor);
        }
    });
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

        // Skip if currently flashing (hit flash will handle the color)
        if (hitFlashRef[unit.id] !== undefined) continue;

        const isPoisoned = hasPoisonEffect(unit);

        if (isPoisoned) {
            // Apply green poison tint - reuse _tempColor
            _tempColor.copy(originalColor).lerp(_poisonColor, POISON_TINT_STRENGTH);
            (mesh.material as THREE.MeshStandardMaterial).color.copy(_tempColor);
        } else {
            // Restore original color
            (mesh.material as THREE.MeshStandardMaterial).color.copy(originalColor);
        }
    }
}

// =============================================================================
// AGGRO ON HIT
// =============================================================================

/**
 * When an enemy is hit by a player, alert them so they seek the nearest player.
 */
function aggroOnHit(
    targetUnit: Unit,
    _attackerId: number,
    unitsRef: Record<number, UnitGroup>
): void {
    // Only enemies aggro when hit by players
    if (targetUnit.team !== "enemy") return;

    const targetG = unitsRef[targetUnit.id];
    if (!targetG) return;

    // Alert the enemy - they'll find the nearest player on their next targeting phase
    targetG.userData.alerted = true;
}

// =============================================================================
// STATUS EFFECT PROCESSING
// =============================================================================

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
                    // Track whether unit was defeated for post-update handling
                    let wasDefeated = false;

                    setUnits(prev => prev.map(u => {
                        if (u.id !== unit.id) return u;

                        // Calculate newHp from current state to avoid race condition
                        const newHp = Math.max(0, u.hp - dmg);
                        wasDefeated = newHp <= 0;

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
                    spawnDamageNumber(scene, unitG.position.x, unitG.position.z, dmg, COLORS.poisonText, damageTexts);
                    addLog(`${data.name} takes ${dmg} poison damage.`, COLORS.poisonText);

                    if (wasDefeated) {
                        defeatedThisFrame.add(unit.id);
                        handleUnitDefeat(unit.id, unitG, unitsRef, addLog, data.name);
                    }
                }
            } else if (effect.type === "shielded" || effect.type === "stunned" || effect.type === "cleansed" || effect.type === "pinned") {
                // Shielded/stunned/cleansed/pinned buff - tick down duration at fixed interval (like poison)
                if (now - effect.lastTick >= effect.tickInterval) {
                    setUnits(prev => prev.map(u => {
                        if (u.id !== unit.id) return u;

                        const updatedEffects = (u.statusEffects || []).map(e => {
                            if (e.type === effect.type) {
                                const newDuration = e.duration - e.tickInterval;
                                return { ...e, duration: newDuration, lastTick: now };
                            }
                            return e;
                        }).filter(e => e.duration > 0);

                        return {
                            ...u,
                            statusEffects: updatedEffects.length > 0 ? updatedEffects : undefined
                        };
                    }));
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
    // Track HP locally during projectile updates to handle multiple hits in same frame
    // This prevents stale HP from unitsState causing multiple projectiles to "overkill"
    const hpTracker: Record<number, number> = {};
    unitsState.forEach(u => { hpTracker[u.id] = u.hp; });

    return projectilesRef.filter(proj => {
        // AOE projectile (like Fireball)
        if (proj.type === "aoe") {
            const { targetPos, aoeRadius, damage } = proj;
            const { dx, dz, dist } = getDirectionAndDistance(proj.mesh.position.x, proj.mesh.position.z, targetPos.x, targetPos.z);

            // Reached target - explode
            if (dist < HIT_DETECTION_RADIUS) {
                const attackerUnit = unitsState.find(u => u.id === proj.attackerId);
                const attackerData = attackerUnit ? getUnitStats(attackerUnit) : null;

                // Create explosion effect with fade out
                const explosion = new THREE.Mesh(
                    new THREE.RingGeometry(0.1, aoeRadius, 32),
                    new THREE.MeshBasicMaterial({ color: "#ff4400", transparent: true, opacity: 0.6, side: THREE.DoubleSide })
                );
                explosion.rotation.x = -Math.PI / 2;
                explosion.position.set(targetPos.x, 0.1, targetPos.z);
                scene.add(explosion);
                animateExpandingMesh(scene, explosion, { duration: 400, initialOpacity: 0.6, maxScale: aoeRadius * 1.2, baseRadius: aoeRadius });
                soundFns.playExplosion();

                // Deal damage to ALL units in radius (friendly fire!)
                let hitCount = 0;
                let totalDamage = 0;
                // Use hpTracker for real-time HP checks (handles multiple hits in same frame)
                unitsState.filter(u => (hpTracker[u.id] ?? u.hp) > 0 && !defeatedThisFrame.has(u.id)).forEach(target => {
                    const tg = unitsRef[target.id];
                    if (!tg) return;
                    const targetDist = calculateDistance(tg.position.x, tg.position.z, targetPos.x, targetPos.z);
                    if (targetDist <= aoeRadius) {
                        const targetData = getUnitStats(target);
                        const currentHp = hpTracker[target.id] ?? target.hp;
                        const dmg = calculateDamage(damage[0], damage[1], getEffectiveArmor(target, targetData.armor));

                        const dmgCtx: DamageContext = { scene, damageTexts, hitFlashRef, unitsRef, setUnits, addLog, now, defeatedThisFrame };
                        applyDamageToUnit(dmgCtx, target.id, tg, currentHp, dmg, targetData.name, {
                            color: getDamageColor(target.team, true),
                            attackerName: attackerUnit?.team === "player" ? attackerData?.name : undefined
                        });
                        hpTracker[target.id] = Math.max(0, currentHp - dmg);
                        hitCount++;
                        totalDamage += dmg;

                        // Aggro enemies hit by player AOE
                        if (attackerUnit?.team === "player") {
                            aggroOnHit(target, proj.attackerId, unitsRef);
                        }
                    }
                });

                if (hitCount > 0) {
                    soundFns.playHit();
                    addLog(logAoeHit(attackerData?.name ?? "Unknown", "Fireball", hitCount, totalDamage), COLORS.damageNeutral);
                }

                disposeProjectile(scene, proj);
                return false;
            }

            // Move projectile (dx/dz already normalized by getDirectionAndDistance)
            proj.mesh.position.x += dx * proj.speed;
            proj.mesh.position.z += dz * proj.speed;
            return true;
        }

        // Magic Wave projectile - zig-zag homing (or position-targeted)
        if (proj.type === "magic_missile") {
            const mmProj = proj as MagicMissileProjectile;
            const attackerUnit = unitsState.find(u => u.id === mmProj.attackerId);

            if (!attackerUnit) {
                disposeProjectile(scene, proj);
                return false;
            }

            // Determine target position - either enemy position or fixed target position
            let targetX: number, targetZ: number;
            let targetUnit: Unit | undefined;
            let targetG: UnitGroup | undefined;

            if (mmProj.targetId === -1 && mmProj.targetPos) {
                // Position-based targeting (no enemy)
                targetX = mmProj.targetPos.x;
                targetZ = mmProj.targetPos.z;
            } else {
                // Enemy-based targeting
                targetUnit = unitsState.find(u => u.id === mmProj.targetId);
                targetG = unitsRef[mmProj.targetId];

                // Use hpTracker for real-time HP check (handles multiple hits in same frame)
                const trackedHp = hpTracker[mmProj.targetId] ?? 0;
                if (!targetUnit || !targetG || trackedHp <= 0 || defeatedThisFrame.has(mmProj.targetId)) {
                    // Target died or invalid - fizzle out, but still count toward volley
                    const attackerName = attackerUnit ? getUnitStats(attackerUnit).name : "Unknown";
                    if (!magicWaveVolleys.has(mmProj.volleyId)) {
                        magicWaveVolleys.set(mmProj.volleyId, {
                            hits: 0,
                            totalDamage: 0,
                            missilesResolved: 0,
                            totalMissiles: mmProj.totalMissiles,
                            attackerName
                        });
                    }
                    const volley = magicWaveVolleys.get(mmProj.volleyId)!;
                    volley.missilesResolved++;

                    // Log when all missiles in volley have resolved
                    if (volley.missilesResolved >= volley.totalMissiles) {
                        if (volley.hits > 0) {
                            addLog(logAoeHit(volley.attackerName, "Magic Wave", volley.hits, volley.totalDamage), "#9966ff");
                        } else {
                            addLog(logAoeMiss(volley.attackerName, "Magic Wave"), COLORS.logNeutral);
                        }
                        magicWaveVolleys.delete(mmProj.volleyId);
                    }

                    disposeProjectile(scene, proj);
                    return false;
                }

                targetX = targetG.position.x;
                targetZ = targetG.position.z;
            }

            const { dx, dz, dist } = getDirectionAndDistance(proj.mesh.position.x, proj.mesh.position.z, targetX, targetZ);

            // Hit detection
            if (dist < HIT_DETECTION_RADIUS) {
                let dmgDealt = 0;
                if (targetUnit && targetG) {
                    // Hit an enemy - use tracked HP to handle multiple hits in same frame
                    const targetData = getUnitStats(targetUnit);
                    const currentHp = hpTracker[targetUnit.id] ?? targetUnit.hp;
                    dmgDealt = calculateDamage(mmProj.damage[0], mmProj.damage[1], getEffectiveArmor(targetUnit, targetData.armor));

                    const dmgCtx: DamageContext = { scene, damageTexts, hitFlashRef, unitsRef, setUnits, addLog, now, defeatedThisFrame };
                    applyDamageToUnit(dmgCtx, targetUnit.id, targetG, currentHp, dmgDealt, targetData.name, {
                        color: "#9966ff",
                        attackerName: attackerUnit.team === "player" ? getUnitStats(attackerUnit).name : undefined
                    });

                    // Update local HP tracker for subsequent projectiles in same frame
                    hpTracker[targetUnit.id] = Math.max(0, currentHp - dmgDealt);

                    soundFns.playHit();
                }

                // Track volley stats for aggregated logging (attackerUnit already validated above)
                const attackerName = getUnitStats(attackerUnit).name;

                if (!magicWaveVolleys.has(mmProj.volleyId)) {
                    magicWaveVolleys.set(mmProj.volleyId, {
                        hits: 0,
                        totalDamage: 0,
                        missilesResolved: 0,
                        totalMissiles: mmProj.totalMissiles,
                        attackerName
                    });
                }
                const volley = magicWaveVolleys.get(mmProj.volleyId)!;
                volley.missilesResolved++;
                if (dmgDealt > 0) {
                    volley.hits++;
                    volley.totalDamage += dmgDealt;
                }

                // Log when all missiles in volley have resolved
                if (volley.missilesResolved >= volley.totalMissiles) {
                    if (volley.hits > 0) {
                        addLog(logAoeHit(volley.attackerName, "Magic Wave", volley.hits, volley.totalDamage), "#9966ff");
                    } else {
                        addLog(logAoeMiss(volley.attackerName, "Magic Wave"), COLORS.logNeutral);
                    }
                    magicWaveVolleys.delete(mmProj.volleyId);
                }

                disposeProjectile(scene, proj);
                return false;
            }

            // Zig-zag movement - oscillate perpendicular to direction of travel
            const time = now * 0.006 + mmProj.zigzagPhase * Math.PI;
            const zigzagAmount = Math.sin(time * 4) * 0.6;

            // Perpendicular direction (rotate 90 degrees)
            const perpX = -dz;
            const perpZ = dx;

            // Fan-out drift: missiles spread apart more as they travel
            // Calculate how far the missile has traveled from its start position
            const travelDist = Math.hypot(
                proj.mesh.position.x - mmProj.startX,
                proj.mesh.position.z - mmProj.startZ
            );
            // Lateral drift increases with travel distance (fanAngle is -0.5 to 0.5)
            // Stronger multipliers = more dramatic fan-out
            const fanDrift = mmProj.fanAngle * travelDist * 0.25;

            // Move forward + lateral zig-zag + fan-out drift
            proj.mesh.position.x += dx * mmProj.speed + perpX * (zigzagAmount * 0.18 + fanDrift * 0.12);
            proj.mesh.position.z += dz * mmProj.speed + perpZ * (zigzagAmount * 0.18 + fanDrift * 0.12);

            return true;
        }

        // Trap projectile (like Caltrops) - arc trajectory then wait for trigger
        if (proj.type === "trap") {
            const trapProj = proj as TrapProjectile;
            const elapsed = now - trapProj.startTime;

            if (!trapProj.isLanded) {
                // Arc trajectory during flight
                const t = Math.min(1, elapsed / trapProj.flightDuration);

                // Parabolic arc: lerp x/z, parabola for y
                const startX = trapProj.startX;
                const startZ = trapProj.startZ;
                const endX = trapProj.targetPos.x;
                const endZ = trapProj.targetPos.z;

                proj.mesh.position.x = startX + (endX - startX) * t;
                proj.mesh.position.z = startZ + (endZ - startZ) * t;
                // Parabolic height: 4 * h * t * (1 - t) peaks at t=0.5
                proj.mesh.position.y = 0.1 + trapProj.arcHeight * 4 * t * (1 - t);

                // Spin the trap during flight
                proj.mesh.rotation.x += 0.15;
                proj.mesh.rotation.y += 0.1;

                // Check if landed
                if (t >= 1) {
                    trapProj.isLanded = true;
                    proj.mesh.position.y = 0.15;  // Settle on ground
                    proj.mesh.rotation.x = 0;
                    proj.mesh.rotation.z = 0;
                    // Change color to indicate armed trap
                    (proj.mesh.material as THREE.MeshBasicMaterial).color.set("#cc4444");
                }
                return true;
            }

            // Trap is on the ground - check for enemy triggers
            const enemies = unitsState.filter(u =>
                u.team === "enemy" &&
                u.hp > 0 &&
                !defeatedThisFrame.has(u.id)
            );

            for (const enemy of enemies) {
                const enemyG = unitsRef[enemy.id];
                if (!enemyG) continue;

                const dist = calculateDistance(
                    enemyG.position.x, enemyG.position.z,
                    trapProj.targetPos.x, trapProj.targetPos.z
                );

                if (dist <= trapProj.aoeRadius) {
                    // Trap triggered! Apply pinned effect to all enemies in radius
                    let pinnedCount = 0;

                    enemies.forEach(target => {
                        const targetG = unitsRef[target.id];
                        if (!targetG) return;

                        const targetDist = calculateDistance(
                            targetG.position.x, targetG.position.z,
                            trapProj.targetPos.x, trapProj.targetPos.z
                        );

                        if (targetDist <= trapProj.aoeRadius) {
                            // Apply pinned effect
                            const pinnedEffect: StatusEffect = {
                                type: "pinned",
                                duration: trapProj.pinnedDuration,
                                tickInterval: BUFF_TICK_INTERVAL,
                                lastTick: now,
                                damagePerTick: 0,
                                sourceId: trapProj.attackerId
                            };

                            setUnits(prev => prev.map(u => {
                                if (u.id !== target.id) return u;
                                const existingEffects = u.statusEffects || [];
                                // Remove existing pinned effect if any (refresh)
                                const filteredEffects = existingEffects.filter(e => e.type !== "pinned");
                                return {
                                    ...u,
                                    statusEffects: [...filteredEffects, pinnedEffect]
                                };
                            }));

                            pinnedCount++;
                        }
                    });

                    // Visual effect - red ring expanding
                    const triggerRing = new THREE.Mesh(
                        new THREE.RingGeometry(0.2, trapProj.aoeRadius, 32),
                        new THREE.MeshBasicMaterial({ color: "#cc4444", transparent: true, opacity: 0.6, side: THREE.DoubleSide })
                    );
                    triggerRing.rotation.x = -Math.PI / 2;
                    triggerRing.position.set(trapProj.targetPos.x, 0.1, trapProj.targetPos.z);
                    scene.add(triggerRing);
                    animateExpandingMesh(scene, triggerRing, { duration: 400, initialOpacity: 0.6, maxScale: trapProj.aoeRadius * 1.3, baseRadius: trapProj.aoeRadius });

                    soundFns.playHit();
                    addLog(logTrapTriggered("Caltrops", pinnedCount), COLORS.pinnedText);

                    disposeProjectile(scene, proj);
                    return false;
                }
            }

            return true;  // Trap still active, waiting for trigger
        }

        // Regular projectile (single target) - validate target exists
        if (proj.type !== "basic") return true;
        const targetUnit = unitsState.find(u => u.id === proj.targetId);
        const targetG = unitsRef[proj.targetId];
        const attackerUnit = unitsState.find(u => u.id === proj.attackerId);

        // Guard clause: dispose if target invalid - use hpTracker for real-time HP
        const trackedTargetHp = hpTracker[proj.targetId] ?? 0;
        if (!targetUnit || !targetG || trackedTargetHp <= 0 || defeatedThisFrame.has(proj.targetId) || !attackerUnit) {
            disposeProjectile(scene, proj);
            return false;
        }

        const { dx, dz, dist } = getDirectionAndDistance(proj.mesh.position.x, proj.mesh.position.z, targetG.position.x, targetG.position.z);

        if (dist < HIT_DETECTION_RADIUS) {
            const attackerData = getUnitStats(attackerUnit);
            const targetData = getUnitStats(targetUnit);
            const logColor = getDamageColor(targetUnit.team);

            // Aggro enemies targeted by player projectiles (even on miss - arrow flew by their head!)
            if (attackerUnit.team === "player") {
                aggroOnHit(targetUnit, proj.attackerId, unitsRef);
            }

            if (rollHit(attackerData.accuracy)) {
                const dmg = calculateDamage(attackerData.damage[0], attackerData.damage[1], getEffectiveArmor(targetUnit, targetData.armor));
                const willPoison = attackerUnit.team === "enemy" && shouldApplyPoison(attackerData as EnemyStats);
                const poisonDmg = willPoison && 'poisonDamage' in attackerData ? (attackerData as EnemyStats).poisonDamage : undefined;

                const dmgCtx: DamageContext = { scene, damageTexts, hitFlashRef, unitsRef, setUnits, addLog, now, defeatedThisFrame };
                applyDamageToUnit(dmgCtx, targetUnit.id, targetG, targetUnit.hp, dmg, targetData.name, {
                    color: logColor,
                    poison: willPoison ? { sourceId: attackerUnit.id, damagePerTick: poisonDmg } : undefined,
                    attackerName: attackerUnit.team === "player" ? attackerData.name : undefined,
                    hitMessage: { text: logHit(attackerData.name, "Attack", targetData.name, dmg), color: logColor }
                });

                soundFns.playHit();

                if (willPoison) {
                    addLog(logPoisoned(targetData.name), COLORS.poisonText);
                }
            } else {
                soundFns.playMiss();
                addLog(logMiss(attackerData.name, "Attack", targetData.name), COLORS.logNeutral);
            }

            disposeProjectile(scene, proj);
            return false;
        }

        // Move projectile (dx/dz already normalized)
        proj.mesh.position.x += dx * proj.speed;
        proj.mesh.position.z += dz * proj.speed;
        return true;
    });
}

// =============================================================================
// FOG OF WAR UPDATE
// =============================================================================

// Cache for fog change detection - simple hash of visible cells
let lastFogHash = 0;

/**
 * Reset fog hash cache (call on game restart).
 */
export function resetFogCache(): void {
    lastFogHash = 0;
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

    // If area doesn't have fog of war, clear and hide it
    if (!area.hasFogOfWar) {
        fogMesh.visible = false;
        // Make all enemies visible
        unitsState.filter(u => u.team === "enemy").forEach(u => {
            const g = unitsRef[u.id];
            if (g) g.visible = u.hp > 0;
        });
        return;
    }

    // Ensure fog mesh is visible for areas with fog
    fogMesh.visible = true;

    updateVisibility(visibility, playerUnits, { current: unitsRef });

    // Quick hash to detect visibility changes (sum of visible cell coords)
    let fogHash = 0;
    for (let x = 0; x < GRID_SIZE; x++) {
        for (let z = 0; z < GRID_SIZE; z++) {
            if (visibility[x][z] === 2) fogHash += x * 100 + z;
        }
    }

    // Only redraw fog texture if visibility changed
    if (fogHash !== lastFogHash) {
        lastFogHash = fogHash;

        const { ctx, texture } = fogTexture;

        ctx.clearRect(0, 0, GRID_SIZE, GRID_SIZE);

        // Simple fog rendering without expensive distance calculations
        // Use fixed alpha values - the texture filtering provides some softness
        for (let x = 0; x < GRID_SIZE; x++) {
            for (let z = 0; z < GRID_SIZE; z++) {
                const vis = visibility[x][z];
                if (vis === 2) continue;  // Visible - no fog

                // Simple alpha: seen = 0.4, unexplored = 0.9
                ctx.fillStyle = vis === 1 ? "rgba(0,0,0,0.4)" : "rgba(0,0,0,0.9)";
                ctx.fillRect(x, z, 1, 1);
            }
        }

        texture.needsUpdate = true;
    }

    // Hide enemies in fog (always check this)
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
    const targets = getAliveUnitsInRange(unitsState, unitsRef, "player", g.position.x, g.position.z, skill.range, defeatedThisFrame);
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

    // Animate the swipe expanding and fading
    animateExpandingMesh(scene, swipeArc, {
        duration: SWIPE_ANIMATE_DURATION,
        initialOpacity: 0.6,
        maxScale: 1.3,
        baseRadius: 1
    });

    // Play sound
    soundFns.playHit();

    // Deal damage to all targets
    let hitCount = 0;
    let totalDamage = 0;
    const dmgCtx: DamageContext = { scene, damageTexts, hitFlashRef, unitsRef, setUnits, addLog, now, defeatedThisFrame };
    hitTargets.forEach(({ unit: target, group: tg }) => {
        const targetData = getUnitStats(target);

        if (rollHit(enemyData.accuracy)) {
            const dmg = calculateDamage(skill.damage[0], skill.damage[1], getEffectiveArmor(target, targetData.armor));
            applyDamageToUnit(dmgCtx, target.id, tg, target.hp, dmg, targetData.name, { color: "#ff4444" });
            hitCount++;
            totalDamage += dmg;
        }
    });

    if (hitCount > 0) {
        addLog(logAoeHit(enemyData.name, skill.name, hitCount, totalDamage), "#ff4444");
    } else {
        addLog(logAoeMiss(enemyData.name, skill.name), COLORS.logNeutral);
    }

    return true;
}

/**
 * Execute an enemy heal skill - heals a nearby injured ally
 */
function executeEnemyHeal(
    unit: Unit,
    g: UnitGroup,
    skill: EnemyHealSkill,
    enemyData: EnemyStats,
    unitsRef: Record<number, UnitGroup>,
    unitsState: Unit[],
    scene: THREE.Scene,
    damageTexts: DamageText[],
    setUnits: React.Dispatch<React.SetStateAction<Unit[]>>,
    addLog: (text: string, color?: string) => void
): boolean {
    // Find injured allies within range
    const allies = unitsState.filter(u =>
        u.team === "enemy" &&
        u.id !== unit.id &&
        u.hp > 0
    );

    let bestTarget: { unit: Unit; group: UnitGroup; missingHp: number } | null = null;

    for (const ally of allies) {
        const allyG = unitsRef[ally.id];
        if (!allyG) continue;

        const dist = calculateDistance(g.position.x, g.position.z, allyG.position.x, allyG.position.z);
        if (dist > skill.range) continue;

        const allyStats = getUnitStats(ally) as EnemyStats;
        const missingHp = allyStats.maxHp - ally.hp;

        // Only heal if missing at least 25% HP
        if (missingHp < allyStats.maxHp * 0.25) continue;

        if (!bestTarget || missingHp > bestTarget.missingHp) {
            bestTarget = { unit: ally, group: allyG, missingHp };
        }
    }

    if (!bestTarget) return false;

    const healAmount = Math.floor(Math.random() * (skill.heal[1] - skill.heal[0] + 1)) + skill.heal[0];
    const targetStats = getUnitStats(bestTarget.unit) as EnemyStats;
    const newHp = Math.min(bestTarget.unit.hp + healAmount, targetStats.maxHp);
    const actualHeal = newHp - bestTarget.unit.hp;

    // Apply heal
    setUnits(prev => prev.map(u =>
        u.id === bestTarget!.unit.id ? { ...u, hp: newHp } : u
    ));

    // Spawn heal number (green)
    spawnDamageNumber(scene, bestTarget.group.position.x, bestTarget.group.position.z, actualHeal, "#22c55e", damageTexts);

    // Visual effect - purple healing ring on target
    const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.3, 0.5, 32),
        new THREE.MeshBasicMaterial({ color: "#9932CC", transparent: true, opacity: 0.8, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(bestTarget.group.position.x, 0.1, bestTarget.group.position.z);
    scene.add(ring);
    animateExpandingMesh(scene, ring, { maxScale: 1.5, baseRadius: 0.4, duration: 300 });

    soundFns.playHeal();
    addLog(`${enemyData.name} heals ${targetStats.name} for ${actualHeal}!`, "#9932CC");

    return true;
}

// =============================================================================
// MELEE SWING ANIMATION
// =============================================================================

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
    addLog: (text: string, color?: string) => void,
    now: number,
    defeatedThisFrame: Set<number>,
    // Skill cooldowns - shared by players and enemies
    skillCooldowns: Record<string, { end: number; duration: number }>,
    setSkillCooldowns: React.Dispatch<React.SetStateAction<Record<string, { end: number; duration: number }>>>,
    // For player AI auto-queueing attacks
    actionQueueRef?: ActionQueue,
    setQueuedActions?: React.Dispatch<React.SetStateAction<{ unitId: number; skillName: string }[]>>
): void {
    const isPlayer = unit.team === "player";
    const data = getUnitStats(unit);

    // Skip all actions if stunned - unit cannot move or attack
    if (hasStunnedEffect(unit)) {
        return;
    }

    // Check if enemy is actively kiting - skip targeting and continue retreat
    if (!isPlayer && isEnemyKiting(unit.id, now)) {
        // Check if kite path is complete
        const kitePath = pathsRef[unit.id];
        if (!kitePath || kitePath.length === 0) {
            // Kiting complete - clear state and allow normal behavior
            clearEnemyKiting(unit.id);
        } else {
            // Still kiting - just do path following and movement
            const pathCtx: PathContext = { unit, g, pathsRef, moveStartRef, now, isPlayer };
            const pathResult = runPathFollowingPhase(pathCtx);
            const speedMultiplier = !isPlayer && 'moveSpeed' in data ? (data as EnemyStats).moveSpeed : undefined;
            const movementCtx: MovementContext = { unit, g, unitsRef, unitsState, targetX: pathResult.targetX, targetZ: pathResult.targetZ, speedMultiplier };
            runMovementPhase(movementCtx);
            return;
        }
    }

    // Phase 1: Targeting - find and validate targets
    const aggroRange = isPlayer ? 12 : (data as { aggroRange: number }).aggroRange;
    const targetingCtx: TargetingContext = {
        unit, g, unitsRef, unitsState, visibility, pathsRef, moveStartRef,
        now, defeatedThisFrame, aggroRange
    };
    runTargetingPhase(targetingCtx);

    // Phase 1.5: Kiting - ranged enemies retreat when players get too close
    const enemyData = !isPlayer ? data as EnemyStats : null;
    if (enemyData) {
        const kiteCtx: KiteContext = { unit, g, unitsRef, unitsState, pathsRef, moveStartRef, now };
        const kiteResult = tryKite(kiteCtx, enemyData);
        if (kiteResult.isKiting) {
            // Jump directly to path following and movement
            const pathCtx: PathContext = { unit, g, pathsRef, moveStartRef, now, isPlayer };
            const pathResult = runPathFollowingPhase(pathCtx);
            const speedMultiplier = enemyData.moveSpeed;
            const movementCtx: MovementContext = { unit, g, unitsRef, unitsState, targetX: pathResult.targetX, targetZ: pathResult.targetZ, speedMultiplier };
            runMovementPhase(movementCtx);
            return;
        }
    }

    // Phase 1.6: Enemy heal check - healer enemies try to heal injured allies
    if (!isPlayer && 'healSkill' in data && data.healSkill) {
        const healSkill = data.healSkill;
        const healCooldownKey = `${unit.id}-${healSkill.name}`;
        const healCooldownEnd = skillCooldowns[healCooldownKey]?.end || 0;
        if (now >= healCooldownEnd) {
            const executed = executeEnemyHeal(
                unit, g, healSkill, data as EnemyStats,
                unitsRef, unitsState, scene, damageTexts,
                setUnits, addLog
            );
            if (executed) {
                setSkillCooldowns(prev => ({
                    ...prev,
                    [healCooldownKey]: { end: now + healSkill.cooldown, duration: healSkill.cooldown }
                }));
                actionCooldownRef[unit.id] = now + data.attackCooldown;
                return;
            }
        }
    }

    // Phase 1.7: Enemy spawn check - spawner enemies (Brood Mother) spawn minions when they see players
    if (!isPlayer && 'spawnSkill' in data && data.spawnSkill) {
        const spawnSkill = data.spawnSkill as EnemySpawnSkill;
        const spawnCooldownKey = `${unit.id}-spawn`;
        const spawnCooldownEnd = skillCooldowns[spawnCooldownKey]?.end || 0;

        // Check if any player is visible (within aggro range)
        const enemyData = data as EnemyStats;
        const playerInSight = unitsState.some(u => {
            if (u.team !== "player" || u.hp <= 0) return false;
            const playerG = unitsRef[u.id];
            if (!playerG) return false;
            const dx = playerG.position.x - g.position.x;
            const dz = playerG.position.z - g.position.z;
            return Math.sqrt(dx * dx + dz * dz) <= enemyData.aggroRange;
        });

        // Play Brood Mother screech on first sight of player
        if (playerInSight && unit.enemyType === "brood_mother" && !hasBroodMotherScreeched(unit.id)) {
            markBroodMotherScreeched(unit.id);
            soundFns.playBroodMotherScreech();
            addLog("The Brood Mother lets out a piercing screech!", "#cc6600");
        }

        if (playerInSight && now >= spawnCooldownEnd) {
            // Count current spawns from this unit
            const currentSpawns = unitsState.filter(u => u.spawnedBy === unit.id && u.hp > 0).length;

            if (currentSpawns < spawnSkill.maxSpawns) {
                // Spawn a new minion
                const spawnAngle = Math.random() * Math.PI * 2;
                const spawnX = g.position.x + Math.cos(spawnAngle) * spawnSkill.spawnRange;
                const spawnZ = g.position.z + Math.sin(spawnAngle) * spawnSkill.spawnRange;

                // Create the spawned unit with unique ID from counter
                const newId = getNextUnitId();
                const spawnedUnit: Unit = {
                    id: newId,
                    x: spawnX,
                    z: spawnZ,
                    hp: ENEMY_STATS[spawnSkill.spawnType].maxHp,
                    team: "enemy",
                    enemyType: spawnSkill.spawnType,
                    target: null,
                    aiEnabled: true,
                    spawnedBy: unit.id
                };

                // Add the unit to state
                setUnits(prev => [...prev, spawnedUnit]);

                // Play screech sound for broodling spawns
                if (spawnSkill.spawnType === "broodling") {
                    soundFns.playScreech();
                }

                // Log the spawn
                addLog(`${enemyData.name} spawns a ${ENEMY_STATS[spawnSkill.spawnType].name}!`, "#cc6600");

                // Set cooldown
                setSkillCooldowns(prev => ({
                    ...prev,
                    [spawnCooldownKey]: { end: now + spawnSkill.cooldown, duration: spawnSkill.cooldown }
                }));
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
            const unitRange = getAttackRange(unit);

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
                        const enemySkillKey = `${unit.id}-${skill.name}`;
                        const skillCooldownEnd = skillCooldowns[enemySkillKey]?.end || 0;

                        // Use skill if: cooldown ready AND targets in range (hitbox-aware)
                        const inSkillRange = isInRange(g.position.x, g.position.z, targetX, targetZ, targetRadius, skill.range);
                        if (now >= skillCooldownEnd && inSkillRange) {
                            // Count potential targets (using hitbox-aware range)
                            const potentialTargets = getAliveUnitsInRange(unitsState, unitsRef, "player", g.position.x, g.position.z, skill.range, defeatedThisFrame);

                            // Use skill if there are 2+ targets, or randomly with 1 target
                            if (potentialTargets.length >= 2 || (potentialTargets.length === 1 && Math.random() < SKILL_SINGLE_TARGET_CHANCE)) {
                                const executed = executeEnemySwipe(
                                    unit, g, skill, data as EnemyStats,
                                    unitsRef, unitsState, scene, damageTexts,
                                    hitFlashRef, setUnits, addLog, now, defeatedThisFrame
                                );
                                if (executed) {
                                    setSkillCooldowns(prev => ({
                                        ...prev,
                                        [enemySkillKey]: { end: now + skill.cooldown, duration: skill.cooldown }
                                    }));
                                    actionCooldownRef[unit.id] = now + data.attackCooldown;
                                    return;
                                }
                            }
                        }
                    }

                    // Player units: queue attack skill (processed by action queue)
                    // AI enabled = auto-queue attacks, AI disabled = only manual attacks (already in queue)
                    if (isPlayer) {
                        if (unit.aiEnabled && actionQueueRef && setQueuedActions) {
                            // Auto-queue if not already queued
                            if (!actionQueueRef[unit.id]) {
                                const basicAttack = getBasicAttackSkill(unit.id);
                                actionQueueRef[unit.id] = {
                                    type: "skill",
                                    skill: basicAttack,
                                    targetX: targetG.position.x,
                                    targetZ: targetG.position.z
                                };
                                setQueuedActions(prev => [
                                    ...prev.filter(q => q.unitId !== unit.id),
                                    { unitId: unit.id, skillName: basicAttack.name }
                                ]);
                            }
                        }
                        // Player attacks always go through skill queue - don't execute directly
                        return;
                    }

                    // Enemy units: execute attack directly (they don't use player skill queue)
                    const attackCooldownEnd = now + data.attackCooldown;
                    actionCooldownRef[unit.id] = attackCooldownEnd;

                    // Check if enemy is ranged (has projectile color)
                    const isRangedEnemy = 'projectileColor' in data && data.projectileColor;
                    if (isRangedEnemy) {
                        const projectile = createProjectile(scene, "enemy", g.position.x, g.position.z, data.projectileColor as string);
                        projectilesRef.push({ type: "basic", mesh: projectile, targetId: targetU.id, attackerId: unit.id, speed: getProjectileSpeed("enemy") });
                        soundFns.playAttack();
                    } else {
                        // Melee attack
                        const targetData = getUnitStats(targetU);
                        spawnSwingIndicator(scene, g, targetG, false, swingAnimations, now);

                        if (rollHit(data.accuracy)) {
                            const dmg = calculateDamage(data.damage[0], data.damage[1], getEffectiveArmor(targetU, targetData.armor));
                            const willPoison = shouldApplyPoison(data as EnemyStats);
                            const poisonDmg = willPoison && 'poisonDamage' in data ? (data as EnemyStats).poisonDamage : undefined;
                            const dmgCtx: DamageContext = { scene, damageTexts, hitFlashRef, unitsRef, setUnits, addLog, now, defeatedThisFrame };
                            applyDamageToUnit(dmgCtx, targetU.id, targetG, targetU.hp, dmg, targetData.name, {
                                color: COLORS.damageEnemy,
                                poison: willPoison ? { sourceId: unit.id, damagePerTick: poisonDmg } : undefined,
                                hitMessage: { text: logHit(data.name, "Attack", targetData.name, dmg), color: COLORS.damageEnemy }
                            });

                            soundFns.playHit();
                            if (willPoison) {
                                addLog(logPoisoned(targetData.name), COLORS.poisonText);
                            }
                        } else {
                            soundFns.playMiss();
                            addLog(logMiss(data.name, "Attack", targetData.name), COLORS.logNeutral);
                        }
                    }
                }
                return;
            } else {
                // Recalculate path if needed (but not if we recently gave up)
                recalculatePathIfNeeded(unit.id, g, targetX, targetZ, pathsRef, moveStartRef, now);
            }
        } else {
            g.userData.attackTarget = null;
        }
    }

    // Phase 3: Path following - advance waypoints and handle stuck detection
    const pathCtx: PathContext = { unit, g, pathsRef, moveStartRef, now, isPlayer };
    const pathResult = runPathFollowingPhase(pathCtx);
    targetX = pathResult.targetX;
    targetZ = pathResult.targetZ;

    // Phase 4: Movement - move toward target with avoidance and wall sliding
    // Pinned units cannot move (speed = 0)
    const baseSpeedMultiplier = !isPlayer && 'moveSpeed' in data ? (data as EnemyStats).moveSpeed : undefined;
    const speedMultiplier = hasPinnedEffect(unit) ? 0 : baseSpeedMultiplier;
    const movementCtx: MovementContext = { unit, g, unitsRef, unitsState, targetX, targetZ, speedMultiplier };
    runMovementPhase(movementCtx);
}

// =============================================================================
// HP BAR POSITIONS
// =============================================================================

// Reusable vector for HP bar position calculations
const _hpWorldPos = new THREE.Vector3();

export function updateHpBarPositions(
    unitsState: Unit[],
    unitsRef: Record<number, UnitGroup>,
    camera: THREE.OrthographicCamera,
    rendererRect: DOMRect,
    zoomLevel: number
): { positions: Record<number, { x: number; y: number; visible: boolean }>; scale: number } {
    const positions: Record<number, { x: number; y: number; visible: boolean }> = {};
    const halfWidth = rendererRect.width * 0.5;
    const halfHeight = rendererRect.height * 0.5;

    for (const u of unitsState) {
        const g = unitsRef[u.id];
        if (!g) continue;
        const isPlayer = u.team === "player";
        const data = getUnitStats(u);
        const size = (!isPlayer && 'size' in data && data.size) ? data.size : 1;
        const boxH = isPlayer ? 1 : (size > 1 ? 1.8 : 0.6);
        _hpWorldPos.set(g.position.x, boxH + 0.4, g.position.z);
        _hpWorldPos.project(camera);
        positions[u.id] = {
            x: (_hpWorldPos.x + 1) * halfWidth,
            y: (-_hpWorldPos.y + 1) * halfHeight,
            visible: g.visible && u.hp > 0
        };
    }

    return { positions, scale: 10 / zoomLevel };
}
