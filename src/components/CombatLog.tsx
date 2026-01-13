import { useRef, useEffect } from "react";
import type { CombatLogEntry } from "../core/types";

interface CombatLogProps {
    log: CombatLogEntry[];
}

const scrollbarStyles = `
.combat-log::-webkit-scrollbar { width: 6px; }
.combat-log::-webkit-scrollbar-track { background: transparent; }
.combat-log::-webkit-scrollbar-thumb { background: #444; border-radius: 3px; }
.combat-log::-webkit-scrollbar-thumb:hover { background: #555; }
`;

export function CombatLog({ log }: CombatLogProps) {
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [log]);
    return (
        <>
            <style>{scrollbarStyles}</style>
            <div ref={ref} className="combat-log" style={{ position: "absolute", bottom: 110, left: 10, width: 340, maxHeight: 260, background: "rgba(15,15,25,0.7)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)", border: "1px solid rgba(60,60,90,0.4)", borderRadius: 6, padding: 10, fontFamily: "monospace", fontSize: 13, color: "#ccc", overflowY: "auto" }}>
                {log.slice(-50).map((entry: CombatLogEntry, i: number) => (<div key={i} style={{ marginBottom: 4, color: entry.color || "#ccc" }}>{entry.text}</div>))}
            </div>
        </>
    );
}
