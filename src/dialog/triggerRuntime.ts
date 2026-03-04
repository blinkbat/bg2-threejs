import type { Unit } from "../core/types";
import type { AreaData, AreaDialogTrigger, AreaDialogTriggerStartDialogAction } from "../game/areas/types";
import { getUnitRadius, isInRange } from "../rendering/range";

const DEFAULT_UNIT_SEEN_RANGE = 12;

export interface DialogTriggerRuntimeState {
    stickySatisfiedConditionKeys: Set<string>;
    previousRegionInsideByConditionKey: Map<string, boolean>;
    pendingNpcEngagementSpawnIndexes: Set<number>;
}

export interface DialogTriggerEvaluationContext {
    trigger: AreaDialogTrigger;
    area: AreaData;
    units: Unit[];
    killedEnemies: Set<string>;
    now: number;
    areaLoadedAt: number;
    runtimeState: DialogTriggerRuntimeState;
}

function getConditionKey(triggerId: string, conditionIndex: number): string {
    return `${triggerId}::${conditionIndex}`;
}

function getStaticSpawnUnit(units: Unit[], spawnIndex: number): Unit | undefined {
    const staticUnitId = 100 + spawnIndex;
    return units.find(unit => unit.id === staticUnitId);
}

function isAnyPlayerInsideRegion(units: Unit[], x: number, z: number, w: number, h: number): boolean {
    const maxX = x + w;
    const maxZ = z + h;
    return units.some(unit => {
        if (unit.team !== "player" || unit.hp <= 0) return false;
        const cellX = Math.floor(unit.x);
        const cellZ = Math.floor(unit.z);
        return cellX >= x && cellX < maxX && cellZ >= z && cellZ < maxZ;
    });
}

function hasAnyEnemyWithinRange(units: Unit[], range: number): boolean {
    const players = units.filter(unit => unit.team === "player" && unit.hp > 0);
    const enemies = units.filter(unit => unit.team === "enemy" && unit.hp > 0);
    for (const player of players) {
        for (const enemy of enemies) {
            if (isInRange(player.x, player.z, enemy.x, enemy.z, getUnitRadius(enemy), range)) {
                return true;
            }
        }
    }
    return false;
}

function isUnitSeenByParty(units: Unit[], spawnIndex: number, range: number): boolean {
    const target = getStaticSpawnUnit(units, spawnIndex);
    if (!target || target.hp <= 0) return false;
    if (target.team !== "enemy" && target.team !== "neutral") return false;
    const targetRadius = getUnitRadius(target);
    return units.some(player => {
        if (player.team !== "player" || player.hp <= 0) return false;
        return isInRange(player.x, player.z, target.x, target.z, targetRadius, range);
    });
}

export function getDialogTriggerPriority(trigger: AreaDialogTrigger): number {
    return trigger.priority ?? 0;
}

export function getTriggerStartDialogAction(trigger: AreaDialogTrigger): AreaDialogTriggerStartDialogAction | null {
    const explicitAction = trigger.actions?.find(action => action.type === "start_dialog");
    if (explicitAction) {
        return explicitAction;
    }

    if (typeof trigger.dialogId === "string") {
        const dialogId = trigger.dialogId.trim();
        if (dialogId.length > 0) {
            return {
                type: "start_dialog",
                dialogId,
            };
        }
    }

    return null;
}

export function getTriggerStartDialogId(trigger: AreaDialogTrigger): string | null {
    const action = getTriggerStartDialogAction(trigger);
    if (!action) return null;
    const dialogId = action.dialogId.trim();
    return dialogId.length > 0 ? dialogId : null;
}

export function isDialogTriggerSatisfied(context: DialogTriggerEvaluationContext): boolean {
    const { trigger, area, units, killedEnemies, now, areaLoadedAt, runtimeState } = context;
    if (trigger.conditions.length === 0) return false;

    for (let index = 0; index < trigger.conditions.length; index++) {
        const condition = trigger.conditions[index];
        const conditionKey = getConditionKey(trigger.id, index);
        const alreadySatisfied = runtimeState.stickySatisfiedConditionKeys.has(conditionKey);

        if (condition.type === "on_area_load") {
            continue;
        }

        if (condition.type === "enemy_killed") {
            const killedKey = `${area.id}-${condition.spawnIndex}`;
            if (killedEnemies.has(killedKey)) {
                continue;
            }
            const spawnUnit = getStaticSpawnUnit(units, condition.spawnIndex);
            if (spawnUnit && spawnUnit.hp <= 0) {
                continue;
            }
            return false;
        }

        if (condition.type === "party_enters_region") {
            if (alreadySatisfied) {
                continue;
            }
            const isInside = isAnyPlayerInsideRegion(units, condition.x, condition.z, condition.w, condition.h);
            const wasInside = runtimeState.previousRegionInsideByConditionKey.get(conditionKey) ?? false;
            runtimeState.previousRegionInsideByConditionKey.set(conditionKey, isInside);
            if (isInside && !wasInside) {
                runtimeState.stickySatisfiedConditionKeys.add(conditionKey);
                continue;
            }
            return false;
        }

        if (condition.type === "party_enters_location") {
            if (alreadySatisfied) {
                continue;
            }
            const location = area.locations?.find(candidate => candidate.id === condition.locationId);
            if (!location) {
                return false;
            }
            const isInside = isAnyPlayerInsideRegion(units, location.x, location.z, location.w, location.h);
            const wasInside = runtimeState.previousRegionInsideByConditionKey.get(conditionKey) ?? false;
            runtimeState.previousRegionInsideByConditionKey.set(conditionKey, isInside);
            if (isInside && !wasInside) {
                runtimeState.stickySatisfiedConditionKeys.add(conditionKey);
                continue;
            }
            return false;
        }

        if (condition.type === "unit_seen") {
            if (alreadySatisfied) {
                continue;
            }
            const visibleRange = condition.range ?? DEFAULT_UNIT_SEEN_RANGE;
            if (isUnitSeenByParty(units, condition.spawnIndex, visibleRange)) {
                runtimeState.stickySatisfiedConditionKeys.add(conditionKey);
                continue;
            }
            return false;
        }

        if (condition.type === "npc_engaged") {
            const npcUnit = getStaticSpawnUnit(units, condition.spawnIndex);
            if (!npcUnit || npcUnit.hp <= 0 || npcUnit.team !== "neutral") {
                return false;
            }
            if (runtimeState.pendingNpcEngagementSpawnIndexes.has(condition.spawnIndex)) {
                continue;
            }
            return false;
        }

        if (condition.type === "party_out_of_combat_range") {
            if (!hasAnyEnemyWithinRange(units, condition.range)) {
                continue;
            }
            return false;
        }

        if (condition.type === "after_delay") {
            if (now - areaLoadedAt >= condition.ms) {
                continue;
            }
            return false;
        }
    }

    return true;
}
