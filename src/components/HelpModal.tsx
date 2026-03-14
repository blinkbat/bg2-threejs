import { useEffect } from "react";

interface HelpModalProps {
    onClose: () => void;
}

const HELP_SECTIONS: ReadonlyArray<{ title: string; body: string }> = [
    {
        title: "On Pausing",
        body: "The game proceeds in real-time but can be paused at any moment to issue commands. A character's actions, from attacking to using items to complex spells, can be selected while paused or unpaused. Most actions have a cooldown, but the next action can be queued during this time."
    },
    {
        title: "Stat Points",
        body: "Characters gain stat points when they level up. Open a character's Status tab and spend them to raise Strength, Dexterity, Vitality, Intelligence, or Faith. The bonuses apply immediately and are permanent."
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
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                onClose();
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [onClose]);

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content help-modal" onClick={event => event.stopPropagation()}>
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
            </div>
        </div>
    );
}
