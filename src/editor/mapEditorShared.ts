import type { AreaDialogDefinition, AreaDialogTrigger, AreaLocation } from "../game/areas/types";
import {
    cloneTileLayerStack,
    cloneTintLayerStack,
} from "../game/areas/tileLayers";
import { cloneDialogDefinition, cloneDialogLocation, cloneDialogTrigger, getOrderedEnemyEntities } from "./mapEditorHelpers";
import type { DecorationDef, EditorSnapshot, EntityDef, MapMetadata, TreeDef } from "./types";

export const DEFAULT_AREA_ID = "area";

export function normalizeAreaId(value: string, fallback: string = DEFAULT_AREA_ID): string {
    const normalized = value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, "_")
        .replace(/^_+|_+$/g, "");
    return normalized.length > 0 ? normalized : fallback;
}

export interface EditorSnapshotSource {
    metadata: MapMetadata;
    geometryLayer: string[][];
    terrainLayers: string[][][];
    floorLayers: string[][][];
    terrainTintLayers: number[][][];
    floorTintLayers: number[][][];
    propsLayer: string[][];
    entitiesLayer: string[][];
    entities: EntityDef[];
    trees: TreeDef[];
    decorations: DecorationDef[];
    dialogs: AreaDialogDefinition[];
    locations: AreaLocation[];
    dialogTriggers: AreaDialogTrigger[];
}

export function createEditorSnapshot(source: EditorSnapshotSource): EditorSnapshot {
    return {
        metadata: { ...source.metadata },
        geometryLayer: source.geometryLayer.map((row) => [...row]),
        terrainLayers: cloneTileLayerStack(source.terrainLayers),
        floorLayers: cloneTileLayerStack(source.floorLayers),
        terrainTintLayers: cloneTintLayerStack(source.terrainTintLayers),
        floorTintLayers: cloneTintLayerStack(source.floorTintLayers),
        propsLayer: source.propsLayer.map((row) => [...row]),
        entitiesLayer: source.entitiesLayer.map((row) => [...row]),
        entities: source.entities.map((entity) => ({ ...entity })),
        trees: source.trees.map((tree) => ({ ...tree })),
        decorations: source.decorations.map((decoration) => ({ ...decoration })),
        dialogs: source.dialogs.map(cloneDialogDefinition),
        locations: source.locations.map(cloneDialogLocation),
        dialogTriggers: source.dialogTriggers.map(cloneDialogTrigger),
    };
}

export function getBrushCells(
    x: number,
    z: number,
    size: number,
    width: number,
    height: number
): Array<{ x: number; z: number }> {
    const cells: Array<{ x: number; z: number }> = [];
    const halfSize = Math.floor(size / 2);
    for (let dz = -halfSize; dz < size - halfSize; dz++) {
        for (let dx = -halfSize; dx < size - halfSize; dx++) {
            const cellX = x + dx;
            const cellZ = z + dz;
            if (cellX < 0 || cellX >= width || cellZ < 0 || cellZ >= height) {
                continue;
            }
            cells.push({ x: cellX, z: cellZ });
        }
    }
    return cells;
}

export function remapEnemyLinkedTriggerConditions(
    triggers: AreaDialogTrigger[],
    previousEntities: EntityDef[],
    nextEntities: EntityDef[]
): AreaDialogTrigger[] {
    const previousEnemies = getOrderedEnemyEntities(previousEntities);
    const nextEnemies = getOrderedEnemyEntities(nextEntities);
    const previousEnemyIds = previousEnemies.map((enemy) => enemy.id);
    const nextEnemyIds = nextEnemies.map((enemy) => enemy.id);
    const enemyOrderChanged = previousEnemyIds.length !== nextEnemyIds.length
        || previousEnemyIds.some((enemyId, index) => nextEnemyIds[index] !== enemyId);
    if (!enemyOrderChanged) {
        return triggers;
    }

    const nextIndexByEnemyId = new Map<string, number>();
    nextEnemies.forEach((enemy, index) => {
        nextIndexByEnemyId.set(enemy.id, index);
    });
    const invalidSpawnIndex = nextEnemies.length;

    return triggers.map((trigger) => {
        let didChange = false;
        let removedTarget = false;
        const nextConditions = trigger.conditions.map((condition) => {
            if (
                condition.type !== "enemy_killed"
                && condition.type !== "unit_seen"
                && condition.type !== "npc_engaged"
            ) {
                return condition;
            }

            const previousEnemy = previousEnemies[condition.spawnIndex];
            if (!previousEnemy) {
                return condition;
            }

            const nextIndex = nextIndexByEnemyId.get(previousEnemy.id);
            if (nextIndex === undefined) {
                didChange = true;
                removedTarget = true;
                return {
                    ...condition,
                    spawnIndex: invalidSpawnIndex,
                };
            }

            if (nextIndex === condition.spawnIndex) {
                return condition;
            }

            didChange = true;
            return {
                ...condition,
                spawnIndex: nextIndex,
            };
        });

        if (!didChange) {
            return trigger;
        }

        return {
            ...trigger,
            ...(removedTarget ? { wip: true } : {}),
            conditions: nextConditions,
        };
    });
}
