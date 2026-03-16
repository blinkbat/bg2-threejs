// =============================================================================
// LOCATION EDIT POPUP
// =============================================================================

import { useState } from "react";
import type { AreaLocation } from "../../game/areas/types";
import { popupStyle, inputStyle, buttonStyle } from "../constants";

interface LocationEditPopupProps {
    location: AreaLocation;
    mapWidth: number;
    mapHeight: number;
    onSave: (location: AreaLocation) => void;
    onDelete: () => void;
    onClose: () => void;
}

function parseIntOrFallback(value: string, fallback: number): number {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

export function LocationEditPopup({
    location,
    mapWidth,
    mapHeight,
    onSave,
    onDelete,
    onClose,
}: LocationEditPopupProps) {
    const [draft, setDraft] = useState<AreaLocation>({ ...location });

    return (
        <div style={{ position: "fixed", inset: 0, zIndex: 999, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center" }} onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
        <div style={{ ...popupStyle, position: "relative", maxHeight: "80vh", overflowY: "auto" }}>
            <h4 style={{ margin: "0 0 12px", fontSize: 15 }}>Location Properties</h4>
            <label style={{ display: "block", marginBottom: 10 }}>
                <span style={{ fontSize: 12, display: "block", marginBottom: 4 }}>ID</span>
                <input
                    style={inputStyle}
                    value={draft.id}
                    onChange={event => setDraft(prev => ({ ...prev, id: event.target.value }))}
                />
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
                <label style={{ display: "block", marginBottom: 10 }}>
                    <span style={{ fontSize: 12, display: "block", marginBottom: 4 }}>X</span>
                    <input
                        type="number"
                        min={0}
                        max={Math.max(0, mapWidth - 1)}
                        style={inputStyle}
                        value={draft.x}
                        onChange={event => setDraft(prev => ({ ...prev, x: parseIntOrFallback(event.target.value, prev.x) }))}
                    />
                </label>
                <label style={{ display: "block", marginBottom: 10 }}>
                    <span style={{ fontSize: 12, display: "block", marginBottom: 4 }}>Z</span>
                    <input
                        type="number"
                        min={0}
                        max={Math.max(0, mapHeight - 1)}
                        style={inputStyle}
                        value={draft.z}
                        onChange={event => setDraft(prev => ({ ...prev, z: parseIntOrFallback(event.target.value, prev.z) }))}
                    />
                </label>
                <label style={{ display: "block", marginBottom: 10 }}>
                    <span style={{ fontSize: 12, display: "block", marginBottom: 4 }}>W</span>
                    <input
                        type="number"
                        min={1}
                        max={Math.max(1, mapWidth)}
                        style={inputStyle}
                        value={draft.w}
                        onChange={event => setDraft(prev => ({ ...prev, w: Math.max(1, parseIntOrFallback(event.target.value, prev.w)) }))}
                    />
                </label>
                <label style={{ display: "block", marginBottom: 10 }}>
                    <span style={{ fontSize: 12, display: "block", marginBottom: 4 }}>H</span>
                    <input
                        type="number"
                        min={1}
                        max={Math.max(1, mapHeight)}
                        style={inputStyle}
                        value={draft.h}
                        onChange={event => setDraft(prev => ({ ...prev, h: Math.max(1, parseIntOrFallback(event.target.value, prev.h)) }))}
                    />
                </label>
            </div>
            <div style={{ fontSize: 11, color: "#9ba6c1", marginTop: -2, marginBottom: 10 }}>
                Bounds clamp to map size on save.
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button
                    style={{ ...buttonStyle, background: "#4a9", color: "#fff" }}
                    onClick={() => onSave(draft)}
                >
                    Save
                </button>
                <button
                    style={{ ...buttonStyle, background: "#9a3f4b", color: "#fff" }}
                    onClick={onDelete}
                >
                    Delete
                </button>
                <button
                    style={{ ...buttonStyle, background: "#555", color: "#fff" }}
                    onClick={onClose}
                >
                    Cancel
                </button>
            </div>
        </div>
        </div>
    );
}
