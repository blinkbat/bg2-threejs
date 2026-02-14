// =============================================================================
// PROJECTILE UPDATES - AOE, basic, magic missile, trap projectiles
// =============================================================================

import * as THREE from "three";
import type { Unit, UnitGroup, DamageText, Projectile, EnemyStats, MagicMissileProjectile, TrapProjectile, FireballProjectile, PiercingProjectile, StatusEffect, DamageType, UnitData } from "../core/types";
import { HIT_DETECTION_RADIUS, COLORS, BUFF_TICK_INTERVAL, SUN_STANCE_BONUS_DAMAGE, GLACIAL_WHORL_HIT_RADIUS } from "../core/constants";
import { getUnitStats } from "../game/units";
import { calculateDamageWithCrit, getDirectionAndDistance, rollHit, rollDamage, shouldApplyPoison, getEffectiveArmor, logHit, logLifestealHit, logMiss, logPoisoned, logAoeHit, logAoeMiss, getDamageColor, logTrapTriggered, calculateStatBonus, applyStatusEffect, checkEnemyDefenses, hasStatusEffect, rollChance, applyChilled } from "../combat/combatMath";
import { distance } from "../game/geometry";
import { accumulateDelta } from "../core/gameClock";
import { isBlocked } from "../ai/pathfinding";
import { ENEMY_STATS } from "../game/enemyStats";
import { applyDamageToUnit, animateExpandingMesh, buildDamageContext, applyLifesteal, createAnimatedRing } from "../combat/damageEffects";
import { soundFns } from "../audio";
import { getUnitById } from "../game/unitQuery";

// =============================================================================
// DAMAGE TYPE HELPERS
// =============================================================================

/** Get the damage type for a unit's basic attack based on class */
function getBasicAttackDamageType(unit: Unit, unitData: UnitData | EnemyStats): DamageType {
    if (unit.team === "player" && "class" in unitData) {
        if (unitData.class === "Wizard") return "chaos";
        if (unitData.class === "Cleric") return "holy";
    }
    return "physical";
}

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

/**
 * Match piercing hit radius to the projectile's widest horizontal visual axis.
 */
function getPiercingHitRadius(proj: PiercingProjectile): number {
    const baseRadius = (proj.mesh.geometry as THREE.SphereGeometry).parameters?.radius;
    if (typeof baseRadius !== "number") {
        return GLACIAL_WHORL_HIT_RADIUS;
    }

    const horizontalScale = Math.max(Math.abs(proj.mesh.scale.x), Math.abs(proj.mesh.scale.z));
    return baseRadius * horizontalScale;
}

// =============================================================================
// PROJECTILE DISPOSAL
// =============================================================================

function disposeProjectile(scene: THREE.Scene, proj: Projectile): void {
    scene.remove(proj.mesh);
    // Geometry is shared - only dispose material
    (proj.mesh.material as THREE.Material).dispose();
}

function spawnProjectileImpact(
    scene: THREE.Scene,
    x: number,
    z: number,
    color: string,
    maxScale: number = 1.0,
    duration: number = 170
): void {
    createAnimatedRing(scene, x, z, color, {
        innerRadius: 0.09,
        outerRadius: 0.25,
        maxScale,
        duration
    });
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
    // Shared DamageContext for all projectile hit processing
    const dmgCtx = buildDamageContext(scene, damageTexts, hitFlashRef, unitsRef, unitsState, setUnits, addLog, now, defeatedThisFrame);

    return projectilesRef.filter(proj => {
        // AOE projectile (like Fireball)
        if (proj.type === "aoe") {
            const { targetPos, aoeRadius, damage } = proj;
            const { dx, dz, dist } = getDirectionAndDistance(proj.mesh.position.x, proj.mesh.position.z, targetPos.x, targetPos.z);

            // Reached target - explode
            if (dist < HIT_DETECTION_RADIUS) {
                const attackerUnit = getUnitById(proj.attackerId);
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
                unitsState.filter(u => u.hp > 0 && !defeatedThisFrame.has(u.id)).forEach(target => {
                    const tg = unitsRef[target.id];
                    if (!tg) return;
                    const targetDist = distance(tg.position.x, tg.position.z, targetPos.x, targetPos.z);
                    if (targetDist <= aoeRadius) {
                        const targetData = getUnitStats(target);
                        const statBonus = calculateStatBonus(attackerUnit, proj.damageType);
                        const { damage: dmg } = calculateDamageWithCrit(damage[0] + statBonus, damage[1] + statBonus, getEffectiveArmor(target, targetData.armor), proj.damageType, attackerUnit);

                        applyDamageToUnit(dmgCtx, target.id, tg, dmg, targetData.name, {
                            color: getDamageColor(target.team, true),
                            attackerName: attackerUnit?.team === "player" ? attackerData?.name : undefined,
                            targetUnit: target,
                            damageType: proj.damageType
                        });
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
            const attackerUnit = getUnitById(mmProj.attackerId);

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
                targetUnit = getUnitById(mmProj.targetId);
                targetG = unitsRef[mmProj.targetId];

                if (!targetUnit || !targetG || targetUnit.hp <= 0 || defeatedThisFrame.has(mmProj.targetId)) {
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

                    spawnProjectileImpact(scene, proj.mesh.position.x, proj.mesh.position.z, COLORS.logNeutral, 0.9, 140);
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
                let shieldBlocked = false;

                if (targetUnit && targetG) {
                    // Check for front-shield block (magic missiles have 50% chance to be blocked)
                    if (attackerUnit.team === "player" && targetUnit.enemyType) {
                        const enemyStats = ENEMY_STATS[targetUnit.enemyType];
                        const attackerG = unitsRef[mmProj.attackerId];
                        if (attackerG && checkEnemyDefenses(enemyStats, targetUnit.facing, attackerG.position.x, attackerG.position.z, targetG.position.x, targetG.position.z, undefined, 0.5) === "frontShield") {
                            soundFns.playBlock();
                            shieldBlocked = true;
                            spawnProjectileImpact(scene, targetG.position.x, targetG.position.z, "#4488ff", 1.05, 170);
                        }
                    }

                    if (!shieldBlocked && !defeatedThisFrame.has(targetUnit.id)) {
                        const targetData = getUnitStats(targetUnit);
                        const statBonus = calculateStatBonus(attackerUnit, mmProj.damageType);
                        const result = calculateDamageWithCrit(mmProj.damage[0] + statBonus, mmProj.damage[1] + statBonus, getEffectiveArmor(targetUnit, targetData.armor), mmProj.damageType, attackerUnit);
                        dmgDealt = result.damage;

                        const mmAttackerG = unitsRef[mmProj.attackerId];
                        applyDamageToUnit(dmgCtx, targetUnit.id, targetG, dmgDealt, targetData.name, {
                            color: "#9966ff",
                            attackerName: attackerUnit.team === "player" ? getUnitStats(attackerUnit).name : undefined,
                            targetUnit: targetUnit,
                            attackerPosition: mmAttackerG ? { x: mmAttackerG.position.x, z: mmAttackerG.position.z } : undefined,
                            damageType: mmProj.damageType
                        });
                        spawnProjectileImpact(scene, targetG.position.x, targetG.position.z, "#9966ff", 1.2, 180);

                        soundFns.playHit();
                    }
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

            // Accumulate elapsed time (pause-safe)
            accumulateDelta(trapProj, now);

            if (!trapProj.isLanded) {
                // Arc trajectory during flight
                const t = Math.min(1, trapProj.elapsedTime / trapProj.flightDuration);

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

                const dist = distance(
                    enemyG.position.x, enemyG.position.z,
                    trapProj.targetPos.x, trapProj.targetPos.z
                );

                if (dist <= trapProj.aoeRadius) {
                    // Trap triggered! Apply pinned effect and damage to all enemies in radius
                    let pinnedCount = 0;
                    let totalDamage = 0;

                    enemies.forEach(target => {
                        const targetG = unitsRef[target.id];
                        if (!targetG) return;

                        const targetDist = distance(
                            targetG.position.x, targetG.position.z,
                            trapProj.targetPos.x, trapProj.targetPos.z
                        );

                        if (targetDist <= trapProj.aoeRadius) {
                            // Calculate damage if trap has damage
                            let damage = 0;
                            if (trapProj.trapDamage) {
                                damage = trapProj.trapDamage[0] + Math.floor(Math.random() * (trapProj.trapDamage[1] - trapProj.trapDamage[0] + 1));
                                totalDamage += damage;

                                // Hit flash
                                if (hitFlashRef) {
                                    hitFlashRef[target.id] = now;
                                }
                            }

                            // Apply pinned effect
                            const pinnedEffect: StatusEffect = {
                                type: "pinned",
                                duration: trapProj.pinnedDuration,
                                tickInterval: BUFF_TICK_INTERVAL,
                                timeSinceTick: 0,
                                lastUpdateTime: now,
                                damagePerTick: 0,
                                sourceId: trapProj.attackerId
                            };

                            setUnits(prev => prev.map(u => {
                                if (u.id !== target.id) return u;
                                const newHp = damage > 0 ? Math.max(0, u.hp - damage) : u.hp;
                                return { ...u, hp: newHp, statusEffects: applyStatusEffect(u.statusEffects, pinnedEffect) };
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
                    if (totalDamage > 0) {
                        addLog(`Caltrops pins ${pinnedCount} ${pinnedCount === 1 ? "enemy" : "enemies"} for ${totalDamage} damage!`, COLORS.pinnedText);
                    } else {
                        addLog(logTrapTriggered("Caltrops", pinnedCount), COLORS.pinnedText);
                    }

                    disposeProjectile(scene, proj);
                    return false;
                }
            }

            return true;  // Trap still active, waiting for trigger
        }

        // Piercing projectile (Glacial Whorl) - straight line, passes through enemies
        if (proj.type === "piercing") {
            const pProj = proj as PiercingProjectile;
            const attackerUnit = getUnitById(pProj.attackerId);
            const piercingHitRadius = getPiercingHitRadius(pProj);

            // Move in straight line
            proj.mesh.position.x += pProj.directionX * pProj.speed;
            proj.mesh.position.z += pProj.directionZ * pProj.speed;

            // Wall collision — ice burst + dispose
            const cellX = Math.floor(proj.mesh.position.x);
            const cellZ = Math.floor(proj.mesh.position.z);
            if (isBlocked(cellX, cellZ)) {
                const burst = new THREE.Mesh(
                    new THREE.SphereGeometry(0.3, 12, 8),
                    new THREE.MeshBasicMaterial({ color: COLORS.chilled, transparent: true, opacity: 0.8 })
                );
                burst.position.copy(proj.mesh.position);
                scene.add(burst);
                animateExpandingMesh(scene, burst, { duration: 250, initialOpacity: 0.8, maxScale: 1.2, baseRadius: 0.3 });
                spawnProjectileImpact(scene, proj.mesh.position.x, proj.mesh.position.z, COLORS.dmgCold, 1.25, 190);
                disposeProjectile(scene, proj);
                return false;
            }

            // Max distance check
            const traveled = Math.hypot(
                proj.mesh.position.x - pProj.startX,
                proj.mesh.position.z - pProj.startZ
            );
            if (traveled >= pProj.maxDistance) {
                disposeProjectile(scene, proj);
                return false;
            }

            // Hit detection — only hit enemies (based on attackerTeam)
            const targetTeam = pProj.attackerTeam === "player" ? "enemy" : "player";
            for (const target of unitsState) {
                if (target.team !== targetTeam) continue;
                if (target.hp <= 0 || defeatedThisFrame.has(target.id)) continue;
                if (pProj.hitUnits.has(target.id)) continue;

                const targetG = unitsRef[target.id];
                if (!targetG) continue;

                const distToTarget = distance(
                    proj.mesh.position.x, proj.mesh.position.z,
                    targetG.position.x, targetG.position.z
                );

                if (distToTarget <= piercingHitRadius) {
                    pProj.hitUnits.add(target.id);

                    const targetData = getUnitStats(target);
                    const statBonus = calculateStatBonus(attackerUnit, pProj.damageType);
                    const { damage: dmg } = calculateDamageWithCrit(
                        pProj.damage[0] + statBonus, pProj.damage[1] + statBonus,
                        getEffectiveArmor(target, targetData.armor),
                        pProj.damageType, attackerUnit
                    );

                    applyDamageToUnit(dmgCtx, target.id, targetG, dmg, targetData.name, {
                        color: COLORS.dmgCold,
                        attackerName: attackerUnit ? getUnitStats(attackerUnit).name : undefined,
                        targetUnit: target,
                        damageType: pProj.damageType
                    });
                    spawnProjectileImpact(scene, targetG.position.x, targetG.position.z, COLORS.dmgCold, 1.15, 180);

                    // Roll for chill
                    if (rollChance(pProj.chillChance)) {
                        setUnits(prev => prev.map(u =>
                            u.id === target.id ? applyChilled(u, pProj.attackerId, now) : u
                        ));
                    }

                    soundFns.playHit();
                    aggroOnHit(target, pProj.attackerId, unitsRef);
                }
            }

            // Subtle spin
            proj.mesh.rotation.y += 0.08;

            return true;
        }

        // Fireball projectile - slow-moving, hurts everything it touches, expires on wall or distance
        if (proj.type === "fireball") {
            const fbProj = proj as FireballProjectile;
            const attackerUnit = getUnitById(fbProj.attackerId);

            // Move fireball in straight line
            proj.mesh.position.x += fbProj.directionX * fbProj.speed;
            proj.mesh.position.z += fbProj.directionZ * fbProj.speed;

            // Check wall collision
            const cellX = Math.floor(proj.mesh.position.x);
            const cellZ = Math.floor(proj.mesh.position.z);
            if (isBlocked(cellX, cellZ)) {
                // Create small explosion effect on wall hit
                const explosion = new THREE.Mesh(
                    new THREE.SphereGeometry(0.4, 12, 8),
                    new THREE.MeshBasicMaterial({ color: "#ff4400", transparent: true, opacity: 0.8 })
                );
                explosion.position.copy(proj.mesh.position);
                scene.add(explosion);
                animateExpandingMesh(scene, explosion, { duration: 300, initialOpacity: 0.8, maxScale: 1.5, baseRadius: 0.4 });
                soundFns.playExplosion();
                disposeProjectile(scene, proj);
                return false;
            }

            // Check max distance traveled
            const traveledDist = Math.hypot(
                proj.mesh.position.x - fbProj.startX,
                proj.mesh.position.z - fbProj.startZ
            );
            if (traveledDist >= fbProj.maxDistance) {
                // Fizzle out at max distance
                disposeProjectile(scene, proj);
                return false;
            }

            // Check collision with all living units (hurts EVERYTHING - friendly fire!)
            // But don't hurt the attacker who fired it
            for (const target of unitsState) {
                if (target.id === fbProj.attackerId) continue;  // Don't hurt self
                if (target.hp <= 0 || defeatedThisFrame.has(target.id)) continue;
                if (fbProj.hitUnits.has(target.id)) continue;  // Already hit this unit

                const targetG = unitsRef[target.id];
                if (!targetG) continue;

                const distToTarget = distance(
                    proj.mesh.position.x, proj.mesh.position.z,
                    targetG.position.x, targetG.position.z
                );

                // Hit radius - slightly larger than normal for easier hits
                if (distToTarget < 0.6) {
                    // Mark as hit so we don't hit again
                    fbProj.hitUnits.add(target.id);

                    const targetData = getUnitStats(target);
                    const attackerData = attackerUnit ? getUnitStats(attackerUnit) : null;

                    const { damage: dmg } = calculateDamageWithCrit(
                        fbProj.damage[0], fbProj.damage[1],
                        getEffectiveArmor(target, targetData.armor),
                        fbProj.damageType,
                        attackerUnit
                    );

                    applyDamageToUnit(dmgCtx, target.id, targetG, dmg, targetData.name, {
                        color: getDamageColor(target.team, true),
                        attackerName: attackerData?.name,
                        targetUnit: target,
                        damageType: fbProj.damageType
                    });
                    spawnProjectileImpact(scene, targetG.position.x, targetG.position.z, COLORS.dmgFire, 1.2, 190);

                    soundFns.playHit();

                    // Log the hit
                    const attackerName = attackerData?.name ?? "Fireball";
                    addLog(`${attackerName}'s fireball burns ${targetData.name} for ${dmg} damage!`, COLORS.damageNeutral);

                    // Aggro enemies hit by the fireball
                    if (attackerUnit?.team === "enemy" && target.team === "enemy") {
                        // Enemy hit by friendly fire - don't aggro
                    } else {
                        aggroOnHit(target, fbProj.attackerId, unitsRef);
                    }
                }
            }

            // Rotate the fireball for visual effect
            proj.mesh.rotation.x += 0.1;
            proj.mesh.rotation.y += 0.15;

            return true;
        }

        // Regular projectile (single target) - validate target exists
        if (proj.type !== "basic") return true;
        const targetUnit = getUnitById(proj.targetId);
        const targetG = unitsRef[proj.targetId];
        const attackerUnit = getUnitById(proj.attackerId);

        // Guard clause: dispose if target invalid
        if (!targetUnit || !targetG || targetUnit.hp <= 0 || defeatedThisFrame.has(proj.targetId) || !attackerUnit) {
            disposeProjectile(scene, proj);
            return false;
        }

        const { dx, dz, dist } = getDirectionAndDistance(proj.mesh.position.x, proj.mesh.position.z, targetG.position.x, targetG.position.z);

        if (dist < HIT_DETECTION_RADIUS) {
            const attackerData = getUnitStats(attackerUnit);
            const targetData = getUnitStats(targetUnit);
            const logColor = getDamageColor(targetUnit.team);
            const attackerG = unitsRef[attackerUnit.id];

            // Aggro enemies targeted by player projectiles (even on miss - arrow flew by their head!)
            if (attackerUnit.team === "player") {
                aggroOnHit(targetUnit, proj.attackerId, unitsRef);
            }

            // Check for enemy defensive abilities (player attacking shielded enemy)
            if (attackerUnit.team === "player" && targetUnit.enemyType) {
                const enemyStats = ENEMY_STATS[targetUnit.enemyType];
                const dmgType = getBasicAttackDamageType(attackerUnit, attackerData);
                const defense = attackerG
                    ? checkEnemyDefenses(enemyStats, targetUnit.facing, attackerG.position.x, attackerG.position.z, targetG.position.x, targetG.position.z, dmgType)
                    : "none" as const;
                if (defense !== "none") {
                    soundFns.playBlock();
                    addLog(defense === "frontShield"
                        ? `${attackerData.name}'s attack is blocked by ${targetData.name}'s shield!`
                        : `${targetData.name} blocks ${attackerData.name}'s attack!`,
                        defense === "frontShield" ? "#4488ff" : "#aaaaaa");
                    spawnProjectileImpact(scene, targetG.position.x, targetG.position.z, defense === "frontShield" ? "#4488ff" : "#aaaaaa", 1.05, 170);
                    disposeProjectile(scene, proj);
                    return false;
                }
            }

            if (rollHit(attackerData.accuracy)) {
                const dmgType = getBasicAttackDamageType(attackerUnit, attackerData);
                const auraBonus = attackerUnit.auraDamageBonus ?? 0;
                const { damage: dmg, isCrit } = calculateDamageWithCrit(
                    attackerData.damage[0] + auraBonus,
                    attackerData.damage[1] + auraBonus,
                    getEffectiveArmor(targetUnit, targetData.armor),
                    dmgType,
                    attackerUnit
                );
                const willPoison = attackerUnit.team === "enemy" && shouldApplyPoison(attackerData as EnemyStats);
                const poisonDmg = willPoison && 'poisonDamage' in attackerData ? (attackerData as EnemyStats).poisonDamage : undefined;

                // Calculate lifesteal heal amount for log message
                const lifesteal = attackerUnit.team === "enemy" ? (attackerData as EnemyStats).lifesteal : undefined;
                const healAmount = lifesteal && lifesteal > 0 ? Math.floor(dmg * lifesteal) : 0;

                // Custom log for lifesteal attacks
                const hitText = healAmount > 0
                    ? logLifestealHit(attackerData.name, targetData.name, dmg, healAmount)
                    : logHit(attackerData.name, "Attack", targetData.name, dmg);
                const damageColor = dmgType === "holy" ? COLORS.dmgHoly : logColor;

                /* use shared dmgCtx */
                applyDamageToUnit(dmgCtx, targetUnit.id, targetG, dmg, targetData.name, {
                    color: damageColor,
                    poison: willPoison ? { sourceId: attackerUnit.id, damagePerTick: poisonDmg } : undefined,
                    attackerName: attackerUnit.team === "player" ? attackerData.name : undefined,
                    hitMessage: { text: hitText, color: damageColor },
                    targetUnit: targetUnit,
                    attackerPosition: attackerG ? { x: attackerG.position.x, z: attackerG.position.z } : undefined,
                    damageType: dmgType,
                    isCrit
                });
                spawnProjectileImpact(scene, targetG.position.x, targetG.position.z, damageColor, isCrit ? 1.35 : 1.05, 180);

                // Sun Stance: bonus fire damage on player ranged hit
                if (attackerUnit.team === "player" && hasStatusEffect(attackerUnit, "sun_stance")) {
                    const fireDmg = rollDamage(SUN_STANCE_BONUS_DAMAGE[0], SUN_STANCE_BONUS_DAMAGE[1]);
                    applyDamageToUnit(dmgCtx, targetUnit.id, targetG, fireDmg, targetData.name, {
                        color: COLORS.dmgFire,
                    });
                }

                soundFns.playHit();

                if (isCrit) {
                    addLog(`${attackerData.name} critically hits ${targetData.name} for ${dmg} damage!`, COLORS.damageCrit);
                }
                if (willPoison) {
                    addLog(logPoisoned(targetData.name), COLORS.poisonText);
                }

                // Apply lifesteal heal using fresh state to avoid race condition
                if (healAmount > 0 && attackerG) {
                    applyLifesteal(scene, damageTexts, setUnits, attackerUnit.id, attackerG.position.x, attackerG.position.z, healAmount, attackerData.maxHp);
                }
            } else {
                soundFns.playMiss();
                addLog(logMiss(attackerData.name, "Attack", targetData.name), COLORS.logNeutral);
                spawnProjectileImpact(scene, targetG.position.x, targetG.position.z, COLORS.logNeutral, 0.9, 140);
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

