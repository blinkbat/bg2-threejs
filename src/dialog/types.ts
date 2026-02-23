export type DialogSpeakerId =
    | "barbarian"
    | "cleric"
    | "innkeeper"
    | "monk"
    | "paladin"
    | "thief"
    | "wizard";

export interface DialogSpeaker {
    id: DialogSpeakerId;
    name: string;
    portraitSrc: string;
    portraitTint: string;
}

export type DialogMenuId = "controls" | "save_game" | "load_game";

export interface DialogOpenMenuAction {
    type: "open_menu";
    menuId: DialogMenuId;
}

export type DialogUiAction = DialogOpenMenuAction;

export interface DialogChoice {
    id: string;
    label: string;
    nextNodeId?: string;
    onDialogEndAction?: DialogUiAction;
}

export interface DialogNode {
    id: string;
    speakerId: DialogSpeakerId;
    text: string;
    choices?: DialogChoice[];
    nextNodeId?: string;
    continueLabel?: string;
    onDialogEndAction?: DialogUiAction;
}

export interface DialogDefinition {
    id: string;
    startNodeId: string;
    speakers: Partial<Record<DialogSpeakerId, DialogSpeaker>>;
    nodes: Record<string, DialogNode>;
}

export interface DialogState {
    definition: DialogDefinition;
    nodeId: string;
}
