// =============================================================================
// TREE EDIT POPUP
// =============================================================================

import { useState } from "react";
import type { TreeDef } from "../types";
import { useClampedPosition } from "../hooks/useClampedPosition";
import { popupStyle, inputStyle, buttonStyle } from "../constants";

interface TreeEditPopupProps {
    tree: TreeDef;
    screenX: number;
    screenY: number;
    onSave: (t: TreeDef) => void;
    onClose: () => void;
}

export function TreeEditPopup({ tree, screenX, screenY, onSave, onClose }: TreeEditPopupProps) {
    const [size, setSize] = useState(tree.size);
    const { popupRef, position } = useClampedPosition(screenX, screenY);

    return (
        <div ref={popupRef} style={{ ...popupStyle, left: position.x, top: position.y }} onClick={e => e.stopPropagation()}>
            <h4 style={{ margin: "0 0 12px", fontSize: 15 }}>Edit Tree</h4>
            <label style={{ display: "block", marginBottom: 10 }}>
                <span style={{ fontSize: 12, display: "block", marginBottom: 4 }}>Size</span>
                <input
                    type="number"
                    step="0.1"
                    style={inputStyle}
                    value={size}
                    onChange={e => setSize(parseFloat(e.target.value) || 1)}
                />
            </label>
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button style={{ ...buttonStyle, background: "#4a9", color: "#fff" }} onClick={() => onSave({ ...tree, size })}>Save</button>
                <button style={{ ...buttonStyle, background: "#555", color: "#fff" }} onClick={onClose}>Cancel</button>
            </div>
        </div>
    );
}
