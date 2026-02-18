// =============================================================================
// BABY KRAKEN TENTACLE BEHAVIOR - Tentacle spawning and management
// =============================================================================

import * as THREE from "three";
import type { Unit, UnitGroup, DamageText } from "../../core/types";
import { ENEMY_STATS } from "../../game/enemyStats";
import { distance } from "../../game/geometry";
import { getNextUnitId } from "../../core/unitIds";
import { soundFns } from "../../audio";
import { setSkillCooldown } from "../../combat/combatMath";
import { COLORS, TENTACLE_EMERGE_DURATION, TENTACLE_START_Y, MAX_LIFETIME_TENTACLES, TENTACLE_SPAWN_BUFFER } from "../../core/constants";
import { getGameTime } from "../../core/gameClock";
import { applyDamageToUnit, type DamageContext } from "../../combat/damageEffects";
import type { TentacleContext } from "./types";

// =============================================================================
// STATE
// =============================================================================

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

// Track lifetime tentacles spawned per kraken
const krakenLifetimeTentacles: Map<number, number> = new Map();

// =============================================================================
// TENTACLE SPAWNING
// =============================================================================

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
        return distance(playerG.position.x, playerG.position.z, g.position.x, g.position.z) <= enemyStats.aggroRange;
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
    const dist = Math.hypot(dx, dz);
    const dirX = dx / dist;
    const dirZ = dz / dist;

    // Spawn tentacle at a distance toward the target (but not right on them)
    const spawnDist = Math.min(tentacleSkill.spawnRange, dist - TENTACLE_SPAWN_BUFFER);
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

    setSkillCooldown(setSkillCooldowns, spawnKey, tentacleSkill.cooldown, now, unit);

    return true;
}

// =============================================================================
// TENTACLE UPDATE
// =============================================================================

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

// =============================================================================
// TENTACLE DEATH HANDLING
// =============================================================================

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

    applyDamageToUnit(dmgCtx, parentKraken.id, krakenG, damage, krakenStats.name, {
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

// =============================================================================
// CLEANUP
// =============================================================================

/**
 * Clear all active tentacles (for game restart).
 */
export function clearTentacles(): void {
    activeTentacles.length = 0;
    krakenLifetimeTentacles.clear();
}

// =============================================================================
// VISUAL EFFECTS
// =============================================================================

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
    const startTime = getGameTime();
    const animate = () => {
        const elapsed = getGameTime() - startTime;
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
