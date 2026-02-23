import type { DialogDefinition } from "./types";

const dialogDefinitionsById: Record<string, DialogDefinition> = {};

export function getDialogDefinitionById(dialogId: string): DialogDefinition | undefined {
    return dialogDefinitionsById[dialogId];
}

export function getDialogDefinitionIds(): string[] {
    return Object.keys(dialogDefinitionsById).sort((a, b) => a.localeCompare(b));
}

export function getAllDialogDefinitions(): DialogDefinition[] {
    return getDialogDefinitionIds()
        .map(id => dialogDefinitionsById[id])
        .filter((definition): definition is DialogDefinition => definition !== undefined);
}
