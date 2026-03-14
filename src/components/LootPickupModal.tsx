import { useEffect } from "react";

interface LootPickupModalEntry {
    label: string;
    tone: "gold" | "item";
}

interface LootPickupModalProps {
    sourceLabel: string;
    entries: LootPickupModalEntry[];
    onTake: () => void;
}

export function LootPickupModal({
    sourceLabel,
    entries,
    onTake
}: LootPickupModalProps) {
    useEffect(() => {
        const onKeyDownCapture = (event: KeyboardEvent) => {
            if (event.key !== " " && event.key !== "Enter") {
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            onTake();
        };

        window.addEventListener("keydown", onKeyDownCapture, true);
        return () => window.removeEventListener("keydown", onKeyDownCapture, true);
    }, [onTake]);

    return (
        <div className="modal-overlay loot-pickup-overlay">
            <div className="modal-content loot-pickup-modal" onClick={event => event.stopPropagation()}>
                <div className="loot-pickup-header">
                    <div className="loot-pickup-title">{sourceLabel}</div>
                    <div className="loot-pickup-subtitle">You receive:</div>
                </div>

                <div className="loot-pickup-body">
                    <div className="loot-pickup-list">
                        {entries.map((entry, index) => (
                            <div
                                key={`${entry.label}-${index}`}
                                className={`loot-pickup-entry loot-pickup-entry--${entry.tone}`}
                            >
                                {entry.label}
                            </div>
                        ))}
                    </div>
                </div>

                <div className="loot-pickup-footer">
                    <button
                        type="button"
                        className="dialog-choice-btn loot-pickup-btn"
                        onClick={onTake}
                    >
                        Take
                    </button>
                    <div className="dialog-keyhint">Space / Enter to take</div>
                </div>
            </div>
        </div>
    );
}
