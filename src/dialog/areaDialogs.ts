import type { AreaDialogChoice, AreaDialogDefinition, AreaDialogNode, AreaDialogUiAction } from "../game/areas/types";
import { DIALOG_SPEAKERS } from "./speakers";
import type { DialogChoice, DialogDefinition, DialogNode, DialogUiAction } from "./types";

function cloneDialogUiAction(action: AreaDialogUiAction | undefined): DialogUiAction | undefined {
    if (!action) return undefined;
    if (action.type === "open_menu") {
        return {
            type: "open_menu",
            menuId: action.menuId,
            ...(action.chainAction ? { chainAction: { ...action.chainAction } } : {}),
        };
    }
    return {
        type: "event",
        eventId: action.eventId,
        ...(action.goldCost !== undefined ? { goldCost: action.goldCost } : {}),
    };
}

function cloneAreaDialogChoice(choice: AreaDialogChoice): DialogChoice {
    const nextNodeId = choice.nextNodeId?.trim();
    return {
        id: choice.id,
        label: choice.label,
        ...(nextNodeId ? { nextNodeId } : {}),
        ...(choice.conditions && choice.conditions.length > 0 ? { conditions: choice.conditions.map(condition => ({ ...condition })) } : {}),
        ...(choice.onDialogEndAction ? { onDialogEndAction: cloneDialogUiAction(choice.onDialogEndAction) } : {}),
    };
}

function cloneAreaDialogNode(node: AreaDialogNode): DialogNode {
    const nextNodeId = node.nextNodeId?.trim();
    const choices = (node.choices ?? [])
        .map(cloneAreaDialogChoice);

    return {
        id: node.id,
        speakerId: node.speakerId,
        text: node.text,
        ...(choices.length > 0 ? { choices } : {}),
        ...(nextNodeId ? { nextNodeId } : {}),
        ...(node.continueLabel ? { continueLabel: node.continueLabel } : {}),
        ...(node.onDialogEndAction ? { onDialogEndAction: cloneDialogUiAction(node.onDialogEndAction) } : {}),
        ...(node.isMenuNode ? { isMenuNode: true } : {}),
    };
}

function areaDialogToRuntimeDefinition(areaDialog: AreaDialogDefinition): DialogDefinition {
    const nodes: Record<string, DialogNode> = {};

    for (const node of Object.values(areaDialog.nodes)) {
        const runtimeNode = cloneAreaDialogNode(node);
        nodes[runtimeNode.id] = runtimeNode;
    }

    const nodeIds = Object.keys(nodes);
    const startNodeId = nodes[areaDialog.startNodeId]
        ? areaDialog.startNodeId
        : (nodeIds[0] ?? areaDialog.startNodeId);

    return {
        id: areaDialog.id,
        startNodeId,
        speakers: DIALOG_SPEAKERS,
        nodes,
    };
}

export function buildAreaDialogDefinitionMap(areaDialogs: AreaDialogDefinition[] | undefined): Map<string, DialogDefinition> {
    const definitions = new Map<string, DialogDefinition>();
    if (!areaDialogs || areaDialogs.length === 0) {
        return definitions;
    }

    areaDialogs.forEach(areaDialog => {
        const definition = areaDialogToRuntimeDefinition(areaDialog);
        definitions.set(definition.id, definition);
    });

    return definitions;
}
