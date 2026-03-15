import { useEffect, useState } from "react";

interface ControlsModalProps {
    onClose: () => void;
    onConfirm?: () => void;
}

export function ControlsModal({ onClose, onConfirm }: ControlsModalProps) {
    const [showAdvanced, setShowAdvanced] = useState(false);

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

    const handleConfirm = () => {
        if (onConfirm) {
            onConfirm();
            return;
        }
        onClose();
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content help-modal" onClick={event => event.stopPropagation()}>
                <div className="help-header">
                    <h2 className="help-title">Controls</h2>
                    <div className="close-btn" onClick={onClose}>&times;</div>
                </div>

                <div className="help-scroll-area">
                    <div className="help-layout">
                        <div className="help-column">
                            <Section title="Camera">
                                <Item keys="Arrow keys" desc="Pan camera" />
                                <Item keys="Scroll wheel" desc="Zoom in/out" />
                            </Section>

                            <Section title="Selection & Movement">
                                <Item keys="Left-click" desc="Select unit" />
                                <Item keys="Left-click ground" desc="Move selected units" />
                                <Item keys="Left-click enemy" desc="Attack with selected units" />
                                <Item keys="Left-click object" desc="Interact with nearby world objects" />
                            </Section>
                        </div>

                        <div className="help-column">
                            <Section title="Commands">
                                <Item keys="Space" desc="Pause / Unpause" />
                                <Item keys="F1-F6" desc="Select party member" />
                                <Item keys="1-5" desc="Cast hotbar skill" />
                            </Section>
                        </div>
                    </div>

                    {showAdvanced && (
                        <div className="help-layout" style={{ marginTop: 12 }}>
                            <div className="help-column">
                                <Section title="Advanced Camera">
                                    <Item keys="Right-click drag" desc="Pan camera" />
                                </Section>

                                <Section title="Advanced Selection">
                                    <Item keys="Shift + click" desc="Add/remove unit from selection" />
                                    <Item keys="Left-click drag" desc="Box select units" />
                                </Section>
                            </div>

                            <div className="help-column">
                                <Section title="Advanced Commands">
                                    <Item keys="A" desc="Attack-move mode (then click ground)" />
                                    <Item keys="M" desc="Return to normal move mode" />
                                    <Item keys="S" desc="Stop selected units" />
                                    <Item keys="H" desc="Toggle hold position" />
                                </Section>
                            </div>
                        </div>
                    )}
                </div>

                <div className="help-footer" style={{ display: "flex", justifyContent: "center", gap: 12 }}>
                    {!showAdvanced && (
                        <button className="btn btn-secondary mono help-confirm-btn" onClick={() => setShowAdvanced(true)}>
                            Advanced
                        </button>
                    )}
                    <button className="btn btn-primary mono help-confirm-btn" onClick={handleConfirm}>
                        Got It
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
