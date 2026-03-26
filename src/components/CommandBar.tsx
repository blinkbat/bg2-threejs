import { memo } from "react";
import { Swords, Square, Shield, UsersRound, X, Brain } from "lucide-react";

interface CommandBarProps {
    commandMode: "attackMove" | null;
    onStop: () => void;
    onHold: () => void;
    onAttackMove: () => void;
    onSelectAll: () => void;
    onDeselectAll: () => void;
    onToggleAutoAttack: () => void;
    hasSelection: boolean;
    holdActive: boolean;
    partyAutoAttackActive: boolean;
}

export const CommandBar = memo(function CommandBar({
    commandMode, onStop, onHold, onAttackMove,
    onSelectAll, onDeselectAll, onToggleAutoAttack,
    hasSelection, holdActive, partyAutoAttackActive
}: CommandBarProps) {
    return (
        <div className="command-bar glass-panel">
            <button
                className={`cmd-btn${commandMode === "attackMove" ? " cmd-active" : ""}`}
                onClick={onAttackMove}
                title="Attack-Move (A)"
                disabled={!hasSelection}
            >
                <Swords size={18} />
            </button>
            <button
                className="cmd-btn"
                onClick={onStop}
                title="Stop (S)"
                disabled={!hasSelection}
            >
                <Square size={16} />
            </button>
            <button
                className={`cmd-btn${holdActive ? " cmd-active" : ""}`}
                onClick={onHold}
                title="Hold Position (H)"
                disabled={!hasSelection}
            >
                <Shield size={18} />
            </button>
            <button
                className="cmd-btn"
                onClick={onSelectAll}
                title="Select All (G)"
            >
                <UsersRound size={16} />
            </button>
            <button
                className="cmd-btn"
                onClick={onDeselectAll}
                title="Deselect All (D)"
            >
                <X size={16} />
            </button>
            <button
                className={`cmd-btn${partyAutoAttackActive ? " cmd-active" : ""}`}
                onClick={onToggleAutoAttack}
                title="Toggle Party Auto-Attack"
            >
                <Brain size={16} />
            </button>
        </div>
    );
});
