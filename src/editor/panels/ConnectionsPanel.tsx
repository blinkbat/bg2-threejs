// =============================================================================
// CONNECTIONS PANEL - Shows transitions in/out of current area
// =============================================================================

import { AREAS, getAllAreaIds } from "../../game/areas";
import type { EntityDef } from "../types";

interface ConnectionsPanelProps {
    currentAreaId: string;
    entities: EntityDef[];
    onEditTransition: (entity: EntityDef, screenX: number, screenY: number) => void;
    onNavigate: (areaId: string) => void;
}

export function ConnectionsPanel({ currentAreaId, entities, onEditTransition, onNavigate }: ConnectionsPanelProps) {
    // Get outgoing transitions from current area's entities
    const outgoing = entities.filter(e => e.type === "transition");

    // Get incoming transitions by scanning all other areas
    const incoming: { sourceArea: string; x: number; z: number; spawnX: number; spawnZ: number }[] = [];
    for (const areaId of getAllAreaIds()) {
        if (areaId === currentAreaId) continue;
        const area = AREAS[areaId];
        if (!area) continue;
        for (const trans of area.transitions) {
            if (trans.targetArea === currentAreaId) {
                incoming.push({
                    sourceArea: areaId,
                    x: trans.x,
                    z: trans.z,
                    spawnX: trans.targetSpawn.x,
                    spawnZ: trans.targetSpawn.z,
                });
            }
        }
    }

    return (
        <div>
            <h3 style={{ margin: "0 0 12px", fontSize: 16 }}>Connections</h3>

            {/* Outgoing Transitions */}
            <div style={{ marginBottom: 16 }}>
                <h4 style={{ margin: "0 0 8px", fontSize: 13, color: "#8cf" }}>
                    Outgoing ({outgoing.length})
                </h4>
                {outgoing.length === 0 ? (
                    <div style={{ fontSize: 12, color: "#888" }}>No transitions</div>
                ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {outgoing.map(entity => (
                            <div
                                key={entity.id}
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 8,
                                    padding: "6px 8px",
                                    background: "#333",
                                    borderRadius: 4,
                                    fontSize: 12,
                                }}
                            >
                                <span style={{ flex: 1 }}>
                                    ({entity.x}, {entity.z}) → <strong>{entity.transitionTarget}</strong>
                                </span>
                                <button
                                    onClick={() => onEditTransition(entity, 400, 300)}
                                    style={{
                                        padding: "3px 6px",
                                        fontSize: 10,
                                        background: "#555",
                                        color: "#fff",
                                        border: "none",
                                        borderRadius: 3,
                                        cursor: "pointer",
                                    }}
                                >
                                    Edit
                                </button>
                                {entity.transitionTarget && (
                                    <button
                                        onClick={() => onNavigate(entity.transitionTarget!)}
                                        style={{
                                            padding: "3px 6px",
                                            fontSize: 10,
                                            background: "#48f",
                                            color: "#fff",
                                            border: "none",
                                            borderRadius: 3,
                                            cursor: "pointer",
                                        }}
                                    >
                                        Go
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Incoming Transitions */}
            <div>
                <h4 style={{ margin: "0 0 8px", fontSize: 13, color: "#fc8" }}>
                    Incoming ({incoming.length})
                </h4>
                {incoming.length === 0 ? (
                    <div style={{ fontSize: 12, color: "#888" }}>No incoming transitions</div>
                ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {incoming.map((trans, i) => (
                            <div
                                key={i}
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 8,
                                    padding: "6px 8px",
                                    background: "#333",
                                    borderRadius: 4,
                                    fontSize: 12,
                                }}
                            >
                                <span style={{ flex: 1 }}>
                                    <strong>{trans.sourceArea}</strong> → spawn at ({trans.spawnX}, {trans.spawnZ})
                                </span>
                                <button
                                    onClick={() => onNavigate(trans.sourceArea)}
                                    style={{
                                        padding: "3px 6px",
                                        fontSize: 10,
                                        background: "#48f",
                                        color: "#fff",
                                        border: "none",
                                        borderRadius: 3,
                                        cursor: "pointer",
                                    }}
                                >
                                    Go
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
