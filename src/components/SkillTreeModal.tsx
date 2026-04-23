import { useMemo } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import Tippy from "@tippyjs/react";
import type { Unit, Skill } from "../core/types";
import { CORE_PLAYER_IDS, UNIT_DATA } from "../game/playerUnits";
import { buildEffectiveFormationOrder } from "../game/formationOrder";
import { getPlayerUnitColor } from "../game/unitColors";
import { SKILLS } from "../game/skills";
import { getPortrait } from "./portraitRegistry";
import { ModalShell } from "./ModalShell";
import { getClassSkillTree, type SkillTreeNode } from "../game/skillTrees";
import { SKILL_DRAG_TYPE } from "./SkillHotbar";
import { SkillDetailsTooltip } from "./SkillDetailsTooltip";

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

function NodeCard({
    node,
    learned,
    available,
    prereqMet,
    onLearn,
    unit,
}: {
    node: SkillTreeNode;
    learned: boolean;
    available: boolean;
    prereqMet: boolean;
    onLearn: () => void;
    unit?: Unit;
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
        ? <SkillDetailsTooltip skill={skill} unit={unit} />
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
                                        unit={unit}
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
