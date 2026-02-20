// =============================================================================
// DECORATION EDIT POPUP
// =============================================================================

import { useState } from "react";
import type { DecorationDef } from "../types";
import { useClampedPosition } from "../hooks/useClampedPosition";
import { popupStyle, inputStyle, selectStyle, buttonStyle } from "../constants";

interface DecorationEditPopupProps {
    decoration: DecorationDef;
    screenX: number;
    screenY: number;
    onSave: (d: DecorationDef) => void;
    onClose: () => void;
}

const CARDINAL_ORIENTATION_OPTIONS: Array<{ label: string; value: string; rotation: number }> = [
    { label: "North", value: "north", rotation: 0 },
    { label: "East", value: "east", rotation: Math.PI / 2 },
    { label: "South", value: "south", rotation: Math.PI },
    { label: "West", value: "west", rotation: -Math.PI / 2 },
];

function normalizeAngle(angle: number): number {
    let normalized = angle % (Math.PI * 2);
    if (normalized > Math.PI) normalized -= Math.PI * 2;
    if (normalized < -Math.PI) normalized += Math.PI * 2;
    return normalized;
}

function getClosestCardinalOrientationValue(rotation: number): string {
    const normalized = normalizeAngle(rotation);
    let closest = CARDINAL_ORIENTATION_OPTIONS[0];
    let closestDelta = Number.POSITIVE_INFINITY;
    for (const option of CARDINAL_ORIENTATION_OPTIONS) {
        const delta = Math.abs(normalizeAngle(normalized - option.rotation));
        if (delta < closestDelta) {
            closestDelta = delta;
            closest = option;
        }
    }
    return closest.value;
}

export function DecorationEditPopup({ decoration, screenX, screenY, onSave, onClose }: DecorationEditPopupProps) {
    const [draft, setDraft] = useState({ ...decoration });
    const { popupRef, position } = useClampedPosition(screenX, screenY);
    const showCardinalOrientation = draft.type === "bed" || draft.type === "bookshelf";
    const orientationLabel = draft.type === "bookshelf" ? "Bookshelf Orientation" : "Bed Orientation";

    return (
        <div ref={popupRef} style={{ ...popupStyle, left: position.x, top: position.y }} onClick={e => e.stopPropagation()}>
            <h4 style={{ margin: "0 0 12px", fontSize: 15 }}>Edit Decoration</h4>
            <label style={{ display: "block", marginBottom: 10 }}>
                <span style={{ fontSize: 12, display: "block", marginBottom: 4 }}>Type</span>
                <select
                    style={selectStyle}
                    value={draft.type}
                    onChange={e => setDraft({ ...draft, type: e.target.value as DecorationDef["type"] })}
                >
                    <option value="column">column</option>
                    <option value="broken_column">broken_column</option>
                    <option value="broken_wall">broken_wall</option>
                    <option value="rock">rock</option>
                    <option value="small_rock">small_rock</option>
                    <option value="mushroom">mushroom</option>
                    <option value="small_mushroom">small_mushroom</option>
                    <option value="weeds">weeds</option>
                    <option value="small_weeds">small_weeds</option>
                    <option value="fern">fern</option>
                    <option value="small_fern">small_fern</option>
                    <option value="bookshelf">bookshelf</option>
                    <option value="bar">bar</option>
                    <option value="chair">chair</option>
                    <option value="bed">bed</option>
                </select>
            </label>
            <label style={{ display: "block", marginBottom: 10 }}>
                <span style={{ fontSize: 12, display: "block", marginBottom: 4 }}>Rotation (radians)</span>
                <input
                    type="number"
                    step="0.1"
                    style={inputStyle}
                    value={draft.rotation || 0}
                    onChange={e => setDraft({ ...draft, rotation: parseFloat(e.target.value) || 0 })}
                />
            </label>
            {showCardinalOrientation && (
                <label style={{ display: "block", marginBottom: 10 }}>
                    <span style={{ fontSize: 12, display: "block", marginBottom: 4 }}>{orientationLabel}</span>
                    <select
                        style={selectStyle}
                        value={getClosestCardinalOrientationValue(draft.rotation || 0)}
                        onChange={e => {
                            const chosen = CARDINAL_ORIENTATION_OPTIONS.find(option => option.value === e.target.value);
                            if (!chosen) return;
                            setDraft({ ...draft, rotation: chosen.rotation });
                        }}
                    >
                        {CARDINAL_ORIENTATION_OPTIONS.map(option => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                    </select>
                </label>
            )}
            <label style={{ display: "block", marginBottom: 10 }}>
                <span style={{ fontSize: 12, display: "block", marginBottom: 4 }}>Size</span>
                <input
                    type="number"
                    step="0.1"
                    style={inputStyle}
                    value={draft.size || 1}
                    onChange={e => setDraft({ ...draft, size: parseFloat(e.target.value) || 1 })}
                />
            </label>
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button style={{ ...buttonStyle, background: "#4a9", color: "#fff" }} onClick={() => onSave(draft)}>Save</button>
                <button style={{ ...buttonStyle, background: "#555", color: "#fff" }} onClick={onClose}>Cancel</button>
            </div>
        </div>
    );
}
