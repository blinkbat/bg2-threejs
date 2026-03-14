import type {
    AreaDialogChoice,
    AreaDialogDefinition,
    AreaDialogNode,
    AreaDialogTrigger,
    AreaDialogTriggerAction,
    AreaDialogTriggerCondition,
    AreaLocation,
} from "../game/areas/types";
import type { DecorationDef, EntityDef, TreeDef } from "./types";

export type EditorClipboard =
    | { kind: "entity"; entity: EntityDef }
    | { kind: "tree"; tree: TreeDef }
    | { kind: "decoration"; decoration: DecorationDef };

export interface EditorContextMenuState {
    screenX: number;
    screenY: number;
    tileX: number;
    tileZ: number;
    entity: EntityDef | null;
    tree: { value: TreeDef; index: number } | null;
    decoration: { value: DecorationDef; index: number } | null;
    location: AreaLocation | null;
}

export type DragEntityBrush = "D" | "S";

export interface DialogRegionDragState {
    locationId: string;
    startX: number;
    startZ: number;
    endX: number;
    endZ: number;
}

export function createDialogTriggerId(): string {
    return `dialog_trigger_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
}

export function createDialogLocationId(existingLocations: AreaLocation[]): string {
    const existingIds = new Set(existingLocations.map(location => location.id));
    let index = 1;
    while (existingIds.has(`location_${index}`)) {
        index += 1;
    }
    return `location_${index}`;
}

export function cloneDialogLocation(location: AreaLocation): AreaLocation {
    return {
        id: location.id,
        x: location.x,
        z: location.z,
        w: location.w,
        h: location.h,
    };
}

export function locationContainsCell(location: AreaLocation, x: number, z: number): boolean {
    return x >= location.x
        && x < location.x + location.w
        && z >= location.z
        && z < location.z + location.h;
}

function cloneDialogCondition(condition: AreaDialogTriggerCondition): AreaDialogTriggerCondition {
    if (condition.type === "on_area_load") {
        return { type: "on_area_load" };
    }
    if (condition.type === "enemy_killed") {
        return { type: "enemy_killed", spawnIndex: condition.spawnIndex };
    }
    if (condition.type === "party_enters_location") {
        return { type: "party_enters_location", locationId: condition.locationId };
    }
    if (condition.type === "party_enters_region") {
        return {
            type: "party_enters_region",
            x: condition.x,
            z: condition.z,
            w: condition.w,
            h: condition.h,
        };
    }
    if (condition.type === "unit_seen") {
        return {
            type: "unit_seen",
            spawnIndex: condition.spawnIndex,
            ...(condition.range !== undefined ? { range: condition.range } : {}),
        };
    }
    if (condition.type === "npc_engaged") {
        return { type: "npc_engaged", spawnIndex: condition.spawnIndex };
    }
    if (condition.type === "party_out_of_combat_range") {
        return { type: "party_out_of_combat_range", range: condition.range };
    }
    return { type: "after_delay", ms: condition.ms };
}

export function cloneDialogTriggerAction(action: AreaDialogTriggerAction): AreaDialogTriggerAction {
    if (action.type === "start_dialog") {
        return {
            type: "start_dialog",
            dialogId: action.dialogId,
        };
    }
    return action;
}

export function cloneDialogTrigger(trigger: AreaDialogTrigger): AreaDialogTrigger {
    return {
        id: trigger.id,
        ...(trigger.dialogId ? { dialogId: trigger.dialogId } : {}),
        ...(trigger.actions && trigger.actions.length > 0 ? { actions: trigger.actions.map(cloneDialogTriggerAction) } : {}),
        ...(trigger.wip ? { wip: true } : {}),
        ...(trigger.once !== undefined ? { once: trigger.once } : {}),
        ...(trigger.priority !== undefined ? { priority: trigger.priority } : {}),
        conditions: trigger.conditions.map(cloneDialogCondition),
    };
}

function cloneDialogChoice(choice: AreaDialogChoice): AreaDialogChoice {
    return {
        id: choice.id,
        label: choice.label,
        ...(choice.nextNodeId ? { nextNodeId: choice.nextNodeId } : {}),
        ...(choice.conditions && choice.conditions.length > 0 ? { conditions: choice.conditions.map(condition => ({ ...condition })) } : {}),
        ...(choice.onDialogEndAction ? { onDialogEndAction: { ...choice.onDialogEndAction } } : {}),
    };
}

export function cloneDialogNode(node: AreaDialogNode): AreaDialogNode {
    const choices = (node.choices ?? []).map(cloneDialogChoice);
    return {
        id: node.id,
        speakerId: node.speakerId,
        text: node.text,
        ...(choices.length > 0 ? { choices } : {}),
        ...(node.nextNodeId ? { nextNodeId: node.nextNodeId } : {}),
        ...(node.continueLabel ? { continueLabel: node.continueLabel } : {}),
        ...(node.onDialogEndAction ? { onDialogEndAction: { ...node.onDialogEndAction } } : {}),
        ...(node.isMenuNode ? { isMenuNode: true } : {}),
    };
}

export function cloneDialogDefinition(dialog: AreaDialogDefinition): AreaDialogDefinition {
    const nodes: Record<string, AreaDialogNode> = {};
    Object.values(dialog.nodes).forEach(node => {
        nodes[node.id] = cloneDialogNode(node);
    });
    return {
        id: dialog.id,
        startNodeId: dialog.startNodeId,
        nodes,
    };
}

export function createDefaultDialogCondition(): AreaDialogTriggerCondition {
    return { type: "on_area_load" };
}

function mapTriggerDialogId(dialogId: string, dialogIdRemap: Record<string, string>): string {
    return dialogIdRemap[dialogId] ?? dialogId;
}

function remapTriggerDialogTargets(trigger: AreaDialogTrigger, dialogIdRemap: Record<string, string>): AreaDialogTrigger {
    let didChange = false;
    const nextDialogId = trigger.dialogId
        ? mapTriggerDialogId(trigger.dialogId, dialogIdRemap)
        : undefined;
    if (nextDialogId !== trigger.dialogId) {
        didChange = true;
    }
    const nextActions = trigger.actions?.map(action => {
        if (action.type !== "start_dialog") return action;
        const remappedDialogId = mapTriggerDialogId(action.dialogId, dialogIdRemap);
        if (remappedDialogId === action.dialogId) return action;
        didChange = true;
        return {
            ...action,
            dialogId: remappedDialogId,
        };
    });
    if (!didChange) return trigger;
    return {
        ...trigger,
        ...(nextDialogId !== undefined ? { dialogId: nextDialogId } : { dialogId: undefined }),
        ...(nextActions ? { actions: nextActions } : {}),
    };
}

export function remapTriggerDialogTargetsInList(triggers: AreaDialogTrigger[], dialogIdRemap: Record<string, string>): AreaDialogTrigger[] {
    return triggers.map(trigger => remapTriggerDialogTargets(trigger, dialogIdRemap));
}

function getNormalizedEnemySpawnOrderIndex(entity: EntityDef): number | null {
    if (typeof entity.enemySpawnIndex !== "number" || !Number.isFinite(entity.enemySpawnIndex)) {
        return null;
    }
    return Math.max(0, Math.floor(entity.enemySpawnIndex));
}

export function getOrderedEnemyEntities(entities: EntityDef[]): EntityDef[] {
    const enemies = entities.filter(entity => entity.type === "enemy");
    return [...enemies].sort((a, b) => {
        const aIndex = getNormalizedEnemySpawnOrderIndex(a);
        const bIndex = getNormalizedEnemySpawnOrderIndex(b);
        const aHasIndex = aIndex !== null;
        const bHasIndex = bIndex !== null;
        if (aHasIndex && bHasIndex && aIndex !== bIndex) {
            return aIndex - bIndex;
        }
        if (aHasIndex !== bHasIndex) {
            return aHasIndex ? -1 : 1;
        }
        const az = Math.floor(a.z);
        const bz = Math.floor(b.z);
        if (az !== bz) return az - bz;
        const ax = Math.floor(a.x);
        const bx = Math.floor(b.x);
        if (ax !== bx) return ax - bx;
        return a.id.localeCompare(b.id);
    });
}

export function getNextEnemySpawnIndex(entities: EntityDef[]): number {
    let maxSpawnIndex = -1;
    entities.forEach(entity => {
        if (entity.type !== "enemy") return;
        const spawnIndex = getNormalizedEnemySpawnOrderIndex(entity);
        if (spawnIndex === null) return;
        maxSpawnIndex = Math.max(maxSpawnIndex, spawnIndex);
    });
    return maxSpawnIndex + 1;
}

export function clampGridCoord(value: number, maxExclusive: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(maxExclusive - 1, Math.floor(value)));
}
