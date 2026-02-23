import barbarianPortrait from "../assets/barbarian-portrait.png";
import clericPortrait from "../assets/cleric-portrait.png";
import dufusPortrait from "../assets/dufus.png";
import monkPortrait from "../assets/monk-portrait.png";
import paladinPortrait from "../assets/paladin-portrait.png";
import thiefPortrait from "../assets/thief-portrait.png";
import wizardPortrait from "../assets/wizard-portrait.png";
import { getPlayerUnitColor } from "../game/unitColors";
import type { DialogSpeaker, DialogSpeakerId } from "./types";

export const DIALOG_SPEAKERS: Record<DialogSpeakerId, DialogSpeaker> = {
    barbarian: {
        id: "barbarian",
        name: "Barbarian",
        portraitSrc: barbarianPortrait,
        portraitTint: getPlayerUnitColor(1),
    },
    cleric: {
        id: "cleric",
        name: "Cleric",
        portraitSrc: clericPortrait,
        portraitTint: getPlayerUnitColor(6),
    },
    innkeeper: {
        id: "innkeeper",
        name: "Innkeeper",
        portraitSrc: dufusPortrait,
        portraitTint: "#8d6f42",
    },
    monk: {
        id: "monk",
        name: "Monk",
        portraitSrc: monkPortrait,
        portraitTint: getPlayerUnitColor(5),
    },
    paladin: {
        id: "paladin",
        name: "Paladin",
        portraitSrc: paladinPortrait,
        portraitTint: getPlayerUnitColor(2),
    },
    thief: {
        id: "thief",
        name: "Thief",
        portraitSrc: thiefPortrait,
        portraitTint: getPlayerUnitColor(3),
    },
    wizard: {
        id: "wizard",
        name: "Wizard",
        portraitSrc: wizardPortrait,
        portraitTint: getPlayerUnitColor(4),
    },
};
