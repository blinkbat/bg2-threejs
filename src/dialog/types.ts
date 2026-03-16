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

type DialogMenuId = "controls" | "startup_controls" | "help" | "glossary" | "equipment" | "save_game" | "load_game" | "menu" | "jukebox";
type DialogEventId = "spend_the_night";

export type MenuChainAction =
    | { type: "open_menu"; menuId: DialogMenuId }
    | { type: "open_dialog"; dialogId: string; startNodeId?: string };

interface DialogOpenMenuAction {
    type: "open_menu";
    menuId: DialogMenuId;
    chainAction?: MenuChainAction;
}

interface DialogEventAction {
    type: "event";
    eventId: DialogEventId;
}

export type DialogUiAction = DialogOpenMenuAction | DialogEventAction;

interface DialogChoicePartyGatheredCondition {
    type: "party_is_gathered";
    maxDistance?: number;
    disabledMessage?: string;
}

interface DialogChoicePartyHasGoldCondition {
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
    isMenuNode?: boolean;  // When true, dialog auto-closes and fires onDialogEndAction immediately
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
