import { useCallback, useState } from "react";
import Tippy from "@tippyjs/react";
import { ChevronLeft, ChevronRight, Circle, Shield, Square, Swords, X } from "lucide-react";
import type { EquipmentSlot, EquipmentPassives, Item, ItemCategory } from "../core/types";
import { isAccessory, isArmor, isConsumable, isShield, isWeapon } from "../core/types";
import { COLORS, getDamageTypeColor } from "../core/constants";
import { CORE_PLAYER_IDS, UNIT_DATA } from "../game/playerUnits";
import { buildEffectiveFormationOrder } from "../game/formationOrder";
import { getCharacterEquipment, getPartyInventory } from "../game/equipmentState";
import { canEquipInSlot, isOffHandDisabled } from "../game/equipment";
import { getItem } from "../game/items";
import { getPlayerUnitColor } from "../game/unitColors";
import { getPortrait } from "./portraitRegistry";
import { ModalShell } from "./ModalShell";
import { resolveEquipDiff, type StatDelta } from "../game/statDisplay";

interface EquipmentModalProps {
    unitId: number;
    onClose: () => void;
    onEquipItem?: (unitId: number, itemId: string, slot: EquipmentSlot) => void;
    onUnequipItem?: (unitId: number, slot: EquipmentSlot) => void;
    onMoveEquippedItem: (unitId: number, fromSlot: EquipmentSlot, toSlot: EquipmentSlot) => void;
    onChangeUnit?: (unitId: number) => void;
    formationOrder?: number[];
}

interface SlotMeta {
    key: EquipmentSlot;
    label: string;
}

const SLOT_ROWS: SlotMeta[][] = [
    [
        { key: "leftHand", label: "Main Hand" },
        { key: "armor", label: "Armor" },
        { key: "rightHand", label: "Off-Hand" },
    ],
    [
        { key: "accessory1", label: "Accessory 1" },
        { key: "accessory2", label: "Accessory 2" },
    ],
];

const SLOT_LABELS: Record<EquipmentSlot, string> = {
    armor: "Armor",
    leftHand: "Main Hand",
    rightHand: "Off-Hand",
    accessory1: "Accessory",
    accessory2: "Accessory",
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

function pushPassiveLines(lines: TooltipLine[], p: EquipmentPassives): void {
    if (p.bonusMaxHp) lines.push({ label: "Max HP", value: `+${p.bonusMaxHp}`, color: COLORS.hpHigh });
    if (p.bonusMaxMana) lines.push({ label: "Max Mana", value: `+${p.bonusMaxMana}`, color: COLORS.mana });
    if (p.bonusMagicDamage) lines.push({ label: "Magic Dmg", value: `+${p.bonusMagicDamage}`, color: "var(--ui-color-accent-arcane)" });
    if (p.bonusArmor) lines.push({ label: "Armor", value: `+${p.bonusArmor}`, color: COLORS.shieldedText });
    if (p.bonusCritChance) lines.push({ label: "Crit", value: `+${p.bonusCritChance}%`, color: COLORS.damageCrit });
    if (p.lifesteal) lines.push({ label: "Lifesteal", value: `${Math.round(p.lifesteal * 100)}%`, color: COLORS.logHeal });
    if (p.hpRegen && p.hpRegenInterval) lines.push({ label: "Regen", value: `+${p.hpRegen} / ${p.hpRegenInterval / 1000}s`, color: COLORS.hpHigh });
    if (p.bonusMoveSpeed) lines.push({ label: "Speed", value: `+${Math.round(p.bonusMoveSpeed * 100)}%`, color: "var(--ui-color-accent-primary-bright)" });
    if (p.aggroReduction) lines.push({ label: "Aggro", value: `-${Math.round(p.aggroReduction * 100)}%`, color: "var(--ui-color-accent-warning)" });
    if (p.thornsDamage) lines.push({ label: "Thorns", value: `${p.thornsDamage} reflect`, color: COLORS.thornsText });
}

function getItemTooltipLines(item: Item): TooltipLine[] {
    const lines: TooltipLine[] = [];
    if (isWeapon(item)) {
        const dmgColor = getDamageTypeColor(item.damageType);
        lines.push({ label: "Damage", value: `${item.damage[0]}-${item.damage[1]}`, color: dmgColor });
        lines.push({ label: "Type", value: item.damageType[0].toUpperCase() + item.damageType.slice(1), color: dmgColor });
        if (item.grip === "twoHand") lines.push({ label: "Grip", value: "Two-handed" });
        if (item.range) lines.push({ label: "Range", value: `${item.range}` });
        if (item.attackCooldown) lines.push({ label: "Cooldown", value: `${(item.attackCooldown / 1000).toFixed(1)}s` });
        pushPassiveLines(lines, item);
    }
    if (isShield(item) || isArmor(item)) {
        lines.push({ label: "Armor", value: `+${item.armor}`, color: COLORS.shieldedText });
        pushPassiveLines(lines, item);
    }
    if (isAccessory(item)) {
        pushPassiveLines(lines, item);
    }
    if (isConsumable(item)) {
        const effectLabels: Record<string, string> = {
            heal: "Heals",
            mana: "Restores mana",
            exp: "Grants XP",
            revive: "Revives ally",
            cleanse: "Cleanses",
            camp: "Rest",
            waystone_recall: "Recall",
        };
        const label = effectLabels[item.effect] ?? item.effect;
        if (item.value > 0) {
            const valueColor = item.effect === "heal" || item.effect === "revive"
                ? COLORS.hpHigh
                : item.effect === "mana"
                    ? COLORS.mana
                    : item.effect === "exp"
                        ? "#f1c40f"
                        : undefined;
            lines.push({ label, value: `${item.value}`, color: valueColor });
        } else {
            lines.push({ label, value: "—" });
        }
        if (item.cooldown > 0) lines.push({ label: "Cooldown", value: `${(item.cooldown / 1000).toFixed(0)}s` });
        if (item.targetType === "dead_ally") lines.push({ label: "Target", value: "Fallen ally" });
        if (item.poisonChanceOnUse) {
            lines.push({ label: "Self-poison", value: `${item.poisonChanceOnUse}% chance`, color: COLORS.poisonText });
        }
    }
    return lines;
}

interface ItemTooltipProps {
    item: Item;
    /** If provided, diff-vs-currently-equipped is rendered after the item's stats. */
    diff?: StatDelta[];
    /** Header caption, e.g. "EQUIPPED" for the current slot item. */
    heading?: string;
}

function deltaColor(sign: StatDelta["sign"]): string | undefined {
    if (sign === "positive") return "var(--ui-color-accent-success)";
    if (sign === "negative") return "var(--ui-color-accent-danger)";
    return undefined;
}

export function ItemTooltip({ item, diff, heading }: ItemTooltipProps) {
    const lines = getItemTooltipLines(item);
    return (
        <div className="skill-tooltip">
            {heading && (
                <div className="skill-tooltip-row">
                    <span className="skill-tooltip-label">{heading}</span>
                    <span className="skill-tooltip-value">{item.name}</span>
                </div>
            )}
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
            {diff && diff.length > 0 && (
                <>
                    <div className="skill-tooltip-row" style={{ opacity: 0.7, marginTop: 6 }}>
                        <span className="skill-tooltip-label">Equip change</span>
                        <span className="skill-tooltip-value">vs current</span>
                    </div>
                    {diff.map((d, i) => (
                        <div key={`diff-${i}`} className="skill-tooltip-row">
                            <span className="skill-tooltip-label">{d.label}</span>
                            <span className="skill-tooltip-value" style={{ color: deltaColor(d.sign) }}>{d.deltaText}</span>
                        </div>
                    ))}
                </>
            )}
            {diff && diff.length === 0 && (
                <div className="skill-tooltip-row" style={{ opacity: 0.55 }}>
                    <span className="skill-tooltip-label">Equip change</span>
                    <span className="skill-tooltip-value">no stat change</span>
                </div>
            )}
        </div>
    );
}

interface DragInfo {
    source: "inventory" | "slot";
    itemId: string;
    sourceSlot?: EquipmentSlot;
}

export function EquipmentModal({
    unitId,
    onClose,
    onEquipItem,
    onUnequipItem,
    onMoveEquippedItem,
    onChangeUnit,
    formationOrder = [],
}: EquipmentModalProps) {
    const [selectedSlot, setSelectedSlot] = useState<EquipmentSlot | null>(null);
    const [dragData, setDragData] = useState<DragInfo | null>(null);
    const [dropTarget, setDropTarget] = useState<EquipmentSlot | "unequip" | null>(null);
    const [equipment, setEquipment] = useState(() => getCharacterEquipment(unitId));
    const [inventory, setInventory] = useState(() => getPartyInventory());
    const offHandDisabled = isOffHandDisabled(equipment);
    const unitData = UNIT_DATA[unitId];
    const unitName = unitData?.name ?? "Character";
    const portrait = unitData ? getPortrait(unitData.class) : undefined;
    const portraitColor = getPlayerUnitColor(unitId);
    const unitOrder = buildEffectiveFormationOrder([...CORE_PLAYER_IDS], formationOrder);
    const orderIdx = unitOrder.indexOf(unitId);
    const prevUnitId = orderIdx >= 0
        ? unitOrder[(orderIdx - 1 + unitOrder.length) % unitOrder.length]
        : undefined;
    const nextUnitId = orderIdx >= 0
        ? unitOrder[(orderIdx + 1) % unitOrder.length]
        : undefined;

    const refreshEquipmentState = useCallback(() => {
        setEquipment(getCharacterEquipment(unitId));
        setInventory(getPartyInventory());
    }, [unitId]);

    const applyEquip = useCallback((itemId: string, slot: EquipmentSlot) => {
        onEquipItem?.(unitId, itemId, slot);
        refreshEquipmentState();
    }, [onEquipItem, refreshEquipmentState, unitId]);

    const applyUnequip = useCallback((slot: EquipmentSlot) => {
        onUnequipItem?.(unitId, slot);
        refreshEquipmentState();
    }, [onUnequipItem, refreshEquipmentState, unitId]);

    const applyMove = useCallback((fromSlot: EquipmentSlot, toSlot: EquipmentSlot) => {
        onMoveEquippedItem(unitId, fromSlot, toSlot);
        refreshEquipmentState();
    }, [onMoveEquippedItem, refreshEquipmentState, unitId]);

    // -- Drag & drop helpers --------------------------------------------------

    function canDropOnSlot(itemId: string, slot: EquipmentSlot): boolean {
        if (slot === "rightHand" && offHandDisabled) return false;
        const item = getItem(itemId);
        return !!item && canEquipInSlot(item, slot);
    }

    function handleSlotDragStart(e: React.DragEvent, slot: EquipmentSlot, itemId: string) {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("application/equipment", itemId);
        setDragData({ source: "slot", itemId, sourceSlot: slot });
        setSelectedSlot(slot);
    }

    function handleItemDragStart(e: React.DragEvent, itemId: string) {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("application/equipment", itemId);
        setDragData({ source: "inventory", itemId });
    }

    function handleSlotDragOver(e: React.DragEvent, slot: EquipmentSlot) {
        if (!dragData) return;
        if (dragData.source === "slot" && dragData.sourceSlot === slot) return;
        if (!canDropOnSlot(dragData.itemId, slot)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setDropTarget(prev => prev === slot ? prev : slot);
    }

    function handleSlotDrop(e: React.DragEvent, slot: EquipmentSlot) {
        e.preventDefault();
        if (!dragData) return;
        if (dragData.source === "slot" && dragData.sourceSlot) {
            if (dragData.sourceSlot !== slot) {
                applyMove(dragData.sourceSlot, slot);
            }
        } else {
            applyEquip(dragData.itemId, slot);
        }
        setSelectedSlot(slot);
        setDragData(null);
        setDropTarget(null);
    }

    function handleSideDragOver(e: React.DragEvent) {
        if (!dragData || dragData.source !== "slot") return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setDropTarget(prev => prev === "unequip" ? prev : "unequip");
    }

    function handleSideDrop(e: React.DragEvent) {
        e.preventDefault();
        if (!dragData || dragData.source !== "slot" || !dragData.sourceSlot) return;
        applyUnequip(dragData.sourceSlot);
        setDragData(null);
        setDropTarget(null);
    }

    function handleDragEnd() {
        setDragData(null);
        setDropTarget(null);
    }

    function handleDragLeave(e: React.DragEvent, id: EquipmentSlot | "unequip") {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            setDropTarget(prev => prev === id ? null : prev);
        }
    }

    // -- Computed values ------------------------------------------------------

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
        <ModalShell
            onClose={onClose}
            overlayClassName="equipment-modal-overlay"
            contentClassName="equipment-modal"
            closeOnEscape
        >
                <div className="char-modal-header">
                    <div className="char-modal-nav-row">
                        {onChangeUnit && prevUnitId !== undefined && (
                            <button type="button" className="equipment-modal-nav" onClick={() => onChangeUnit(prevUnitId)}>
                                <ChevronLeft size={18} />
                            </button>
                        )}
                        {portrait && (
                            <div
                                className="equipment-modal-portrait"
                                style={{ background: `${portraitColor} url(${portrait}) center / cover` }}
                            />
                        )}
                        {onChangeUnit && nextUnitId !== undefined && (
                            <button type="button" className="equipment-modal-nav" onClick={() => onChangeUnit(nextUnitId)}>
                                <ChevronRight size={18} />
                            </button>
                        )}
                    </div>
                    <div className="char-modal-title-block">
                        <h2 className="char-modal-title">Equipment <span className="char-modal-hotkey">E</span></h2>
                        <div className="char-modal-subtitle">{unitName}</div>
                        <div className="char-modal-desc">Equip weapons, armor, and accessories.</div>
                    </div>
                    <div className="char-modal-right">
                        <button type="button" className="equipment-modal-close" onClick={onClose}>
                            <X size={18} />
                        </button>
                    </div>
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
                                        const isDragSource = dragData?.source === "slot"
                                            && dragData.sourceSlot === slotMeta.key;
                                        const isValidTarget = !!dragData && !isDragSource && !disabled
                                            && canDropOnSlot(dragData.itemId, slotMeta.key);
                                        const isHovered = dropTarget === slotMeta.key;

                                        const cls = [
                                            "equipment-modal-slot",
                                            selected && "selected",
                                            disabled && "disabled",
                                            filled && "filled",
                                            isDragSource && "drag-source",
                                            isValidTarget && "can-drop",
                                            isHovered && "drop-target",
                                        ].filter(Boolean).join(" ");

                                        const slotButton = (
                                            <button
                                                key={slotMeta.key}
                                                type="button"
                                                className={cls}
                                                onClick={() => setSelectedSlot(slotMeta.key)}
                                                draggable={filled}
                                                onDragStart={filled && itemId
                                                    ? (e) => handleSlotDragStart(e, slotMeta.key, itemId)
                                                    : undefined}
                                                onDragOver={(e) => handleSlotDragOver(e, slotMeta.key)}
                                                onDragLeave={(e) => handleDragLeave(e, slotMeta.key)}
                                                onDrop={(e) => handleSlotDrop(e, slotMeta.key)}
                                                onDragEnd={handleDragEnd}
                                            >
                                                <span className="equipment-modal-slot-icon">{getSlotIcon(slotMeta.key)}</span>
                                                <span className="equipment-modal-slot-name">{slotMeta.label}</span>
                                                <span className="equipment-modal-slot-item">
                                                    {disabled ? "Disabled (2H)" : item ? item.name : "-- empty --"}
                                                </span>
                                            </button>
                                        );

                                        if (!item) return slotButton;

                                        return (
                                            <Tippy
                                                key={slotMeta.key}
                                                content={<ItemTooltip item={item} />}
                                                placement="bottom"
                                                delay={[0, 0]}
                                            >
                                                {slotButton}
                                            </Tippy>
                                        );
                                    })}
                                </div>
                            ))}
                        </div>
                    </div>

                    <aside
                        className={`equipment-modal-side${dropTarget === "unequip" ? " drop-target" : ""}`}
                        onDragOver={handleSideDragOver}
                        onDragLeave={(e) => handleDragLeave(e, "unequip")}
                        onDrop={handleSideDrop}
                    >
                        {!selectedSlot && (
                            <div className="equipment-modal-side-empty">
                                Select a slot to view options.
                            </div>
                        )}

                        {selectedSlot && (
                            <>
                                <div className="equipment-modal-side-header">
                                    <span>{SLOT_LABELS[selectedSlot]}</span>
                                </div>

                                <div className="equipment-modal-options">
                                    <button
                                        type="button"
                                        className="equipment-modal-option"
                                        disabled={!selectedItem || selectedSlotDisabled}
                                        onClick={() => applyUnequip(selectedSlot)}
                                    >
                                        <span className="equipment-modal-option-icon"><X size={15} /></span>
                                        <span className="equipment-modal-option-name">
                                            Unequip
                                        </span>
                                    </button>

                                    {selectedSlotDisabled && (
                                        <div className="equipment-modal-side-note">
                                            Off-hand disabled while a two-handed weapon is equipped.
                                        </div>
                                    )}

                                    {!selectedSlotDisabled && equippableItems.length === 0 && (
                                        <div className="equipment-modal-side-note">
                                            No compatible equipment.
                                        </div>
                                    )}

                                    {!selectedSlotDisabled && equippableItems.map(({ entry, item }) => {
                                        const alreadyEquipped = selectedItemId === entry.itemId;
                                        const diff = alreadyEquipped ? undefined : resolveEquipDiff(unitId, entry.itemId, selectedSlot);
                                        return (
                                            <Tippy
                                                key={entry.itemId}
                                                content={<ItemTooltip item={item} diff={diff} />}
                                                placement="left"
                                                delay={[0, 0]}
                                            >
                                                <button
                                                    type="button"
                                                    className="equipment-modal-option"
                                                    disabled={alreadyEquipped || !onEquipItem}
                                                    draggable={!alreadyEquipped && !!onEquipItem}
                                                    onDragStart={!alreadyEquipped
                                                        ? (e) => handleItemDragStart(e, entry.itemId)
                                                        : undefined}
                                                    onDragEnd={handleDragEnd}
                                                    onClick={() => applyEquip(entry.itemId, selectedSlot)}
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
        </ModalShell>
    );
}
