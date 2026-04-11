import { ChevronLeft, ChevronRight, X } from "lucide-react";
import Tippy from "@tippyjs/react";
import type { Unit } from "../core/types";
import { isConsumable } from "../core/types";
import { COLORS } from "../core/constants";
import { CORE_PLAYER_IDS, UNIT_DATA, getEffectiveMaxHp, getEffectiveMaxMana } from "../game/playerUnits";
import { buildEffectiveFormationOrder } from "../game/formationOrder";
import { getPlayerUnitColor } from "../game/unitColors";
import { getPartyInventory } from "../game/equipmentState";
import { getItem } from "../game/items";
import { getPortrait } from "./portraitRegistry";
import { ModalShell } from "./ModalShell";
import { useDisplayTime } from "../hooks/useDisplayTime";

type PanelQueuedAction =
    | { type: "skill"; skillName: string }
    | { type: "consumable"; itemId: string };

interface ItemsModalProps {
    unitId: number;
    units: Unit[];
    onClose: () => void;
    onChangeUnit: (id: number) => void;
    onUseConsumable: (itemId: string, targetUnitId: number) => void;
    onCancelQueuedConsumable: (itemId: string, targetUnitId: number) => void;
    consumableCooldownEnd: number;
    queuedAction: PanelQueuedAction | null;
    gold: number;
    paused: boolean;
    formationOrder?: number[];
}

export function ItemsModal({
    unitId,
    units,
    onClose,
    onChangeUnit,
    onUseConsumable,
    onCancelQueuedConsumable,
    consumableCooldownEnd,
    queuedAction,
    gold,
    paused,
    formationOrder = [],
}: ItemsModalProps) {
    const displayTime = useDisplayTime(paused, 50);
    const unitData = UNIT_DATA[unitId];
    const unit = units.find(u => u.id === unitId);
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

    if (!unitData || !unit) return null;

    const inventory = getPartyInventory();
    const consumables = inventory.items
        .map(entry => ({ entry, item: getItem(entry.itemId) }))
        .filter(({ item }) => item && isConsumable(item));

    const onCooldown = consumableCooldownEnd > displayTime;
    const cooldownRemaining = onCooldown ? Math.ceil((consumableCooldownEnd - displayTime) / 1000) : 0;
    const hasDeadAllies = units.some(u => u.team === "player" && u.hp <= 0);

    return (
        <ModalShell
            onClose={onClose}
            overlayClassName="equipment-modal-overlay"
            contentClassName="equipment-modal items-modal"
            closeOnEscape
        >
            <div className="char-modal-header">
                <div className="char-modal-nav-row">
                    {prevUnitId !== undefined && (
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
                    {nextUnitId !== undefined && (
                        <button type="button" className="equipment-modal-nav" onClick={() => onChangeUnit(nextUnitId)}>
                            <ChevronRight size={18} />
                        </button>
                    )}
                </div>
                <div className="char-modal-title-block">
                    <h2 className="char-modal-title">Items <span className="char-modal-hotkey">I</span></h2>
                    <div className="char-modal-subtitle">{unitName}</div>
                    <div className="char-modal-desc">Use consumables and view your party inventory.</div>
                </div>
                <div className="char-modal-right">
                    <button type="button" className="equipment-modal-close" onClick={onClose}>
                        <X size={18} />
                    </button>
                </div>
            </div>

            <div className="items-modal-body">
                {consumables.length === 0 && gold === 0 && (
                    <div className="text-muted" style={{ fontSize: 13, padding: "20px 0", textAlign: "center" }}>No items</div>
                )}

                {gold > 0 && (
                    <div className="inventory-item-row disabled" style={{ cursor: "default" }}>
                        <div className="inventory-item-header">
                            <span className="inventory-item-name">Pouch of Gold</span>
                        </div>
                        <div className="inventory-item-stats">
                            <span className="inventory-item-effect" style={{ color: "var(--ui-color-accent-gold)" }}>
                                {gold} gold
                            </span>
                        </div>
                    </div>
                )}

                {consumables.map(({ entry, item }) => {
                    if (!item || !isConsumable(item)) return null;

                    const unitAlive = unit.hp > 0;
                    const isQueued = queuedAction?.type === "consumable" && queuedAction.itemId === entry.itemId;
                    const isRevive = item.effect === "revive";
                    const isCleanse = item.effect === "cleanse";

                    let wouldBeWasted = false;
                    if (unitAlive) {
                        if (item.effect === "heal") {
                            wouldBeWasted = unit.hp >= getEffectiveMaxHp(unit.id, unit);
                        } else if (item.effect === "mana") {
                            wouldBeWasted = (unit.mana ?? 0) >= getEffectiveMaxMana(unit.id, unit);
                        } else if (isCleanse) {
                            const hasPoison = unit.statusEffects?.some(e => e.type === "poison") ?? false;
                            const alreadyCleansed = unit.statusEffects?.some(e => e.type === "cleansed") ?? false;
                            wouldBeWasted = !hasPoison && alreadyCleansed;
                        } else if (isRevive) {
                            wouldBeWasted = !hasDeadAllies;
                        }
                    }

                    const canClick = unitAlive && !wouldBeWasted;
                    const effectColor = item.effect === "heal" ? COLORS.hpHigh
                        : item.effect === "mana" ? COLORS.mana
                        : isCleanse ? COLORS.cleansedText
                        : isRevive ? "var(--ui-color-accent-gold)"
                        : "var(--ui-color-accent-arcane)";
                    const effectLabel = item.effect === "heal" ? "HP"
                        : item.effect === "mana" ? "Mana"
                        : isCleanse ? "Cleanse"
                        : isRevive ? ""
                        : "Experience";
                    const itemClass = `inventory-item-row ${!canClick && !isQueued ? "disabled" : ""} ${wouldBeWasted ? "wasted" : ""} ${isQueued ? "queued" : ""}`;

                    return (
                        <Tippy
                            key={entry.itemId}
                            content={
                                <div className="consumable-tooltip">
                                    <div className="consumable-tooltip-desc">{item.description}</div>
                                    {isRevive ? (
                                        <div className="consumable-tooltip-row">
                                            <span className="consumable-tooltip-value" style={{ color: effectColor }}>Revive to {item.value} HP</span>
                                        </div>
                                    ) : isCleanse ? (
                                        <div className="consumable-tooltip-row">
                                            <span className="consumable-tooltip-value" style={{ color: effectColor }}>Removes poison and grants poison immunity</span>
                                        </div>
                                    ) : (
                                        <div className="consumable-tooltip-row">
                                            <span className="consumable-tooltip-label">Restores</span>
                                            <span className="consumable-tooltip-value" style={{ color: effectColor }}>{item.value} {effectLabel}</span>
                                        </div>
                                    )}
                                    {item.poisonChanceOnUse && item.poisonChanceOnUse > 0 && (
                                        <div className="consumable-tooltip-row">
                                            <span className="consumable-tooltip-label">Risk</span>
                                            <span className="consumable-tooltip-value" style={{ color: COLORS.poisonText }}>{item.poisonChanceOnUse}% chance to self-poison</span>
                                        </div>
                                    )}
                                    {wouldBeWasted && isRevive && <div className="consumable-tooltip-warning">No fallen allies</div>}
                                    {wouldBeWasted && isCleanse && <div className="consumable-tooltip-warning">Already protected</div>}
                                    {wouldBeWasted && !isRevive && !isCleanse && <div className="consumable-tooltip-warning">Already at full {effectLabel}</div>}
                                </div>
                            }
                            placement="left"
                            delay={[200, 0]}
                        >
                            <div
                                className={itemClass}
                                onClick={() => {
                                    if (isQueued) onCancelQueuedConsumable(entry.itemId, unit.id);
                                    else if (canClick) onUseConsumable(entry.itemId, unit.id);
                                }}
                            >
                                <div className="inventory-item-header">
                                    <span className="inventory-item-name">{item.name}</span>
                                    {isQueued && <span className="skill-tag skill-tag-queued">QUEUED</span>}
                                </div>
                                {onCooldown && !isQueued && <div className="inventory-item-cooldown">{cooldownRemaining}s</div>}
                                {isQueued && onCooldown && <div className="inventory-item-cooldown queued">{cooldownRemaining}s</div>}
                                <div className="inventory-item-stats">
                                    <span className="inventory-item-effect" style={{ color: effectColor }}>
                                        {isRevive ? "Revive" : isCleanse ? "Cleanse" : `+${item.value} ${effectLabel}`}
                                    </span>
                                    <span className="inventory-item-qty">{"\u00d7"}{entry.quantity}</span>
                                </div>
                            </div>
                        </Tippy>
                    );
                })}
            </div>
        </ModalShell>
    );
}
