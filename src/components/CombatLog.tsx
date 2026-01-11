import { useRef, useEffect } from "react";
import type { CombatLogEntry } from "../types";

interface CombatLogProps {
    log: CombatLogEntry[];
}

export function CombatLog({ log }: CombatLogProps) {
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [log]);
    return (
        <div ref={ref} style={{ position: "absolute", bottom: 100, left: 10, width: 280, maxHeight: 150, background: "rgba(0,0,0,0.8)", border: "1px solid #333", borderRadius: 4, padding: 8, fontFamily: "monospace", fontSize: 11, color: "#ccc", overflowY: "auto" }}>
            {log.slice(-20).map((entry: CombatLogEntry, i: number) => (<div key={i} style={{ marginBottom: 4, color: entry.color || "#ccc" }}>{entry.text}</div>))}
        </div>
    );
}
