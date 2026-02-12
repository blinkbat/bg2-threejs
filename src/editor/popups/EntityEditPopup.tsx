// =============================================================================
// ENTITY EDIT POPUP
// =============================================================================

import { useState } from "react";
import type { AreaId } from "../../game/areas/types";
import type { EnemyType } from "../../core/types";
import type { EntityDef } from "../types";
import { useClampedPosition } from "../hooks/useClampedPosition";
import { getAvailableAreaIds, ENEMY_TYPES, popupStyle, inputStyle, selectStyle, buttonStyle } from "../constants";
import { ITEMS, WEAPONS, SHIELDS, ARMORS, ACCESSORIES, KEYS, CONSUMABLES } from "../../game/items";
import { AreaMinimap } from "../components";

// Organized item categories for the picker
const ITEM_CATEGORIES = [
    { label: "Consumables", items: Object.keys(CONSUMABLES) },
    { label: "Weapons", items: Object.keys(WEAPONS) },
    { label: "Shields", items: Object.keys(SHIELDS) },
    { label: "Armor", items: Object.keys(ARMORS) },
    { label: "Accessories", items: Object.keys(ACCESSORIES) },
    { label: "Keys", items: Object.keys(KEYS) },
];

interface EntityEditPopupProps {
    entity: EntityDef;
    screenX: number;
    screenY: number;
    onSave: (e: EntityDef) => void;
    onClose: () => void;
    onNavigate?: (areaId: string) => void;
}

export function EntityEditPopup({ entity, screenX, screenY, onSave, onClose, onNavigate }: EntityEditPopupProps) {
    const [draft, setDraft] = useState({ ...entity });
    const { popupRef, position } = useClampedPosition(screenX, screenY);

    return (
        <div ref={popupRef} style={{ ...popupStyle, left: position.x, top: position.y }} onClick={e => e.stopPropagation()}>
            <h4 style={{ margin: "0 0 12px", fontSize: 15 }}>Edit {draft.type}</h4>

            {draft.type === "enemy" && (
                <label style={{ display: "block", marginBottom: 10 }}>
                    <span style={{ fontSize: 12, display: "block", marginBottom: 4 }}>Enemy Type</span>
                    <select
                        style={selectStyle}
                        value={draft.enemyType || ""}
                        onChange={e => setDraft({ ...draft, enemyType: e.target.value as EnemyType })}
                    >
                        {ENEMY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                </label>
            )}

            {draft.type === "chest" && (
                <ChestItemsEditor
                    gold={draft.chestGold || 0}
                    itemsString={draft.chestItems || ""}
                    locked={draft.chestLocked || ""}
                    onGoldChange={gold => setDraft({ ...draft, chestGold: gold })}
                    onItemsChange={items => setDraft({ ...draft, chestItems: items })}
                    onLockedChange={locked => setDraft({ ...draft, chestLocked: locked || undefined })}
                />
            )}

            {draft.type === "transition" && (
                <>
                    <label style={{ display: "block", marginBottom: 10 }}>
                        <span style={{ fontSize: 12, display: "block", marginBottom: 4 }}>Target Area</span>
                        <select
                            style={selectStyle}
                            value={draft.transitionTarget || ""}
                            onChange={e => setDraft({ ...draft, transitionTarget: e.target.value as AreaId })}
                        >
                            {getAvailableAreaIds().map((id: string) => <option key={id} value={id}>{id}</option>)}
                        </select>
                    </label>
                    <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                        <label style={{ flex: 1 }}>
                            <span style={{ fontSize: 12, display: "block", marginBottom: 4 }}>Spawn X</span>
                            <input
                                type="number"
                                style={inputStyle}
                                value={draft.transitionSpawnX || 0}
                                onChange={e => setDraft({ ...draft, transitionSpawnX: parseFloat(e.target.value) || 0 })}
                            />
                        </label>
                        <label style={{ flex: 1 }}>
                            <span style={{ fontSize: 12, display: "block", marginBottom: 4 }}>Spawn Z</span>
                            <input
                                type="number"
                                style={inputStyle}
                                value={draft.transitionSpawnZ || 0}
                                onChange={e => setDraft({ ...draft, transitionSpawnZ: parseFloat(e.target.value) || 0 })}
                            />
                        </label>
                    </div>
                    {/* Visual spawn picker */}
                    {draft.transitionTarget && (
                        <div style={{ marginBottom: 10 }}>
                            <span style={{ fontSize: 12, display: "block", marginBottom: 4 }}>Click to set spawn point:</span>
                            <AreaMinimap
                                key={draft.transitionTarget}
                                areaId={draft.transitionTarget}
                                spawnX={draft.transitionSpawnX || 0}
                                spawnZ={draft.transitionSpawnZ || 0}
                                onSpawnChange={(x, z) => setDraft({ ...draft, transitionSpawnX: x, transitionSpawnZ: z })}
                                width={248}
                                height={180}
                            />
                        </div>
                    )}
                    <label style={{ display: "block", marginBottom: 10 }}>
                        <span style={{ fontSize: 12, display: "block", marginBottom: 4 }}>Direction</span>
                        <select
                            style={selectStyle}
                            value={draft.transitionDirection || "north"}
                            onChange={e => setDraft({ ...draft, transitionDirection: e.target.value as "north" | "south" | "east" | "west" })}
                        >
                            <option value="north">north</option>
                            <option value="south">south</option>
                            <option value="east">east</option>
                            <option value="west">west</option>
                        </select>
                    </label>
                    <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                        <label style={{ flex: 1 }}>
                            <span style={{ fontSize: 12, display: "block", marginBottom: 4 }}>Width</span>
                            <input
                                type="number"
                                style={inputStyle}
                                value={draft.transitionW || 1}
                                onChange={e => setDraft({ ...draft, transitionW: parseInt(e.target.value) || 1 })}
                            />
                        </label>
                        <label style={{ flex: 1 }}>
                            <span style={{ fontSize: 12, display: "block", marginBottom: 4 }}>Height</span>
                            <input
                                type="number"
                                style={inputStyle}
                                value={draft.transitionH || 1}
                                onChange={e => setDraft({ ...draft, transitionH: parseInt(e.target.value) || 1 })}
                            />
                        </label>
                    </div>
                    {onNavigate && draft.transitionTarget && (
                        <button
                            style={{ ...buttonStyle, background: "#48f", color: "#fff", width: "100%", marginBottom: 10 }}
                            onClick={() => onNavigate(draft.transitionTarget!)}
                        >
                            Go to {draft.transitionTarget}
                        </button>
                    )}
                </>
            )}

            {draft.type === "candle" && (
                <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                    <label style={{ flex: 1 }}>
                        <span style={{ fontSize: 12, display: "block", marginBottom: 4 }}>Dir X</span>
                        <input
                            type="number"
                            style={inputStyle}
                            value={draft.candleDx || 0}
                            onChange={e => setDraft({ ...draft, candleDx: parseFloat(e.target.value) || 0 })}
                        />
                    </label>
                    <label style={{ flex: 1 }}>
                        <span style={{ fontSize: 12, display: "block", marginBottom: 4 }}>Dir Z</span>
                        <input
                            type="number"
                            style={inputStyle}
                            value={draft.candleDz || 0}
                            onChange={e => setDraft({ ...draft, candleDz: parseFloat(e.target.value) || 0 })}
                        />
                    </label>
                </div>
            )}

            {draft.type === "secret_door" && (
                <>
                    <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                        <label style={{ flex: 1 }}>
                            <span style={{ fontSize: 12, display: "block", marginBottom: 4 }}>Block X</span>
                            <input
                                type="number"
                                style={inputStyle}
                                value={draft.secretBlockX || 0}
                                onChange={e => setDraft({ ...draft, secretBlockX: parseInt(e.target.value) || 0 })}
                            />
                        </label>
                        <label style={{ flex: 1 }}>
                            <span style={{ fontSize: 12, display: "block", marginBottom: 4 }}>Block Z</span>
                            <input
                                type="number"
                                style={inputStyle}
                                value={draft.secretBlockZ || 0}
                                onChange={e => setDraft({ ...draft, secretBlockZ: parseInt(e.target.value) || 0 })}
                            />
                        </label>
                    </div>
                    <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                        <label style={{ flex: 1 }}>
                            <span style={{ fontSize: 12, display: "block", marginBottom: 4 }}>Width</span>
                            <input
                                type="number"
                                style={inputStyle}
                                value={draft.secretBlockW || 1}
                                onChange={e => setDraft({ ...draft, secretBlockW: parseInt(e.target.value) || 1 })}
                            />
                        </label>
                        <label style={{ flex: 1 }}>
                            <span style={{ fontSize: 12, display: "block", marginBottom: 4 }}>Height</span>
                            <input
                                type="number"
                                style={inputStyle}
                                value={draft.secretBlockH || 1}
                                onChange={e => setDraft({ ...draft, secretBlockH: parseInt(e.target.value) || 1 })}
                            />
                        </label>
                    </div>
                </>
            )}

            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button style={{ ...buttonStyle, background: "#4a9", color: "#fff" }} onClick={() => onSave(draft)}>Save</button>
                <button style={{ ...buttonStyle, background: "#555", color: "#fff" }} onClick={onClose}>Cancel</button>
            </div>
        </div>
    );
}

// =============================================================================
// CHEST ITEMS EDITOR COMPONENT
// =============================================================================

interface ChestItemsEditorProps {
    gold: number;
    itemsString: string;
    locked: string;
    onGoldChange: (gold: number) => void;
    onItemsChange: (items: string) => void;
    onLockedChange: (locked: string) => void;
}

interface ChestItem {
    itemId: string;
    quantity: number;
}

function parseItemsString(str: string): ChestItem[] {
    if (!str.trim()) return [];
    return str.split(",").filter(Boolean).map(item => {
        const [itemId, qty] = item.split(":");
        return { itemId, quantity: parseInt(qty) || 1 };
    });
}

function itemsToString(items: ChestItem[]): string {
    return items.map(i => `${i.itemId}:${i.quantity}`).join(",");
}

function ChestItemsEditor({ gold, itemsString, locked, onGoldChange, onItemsChange, onLockedChange }: ChestItemsEditorProps) {
    const [items, setItems] = useState<ChestItem[]>(() => parseItemsString(itemsString));
    const [selectedCategory, setSelectedCategory] = useState(0);
    const [selectedItem, setSelectedItem] = useState("");
    const [addQty, setAddQty] = useState(1);

    const updateItems = (newItems: ChestItem[]) => {
        setItems(newItems);
        onItemsChange(itemsToString(newItems));
    };

    const addItem = () => {
        if (!selectedItem) return;
        const existing = items.find(i => i.itemId === selectedItem);
        if (existing) {
            updateItems(items.map(i => i.itemId === selectedItem ? { ...i, quantity: i.quantity + addQty } : i));
        } else {
            updateItems([...items, { itemId: selectedItem, quantity: addQty }]);
        }
        setAddQty(1);
    };

    const removeItem = (itemId: string) => {
        updateItems(items.filter(i => i.itemId !== itemId));
    };

    const updateQuantity = (itemId: string, delta: number) => {
        updateItems(items.map(i => {
            if (i.itemId === itemId) {
                const newQty = Math.max(1, i.quantity + delta);
                return { ...i, quantity: newQty };
            }
            return i;
        }));
    };

    const categoryItems = ITEM_CATEGORIES[selectedCategory]?.items || [];

    return (
        <>
            {/* Gold */}
            <label style={{ display: "block", marginBottom: 10 }}>
                <span style={{ fontSize: 12, display: "block", marginBottom: 4 }}>Gold</span>
                <input
                    type="number"
                    style={inputStyle}
                    value={gold}
                    onChange={e => onGoldChange(parseInt(e.target.value) || 0)}
                />
            </label>

            {/* Item Picker */}
            <div style={{ marginBottom: 10 }}>
                <span style={{ fontSize: 12, display: "block", marginBottom: 4 }}>Add Item</span>

                {/* Category tabs */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 2, marginBottom: 6 }}>
                    {ITEM_CATEGORIES.map((cat, idx) => (
                        <button
                            key={cat.label}
                            onClick={() => { setSelectedCategory(idx); setSelectedItem(""); }}
                            style={{
                                padding: "3px 6px",
                                fontSize: 10,
                                background: selectedCategory === idx ? "#4a9" : "#444",
                                color: "#fff",
                                border: "none",
                                borderRadius: 3,
                                cursor: "pointer",
                            }}
                        >
                            {cat.label}
                        </button>
                    ))}
                </div>

                {/* Item dropdown + quantity + add button */}
                <div style={{ display: "flex", gap: 4 }}>
                    <select
                        style={{ ...selectStyle, flex: 1, fontSize: 11 }}
                        value={selectedItem}
                        onChange={e => setSelectedItem(e.target.value)}
                    >
                        <option value="">-- Select --</option>
                        {categoryItems.map(id => (
                            <option key={id} value={id}>{ITEMS[id]?.name || id}</option>
                        ))}
                    </select>
                    <input
                        type="number"
                        style={{ ...inputStyle, width: 40, padding: "4px 6px", fontSize: 11 }}
                        value={addQty}
                        min={1}
                        onChange={e => setAddQty(Math.max(1, parseInt(e.target.value) || 1))}
                    />
                    <button
                        onClick={addItem}
                        disabled={!selectedItem}
                        style={{
                            padding: "4px 8px",
                            fontSize: 11,
                            background: selectedItem ? "#4a9" : "#555",
                            color: "#fff",
                            border: "none",
                            borderRadius: 3,
                            cursor: selectedItem ? "pointer" : "not-allowed",
                        }}
                    >
                        Add
                    </button>
                </div>
            </div>

            {/* Current Items List */}
            {items.length > 0 && (
                <div style={{ marginBottom: 10 }}>
                    <span style={{ fontSize: 12, display: "block", marginBottom: 4 }}>Contents</span>
                    <div style={{
                        background: "#333",
                        borderRadius: 4,
                        padding: 6,
                        maxHeight: 120,
                        overflowY: "auto",
                    }}>
                        {items.map(item => (
                            <div
                                key={item.itemId}
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 6,
                                    padding: "4px 0",
                                    borderBottom: "1px solid #444",
                                }}
                            >
                                <span style={{ flex: 1, fontSize: 11 }}>
                                    {ITEMS[item.itemId]?.name || item.itemId}
                                </span>
                                <button
                                    onClick={() => updateQuantity(item.itemId, -1)}
                                    style={{
                                        width: 20, height: 20,
                                        fontSize: 12, fontWeight: "bold",
                                        background: "#555", color: "#fff",
                                        border: "none", borderRadius: 3,
                                        cursor: "pointer",
                                    }}
                                >
                                    -
                                </button>
                                <span style={{ fontSize: 11, minWidth: 20, textAlign: "center" }}>
                                    {item.quantity}
                                </span>
                                <button
                                    onClick={() => updateQuantity(item.itemId, 1)}
                                    style={{
                                        width: 20, height: 20,
                                        fontSize: 12, fontWeight: "bold",
                                        background: "#555", color: "#fff",
                                        border: "none", borderRadius: 3,
                                        cursor: "pointer",
                                    }}
                                >
                                    +
                                </button>
                                <button
                                    onClick={() => removeItem(item.itemId)}
                                    style={{
                                        width: 20, height: 20,
                                        fontSize: 11,
                                        background: "#a44", color: "#fff",
                                        border: "none", borderRadius: 3,
                                        cursor: "pointer",
                                    }}
                                >
                                    ×
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Locked */}
            <label style={{ display: "block", marginBottom: 10 }}>
                <span style={{ fontSize: 12, display: "block", marginBottom: 4 }}>Locked (key ID)</span>
                <select
                    style={selectStyle}
                    value={locked}
                    onChange={e => onLockedChange(e.target.value)}
                >
                    <option value="">Not locked</option>
                    {Object.keys(KEYS).map(keyId => (
                        <option key={keyId} value={KEYS[keyId].keyId}>{KEYS[keyId].name}</option>
                    ))}
                </select>
            </label>
        </>
    );
}
