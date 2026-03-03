// =============================================================================
// NECROMANCER CURSE - Delayed circular AoE with ground warning visual
// =============================================================================

import * as THREE from "three";
import type { Unit, UnitGroup, DamageText, EnemyCurseSkill, EnemyStats, DamageType } from "../core/types";
import { COLORS, DOOM_DURATION, BUFF_TICK_INTERVAL } from "../core/constants";
import { getUnitStats } from "../game/units";
import { distance } from "../game/geometry";
import { accumulateDelta } from "../core/gameClock";
import { calculateDamageWithCrit, rollHit, getEffectiveArmor, logAoeHit } from "../combat/combatMath";
import { applyDamageToUnit, buildDamageContext, createAnimatedRing } from "../combat/damageEffects";
import { soundFns } from "../audio";
import { disposeBasicMesh } from "../rendering/disposal";
import { createGroundWarningTile, forEachTileInRadius } from "./tileUtils";
import { getUnitById } from "../game/unitQuery";

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

    forEachTileInRadius(centerX, centerZ, radius, (x, z) => {
        meshes.push(createGroundWarningTile(scene, x, z, "#4a0066", "curse-tile"));
    });

    return meshes;
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
        accumulateDelta(curse, now);

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
    const caster = getUnitById(curse.casterId);
    const casterStats = caster ? getUnitStats(caster) as EnemyStats : null;
    const accuracy = casterStats?.accuracy ?? 65;
    const casterName = casterStats?.name ?? "Necromancer";

    const dmgCtx = buildDamageContext(scene, damageTexts, hitFlashRef, unitsRef, unitsState, setUnits, addLog, now, defeatedThisFrame);

    let hitCount = 0;
    let totalDamage = 0;
    const doomTargets = new Set<number>();

    unitsState.forEach(target => {
        if (target.team !== "player") return;
        if (target.hp <= 0 || defeatedThisFrame.has(target.id)) return;

        const tg = unitsRef[target.id];
        if (!tg) return;

        // Check if target is within the circular AoE
        const dist = distance(tg.position.x, tg.position.z, curse.centerX + 0.5, curse.centerZ + 0.5);

        if (dist <= curse.radius) {
            const targetData = getUnitStats(target);

            if (rollHit(accuracy, caster ?? undefined)) {
                const { damage: dmg } = calculateDamageWithCrit(
                    curse.damage[0], curse.damage[1],
                    getEffectiveArmor(target, targetData.armor),
                    curse.damageType, caster ?? undefined
                );

                applyDamageToUnit(dmgCtx, target.id, tg, dmg, targetData.name, {
                    color: COLORS.damageEnemy,
                    targetUnit: target
                });

                hitCount++;
                totalDamage += dmg;
                if (!defeatedThisFrame.has(target.id)) {
                    doomTargets.add(target.id);
                }
            }
        }
    });

    if (doomTargets.size > 0) {
        setUnits(prev => prev.map(u => {
            if (!doomTargets.has(u.id) || u.hp <= 0) return u;
            // Don't stack doom - refresh if already present.
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

    // Explosion visual
    createAnimatedRing(scene, curse.centerX + 0.5, curse.centerZ + 0.5, "#8b00ff", {
        innerRadius: 0.3, outerRadius: curse.radius, maxScale: 2.5, duration: 500, y: 0.3
    });

    soundFns.playHit();
    if (hitCount > 0) {
        addLog(logAoeHit(casterName, curse.skillName, hitCount, totalDamage), COLORS.damageEnemy);
        addLog(`Doom descends upon the cursed!`, "#8b5fbf");
    } else {
        addLog(`${casterName}'s ${curse.skillName} detonates harmlessly!`, COLORS.logNeutral);
    }
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
