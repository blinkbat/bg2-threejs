import { useEffect, type MouseEvent, type ReactNode } from "react";

interface ModalShellProps {
    children: ReactNode;
    onClose?: () => void;
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
    overlayClassName,
    contentClassName,
    closeOnBackdrop = true,
    closeOnEscape = false,
}: ModalShellProps) {
    useEffect(() => {
        if (!onClose || !closeOnEscape) return;

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;

            event.preventDefault();
            event.stopPropagation();
            onClose();
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [closeOnEscape, onClose]);

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
