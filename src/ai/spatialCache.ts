import type { Unit, UnitGroup } from "../core/types";
import { hasStatusEffect } from "../combat/combatMath";

const SPATIAL_HASH_SEED = 2166136261;
const SPATIAL_HASH_PRIME = 16777619;

export interface UnitSpatialEntry {
    unit: Unit;
    group: UnitGroup;
    cellX: number;
    cellZ: number;
}

export interface UnitSpatialFrame {
    aliveEntries: UnitSpatialEntry[];
    targetingEntries: UnitSpatialEntry[];
    aliveCount: number;
    positionHash: number;
    targetingHash: number;
    targetingCount: number;
}

interface UnitSpatialFrameScratch {
    aliveEntries: UnitSpatialEntry[];
    targetingEntries: UnitSpatialEntry[];
}

function writeSpatialEntry(
    entries: UnitSpatialEntry[],
    index: number,
    unit: Unit,
    group: UnitGroup,
    cellX: number,
    cellZ: number
): void {
    const existing = entries[index];
    if (existing) {
        existing.unit = unit;
        existing.group = group;
        existing.cellX = cellX;
        existing.cellZ = cellZ;
        return;
    }

    entries[index] = { unit, group, cellX, cellZ };
}

export function buildUnitSpatialFrame(
    unitsState: Unit[],
    unitsRef: Record<number, UnitGroup>,
    defeatedThisFrame: Set<number>,
    scratch: UnitSpatialFrameScratch
): UnitSpatialFrame {
    const aliveEntries = scratch.aliveEntries;
    const targetingEntries = scratch.targetingEntries;

    let aliveWriteIndex = 0;
    let targetingWriteIndex = 0;
    let positionHash = SPATIAL_HASH_SEED;
    let targetingHash = SPATIAL_HASH_SEED;

    for (const unit of unitsState) {
        if (unit.hp <= 0) continue;

        const group = unitsRef[unit.id];
        if (!group) continue;

        const cellX = Math.floor(group.position.x);
        const cellZ = Math.floor(group.position.z);

        writeSpatialEntry(aliveEntries, aliveWriteIndex, unit, group, cellX, cellZ);
        aliveWriteIndex++;

        positionHash = Math.imul(positionHash ^ unit.id, SPATIAL_HASH_PRIME);
        positionHash = Math.imul(positionHash ^ cellX, SPATIAL_HASH_PRIME);
        positionHash = Math.imul(positionHash ^ cellZ, SPATIAL_HASH_PRIME);

        if (unit.team === "neutral") continue;
        if (defeatedThisFrame.has(unit.id)) continue;
        if (hasStatusEffect(unit, "divine_lattice")) continue;

        writeSpatialEntry(targetingEntries, targetingWriteIndex, unit, group, cellX, cellZ);
        targetingWriteIndex++;

        const teamMarker = unit.team === "player" ? 1 : 2;
        targetingHash = Math.imul(targetingHash ^ unit.id, SPATIAL_HASH_PRIME);
        targetingHash = Math.imul(targetingHash ^ teamMarker, SPATIAL_HASH_PRIME);
        targetingHash = Math.imul(targetingHash ^ cellX, SPATIAL_HASH_PRIME);
        targetingHash = Math.imul(targetingHash ^ cellZ, SPATIAL_HASH_PRIME);
    }

    aliveEntries.length = aliveWriteIndex;
    targetingEntries.length = targetingWriteIndex;

    return {
        aliveEntries,
        targetingEntries,
        aliveCount: aliveWriteIndex,
        positionHash: positionHash >>> 0,
        targetingHash: targetingHash >>> 0,
        targetingCount: targetingWriteIndex,
    };
}
