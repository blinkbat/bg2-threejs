import { Swords, Square, Shield } from "lucide-react";

interface CommandBarProps {
    commandMode: "attackMove" | null;
    onStop: () => void;
    onHold: () => void;
    onAttackMove: () => void;
    hasSelection: boolean;
    holdActive: boolean;
}

export function CommandBar({
    commandMode, onStop, onHold, onAttackMove,
    hasSelection, holdActive
}: CommandBarProps) {
    if (!hasSelection) return null;

    return (
        <div className="command-bar glass-panel">
            <button
                className={`cmd-btn${commandMode === "attackMove" ? " cmd-active" : ""}`}
                onClick={onAttackMove}
                title="Attack-Move (A)"
            >
                <Swords size={18} />
            </button>
            <button
                className="cmd-btn"
                onClick={onStop}
                title="Stop (S)"
            >
                <Square size={16} />
            </button>
            <button
                className={`cmd-btn${holdActive ? " cmd-active" : ""}`}
                onClick={onHold}
                title="Hold Position (H)"
            >
                <Shield size={18} />
            </button>
        </div>
    );
}
