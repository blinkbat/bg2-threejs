// =============================================================================
// ENEMY BEHAVIORS - Special behaviors for specific enemy types
// =============================================================================

import * as THREE from "three";
import type { Unit, UnitGroup, EnemyStats, EnemySpawnSkill, EnemyChargeAttack, EnemyLeapSkill, EnemyVinesSkill, EnemyTentacleSkill, DamageText } from "../core/types";
import { ENEMY_STATS, getUnitStats } from "../game/units";
import { getNextUnitId } from "../core/unitIds";
import { soundFns } from "../audio/sound";
import { hasBroodMotherScreeched, markBroodMotherScreeched } from "../game/enemyState";
import { hasStatusEffect } from "../combat/combatMath";
import { SLOW_COOLDOWN_MULT, BUFF_TICK_INTERVAL, COLORS } from "../core/constants";
import { startChargeAttack } from "./constructCharge";
import { applyDamageToUnit, type DamageContext } from "../combat/combat";

// =============================================================================
// TYPES
// =============================================================================

export interface SpawnContext {
    unit: Unit;
    g: UnitGroup;
    enemyStats: EnemyStats;
    spawnSkill: EnemySpawnSkill;
    unitsState: Unit[];
    unitsRef: Record<number, UnitGroup>;
    skillCooldowns: Record<string, { end: number; duration: number }>;
    setSkillCooldowns: React.Dispatch<React.SetStateAction<Record<string, { end: number; duration: number }>>>;
    setUnits: React.Dispatch<React.SetStateAction<Unit[]>>;
    addLog: (text: string, color?: string) => void;
    now: number;
}

export interface ChargeContext {
    unit: Unit;
    g: UnitGroup;
    chargeAttack: EnemyChargeAttack;
    scene: THREE.Scene;
    skillCooldowns: Record<string, { end: number; duration: number }>;
    setSkillCooldowns: React.Dispatch<React.SetStateAction<Record<string, { end: number; duration: number }>>>;
    addLog: (text: string, color?: string) => void;
    now: number;
}

export interface LeapContext {
    unit: Unit;
    g: UnitGroup;
    enemyStats: EnemyStats;
    leapSkill: EnemyLeapSkill;
    targetUnit: Unit;
    targetG: UnitGroup;
    scene: THREE.Scene;
    skillCooldowns: Record<string, { end: number; duration: number }>;
    setSkillCooldowns: React.Dispatch<React.SetStateAction<Record<string, { end: number; duration: number }>>>;
    setUnits: React.Dispatch<React.SetStateAction<Unit[]>>;
    addLog: (text: string, color?: string) => void;
    now: number;
}

export interface VinesContext {
    unit: Unit;
    g: UnitGroup;
    enemyStats: EnemyStats;
    vinesSkill: EnemyVinesSkill;
    targetUnit: Unit;
    targetG: UnitGroup;
    scene: THREE.Scene;
    skillCooldowns: Record<string, { end: number; duration: number }>;
    setSkillCooldowns: React.Dispatch<React.SetStateAction<Record<string, { end: number; duration: number }>>>;
    setUnits: React.Dispatch<React.SetStateAction<Unit[]>>;
    addLog: (text: string, color?: string) => void;
    now: number;
    // Damage context for proper death handling
    damageTexts: DamageText[];
    hitFlashRef: Record<number, number>;
    unitsRef: Record<number, UnitGroup>;
    unitsStateRef: React.RefObject<Unit[]>;
    defeatedThisFrame: Set<number>;
}

// =============================================================================
// BROOD MOTHER SPAWN BEHAVIOR
// =============================================================================

/**
 * Check if any player is visible to the spawner (within aggro range).
 */
function isPlayerVisible(
    g: UnitGroup,
    enemyStats: EnemyStats,
    unitsState: Unit[],
    unitsRef: Record<number, UnitGroup>
): boolean {
    return unitsState.some(u => {
        if (u.team !== "player" || u.hp <= 0) return false;
        const playerG = unitsRef[u.id];
        if (!playerG) return false;
        const dx = playerG.position.x - g.position.x;
        const dz = playerG.position.z - g.position.z;
        return Math.sqrt(dx * dx + dz * dz) <= enemyStats.aggroRange;
    });
}

/**
 * Try to spawn a minion for a spawner enemy (like Brood Mother).
 * Handles visibility check, spawn limit, cooldown, and unit creation.
 * @returns true if a spawn occurred
 */
export function trySpawnMinion(ctx: SpawnContext): boolean {
    const { unit, g, enemyStats, spawnSkill, unitsState, unitsRef, skillCooldowns, setSkillCooldowns, setUnits, addLog, now } = ctx;

    const spawnCooldownKey = `${unit.id}-spawn`;
    const spawnCooldownEnd = skillCooldowns[spawnCooldownKey]?.end ?? 0;

    const playerInSight = isPlayerVisible(g, enemyStats, unitsState, unitsRef);

    // Play Brood Mother screech on first sight of player
    if (playerInSight && unit.enemyType === "brood_mother" && !hasBroodMotherScreeched(unit.id)) {
        markBroodMotherScreeched(unit.id);
        soundFns.playBroodMotherScreech();
        addLog("The Brood Mother lets out a piercing screech!", "#cc6600");
    }

    if (!playerInSight || now < spawnCooldownEnd) {
        return false;
    }

    // Count current spawns from this unit
    const currentSpawns = unitsState.filter(u => u.spawnedBy === unit.id && u.hp > 0).length;
    if (currentSpawns >= spawnSkill.maxSpawns) {
        return false;
    }

    // Spawn a new minion
    const spawnAngle = Math.random() * Math.PI * 2;
    const spawnX = g.position.x + Math.cos(spawnAngle) * spawnSkill.spawnRange;
    const spawnZ = g.position.z + Math.sin(spawnAngle) * spawnSkill.spawnRange;

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

    setUnits(prev => [...prev, spawnedUnit]);

    // Play screech sound for broodling spawns
    if (spawnSkill.spawnType === "broodling") {
        soundFns.playScreech();
    }

    addLog(`${enemyStats.name} spawns a ${ENEMY_STATS[spawnSkill.spawnType].name}!`, "#cc6600");

    setSkillCooldowns(prev => ({
        ...prev,
        [spawnCooldownKey]: { end: now + spawnSkill.cooldown, duration: spawnSkill.cooldown }
    }));

    return true;
}

// =============================================================================
// CONSTRUCT CHARGE ATTACK BEHAVIOR
// =============================================================================

/**
 * Try to start a charge attack for an enemy with chargeAttack capability.
 * Handles cooldown check and initiates the charge.
 * @returns true if a charge was started
 */
export function tryStartChargeAttack(ctx: ChargeContext): boolean {
    const { unit, g, chargeAttack, scene, skillCooldowns, setSkillCooldowns, addLog, now } = ctx;

    const chargeKey = `${unit.id}-${chargeAttack.name}`;
    const chargeCooldownEnd = skillCooldowns[chargeKey]?.end ?? 0;

    if (now < chargeCooldownEnd) {
        return false;
    }

    // Start the charge attack
    startChargeAttack(scene, unit, g, chargeAttack, now, addLog);

    const cooldownMult = hasStatusEffect(unit, "slowed") ? SLOW_COOLDOWN_MULT : 1;
    setSkillCooldowns(prev => ({
        ...prev,
        [chargeKey]: { end: now + chargeAttack.cooldown * cooldownMult, duration: chargeAttack.cooldown }
    }));

    return true;
}

// =============================================================================
// FERAL HOUND LEAP BEHAVIOR
// =============================================================================

// Active leaps being animated
interface ActiveLeap {
    unitId: number;
    startX: number;
    startZ: number;
    endX: number;
    endZ: number;
    elapsedTime: number;      // Accumulated leap time (pause-safe)
    lastUpdateTime: number;   // Last frame's timestamp for delta calculation
    duration: number;  // ms
    targetId: number;
    damage: [number, number];
}

const activeLeaps: ActiveLeap[] = [];
const LEAP_DURATION = 350;  // ms for the leap animation
const LEAP_HEIGHT = 2.5;    // Peak height of the arc

/**
 * Try to leap to a target for an enemy with leapSkill capability.
 * @returns true if a leap was initiated
 */
export function tryLeapToTarget(ctx: LeapContext): boolean {
    const { unit, g, leapSkill, targetUnit, targetG, skillCooldowns, setSkillCooldowns, addLog, now } = ctx;

    const leapKey = `${unit.id}-leap`;
    const leapCooldownEnd = skillCooldowns[leapKey]?.end ?? 0;

    if (now < leapCooldownEnd) {
        return false;
    }

    // Check distance to target
    const dx = targetG.position.x - g.position.x;
    const dz = targetG.position.z - g.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    // Only leap if target is within the right range
    if (dist < leapSkill.minRange || dist > leapSkill.maxRange) {
        return false;
    }

    // Calculate landing position (slightly in front of target)
    const dirX = dx / dist;
    const dirZ = dz / dist;
    const landingDist = Math.max(1.2, dist - 1.0);  // Land close to target but not on them
    const endX = g.position.x + dirX * landingDist;
    const endZ = g.position.z + dirZ * landingDist;

    // Start the leap
    activeLeaps.push({
        unitId: unit.id,
        startX: g.position.x,
        startZ: g.position.z,
        endX,
        endZ,
        elapsedTime: 0,
        lastUpdateTime: now,
        duration: LEAP_DURATION,
        targetId: targetUnit.id,
        damage: leapSkill.damage
    });

    // Play a growl/bark sound
    soundFns.playBark();

    addLog(`Feral Hound leaps at ${targetUnit.team === "player" ? "the party" : "its target"}!`, "#cc6600");

    const cooldownMult = hasStatusEffect(unit, "slowed") ? SLOW_COOLDOWN_MULT : 1;
    setSkillCooldowns(prev => ({
        ...prev,
        [leapKey]: { end: now + leapSkill.cooldown * cooldownMult, duration: leapSkill.cooldown }
    }));

    return true;
}

/**
 * Check if a unit is currently mid-leap.
 */
export function isUnitLeaping(unitId: number): boolean {
    return activeLeaps.some(leap => leap.unitId === unitId);
}

/**
 * Update active leaps - animate positions and handle landing.
 */
export function updateLeaps(
    now: number,
    unitsRef: Record<number, UnitGroup>,
    unitsStateRef: React.RefObject<Unit[]>,
    setUnits: React.Dispatch<React.SetStateAction<Unit[]>>,
    hitFlashRef: React.RefObject<Record<number, number>>,
    addLog: (text: string, color?: string) => void,
    scene: THREE.Scene,
    damageTexts: DamageText[],
    defeatedThisFrame: Set<number>
): void {
    for (let i = activeLeaps.length - 1; i >= 0; i--) {
        const leap = activeLeaps[i];

        // Cap delta to prevent pause/unpause from causing instant leap completion
        const rawDelta = now - leap.lastUpdateTime;
        const delta = Math.min(rawDelta, 100); // Max 100ms per frame
        leap.elapsedTime += delta;
        leap.lastUpdateTime = now;

        const progress = Math.min(1, leap.elapsedTime / leap.duration);

        const g = unitsRef[leap.unitId];
        if (!g) {
            activeLeaps.splice(i, 1);
            continue;
        }

        // Interpolate position with arc
        const t = progress;
        const x = leap.startX + (leap.endX - leap.startX) * t;
        const z = leap.startZ + (leap.endZ - leap.startZ) * t;
        // Parabolic arc: peaks at t=0.5
        const arcY = LEAP_HEIGHT * 4 * t * (1 - t);

        g.position.set(x, arcY, z);

        // Keep shadow on ground by offsetting it down
        const shadow = g.children.find(child =>
            child instanceof THREE.Mesh &&
            (child as THREE.Mesh).geometry instanceof THREE.CircleGeometry
        );
        if (shadow) {
            shadow.position.y = 0.004 - arcY;
        }

        // Check if leap is complete
        if (progress >= 1) {
            // Land and deal damage
            g.position.y = 0;

            // Reset shadow position
            if (shadow) {
                shadow.position.y = 0.004;
            }

            // Update unit state position
            setUnits(prev => prev.map(u =>
                u.id === leap.unitId ? { ...u, x: leap.endX, z: leap.endZ } : u
            ));

            // Deal damage to target if they're still alive and nearby
            const targetG = unitsRef[leap.targetId];
            const targetUnit = unitsStateRef.current.find(u => u.id === leap.targetId);
            if (targetG && targetUnit && targetUnit.hp > 0 && !defeatedThisFrame.has(leap.targetId)) {
                const landDist = Math.hypot(
                    targetG.position.x - leap.endX,
                    targetG.position.z - leap.endZ
                );

                // Deal damage if close enough on landing
                if (landDist < 2.5) {
                    const damage = leap.damage[0] + Math.floor(Math.random() * (leap.damage[1] - leap.damage[0] + 1));
                    const targetData = getUnitStats(targetUnit);

                    const dmgCtx: DamageContext = {
                        scene, damageTexts, hitFlashRef: hitFlashRef.current, unitsRef, unitsStateRef,
                        setUnits, addLog, now, defeatedThisFrame
                    };
                    applyDamageToUnit(dmgCtx, leap.targetId, targetG, targetUnit.hp, damage, targetData.name, {
                        color: COLORS.damageEnemy,
                        hitMessage: { text: `Feral Hound's leap deals ${damage} damage!`, color: "#ff6600" },
                        targetUnit
                    });

                    soundFns.playHit();
                }
            }

            activeLeaps.splice(i, 1);
        }
    }
}

/**
 * Clear all active leaps (for game restart).
 */
export function clearLeaps(): void {
    activeLeaps.length = 0;
}

// =============================================================================
// CORRUPT DRUID VINES BEHAVIOR
// =============================================================================

/**
 * Try to cast vines on a target, immobilizing them.
 * @returns true if vines were cast
 */
export function tryVinesSkill(ctx: VinesContext): boolean {
    const {
        unit, g, enemyStats, vinesSkill, targetUnit, targetG, scene,
        skillCooldowns, setSkillCooldowns, setUnits, addLog, now,
        damageTexts, hitFlashRef, unitsRef, unitsStateRef, defeatedThisFrame
    } = ctx;

    const vinesKey = `${unit.id}-vines`;
    const vinesCooldownEnd = skillCooldowns[vinesKey]?.end ?? 0;

    if (now < vinesCooldownEnd) {
        return false;
    }

    // Check distance to target
    const dx = targetG.position.x - g.position.x;
    const dz = targetG.position.z - g.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    // Only cast if target is within range
    if (dist > vinesSkill.range) {
        return false;
    }

    // Don't cast on already pinned targets
    if (targetUnit.statusEffects?.some(e => e.type === "pinned")) {
        return false;
    }

    // Apply pinned status effect
    setUnits(prev => prev.map(u => {
        if (u.id !== targetUnit.id) return u;
        const newEffects = [...(u.statusEffects || [])];
        newEffects.push({
            type: "pinned",
            duration: vinesSkill.duration,
            tickInterval: BUFF_TICK_INTERVAL,
            timeSinceTick: 0,
            lastUpdateTime: now,
            damagePerTick: 0,
            sourceId: unit.id
        });
        return { ...u, statusEffects: newEffects };
    }));

    // Calculate and apply damage using centralized damage system
    const damage = vinesSkill.damage[0] + Math.floor(Math.random() * (vinesSkill.damage[1] - vinesSkill.damage[0] + 1));
    const targetData = getUnitStats(targetUnit);
    const dmgCtx: DamageContext = { scene, damageTexts, hitFlashRef, unitsRef, unitsStateRef, setUnits, addLog, now, defeatedThisFrame };
    applyDamageToUnit(dmgCtx, targetUnit.id, targetG, targetUnit.hp, damage, targetData.name, {
        color: COLORS.damageEnemy,
        hitMessage: { text: `${enemyStats.name} entangles ${targetUnit.team === "player" ? "a party member" : "its target"} in vines for ${damage} damage!`, color: "#2d4a1c" },
        targetUnit
    });

    // Create visual effect - green vines rising from ground
    createVinesEffect(scene, targetG.position.x, targetG.position.z, vinesSkill.duration);

    // Play sound
    soundFns.playVines();

    const cooldownMult = hasStatusEffect(unit, "slowed") ? SLOW_COOLDOWN_MULT : 1;
    setSkillCooldowns(prev => ({
        ...prev,
        [vinesKey]: { end: now + vinesSkill.cooldown * cooldownMult, duration: vinesSkill.cooldown }
    }));

    return true;
}

/**
 * Create a visual effect for vines at the target location.
 */
function createVinesEffect(scene: THREE.Scene, x: number, z: number, duration: number): void {
    const vinesGroup = new THREE.Group();
    vinesGroup.position.set(x, 0, z);

    // Create several vine tendrils
    const vineColor = 0x2d5a1c;
    const vineMaterial = new THREE.MeshBasicMaterial({ color: vineColor });
    const geometries: THREE.BufferGeometry[] = [];

    for (let i = 0; i < 6; i++) {
        const angle = (i / 6) * Math.PI * 2;
        const vineGeom = new THREE.CylinderGeometry(0.05, 0.08, 1.2, 6);
        geometries.push(vineGeom);
        const vine = new THREE.Mesh(vineGeom, vineMaterial);
        vine.position.set(Math.cos(angle) * 0.4, 0.6, Math.sin(angle) * 0.4);
        vine.rotation.x = Math.sin(angle) * 0.3;
        vine.rotation.z = Math.cos(angle) * 0.3;
        vinesGroup.add(vine);
    }

    // Add a base ring
    const ringGeom = new THREE.TorusGeometry(0.5, 0.1, 8, 16);
    geometries.push(ringGeom);
    const ring = new THREE.Mesh(ringGeom, vineMaterial);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.1;
    vinesGroup.add(ring);

    scene.add(vinesGroup);

    // Animate and remove after duration
    const startTime = performance.now();
    const animate = () => {
        const elapsed = performance.now() - startTime;
        const progress = elapsed / duration;

        if (progress >= 1) {
            scene.remove(vinesGroup);
            geometries.forEach(g => g.dispose());
            vineMaterial.dispose();
            return;
        }

        // Fade out near the end
        if (progress > 0.8) {
            const fadeProgress = (progress - 0.8) / 0.2;
            vineMaterial.opacity = 1 - fadeProgress;
            vineMaterial.transparent = true;
        }

        // Gentle sway
        vinesGroup.rotation.y = Math.sin(elapsed / 200) * 0.1;

        requestAnimationFrame(animate);
    };
    animate();
}

// =============================================================================
// BABY KRAKEN TENTACLE BEHAVIOR
// =============================================================================

export interface TentacleContext {
    unit: Unit;
    g: UnitGroup;
    enemyStats: EnemyStats;
    tentacleSkill: EnemyTentacleSkill;
    unitsState: Unit[];
    unitsRef: Record<number, UnitGroup>;
    scene: THREE.Scene;
    skillCooldowns: Record<string, { end: number; duration: number }>;
    setSkillCooldowns: React.Dispatch<React.SetStateAction<Record<string, { end: number; duration: number }>>>;
    setUnits: React.Dispatch<React.SetStateAction<Unit[]>>;
    addLog: (text: string, color?: string) => void;
    now: number;
}

// Track tentacle spawn times for automatic despawning
interface ActiveTentacle {
    unitId: number;
    parentId: number;
    spawnTime: number;
    duration: number;
    isEmerging: boolean;  // True while rising from ground
    isRetreating: boolean;  // True while sinking back into ground
    retreatStartTime: number;  // When retreat animation started
}

const activeTentacles: ActiveTentacle[] = [];
const TENTACLE_EMERGE_DURATION = 600;  // ms for emerge animation
const TENTACLE_START_Y = -1.5;  // Start below ground

// Track lifetime tentacles spawned per kraken (max 8)
const krakenLifetimeTentacles: Map<number, number> = new Map();
const MAX_LIFETIME_TENTACLES = 8;

// Track submerged krakens
interface SubmergedKraken {
    unitId: number;
    submergeEndTime: number;
    // Animation states
    isSubmerging: boolean;      // True while sinking animation is playing
    isSurfacing: boolean;       // True while rising animation is playing
    animationStartTime: number; // When the current animation started
}

const submergedKrakens: SubmergedKraken[] = [];
const KRAKEN_SUBMERGE_DURATION = 10000;  // 10 seconds underwater
const KRAKEN_HP_THRESHOLDS = [0.75, 0.5, 0.25];  // Submerge at 75%, 50%, 25% HP
const KRAKEN_SUBMERGE_ANIM_DURATION = 800;  // ms for submerge/surface animation
const KRAKEN_SUBMERGE_DEPTH = -3.0;  // How far below ground kraken sinks

// Track which thresholds each kraken has already used (persists after resurface)
const krakenUsedThresholds: Map<number, number[]> = new Map();

/**
 * Try to spawn a tentacle for a kraken enemy.
 * Tentacles spawn toward visible player units.
 * @returns true if a tentacle was spawned
 */
export function trySpawnTentacle(ctx: TentacleContext): boolean {
    const { unit, g, enemyStats, tentacleSkill, unitsState, unitsRef, scene, skillCooldowns, setSkillCooldowns, setUnits, addLog, now } = ctx;

    const spawnKey = `${unit.id}-tentacle`;
    const spawnCooldownEnd = skillCooldowns[spawnKey]?.end ?? 0;

    if (now < spawnCooldownEnd) {
        return false;
    }

    // Find visible player targets
    const visibleTargets = unitsState.filter(u => {
        if (u.team !== "player" || u.hp <= 0) return false;
        const playerG = unitsRef[u.id];
        if (!playerG) return false;
        const dx = playerG.position.x - g.position.x;
        const dz = playerG.position.z - g.position.z;
        return Math.sqrt(dx * dx + dz * dz) <= enemyStats.aggroRange;
    });

    if (visibleTargets.length === 0) {
        return false;
    }

    // Count current tentacles from this kraken
    const currentTentacles = activeTentacles.filter(t => t.parentId === unit.id).length;
    if (currentTentacles >= tentacleSkill.maxTentacles) {
        return false;
    }

    // Check lifetime tentacle limit (8 total per kraken)
    const lifetimeCount = krakenLifetimeTentacles.get(unit.id) ?? 0;
    if (lifetimeCount >= MAX_LIFETIME_TENTACLES) {
        return false;
    }

    // Pick a random visible target
    const target = visibleTargets[Math.floor(Math.random() * visibleTargets.length)];
    const targetG = unitsRef[target.id];
    if (!targetG) return false;

    // Calculate spawn position - between kraken and target, closer to target
    const dx = targetG.position.x - g.position.x;
    const dz = targetG.position.z - g.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    const dirX = dx / dist;
    const dirZ = dz / dist;

    // Spawn tentacle at a distance toward the target (but not right on them)
    const spawnDist = Math.min(tentacleSkill.spawnRange, dist - 1.5);
    const spawnX = g.position.x + dirX * spawnDist;
    const spawnZ = g.position.z + dirZ * spawnDist;

    // Create the tentacle unit
    const newId = getNextUnitId();
    const tentacleUnit: Unit = {
        id: newId,
        x: spawnX,
        z: spawnZ,
        hp: ENEMY_STATS.kraken_tentacle.maxHp,
        team: "enemy",
        enemyType: "kraken_tentacle",
        target: null,
        aiEnabled: true,
        spawnedBy: unit.id
    };

    setUnits(prev => [...prev, tentacleUnit]);

    // Track the tentacle for despawning and emergence animation
    activeTentacles.push({
        unitId: newId,
        parentId: unit.id,
        spawnTime: now,
        duration: tentacleSkill.tentacleDuration,
        isEmerging: true,
        isRetreating: false,
        retreatStartTime: 0
    });

    // Increment lifetime tentacle count
    krakenLifetimeTentacles.set(unit.id, lifetimeCount + 1);

    // Create emerge visual effect
    createTentacleEmergeEffect(scene, spawnX, spawnZ);

    // Play sound
    soundFns.playSplash();

    addLog(`${enemyStats.name} extends a tentacle!`, "#6b3fa0");

    const cooldownMult = hasStatusEffect(unit, "slowed") ? SLOW_COOLDOWN_MULT : 1;
    setSkillCooldowns(prev => ({
        ...prev,
        [spawnKey]: { end: now + tentacleSkill.cooldown * cooldownMult, duration: tentacleSkill.cooldown }
    }));

    return true;
}

/**
 * Update active tentacles - animate emergence and despawn expired ones.
 */
export function updateTentacles(
    now: number,
    unitsState: Unit[],
    unitsRef: Record<number, UnitGroup>,
    setUnits: React.Dispatch<React.SetStateAction<Unit[]>>,
    addLog: (text: string, color?: string) => void
): void {
    for (let i = activeTentacles.length - 1; i >= 0; i--) {
        const tentacle = activeTentacles[i];
        const elapsed = now - tentacle.spawnTime;

        // Check if tentacle still exists (might have been killed)
        const tentacleUnit = unitsState.find(u => u.id === tentacle.unitId);
        if (!tentacleUnit || tentacleUnit.hp <= 0) {
            activeTentacles.splice(i, 1);
            continue;
        }

        const tentacleG = unitsRef[tentacle.unitId];
        if (!tentacleG) continue;

        // Animate emergence - slide up from below ground
        if (tentacle.isEmerging) {
            const emergeProgress = Math.min(1, elapsed / TENTACLE_EMERGE_DURATION);
            // Ease out for smooth deceleration at top
            const easedProgress = 1 - Math.pow(1 - emergeProgress, 2);
            tentacleG.position.y = TENTACLE_START_Y + (0 - TENTACLE_START_Y) * easedProgress;

            if (emergeProgress >= 1) {
                tentacle.isEmerging = false;
                tentacleG.position.y = 0;
            }
        }

        // Animate retreat - slide back down into ground
        if (tentacle.isRetreating) {
            const retreatElapsed = now - tentacle.retreatStartTime;
            const retreatProgress = Math.min(1, retreatElapsed / TENTACLE_EMERGE_DURATION);
            // Ease in for smooth acceleration going down
            const easedProgress = Math.pow(retreatProgress, 2);
            tentacleG.position.y = 0 + (TENTACLE_START_Y - 0) * easedProgress;

            if (retreatProgress >= 1) {
                // Retreat complete - remove the tentacle
                tentacleG.visible = false;
                setUnits(prev => prev.filter(u => u.id !== tentacle.unitId));
                activeTentacles.splice(i, 1);
            }
            continue;  // Skip duration check while retreating
        }

        // Check if duration expired (start counting from after emerge completes)
        const timeAfterEmerge = elapsed - TENTACLE_EMERGE_DURATION;
        if (timeAfterEmerge >= tentacle.duration) {
            // Start retreat animation instead of immediately removing
            tentacle.isRetreating = true;
            tentacle.retreatStartTime = now;
            addLog("A tentacle retreats back underground.", "#888888");
        }
    }
}

/**
 * Handle tentacle death - damage the parent kraken.
 * Call this when a kraken_tentacle dies.
 */
export function handleTentacleDeath(
    tentacleUnit: Unit,
    unitsState: Unit[],
    unitsRef: Record<number, UnitGroup>,
    scene: THREE.Scene,
    damageTexts: DamageText[],
    hitFlashRef: Record<number, number>,
    unitsStateRef: React.RefObject<Unit[]>,
    setUnits: React.Dispatch<React.SetStateAction<Unit[]>>,
    addLog: (text: string, color?: string) => void,
    now: number,
    defeatedThisFrame: Set<number>
): void {
    if (!tentacleUnit.spawnedBy) return;

    const parentKraken = unitsState.find(u => u.id === tentacleUnit.spawnedBy && u.hp > 0);
    if (!parentKraken) return;

    const krakenG = unitsRef[parentKraken.id];
    if (!krakenG) return;

    const krakenStats = ENEMY_STATS.baby_kraken;
    const damage = krakenStats.tentacleSkill?.damageToParent ?? 15;

    const dmgCtx: DamageContext = {
        scene, damageTexts, hitFlashRef, unitsRef, unitsStateRef,
        setUnits, addLog, now, defeatedThisFrame
    };

    applyDamageToUnit(dmgCtx, parentKraken.id, krakenG, parentKraken.hp, damage, krakenStats.name, {
        color: COLORS.damageEnemy,
        hitMessage: { text: `The severed tentacle damages ${krakenStats.name} for ${damage}!`, color: "#ff6600" },
        targetUnit: parentKraken
    });

    // Remove from tracking
    const idx = activeTentacles.findIndex(t => t.unitId === tentacleUnit.id);
    if (idx !== -1) {
        activeTentacles.splice(idx, 1);
    }
}

/**
 * Check if a unit is a tentacle that should damage its parent on death.
 */
export function isTentacleUnit(unit: Unit): boolean {
    return unit.enemyType === "kraken_tentacle" && unit.spawnedBy !== undefined;
}

/**
 * Clear all active tentacles and submerged krakens (for game restart).
 */
export function clearTentacles(): void {
    activeTentacles.length = 0;
    submergedKrakens.length = 0;
    krakenLifetimeTentacles.clear();
    krakenUsedThresholds.clear();
}

/**
 * Create a visual effect for tentacle emerging from the ground.
 */
function createTentacleEmergeEffect(scene: THREE.Scene, x: number, z: number): void {
    const emergeGroup = new THREE.Group();
    emergeGroup.position.set(x, 0, z);

    // Create ripple rings expanding outward
    const ringMaterial = new THREE.MeshBasicMaterial({
        color: 0x6b3fa0,
        transparent: true,
        opacity: 0.6,
        side: THREE.DoubleSide
    });

    const rings: THREE.Mesh[] = [];
    for (let i = 0; i < 3; i++) {
        const ringGeom = new THREE.RingGeometry(0.1, 0.2, 16);
        const ring = new THREE.Mesh(ringGeom, ringMaterial.clone());
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.02;
        ring.scale.set(0, 0, 0);
        emergeGroup.add(ring);
        rings.push(ring);
    }

    scene.add(emergeGroup);

    // Animate rings expanding
    const startTime = performance.now();
    const animate = () => {
        const elapsed = performance.now() - startTime;
        const progress = elapsed / TENTACLE_EMERGE_DURATION;

        if (progress >= 1) {
            scene.remove(emergeGroup);
            rings.forEach(r => {
                (r.geometry as THREE.BufferGeometry).dispose();
                (r.material as THREE.Material).dispose();
            });
            return;
        }

        // Stagger ring animations
        rings.forEach((ring, i) => {
            const ringProgress = Math.max(0, (progress - i * 0.2) / 0.6);
            if (ringProgress > 0 && ringProgress < 1) {
                const scale = ringProgress * 1.5;
                ring.scale.set(scale, scale, scale);
                (ring.material as THREE.MeshBasicMaterial).opacity = 0.6 * (1 - ringProgress);
            }
        });

        requestAnimationFrame(animate);
    };
    animate();
}

// =============================================================================
// BABY KRAKEN SUBMERGE BEHAVIOR
// =============================================================================

/**
 * Check if kraken should submerge based on HP thresholds.
 * Called when kraken takes damage.
 */
export function trySubmergeKraken(
    unit: Unit,
    unitsRef: Record<number, UnitGroup>,
    addLog: (text: string, color?: string) => void,
    now: number
): void {
    if (unit.enemyType !== "baby_kraken") return;

    // Already submerged?
    if (submergedKrakens.some(sk => sk.unitId === unit.id)) return;

    const maxHp = ENEMY_STATS.baby_kraken.maxHp;
    const hpPercent = unit.hp / maxHp;

    // Get thresholds this kraken has already used
    const usedThresholds = krakenUsedThresholds.get(unit.id) ?? [];

    // Find the highest threshold we've crossed that hasn't been used
    let triggeredThreshold = -1;
    for (const threshold of KRAKEN_HP_THRESHOLDS) {
        if (hpPercent <= threshold && !usedThresholds.includes(threshold)) {
            triggeredThreshold = threshold;
            break;
        }
    }

    if (triggeredThreshold < 0) return;

    // Mark this threshold as used
    krakenUsedThresholds.set(unit.id, [...usedThresholds, triggeredThreshold]);

    // Start submerge animation
    submergedKrakens.push({
        unitId: unit.id,
        submergeEndTime: now + KRAKEN_SUBMERGE_ANIM_DURATION + KRAKEN_SUBMERGE_DURATION,
        isSubmerging: true,
        isSurfacing: false,
        animationStartTime: now
    });

    addLog("The Kraken Nymph submerges beneath the waves!", "#6b3fa0");
    soundFns.playSplash();
}

/**
 * Check if a kraken is currently submerged (including during animations).
 * Use this for targeting checks - kraken is invulnerable from moment it starts sinking.
 */
export function isKrakenSubmerged(unitId: number): boolean {
    return submergedKrakens.some(sk => sk.unitId === unitId);
}

/**
 * Check if a kraken is fully submerged (not animating).
 * Use this for visibility checks - kraken is visible while animating.
 */
export function isKrakenFullySubmerged(unitId: number): boolean {
    const sk = submergedKrakens.find(s => s.unitId === unitId);
    if (!sk) return false;
    // Fully submerged = not in either animation state
    return !sk.isSubmerging && !sk.isSurfacing;
}

/**
 * Update submerged krakens - handle submerge/surface animations and resurfacing.
 */
export function updateSubmergedKrakens(
    now: number,
    unitsState: Unit[],
    unitsRef: Record<number, UnitGroup>,
    addLog: (text: string, color?: string) => void
): void {
    for (let i = submergedKrakens.length - 1; i >= 0; i--) {
        const sk = submergedKrakens[i];

        // Check if kraken is still alive
        const krakenUnit = unitsState.find(u => u.id === sk.unitId && u.hp > 0);
        if (!krakenUnit) {
            submergedKrakens.splice(i, 1);
            continue;
        }

        const krakenG = unitsRef[sk.unitId];
        if (!krakenG) continue;

        // Find the shadow mesh to keep it on the ground during animation
        const shadow = krakenG.children.find(child =>
            child instanceof THREE.Mesh &&
            (child as THREE.Mesh).geometry instanceof THREE.CircleGeometry
        );

        // Handle submerging animation (sinking below ground)
        if (sk.isSubmerging) {
            const elapsed = now - sk.animationStartTime;
            const progress = Math.min(1, elapsed / KRAKEN_SUBMERGE_ANIM_DURATION);
            // Ease in - accelerate as it sinks
            const easedProgress = progress * progress;
            const newY = KRAKEN_SUBMERGE_DEPTH * easedProgress;
            krakenG.position.y = newY;

            // Keep shadow on ground by offsetting it relative to group position
            if (shadow) {
                shadow.position.y = 0.004 - newY;
            }

            if (progress >= 1) {
                // Submerge animation complete - now fully underwater
                sk.isSubmerging = false;
                krakenG.position.y = KRAKEN_SUBMERGE_DEPTH;
                // Keep shadow visible as underwater silhouette, maintain offset
                if (shadow) {
                    shadow.position.y = 0.004 - KRAKEN_SUBMERGE_DEPTH;
                    // Darken shadow to indicate underwater presence
                    const shadowMesh = shadow as THREE.Mesh;
                    if (shadowMesh.material instanceof THREE.MeshBasicMaterial) {
                        shadowMesh.material.opacity = 0.25;
                    }
                }
            }
            continue;
        }

        // Handle surfacing animation (rising from ground)
        if (sk.isSurfacing) {
            const elapsed = now - sk.animationStartTime;
            const progress = Math.min(1, elapsed / KRAKEN_SUBMERGE_ANIM_DURATION);
            // Ease out - decelerate as it surfaces
            const easedProgress = 1 - Math.pow(1 - progress, 2);
            const newY = KRAKEN_SUBMERGE_DEPTH + (0 - KRAKEN_SUBMERGE_DEPTH) * easedProgress;
            krakenG.position.y = newY;

            // Offset shadow as kraken rises and restore opacity
            if (shadow) {
                shadow.position.y = 0.004 - newY;
                // Gradually restore shadow opacity as it surfaces
                const shadowMesh = shadow as THREE.Mesh;
                if (shadowMesh.material instanceof THREE.MeshBasicMaterial) {
                    shadowMesh.material.opacity = 0.25 + (0.35 * easedProgress);
                }
            }

            if (progress >= 1) {
                // Surface animation complete - fully emerged
                krakenG.position.y = 0;
                if (shadow) {
                    shadow.position.y = 0.004;
                    // Restore full shadow opacity
                    const shadowMesh = shadow as THREE.Mesh;
                    if (shadowMesh.material instanceof THREE.MeshBasicMaterial) {
                        shadowMesh.material.opacity = 0.6;
                    }
                }
                submergedKrakens.splice(i, 1);
            }
            continue;
        }

        // Check if it's time to start surfacing (submerge duration expired)
        if (now >= sk.submergeEndTime) {
            sk.isSurfacing = true;
            sk.animationStartTime = now;
            // Extend end time to include surface animation
            sk.submergeEndTime = now + KRAKEN_SUBMERGE_ANIM_DURATION;
            addLog("The Kraken Nymph resurfaces!", "#6b3fa0");
            soundFns.playSplash();
        }
    }
}
