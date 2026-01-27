// =============================================================================
// GAME LOOP - Main entry point, imports from gameLoop/* modules
// =============================================================================

import * as THREE from "three";
import type { Unit, UnitGroup, DamageText, Projectile, FogTexture, SwingAnimation, EnemyStats, EnemySpawnSkill } from "./core/types";
import { COLORS, SKILL_SINGLE_TARGET_CHANCE, SLOW_COOLDOWN_MULT, SLOW_MOVE_MULT, ACID_AURA_COOLDOWN, ACID_AURA_RADIUS } from "./core/constants";
import { getUnitRadius, isInRange } from "./rendering/range";
import { tryKite, type KiteContext } from "./ai/targeting";
import {
    runTargetingPhase, runPathFollowingPhase, runMovementPhase, recalculatePathIfNeeded,
    type TargetingContext, type PathContext, type MovementContext
} from "./ai/unitAI";
import { getUnitStats, getBasicAttackSkill, getAttackRange, ENEMY_STATS } from "./game/units";
import type { ActionQueue } from "./input";
import { getNextUnitId } from "./core/unitIds";
import { calculateDamage, rollHit, shouldApplyPoison, shouldApplySlow, hasStatusEffect, getEffectiveArmor, getEffectiveDamage, logHit, logLifestealHit, logMiss, logPoisoned, logSlowed, isUnitAlive } from "./combat/combatMath";
import { createProjectile, getProjectileSpeed, applyDamageToUnit, getAliveUnitsInRange, spawnDamageNumber, type DamageContext } from "./combat/combat";
import { soundFns } from "./audio/sound";
import { isEnemyKiting, clearEnemyKiting, hasBroodMotherScreeched, markBroodMotherScreeched } from "./game/enemyState";
import { findPath } from "./ai/pathfinding";

// Re-export from split modules
export { updateDamageTexts, updateHitFlash, updatePoisonVisuals, updateFogOfWar, resetFogCache } from "./gameLoop/visuals";
export { processStatusEffects } from "./gameLoop/statusEffects";
export { updateProjectiles } from "./gameLoop/projectiles";
export { spawnSwingIndicator, updateSwingAnimations } from "./gameLoop/swingAnimations";
export { processAcidTiles, createAcidTile, clearAcidTiles } from "./gameLoop/acidTiles";
export { processSanctuaryTiles, createSanctuaryTile, clearSanctuaryTiles } from "./gameLoop/sanctuaryTiles";
export { processChargeAttacks, clearChargeAttacks, isUnitCharging } from "./gameLoop/constructCharge";
import { executeEnemySwipe, executeEnemyHeal } from "./gameLoop/enemySkills";
import { spawnSwingIndicator } from "./gameLoop/swingAnimations";
import { createAcidTile } from "./gameLoop/acidTiles";
import { isUnitCharging, startChargeAttack } from "./gameLoop/constructCharge";

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
    setQueuedActions?: React.Dispatch<React.SetStateAction<{ unitId: number; skillName: string }[]>>,
    // For acid slug enemies
    acidTilesRef?: Map<string, import("./core/types").AcidTile>
): void {
    const isPlayer = unit.team === "player";
    const data = getUnitStats(unit);

    // Skip all actions if stunned - unit cannot move or attack
    if (hasStatusEffect(unit, "stunned")) {
        return;
    }

    // Skip all actions if unit is charging a charge attack
    if (!isPlayer && isUnitCharging(unit.id)) {
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
    const hasFrontShield = !isPlayer && (data as EnemyStats).frontShield === true;
    const hasAggressiveTargeting = !isPlayer && (data as EnemyStats).aggressiveTargeting === true;
    const targetingCtx: TargetingContext = {
        unit, g, unitsRef, unitsState, visibility, pathsRef, moveStartRef,
        now, defeatedThisFrame, aggroRange, hasFrontShield, hasAggressiveTargeting
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

    // Phase 1.55: Acid slug patrol - circle around players spreading acid instead of attacking
    if (!isPlayer && unit.enemyType === "acid_slug" && acidTilesRef) {
        const slugData = data as EnemyStats;

        // Find closest player
        let closestPlayer: { unit: Unit; group: UnitGroup; dist: number } | null = null;
        for (const u of unitsState) {
            if (u.team !== "player" || u.hp <= 0) continue;
            const playerG = unitsRef[u.id];
            if (!playerG) continue;
            const dx = playerG.position.x - g.position.x;
            const dz = playerG.position.z - g.position.z;
            const dist = Math.sqrt(dx * dx + dz * dz);
            if (dist <= slugData.aggroRange && (!closestPlayer || dist < closestPlayer.dist)) {
                closestPlayer = { unit: u, group: playerG, dist };
            }
        }

        if (closestPlayer) {
            // Clear attack target - slugs don't attack
            g.userData.attackTarget = null;

            // Check if we need a new patrol destination (no path or reached destination)
            const currentPath = pathsRef[unit.id];
            const needsNewDestination = !currentPath || currentPath.length === 0;

            if (needsNewDestination) {
                // Pick a random point around the player to patrol to
                const patrolRadius = 3 + Math.random() * 3;  // 3-6 units away from player
                const patrolAngle = Math.random() * Math.PI * 2;
                const patrolX = closestPlayer.group.position.x + Math.cos(patrolAngle) * patrolRadius;
                const patrolZ = closestPlayer.group.position.z + Math.sin(patrolAngle) * patrolRadius;

                const path = findPath(
                    Math.floor(g.position.x), Math.floor(g.position.z),
                    Math.floor(patrolX), Math.floor(patrolZ)
                );
                if (path && path.length > 0) {
                    pathsRef[unit.id] = path;
                    moveStartRef[unit.id] = { time: now, x: g.position.x, z: g.position.z };
                }
            }

            // Continue to movement phase (skip attack logic)
            // Track old position for acid trail
            const oldGridX = Math.floor(g.position.x);
            const oldGridZ = Math.floor(g.position.z);

            // Path following
            const pathCtx: PathContext = { unit, g, pathsRef, moveStartRef, now, isPlayer };
            const pathResult = runPathFollowingPhase(pathCtx);

            // Movement
            const baseSpeedMultiplier = slugData.moveSpeed ?? 1;
            const slowMultiplier = hasStatusEffect(unit, "slowed") ? SLOW_MOVE_MULT : 1;
            const speedMultiplier = hasStatusEffect(unit, "pinned") ? 0 : baseSpeedMultiplier * slowMultiplier;
            const movementCtx: MovementContext = { unit, g, unitsRef, unitsState, targetX: pathResult.targetX, targetZ: pathResult.targetZ, speedMultiplier };
            runMovementPhase(movementCtx);

            // Acid trail when moving
            const newGridX = Math.floor(g.position.x);
            const newGridZ = Math.floor(g.position.z);
            const movedCell = newGridX !== oldGridX || newGridZ !== oldGridZ;

            if (slugData.acidTrail && movedCell) {
                createAcidTile(scene, acidTilesRef, oldGridX, oldGridZ, unit.id, now);
            }

            // Acid aura when stationary
            if (slugData.acidAura && !movedCell) {
                const auraCooldownKey = `${unit.id}-acidAura`;
                const auraCooldownEnd = skillCooldowns[auraCooldownKey]?.end ?? 0;
                const auraCooldown = slugData.acidAuraCooldown ?? ACID_AURA_COOLDOWN;
                const auraRadius = slugData.acidAuraRadius ?? ACID_AURA_RADIUS;

                if (now >= auraCooldownEnd) {
                    const centerX = newGridX;
                    const centerZ = newGridZ;
                    const radiusCells = Math.ceil(auraRadius);

                    for (let dx = -radiusCells; dx <= radiusCells; dx++) {
                        for (let dz = -radiusCells; dz <= radiusCells; dz++) {
                            const dist = Math.sqrt(dx * dx + dz * dz);
                            if (dist <= auraRadius) {
                                createAcidTile(scene, acidTilesRef, centerX + dx, centerZ + dz, unit.id, now);
                            }
                        }
                    }

                    setSkillCooldowns(prev => ({
                        ...prev,
                        [auraCooldownKey]: { end: now + auraCooldown, duration: auraCooldown }
                    }));
                }
            }

            return;  // Skip normal attack behavior
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
                const cooldownMult = hasStatusEffect(unit, "slowed") ? SLOW_COOLDOWN_MULT : 1;
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

        if (targetG && targetU && isUnitAlive(targetU, defeatedThisFrame)) {
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

                // Acid slugs prioritize acid aura over attacking - check if aura is ready
                let skipAttackForAcidAura = false;
                if (!isPlayer && 'acidAura' in data && data.acidAura) {
                    const auraCooldownKey = `${unit.id}-acidAura`;
                    const auraCooldownEnd = skillCooldowns[auraCooldownKey]?.end || 0;
                    if (now >= auraCooldownEnd) {
                        skipAttackForAcidAura = true;
                    }
                }

                if (now >= cooldownEnd && !skipAttackForAcidAura) {
                    // Check if enemy has a charge attack and it's ready
                    if (!isPlayer && 'chargeAttack' in data && data.chargeAttack) {
                        const chargeAttack = data.chargeAttack;
                        const chargeKey = `${unit.id}-${chargeAttack.name}`;
                        const chargeCooldownEnd = skillCooldowns[chargeKey]?.end || 0;

                        if (now >= chargeCooldownEnd) {
                            // Start the charge attack
                            startChargeAttack(scene, unit, g, chargeAttack, now, addLog);
                            const cooldownMult = hasStatusEffect(unit, "slowed") ? SLOW_COOLDOWN_MULT : 1;
                            setSkillCooldowns(prev => ({
                                ...prev,
                                [chargeKey]: { end: now + chargeAttack.cooldown * cooldownMult, duration: chargeAttack.cooldown }
                            }));
                            return;
                        }
                    }

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
                                    const cooldownMult = hasStatusEffect(unit, "slowed") ? SLOW_COOLDOWN_MULT : 1;
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
                    const cooldownMult = hasStatusEffect(unit, "slowed") ? SLOW_COOLDOWN_MULT : 1;
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
                            const dmg = calculateDamage(effectiveDamage[0], effectiveDamage[1], getEffectiveArmor(targetU, targetData.armor), "physical");
                            const willPoison = shouldApplyPoison(data as EnemyStats);
                            const willSlow = shouldApplySlow(data as EnemyStats);
                            const poisonDmg = willPoison && 'poisonDamage' in data ? (data as EnemyStats).poisonDamage : undefined;
                            const lifesteal = (data as EnemyStats).lifesteal;

                            // Calculate lifesteal heal amount for log message (estimate based on current snapshot)
                            const healAmount = lifesteal && lifesteal > 0 ? Math.floor(dmg * lifesteal) : 0;

                            // Custom log for lifesteal attacks
                            const hitText = healAmount > 0
                                ? logLifestealHit(data.name, targetData.name, dmg, healAmount)
                                : logHit(data.name, "Attack", targetData.name, dmg);

                            const dmgCtx: DamageContext = { scene, damageTexts, hitFlashRef, unitsRef, setUnits, addLog, now, defeatedThisFrame };
                            applyDamageToUnit(dmgCtx, targetU.id, targetG, targetU.hp, dmg, targetData.name, {
                                color: COLORS.damageEnemy,
                                poison: willPoison ? { sourceId: unit.id, damagePerTick: poisonDmg } : undefined,
                                slow: willSlow ? { sourceId: unit.id } : undefined,
                                hitMessage: { text: hitText, color: COLORS.damageEnemy },
                                targetUnit: targetU
                            });

                            soundFns.playHit();
                            if (willPoison) {
                                addLog(logPoisoned(targetData.name), COLORS.poisonText);
                            }
                            if (willSlow) {
                                addLog(logSlowed(targetData.name), "#5599ff");
                            }

                            // Apply lifesteal heal using fresh state to avoid race condition
                            if (healAmount > 0) {
                                setUnits(prev => prev.map(u => {
                                    if (u.id !== unit.id) return u;
                                    // Calculate actual heal from fresh HP state
                                    return { ...u, hp: Math.min(u.hp + healAmount, data.maxHp) };
                                }));
                                spawnDamageNumber(scene, g.position.x, g.position.z, healAmount, COLORS.logHeal, damageTexts, true);
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

    // Track old position for acid trail (before movement)
    const oldGridX = Math.floor(g.position.x);
    const oldGridZ = Math.floor(g.position.z);

    // Phase 4: Movement - move toward target with avoidance and wall sliding
    // Pinned units cannot move (speed = 0), slowed units move at half speed
    const baseSpeedMultiplier = !isPlayer && 'moveSpeed' in data ? (data as EnemyStats).moveSpeed : undefined;
    const slowMultiplier = hasStatusEffect(unit, "slowed") ? SLOW_MOVE_MULT : 1;
    const speedMultiplier = hasStatusEffect(unit, "pinned") ? 0 : (baseSpeedMultiplier ?? 1) * slowMultiplier;
    const movementCtx: MovementContext = { unit, g, unitsRef, unitsState, targetX, targetZ, speedMultiplier };
    runMovementPhase(movementCtx);

    // Phase 5: Acid slug - create acid trail when moving, aura when stationary
    if (!isPlayer && acidTilesRef) {
        const enemyStats = data as EnemyStats;
        const newGridX = Math.floor(g.position.x);
        const newGridZ = Math.floor(g.position.z);
        const movedCell = newGridX !== oldGridX || newGridZ !== oldGridZ;

        // Acid trail - leave acid on cells we move through
        if (enemyStats.acidTrail && movedCell) {
            createAcidTile(scene, acidTilesRef, oldGridX, oldGridZ, unit.id, now);
        }

        // Acid aura - periodically create acid around self when NOT moving
        if (enemyStats.acidAura && !movedCell) {
            const auraCooldownKey = `${unit.id}-acidAura`;
            const auraCooldownEnd = skillCooldowns[auraCooldownKey]?.end ?? 0;
            const auraCooldown = enemyStats.acidAuraCooldown ?? ACID_AURA_COOLDOWN;
            const auraRadius = enemyStats.acidAuraRadius ?? ACID_AURA_RADIUS;

            if (now >= auraCooldownEnd) {
                // Create acid tiles in radius around slug
                const centerX = newGridX;
                const centerZ = newGridZ;
                const radiusCells = Math.ceil(auraRadius);

                for (let dx = -radiusCells; dx <= radiusCells; dx++) {
                    for (let dz = -radiusCells; dz <= radiusCells; dz++) {
                        const dist = Math.sqrt(dx * dx + dz * dz);
                        if (dist <= auraRadius) {
                            createAcidTile(scene, acidTilesRef, centerX + dx, centerZ + dz, unit.id, now);
                        }
                    }
                }

                // Set cooldown
                setSkillCooldowns(prev => ({
                    ...prev,
                    [auraCooldownKey]: { end: now + auraCooldown, duration: auraCooldown }
                }));
            }
        }
    }
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

// =============================================================================
// SHIELD FACING UPDATE
// =============================================================================

// Turn speed in radians per frame (at 60fps)
const TURN_SPEED_STATIONARY = 0.25;  // Fast turn when standing still
const TURN_SPEED_MOVING = 0.08;      // Slower turn when moving
const DAMAGE_SOURCE_PRIORITY_TIME = 2000;  // ms - prioritize damage source for 2 seconds

/**
 * Update shield facing for front-shielded enemies.
 * They rotate toward damage sources (when hit recently) or their target.
 * Turn speed is faster when stationary, slower when moving.
 */
export function updateShieldFacing(
    unitsState: Unit[],
    unitsRef: Record<number, UnitGroup>,
    shieldIndicators: Record<number, THREE.Mesh>,
    setUnits: React.Dispatch<React.SetStateAction<Unit[]>>
): void {
    const facingUpdates: { id: number; facing: number }[] = [];
    const now = Date.now();

    for (const unit of unitsState) {
        if (unit.team === "player" || unit.hp <= 0) continue;

        const data = getUnitStats(unit) as EnemyStats;
        if (!data.frontShield) continue;

        const g = unitsRef[unit.id];
        const shieldMesh = shieldIndicators[unit.id];
        if (!g || !shieldMesh) continue;

        // Get current facing (default to 0 if not set)
        let currentFacing = unit.facing ?? 0;

        // Determine target position - prioritize recent damage source
        let targetX: number | undefined;
        let targetZ: number | undefined;
        const damageSource = g.userData.lastDamageSource;

        if (damageSource && (now - damageSource.time) < DAMAGE_SOURCE_PRIORITY_TIME) {
            // Face toward where damage came from
            targetX = damageSource.x;
            targetZ = damageSource.z;
        } else if (g.userData.attackTarget !== null) {
            // Face attack target
            const targetG = unitsRef[g.userData.attackTarget];
            if (targetG) {
                targetX = targetG.position.x;
                targetZ = targetG.position.z;
            } else if (g.userData.targetX !== undefined && g.userData.targetZ !== undefined) {
                targetX = g.userData.targetX;
                targetZ = g.userData.targetZ;
            }
        } else if (g.userData.targetX !== undefined && g.userData.targetZ !== undefined) {
            // Face movement target
            targetX = g.userData.targetX;
            targetZ = g.userData.targetZ;
        }

        // Skip if no valid target position (prevents NaN calculations)
        if (targetX === undefined || targetZ === undefined) {
            continue;
        }

        const dx = targetX - g.position.x;
        const dz = targetZ - g.position.z;
        const dist = Math.hypot(dx, dz);

        if (dist > 0.1) {
            // Calculate target angle (atan2 gives angle from positive X axis)
            const targetAngle = Math.atan2(dx, dz);

            // Calculate shortest rotation direction
            let angleDiff = targetAngle - currentFacing;

            // Normalize to -PI to PI
            while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
            while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

            // Determine if unit is moving (check if position differs from movement target)
            const moveDistX = Math.abs(g.userData.targetX - g.position.x);
            const moveDistZ = Math.abs(g.userData.targetZ - g.position.z);
            const isMoving = moveDistX > 0.2 || moveDistZ > 0.2;

            // Apply turn speed - faster when stationary, slower when moving
            const baseTurnSpeed = isMoving ? TURN_SPEED_MOVING : TURN_SPEED_STATIONARY;
            const turnSpeed = baseTurnSpeed * (data.turnSpeed ?? 1);

            // Rotate toward target
            if (Math.abs(angleDiff) < turnSpeed) {
                currentFacing = targetAngle;
            } else {
                currentFacing += turnSpeed * Math.sign(angleDiff);
            }

            // Normalize result
            while (currentFacing > Math.PI) currentFacing -= Math.PI * 2;
            while (currentFacing < -Math.PI) currentFacing += Math.PI * 2;

            facingUpdates.push({ id: unit.id, facing: currentFacing });
        }

        // Update shield mesh rotation to match blocking direction
        // The CircleGeometry thetaStart=-PI/2 creates a half-disc pointing +X in local coords
        // After rotation.x=-PI/2, it needs rotation.z offset to align with atan2 facing angles
        shieldMesh.rotation.z = currentFacing - Math.PI / 2;
    }

    // Batch update unit facing values
    if (facingUpdates.length > 0) {
        setUnits(prev => prev.map(u => {
            const update = facingUpdates.find(f => f.id === u.id);
            return update ? { ...u, facing: update.facing } : u;
        }));
    }
}
