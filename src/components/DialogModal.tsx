import { useEffect, type CSSProperties } from "react";
import type { DialogChoice } from "../dialog/types";

export interface DialogChoiceOption {
    choice: DialogChoice;
    disabled: boolean;
    disabledReason?: string;
}

interface DialogModalProps {
    speakerName: string;
    portraitSrc: string;
    portraitTint: string;
    visibleText: string;
    isTyping: boolean;
    choices: DialogChoiceOption[];
    canContinueWithoutChoices: boolean;
    continueLabel: string;
    onSkipTyping: () => void;
    onSkipDialog: () => void;
    onContinueWithoutChoices: () => void;
    onChoose: (choiceId: string) => void;
}

export function DialogModal({
    speakerName,
    portraitSrc,
    portraitTint,
    visibleText,
    isTyping,
    choices,
    canContinueWithoutChoices,
    continueLabel,
    onSkipTyping,
    onSkipDialog,
    onContinueWithoutChoices,
    onChoose,
}: DialogModalProps) {
    const hasChoices = choices.length > 0;
    const hasEnabledChoices = choices.some(choice => !choice.disabled);
    const keyHintText = isTyping
        ? "Space / Enter to skip text, Esc to skip dialog"
        : hasChoices
            ? (hasEnabledChoices
                ? "Press 1-9 or click a choice, Esc to skip dialog"
                : "No valid choices right now, Esc to skip dialog")
            : "Space / Enter to continue, Esc to skip dialog";

    useEffect(() => {
        const onKeyDownCapture = (event: KeyboardEvent) => {
            const key = event.key;
            const isSpaceOrEnter = key === " " || key === "Enter";
            const isEscape = key === "Escape";
            const isDigit = /^([1-9])$/.test(key);

            if (!isSpaceOrEnter && !isEscape && !isDigit) return;

            event.preventDefault();
            event.stopPropagation();

            if (isEscape) {
                onSkipDialog();
                return;
            }

            if (isSpaceOrEnter) {
                if (isTyping) {
                    onSkipTyping();
                    return;
                }

                if (canContinueWithoutChoices) {
                    onContinueWithoutChoices();
                }
                return;
            }

            if (!isTyping) {
                const choiceIndex = Number(key) - 1;
                const choice = choices[choiceIndex];
                if (choice && !choice.disabled) {
                    onChoose(choice.choice.id);
                }
            }
        };

        window.addEventListener("keydown", onKeyDownCapture, true);
        return () => window.removeEventListener("keydown", onKeyDownCapture, true);
    }, [isTyping, canContinueWithoutChoices, choices, onSkipTyping, onSkipDialog, onContinueWithoutChoices, onChoose]);

    return (
        <div className="modal-overlay dialog-overlay">
            <div className="modal-content dialog-modal" onClick={event => event.stopPropagation()}>
                <div className="dialog-header">
                    <div className="dialog-portrait-frame" style={{ "--dialog-portrait-tint": portraitTint } as CSSProperties}>
                        <img className="dialog-portrait" src={portraitSrc} alt={`${speakerName} portrait`} />
                        <div className="dialog-portrait-tint" />
                    </div>
                    <div className="dialog-header-text">
                        <div className="dialog-speaker">{speakerName}</div>
                    </div>
                </div>

                <div className="dialog-body">
                    {visibleText}
                    {isTyping && <span className="dialog-caret">|</span>}
                </div>

                <div className="dialog-controls">
                    {isTyping ? null : hasChoices ? (
                        <>
                            <div className="dialog-choices">
                                {choices.map((choice, index) => (
                                    <div key={choice.choice.id} className="dialog-choice-item">
                                        <button
                                            className="dialog-choice-btn"
                                            onClick={() => onChoose(choice.choice.id)}
                                            disabled={isTyping || choice.disabled}
                                        >
                                            <span className="dialog-choice-index">{index + 1}.</span> {choice.disabledReason ?? choice.choice.label}
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </>
                    ) : (
                        <div className="dialog-continue-row">
                            <button
                                className="dialog-choice-btn dialog-continue-btn"
                                onClick={onContinueWithoutChoices}
                                disabled={isTyping || !canContinueWithoutChoices}
                            >
                                {canContinueWithoutChoices ? continueLabel : "Close"}
                            </button>
                        </div>
                    )}
                </div>
                <div className="dialog-keyhint dialog-keyhint-fixed">{keyHintText}</div>
            </div>
        </div>
    );
}
