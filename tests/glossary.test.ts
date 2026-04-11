import { describe, expect, it } from "vitest";
import { GLOSSARY_ENTRIES } from "../src/components/GlossaryModal";

const EXPECTED_STATUS_TERMS = [
    "Blind",
    "Blood Marked",
    "Burn",
    "Channeled",
    "Channeling",
    "Chilled",
    "Cleansed",
    "Constricted",
    "Defiance",
    "Divine Lattice",
    "Doom",
    "Energy Shield",
    "Enraged",
    "Feared",
    "Hamstrung",
    "Highland Defense",
    "Invulnerability",
    "Pinned",
    "Poison",
    "Qi Drain",
    "Regeneration",
    "Shielded",
    "Silenced",
    "Sleep",
    "Slowed",
    "Stunned",
    "Sun Stance",
    "Thorns",
    "Vanquishing Light",
];

const EXPECTED_STAT_TERMS = [
    "Dexterity",
    "Faith",
    "Intelligence",
    "Strength",
    "Vitality"
];

function sortTerms(terms: string[]): string[] {
    return [...terms].sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }));
}

describe("glossary data", () => {
    it("orders entries alphabetically by term", () => {
        const terms = GLOSSARY_ENTRIES.map(entry => entry.term);
        expect(terms).toEqual(sortTerms(terms));
    });

    it("includes every status and stat entry, without per-skill entries", () => {
        const statusTerms = GLOSSARY_ENTRIES
            .filter(entry => entry.category === "Status")
            .map(entry => entry.term);
        const statTerms = GLOSSARY_ENTRIES
            .filter(entry => entry.category === "Stat")
            .map(entry => entry.term);
        const categoryNames = new Set<string>(GLOSSARY_ENTRIES.map(entry => entry.category));

        expect(statusTerms).toEqual(EXPECTED_STATUS_TERMS);
        expect(statTerms).toEqual(EXPECTED_STAT_TERMS);
        expect(categoryNames.has("Skill")).toBe(false);
    });
});
