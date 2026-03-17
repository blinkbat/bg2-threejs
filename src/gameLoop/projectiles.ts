// =============================================================================
// PROJECTILE UPDATES - AOE, basic, magic missile, trap projectiles
// =============================================================================

import * as THREE from "three";
import type { Unit, UnitGroup, DamageText, Projectile, EnemyStats, MagicMissileProjectile, TrapProjectile, FireballProjectile, PiercingProjectile, StatusEffect, DamageType, UnitData, SkillOnHitEffect } from "../core/types";
import { HIT_DETECTION_RADIUS, COLORS, BUFF_TICK_INTERVAL, SUN_STANCE_BONUS_DAMAGE, GLACIAL_WHORL_HIT_RADIUS } from "../core/constants";
import { getUnitStats, isEnemyData } from "../game/units";
import { calculateDamageWithCrit, calculateDamageWithOptionalCritChance, getDirectionAndDistance, rollSkillHit, rollDamage, shouldApplyPoison, getEffectiveArmor, logHit, logLifestealHit, logMiss, logPoisoned, logAoeHit, logAoeMiss, getDamageColor, logTrapTriggered, calculateStatBonus, applyStatusEffect, checkEnemyDefenses, hasStatusEffect, rollChance, applyChilled, logStunned, logWeakened, logHamstrung } from "../combat/combatMath";
import { accumulateDelta } from "../core/gameClock";
import { isBlocked } from "../ai/pathfinding";
import { isTreeBlocked } from "../game/areas";
import { ENEMY_STATS } from "../game/enemyStats";
import { applyDamageToUnit, animateExpandingMesh, buildDamageContext, applyLifesteal, createAnimatedRing } from "../combat/damageEffects";
import { soundFns } from "../audio";
import { getUnitById } from "../game/unitQuery";
import { getUnitRadius, isInRange } from "../rendering/range";

// =============================================================================
// DAMAGE TYPE HELPERS
// =============================================================================

/** Get the damage type for a unit's basic attack. */
function getBasicAttackDamageType(unit: Unit, unitData: UnitData | EnemyStats): DamageType {
    if (unit.team === "player" && "class" in unitData) {
        if (unitData.basicDamageType) return unitData.basicDamageType;
        if (unitData.class === "Wizard") return "chaos";
        if (unitData.class === "Cleric") return "holy";
    }
    return "physical";
}

function isCombatUnit(unit: Unit): unit is Unit & { team: "player" | "enemy" } {
    return unit.team === "player" || unit.team === "enemy";
}

type CombatUnit = Unit & { team: "player" | "enemy" };

// Reuse frame-local scratch buffers to avoid per-frame allocations.
const aliveUnitsScratch: CombatUnit[] = [];
const alivePlayersScratch: CombatUnit[] = [];
const aliveEnemiesScratch: CombatUnit[] = [];

interface ProjectileBucketEntry {
    unit: CombatUnit;
    group: UnitGroup;
}

const PROJECTILE_BUCKET_CELL_SIZE = 2;
const PROJECTILE_BUCKET_KEY_STRIDE = 1024;
const projectileBuckets = new Map<number, ProjectileBucketEntry[]>();

function getProjectileBucketCell(coord: number): number {
    return Math.floor(coord / PROJECTILE_BUCKET_CELL_SIZE);
}

function getProjectileBucketKey(cellX: number, cellZ: number): number {
    return cellX * PROJECTILE_BUCKET_KEY_STRIDE + cellZ;
}

function buildProjectileBuckets(
    aliveUnits: CombatUnit[],
    unitsRef: Record<number, UnitGroup>
): void {
    projectileBuckets.clear();
    for (const unit of aliveUnits) {
        const group = unitsRef[unit.id];
        if (!group) continue;
        const cellX = getProjectileBucketCell(group.position.x);
        const cellZ = getProjectileBucketCell(group.position.z);
        const key = getProjectileBucketKey(cellX, cellZ);
        const bucket = projectileBuckets.get(key);
        const entry: ProjectileBucketEntry = { unit, group };
        if (bucket) {
            bucket.push(entry);
        } else {
            projectileBuckets.set(key, [entry]);
        }
    }
}

function forEachProjectileCandidatesNear(
    x: number,
    z: number,
    radius: number,
    targetTeam: "player" | "enemy" | "both",
    visit: (unit: CombatUnit, group: UnitGroup) => void
): void {
    const centerCellX = getProjectileBucketCell(x);
    const centerCellZ = getProjectileBucketCell(z);
    const cellRadius = Math.max(1, Math.ceil(radius / PROJECTILE_BUCKET_CELL_SIZE));

    for (let dx = -cellRadius; dx <= cellRadius; dx++) {
        for (let dz = -cellRadius; dz <= cellRadius; dz++) {
            const bucket = projectileBuckets.get(getProjectileBucketKey(centerCellX + dx, centerCellZ + dz));
            if (!bucket) continue;
            for (const entry of bucket) {
                if (targetTeam !== "both" && entry.unit.team !== targetTeam) continue;
                visit(entry.unit, entry.group);
            }
        }
    }
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
const VOLLEY_TIMEOUT_MS = 30_000;
const ARMED_TRAP_TIMEOUT_MS = 30_000;

/** Remove stale volley entries that were never fully resolved (e.g., caster died mid-volley). */
export function pruneStaleVolleys(now: number): void {
    for (const [id] of magicWaveVolleys) {
        if (now - id > VOLLEY_TIMEOUT_MS) {
            magicWaveVolleys.delete(id);
        }
    }
}

/** Clear all projectile module-level state (for area transitions). */
export function resetProjectileState(): void {
    projectileBuckets.clear();
    magicWaveVolleys.clear();
}

function getOrCreateMagicWaveVolley(
    volleyId: number,
    totalMissiles: number,
    attackerName: string
): VolleyStats {
    const existing = magicWaveVolleys.get(volleyId);
    if (existing) return existing;

    const next: VolleyStats = {
        hits: 0,
        totalDamage: 0,
        missilesResolved: 0,
        totalMissiles,
        attackerName
    };
    magicWaveVolleys.set(volleyId, next);
    return next;
}

function resolveMagicWaveMissile(
    mmProj: MagicMissileProjectile,
    attackerName: string,
    damageDealt: number,
    addLog: (text: string, color?: string) => void
): void {
    const volley = getOrCreateMagicWaveVolley(mmProj.volleyId, mmProj.totalMissiles, attackerName);
    volley.missilesResolved++;
    if (damageDealt > 0) {
        volley.hits++;
        volley.totalDamage += damageDealt;
    }

    if (volley.missilesResolved >= volley.totalMissiles) {
        if (volley.hits > 0) {
            addLog(logAoeHit(volley.attackerName, "Magic Wave", volley.hits, volley.totalDamage), "#9966ff");
        } else {
            addLog(logAoeMiss(volley.attackerName, "Magic Wave"), COLORS.logNeutral);
        }
        magicWaveVolleys.delete(mmProj.volleyId);
    }
}

/**
 * Match piercing hit radius to the projectile's widest horizontal visual axis.
 */
function getPiercingHitRadius(proj: PiercingProjectile): number {
    const geometryParams = Reflect.get(proj.mesh.geometry, "parameters");
    const baseRadius = geometryParams && typeof geometryParams === "object"
        ? Reflect.get(geometryParams, "radius")
        : undefined;
    if (typeof baseRadius !== "number") {
        return GLACIAL_WHORL_HIT_RADIUS;
    }

    const horizontalScale = Math.max(
        Math.abs(proj.baseScaleX ?? proj.mesh.scale.x),
        Math.abs(proj.baseScaleZ ?? proj.mesh.scale.z)
    );
    return baseRadius * horizontalScale;
}

// =============================================================================
// PROJECTILE DISPOSAL
// =============================================================================

function disposeProjectile(scene: THREE.Scene, proj: Projectile): void {
    scene.remove(proj.mesh);
    proj.mesh.traverse((object: THREE.Object3D) => {
        if (!(object instanceof THREE.Mesh)) return;

        if (object.userData.sharedGeometry !== true) {
            object.geometry.dispose();
        }

        const material = object.material;
        if (Array.isArray(material)) {
            for (const mat of material) {
                mat.dispose();
            }
        } else {
            material.dispose();
        }
    });
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

function getVisualPhase(mesh: THREE.Mesh): number {
    const raw = Reflect.get(mesh.userData, "visualPhase");
    return typeof raw === "number" ? raw : 0;
}

function setVisualPhase(mesh: THREE.Mesh, phase: number): void {
    mesh.userData.visualPhase = phase;
}

function getProjectileVisualType(mesh: THREE.Mesh): "aoe" | "ranged" | "enemy" | null {
    const raw = Reflect.get(mesh.userData, "projectileVisualType");
    if (raw === "aoe" || raw === "ranged" || raw === "enemy") {
        return raw;
    }
    return null;
}

function updateSharedProjectileVisual(mesh: THREE.Mesh): void {
    const visualType = getProjectileVisualType(mesh);
    if (!visualType) return;

    const nextPhase = getVisualPhase(mesh) + (visualType === "aoe" ? 0.22 : 0.16);
    setVisualPhase(mesh, nextPhase);

    const pulse = visualType === "aoe"
        ? 1 + Math.sin(nextPhase) * 0.09
        : 1 + Math.sin(nextPhase) * 0.05;
    mesh.scale.set(pulse, pulse, pulse);
    mesh.rotation.y += visualType === "aoe" ? 0.11 : 0.08;
    mesh.rotation.x += visualType === "enemy" ? 0.07 : 0.03;

    const mat = mesh.material;
    if (mat instanceof THREE.MeshPhongMaterial) {
        const base = visualType === "aoe" ? 0.46 : 0.24;
        const amp = visualType === "aoe" ? 0.3 : 0.18;
        mat.emissiveIntensity = base + Math.max(0, Math.sin(nextPhase * 1.7)) * amp;
    }
}

function updateMagicMissileVisual(mesh: THREE.Mesh, missileIndex: number): void {
    const nextPhase = getVisualPhase(mesh) + 0.2;
    setVisualPhase(mesh, nextPhase);

    const pulse = 1 + Math.sin(nextPhase + missileIndex * 0.25) * 0.11;
    mesh.scale.set(pulse, pulse, pulse);
    mesh.rotation.x += 0.16;
    mesh.rotation.y += 0.24;
    mesh.rotation.z += 0.11;

    const mat = mesh.material;
    if (mat instanceof THREE.MeshPhongMaterial) {
        mat.emissiveIntensity = 0.4 + Math.max(0, Math.sin(nextPhase * 1.9)) * 0.35;
    }
}

function updateFireballVisual(mesh: THREE.Mesh): void {
    const nextPhase = getVisualPhase(mesh) + 0.18;
    setVisualPhase(mesh, nextPhase);

    const pulse = 1 + Math.sin(nextPhase) * 0.08;
    mesh.scale.set(pulse, pulse, pulse);

    const mat = mesh.material;
    if (mat instanceof THREE.MeshPhongMaterial) {
        mat.emissiveIntensity = 0.52 + Math.max(0, Math.sin(nextPhase * 1.6)) * 0.36;
    }

    const innerGlow = mesh.children[0];
    if (innerGlow instanceof THREE.Mesh) {
        const glowPulse = 0.9 + Math.max(0, Math.sin(nextPhase * 2.1)) * 0.35;
        innerGlow.scale.set(glowPulse, glowPulse, glowPulse);
        const glowMat = innerGlow.material;
        if (glowMat instanceof THREE.MeshBasicMaterial) {
            glowMat.opacity = 0.45 + Math.max(0, Math.sin(nextPhase * 2.4)) * 0.35;
        }
    }
}

function updateArmedTrapVisual(mesh: THREE.Mesh): void {
    const nextPhase = getVisualPhase(mesh) + 0.11;
    setVisualPhase(mesh, nextPhase);

    const pulse = 1 + Math.sin(nextPhase) * 0.07;
    mesh.scale.set(pulse, pulse, pulse);
    mesh.rotation.y += 0.04;

    const mat = mesh.material;
    if (mat instanceof THREE.MeshPhongMaterial) {
        mat.emissiveIntensity = 0.3 + Math.max(0, Math.sin(nextPhase * 2.0)) * 0.22;
    }
}

function updatePiercingVisualEffects(
    scene: THREE.Scene,
    proj: PiercingProjectile,
    now: number
): void {
    const baseScaleX = Math.abs(proj.baseScaleX ?? proj.mesh.scale.x);
    const baseScaleY = Math.abs(proj.baseScaleY ?? proj.mesh.scale.y);
    const baseScaleZ = Math.abs(proj.baseScaleZ ?? proj.mesh.scale.z);

    const phase = (proj.visualPhase ?? 0) + 0.18;
    proj.visualPhase = phase;

    const pulseA = 1 + Math.sin(phase) * 0.08;
    const pulseB = 1 + Math.cos(phase * 1.35) * 0.06;
    const pulseC = 1 + Math.sin(phase + 1.2) * 0.05;
    proj.mesh.scale.set(baseScaleX * pulseA, baseScaleY * pulseB, baseScaleZ * pulseC);

    const spin = proj.spinSpeed ?? 0.08;
    proj.mesh.rotation.x += spin;
    proj.mesh.rotation.y += spin * 0.3;
    proj.mesh.rotation.z += spin * 0.45;

    const mat = proj.mesh.material;
    if (mat instanceof THREE.MeshPhongMaterial) {
        mat.emissiveIntensity = 0.42 + Math.max(0, Math.sin(phase * 1.6)) * 0.32;
    }

    const trailIntervalMs = proj.trailIntervalMs ?? 120;
    const nextTrailAt = proj.nextTrailAt ?? now;
    if (now >= nextTrailAt) {
        createAnimatedRing(scene, proj.mesh.position.x, proj.mesh.position.z, COLORS.chilledText, {
            innerRadius: 0.05,
            outerRadius: 0.14,
            maxScale: 0.95,
            duration: 170,
            initialOpacity: 0.42,
            y: 0.08
        });
        proj.nextTrailAt = now + trailIntervalMs;
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

function applySkillProjectileOnHitEffect(
    effect: SkillOnHitEffect,
    targetId: number,
    targetName: string,
    targetX: number,
    targetZ: number,
    attackerId: number,
    now: number,
    scene: THREE.Scene,
    queueUnitMutation: (unitId: number, mutation: (unit: Unit) => Unit) => void,
    addLog: (text: string, color?: string) => void
): void {
    const statusType = effect.type === "stun"
        ? "stunned"
        : effect.type === "attack_down"
            ? "weakened"
            : "hamstrung";
    const effectVisual = effect.type === "stun"
        ? { logText: logStunned(targetName), color: COLORS.stunnedText, maxScale: 1.25, duration: 240 }
        : effect.type === "attack_down"
            ? { logText: logWeakened(targetName), color: COLORS.weakenedText, maxScale: 1.2, duration: 220 }
            : { logText: logHamstrung(targetName), color: COLORS.hamstrungText, maxScale: 1.2, duration: 220 };

    const statusEffect: StatusEffect = {
        type: statusType,
        duration: effect.duration,
        tickInterval: BUFF_TICK_INTERVAL,
        timeSinceTick: 0,
        lastUpdateTime: now,
        damagePerTick: 0,
        sourceId: attackerId
    };

    queueUnitMutation(targetId, unit => {
        if (unit.hp <= 0) return unit;
        return { ...unit, statusEffects: applyStatusEffect(unit.statusEffects, statusEffect) };
    });

    addLog(effectVisual.logText, effectVisual.color);
    createAnimatedRing(scene, targetX, targetZ, effectVisual.color, {
        innerRadius: 0.16,
        outerRadius: 0.34,
        maxScale: effectVisual.maxScale,
        duration: effectVisual.duration
    });
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
    aliveUnitsScratch.length = 0;
    alivePlayersScratch.length = 0;
    aliveEnemiesScratch.length = 0;
    const aliveUnits = aliveUnitsScratch;
    const alivePlayers = alivePlayersScratch;
    const aliveEnemies = aliveEnemiesScratch;
    for (const unit of unitsState) {
        if (unit.hp <= 0 || defeatedThisFrame.has(unit.id)) continue;
        if (!isCombatUnit(unit)) continue;
        aliveUnits.push(unit);
        if (unit.team === "enemy") {
            aliveEnemies.push(unit);
        } else {
            alivePlayers.push(unit);
        }
    }
    buildProjectileBuckets(aliveUnits, unitsRef);
    const pendingUnitMutations = new Map<number, (unit: Unit) => Unit>();
    const queueUnitMutation = (unitId: number, mutation: (unit: Unit) => Unit): void => {
        const existing = pendingUnitMutations.get(unitId);
        if (!existing) {
            pendingUnitMutations.set(unitId, mutation);
            return;
        }
        pendingUnitMutations.set(unitId, unit => mutation(existing(unit)));
    };

    const explodeAoeProjectile = (proj: Projectile & { type: "aoe" }, explodeX: number, explodeZ: number): void => {
        const attackerUnit = getUnitById(proj.attackerId);
        const attackerData = attackerUnit ? getUnitStats(attackerUnit) : null;
        const { aoeRadius, damage } = proj;
        const statBonus = proj.statBonus ?? calculateStatBonus(attackerUnit, proj.damageType);

        const explosion = new THREE.Mesh(
            new THREE.RingGeometry(0.1, aoeRadius, 32),
            new THREE.MeshBasicMaterial({ color: "#ff4400", transparent: true, opacity: 0.6, side: THREE.DoubleSide })
        );
        explosion.rotation.x = -Math.PI / 2;
        explosion.position.set(explodeX, 0.1, explodeZ);
        scene.add(explosion);
        animateExpandingMesh(scene, explosion, { duration: 400, initialOpacity: 0.6, maxScale: aoeRadius * 1.2, baseRadius: aoeRadius });
        soundFns.playExplosion();

        let hitCount = 0;
        let totalDamage = 0;
        forEachProjectileCandidatesNear(explodeX, explodeZ, aoeRadius, "both", (target, tg) => {
            if (defeatedThisFrame.has(target.id)) return;
            const targetRadius = getUnitRadius(target);
            if (!isInRange(explodeX, explodeZ, tg.position.x, tg.position.z, targetRadius, aoeRadius)) return;

            const targetData = getUnitStats(target);
            const { damage: dmg } = calculateDamageWithCrit(
                damage[0] + statBonus,
                damage[1] + statBonus,
                getEffectiveArmor(target, targetData.armor),
                proj.damageType,
                attackerUnit
            );

            applyDamageToUnit(dmgCtx, target.id, tg, dmg, targetData.name, {
                color: getDamageColor(target.team, true),
                attackerName: attackerUnit?.team === "player" ? attackerData?.name : undefined,
                targetUnit: target,
                damageType: proj.damageType
            });
            hitCount++;
            totalDamage += dmg;

            if (attackerUnit?.team === "player") {
                aggroOnHit(target, proj.attackerId, unitsRef);
            }
        });

        if (hitCount > 0) {
            soundFns.playHit();
            addLog(logAoeHit(attackerData?.name ?? "Unknown", "Fireball", hitCount, totalDamage), COLORS.damageNeutral);
        }
    };

    const processProjectile = (proj: Projectile): boolean => {
        // AOE projectile (like Fireball)
        if (proj.type === "aoe") {
            const { targetPos } = proj;
            const { dx, dz, dist } = getDirectionAndDistance(proj.mesh.position.x, proj.mesh.position.z, targetPos.x, targetPos.z);
            updateSharedProjectileVisual(proj.mesh);

            // Reached target - explode
            if (dist < HIT_DETECTION_RADIUS) {
                explodeAoeProjectile(proj, targetPos.x, targetPos.z);
                disposeProjectile(scene, proj);
                return false;
            }

            // Move projectile (dx/dz already normalized by getDirectionAndDistance)
            const nextX = proj.mesh.position.x + dx * proj.speed;
            const nextZ = proj.mesh.position.z + dz * proj.speed;
            const nextCellX = Math.floor(nextX);
            const nextCellZ = Math.floor(nextZ);
            if (isBlocked(nextCellX, nextCellZ) || isTreeBlocked(nextCellX, nextCellZ)) {
                explodeAoeProjectile(proj, nextX, nextZ);
                disposeProjectile(scene, proj);
                return false;
            }
            proj.mesh.position.x = nextX;
            proj.mesh.position.z = nextZ;

            return true;
        }

        // Magic Wave projectile - forward-traveling wave lane
        if (proj.type === "magic_missile") {
            const mmProj = proj as MagicMissileProjectile;
            const attackerUnit = getUnitById(mmProj.attackerId);
            updateMagicMissileVisual(proj.mesh, mmProj.missileIndex);
            const attackerName = attackerUnit ? getUnitStats(attackerUnit).name : (mmProj.attackerName ?? "Unknown");
            const attackerG = unitsRef[mmProj.attackerId];
            const statBonus = mmProj.statBonus ?? calculateStatBonus(attackerUnit, mmProj.damageType);

            if (!attackerUnit || !attackerG) {
                resolveMagicWaveMissile(mmProj, attackerName, 0, addLog);
                disposeProjectile(scene, proj);
                return false;
            }

            // Move forward as a stable lane with a slight wave oscillation.
            const travelDistBefore = Math.hypot(
                proj.mesh.position.x - mmProj.startX,
                proj.mesh.position.z - mmProj.startZ
            );
            const desiredLaneX = mmProj.startX + mmProj.waveDirX * travelDistBefore + mmProj.wavePerpX * mmProj.waveLaneOffset;
            const desiredLaneZ = mmProj.startZ + mmProj.waveDirZ * travelDistBefore + mmProj.wavePerpZ * mmProj.waveLaneOffset;
            const laneCorrectionX = (desiredLaneX - proj.mesh.position.x) * 0.18;
            const laneCorrectionZ = (desiredLaneZ - proj.mesh.position.z) * 0.18;
            const waveTime = now * 0.007 + mmProj.zigzagPhase * Math.PI;
            const waveOffset = Math.sin(waveTime * 3.4 + mmProj.missileIndex * 0.4) * (0.2 + Math.abs(mmProj.fanAngle) * 0.08);

            proj.mesh.position.x += mmProj.waveDirX * mmProj.speed + laneCorrectionX + mmProj.wavePerpX * waveOffset * 0.16;
            proj.mesh.position.z += mmProj.waveDirZ * mmProj.speed + laneCorrectionZ + mmProj.wavePerpZ * waveOffset * 0.16;

            const travelDistAfter = Math.hypot(
                proj.mesh.position.x - mmProj.startX,
                proj.mesh.position.z - mmProj.startZ
            );
            if (travelDistAfter >= mmProj.waveMaxDistance) {
                spawnProjectileImpact(scene, proj.mesh.position.x, proj.mesh.position.z, COLORS.logNeutral, 0.9, 140);
                resolveMagicWaveMissile(mmProj, attackerName, 0, addLog);
                disposeProjectile(scene, proj);
                return false;
            }

            let damageDealt = 0;
            let shieldBlocked = false;
            const hitRange = HIT_DETECTION_RADIUS + 0.18;

            for (const targetUnit of aliveEnemies) {
                if (mmProj.hitUnits.has(targetUnit.id)) continue;
                if (defeatedThisFrame.has(targetUnit.id)) continue;

                const targetG = unitsRef[targetUnit.id];
                if (!targetG) continue;
                const targetRadius = getUnitRadius(targetUnit);
                if (!isInRange(
                    proj.mesh.position.x,
                    proj.mesh.position.z,
                    targetG.position.x,
                    targetG.position.z,
                    targetRadius,
                    hitRange
                )) continue;

                mmProj.hitUnits.add(targetUnit.id);

                // Check for front-shield block (magic missiles have partial block chance)
                if (attackerUnit.team === "player" && targetUnit.enemyType) {
                    const enemyStats = ENEMY_STATS[targetUnit.enemyType];
                    if (
                        checkEnemyDefenses(
                            enemyStats,
                            targetUnit.facing,
                            proj.mesh.position.x,
                            proj.mesh.position.z,
                            targetG.position.x,
                            targetG.position.z,
                            undefined,
                            0.5
                        ) === "frontShield"
                    ) {
                        soundFns.playBlock();
                        shieldBlocked = true;
                        spawnProjectileImpact(scene, targetG.position.x, targetG.position.z, "#4488ff", 1.05, 170);
                    }
                }

                if (!shieldBlocked) {
                    const targetData = getUnitStats(targetUnit);
                    const result = calculateDamageWithCrit(
                        mmProj.damage[0] + statBonus,
                        mmProj.damage[1] + statBonus,
                        getEffectiveArmor(targetUnit, targetData.armor),
                        mmProj.damageType,
                        attackerUnit
                    );
                    damageDealt = result.damage;

                    applyDamageToUnit(dmgCtx, targetUnit.id, targetG, damageDealt, targetData.name, {
                        color: "#9966ff",
                        attackerName: attackerUnit.team === "player" ? attackerName : undefined,
                        targetUnit,
                        attackerPosition: { x: attackerG.position.x, z: attackerG.position.z },
                        damageType: mmProj.damageType
                    });
                    spawnProjectileImpact(scene, targetG.position.x, targetG.position.z, "#9966ff", 1.2, 180);
                    soundFns.playHit();
                    aggroOnHit(targetUnit, mmProj.attackerId, unitsRef);
                }

                break;
            }

            if (damageDealt > 0 || shieldBlocked) {
                resolveMagicWaveMissile(mmProj, attackerName, damageDealt, addLog);
                disposeProjectile(scene, proj);
                return false;
            }

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
                    trapProj.armedAt = now;
                    proj.mesh.position.y = 0.15;  // Settle on ground
                    proj.mesh.rotation.x = 0;
                    proj.mesh.rotation.z = 0;
                    // Change color to indicate armed trap
                    const trapMat = proj.mesh.material;
                    if (trapMat instanceof THREE.MeshBasicMaterial || trapMat instanceof THREE.MeshPhongMaterial) {
                        trapMat.color.set("#cc4444");
                        if (trapMat instanceof THREE.MeshPhongMaterial) {
                            trapMat.emissive.set("#4a0a0a");
                            trapMat.emissiveIntensity = 0.36;
                        }
                    }
                }
                return true;
            }

            updateArmedTrapVisual(proj.mesh);

            // Remove trap if it has been armed too long without triggering
            if (trapProj.armedAt !== undefined && now - trapProj.armedAt > ARMED_TRAP_TIMEOUT_MS) {
                disposeProjectile(scene, proj);
                return false;
            }

            // Trap is on the ground - check for enemy triggers
            const trapCaster = getUnitById(trapProj.attackerId);
            const trapCasterGroup = unitsRef[trapProj.attackerId];
            const trapCasterName = trapCaster ? getUnitStats(trapCaster).name : undefined;

            let triggered = false;
            forEachProjectileCandidatesNear(
                trapProj.targetPos.x,
                trapProj.targetPos.z,
                trapProj.aoeRadius,
                "enemy",
                (enemy, enemyG) => {
                    if (triggered) return;
                    if (defeatedThisFrame.has(enemy.id)) return;
                    const enemyRadius = getUnitRadius(enemy);
                    if (isInRange(
                        trapProj.targetPos.x,
                        trapProj.targetPos.z,
                        enemyG.position.x,
                        enemyG.position.z,
                        enemyRadius,
                        trapProj.aoeRadius
                    )) {
                        triggered = true;
                    }
                }
            );
            if (triggered) {
                // Trap triggered! Apply pinned effect and damage to all enemies in radius
                let pinnedCount = 0;
                let totalDamage = 0;
                const pinnedTargetIds: number[] = [];

                forEachProjectileCandidatesNear(
                    trapProj.targetPos.x,
                    trapProj.targetPos.z,
                    trapProj.aoeRadius,
                    "enemy",
                    (target, targetG) => {
                        if (defeatedThisFrame.has(target.id)) return;
                        const targetRadius = getUnitRadius(target);
                        if (!isInRange(
                            trapProj.targetPos.x,
                            trapProj.targetPos.z,
                            targetG.position.x,
                            targetG.position.z,
                            targetRadius,
                            trapProj.aoeRadius
                        )) return;
                        // Calculate damage if trap has damage
                        let damage = 0;
                        if (trapProj.trapDamage) {
                            damage = rollDamage(trapProj.trapDamage[0], trapProj.trapDamage[1]);
                            totalDamage += damage;
                            const targetData = getUnitStats(target);
                            applyDamageToUnit(dmgCtx, target.id, targetG, damage, targetData.name, {
                                color: COLORS.pinnedText,
                                targetUnit: target,
                                attackerName: trapCaster?.team === "player" ? trapCasterName : undefined,
                                attackerPosition: trapCasterGroup ? { x: trapCasterGroup.position.x, z: trapCasterGroup.position.z } : undefined,
                                damageType: "physical",
                                attackerId: trapProj.attackerId
                            });
                        }

                        pinnedTargetIds.push(target.id);
                        pinnedCount++;
                    }
                );

                if (pinnedTargetIds.length > 0) {
                    const pinnedEffect: StatusEffect = {
                        type: "pinned",
                        duration: trapProj.pinnedDuration,
                        tickInterval: BUFF_TICK_INTERVAL,
                        timeSinceTick: 0,
                        lastUpdateTime: now,
                        damagePerTick: 0,
                        sourceId: trapProj.attackerId
                    };

                    for (const pinnedTargetId of pinnedTargetIds) {
                        queueUnitMutation(pinnedTargetId, unit => {
                            if (unit.hp <= 0) return unit;
                            return { ...unit, statusEffects: applyStatusEffect(unit.statusEffects, pinnedEffect) };
                        });
                    }
                }

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
            updatePiercingVisualEffects(scene, pProj, now);

            // Wall collision — ice burst + dispose
            const cellX = Math.floor(proj.mesh.position.x);
            const cellZ = Math.floor(proj.mesh.position.z);
            if (isBlocked(cellX, cellZ)) {
                const burst = new THREE.Mesh(
                    new THREE.SphereGeometry(0.3, 12, 8),
                    new THREE.MeshBasicMaterial({
                        color: COLORS.chilled,
                        transparent: true,
                        opacity: 0.82,
                        blending: THREE.AdditiveBlending,
                        depthWrite: false
                    })
                );
                burst.position.copy(proj.mesh.position);
                scene.add(burst);
                animateExpandingMesh(scene, burst, { duration: 250, initialOpacity: 0.8, maxScale: 1.2, baseRadius: 0.3 });
                createAnimatedRing(scene, proj.mesh.position.x, proj.mesh.position.z, COLORS.chilledText, {
                    innerRadius: 0.12,
                    outerRadius: 0.26,
                    maxScale: 1.6,
                    duration: 230,
                    initialOpacity: 0.7,
                    y: 0.12
                });
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
            const chilledTargets = new Set<number>();
            const attackerName = attackerUnit ? getUnitStats(attackerUnit).name : undefined;
            const statBonus = pProj.statBonus ?? calculateStatBonus(attackerUnit, pProj.damageType);
            forEachProjectileCandidatesNear(
                proj.mesh.position.x,
                proj.mesh.position.z,
                piercingHitRadius,
                targetTeam,
                (target, targetG) => {
                    if (pProj.hitUnits.has(target.id)) return;
                    if (defeatedThisFrame.has(target.id)) return;
                    const targetRadius = getUnitRadius(target);
                    if (isInRange(
                        proj.mesh.position.x,
                        proj.mesh.position.z,
                        targetG.position.x,
                        targetG.position.z,
                        targetRadius,
                        piercingHitRadius
                    )) {
                        pProj.hitUnits.add(target.id);

                        const targetData = getUnitStats(target);
                        const { damage: dmg } = calculateDamageWithCrit(
                            pProj.damage[0] + statBonus, pProj.damage[1] + statBonus,
                            getEffectiveArmor(target, targetData.armor),
                            pProj.damageType, attackerUnit
                        );

                        applyDamageToUnit(dmgCtx, target.id, targetG, dmg, targetData.name, {
                            color: COLORS.dmgCold,
                            attackerName,
                            targetUnit: target,
                            damageType: pProj.damageType
                        });
                        spawnProjectileImpact(scene, targetG.position.x, targetG.position.z, COLORS.dmgCold, 1.15, 180);
                        createAnimatedRing(scene, targetG.position.x, targetG.position.z, COLORS.chilledText, {
                            innerRadius: 0.08,
                            outerRadius: 0.2,
                            maxScale: 1.1,
                            duration: 160,
                            initialOpacity: 0.55,
                            y: 0.1
                        });

                        // Roll for chill
                        if (rollChance(pProj.chillChance)) {
                            chilledTargets.add(target.id);
                        }

                        soundFns.playHit();
                        aggroOnHit(target, pProj.attackerId, unitsRef);
                    }
                }
            );

            if (chilledTargets.size > 0) {
                for (const chilledTargetId of chilledTargets) {
                    queueUnitMutation(chilledTargetId, unit => {
                        if (unit.hp <= 0) return unit;
                        return applyChilled(unit, pProj.attackerId, now);
                    });
                }
            }

            return true;
        }

        // Fireball projectile - slow-moving, hurts everything it touches, expires on wall or distance
        if (proj.type === "fireball") {
            const fbProj = proj as FireballProjectile;
            const attackerUnit = getUnitById(fbProj.attackerId);
            const attackerData = attackerUnit ? getUnitStats(attackerUnit) : null;
            updateFireballVisual(proj.mesh);

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
            forEachProjectileCandidatesNear(
                proj.mesh.position.x,
                proj.mesh.position.z,
                0.6,
                "both",
                (target, targetG) => {
                    if (target.id === fbProj.attackerId) return;  // Don't hurt self
                    if (defeatedThisFrame.has(target.id)) return;
                    if (fbProj.hitUnits.has(target.id)) return;  // Already hit this unit
                    const targetRadius = getUnitRadius(target);
                    // Hit radius - slightly larger than normal for easier hits
                    if (isInRange(
                        proj.mesh.position.x,
                        proj.mesh.position.z,
                        targetG.position.x,
                        targetG.position.z,
                        targetRadius,
                        0.6
                    )) {
                        // Mark as hit so we don't hit again
                        fbProj.hitUnits.add(target.id);

                        const targetData = getUnitStats(target);

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
            );

            // Rotate the fireball for visual effect
            proj.mesh.rotation.x += 0.1;
            proj.mesh.rotation.y += 0.15;

            return true;
        }

        // Regular projectile (single target) - validate target exists
        if (proj.type !== "basic") return true;
        updateSharedProjectileVisual(proj.mesh);
        const targetUnit = getUnitById(proj.targetId);
        const targetG = unitsRef[proj.targetId];
        const attackerUnit = getUnitById(proj.attackerId);

        // Guard clause: dispose if target invalid
        if (!targetUnit || !targetG || targetUnit.hp <= 0 || defeatedThisFrame.has(proj.targetId) || !attackerUnit) {
            disposeProjectile(scene, proj);
            return false;
        }

        const { dx, dz } = getDirectionAndDistance(proj.mesh.position.x, proj.mesh.position.z, targetG.position.x, targetG.position.z);
        const targetRadius = getUnitRadius(targetUnit);

        if (isInRange(
            proj.mesh.position.x,
            proj.mesh.position.z,
            targetG.position.x,
            targetG.position.z,
            targetRadius,
            HIT_DETECTION_RADIUS
        )) {
            if (targetUnit.team === "neutral") {
                disposeProjectile(scene, proj);
                return false;
            }

            const attackerData = getUnitStats(attackerUnit);
            const targetData = getUnitStats(targetUnit);
            const logColor = getDamageColor(targetUnit.team);
            const attackerG = unitsRef[attackerUnit.id];
            const skillName = proj.skillName ?? "Attack";
            const isSkillShot = proj.skillName !== undefined
                && proj.skillDamage !== undefined
                && proj.skillDamageType !== undefined;
            const incomingDamageType: DamageType = isSkillShot
                ? (proj.skillDamageType ?? "physical")
                : getBasicAttackDamageType(attackerUnit, attackerData);

            // Aggro enemies targeted by player projectiles (even on miss - arrow flew by their head!)
            if (attackerUnit.team === "player") {
                aggroOnHit(targetUnit, proj.attackerId, unitsRef);
            }

            // Check for enemy defensive abilities (player attacking shielded enemy)
            if (attackerUnit.team === "player" && targetUnit.enemyType) {
                const enemyStats = ENEMY_STATS[targetUnit.enemyType];
                const defense = checkEnemyDefenses(
                    enemyStats,
                    targetUnit.facing,
                    proj.mesh.position.x,
                    proj.mesh.position.z,
                    targetG.position.x,
                    targetG.position.z,
                    incomingDamageType
                );
                if (defense !== "none") {
                    soundFns.playBlock();
                    const blockedLabel = skillName === "Attack" ? "attack" : skillName;
                    addLog(defense === "frontShield"
                        ? `${attackerData.name}'s ${blockedLabel} is blocked by ${targetData.name}'s shield!`
                        : `${targetData.name} blocks ${attackerData.name}'s ${blockedLabel}!`,
                        defense === "frontShield" ? "#4488ff" : "#aaaaaa");
                    spawnProjectileImpact(scene, targetG.position.x, targetG.position.z, defense === "frontShield" ? "#4488ff" : "#aaaaaa", 1.05, 170);
                    disposeProjectile(scene, proj);
                    return false;
                }
            }

            const skillHitProfile = isSkillShot
                ? { name: skillName, hitChance: proj.skillHitChanceOverride }
                : undefined;
            if (rollSkillHit(skillHitProfile, attackerData.accuracy, attackerUnit)) {
                const dmgType = incomingDamageType;
                const armor = getEffectiveArmor(targetUnit, targetData.armor);
                const skillDamage = proj.skillDamage;

                const { damage: dmg, isCrit } = isSkillShot && skillDamage
                    ? (() => {
                        const statBonus = proj.statBonus ?? calculateStatBonus(attackerUnit, dmgType);
                        return calculateDamageWithOptionalCritChance(
                            skillDamage[0] + statBonus,
                            skillDamage[1] + statBonus,
                            armor,
                            dmgType,
                            attackerUnit,
                            proj.skillCritChanceOverride
                        );
                    })()
                    : (() => {
                        const auraBonus = attackerUnit.auraDamageBonus ?? 0;
                        return calculateDamageWithCrit(
                            attackerData.damage[0] + auraBonus,
                            attackerData.damage[1] + auraBonus,
                            armor,
                            dmgType,
                            attackerUnit
                        );
                    })();

                const enemyAttackerData = !isSkillShot && attackerUnit.team === "enemy" && isEnemyData(attackerData) ? attackerData : null;
                const willPoison = !!enemyAttackerData && shouldApplyPoison(enemyAttackerData);
                const poisonDmg = willPoison ? enemyAttackerData.poisonDamage : undefined;

                // Calculate lifesteal heal amount for log message
                const lifesteal = enemyAttackerData?.lifesteal;
                const healAmount = lifesteal && lifesteal > 0 ? Math.floor(dmg * lifesteal) : 0;

                // Custom log for lifesteal attacks
                const hitText = healAmount > 0 && skillName === "Attack"
                    ? logLifestealHit(attackerData.name, targetData.name, dmg, healAmount)
                    : logHit(attackerData.name, skillName, targetData.name, dmg);
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

                if (isSkillShot && proj.skillOnHitEffect && rollChance(proj.skillOnHitEffect.chance)) {
                    applySkillProjectileOnHitEffect(
                        proj.skillOnHitEffect,
                        targetUnit.id,
                        targetData.name,
                        targetG.position.x,
                        targetG.position.z,
                        attackerUnit.id,
                        now,
                        scene,
                        queueUnitMutation,
                        addLog
                    );
                }

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
                    applyLifesteal(scene, damageTexts, setUnits, attackerUnit.id, attackerG.position.x, attackerG.position.z, healAmount);
                }
            } else {
                soundFns.playMiss();
                addLog(logMiss(attackerData.name, skillName, targetData.name), COLORS.logNeutral);
                spawnProjectileImpact(scene, targetG.position.x, targetG.position.z, COLORS.logNeutral, 0.9, 140);
            }

            disposeProjectile(scene, proj);
            return false;
        }

        // Move projectile (dx/dz already normalized)
        proj.mesh.position.x += dx * proj.speed;
        proj.mesh.position.z += dz * proj.speed;
        return true;
    };

    let writeIndex = 0;
    for (let i = 0; i < projectilesRef.length; i++) {
        const projectile = projectilesRef[i];
        if (processProjectile(projectile)) {
            projectilesRef[writeIndex] = projectile;
            writeIndex++;
        }
    }
    projectilesRef.length = writeIndex;

    if (pendingUnitMutations.size > 0) {
        setUnits(prev => {
            let changed = false;
            const nextUnits = prev.map(unit => {
                const mutation = pendingUnitMutations.get(unit.id);
                if (!mutation || unit.hp <= 0) return unit;
                const nextUnit = mutation(unit);
                if (nextUnit !== unit) {
                    changed = true;
                }
                return nextUnit;
            });
            return changed ? nextUnits : prev;
        });
    }

    return projectilesRef;
}
