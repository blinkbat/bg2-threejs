import { ModalShell } from "./ModalShell";

interface HelpModalProps {
    onClose: () => void;
}

const HELP_SECTIONS: ReadonlyArray<{ title: string; body: string }> = [
    {
        title: "On Pausing",
        body: "The game proceeds in real-time but can be paused at any moment to issue commands. A character's actions, from attacking to using items to complex spells, can be selected while paused or unpaused. Most actions have a cooldown, but the next action can be queued during this time. Each unit can hold one queued command at a time, and you can cancel a queued skill or item by clicking its QUEUED entry again in that unit's panel."
    },
    {
        title: "Stat Points",
        body: "Characters gain stat points when they level up. Open a character's Status tab and spend them to raise Strength, Dexterity, Vitality, Intelligence, or Faith. The bonuses apply immediately and are permanent."
    },
    {
        title: "Skills",
        body: "Each character has a basic attack and a set of class skills. Skills cost mana and have a cooldown after use. Some skills target enemies, some target allies or the caster, and some hit an area. Damage skills can deal physical, fire, cold, lightning, chaos, or holy damage. Cantrip skills use limited charges instead of mana and cooldowns."
    },
    {
        title: "Skill Points",
        body: "Characters earn skill points when they level up. Open a character's Skills tab to see the available class skills and spend points to learn new ones. Once learned, a skill is permanent and appears in the character's action bar."
    },
    {
        title: "Status Effects",
        body: "Status effects are temporary conditions that change how a character fights or survives. Poison, stun, slow, regeneration, and similar effects take hold immediately, then wear off or get removed by other abilities. Active effects are shown on the party bar and in the character panel."
    },
    {
        title: "Death",
        body: "A character at 0 HP is dead and cannot act. Dead allies remain down until revived by a skill or item. If the entire party dies, the fight is lost."
    },
    {
        title: "Save/Load",
        body: "The game can be saved or loaded from the menu. Saving is disabled while units are engaged in combat or enemies are nearby. Loading replaces the current run with the selected save."
    }
];

export function HelpModal({ onClose }: HelpModalProps) {
    return (
        <ModalShell onClose={onClose} contentClassName="help-modal" closeOnEscape>
                <div className="help-header">
                    <h2 className="help-title">Help</h2>
                    <div className="close-btn" onClick={onClose}>&times;</div>
                </div>

                <div className="help-copy-layout">
                    {HELP_SECTIONS.map(section => (
                        <div key={section.title} className="help-section help-copy-section">
                            <div className="help-section-title">{section.title}</div>
                            <p className="help-copy-text">{section.body}</p>
                        </div>
                    ))}
                </div>

                <div className="help-footer">
                    <button className="btn btn-primary mono help-confirm-btn" onClick={onClose}>
                        Got It
                    </button>
                </div>
        </ModalShell>
    );
}
