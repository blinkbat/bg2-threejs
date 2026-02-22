import type { DialogDefinition } from "../types";
import { DIALOG_SPEAKERS } from "../speakers";

export const DEMO_BRANCHING_DIALOG: DialogDefinition = {
    id: "camp-watch-briefing",
    startNodeId: "opening",
    speakers: DIALOG_SPEAKERS,
    nodes: {
        opening: {
            id: "opening",
            speakerId: "innkeeper",
            text: "You lot look ready for trouble. East road's noisy tonight, and not from wagons.",
            nextNodeId: "assessment",
            continueLabel: "Continue",
        },
        assessment: {
            id: "assessment",
            speakerId: "thief",
            text: "I can shadow ahead and mark targets, or we stay tight and drag them into our angle.",
            choices: [
                { id: "press-now", label: "Advance and pressure now.", nextNodeId: "press-branch" },
                { id: "hold-line", label: "Hold line and bait the choke.", nextNodeId: "hold-branch" },
            ],
        },
        "press-branch": {
            id: "press-branch",
            speakerId: "barbarian",
            text: "Finally. Keep them looking at me and hit hard before they can form up.",
            nextNodeId: "final",
            continueLabel: "Continue",
        },
        "hold-branch": {
            id: "hold-branch",
            speakerId: "paladin",
            text: "Disciplined line. Let them commit first, then we collapse the flank together.",
            nextNodeId: "final",
            continueLabel: "Continue",
        },
        final: {
            id: "final",
            speakerId: "innkeeper",
            text: "Good. Try not to bleed on my floor when you come back.",
            continueLabel: "Close",
        },
    },
};
