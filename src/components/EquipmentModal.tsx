import { useEffect, useState } from "react";
import Tippy from "@tippyjs/react";
import { Circle, Shield, Square, Swords, X } from "lucide-react";
import type { EquipmentSlot, Item, ItemCategory } from "../core/types";
import { isAccessory, isArmor, isShield, isWeapon } from "../core/types";
import { COLORS, getDamageTypeColor } from "../core/constants";
import { UNIT_DATA } from "../game/playerUnits";
import { getCharacterEquipment, getPartyInventory } from "../game/equipmentState";
import { canEquipInSlot, isOffHandDisabled } from "../game/equipment";
import { getItem } from "../game/items";

interface EquipmentModalProps {
    unitId: number;
    onClose: () => void;
    onEquipItem?: (unitId: number, itemId: string, slot: EquipmentSlot) => void;
    onUnequipItem?: (unitId: number, slot: EquipmentSlot) => void;
}

interface SlotMeta {
    key: EquipmentSlot;
    label: string;
}

const SLOT_ROWS: SlotMeta[][] = [
    [
        { key: "leftHand", label: "Main Hand" },
        { key: "armor", label: "Armor" },
        { key: "rightHand", label: "Off Hand" },
    ],
    [
        { key: "accessory1", label: "Accessory 1" },
        { key: "accessory2", label: "Accessory 2" },
    ],
];

const SLOT_LABELS: Record<EquipmentSlot, string> = {
    armor: "Armor",
    leftHand: "Main Hand",
    rightHand: "Off Hand",
    accessory1: "Accessory 1",
    accessory2: "Accessory 2",
};

function getSlotIcon(slot: EquipmentSlot) {
    if (slot === "armor") return <Shield size={28} />;
    if (slot === "leftHand" || slot === "rightHand") return <Swords size={28} />;
    return <Circle size={28} />;
}

function getItemIcon(category: ItemCategory) {
    if (category === "weapon") return <Swords size={15} />;
    if (category === "shield" || category === "armor") return <Shield size={15} />;
    if (category === "accessory") return <Circle size={15} />;
    return <Square size={15} />;
}

interface TooltipLine { label: string; value: string; color?: string }

function getItemTooltipLines(item: Item): TooltipLine[] {
    const lines: TooltipLine[] = [];
    if (isWeapon(item)) {
        const dmgColor = getDamageTypeColor(item.damageType);
        lines.push({ label: "Damage", value: `${item.damage[0]}–${item.damage[1]}`, color: dmgColor });
        lines.push({ label: "Type", value: item.damageType, color: dmgColor });
        if (item.grip === "twoHand") lines.push({ label: "Grip", value: "Two-handed" });
        if (item.range) lines.push({ label: "Range", value: `${item.range}` });
        if (item.attackCooldown) lines.push({ label: "Cooldown", value: `${(item.attackCooldown / 1000).toFixed(1)}s` });
    }
    if (isShield(item) || isArmor(item)) {
        lines.push({ label: "Armor", value: `+${item.armor}`, color: COLORS.shieldedText });
    }
    if (isAccessory(item)) {
        if (item.bonusMaxHp) lines.push({ label: "Max HP", value: `+${item.bonusMaxHp}`, color: COLORS.hpHigh });
        if (item.bonusMagicDamage) lines.push({ label: "Magic Dmg", value: `+${item.bonusMagicDamage}`, color: "#9b59b6" });
        if (item.bonusArmor) lines.push({ label: "Armor", value: `+${item.bonusArmor}`, color: COLORS.shieldedText });
        if (item.hpRegen && item.hpRegenInterval) lines.push({ label: "Regen", value: `+${item.hpRegen} / ${item.hpRegenInterval / 1000}s`, color: COLORS.hpHigh });
        if (item.aggroReduction) lines.push({ label: "Aggro", value: `−${Math.round(item.aggroReduction * 100)}%`, color: "#f59e0b" });
        if (item.bonusMoveSpeed) lines.push({ label: "Speed", value: `+${Math.round(item.bonusMoveSpeed * 100)}%`, color: "#58a6ff" });
    }
    return lines;
}

function ItemTooltip({ item }: { item: Item }) {
    const lines = getItemTooltipLines(item);
    return (
        <div className="skill-tooltip">
            {item.description && (
                <div className="skill-tooltip-desc">{item.description}</div>
            )}
            {lines.map((line, i) => (
                <div key={i} className="skill-tooltip-row">
                    <span className="skill-tooltip-label">{line.label}</span>
                    <span className="skill-tooltip-value" style={line.color ? { color: line.color } : undefined}>
                        {line.value}
                    </span>
                </div>
            ))}
        </div>
    );
}

export function EquipmentModal({
    unitId,
    onClose,
    onEquipItem,
    onUnequipItem,
}: EquipmentModalProps) {
    const [selectedSlot, setSelectedSlot] = useState<EquipmentSlot | null>(null);
    const equipment = getCharacterEquipment(unitId);
    const inventory = getPartyInventory();
    const offHandDisabled = isOffHandDisabled(equipment);
    const unitName = UNIT_DATA[unitId]?.name ?? "Character";

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key !== "Escape") return;
            e.preventDefault();
            e.stopPropagation();
            onClose();
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [onClose]);

    const selectedSlotDisabled = selectedSlot === "rightHand" && offHandDisabled;
    const selectedItemId = selectedSlot ? equipment[selectedSlot] : null;
    const selectedItem = selectedItemId ? getItem(selectedItemId) : undefined;

    const equippableItems = !selectedSlot || selectedSlotDisabled
        ? []
        : inventory.items
            .map(entry => ({ entry, item: getItem(entry.itemId) }))
            .filter((candidate): candidate is { entry: typeof inventory.items[number]; item: Item } => (
                candidate.item !== undefined && canEquipInSlot(candidate.item, selectedSlot)
            ))
            .sort((a, b) => a.item.name.localeCompare(b.item.name));

    return (
        <div className="modal-overlay equipment-modal-overlay" onClick={onClose}>
            <div className="modal-content equipment-modal" onClick={e => e.stopPropagation()}>
                <div className="equipment-modal-header">
                    <div>
                        <h2 className="help-title equipment-modal-title">Equipment</h2>
                        <div className="equipment-modal-subtitle">{unitName}</div>
                    </div>
                    <button type="button" className="equipment-modal-close" onClick={onClose}>
                        <X size={18} />
                    </button>
                </div>

                <div className="equipment-modal-body">
                    <div className="equipment-modal-center">
                        <div className="equipment-modal-slots">
                            {SLOT_ROWS.map((row, ri) => (
                                <div key={ri} className="equipment-modal-slots-row">
                                    {row.map(slotMeta => {
                                        const itemId = equipment[slotMeta.key];
                                        const item = itemId ? getItem(itemId) : undefined;
                                        const disabled = slotMeta.key === "rightHand" && offHandDisabled;
                                        const selected = selectedSlot === slotMeta.key;
                                        const filled = !!item && !disabled;
                                        const cls = [
                                            "equipment-modal-slot",
                                            selected ? "selected" : "",
                                            disabled ? "disabled" : "",
                                            filled ? "filled" : "",
                                        ].join(" ").trim();

                                        const slotButton = (
                                            <button
                                                key={slotMeta.key}
                                                type="button"
                                                className={cls}
                                                onClick={() => setSelectedSlot(slotMeta.key)}
                                            >
                                                <span className="equipment-modal-slot-icon">{getSlotIcon(slotMeta.key)}</span>
                                                <span className="equipment-modal-slot-name">{slotMeta.label}</span>
                                                <span className="equipment-modal-slot-item">
                                                    {disabled ? "Disabled (2H)" : item ? item.name : "— empty —"}
                                                </span>
                                            </button>
                                        );

                                        if (!item) return slotButton;

                                        return (
                                            <Tippy
                                                key={slotMeta.key}
                                                content={<ItemTooltip item={item} />}
                                                placement="bottom"
                                                delay={[300, 0]}
                                            >
                                                {slotButton}
                                            </Tippy>
                                        );
                                    })}
                                </div>
                            ))}
                        </div>
                    </div>

                    <aside className="equipment-modal-side">
                        {!selectedSlot && (
                            <div className="equipment-modal-side-empty">
                                Select a slot to view options.
                            </div>
                        )}

                        {selectedSlot && (
                            <>
                                <div className="equipment-modal-side-header">
                                    <span>{SLOT_LABELS[selectedSlot]} Options</span>
                                    <span>{selectedSlotDisabled ? "Disabled" : `${equippableItems.length} items`}</span>
                                </div>

                                <div className="equipment-modal-options">
                                    <button
                                        type="button"
                                        className="equipment-modal-option"
                                        disabled={!selectedItem || selectedSlotDisabled}
                                        onClick={() => onUnequipItem?.(unitId, selectedSlot)}
                                    >
                                        <span className="equipment-modal-option-icon"><X size={15} /></span>
                                        <span className="equipment-modal-option-name">
                                            Unequip
                                        </span>
                                    </button>

                                    {selectedSlotDisabled && (
                                        <div className="equipment-modal-side-note">
                                            Off-hand is disabled while a two-handed weapon is in main hand.
                                        </div>
                                    )}

                                    {!selectedSlotDisabled && equippableItems.length === 0 && (
                                        <div className="equipment-modal-side-note">
                                            No compatible equipment.
                                        </div>
                                    )}

                                    {!selectedSlotDisabled && equippableItems.map(({ entry, item }) => {
                                        const alreadyEquipped = selectedItemId === entry.itemId;
                                        return (
                                            <Tippy
                                                key={entry.itemId}
                                                content={<ItemTooltip item={item} />}
                                                placement="left"
                                                delay={[200, 0]}
                                            >
                                                <button
                                                    type="button"
                                                    className="equipment-modal-option"
                                                    disabled={alreadyEquipped || !onEquipItem}
                                                    onClick={() => onEquipItem?.(unitId, entry.itemId, selectedSlot)}
                                                >
                                                    <span className="equipment-modal-option-icon">{getItemIcon(item.category)}</span>
                                                    <span className="equipment-modal-option-name">
                                                        {item.name}
                                                        {alreadyEquipped && <span className="skill-tag">EQUIPPED</span>}
                                                        {entry.quantity > 1 && <span className="skill-tag">x{entry.quantity}</span>}
                                                    </span>
                                                </button>
                                            </Tippy>
                                        );
                                    })}
                                </div>
                            </>
                        )}
                    </aside>
                </div>
            </div>
        </div>
    );
}
