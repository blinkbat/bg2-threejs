import { useEffect, type CSSProperties } from "react";
import type { DialogChoice } from "../dialog/types";

interface DialogModalProps {
    speakerName: string;
    portraitSrc: string;
    portraitTint: string;
    visibleText: string;
    fullText: string;
    isTyping: boolean;
    choices: DialogChoice[];
    canContinueWithoutChoices: boolean;
    continueLabel: string;
    onSkipTyping: () => void;
    onContinueWithoutChoices: () => void;
    onChoose: (choice: DialogChoice) => void;
}

export function DialogModal({
    speakerName,
    portraitSrc,
    portraitTint,
    visibleText,
    fullText,
    isTyping,
    choices,
    canContinueWithoutChoices,
    continueLabel,
    onSkipTyping,
    onContinueWithoutChoices,
    onChoose,
}: DialogModalProps) {
    const hasChoices = choices.length > 0;

    useEffect(() => {
        const onKeyDownCapture = (event: KeyboardEvent) => {
            const key = event.key;
            const isSkipKey = key === " " || key === "Enter" || key === "Escape";
            const isDigit = /^([1-9])$/.test(key);

            if (!isSkipKey && !isDigit) return;

            event.preventDefault();
            event.stopPropagation();

            if (isSkipKey) {
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
                if (choice) {
                    onChoose(choice);
                }
            }
        };

        window.addEventListener("keydown", onKeyDownCapture, true);
        return () => window.removeEventListener("keydown", onKeyDownCapture, true);
    }, [isTyping, canContinueWithoutChoices, choices, onSkipTyping, onContinueWithoutChoices, onChoose]);

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
                        <div className="dialog-hint">
                            {isTyping
                                ? "Space / Enter / Esc to skip"
                                : choices.length > 0
                                    ? "Choose a response"
                                    : "Space / Enter / Esc to continue"}
                        </div>
                    </div>
                </div>

                <div className="dialog-body">
                    {visibleText}
                    {isTyping && <span className="dialog-caret">|</span>}
                </div>

                <div
                    className={`dialog-controls ${isTyping ? "hidden" : ""}`}
                    aria-hidden={isTyping}
                >
                    {hasChoices ? (
                        <div className="dialog-choices">
                            {choices.map((choice, index) => (
                                <button
                                    key={choice.id}
                                    className="dialog-choice-btn"
                                    onClick={() => onChoose(choice)}
                                    disabled={isTyping}
                                >
                                    <span className="dialog-choice-index">{index + 1}.</span> {choice.label}
                                </button>
                            ))}
                        </div>
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

                <div className="dialog-progress">
                    {visibleText.length}/{fullText.length}
                </div>
            </div>
        </div>
    );
}
