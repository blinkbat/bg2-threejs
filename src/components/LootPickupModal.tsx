import { useEffect } from "react";
import Tippy from "@tippyjs/react";
import type { LootPickupEntry, LootPickupSourceLabel } from "../core/types";
import { getItem } from "../game/items";
import { ItemTooltip } from "./EquipmentModal";

interface LootPickupModalProps {
    sourceLabel: LootPickupSourceLabel;
    entries: LootPickupEntry[];
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
                    <div className="loot-pickup-subtitle">You found these items:</div>
                </div>

                <div className="loot-pickup-body">
                    <div className="loot-pickup-list">
                        {entries.map((entry, index) => {
                            const item = entry.itemId ? getItem(entry.itemId) : undefined;
                            const entryDiv = (
                                <div
                                    key={`${entry.label}-${index}`}
                                    className={`loot-pickup-entry loot-pickup-entry--${entry.tone}`}
                                >
                                    {entry.label}
                                </div>
                            );

                            if (!item) return entryDiv;

                            return (
                                <Tippy
                                    key={`${entry.label}-${index}`}
                                    content={<ItemTooltip item={item} />}
                                    placement="right"
                                    delay={[0, 0]}
                                >
                                    {entryDiv}
                                </Tippy>
                            );
                        })}
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
