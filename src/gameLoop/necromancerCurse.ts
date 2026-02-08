// =============================================================================
// NECROMANCER CURSE - Delayed circular AoE with ground warning visual
// =============================================================================

import * as THREE from "three";
import type { Unit, UnitGroup, DamageText, EnemyCurseSkill, EnemyStats, DamageType } from "../core/types";
import { COLORS, DOOM_DURATION, BUFF_TICK_INTERVAL } from "../core/constants";
import { getUnitStats } from "../game/units";
import { calculateDamageWithCrit, rollHit, getEffectiveArmor, logAoeHit, isUnitAlive } from "../combat/combatMath";
import { applyDamageToUnit, type DamageContext } from "../combat/damageEffects";
import { soundFns } from "../audio";
import { disposeBasicMesh } from "../rendering/disposal";

// =============================================================================
// TYPES
// =============================================================================

interface CurseState {
    casterId: number;
    elapsedTime: number;       // Accumulated time (pause-safe)
    lastUpdateTime: number;    // Last frame timestamp for delta calculation
    delay: number;             // Total delay before detonation
    damage: [number, number];
    damageType: DamageType;
    radius: number;
    centerX: number;
    centerZ: number;
    meshes: THREE.Mesh[];
    skillName: string;
}

// =============================================================================
// STATE
// =============================================================================

let nextCurseId = 0;
const activeCurses = new Map<number, CurseState>();

// =============================================================================
// VISUAL CREATION
// =============================================================================

/**
 * Create circular ground warning tiles for the curse AoE.
 * Uses a grid of tiles within the radius to approximate a circle.
 */
function createCurseMeshes(
    scene: THREE.Scene,
    centerX: number,
    centerZ: number,
    radius: number
): THREE.Mesh[] {
    const meshes: THREE.Mesh[] = [];
    const radiusCeil = Math.ceil(radius);

    for (let dx = -radiusCeil; dx <= radiusCeil; dx++) {
        for (let dz = -radiusCeil; dz <= radiusCeil; dz++) {
            // Only include tiles within the circular radius
            const dist = Math.sqrt(dx * dx + dz * dz);
            if (dist > radius) continue;

            const mesh = createCurseTile(scene, centerX + dx, centerZ + dz);
            meshes.push(mesh);
        }
    }

    return meshes;
}

/**
 * Create a single curse warning tile.
 */
function createCurseTile(scene: THREE.Scene, x: number, z: number): THREE.Mesh {
    const geometry = new THREE.PlaneGeometry(0.9, 0.9);
    const material = new THREE.MeshBasicMaterial({
        color: "#4a0066",
        transparent: true,
        opacity: 0.1,
        side: THREE.DoubleSide
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x + 0.5, 0.05, z + 0.5);
    mesh.name = "curse-tile";
    scene.add(mesh);
    return mesh;
}

// =============================================================================
// CURSE LIFECYCLE
// =============================================================================

/**
 * Start a curse at the given target position.
 */
export function startCurse(
    scene: THREE.Scene,
    casterId: number,
    curseSkill: EnemyCurseSkill,
    targetX: number,
    targetZ: number,
    now: number,
    addLog: (text: string, color?: string) => void
): void {
    const centerX = Math.floor(targetX);
    const centerZ = Math.floor(targetZ);

    // Create visual warning
    const meshes = createCurseMeshes(scene, centerX, centerZ, curseSkill.radius);

    const curseId = nextCurseId++;
    activeCurses.set(curseId, {
        casterId,
        elapsedTime: 0,
        lastUpdateTime: now,
        delay: curseSkill.delay,
        damage: curseSkill.damage,
        damageType: curseSkill.damageType,
        radius: curseSkill.radius,
        centerX,
        centerZ,
        meshes,
        skillName: curseSkill.name
    });

    addLog(`The ground darkens with a sinister curse!`, "#8b5fbf");
}

// =============================================================================
// CURSE PROCESSING
// =============================================================================

/**
 * Process all active curses. Called every frame from the game loop.
 * Updates visuals and triggers detonation when delay expires.
 */
export function processCurses(
    scene: THREE.Scene,
    unitsState: Unit[],
    unitsRef: Record<number, UnitGroup>,
    damageTexts: DamageText[],
    hitFlashRef: Record<number, number>,
    setUnits: React.Dispatch<React.SetStateAction<Unit[]>>,
    addLog: (text: string, color?: string) => void,
    now: number,
    defeatedThisFrame: Set<number>
): void {
    const toRemove: number[] = [];

    activeCurses.forEach((curse, curseId) => {
        // Accumulate elapsed time (pause-safe)
        const rawDelta = now - curse.lastUpdateTime;
        const delta = Math.min(rawDelta, 100); // Max 100ms per frame
        curse.elapsedTime += delta;
        curse.lastUpdateTime = now;

        const progress = Math.min(curse.elapsedTime / curse.delay, 1);

        // Update visual intensity
        updateCurseVisuals(curse, progress);

        // Check if curse should detonate
        if (curse.elapsedTime >= curse.delay) {
            executeCurse(
                scene, curse, unitsState, unitsRef,
                damageTexts, hitFlashRef, setUnits, addLog, now, defeatedThisFrame
            );

            cleanupCurse(scene, curse);
            toRemove.push(curseId);
        }
    });

    toRemove.forEach(id => activeCurses.delete(id));
}

/**
 * Update visual intensity of curse tiles based on progress.
 */
function updateCurseVisuals(curse: CurseState, progress: number): void {
    // Opacity ramps from 0.1 to 0.7
    const opacity = 0.1 + progress * 0.6;

    // Color shifts from dark purple to bright purple
    const r = 0.3 + progress * 0.4;
    const g = 0;
    const b = 0.4 + progress * 0.4;

    curse.meshes.forEach(mesh => {
        const material = mesh.material as THREE.MeshBasicMaterial;
        material.opacity = opacity;
        material.color.setRGB(r, g, b);

        // Pulsing in final 25%
        if (progress > 0.75) {
            const pulsePhase = (progress - 0.75) * 4;
            const pulse = Math.sin(pulsePhase * Math.PI * 8) * 0.15;
            material.opacity = Math.min(1, opacity + pulse);
        }
    });
}

/**
 * Execute the curse detonation, dealing damage and applying Doom to units in the area.
 */
function executeCurse(
    scene: THREE.Scene,
    curse: CurseState,
    unitsState: Unit[],
    unitsRef: Record<number, UnitGroup>,
    damageTexts: DamageText[],
    hitFlashRef: Record<number, number>,
    setUnits: React.Dispatch<React.SetStateAction<Unit[]>>,
    addLog: (text: string, color?: string) => void,
    now: number,
    defeatedThisFrame: Set<number>
): void {
    const caster = unitsState.find(u => u.id === curse.casterId);
    const casterStats = caster ? getUnitStats(caster) as EnemyStats : null;
    const accuracy = casterStats?.accuracy ?? 65;
    const casterName = casterStats?.name ?? "Necromancer";

    const unitsStateRef = { current: unitsState } as React.RefObject<Unit[]>;
    const dmgCtx: DamageContext = { scene, damageTexts, hitFlashRef, unitsRef, unitsStateRef, setUnits, addLog, now, defeatedThisFrame };

    let hitCount = 0;
    let totalDamage = 0;

    unitsState.forEach(target => {
        if (target.team !== "player" || !isUnitAlive(target, defeatedThisFrame)) return;

        const tg = unitsRef[target.id];
        if (!tg) return;

        // Check if target is within the circular AoE
        const dx = tg.position.x - (curse.centerX + 0.5);
        const dz = tg.position.z - (curse.centerZ + 0.5);
        const dist = Math.sqrt(dx * dx + dz * dz);

        if (dist <= curse.radius) {
            const targetData = getUnitStats(target);

            if (rollHit(accuracy)) {
                const { damage: dmg } = calculateDamageWithCrit(
                    curse.damage[0], curse.damage[1],
                    getEffectiveArmor(target, targetData.armor),
                    curse.damageType, caster ?? undefined
                );

                applyDamageToUnit(dmgCtx, target.id, tg, target.hp, dmg, targetData.name, {
                    color: COLORS.damageEnemy,
                    targetUnit: target
                });

                hitCount++;
                totalDamage += dmg;

                // Apply Doom status effect to surviving targets
                setUnits(prev => prev.map(u => {
                    if (u.id !== target.id || u.hp <= 0) return u;
                    // Don't stack doom - refresh if already present
                    const existingEffects = (u.statusEffects ?? []).filter(e => e.type !== "doom");
                    return {
                        ...u,
                        statusEffects: [
                            ...existingEffects,
                            {
                                type: "doom" as const,
                                duration: DOOM_DURATION,
                                tickInterval: BUFF_TICK_INTERVAL,
                                timeSinceTick: 0,
                                lastUpdateTime: now,
                                damagePerTick: 0,
                                sourceId: curse.casterId
                            }
                        ]
                    };
                }));
            }
        }
    });

    // Explosion visual
    createCurseExplosion(scene, curse.centerX, curse.centerZ, curse.radius);

    soundFns.playHit();
    if (hitCount > 0) {
        addLog(logAoeHit(casterName, curse.skillName, hitCount, totalDamage), COLORS.damageEnemy);
        addLog(`Doom descends upon the cursed!`, "#8b5fbf");
    } else {
        addLog(`${casterName}'s ${curse.skillName} detonates harmlessly!`, COLORS.logNeutral);
    }
}

/**
 * Create a visual explosion effect when the curse detonates.
 */
function createCurseExplosion(scene: THREE.Scene, centerX: number, centerZ: number, radius: number): void {
    const geometry = new THREE.RingGeometry(0.3, radius, 32);
    const material = new THREE.MeshBasicMaterial({
        color: "#8b00ff",
        transparent: true,
        opacity: 0.8,
        side: THREE.DoubleSide
    });
    const ring = new THREE.Mesh(geometry, material);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(centerX + 0.5, 0.3, centerZ + 0.5);
    scene.add(ring);

    const startTime = Date.now();
    const duration = 500;

    function animate(): void {
        const elapsed = Date.now() - startTime;
        const progress = elapsed / duration;

        if (progress >= 1) {
            disposeBasicMesh(scene, ring);
            return;
        }

        const scale = 1 + progress * 1.5;
        ring.scale.set(scale, scale, scale);
        material.opacity = 0.8 * (1 - progress);

        requestAnimationFrame(animate);
    }
    animate();
}

/**
 * Cleanup a curse and remove its visual meshes.
 */
function cleanupCurse(scene: THREE.Scene, curse: CurseState): void {
    curse.meshes.forEach(mesh => {
        disposeBasicMesh(scene, mesh);
    });
}

/**
 * Clear all active curses (for area transitions).
 */
export function clearCurses(scene?: THREE.Scene): void {
    if (scene) {
        activeCurses.forEach(curse => {
            cleanupCurse(scene, curse);
        });
    }
    activeCurses.clear();
    nextCurseId = 0;
}
