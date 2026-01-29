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
            <div className="modal-content" onClick={e => e.stopPropagation()}>
                <div className="help-header">
                    <h2 className="help-title">Controls</h2>
                    <div className="close-btn" onClick={onClose}>×</div>
                </div>

                <Section title="Camera">
                    <Item keys="WASD / Arrow Keys" desc="Pan camera" />
                    <Item keys="Right-click drag" desc="Pan camera" />
                    <Item keys="Scroll wheel" desc="Zoom in/out" />
                </Section>

                <Section title="Selection & Movement">
                    <Item keys="Left-click" desc="Select unit" />
                    <Item keys="Shift + click" desc="Add to selection" />
                    <Item keys="Click-drag" desc="Box select units" />
                    <Item keys="Left-click ground" desc="Move selected units" />
                    <Item keys="Left-click enemy" desc="Attack with selected units" />
                </Section>

                <Section title="Combat & Skills">
                    <Item keys="Space" desc="Pause / Unpause" />
                    <Item keys="Click skill in panel" desc="Enter targeting mode" />
                    <Item keys="Left-click to cast" desc="Cast at target location" />
                    <Item keys="Escape / Right-click" desc="Cancel targeting" />
                </Section>

                <div className="help-footer">
                    <button className="btn btn-primary mono" onClick={onClose}>
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
