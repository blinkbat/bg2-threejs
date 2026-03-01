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
export type DialogEventId = "spend_the_night";

export interface DialogOpenMenuAction {
    type: "open_menu";
    menuId: DialogMenuId;
}

export interface DialogEventAction {
    type: "event";
    eventId: DialogEventId;
}

export type DialogUiAction = DialogOpenMenuAction | DialogEventAction;

export interface DialogChoicePartyGatheredCondition {
    type: "party_is_gathered";
    maxDistance?: number;
    disabledMessage?: string;
}

export interface DialogChoicePartyHasGoldCondition {
    type: "party_has_gold";
    amount: number;
    disabledMessage?: string;
}

export type DialogChoiceCondition =
    | DialogChoicePartyGatheredCondition
    | DialogChoicePartyHasGoldCondition;

export interface DialogChoice {
    id: string;
    label: string;
    nextNodeId?: string;
    conditions?: DialogChoiceCondition[];
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
