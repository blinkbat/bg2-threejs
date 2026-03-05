import monkPortrait from "../assets/monk-portrait.png";
import barbarianPortrait from "../assets/barbarian-portrait.png";
import wizardPortrait from "../assets/wizard-portrait.png";
import paladinPortrait from "../assets/paladin-portrait.png";
import thiefPortrait from "../assets/thief-portrait.png";
import clericPortrait from "../assets/cleric-portrait.png";

const CLASS_PORTRAITS: Record<string, string> = {
    Barbarian: barbarianPortrait,
    Wizard: wizardPortrait,
    Paladin: paladinPortrait,
    Thief: thiefPortrait,
    Cleric: clericPortrait,
    Monk: monkPortrait,
    Ancestor: barbarianPortrait,
    "Visha Orb": clericPortrait,
};

export function getPortrait(className: string): string {
    return CLASS_PORTRAITS[className] ?? monkPortrait;
}
