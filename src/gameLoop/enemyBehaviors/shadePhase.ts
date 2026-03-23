// =============================================================================
// SHADE PHASE BEHAVIOR - Temporary invisibility + reposition for Wandering Shade
// =============================================================================

import type { Unit, UnitGroup } from "../../core/types";
import { ENEMY_STATS } from "../../game/enemyStats";
import { clampToGrid, distance } from "../../game/geometry";
import { isInRange, getUnitRadius } from "../../rendering/range";
import { setSkillCooldown } from "../../combat/combatMath";
import type { PhaseShiftContext } from "./types";

// =============================================================================
// STATE
// =============================================================================

interface ActiveShadePhase {
    unitId: number;
    invisibleEndTime: number;
}

const activeShadePhases: ActiveShadePhase[] = [];
const SHADE_PHASE_LOG_COLOR = "#8f9bb8";
const SHADE_REPOSITION_ATTEMPTS = 8;

// =============================================================================
// HELPERS
// =============================================================================

interface TargetCandidate {
    group: UnitGroup;
    dist: number;
}

function findNearestPlayerInRange(
    x: number,
    z: number,
    aggroRange: number,
    unitsState: Unit[],
    unitsRef: Record<number, UnitGroup>
): TargetCandidate | null {
    let nearest: TargetCandidate | null = null;

    for (const candidate of unitsState) {
        if (candidate.team !== "player" || candidate.hp <= 0) continue;
        const candidateGroup = unitsRef[candidate.id];
        if (!candidateGroup) continue;

        if (!isInRange(x, z, candidateGroup.position.x, candidateGroup.position.z, getUnitRadius(candidate), aggroRange)) continue;

        const dist = distance(x, z, candidateGroup.position.x, candidateGroup.position.z);
        if (!nearest || dist < nearest.dist) {
            nearest = { group: candidateGroup, dist };
        }
    }

    return nearest;
}

function pickRepositionPoint(
    fromX: number,
    fromZ: number,
    targetX: number,
    targetZ: number,
    minRange: number,
    maxRange: number
): { x: number; z: number } {
    let fallback: { x: number; z: number } | null = null;

    for (let i = 0; i < SHADE_REPOSITION_ATTEMPTS; i++) {
        const angle = Math.random() * Math.PI * 2;
        const radius = minRange + Math.random() * (maxRange - minRange);
        const candidateX = clampToGrid(targetX + Math.cos(angle) * radius, 0.5, "x");
        const candidateZ = clampToGrid(targetZ + Math.sin(angle) * radius, 0.5, "z");

        if (fallback === null) {
            fallback = { x: candidateX, z: candidateZ };
        }

        const distFromCurrent = distance(fromX, fromZ, candidateX, candidateZ);
        if (distFromCurrent >= Math.max(0.75, minRange * 0.45)) {
            return { x: candidateX, z: candidateZ };
        }
    }

    return fallback ?? { x: fromX, z: fromZ };
}

// =============================================================================
// PHASE SHIFT START
// =============================================================================

export function tryShadePhase(ctx: PhaseShiftContext): boolean {
    const {
        unit,
        g,
        enemyStats,
        phaseShiftSkill,
        unitsState,
        unitsRef,
        setUnits,
        skillCooldowns,
        setSkillCooldowns,
        addLog,
        now
    } = ctx;

    if (isShadePhased(unit.id)) {
        return false;
    }

    const phaseKey = `${unit.id}-${phaseShiftSkill.name}`;
    const cooldownEnd = skillCooldowns[phaseKey]?.end ?? 0;
    if (now < cooldownEnd) {
        return false;
    }

    const nearestPlayer = findNearestPlayerInRange(
        g.position.x,
        g.position.z,
        enemyStats.aggroRange,
        unitsState,
        unitsRef
    );
    if (!nearestPlayer) {
        return false;
    }

    const minRange = Math.max(0.5, Math.min(phaseShiftSkill.repositionMinRange, phaseShiftSkill.repositionMaxRange));
    const maxRange = Math.max(minRange, phaseShiftSkill.repositionMaxRange);
    const destination = pickRepositionPoint(
        g.position.x,
        g.position.z,
        nearestPlayer.group.position.x,
        nearestPlayer.group.position.z,
        minRange,
        maxRange
    );

    g.position.x = destination.x;
    g.position.z = destination.z;
    g.userData.attackTarget = null;

    setUnits(prev => prev.map(existing =>
        existing.id === unit.id
            ? { ...existing, x: destination.x, z: destination.z }
            : existing
    ));

    activeShadePhases.push({
        unitId: unit.id,
        invisibleEndTime: now + phaseShiftSkill.invisibleDuration
    });

    setSkillCooldown(setSkillCooldowns, phaseKey, phaseShiftSkill.cooldown, now, unit);
    addLog(`${enemyStats.name} fades from sight.`, SHADE_PHASE_LOG_COLOR);
    return true;
}

// =============================================================================
// STATE QUERIES / UPDATE
// =============================================================================

export function isShadePhased(unitId: number): boolean {
    return activeShadePhases.some(active => active.unitId === unitId);
}

export function processShadePhases(
    now: number,
    unitsState: Unit[],
    addLog: (text: string, color?: string) => void
): void {
    for (let i = activeShadePhases.length - 1; i >= 0; i--) {
        const active = activeShadePhases[i];
        const shadeUnit = unitsState.find(unit => unit.id === active.unitId && unit.hp > 0);

        if (!shadeUnit) {
            activeShadePhases.splice(i, 1);
            continue;
        }

        if (now < active.invisibleEndTime) {
            continue;
        }

        const displayName = shadeUnit.enemyType ? ENEMY_STATS[shadeUnit.enemyType].name : "Enemy";
        addLog(`${displayName} materializes nearby!`, SHADE_PHASE_LOG_COLOR);
        activeShadePhases.splice(i, 1);
    }
}

// =============================================================================
// CLEANUP
// =============================================================================

export function clearShadePhases(): void {
    activeShadePhases.length = 0;
}
