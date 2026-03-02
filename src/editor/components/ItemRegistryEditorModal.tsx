import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import type {
    Item,
    ItemCategory,
    WeaponItem,
    ShieldItem,
    ArmorItem,
    AccessoryItem,
    ConsumableItem,
    KeyItem,
} from "../../core/types";
import {
    getAllItemDefinitions,
    getDefaultItemDefinitions,
    replaceItemRegistry,
    validateItemDefinition,
    validateItemRegistry,
    ITEM_CATEGORY_LABELS,
    ITEM_CATEGORY_ORDER,
    KNOWN_DAMAGE_TYPES,
    KNOWN_WEAPON_GRIPS,
    KNOWN_CONSUMABLE_EFFECTS,
    KNOWN_CONSUMABLE_SOUNDS,
    KNOWN_CONSUMABLE_TARGET_TYPES,
} from "../../game/items";

interface ItemRegistryEditorModalProps {
    onClose: () => void;
    onApplied: () => void;
}

function cloneItem(item: Item): Item {
    if (item.category === "weapon") {
        return { ...item, damage: [item.damage[0], item.damage[1]] };
    }
    return { ...item };
}

function normalizeNewItemId(seed: string): string {
    const stripped = seed.replace(/[^A-Za-z0-9_]/g, "");
    if (stripped.length === 0) {
        return "item";
    }
    if (/^[A-Za-z]/.test(stripped)) {
        return stripped;
    }
    return `i${stripped}`;
}

function createUniqueItemId(seed: string, existingIds: Set<string>): string {
    const base = normalizeNewItemId(seed);
    if (!existingIds.has(base)) {
        return base;
    }
    let suffix = 2;
    while (existingIds.has(`${base}_${suffix}`)) {
        suffix += 1;
    }
    return `${base}_${suffix}`;
}

function createDefaultItem(category: ItemCategory, id: string): Item {
    const title = id
        .replace(/([A-Z])/g, " $1")
        .replace(/_/g, " ")
        .trim();
    const name = title.length > 0
        ? `${title.charAt(0).toUpperCase()}${title.slice(1)}`
        : "New Item";
    const description = `Editor-created ${ITEM_CATEGORY_LABELS[category].toLowerCase().slice(0, -1)}.`;
    const base = { id, name, description };

    if (category === "weapon") {
        return {
            ...base,
            category,
            grip: "oneHand",
            damage: [1, 2],
            damageType: "physical",
        };
    }
    if (category === "shield") {
        return { ...base, category, armor: 1 };
    }
    if (category === "armor") {
        return { ...base, category, armor: 1 };
    }
    if (category === "accessory") {
        return { ...base, category };
    }
    if (category === "consumable") {
        return {
            ...base,
            category,
            effect: "heal",
            value: 10,
            cooldown: 5000,
        };
    }
    return {
        ...base,
        category,
        keyId: `${id}Key`,
    };
}

function convertItemCategory(item: Item, category: ItemCategory): Item {
    if (item.category === category) {
        return cloneItem(item);
    }
    const base = {
        id: item.id,
        name: item.name,
        description: item.description,
    };

    if (category === "weapon") {
        return { ...base, category, grip: "oneHand", damage: [1, 2], damageType: "physical" };
    }
    if (category === "shield" || category === "armor") {
        return { ...base, category, armor: 1 };
    }
    if (category === "accessory") {
        return { ...base, category };
    }
    if (category === "consumable") {
        return { ...base, category, effect: "heal", value: 10, cooldown: 5000 };
    }
    return { ...base, category, keyId: `${item.id}Key` };
}

function parseOptionalNumber(raw: string): number | undefined {
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
        return undefined;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
        return undefined;
    }
    return parsed;
}

function parseRequiredNumber(raw: string, fallback = 0): number {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }
    return parsed;
}

const fieldLabelStyle: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: 4,
};

const fieldHeaderStyle: CSSProperties = {
    fontSize: 12,
    color: "#aab7d5",
};

interface WeaponItemFieldsProps {
    item: WeaponItem;
    onChange: (next: WeaponItem) => void;
}

function WeaponItemFields({ item, onChange }: WeaponItemFieldsProps) {
    return (
        <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                <label style={fieldLabelStyle}>
                    <span style={fieldHeaderStyle}>Grip</span>
                    <select
                        value={item.grip}
                        onChange={event => onChange({ ...item, grip: event.target.value as "oneHand" | "twoHand" })}
                        className="editor-trigger-input"
                    >
                        {KNOWN_WEAPON_GRIPS.map(grip => (
                            <option key={grip} value={grip}>{grip}</option>
                        ))}
                    </select>
                </label>
                <label style={fieldLabelStyle}>
                    <span style={fieldHeaderStyle}>Damage Min</span>
                    <input
                        type="number"
                        value={item.damage[0]}
                        onChange={event => onChange({ ...item, damage: [parseRequiredNumber(event.target.value, item.damage[0]), item.damage[1]] })}
                        className="editor-trigger-input"
                    />
                </label>
                <label style={fieldLabelStyle}>
                    <span style={fieldHeaderStyle}>Damage Max</span>
                    <input
                        type="number"
                        value={item.damage[1]}
                        onChange={event => onChange({ ...item, damage: [item.damage[0], parseRequiredNumber(event.target.value, item.damage[1])] })}
                        className="editor-trigger-input"
                    />
                </label>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <label style={fieldLabelStyle}>
                    <span style={fieldHeaderStyle}>Damage Type</span>
                    <select
                        value={item.damageType}
                        onChange={event => onChange({ ...item, damageType: event.target.value as WeaponItem["damageType"] })}
                        className="editor-trigger-input"
                    >
                        {KNOWN_DAMAGE_TYPES.map(type => (
                            <option key={type} value={type}>{type}</option>
                        ))}
                    </select>
                </label>
                <label style={fieldLabelStyle}>
                    <span style={fieldHeaderStyle}>Range (optional)</span>
                    <input
                        type="number"
                        min={0}
                        step={0.25}
                        value={item.range ?? ""}
                        onChange={event => onChange({ ...item, range: parseOptionalNumber(event.target.value) })}
                        className="editor-trigger-input"
                    />
                </label>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <label style={fieldLabelStyle}>
                    <span style={fieldHeaderStyle}>Projectile Color (optional)</span>
                    <input
                        type="text"
                        value={item.projectileColor ?? ""}
                        onChange={event => {
                            const value = event.target.value.trim();
                            onChange({ ...item, projectileColor: value.length > 0 ? value : undefined });
                        }}
                        className="editor-trigger-input"
                        placeholder="#a0522d"
                    />
                </label>
                <label style={fieldLabelStyle}>
                    <span style={fieldHeaderStyle}>Attack Cooldown ms (optional)</span>
                    <input
                        type="number"
                        min={0}
                        step={50}
                        value={item.attackCooldown ?? ""}
                        onChange={event => onChange({ ...item, attackCooldown: parseOptionalNumber(event.target.value) })}
                        className="editor-trigger-input"
                    />
                </label>
            </div>
        </>
    );
}

interface ArmorValueFieldsProps {
    item: ShieldItem | ArmorItem;
    onChange: (next: ShieldItem | ArmorItem) => void;
}

function ArmorValueFields({ item, onChange }: ArmorValueFieldsProps) {
    return (
        <label style={fieldLabelStyle}>
            <span style={fieldHeaderStyle}>Armor</span>
            <input
                type="number"
                min={0}
                value={item.armor}
                onChange={event => onChange({ ...item, armor: parseRequiredNumber(event.target.value, item.armor) })}
                className="editor-trigger-input"
            />
        </label>
    );
}

interface AccessoryFieldsProps {
    item: AccessoryItem;
    onChange: (next: AccessoryItem) => void;
}

function AccessoryFields({ item, onChange }: AccessoryFieldsProps) {
    return (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <label style={fieldLabelStyle}>
                <span style={fieldHeaderStyle}>Bonus Max HP</span>
                <input
                    type="number"
                    min={0}
                    value={item.bonusMaxHp ?? ""}
                    onChange={event => onChange({ ...item, bonusMaxHp: parseOptionalNumber(event.target.value) })}
                    className="editor-trigger-input"
                />
            </label>
            <label style={fieldLabelStyle}>
                <span style={fieldHeaderStyle}>Bonus Magic Damage</span>
                <input
                    type="number"
                    min={0}
                    value={item.bonusMagicDamage ?? ""}
                    onChange={event => onChange({ ...item, bonusMagicDamage: parseOptionalNumber(event.target.value) })}
                    className="editor-trigger-input"
                />
            </label>
            <label style={fieldLabelStyle}>
                <span style={fieldHeaderStyle}>Bonus Armor</span>
                <input
                    type="number"
                    min={0}
                    value={item.bonusArmor ?? ""}
                    onChange={event => onChange({ ...item, bonusArmor: parseOptionalNumber(event.target.value) })}
                    className="editor-trigger-input"
                />
            </label>
            <label style={fieldLabelStyle}>
                <span style={fieldHeaderStyle}>Bonus Move Speed (0-1)</span>
                <input
                    type="number"
                    min={0}
                    max={1}
                    step={0.01}
                    value={item.bonusMoveSpeed ?? ""}
                    onChange={event => onChange({ ...item, bonusMoveSpeed: parseOptionalNumber(event.target.value) })}
                    className="editor-trigger-input"
                />
            </label>
            <label style={fieldLabelStyle}>
                <span style={fieldHeaderStyle}>Aggro Reduction (0-1)</span>
                <input
                    type="number"
                    min={0}
                    max={1}
                    step={0.01}
                    value={item.aggroReduction ?? ""}
                    onChange={event => onChange({ ...item, aggroReduction: parseOptionalNumber(event.target.value) })}
                    className="editor-trigger-input"
                />
            </label>
            <label style={fieldLabelStyle}>
                <span style={fieldHeaderStyle}>HP Regen Amount</span>
                <input
                    type="number"
                    min={0}
                    value={item.hpRegen ?? ""}
                    onChange={event => onChange({ ...item, hpRegen: parseOptionalNumber(event.target.value) })}
                    className="editor-trigger-input"
                />
            </label>
            <label style={fieldLabelStyle}>
                <span style={fieldHeaderStyle}>HP Regen Interval ms</span>
                <input
                    type="number"
                    min={1}
                    step={100}
                    value={item.hpRegenInterval ?? ""}
                    onChange={event => onChange({ ...item, hpRegenInterval: parseOptionalNumber(event.target.value) })}
                    className="editor-trigger-input"
                />
            </label>
        </div>
    );
}

interface ConsumableFieldsProps {
    item: ConsumableItem;
    onChange: (next: ConsumableItem) => void;
}

function ConsumableFields({ item, onChange }: ConsumableFieldsProps) {
    return (
        <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                <label style={fieldLabelStyle}>
                    <span style={fieldHeaderStyle}>Effect</span>
                    <select
                        value={item.effect}
                        onChange={event => onChange({ ...item, effect: event.target.value as ConsumableItem["effect"] })}
                        className="editor-trigger-input"
                    >
                        {KNOWN_CONSUMABLE_EFFECTS.map(effect => (
                            <option key={effect} value={effect}>{effect}</option>
                        ))}
                    </select>
                </label>
                <label style={fieldLabelStyle}>
                    <span style={fieldHeaderStyle}>Value</span>
                    <input
                        type="number"
                        min={0}
                        value={item.value}
                        onChange={event => onChange({ ...item, value: parseRequiredNumber(event.target.value, item.value) })}
                        className="editor-trigger-input"
                    />
                </label>
                <label style={fieldLabelStyle}>
                    <span style={fieldHeaderStyle}>Cooldown ms</span>
                    <input
                        type="number"
                        min={0}
                        step={100}
                        value={item.cooldown}
                        onChange={event => onChange({ ...item, cooldown: parseRequiredNumber(event.target.value, item.cooldown) })}
                        className="editor-trigger-input"
                    />
                </label>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <label style={fieldLabelStyle}>
                    <span style={fieldHeaderStyle}>Sound</span>
                    <select
                        value={item.sound ?? ""}
                        onChange={event => {
                            const nextSound = event.target.value;
                            onChange({ ...item, sound: nextSound.length > 0 ? nextSound as "gulp" | "crunch" : undefined });
                        }}
                        className="editor-trigger-input"
                    >
                        <option value="">none</option>
                        {KNOWN_CONSUMABLE_SOUNDS.map(sound => (
                            <option key={sound} value={sound}>{sound}</option>
                        ))}
                    </select>
                </label>

                <label style={fieldLabelStyle}>
                    <span style={fieldHeaderStyle}>Target Type</span>
                    <select
                        value={item.targetType ?? ""}
                        onChange={event => {
                            const nextTargetType = event.target.value;
                            onChange({ ...item, targetType: nextTargetType.length > 0 ? nextTargetType as "dead_ally" : undefined });
                        }}
                        className="editor-trigger-input"
                    >
                        <option value="">none</option>
                        {KNOWN_CONSUMABLE_TARGET_TYPES.map(targetType => (
                            <option key={targetType} value={targetType}>{targetType}</option>
                        ))}
                    </select>
                </label>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <label style={fieldLabelStyle}>
                    <span style={fieldHeaderStyle}>Poison Chance % (optional)</span>
                    <input
                        type="number"
                        min={0}
                        max={100}
                        value={item.poisonChanceOnUse ?? ""}
                        onChange={event => onChange({ ...item, poisonChanceOnUse: parseOptionalNumber(event.target.value) })}
                        className="editor-trigger-input"
                    />
                </label>

                <label style={fieldLabelStyle}>
                    <span style={fieldHeaderStyle}>Poison Damage (optional)</span>
                    <input
                        type="number"
                        min={0}
                        value={item.poisonDamageOnUse ?? ""}
                        onChange={event => onChange({ ...item, poisonDamageOnUse: parseOptionalNumber(event.target.value) })}
                        className="editor-trigger-input"
                    />
                </label>
            </div>
        </>
    );
}

interface KeyFieldsProps {
    item: KeyItem;
    onChange: (next: KeyItem) => void;
}

function KeyFields({ item, onChange }: KeyFieldsProps) {
    return (
        <label style={fieldLabelStyle}>
            <span style={fieldHeaderStyle}>Key ID</span>
            <input
                value={item.keyId}
                onChange={event => onChange({ ...item, keyId: event.target.value })}
                className="editor-trigger-input"
            />
        </label>
    );
}

export function ItemRegistryEditorModal({ onClose, onApplied }: ItemRegistryEditorModalProps) {
    const [draftItems, setDraftItems] = useState<Item[]>(() => getAllItemDefinitions().map(cloneItem));
    const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
    const [searchText, setSearchText] = useState("");
    const [categoryFilter, setCategoryFilter] = useState<ItemCategory | "all">("all");
    const [newItemCategory, setNewItemCategory] = useState<ItemCategory>("weapon");
    const [importExportText, setImportExportText] = useState("");
    const [message, setMessage] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);
    const [lastAppliedSerialized, setLastAppliedSerialized] = useState<string>(() => JSON.stringify(getAllItemDefinitions()));

    const currentSerialized = useMemo(() => JSON.stringify(draftItems), [draftItems]);
    const isDirty = currentSerialized !== lastAppliedSerialized;

    const filteredItems = useMemo(() => {
        const normalizedSearch = searchText.trim().toLowerCase();
        return draftItems
            .filter(item => categoryFilter === "all" || item.category === categoryFilter)
            .filter(item => {
                if (normalizedSearch.length === 0) {
                    return true;
                }
                const haystack = `${item.id} ${item.name} ${item.description}`.toLowerCase();
                return haystack.includes(normalizedSearch);
            })
            .sort((a, b) => {
                const byName = a.name.localeCompare(b.name);
                return byName !== 0 ? byName : a.id.localeCompare(b.id);
            });
    }, [categoryFilter, draftItems, searchText]);

    const selectedItem = useMemo(() => {
        if (draftItems.length === 0) {
            return null;
        }
        if (!selectedItemId) {
            return draftItems[0];
        }
        return draftItems.find(item => item.id === selectedItemId) ?? draftItems[0];
    }, [draftItems, selectedItemId]);

    const selectedItemErrors = useMemo(() => selectedItem ? validateItemDefinition(selectedItem) : [], [selectedItem]);
    const registryErrors = useMemo(() => validateItemRegistry(draftItems), [draftItems]);

    const updateItemById = useCallback((itemId: string, updater: (item: Item) => Item) => {
        setDraftItems(prevItems => prevItems.map(item => item.id === itemId ? updater(item) : item));
    }, []);

    const dismissWithGuard = useCallback(() => {
        if (isDirty && !window.confirm("Discard unapplied item registry edits?")) {
            return;
        }
        onClose();
    }, [isDirty, onClose]);

    useEffect(() => {
        const onEscape = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            event.stopPropagation();
            dismissWithGuard();
        };
        window.addEventListener("keydown", onEscape, true);
        return () => window.removeEventListener("keydown", onEscape, true);
    }, [dismissWithGuard]);

    const addNewItem = (): void => {
        const existingIds = new Set(draftItems.map(item => item.id));
        const categorySeed = newItemCategory === "armor" ? "newArmor" : `new${ITEM_CATEGORY_LABELS[newItemCategory].slice(0, -1)}`;
        const nextId = createUniqueItemId(categorySeed, existingIds);
        const nextItem = createDefaultItem(newItemCategory, nextId);
        setDraftItems(prevItems => [...prevItems, nextItem]);
        setSelectedItemId(nextId);
        setMessage({ tone: "info", text: `Added ${ITEM_CATEGORY_LABELS[newItemCategory].slice(0, -1).toLowerCase()} "${nextItem.name}".` });
    };

    const duplicateSelectedItem = (): void => {
        if (!selectedItem) return;
        const existingIds = new Set(draftItems.map(item => item.id));
        const duplicateId = createUniqueItemId(`${selectedItem.id}_copy`, existingIds);
        const duplicate = cloneItem(selectedItem);
        duplicate.id = duplicateId;
        duplicate.name = `${selectedItem.name} Copy`;
        setDraftItems(prevItems => [...prevItems, duplicate]);
        setSelectedItemId(duplicateId);
        setMessage({ tone: "info", text: `Duplicated "${selectedItem.name}" as "${duplicate.name}".` });
    };

    const removeSelectedItem = (): void => {
        if (!selectedItem) return;
        if (!window.confirm(`Delete item "${selectedItem.name}" (${selectedItem.id}) from draft?`)) {
            return;
        }
        const deletedId = selectedItem.id;
        setDraftItems(prevItems => prevItems.filter(item => item.id !== deletedId));
        setMessage({ tone: "info", text: `Removed draft item "${selectedItem.name}".` });
    };

    const applyRegistryDraft = (): void => {
        const errors = replaceItemRegistry(draftItems.map(cloneItem));
        if (errors.length > 0) {
            setMessage({ tone: "error", text: `Apply failed (${errors.length} issue${errors.length === 1 ? "" : "s"}). Fix validation errors first.` });
            return;
        }
        setLastAppliedSerialized(currentSerialized);
        setMessage({ tone: "success", text: "Item registry applied and saved successfully." });
        onApplied();
    };

    const resetDraftToDefaults = (): void => {
        if (!window.confirm("Replace the current draft with default item definitions?")) {
            return;
        }
        const defaults = getDefaultItemDefinitions().map(cloneItem);
        setDraftItems(defaults);
        setSelectedItemId(defaults[0]?.id ?? null);
        setMessage({ tone: "info", text: "Draft replaced with default item definitions. Click Apply to commit." });
    };

    const loadDraftFromJson = (): void => {
        let parsed: unknown;
        try {
            parsed = JSON.parse(importExportText);
        } catch {
            setMessage({ tone: "error", text: "JSON parse failed. Fix syntax and try again." });
            return;
        }
        if (!Array.isArray(parsed)) {
            setMessage({ tone: "error", text: "JSON must be an array of item objects." });
            return;
        }
        const candidateItems = parsed as Item[];
        const errors = validateItemRegistry(candidateItems);
        if (errors.length > 0) {
            setMessage({ tone: "error", text: `Draft import failed (${errors.length} issue${errors.length === 1 ? "" : "s"}).` });
            return;
        }
        const nextDraft = candidateItems.map(cloneItem);
        setDraftItems(nextDraft);
        setSelectedItemId(nextDraft[0]?.id ?? null);
        setMessage({ tone: "success", text: "Draft loaded from JSON. Click Apply to commit." });
    };

    const exportDraftToJson = (): void => {
        const json = JSON.stringify(draftItems, null, 2);
        setImportExportText(json);
        if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
            void navigator.clipboard.writeText(json).catch(() => undefined);
        }
        setMessage({ tone: "info", text: "Draft exported to JSON text (and copied to clipboard when allowed)." });
    };

    return (
        <div className="editor-dialog-overlay" onMouseDown={dismissWithGuard}>
            <div
                className="editor-dialog-shell editor-dialog-shell--wide"
                onMouseDown={event => event.stopPropagation()}
            >
                <div className="editor-dialog-header">
                    <div className="editor-dialog-title">Item Registry Editor</div>
                    <div style={{ fontSize: 12, color: isDirty ? "#facc15" : "#9fb5dc" }}>
                        {isDirty ? "Unapplied changes" : "In sync"}
                    </div>
                    <div className="editor-dialog-header-actions">
                        <button type="button" className="editor-btn editor-btn--small editor-btn--muted" onClick={dismissWithGuard}>
                            Close
                        </button>
                        <button
                            type="button"
                            className="editor-btn editor-btn--small editor-btn--success"
                            onClick={applyRegistryDraft}
                            disabled={registryErrors.length > 0}
                        >
                            Apply
                        </button>
                    </div>
                </div>

                <div className="editor-dialog-body" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    {message && (
                        <div
                            style={{
                                fontSize: 13,
                                borderRadius: 6,
                                padding: "8px 10px",
                                border: message.tone === "error"
                                    ? "1px solid #91515b"
                                    : message.tone === "success"
                                        ? "1px solid #3f8058"
                                        : "1px solid #4f5670",
                                background: message.tone === "error"
                                    ? "rgba(145, 81, 91, 0.25)"
                                    : message.tone === "success"
                                        ? "rgba(63, 128, 88, 0.25)"
                                        : "rgba(79, 86, 112, 0.25)",
                            }}
                        >
                            {message.text}
                        </div>
                    )}

                    <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 14, minHeight: 460 }}>
                        <div style={{ border: "1px solid #4b5165", borderRadius: 8, padding: 10, display: "flex", flexDirection: "column", gap: 8, minHeight: 0 }}>
                            <div style={{ display: "flex", gap: 6 }}>
                                <input
                                    value={searchText}
                                    onChange={event => setSearchText(event.target.value)}
                                    placeholder="Search item id/name"
                                    className="editor-trigger-input editor-trigger-input--search"
                                />
                                <select
                                    value={categoryFilter}
                                    onChange={event => setCategoryFilter(event.target.value as ItemCategory | "all")}
                                    className="editor-trigger-input editor-trigger-input--filter"
                                >
                                    <option value="all">All</option>
                                    {ITEM_CATEGORY_ORDER.map(category => (
                                        <option key={category} value={category}>{ITEM_CATEGORY_LABELS[category]}</option>
                                    ))}
                                </select>
                            </div>

                            <div style={{ display: "flex", gap: 6 }}>
                                <select
                                    value={newItemCategory}
                                    onChange={event => setNewItemCategory(event.target.value as ItemCategory)}
                                    className="editor-trigger-input"
                                    style={{ width: "100%" }}
                                >
                                    {ITEM_CATEGORY_ORDER.map(category => (
                                        <option key={category} value={category}>{ITEM_CATEGORY_LABELS[category]}</option>
                                    ))}
                                </select>
                                <button type="button" className="editor-btn editor-btn--small editor-btn--primary" onClick={addNewItem}>
                                    Add
                                </button>
                            </div>

                            <div style={{ display: "flex", gap: 6 }}>
                                <button
                                    type="button"
                                    className="editor-btn editor-btn--small editor-btn--muted"
                                    onClick={duplicateSelectedItem}
                                    disabled={!selectedItem}
                                    style={{ width: "100%" }}
                                >
                                    Duplicate
                                </button>
                                <button
                                    type="button"
                                    className="editor-btn editor-btn--small editor-btn--danger"
                                    onClick={removeSelectedItem}
                                    disabled={!selectedItem}
                                    style={{ width: "100%" }}
                                >
                                    Delete
                                </button>
                            </div>

                            <div style={{ fontSize: 12, color: "#9fb5dc" }}>
                                {filteredItems.length} / {draftItems.length} items
                            </div>

                            <div style={{ overflowY: "auto", border: "1px solid #3f4456", borderRadius: 6, minHeight: 0, flex: 1 }}>
                                {filteredItems.length === 0 && (
                                    <div style={{ fontSize: 13, color: "#9fb5dc", padding: 10 }}>No matching items.</div>
                                )}
                                {filteredItems.map(item => {
                                    const selected = item.id === selectedItemId;
                                    return (
                                        <button
                                            key={item.id}
                                            type="button"
                                            onClick={() => setSelectedItemId(item.id)}
                                            style={{
                                                width: "100%",
                                                border: "none",
                                                borderBottom: "1px solid #3f4456",
                                                background: selected ? "#3b4763" : "transparent",
                                                color: "#fff",
                                                textAlign: "left",
                                                padding: "9px 10px",
                                                cursor: "pointer",
                                            }}
                                        >
                                            <div style={{ fontSize: 13, fontWeight: 600 }}>{item.name}</div>
                                            <div style={{ fontSize: 11, color: "#9fb5dc" }}>{item.id} • {ITEM_CATEGORY_LABELS[item.category]}</div>
                                        </button>
                                    );
                                })}
                            </div>

                            <button type="button" className="editor-btn editor-btn--small editor-btn--muted" onClick={resetDraftToDefaults}>
                                Reset Draft to Defaults
                            </button>
                        </div>

                        <div style={{ border: "1px solid #4b5165", borderRadius: 8, padding: 12, overflowY: "auto", minHeight: 0 }}>
                            {!selectedItem && (
                                <div style={{ fontSize: 14, color: "#9fb5dc" }}>Select an item to edit.</div>
                            )}

                            {selectedItem && (
                                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                                        <label style={fieldLabelStyle}>
                                            <span style={fieldHeaderStyle}>ID</span>
                                            <input
                                                value={selectedItem.id}
                                                onChange={event => {
                                                    const oldId = selectedItem.id;
                                                    const nextId = event.target.value;
                                                    updateItemById(oldId, item => ({ ...item, id: nextId }));
                                                    setSelectedItemId(nextId);
                                                }}
                                                className="editor-trigger-input"
                                            />
                                        </label>

                                        <label style={fieldLabelStyle}>
                                            <span style={fieldHeaderStyle}>Category</span>
                                            <select
                                                value={selectedItem.category}
                                                onChange={event => {
                                                    const nextCategory = event.target.value as ItemCategory;
                                                    updateItemById(selectedItem.id, item => convertItemCategory(item, nextCategory));
                                                }}
                                                className="editor-trigger-input"
                                            >
                                                {ITEM_CATEGORY_ORDER.map(category => (
                                                    <option key={category} value={category}>{ITEM_CATEGORY_LABELS[category]}</option>
                                                ))}
                                            </select>
                                        </label>
                                    </div>

                                    <label style={fieldLabelStyle}>
                                        <span style={fieldHeaderStyle}>Name</span>
                                        <input
                                            value={selectedItem.name}
                                            onChange={event => updateItemById(selectedItem.id, item => ({ ...item, name: event.target.value }))}
                                            className="editor-trigger-input"
                                        />
                                    </label>

                                    <label style={fieldLabelStyle}>
                                        <span style={fieldHeaderStyle}>Description</span>
                                        <textarea
                                            value={selectedItem.description}
                                            onChange={event => updateItemById(selectedItem.id, item => ({ ...item, description: event.target.value }))}
                                            rows={3}
                                            className="editor-trigger-input"
                                        />
                                    </label>

                                    {selectedItem.category === "weapon" && (
                                        <WeaponItemFields
                                            item={selectedItem}
                                            onChange={next => updateItemById(selectedItem.id, () => next)}
                                        />
                                    )}
                                    {selectedItem.category === "shield" && (
                                        <ArmorValueFields
                                            item={selectedItem}
                                            onChange={next => updateItemById(selectedItem.id, () => next)}
                                        />
                                    )}
                                    {selectedItem.category === "armor" && (
                                        <ArmorValueFields
                                            item={selectedItem}
                                            onChange={next => updateItemById(selectedItem.id, () => next)}
                                        />
                                    )}
                                    {selectedItem.category === "accessory" && (
                                        <AccessoryFields
                                            item={selectedItem}
                                            onChange={next => updateItemById(selectedItem.id, () => next)}
                                        />
                                    )}
                                    {selectedItem.category === "consumable" && (
                                        <ConsumableFields
                                            item={selectedItem}
                                            onChange={next => updateItemById(selectedItem.id, () => next)}
                                        />
                                    )}
                                    {selectedItem.category === "key" && (
                                        <KeyFields
                                            item={selectedItem}
                                            onChange={next => updateItemById(selectedItem.id, () => next)}
                                        />
                                    )}

                                    {selectedItemErrors.length > 0 && (
                                        <div style={{ border: "1px solid #91515b", background: "rgba(145, 81, 91, 0.24)", borderRadius: 6, padding: "8px 10px" }}>
                                            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Selected item validation</div>
                                            <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12 }}>
                                                {selectedItemErrors.map(error => (
                                                    <li key={error}>{error}</li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}

                                    {registryErrors.length > 0 && (
                                        <div style={{ border: "1px solid #91515b", background: "rgba(145, 81, 91, 0.2)", borderRadius: 6, padding: "8px 10px" }}>
                                            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>
                                                Registry validation ({registryErrors.length})
                                            </div>
                                            <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, maxHeight: 170, overflowY: "auto" }}>
                                                {registryErrors.map(error => (
                                                    <li key={error}>{error}</li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>

                    <div style={{ border: "1px solid #4b5165", borderRadius: 8, padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                        <div style={{ fontSize: 13, fontWeight: 700 }}>Import / Export JSON</div>
                        <textarea
                            value={importExportText}
                            onChange={event => setImportExportText(event.target.value)}
                            className="editor-trigger-input"
                            rows={8}
                            placeholder="Paste a JSON array of item definitions here."
                            style={{ fontFamily: "\"DM Mono\", monospace" }}
                        />
                        <div style={{ display: "flex", gap: 8 }}>
                            <button type="button" className="editor-btn editor-btn--small editor-btn--muted" onClick={loadDraftFromJson}>
                                Load JSON Into Draft
                            </button>
                            <button type="button" className="editor-btn editor-btn--small editor-btn--muted" onClick={exportDraftToJson}>
                                Export Draft JSON
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
