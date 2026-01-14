import { useRef, useEffect } from "react";
import type { CombatLogEntry } from "../core/types";

interface CombatLogProps {
    log: CombatLogEntry[];
}

export function CombatLog({ log }: CombatLogProps) {
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [log]);

    return (
        <div ref={ref} className="combat-log glass-panel-light">
            {log.slice(-50).map((entry: CombatLogEntry, i: number) => (
                <div key={i} className="log-entry" style={{ color: entry.color || "#ccc" }}>
                    {entry.text}
                </div>
            ))}
        </div>
    );
}
