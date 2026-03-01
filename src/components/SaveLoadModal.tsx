import { useEffect, useState } from "react";
import {
    type SaveLoadOperationResult,
    type SaveSlotData,
    formatSaveTimestamp,
    getAreaDisplayName,
    getPartyLevel,
    getSaveSlots,
} from "../game/saveLoad";

interface SaveLoadModalProps {
    mode: "save" | "load";
    onClose: () => void;
    onSave: (slot: number) => SaveLoadOperationResult;
    onLoad: (slot: number) => SaveLoadOperationResult;
    onDelete: (slot: number) => SaveLoadOperationResult;
    currentState: SaveSlotData | null;
}

export function SaveLoadModal({ mode, onClose, onSave, onLoad, onDelete, currentState }: SaveLoadModalProps) {
    const slots = getSaveSlots();
    const [error, setError] = useState<string | null>(null);

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

    const finishWithResult = (result: SaveLoadOperationResult): void => {
        if (!result.ok) {
            setError(result.error);
            return;
        }
        setError(null);
        onClose();
    };

    const handleSave = (slot: number): void => {
        if (!currentState) return;

        if (slots[slot] && !confirm("Overwrite this save?")) {
            return;
        }

        finishWithResult(onSave(slot));
    };

    const handleLoad = (slot: number): void => {
        if (!slots[slot]) return;
        finishWithResult(onLoad(slot));
    };

    const handleDelete = (slot: number): void => {
        if (!slots[slot]) return;
        if (!confirm("Delete this save?")) return;
        finishWithResult(onDelete(slot));
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content save-load-modal" onClick={e => e.stopPropagation()}>
                <div className="help-header">
                    <h2 className="help-title">{mode === "save" ? "Save Game" : "Load Game"}</h2>
                    <div className="close-btn" onClick={onClose}>x</div>
                </div>

                {error && (
                    <div className="help-section" style={{ color: "#ef4444", paddingTop: 0 }}>
                        {error}
                    </div>
                )}

                <div className="save-slots">
                    {slots.map((slot, index) => (
                        <SaveSlot
                            key={index}
                            slot={slot}
                            index={index}
                            mode={mode}
                            onSave={() => handleSave(index)}
                            onLoad={() => handleLoad(index)}
                            onDelete={() => handleDelete(index)}
                            canSave={currentState !== null}
                        />
                    ))}
                </div>

                <div className="help-footer">
                    <button className="btn mono" onClick={onClose}>
                        Cancel
                    </button>
                </div>
            </div>
        </div>
    );
}

interface SaveSlotProps {
    slot: SaveSlotData | null;
    index: number;
    mode: "save" | "load";
    onSave: () => void;
    onLoad: () => void;
    onDelete: () => void;
    canSave: boolean;
}

function SaveSlot({ slot, index, mode, onSave, onLoad, onDelete, canSave }: SaveSlotProps) {
    const isEmpty = slot === null;

    return (
        <div className={`save-slot ${isEmpty ? "empty" : ""}`}>
            <div className="save-slot-header">
                <span className="save-slot-number">Slot {index + 1}</span>
                {!isEmpty && (
                    <span className="save-slot-time">{formatSaveTimestamp(slot.timestamp)}</span>
                )}
            </div>

            {isEmpty ? (
                <div className="save-slot-empty">Empty</div>
            ) : (
                <div className="save-slot-info">
                    <div className="save-slot-area">{getAreaDisplayName(slot.currentAreaId)}</div>
                    <div className="save-slot-details">
                        <span>Level {getPartyLevel(slot.players)} Party</span>
                        <span className="save-slot-gold">{slot.gold} gold</span>
                    </div>
                </div>
            )}

            <div className="save-slot-actions">
                {mode === "save" && canSave && (
                    <button className="btn btn-save mono" onClick={onSave}>
                        Save
                    </button>
                )}
                {mode === "load" && !isEmpty && (
                    <button className="btn btn-primary mono" onClick={onLoad}>
                        Load
                    </button>
                )}
                {!isEmpty && (
                    <button className="btn btn-delete mono" onClick={onDelete}>
                        Delete
                    </button>
                )}
            </div>
        </div>
    );
}
