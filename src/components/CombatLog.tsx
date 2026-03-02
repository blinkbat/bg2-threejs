import { useRef, useEffect, memo } from "react";
import type { CombatLogEntry } from "../core/types";

interface CombatLogProps {
    log: CombatLogEntry[];
}

function toUiThemeColor(color: string | undefined): string {
    if (!color) return "var(--ui-color-text-secondary)";
    const normalized = color.trim().toLowerCase();
    if (normalized === "#888" || normalized === "#888888") return "var(--ui-color-text-dim)";
    if (normalized === "#ccc") return "var(--ui-color-text-secondary)";
    if (normalized === "#ecf0f1") return "var(--ui-color-text)";
    if (normalized === "#f59e0b") return "var(--ui-color-accent-warning)";
    if (normalized === "#f5d742" || normalized === "#ffd700" || normalized === "#f1c40f") return "var(--ui-color-accent-gold)";
    if (normalized === "#22c55e" || normalized === "#4ade80" || normalized === "#7cba7c") return "var(--ui-color-accent-success)";
    if (normalized === "#3b82f6" || normalized === "#58a6ff") return "var(--ui-color-accent-primary-bright)";
    if (normalized === "#9b59b6") return "var(--ui-color-accent-arcane)";
    if (normalized === "#ef4444") return "var(--ui-color-accent-danger)";
    if (normalized === "#3cb371" || normalized === "#88aa22") return "var(--ui-color-accent-success)";
    if (normalized === "#9966ff" || normalized === "#9932cc" || normalized === "#8b5fbf" || normalized === "#6b3fa0") return "var(--ui-color-accent-arcane)";
    if (normalized === "#5599ff") return "var(--ui-color-accent-primary-bright)";
    if (normalized === "#ff6600" || normalized === "#cc6600") return "var(--ui-color-accent-warning)";
    if (normalized === "#cc3300") return "var(--ui-color-accent-danger)";
    return color;
}

export const CombatLog = memo(function CombatLog({ log }: CombatLogProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const innerRef = useRef<HTMLDivElement>(null);
    const draggingScrollbarRef = useRef(false);
    const dragThumbOffsetRef = useRef(0);
    const suppressNextClickRef = useRef(false);

    useEffect(() => {
        const el = innerRef.current;
        if (!el) return;
        el.scrollTop = el.scrollHeight;
        const frameId = requestAnimationFrame(() => {
            if (!innerRef.current) return;
            innerRef.current.scrollTop = innerRef.current.scrollHeight;
        });
        return () => cancelAnimationFrame(frameId);
    }, [log]);

    useEffect(() => {
        const SCROLLBAR_MIN_HIT_WIDTH = 10;
        const SCROLLBAR_HIT_PADDING = 4;

        const isPointOverLog = (clientX: number, clientY: number): boolean => {
            const container = containerRef.current;
            if (!container) return false;
            const rect = container.getBoundingClientRect();
            return clientX >= rect.left
                && clientX <= rect.right
                && clientY >= rect.top
                && clientY <= rect.bottom;
        };

        const isPointOverScrollbarZone = (clientX: number, clientY: number): boolean => {
            const inner = innerRef.current;
            if (!inner) return false;

            const maxScroll = inner.scrollHeight - inner.clientHeight;
            if (maxScroll <= 0) return false;

            const rect = inner.getBoundingClientRect();
            const inVerticalBounds = clientY >= rect.top && clientY <= rect.bottom;
            if (!inVerticalBounds) return false;

            const nativeScrollbarWidth = Math.max(0, inner.offsetWidth - inner.clientWidth);
            const scrollbarWidth = Math.max(SCROLLBAR_MIN_HIT_WIDTH, nativeScrollbarWidth + SCROLLBAR_HIT_PADDING);
            return clientX >= rect.right - scrollbarWidth && clientX <= rect.right + SCROLLBAR_HIT_PADDING;
        };

        const getScrollMetrics = (): {
            inner: HTMLDivElement;
            innerRect: DOMRect;
            maxScroll: number;
            thumbHeight: number;
            maxThumbTop: number;
            thumbTop: number;
        } | null => {
            const inner = innerRef.current;
            if (!inner) return null;
            const maxScroll = inner.scrollHeight - inner.clientHeight;
            if (maxScroll <= 0) return null;

            const innerRect = inner.getBoundingClientRect();
            const viewportHeight = inner.clientHeight;
            const thumbHeight = Math.max(20, (viewportHeight * viewportHeight) / inner.scrollHeight);
            const maxThumbTop = Math.max(1, viewportHeight - thumbHeight);
            const thumbTop = (inner.scrollTop / maxScroll) * maxThumbTop;

            return { inner, innerRect, maxScroll, thumbHeight, maxThumbTop, thumbTop };
        };

        const scrollFromPointer = (clientY: number): void => {
            const metrics = getScrollMetrics();
            if (!metrics) return;

            const yWithinInner = clientY - metrics.innerRect.top;
            const desiredThumbTop = Math.max(
                0,
                Math.min(metrics.maxThumbTop, yWithinInner - dragThumbOffsetRef.current)
            );
            metrics.inner.scrollTop = (desiredThumbTop / metrics.maxThumbTop) * metrics.maxScroll;
        };

        const wheelOptions: AddEventListenerOptions = { passive: false, capture: true };
        const handleWindowWheel = (e: WheelEvent) => {
            const inner = innerRef.current;
            if (!inner || !isPointOverLog(e.clientX, e.clientY)) return;

            inner.scrollTop += e.deltaY;
            e.preventDefault();
            e.stopPropagation();
        };

        const handleWindowMouseDown = (e: MouseEvent) => {
            if (e.button !== 0 || !isPointOverScrollbarZone(e.clientX, e.clientY)) return;

            const metrics = getScrollMetrics();
            if (!metrics) return;

            const yWithinInner = e.clientY - metrics.innerRect.top;
            const thumbBottom = metrics.thumbTop + metrics.thumbHeight;
            const clickedThumb = yWithinInner >= metrics.thumbTop && yWithinInner <= thumbBottom;

            dragThumbOffsetRef.current = clickedThumb ? yWithinInner - metrics.thumbTop : metrics.thumbHeight * 0.5;
            draggingScrollbarRef.current = true;
            suppressNextClickRef.current = true;
            scrollFromPointer(e.clientY);

            e.preventDefault();
            e.stopPropagation();
        };

        const handleWindowMouseMove = (e: MouseEvent) => {
            if (!draggingScrollbarRef.current) return;
            scrollFromPointer(e.clientY);
            e.preventDefault();
            e.stopPropagation();
        };

        const handleWindowMouseUp = (e: MouseEvent) => {
            if (!draggingScrollbarRef.current) return;
            draggingScrollbarRef.current = false;
            e.preventDefault();
            e.stopPropagation();
        };

        const handleWindowClick = (e: MouseEvent) => {
            if (!suppressNextClickRef.current) return;
            suppressNextClickRef.current = false;
            e.preventDefault();
            e.stopPropagation();
        };

        window.addEventListener("wheel", handleWindowWheel, wheelOptions);
        window.addEventListener("mousedown", handleWindowMouseDown, true);
        window.addEventListener("mousemove", handleWindowMouseMove, true);
        window.addEventListener("mouseup", handleWindowMouseUp, true);
        window.addEventListener("click", handleWindowClick, true);
        return () => {
            window.removeEventListener("wheel", handleWindowWheel, wheelOptions);
            window.removeEventListener("mousedown", handleWindowMouseDown, true);
            window.removeEventListener("mousemove", handleWindowMouseMove, true);
            window.removeEventListener("mouseup", handleWindowMouseUp, true);
            window.removeEventListener("click", handleWindowClick, true);
        };
    }, []);

    return (
        <div ref={containerRef} className="combat-log glass-panel-light">
            <div ref={innerRef} className="combat-log-inner">
                {log.slice(-50).map((entry: CombatLogEntry, i: number) => (
                    <div key={i} className="log-entry" style={{ color: toUiThemeColor(entry.color) }}>
                        {entry.text}
                    </div>
                ))}
            </div>
        </div>
    );
});
