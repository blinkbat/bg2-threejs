// =============================================================================
// GAME LOOP - Main entry point, imports from gameLoop/* modules
// =============================================================================

import * as THREE from "three";
import type { Unit, UnitGroup, DamageText, Projectile, FogTexture, SwingAnimation, EnemyStats, EnemySpawnSkill } from "./core/types";
import { COLORS, SKILL_SINGLE_TARGET_CHANCE, SLOW_COOLDOWN_MULT, SLOW_MOVE_MULT } from "./core/constants";
import { getUnitRadius, isInRange } from "./rendering/range";
import { tryKite, type KiteContext } from "./ai/targeting";
import {
    runTargetingPhase, runPathFollowingPhase, runMovementPhase, recalculatePathIfNeeded,
    type TargetingContext, type PathContext, type MovementContext
} from "./ai/unitAI";
import { getUnitStats, getBasicAttackSkill, getAttackRange, ENEMY_STATS } from "./game/units";
import type { ActionQueue } from "./input";
import { getNextUnitId, initializeUnitIdCounter } from "./core/unitIds";
import { calculateDamage, rollHit, shouldApplyPoison, shouldApplySlow, hasStunnedEffect, hasPinnedEffect, hasSlowedEffect, getEffectiveArmor, getEffectiveDamage, logHit, logMiss, logPoisoned, logSlowed } from "./combat/combatMath";
import { createProjectile, getProjectileSpeed, applyDamageToUnit, getAliveUnitsInRange, type DamageContext } from "./combat/combat";
import { soundFns } from "./audio/sound";
import { isEnemyKiting, clearEnemyKiting, hasBroodMotherScreeched, markBroodMotherScreeched } from "./game/enemyState";

// Re-export from split modules
export { updateDamageTexts, updateHitFlash, updatePoisonVisuals, updateFogOfWar, resetFogCache } from "./gameLoop/visuals";
export { processStatusEffects } from "./gameLoop/statusEffects";
export { updateProjectiles } from "./gameLoop/projectiles";
export { spawnSwingIndicator, updateSwingAnimations } from "./gameLoop/swingAnimations";
import { executeEnemySwipe, executeEnemyHeal } from "./gameLoop/enemySkills";
import { spawnSwingIndicator } from "./gameLoop/swingAnimations";

// Re-export unit ID utilities for backwards compatibility
export { getNextUnitId, initializeUnitIdCounter } from "./core/unitIds";

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
                const cooldownMult = hasSlowedEffect(unit) ? SLOW_COOLDOWN_MULT : 1;
                setSkillCooldowns(prev => ({
                    ...prev,
                    [healCooldownKey]: { end: now + healSkill.cooldown * cooldownMult, duration: healSkill.cooldown }
                }));
                actionCooldownRef[unit.id] = now + data.attackCooldown * cooldownMult;
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
        const spawnEnemyData = data as EnemyStats;
        const playerInSight = unitsState.some(u => {
            if (u.team !== "player" || u.hp <= 0) return false;
            const playerG = unitsRef[u.id];
            if (!playerG) return false;
            const dx = playerG.position.x - g.position.x;
            const dz = playerG.position.z - g.position.z;
            return Math.sqrt(dx * dx + dz * dz) <= spawnEnemyData.aggroRange;
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
                addLog(`${spawnEnemyData.name} spawns a ${ENEMY_STATS[spawnSkill.spawnType].name}!`, "#cc6600");

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
                                    const cooldownMult = hasSlowedEffect(unit) ? SLOW_COOLDOWN_MULT : 1;
                                    setSkillCooldowns(prev => ({
                                        ...prev,
                                        [enemySkillKey]: { end: now + skill.cooldown * cooldownMult, duration: skill.cooldown }
                                    }));
                                    actionCooldownRef[unit.id] = now + data.attackCooldown * cooldownMult;
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
                    const cooldownMult = hasSlowedEffect(unit) ? SLOW_COOLDOWN_MULT : 1;
                    const attackCooldownEnd = now + data.attackCooldown * cooldownMult;
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
                            const effectiveDamage = getEffectiveDamage(unit, data.damage as [number, number]);
                            const dmg = calculateDamage(effectiveDamage[0], effectiveDamage[1], getEffectiveArmor(targetU, targetData.armor));
                            const willPoison = shouldApplyPoison(data as EnemyStats);
                            const willSlow = shouldApplySlow(data as EnemyStats);
                            const poisonDmg = willPoison && 'poisonDamage' in data ? (data as EnemyStats).poisonDamage : undefined;
                            const dmgCtx: DamageContext = { scene, damageTexts, hitFlashRef, unitsRef, setUnits, addLog, now, defeatedThisFrame };
                            applyDamageToUnit(dmgCtx, targetU.id, targetG, targetU.hp, dmg, targetData.name, {
                                color: COLORS.damageEnemy,
                                poison: willPoison ? { sourceId: unit.id, damagePerTick: poisonDmg } : undefined,
                                slow: willSlow ? { sourceId: unit.id } : undefined,
                                hitMessage: { text: logHit(data.name, "Attack", targetData.name, dmg), color: COLORS.damageEnemy },
                                targetUnit: targetU
                            });

                            soundFns.playHit();
                            if (willPoison) {
                                addLog(logPoisoned(targetData.name), COLORS.poisonText);
                            }
                            if (willSlow) {
                                addLog(logSlowed(targetData.name), "#5599ff");
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
    // Pinned units cannot move (speed = 0), slowed units move at half speed
    const baseSpeedMultiplier = !isPlayer && 'moveSpeed' in data ? (data as EnemyStats).moveSpeed : undefined;
    const slowMultiplier = hasSlowedEffect(unit) ? SLOW_MOVE_MULT : 1;
    const speedMultiplier = hasPinnedEffect(unit) ? 0 : (baseSpeedMultiplier ?? 1) * slowMultiplier;
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
