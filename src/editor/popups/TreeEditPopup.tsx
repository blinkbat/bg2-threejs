// =============================================================================
// TREE EDIT POPUP
// =============================================================================

import { useState } from "react";
import type { TreeDef } from "../types";
import { MAX_PINE_TREE_SIZE, MAX_TREE_SIZE, MIN_TREE_SIZE, type TreeType } from "../../game/areas/types";
import { useClampedPosition } from "../hooks/useClampedPosition";
import { popupStyle, inputStyle, selectStyle, buttonStyle } from "../constants";

const TREE_TYPES: TreeType[] = ["pine", "palm", "oak"];

function getTreeMaxSize(treeType: TreeType): number {
    return treeType === "pine" ? MAX_PINE_TREE_SIZE : MAX_TREE_SIZE;
}

function clampTreeSize(size: number, treeType: TreeType): number {
    if (!Number.isFinite(size)) return 1;
    return Math.max(MIN_TREE_SIZE, Math.min(getTreeMaxSize(treeType), size));
}

interface TreeEditPopupProps {
    tree: TreeDef;
    screenX: number;
    screenY: number;
    onSave: (t: TreeDef) => void;
    onClose: () => void;
}

export function TreeEditPopup({ tree, screenX, screenY, onSave, onClose }: TreeEditPopupProps) {
    const [size, setSize] = useState(tree.size);
    const [treeType, setTreeType] = useState<TreeType>(tree.type ?? "pine");
    const { popupRef, position } = useClampedPosition(screenX, screenY);
    const maxSize = getTreeMaxSize(treeType);

    return (
        <div ref={popupRef} style={{ ...popupStyle, left: position.x, top: position.y }} onClick={e => e.stopPropagation()}>
            <h4 style={{ margin: "0 0 12px", fontSize: 15 }}>Edit Tree</h4>
            <label style={{ display: "block", marginBottom: 10 }}>
                <span style={{ fontSize: 12, display: "block", marginBottom: 4 }}>Type</span>
                <select
                    style={selectStyle}
                    value={treeType}
                    onChange={e => {
                        const nextType = e.target.value as TreeType;
                        setTreeType(nextType);
                        setSize(prev => clampTreeSize(prev, nextType));
                    }}
                >
                    {TREE_TYPES.map(t => (
                        <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                    ))}
                </select>
            </label>
            <label style={{ display: "block", marginBottom: 10 }}>
                <span style={{ fontSize: 12, display: "block", marginBottom: 4 }}>Size</span>
                <input
                    type="number"
                    step="0.1"
                    min={MIN_TREE_SIZE}
                    max={maxSize}
                    style={inputStyle}
                    value={size}
                    onChange={e => setSize(parseFloat(e.target.value) || 1)}
                />
            </label>
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button
                    style={{ ...buttonStyle, background: "#4a9", color: "#fff" }}
                    onClick={() => onSave({ ...tree, size: clampTreeSize(size, treeType), type: treeType })}
                >
                    Save
                </button>
                <button style={{ ...buttonStyle, background: "#555", color: "#fff" }} onClick={onClose}>Cancel</button>
            </div>
        </div>
    );
}
