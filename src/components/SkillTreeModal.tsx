import { useMemo } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import Tippy from "@tippyjs/react";
import type { Unit, Skill } from "../core/types";
import { getSkillTextColor, getDamageTypeColor } from "../core/constants";
import { CORE_PLAYER_IDS, UNIT_DATA } from "../game/playerUnits";
import { buildEffectiveFormationOrder } from "../game/formationOrder";
import { getPlayerUnitColor } from "../game/unitColors";
import { SKILLS } from "../game/skills";
import { getPortrait } from "./portraitRegistry";
import { ModalShell } from "./ModalShell";
import { getClassSkillTree, type SkillTreeNode } from "../game/skillTrees";
import { SKILL_DRAG_TYPE } from "./SkillHotbar";

interface SkillTreeModalProps {
    unitId: number;
    units: Unit[];
    onClose: () => void;
    onChangeUnit: (id: number) => void;
    onLearnSkill: (unitId: number, skillName: string) => void;
    formationOrder?: number[];
}

const TIER_LABELS = ["I", "II", "III", "IV", "V"];

function getSkillByName(name: string): Skill | undefined {
    return Object.values(SKILLS).find(s => s.name === name);
}

function SkillNodeTooltip({ skill }: { skill: Skill }) {
    const nameColor = getSkillTextColor(skill.type, skill.damageType);
    const kindLabel = skill.kind === "spell" ? "Spell" : "Ability";
    const dmgColor = getDamageTypeColor(skill.damageType);
    const dmgLabel = skill.damageType[0].toUpperCase() + skill.damageType.slice(1);

    return (
        <div className="skill-tooltip">
            <div className="skill-tooltip-row">
                <span className="skill-tooltip-label">{kindLabel}</span>
                <span className="skill-tooltip-value" style={{ color: nameColor }}>{skill.name}</span>
            </div>
            {skill.description && (
                <div className="skill-tooltip-desc">{skill.description}</div>
            )}
            {skill.damageRange && (
                <div className="skill-tooltip-row">
                    <span className="skill-tooltip-label">Damage</span>
                    <span className="skill-tooltip-value" style={{ color: dmgColor }}>{skill.damageRange[0]}-{skill.damageRange[1]} {dmgLabel}</span>
                </div>
            )}
            {skill.healRange && (
                <div className="skill-tooltip-row">
                    <span className="skill-tooltip-label">Heal</span>
                    <span className="skill-tooltip-value" style={{ color: "var(--ui-color-accent-success)" }}>{skill.healRange[0]}-{skill.healRange[1]}</span>
                </div>
            )}
            {skill.shieldAmount !== undefined && (
                <div className="skill-tooltip-row">
                    <span className="skill-tooltip-label">Shield</span>
                    <span className="skill-tooltip-value">{skill.shieldAmount} HP</span>
                </div>
            )}
            {skill.manaCost > 0 && (
                <div className="skill-tooltip-row">
                    <span className="skill-tooltip-label">Mana</span>
                    <span className="skill-tooltip-value" style={{ color: "var(--ui-color-accent-primary-bright)" }}>{skill.manaCost}</span>
                </div>
            )}
            <div className="skill-tooltip-row">
                <span className="skill-tooltip-label">Cooldown</span>
                <span className="skill-tooltip-value">{(skill.cooldown / 1000).toFixed(1)}s</span>
            </div>
            {skill.range > 0 && (
                <div className="skill-tooltip-row">
                    <span className="skill-tooltip-label">Range</span>
                    <span className="skill-tooltip-value">{skill.range}</span>
                </div>
            )}
            {skill.aoeRadius !== undefined && (
                <div className="skill-tooltip-row">
                    <span className="skill-tooltip-label">AoE Radius</span>
                    <span className="skill-tooltip-value">{skill.aoeRadius}</span>
                </div>
            )}
            {skill.duration !== undefined && (
                <div className="skill-tooltip-row">
                    <span className="skill-tooltip-label">Duration</span>
                    <span className="skill-tooltip-value">{(skill.duration / 1000).toFixed(0)}s</span>
                </div>
            )}
            {skill.hitCount !== undefined && skill.hitCount > 1 && (
                <div className="skill-tooltip-row">
                    <span className="skill-tooltip-label">Hits</span>
                    <span className="skill-tooltip-value">{skill.hitCount}</span>
                </div>
            )}
            {skill.burnChance !== undefined && skill.burnChance > 0 && (
                <div className="skill-tooltip-row">
                    <span className="skill-tooltip-label">Burn chance</span>
                    <span className="skill-tooltip-value" style={{ color: getDamageTypeColor("fire") }}>{skill.burnChance}%</span>
                </div>
            )}
            {skill.poisonChance !== undefined && skill.poisonChance > 0 && (
                <div className="skill-tooltip-row">
                    <span className="skill-tooltip-label">Poison chance</span>
                    <span className="skill-tooltip-value" style={{ color: "var(--ui-color-accent-success)" }}>{skill.poisonChance}%</span>
                </div>
            )}
            {skill.stunChance !== undefined && skill.stunChance > 0 && (
                <div className="skill-tooltip-row">
                    <span className="skill-tooltip-label">Stun chance</span>
                    <span className="skill-tooltip-value">{skill.stunChance}%</span>
                </div>
            )}
            {skill.chillChance !== undefined && skill.chillChance > 0 && (
                <div className="skill-tooltip-row">
                    <span className="skill-tooltip-label">Chill chance</span>
                    <span className="skill-tooltip-value" style={{ color: getDamageTypeColor("cold") }}>{skill.chillChance}%</span>
                </div>
            )}
            {skill.blindChance !== undefined && skill.blindChance > 0 && (
                <div className="skill-tooltip-row">
                    <span className="skill-tooltip-label">Blind chance</span>
                    <span className="skill-tooltip-value">{skill.blindChance}%</span>
                </div>
            )}
            {skill.knockbackDistance !== undefined && (
                <div className="skill-tooltip-row">
                    <span className="skill-tooltip-label">Knockback</span>
                    <span className="skill-tooltip-value">{skill.knockbackDistance}</span>
                </div>
            )}
            {skill.critChanceOverride !== undefined && (
                <div className="skill-tooltip-row">
                    <span className="skill-tooltip-label">Crit chance</span>
                    <span className="skill-tooltip-value">{skill.critChanceOverride}%</span>
                </div>
            )}
            {skill.isCantrip && skill.maxUses !== undefined && (
                <div className="skill-tooltip-row">
                    <span className="skill-tooltip-label">Cantrip uses</span>
                    <span className="skill-tooltip-value">{skill.maxUses}</span>
                </div>
            )}
            {skill.targetType === "ally" && (
                <div className="skill-tooltip-row">
                    <span className="skill-tooltip-label">Target</span>
                    <span className="skill-tooltip-value">Ally</span>
                </div>
            )}
            {skill.targetType === "self" && (
                <div className="skill-tooltip-row">
                    <span className="skill-tooltip-label">Target</span>
                    <span className="skill-tooltip-value">Self</span>
                </div>
            )}
            {skill.flavor && (
                <div className="skill-tooltip-flavor">{skill.flavor}</div>
            )}
        </div>
    );
}

function NodeCard({
    node,
    learned,
    available,
    prereqMet,
    onLearn,
}: {
    node: SkillTreeNode;
    learned: boolean;
    available: boolean;
    prereqMet: boolean;
    onLearn: () => void;
}) {
    // A node is implemented if it's a skill with a skillName referencing an existing SKILLS entry
    const implemented = node.type === "skill" && !!node.skillName;
    const canLearn = implemented && available && prereqMet && !learned;

    const cardClass = [
        "skill-tree-node",
        !implemented ? "not-implemented" : "",
        learned ? "learned" : "",
        canLearn ? "available" : "",
        implemented && !learned && !canLearn ? "locked" : "",
    ].filter(Boolean).join(" ");

    const typeLabel = node.type === "skill" ? "SKILL" : node.type === "mastery" ? "MASTERY" : "PASSIVE";

    const isDraggable = learned && implemented;
    const skill = node.skillName ? getSkillByName(node.skillName) : undefined;

    const card = (
        <div
            className={cardClass}
            onClick={() => { if (canLearn) onLearn(); }}
            draggable={isDraggable}
            onDragStart={isDraggable ? (e) => {
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData(SKILL_DRAG_TYPE, node.skillName!);
            } : undefined}
        >
            <div className="skill-tree-node-header">
                <div className="skill-tree-node-name">
                    {node.name}
                </div>
                <span className="skill-tree-node-tag">
                    {typeLabel}
                </span>
            </div>
            <div className="skill-tree-node-footer">
                {learned && <span className="skill-tree-node-status learned">LEARNED</span>}
                {canLearn && <span className="skill-tree-node-status available">Click to learn</span>}
                {implemented && !learned && !canLearn && prereqMet && <span className="skill-tree-node-status">Not learned</span>}
                {implemented && !learned && !prereqMet && <span className="skill-tree-node-status">Requires previous tier</span>}
                {!implemented && <span className="skill-tree-node-status not-impl">NOT IMPLEMENTED</span>}
            </div>
        </div>
    );

    const tooltipContent = skill
        ? <SkillNodeTooltip skill={skill} />
        : node.description
            ? <div className="skill-tooltip"><div className="skill-tooltip-desc">{node.description}</div></div>
            : null;

    if (tooltipContent) {
        return (
            <Tippy
                content={tooltipContent}
                placement="left"
                delay={[200, 0]}
                maxWidth={260}
                hideOnClick={false}
            >
                {card}
            </Tippy>
        );
    }

    return card;
}

export function SkillTreeModal({
    unitId,
    units,
    onClose,
    onChangeUnit,
    onLearnSkill,
    formationOrder = [],
}: SkillTreeModalProps) {
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

    const tree = unitData ? getClassSkillTree(unitData.class) : undefined;
    const skillPoints = unit?.skillPoints ?? 0;

    // Build set of learned node IDs from unit.learnedSkills
    const learnedNodeIds = useMemo(() => {
        if (!tree || !unit) return new Set<string>();
        const learnedSkillNames = new Set(unit.learnedSkills ?? []);
        const ids = new Set<string>();
        for (const branch of tree.branches) {
            for (const node of branch.nodes) {
                // Skill nodes are learned if the skill is in learnedSkills
                if (node.skillName && learnedSkillNames.has(node.skillName)) {
                    ids.add(node.id);
                }
                // Passive/mastery nodes: check if node.name is in learnedSkills
                if (!node.skillName && learnedSkillNames.has(node.name)) {
                    ids.add(node.id);
                }
            }
        }
        return ids;
    }, [tree, unit]);

    const handleLearnNode = (nodeId: string) => {
        if (!tree) return;
        for (const branch of tree.branches) {
            const node = branch.nodes.find(n => n.id === nodeId);
            if (node) {
                // For skill nodes, learn the skill by its skillName; for passives/masteries, learn by node name
                const learnName = node.skillName ?? node.name;
                onLearnSkill(unitId, learnName);
                return;
            }
        }
    };

    if (!unitData || !tree) return null;

    return (
        <ModalShell
            onClose={onClose}
            overlayClassName="equipment-modal-overlay"
            contentClassName="equipment-modal skill-tree-modal"
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
                    <h2 className="char-modal-title">Skills <span className="char-modal-hotkey">K</span></h2>
                    <div className="char-modal-subtitle">{unitName}</div>
                    <div className="char-modal-desc">Hover any skill for info, and drag it to your Skill Bar to assign and use.</div>
                </div>
                <div className="char-modal-right">
                    <div className="skill-tree-points">
                        <span className={`skill-tree-points-count ${skillPoints > 0 ? "has-points" : ""}`}>
                            {skillPoints} skill {skillPoints === 1 ? "point" : "points"}
                        </span>
                    </div>
                    <button type="button" className="equipment-modal-close" onClick={onClose}>
                        <X size={18} />
                    </button>
                </div>
            </div>

            <div className="skill-tree-body">
                <div className="skill-tree-branch-headers">
                    <div className="skill-tree-tier-gutter" />
                    {tree.branches.map((branch, i) => (
                        <div key={i} className="skill-tree-branch-header" style={{ color: branch.color }}>
                            {branch.name}
                        </div>
                    ))}
                </div>
                {TIER_LABELS.map((tierLabel, tierIdx) => (
                    <div key={tierIdx} className="skill-tree-tier-row">
                        <div className="skill-tree-tier-gutter">
                            <span className="skill-tree-tier-label">{tierLabel}</span>
                        </div>
                        {tree.branches.map((branch, bi) => {
                            const node = branch.nodes[tierIdx];
                            if (!node) return <div key={bi} className="skill-tree-cell" />;
                            const learned = learnedNodeIds.has(node.id);
                            const prereqMet = !node.requires || node.requires.length === 0 || node.requires.every(req => learnedNodeIds.has(req));
                            const available = (skillPoints > 0 || learned);
                            return (
                                <div key={bi} className="skill-tree-cell">
                                    <NodeCard
                                        node={node}
                                        learned={learned}
                                        available={available}
                                        prereqMet={prereqMet}
                                        onLearn={() => handleLearnNode(node.id)}
                                    />
                                </div>
                            );
                        })}
                    </div>
                ))}
            </div>
        </ModalShell>
    );
}
