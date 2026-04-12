import { memo } from "react";
import Tippy from "@tippyjs/react";
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
            <Tippy content="Attack-Move (A)" placement="top" delay={[300, 0]}>
                <button
                    className={`cmd-btn${commandMode === "attackMove" ? " cmd-active" : ""}`}
                    onClick={onAttackMove}
                    disabled={!hasSelection}
                >
                    <Swords size={18} />
                </button>
            </Tippy>
            <Tippy content="Stop (S)" placement="top" delay={[300, 0]}>
                <button
                    className="cmd-btn"
                    onClick={onStop}
                    disabled={!hasSelection}
                >
                    <Square size={16} />
                </button>
            </Tippy>
            <Tippy content="Hold Position (H)" placement="top" delay={[300, 0]}>
                <button
                    className={`cmd-btn${holdActive ? " cmd-active" : ""}`}
                    onClick={onHold}
                    disabled={!hasSelection}
                >
                    <Shield size={18} />
                </button>
            </Tippy>
            <Tippy content="Select All (G)" placement="top" delay={[300, 0]}>
                <button
                    className="cmd-btn"
                    onClick={onSelectAll}
                >
                    <UsersRound size={16} />
                </button>
            </Tippy>
            <Tippy content="Deselect All (D)" placement="top" delay={[300, 0]}>
                <button
                    className="cmd-btn"
                    onClick={onDeselectAll}
                >
                    <X size={16} />
                </button>
            </Tippy>
            <Tippy content="Toggle Party Auto-Attack" placement="top" delay={[300, 0]}>
                <button
                    className={`cmd-btn${partyAutoAttackActive ? " cmd-active" : ""}`}
                    onClick={onToggleAutoAttack}
                >
                    <Brain size={16} />
                </button>
            </Tippy>
        </div>
    );
});
