import { useEffect } from "react";

interface HelpModalProps {
    onClose: () => void;
}

export function HelpModal({ onClose }: HelpModalProps) {
    // ESC key to close
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                onClose();
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [onClose]);

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content help-modal" onClick={e => e.stopPropagation()}>
                <div className="help-header">
                    <h2 className="help-title">Controls</h2>
                    <div className="close-btn" onClick={onClose}>&times;</div>
                </div>

                <div className="help-layout">
                    <div className="help-column">
                        <Section title="Camera">
                            <Item keys="Arrow keys" desc="Pan camera" />
                            <Item keys="Right-click drag" desc="Pan camera" />
                            <Item keys="Scroll wheel" desc="Zoom in/out" />
                        </Section>

                        <Section title="Selection & Movement">
                            <Item keys="Left-click" desc="Select unit" />
                            <Item keys="Shift + click" desc="Add/remove unit from selection" />
                            <Item keys="Left-click drag (ground)" desc="Box select units" />
                            <Item keys="Left-click ground" desc="Move selected units" />
                            <Item keys="Left-click enemy" desc="Attack with selected units" />
                            <Item keys="Left-click object" desc="Interact with nearby world objects" />
                        </Section>
                    </div>

                    <div className="help-column">
                        <Section title="Commands & Skills">
                            <Item keys="Space" desc="Pause / Unpause (when no menu is open)" />
                            <Item keys="A" desc="Attack-move mode (then click ground)" />
                            <Item keys="M" desc="Return to normal move mode" />
                            <Item keys="S" desc="Stop selected units" />
                            <Item keys="H" desc="Toggle hold position for selected units" />
                            <Item keys="1-5" desc="Cast assigned hotbar skill (single selected unit)" />
                            <Item keys="F1-F6" desc="Select party member by formation slot" />
                        </Section>
                    </div>
                </div>

                <div className="help-footer">
                    <button className="btn btn-primary mono help-confirm-btn" onClick={onClose}>
                        Got it
                    </button>
                </div>
            </div>
        </div>
    );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div className="help-section">
            <div className="help-section-title">{title}</div>
            <div className="help-items">{children}</div>
        </div>
    );
}

function Item({ keys, desc }: { keys: string; desc: string }) {
    return (
        <div className="help-item">
            <span className="help-key">{keys}</span>
            <span className="help-desc">{desc}</span>
        </div>
    );
}
