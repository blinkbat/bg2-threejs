// =============================================================================
// USE CLAMPED POSITION HOOK
// =============================================================================

import { useState, useRef, useEffect } from "react";
import { POPUP_MARGIN } from "../constants";

/**
 * Hook to clamp popup position within viewport.
 * Measures the popup element and adjusts position to keep it fully visible.
 */
export function useClampedPosition(screenX: number, screenY: number) {
    const [position, setPosition] = useState({ x: screenX, y: screenY });
    const popupRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const frame = requestAnimationFrame(() => {
            const popup = popupRef.current;
            if (!popup) return;

            const rect = popup.getBoundingClientRect();
            const vw = window.innerWidth;
            const vh = window.innerHeight;

            let x = screenX;
            let y = screenY;

            // Clamp horizontal
            if (x + rect.width + POPUP_MARGIN > vw) {
                x = vw - rect.width - POPUP_MARGIN;
            }
            if (x < POPUP_MARGIN) x = POPUP_MARGIN;

            // Clamp vertical
            if (y + rect.height + POPUP_MARGIN > vh) {
                y = vh - rect.height - POPUP_MARGIN;
            }
            if (y < POPUP_MARGIN) y = POPUP_MARGIN;

            setPosition({ x, y });
        });

        return () => cancelAnimationFrame(frame);
    }, [screenX, screenY]);

    return { popupRef, position };
}
