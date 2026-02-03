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

export function DecorationEditPopup({ decoration, screenX, screenY, onSave, onClose }: DecorationEditPopupProps) {
    const [draft, setDraft] = useState({ ...decoration });
    const { popupRef, position } = useClampedPosition(screenX, screenY);

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
