// =============================================================================
// GAME LOOP - Animation, projectiles, unit AI, movement
// =============================================================================

import * as THREE from "three";
import type { Unit, UnitGroup, DamageText, Projectile, FogTexture, SwingAnimation, EnemyStats, EnemySkill } from "./core/types";
import {
    GRID_SIZE, ATTACK_RANGE, HIT_DETECTION_RADIUS, FLASH_DURATION,
    SWING_DURATION, COLORS, SKILL_SINGLE_TARGET_CHANCE, POISON_TINT_STRENGTH
} from "./core/constants";
import { getUnitRadius, isInRange } from "./rendering/range";
import { updateVisibility } from "./ai/pathfinding";
import { recentlyGaveUp, checkPathNeedsRecalc, createPathToTarget } from "./ai/pathManager";
import {
    runTargetingPhase, runPathFollowingPhase, runMovementPhase,
    type TargetingContext, type PathContext, type MovementContext
} from "./ai/unitAI";
import { getUnitStats, getBasicAttackSkill } from "./game/units";
import type { ActionQueue } from "./input";
import { calculateDamage, calculateDistance, getDirectionAndDistance, getGridCell, rollHit, shouldApplyPoison, hasPoisonEffect, logHit, logMiss, logPoisoned, logAoeHit, logAoeMiss, getDamageColor } from "./combat/combatMath";
import { SWIPE_ANIMATE_DURATION } from "./core/constants";
import { spawnDamageNumber, handleUnitDefeat, createProjectile, getProjectileSpeed, applyDamageToUnit, animateExpandingMesh, getAliveUnitsInRange, type DamageContext } from "./combat/combat";
import { soundFns } from "./audio/sound";
import { disposeBasicMesh, disposeTexturedMesh } from "./rendering/disposal";
import { getEnemySkillCooldown, setEnemySkillCooldown, getEnemyKiteCooldown, setEnemyKiteCooldown } from "./game/enemyState";
import { blocked } from "./game/dungeon";

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
        const isPoisoned = unit ? hasPoisonEffect(unit) : false;
        const targetColor = isPoisoned
            ? new THREE.Color(originalColor).lerp(new THREE.Color(COLORS.poison), POISON_TINT_STRENGTH)
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

        const isPoisoned = hasPoisonEffect(unit);

        if (isPoisoned) {
            // Apply green poison tint
            const poisonColor = new THREE.Color(originalColor).lerp(new THREE.Color(COLORS.poison), POISON_TINT_STRENGTH);
            (mesh.material as THREE.MeshStandardMaterial).color.copy(poisonColor);
        } else {
            // Restore original color
            (mesh.material as THREE.MeshStandardMaterial).color.copy(originalColor);
        }
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
                    spawnDamageNumber(scene, unitG.position.x, unitG.position.z, dmg, COLORS.poisonText, damageTexts);

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
            const { dx, dz, dist } = getDirectionAndDistance(proj.mesh.position.x, proj.mesh.position.z, targetPos.x, targetPos.z);

            // Reached target - explode
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
                    const targetDist = calculateDistance(tg.position.x, tg.position.z, targetPos.x, targetPos.z);
                    if (targetDist <= aoeRadius) {
                        const targetData = getUnitStats(target);
                        const dmg = calculateDamage(damage[0], damage[1], targetData.armor);

                        const dmgCtx: DamageContext = { scene, damageTexts, hitFlashRef, unitsRef, setUnits, addLog, now, defeatedThisFrame };
                        applyDamageToUnit(dmgCtx, target.id, tg, target.hp, dmg, targetData.name, { color: getDamageColor(target.team, true) });
                        hitCount++;

                        // Aggro enemies hit by player AOE
                        if (attackerUnit?.team === "player") {
                            aggroOnHit(target, proj.attackerId, unitsRef);
                        }
                    }
                });

                if (hitCount > 0) {
                    soundFns.playHit();
                    addLog(logAoeHit(attackerData?.name ?? "Unknown", "Fireball", hitCount), COLORS.damageNeutral);
                }

                disposeProjectile(scene, proj);
                return false;
            }

            // Move projectile (dx/dz already normalized by getDirectionAndDistance)
            proj.mesh.position.x += dx * proj.speed;
            proj.mesh.position.z += dz * proj.speed;
            return true;
        }

        // Regular projectile (single target) - validate target exists
        if (proj.type !== "basic") return true;
        const targetUnit = unitsState.find(u => u.id === proj.targetId);
        const targetG = unitsRef[proj.targetId];
        const attackerUnit = unitsState.find(u => u.id === proj.attackerId);

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

            // Aggro enemies targeted by player projectiles (even on miss - arrow flew by their head!)
            if (attackerUnit.team === "player") {
                aggroOnHit(targetUnit, proj.attackerId, unitsRef);
            }

            if (rollHit(attackerData.accuracy)) {
                const dmg = calculateDamage(attackerData.damage[0], attackerData.damage[1], targetData.armor);
                const willPoison = attackerUnit.team === "enemy" && shouldApplyPoison(attackerData as EnemyStats);

                const dmgCtx: DamageContext = { scene, damageTexts, hitFlashRef, unitsRef, setUnits, addLog, now, defeatedThisFrame };
                applyDamageToUnit(dmgCtx, targetUnit.id, targetG, targetUnit.hp, dmg, targetData.name, {
                    color: logColor,
                    poison: willPoison ? { sourceId: attackerUnit.id } : undefined
                });

                soundFns.playHit();
                addLog(logHit(attackerData.name, "Attack", targetData.name, dmg), logColor);

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
    const dmgCtx: DamageContext = { scene, damageTexts, hitFlashRef, unitsRef, setUnits, addLog, now, defeatedThisFrame };
    hitTargets.forEach(({ unit: target, group: tg }) => {
        const targetData = getUnitStats(target);

        if (rollHit(enemyData.accuracy)) {
            const dmg = calculateDamage(skill.damage[0], skill.damage[1], targetData.armor);
            applyDamageToUnit(dmgCtx, target.id, tg, target.hp, dmg, targetData.name, { color: "#ff4444" });
            hitCount++;
        }
    });

    if (hitCount > 0) {
        addLog(logAoeHit(enemyData.name, skill.name, hitCount), "#ff4444");
    } else {
        addLog(logAoeMiss(enemyData.name, skill.name), COLORS.logNeutral);
    }

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
    // For player AI auto-queueing attacks
    actionQueueRef?: ActionQueue,
    setQueuedActions?: React.Dispatch<React.SetStateAction<{ unitId: number; skillName: string }[]>>
): void {
    const isPlayer = unit.team === "player";
    const data = getUnitStats(unit);

    // Phase 1: Targeting - find and validate targets
    const aggroRange = isPlayer ? 12 : (data as { aggroRange: number }).aggroRange;
    const targetingCtx: TargetingContext = {
        unit, g, unitsRef, unitsState, visibility, pathsRef, moveStartRef,
        now, defeatedThisFrame, aggroRange
    };
    runTargetingPhase(targetingCtx);

    // Phase 1.5: Kiting - ranged enemies retreat when players get too close
    if (!isPlayer && 'kiteTrigger' in data && data.kiteTrigger) {
        const kiteCooldownEnd = getEnemyKiteCooldown(unit.id);
        if (now >= kiteCooldownEnd) {
            // Find nearest player unit
            let nearestPlayerDist = Infinity;
            let nearestPlayerG: UnitGroup | null = null;
            for (const player of unitsState) {
                if (player.team !== "player" || player.hp <= 0) continue;
                const pg = unitsRef[player.id];
                if (!pg) continue;
                const dist = Math.hypot(pg.position.x - g.position.x, pg.position.z - g.position.z);
                if (dist < nearestPlayerDist) {
                    nearestPlayerDist = dist;
                    nearestPlayerG = pg;
                }
            }

            // If player is within kite trigger range, retreat
            if (nearestPlayerG && nearestPlayerDist < data.kiteTrigger) {
                const kiteDistance = data.kiteDistance || 3;
                const kiteCooldown = data.kiteCooldown || 4000;

                // Calculate retreat direction (away from the player)
                const { dx, dz, dist } = getDirectionAndDistance(nearestPlayerG.position.x, nearestPlayerG.position.z, g.position.x, g.position.z);
                if (dist > 0.1) {
                    const retreatX = g.position.x + dx * kiteDistance;
                    const retreatZ = g.position.z + dz * kiteDistance;

                    // Clamp to grid bounds and check if destination is walkable
                    const clampedX = Math.max(0.5, Math.min(GRID_SIZE - 0.5, retreatX));
                    const clampedZ = Math.max(0.5, Math.min(GRID_SIZE - 0.5, retreatZ));
                    const { cellX, cellZ } = getGridCell(clampedX, clampedZ);

                    if (!blocked[cellX]?.[cellZ]) {
                        // Clear current target temporarily and set kite path
                        pathsRef[unit.id] = [{ x: clampedX, z: clampedZ }];
                        moveStartRef[unit.id] = { time: now, x: g.position.x, z: g.position.z };
                        setEnemyKiteCooldown(unit.id, now + kiteCooldown);
                    }
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
                        const skillCooldownEnd = getEnemySkillCooldown(unit.id);

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
                                    setEnemySkillCooldown(unit.id, now + skill.cooldown);
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

                    if (isRanged && 'projectileColor' in data && data.projectileColor) {
                        const projectile = createProjectile(scene, "enemy", g.position.x, g.position.z, data.projectileColor as string);
                        projectilesRef.push({ type: "basic", mesh: projectile, targetId: targetU.id, attackerId: unit.id, speed: getProjectileSpeed("enemy") });
                        soundFns.playAttack();
                    } else {
                        // Melee attack
                        const targetData = getUnitStats(targetU);
                        spawnSwingIndicator(scene, g, targetG, false, swingAnimations, now);

                        if (rollHit(data.accuracy)) {
                            const dmg = calculateDamage(data.damage[0], data.damage[1], targetData.armor);
                            const dmgCtx: DamageContext = { scene, damageTexts, hitFlashRef, unitsRef, setUnits, addLog, now, defeatedThisFrame };
                            applyDamageToUnit(dmgCtx, targetU.id, targetG, targetU.hp, dmg, targetData.name, { color: COLORS.damageEnemy });

                            soundFns.playHit();
                            addLog(logHit(data.name, "Attack", targetData.name, dmg), COLORS.damageEnemy);
                        } else {
                            soundFns.playMiss();
                            addLog(logMiss(data.name, "Attack", targetData.name), COLORS.logNeutral);
                        }
                    }
                }
                return;
            } else {
                // Recalculate path if needed (but not if we recently gave up)
                if (!recentlyGaveUp(unit.id, now)) {
                    const { needsNewPath } = checkPathNeedsRecalc(pathsRef[unit.id], targetX, targetZ, g.position.x, g.position.z);
                    if (needsNewPath) {
                        const result = createPathToTarget(g.position.x, g.position.z, targetX, targetZ);
                        pathsRef[unit.id] = result.path;
                        if (result.success) {
                            moveStartRef[unit.id] = { time: now, x: g.position.x, z: g.position.z };
                        }
                    }
                }
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
    const movementCtx: MovementContext = { unit, g, unitsRef, unitsState, targetX, targetZ };
    runMovementPhase(movementCtx);
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
