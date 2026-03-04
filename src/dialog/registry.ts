import type { DialogDefinition } from "./types";

const dialogDefinitionsById: Record<string, DialogDefinition> = {};

export function getDialogDefinitionById(dialogId: string): DialogDefinition | undefined {
    return dialogDefinitionsById[dialogId];
}

export function getDialogDefinitionIds(): string[] {
    return Object.keys(dialogDefinitionsById).sort((a, b) => a.localeCompare(b));
}
