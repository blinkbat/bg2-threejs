import { DIALOG_SPEAKERS } from "../../dialog/speakers";
import type { DialogSpeakerId } from "../../dialog/types";
import type { EnemyType } from "../../core/types";
import type {
    AreaDialogDefinition,
    AreaDialogEventId,
    AreaDialogMenuId,
    AreaDialogNode,
    AreaDialogTrigger,
    AreaDialogTriggerCondition,
    AreaDialogUiAction,
    AreaLocation,
} from "../../game/areas/types";
import {
    clampGridCoord,
    cloneDialogDefinition,
    cloneDialogNode,
    cloneDialogTrigger,
    cloneDialogTriggerAction,
} from "../mapEditorHelpers";

export { clampGridCoord, cloneDialogDefinition, cloneDialogNode, cloneDialogTrigger, cloneDialogTriggerAction };

export interface EnemySpawnOption {
    spawnIndex: number;
    x: number;
    z: number;
    enemyType: EnemyType;
}

export interface TriggerValidationState {
    conditionStepValid: boolean;
    actionStepValid: boolean;
    isValid: boolean;
    hasHardBlockingIssue: boolean;
    targetDialogId: string;
    issues: string[];
}

export type TriggerListFilter = "all" | "needs_fix" | "ready" | "wip";

export const DIALOG_END_MENU_OPTIONS: Array<{ value: AreaDialogMenuId | AreaDialogEventId; label: string }> = [
    { value: "controls", label: "Controls" },
    { value: "help", label: "Help" },
    { value: "glossary", label: "Glossary" },
    { value: "equipment", label: "Equipment" },
    { value: "save_game", label: "Save Menu" },
    { value: "load_game", label: "Load Menu" },
    { value: "menu", label: "Main Menu" },
    { value: "jukebox", label: "Jukebox" },
    { value: "spend_the_night", label: "Spend The Night" },
];

export const SAVE_FEEDBACK_MS = 2500;

export const TRIGGER_CONDITION_OPTIONS: Array<{ value: AreaDialogTriggerCondition["type"]; label: string }> = [
    { value: "on_area_load", label: "When Area Loads" },
    { value: "enemy_killed", label: "When Specific Enemy Dies" },
    { value: "party_enters_location", label: "When Party Enters Named Location" },
    { value: "party_enters_region", label: "When Party Enters Region" },
    { value: "unit_seen", label: "When Party Sees Enemy" },
    { value: "npc_engaged", label: "When NPC Is Engaged" },
    { value: "party_out_of_combat_range", label: "When Party Is Out Of Combat Range" },
    { value: "after_delay", label: "After Delay" },
];

export const TRIGGER_FILTER_OPTIONS: Array<{ value: TriggerListFilter; label: string }> = [
    { value: "all", label: "All Triggers" },
    { value: "needs_fix", label: "Needs Fix" },
    { value: "ready", label: "Ready" },
    { value: "wip", label: "WIP" },
];

export function createUniqueId(base: string, existingIds: Set<string>): string {
    const normalizedBase = base.trim().length > 0 ? base.trim() : "id";
    if (!existingIds.has(normalizedBase)) return normalizedBase;
    let index = 1;
    while (existingIds.has(`${normalizedBase}_${index}`)) {
        index += 1;
    }
    return `${normalizedBase}_${index}`;
}

export const MENU_NODE_OPTIONS: Array<{ value: AreaDialogMenuId | AreaDialogEventId; label: string }> = [
    { value: "controls", label: "Controls" },
    { value: "help", label: "Help" },
    { value: "glossary", label: "Glossary" },
    { value: "equipment", label: "Equipment" },
    { value: "save_game", label: "Save Menu" },
    { value: "load_game", label: "Load Menu" },
    { value: "menu", label: "Main Menu" },
    { value: "jukebox", label: "Jukebox" },
    { value: "spend_the_night", label: "Spend The Night" },
];

export function getMenuNodeLabel(node: AreaDialogNode): string {
    if (!node.isMenuNode || !node.onDialogEndAction) return node.id;
    const action = node.onDialogEndAction;
    const actionId = action.type === "open_menu" ? action.menuId : action.eventId;
    const option = MENU_NODE_OPTIONS.find(opt => opt.value === actionId);
    return option?.label ?? actionId;
}

export function createDefaultNode(nodeId: string): AreaDialogNode {
    return {
        id: nodeId,
        speakerId: "innkeeper",
        text: "",
        continueLabel: "Continue",
    };
}

export function createMenuNode(nodeId: string, menuId: AreaDialogMenuId | AreaDialogEventId): AreaDialogNode {
    const action = toDialogEndAction(menuId);
    return {
        id: nodeId,
        speakerId: "innkeeper",
        text: "",
        isMenuNode: true,
        ...(action ? { onDialogEndAction: action } : {}),
    };
}

export function createDefaultDialog(dialogId: string): AreaDialogDefinition {
    const startNodeId = "node_1";
    return {
        id: dialogId,
        startNodeId,
        nodes: {
            [startNodeId]: createDefaultNode(startNodeId),
        },
    };
}

const VALID_MENU_IDS: Set<string> = new Set<AreaDialogMenuId>([
    "controls", "startup_controls", "help", "glossary", "equipment", "save_game", "load_game", "menu", "jukebox",
]);

export function toDialogEndAction(menuId: string): AreaDialogUiAction | undefined {
    if (menuId === "") return undefined;
    if (menuId === "spend_the_night") {
        return {
            type: "event",
            eventId: "spend_the_night",
        };
    }
    if (!VALID_MENU_IDS.has(menuId)) return undefined;
    return {
        type: "open_menu",
        menuId: menuId as AreaDialogMenuId,
    };
}

export function toDialogEndActionMenuId(action: AreaDialogUiAction | undefined): string {
    if (!action) return "";
    if (action.type === "open_menu") return action.menuId;
    return action.eventId;
}

export function createConditionByType(
    conditionType: AreaDialogTriggerCondition["type"],
    defaultLocationId: string
): AreaDialogTriggerCondition {
    if (conditionType === "on_area_load") {
        return { type: "on_area_load" };
    }
    if (conditionType === "enemy_killed") {
        return { type: "enemy_killed", spawnIndex: 0 };
    }
    if (conditionType === "party_enters_location") {
        return { type: "party_enters_location", locationId: defaultLocationId };
    }
    if (conditionType === "party_enters_region") {
        return { type: "party_enters_region", x: 0, z: 0, w: 1, h: 1 };
    }
    if (conditionType === "unit_seen") {
        return { type: "unit_seen", spawnIndex: 0, range: 12 };
    }
    if (conditionType === "npc_engaged") {
        return { type: "npc_engaged", spawnIndex: 0 };
    }
    if (conditionType === "party_out_of_combat_range") {
        return { type: "party_out_of_combat_range", range: 12 };
    }
    return { type: "after_delay", ms: 1000 };
}

export function getTriggerStartDialogId(trigger: AreaDialogTrigger): string {
    const action = trigger.actions?.find(candidate => candidate.type === "start_dialog");
    if (action) return action.dialogId;
    return trigger.dialogId ?? "";
}

export function isDialogConditionValid(
    condition: AreaDialogTriggerCondition,
    enemySpawnOptions: EnemySpawnOption[],
    dialogLocations: AreaLocation[],
    mapWidth: number,
    mapHeight: number
): boolean {
    if (condition.type === "on_area_load") return true;
    if (condition.type === "enemy_killed") {
        return enemySpawnOptions.some(spawn => spawn.spawnIndex === condition.spawnIndex);
    }
    if (condition.type === "party_enters_location") {
        const locationId = condition.locationId.trim();
        if (locationId.length === 0) return false;
        return dialogLocations.some(location => location.id === locationId);
    }
    if (condition.type === "party_enters_region") {
        return condition.w >= 1
            && condition.h >= 1
            && condition.x >= 0
            && condition.z >= 0
            && condition.x < mapWidth
            && condition.z < mapHeight;
    }
    if (condition.type === "unit_seen") {
        return enemySpawnOptions.some(spawn => spawn.spawnIndex === condition.spawnIndex)
            && (condition.range ?? 12) > 0;
    }
    if (condition.type === "npc_engaged") {
        return enemySpawnOptions.some(
            spawn => spawn.spawnIndex === condition.spawnIndex && spawn.enemyType === "innkeeper"
        );
    }
    if (condition.type === "party_out_of_combat_range") {
        return condition.range > 0;
    }
    return condition.ms >= 0;
}

export function isDialogSpeakerId(value: string): value is DialogSpeakerId {
    return Object.prototype.hasOwnProperty.call(DIALOG_SPEAKERS, value);
}

export function stripInvalidNodeLinks(nodesById: Record<string, AreaDialogNode>): Record<string, AreaDialogNode> {
    const validNodeIds = new Set(Object.keys(nodesById));
    const nextNodes: Record<string, AreaDialogNode> = {};

    Object.values(nodesById).forEach(node => {
        const nextNodeId = node.nextNodeId && validNodeIds.has(node.nextNodeId) ? node.nextNodeId : undefined;
        const nextChoices = (node.choices ?? []).map(choice => {
            const choiceNextNodeId = choice.nextNodeId && validNodeIds.has(choice.nextNodeId) ? choice.nextNodeId : undefined;
            return {
                id: choice.id,
                label: choice.label,
                ...(choiceNextNodeId ? { nextNodeId: choiceNextNodeId } : {}),
                ...(choice.conditions && choice.conditions.length > 0 ? { conditions: choice.conditions.map(condition => ({ ...condition })) } : {}),
                ...(choice.onDialogEndAction ? { onDialogEndAction: { ...choice.onDialogEndAction } } : {}),
            };
        });

        nextNodes[node.id] = {
            ...node,
            ...(nextNodeId ? { nextNodeId } : {}),
            ...(nextChoices.length > 0 ? { choices: nextChoices } : {}),
            ...(node.onDialogEndAction ? { onDialogEndAction: { ...node.onDialogEndAction } } : {}),
        };
    });

    return nextNodes;
}

export function listNodeIds(dialog: AreaDialogDefinition | null): string[] {
    if (!dialog) return [];
    return Object.keys(dialog.nodes).sort((a, b) => a.localeCompare(b));
}

export function buildValidationErrors(dialogs: AreaDialogDefinition[]): string[] {
    const errors: string[] = [];
    const seenDialogIds = new Set<string>();

    dialogs.forEach((dialog, dialogIndex) => {
        const dialogLabel = dialog.id.trim().length > 0 ? dialog.id : `#${dialogIndex + 1}`;
        if (dialog.id.trim().length === 0) {
            errors.push(`Dialog ${dialogLabel} has an empty ID.`);
        } else if (seenDialogIds.has(dialog.id)) {
            errors.push(`Duplicate dialog ID "${dialog.id}".`);
        } else {
            seenDialogIds.add(dialog.id);
        }

        const nodeIds = Object.keys(dialog.nodes);
        if (nodeIds.length === 0) {
            errors.push(`Dialog "${dialogLabel}" has no nodes.`);
            return;
        }

        if (!dialog.nodes[dialog.startNodeId]) {
            errors.push(`Dialog "${dialogLabel}" start node "${dialog.startNodeId}" does not exist.`);
        }

        const seenNodeIds = new Set<string>();
        nodeIds.forEach(nodeId => {
            const node = dialog.nodes[nodeId];
            if (node.id.trim().length === 0) {
                errors.push(`Dialog "${dialogLabel}" contains a node with an empty ID.`);
            } else if (seenNodeIds.has(node.id)) {
                errors.push(`Dialog "${dialogLabel}" has duplicate node ID "${node.id}".`);
            } else {
                seenNodeIds.add(node.id);
            }

            if (node.nextNodeId && !dialog.nodes[node.nextNodeId]) {
                errors.push(`Dialog "${dialogLabel}" node "${node.id}" points to missing next node "${node.nextNodeId}".`);
            }

            const seenChoiceIds = new Set<string>();
            (node.choices ?? []).forEach(choice => {
                if (choice.id.trim().length === 0) {
                    errors.push(`Dialog "${dialogLabel}" node "${node.id}" has a choice with an empty ID.`);
                } else if (seenChoiceIds.has(choice.id)) {
                    errors.push(`Dialog "${dialogLabel}" node "${node.id}" has duplicate choice ID "${choice.id}".`);
                } else {
                    seenChoiceIds.add(choice.id);
                }

                if (choice.nextNodeId && !dialog.nodes[choice.nextNodeId]) {
                    errors.push(`Dialog "${dialogLabel}" node "${node.id}" choice "${choice.id}" points to missing node "${choice.nextNodeId}".`);
                }
            });
        });
    });

    return errors;
}

export function getNodePreview(text: string): string {
    const compact = text.replace(/\s+/g, " ").trim();
    if (compact.length <= 46) return compact;
    return `${compact.slice(0, 43)}...`;
}

export function getTriggerConditionTypeLabel(conditionType: AreaDialogTriggerCondition["type"]): string {
    if (conditionType === "on_area_load") return "When Area Loads";
    if (conditionType === "enemy_killed") return "When Specific Enemy Dies";
    if (conditionType === "party_enters_location") return "When Party Enters Named Location";
    if (conditionType === "party_enters_region") return "When Party Enters Region";
    if (conditionType === "unit_seen") return "When Party Sees Enemy";
    if (conditionType === "npc_engaged") return "When NPC Is Engaged";
    if (conditionType === "party_out_of_combat_range") return "When Party Is Out Of Combat Range";
    return "After Delay";
}

export function describeTriggerCondition(
    condition: AreaDialogTriggerCondition,
    spawnLabelByIndex: Map<number, string>,
    locationLabelById: Map<string, string>
): string {
    if (condition.type === "on_area_load") {
        return "Fires immediately after this area loads.";
    }
    if (condition.type === "enemy_killed") {
        const spawnLabel = spawnLabelByIndex.get(condition.spawnIndex) ?? `#${condition.spawnIndex} (missing spawn)`;
        return `Enemy is killed: ${spawnLabel}.`;
    }
    if (condition.type === "party_enters_location") {
        const locationLabel = locationLabelById.get(condition.locationId) ?? `${condition.locationId} (missing location)`;
        return `Party enters location: ${locationLabel}.`;
    }
    if (condition.type === "party_enters_region") {
        return `Party enters region at (${condition.x}, ${condition.z}) sized ${condition.w}x${condition.h}.`;
    }
    if (condition.type === "unit_seen") {
        const spawnLabel = spawnLabelByIndex.get(condition.spawnIndex) ?? `#${condition.spawnIndex} (missing spawn)`;
        return `Party sees enemy ${spawnLabel} within ${condition.range ?? 12} range.`;
    }
    if (condition.type === "npc_engaged") {
        const spawnLabel = spawnLabelByIndex.get(condition.spawnIndex) ?? `#${condition.spawnIndex} (missing spawn)`;
        return `A nearby party member clicks NPC ${spawnLabel}.`;
    }
    if (condition.type === "party_out_of_combat_range") {
        return `No living enemy is within ${condition.range} range of the party.`;
    }
    return `Wait ${condition.ms}ms after area load.`;
}
