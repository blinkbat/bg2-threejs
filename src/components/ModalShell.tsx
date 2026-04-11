import { useEffect, type MouseEvent, type ReactNode } from "react";

interface ModalShellProps {
    children: ReactNode;
    onClose?: () => void;
    onProceed?: () => void;
    overlayClassName?: string;
    contentClassName?: string;
    closeOnBackdrop?: boolean;
    closeOnEscape?: boolean;
}

function mergeClassName(baseClassName: string, extraClassName?: string): string {
    return extraClassName ? `${baseClassName} ${extraClassName}` : baseClassName;
}

export function ModalShell({
    children,
    onClose,
    onProceed,
    overlayClassName,
    contentClassName,
    closeOnBackdrop = true,
    closeOnEscape = false,
}: ModalShellProps) {
    useEffect(() => {
        const spaceTarget = onProceed ?? onClose;
        const hasEscape = closeOnEscape && onClose;
        if (!spaceTarget && !hasEscape) return;

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.defaultPrevented) return;

            if (event.key === "Escape" && hasEscape) {
                event.preventDefault();
                event.stopPropagation();
                onClose!();
                return;
            }

            if (event.key === " " && spaceTarget) {
                event.preventDefault();
                event.stopPropagation();
                spaceTarget();
            }
        };

        window.addEventListener("keydown", handleKeyDown, true);
        return () => window.removeEventListener("keydown", handleKeyDown, true);
    }, [closeOnEscape, onClose, onProceed]);

    const handleOverlayClick = (): void => {
        if (!closeOnBackdrop || !onClose) return;
        onClose();
    };

    const handleContentClick = (event: MouseEvent<HTMLDivElement>): void => {
        event.stopPropagation();
    };

    return (
        <div className={mergeClassName("modal-overlay", overlayClassName)} onClick={handleOverlayClick}>
            <div
                className={mergeClassName("modal-content", contentClassName)}
                onClick={handleContentClick}
                role="dialog"
                aria-modal="true"
            >
                {children}
            </div>
        </div>
    );
}
