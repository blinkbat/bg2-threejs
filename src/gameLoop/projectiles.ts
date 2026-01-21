// =============================================================================
// PROJECTILE UPDATES - AOE, basic, magic missile, trap projectiles
// =============================================================================

import * as THREE from "three";
import type { Unit, UnitGroup, DamageText, Projectile, EnemyStats, MagicMissileProjectile, TrapProjectile, StatusEffect } from "../core/types";
import { HIT_DETECTION_RADIUS, COLORS, BUFF_TICK_INTERVAL } from "../core/constants";
import { getUnitStats } from "../game/units";
import { calculateDamage, calculateDistance, getDirectionAndDistance, rollHit, shouldApplyPoison, getEffectiveArmor, logHit, logMiss, logPoisoned, logAoeHit, logAoeMiss, getDamageColor, logTrapTriggered } from "../combat/combatMath";
import { applyDamageToUnit, animateExpandingMesh, type DamageContext } from "../combat/combat";
import { soundFns } from "../audio/sound";
import { disposeBasicMesh } from "../rendering/disposal";

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
// PROJECTILE DISPOSAL
// =============================================================================

function disposeProjectile(scene: THREE.Scene, proj: Projectile): void {
    disposeBasicMesh(scene, proj.mesh);
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
// PROJECTILE UPDATES
// =============================================================================

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
