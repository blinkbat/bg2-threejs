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

export interface DialogChoice {
    id: string;
    label: string;
    nextNodeId?: string;
}

export interface DialogNode {
    id: string;
    speakerId: DialogSpeakerId;
    text: string;
    choices?: DialogChoice[];
    nextNodeId?: string;
    continueLabel?: string;
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
