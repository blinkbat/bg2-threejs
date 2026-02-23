import { useEffect, useMemo, useState } from "react";
import type {
    AreaDialogChoice,
    AreaDialogDefinition,
    AreaDialogMenuId,
    AreaDialogNode,
    AreaDialogTrigger,
    AreaDialogTriggerCondition,
    AreaDialogUiAction,
} from "../../game/areas/types";
import type { EnemyType } from "../../core/types";
import { DIALOG_SPEAKERS } from "../../dialog/speakers";
import type { DialogSpeakerId } from "../../dialog/types";
import { XIcon } from "lucide-react";

interface EnemySpawnOption {
    spawnIndex: number;
    x: number;
    z: number;
    enemyType: EnemyType;
}

interface DialogConditionPickerState {
    triggerId: string;
    conditionIndex: number;
}

interface DialogEditorModalProps {
    dialogs: AreaDialogDefinition[];
    dialogTriggers: AreaDialogTrigger[];
    availableDialogIds: string[];
    availableDialogIdSet: Set<string>;
    missingDialogTriggerCount: number;
    enemySpawnOptions: EnemySpawnOption[];
    mapWidth: number;
    mapHeight: number;
    dialogConditionPicker: DialogConditionPickerState | null;
    onAddDialogTrigger: () => void;
    onRemoveDialogTrigger: (triggerId: string) => void;
    onUpdateDialogTrigger: (triggerId: string, updater: (trigger: AreaDialogTrigger) => AreaDialogTrigger) => void;
    onUpdateDialogTriggerCondition: (
        triggerId: string,
        conditionIndex: number,
        updater: (condition: AreaDialogTriggerCondition) => AreaDialogTriggerCondition
    ) => void;
    onAddDialogCondition: (triggerId: string) => void;
    onRemoveDialogCondition: (triggerId: string, conditionIndex: number) => void;
    onToggleRegionPicker: (triggerId: string, conditionIndex: number) => void;
    onCancelRegionPicker: () => void;
    onClose: () => void;
    onSave: (dialogs: AreaDialogDefinition[]) => void;
}

function cloneDialogChoice(choice: AreaDialogChoice): AreaDialogChoice {
    return {
        id: choice.id,
        label: choice.label,
        ...(choice.nextNodeId ? { nextNodeId: choice.nextNodeId } : {}),
        ...(choice.onDialogEndAction ? { onDialogEndAction: { ...choice.onDialogEndAction } } : {}),
    };
}

function cloneDialogNode(node: AreaDialogNode): AreaDialogNode {
    const choices = (node.choices ?? []).map(cloneDialogChoice);
    return {
        id: node.id,
        speakerId: node.speakerId,
        text: node.text,
        ...(choices.length > 0 ? { choices } : {}),
        ...(node.nextNodeId ? { nextNodeId: node.nextNodeId } : {}),
        ...(node.continueLabel ? { continueLabel: node.continueLabel } : {}),
        ...(node.onDialogEndAction ? { onDialogEndAction: { ...node.onDialogEndAction } } : {}),
    };
}

function cloneDialogDefinition(dialog: AreaDialogDefinition): AreaDialogDefinition {
    const nodes: Record<string, AreaDialogNode> = {};
    Object.values(dialog.nodes).forEach(node => {
        nodes[node.id] = cloneDialogNode(node);
    });
    return {
        id: dialog.id,
        startNodeId: dialog.startNodeId,
        nodes,
    };
}

function createUniqueId(base: string, existingIds: Set<string>): string {
    const normalizedBase = base.trim().length > 0 ? base.trim() : "id";
    if (!existingIds.has(normalizedBase)) return normalizedBase;
    let index = 1;
    while (existingIds.has(`${normalizedBase}_${index}`)) {
        index += 1;
    }
    return `${normalizedBase}_${index}`;
}

function createDefaultNode(nodeId: string): AreaDialogNode {
    return {
        id: nodeId,
        speakerId: "innkeeper",
        text: "",
        continueLabel: "Continue",
    };
}

function createDefaultDialog(dialogId: string): AreaDialogDefinition {
    const startNodeId = "node_1";
    return {
        id: dialogId,
        startNodeId,
        nodes: {
            [startNodeId]: createDefaultNode(startNodeId),
        },
    };
}

const DIALOG_END_MENU_OPTIONS: Array<{ value: AreaDialogMenuId; label: string }> = [
    { value: "controls", label: "Controls" },
    { value: "save_game", label: "Save Menu" },
    { value: "load_game", label: "Load Menu" },
];

function toDialogEndAction(menuId: string): AreaDialogUiAction | undefined {
    if (menuId === "") return undefined;
    if (menuId !== "controls" && menuId !== "save_game" && menuId !== "load_game") return undefined;
    return {
        type: "open_menu",
        menuId,
    };
}

function toDialogEndActionMenuId(action: AreaDialogUiAction | undefined): string {
    if (!action || action.type !== "open_menu") return "";
    return action.menuId;
}

function createConditionByType(conditionType: AreaDialogTriggerCondition["type"]): AreaDialogTriggerCondition {
    if (conditionType === "on_area_load") {
        return { type: "on_area_load" };
    }
    if (conditionType === "enemy_killed") {
        return { type: "enemy_killed", spawnIndex: 0 };
    }
    if (conditionType === "party_enters_region") {
        return { type: "party_enters_region", x: 0, z: 0, w: 1, h: 1 };
    }
    if (conditionType === "unit_seen") {
        return { type: "unit_seen", spawnIndex: 0, range: 12 };
    }
    if (conditionType === "party_out_of_combat_range") {
        return { type: "party_out_of_combat_range", range: 12 };
    }
    return { type: "after_delay", ms: 1000 };
}

function clampGridCoord(value: number, maxExclusive: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(maxExclusive - 1, Math.floor(value)));
}

function isDialogSpeakerId(value: string): value is DialogSpeakerId {
    return Object.prototype.hasOwnProperty.call(DIALOG_SPEAKERS, value);
}

function stripInvalidNodeLinks(nodesById: Record<string, AreaDialogNode>): Record<string, AreaDialogNode> {
    const validNodeIds = new Set(Object.keys(nodesById));
    const nextNodes: Record<string, AreaDialogNode> = {};

    Object.values(nodesById).forEach(node => {
        const nextNodeId = node.nextNodeId && validNodeIds.has(node.nextNodeId) ? node.nextNodeId : undefined;
        const nextChoices = (node.choices ?? []).map(choice => {
            const choiceNextNodeId = choice.nextNodeId && validNodeIds.has(choice.nextNodeId) ? choice.nextNodeId : undefined;
            return {
                id: choice.id,
                label: choice.label,
                ...(choiceNextNodeId ? { nextNodeId: choiceNextNodeId } : {}),
                ...(choice.onDialogEndAction ? { onDialogEndAction: { ...choice.onDialogEndAction } } : {}),
            };
        });

        nextNodes[node.id] = {
            ...node,
            ...(nextNodeId ? { nextNodeId } : {}),
            ...(nextChoices.length > 0 ? { choices: nextChoices } : {}),
            ...(node.onDialogEndAction ? { onDialogEndAction: { ...node.onDialogEndAction } } : {}),
        };
    });

    return nextNodes;
}

function listNodeIds(dialog: AreaDialogDefinition | null): string[] {
    if (!dialog) return [];
    return Object.keys(dialog.nodes).sort((a, b) => a.localeCompare(b));
}

function buildValidationErrors(dialogs: AreaDialogDefinition[]): string[] {
    const errors: string[] = [];
    const seenDialogIds = new Set<string>();

    dialogs.forEach((dialog, dialogIndex) => {
        const dialogLabel = dialog.id.trim().length > 0 ? dialog.id : `#${dialogIndex + 1}`;
        if (dialog.id.trim().length === 0) {
            errors.push(`Dialog ${dialogLabel} has an empty ID.`);
        } else if (seenDialogIds.has(dialog.id)) {
            errors.push(`Duplicate dialog ID "${dialog.id}".`);
        } else {
            seenDialogIds.add(dialog.id);
        }

        const nodeIds = Object.keys(dialog.nodes);
        if (nodeIds.length === 0) {
            errors.push(`Dialog "${dialogLabel}" has no nodes.`);
            return;
        }

        if (!dialog.nodes[dialog.startNodeId]) {
            errors.push(`Dialog "${dialogLabel}" start node "${dialog.startNodeId}" does not exist.`);
        }

        const seenNodeIds = new Set<string>();
        nodeIds.forEach(nodeId => {
            const node = dialog.nodes[nodeId];
            if (node.id.trim().length === 0) {
                errors.push(`Dialog "${dialogLabel}" contains a node with an empty ID.`);
            } else if (seenNodeIds.has(node.id)) {
                errors.push(`Dialog "${dialogLabel}" has duplicate node ID "${node.id}".`);
            } else {
                seenNodeIds.add(node.id);
            }

            if (node.nextNodeId && !dialog.nodes[node.nextNodeId]) {
                errors.push(`Dialog "${dialogLabel}" node "${node.id}" points to missing next node "${node.nextNodeId}".`);
            }

            const seenChoiceIds = new Set<string>();
            (node.choices ?? []).forEach(choice => {
                if (choice.id.trim().length === 0) {
                    errors.push(`Dialog "${dialogLabel}" node "${node.id}" has a choice with an empty ID.`);
                } else if (seenChoiceIds.has(choice.id)) {
                    errors.push(`Dialog "${dialogLabel}" node "${node.id}" has duplicate choice ID "${choice.id}".`);
                } else {
                    seenChoiceIds.add(choice.id);
                }

                if (choice.nextNodeId && !dialog.nodes[choice.nextNodeId]) {
                    errors.push(`Dialog "${dialogLabel}" node "${node.id}" choice "${choice.id}" points to missing node "${choice.nextNodeId}".`);
                }
            });
        });
    });

    return errors;
}

function getNodePreview(text: string): string {
    const compact = text.replace(/\s+/g, " ").trim();
    if (compact.length <= 46) return compact;
    return `${compact.slice(0, 43)}...`;
}

export function DialogEditorModal({
    dialogs,
    dialogTriggers,
    availableDialogIds,
    availableDialogIdSet,
    missingDialogTriggerCount,
    enemySpawnOptions,
    mapWidth,
    mapHeight,
    dialogConditionPicker,
    onAddDialogTrigger,
    onRemoveDialogTrigger,
    onUpdateDialogTrigger,
    onUpdateDialogTriggerCondition,
    onAddDialogCondition,
    onRemoveDialogCondition,
    onToggleRegionPicker,
    onCancelRegionPicker,
    onClose,
    onSave,
}: DialogEditorModalProps) {
    const [draftDialogs, setDraftDialogs] = useState<AreaDialogDefinition[]>(() => dialogs.map(cloneDialogDefinition));
    const [selectedDialogId, setSelectedDialogId] = useState<string | null>(() => dialogs[0]?.id ?? null);
    const [selectedNodeId, setSelectedNodeId] = useState<string | null>(() => {
        const firstDialog = dialogs[0];
        if (!firstDialog) return null;
        return listNodeIds(firstDialog)[0] ?? null;
    });

    useEffect(() => {
        const onKeyDownCapture = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            event.stopPropagation();
            onClose();
        };

        window.addEventListener("keydown", onKeyDownCapture, true);
        return () => window.removeEventListener("keydown", onKeyDownCapture, true);
    }, [onClose]);

    const selectedDialog = useMemo(() => {
        if (draftDialogs.length === 0) return null;
        if (!selectedDialogId) return draftDialogs[0];
        return draftDialogs.find(dialog => dialog.id === selectedDialogId) ?? draftDialogs[0];
    }, [draftDialogs, selectedDialogId]);
    const resolvedSelectedDialogId = selectedDialog?.id ?? null;

    const selectedNode = useMemo(() => {
        if (!selectedDialog) return null;
        if (selectedNodeId && selectedDialog.nodes[selectedNodeId]) {
            return selectedDialog.nodes[selectedNodeId];
        }
        const firstNodeId = listNodeIds(selectedDialog)[0];
        return firstNodeId ? selectedDialog.nodes[firstNodeId] : null;
    }, [selectedDialog, selectedNodeId]);
    const resolvedSelectedNodeId = selectedNode?.id ?? null;

    const nodeIds = useMemo(() => listNodeIds(selectedDialog), [selectedDialog]);
    const speakerOptions = useMemo(
        () => Object.values(DIALOG_SPEAKERS).sort((a, b) => a.name.localeCompare(b.name)),
        []
    );
    const validationErrors = useMemo(() => buildValidationErrors(draftDialogs), [draftDialogs]);

    const updateDialogById = (dialogId: string, updater: (dialog: AreaDialogDefinition) => AreaDialogDefinition): void => {
        setDraftDialogs(prevDialogs => prevDialogs.map(dialog => {
            if (dialog.id !== dialogId) return dialog;
            return updater(dialog);
        }));
    };

    const updateSelectedNode = (updater: (node: AreaDialogNode) => AreaDialogNode): void => {
        if (!selectedDialog || !selectedNode) return;
        updateDialogById(selectedDialog.id, dialog => {
            const node = dialog.nodes[selectedNode.id];
            if (!node) return dialog;
            return {
                ...dialog,
                nodes: {
                    ...dialog.nodes,
                    [node.id]: updater(node),
                },
            };
        });
    };

    const addDialog = (): void => {
        const existingIds = new Set(draftDialogs.map(dialog => dialog.id));
        const dialogId = createUniqueId("dialog", existingIds);
        const dialog = createDefaultDialog(dialogId);
        setDraftDialogs(prevDialogs => [...prevDialogs, dialog]);
        setSelectedDialogId(dialogId);
        setSelectedNodeId(dialog.startNodeId);
    };

    const duplicateSelectedDialog = (): void => {
        if (!selectedDialog) return;
        const existingIds = new Set(draftDialogs.map(dialog => dialog.id));
        const duplicatedId = createUniqueId(`${selectedDialog.id}_copy`, existingIds);
        const duplicatedDialog = cloneDialogDefinition(selectedDialog);
        duplicatedDialog.id = duplicatedId;
        setDraftDialogs(prevDialogs => [...prevDialogs, duplicatedDialog]);
        setSelectedDialogId(duplicatedId);
        setSelectedNodeId(duplicatedDialog.startNodeId);
    };

    const removeSelectedDialog = (): void => {
        if (!selectedDialog) return;
        const nextDialogs = draftDialogs.filter(dialog => dialog.id !== selectedDialog.id);
        setDraftDialogs(nextDialogs);
        if (nextDialogs.length === 0) {
            setSelectedDialogId(null);
            setSelectedNodeId(null);
            return;
        }
        const fallbackDialog = nextDialogs[0];
        setSelectedDialogId(fallbackDialog.id);
        setSelectedNodeId(listNodeIds(fallbackDialog)[0] ?? null);
    };

    const renameSelectedDialog = (nextDialogIdRaw: string): void => {
        if (!selectedDialog) return;
        const nextDialogId = nextDialogIdRaw.trim();
        if (nextDialogId.length === 0 || nextDialogId === selectedDialog.id) return;
        if (draftDialogs.some(dialog => dialog.id === nextDialogId)) return;

        updateDialogById(selectedDialog.id, dialog => ({ ...dialog, id: nextDialogId }));
        setSelectedDialogId(nextDialogId);
    };

    const addNodeToSelectedDialog = (): void => {
        if (!selectedDialog) return;
        const existingNodeIds = new Set(Object.keys(selectedDialog.nodes));
        const nodeId = createUniqueId("node", existingNodeIds);
        const nextNode = createDefaultNode(nodeId);
        updateDialogById(selectedDialog.id, dialog => ({
            ...dialog,
            startNodeId: dialog.startNodeId || nodeId,
            nodes: {
                ...dialog.nodes,
                [nodeId]: nextNode,
            },
        }));
        setSelectedNodeId(nodeId);
    };

    const duplicateSelectedNode = (): void => {
        if (!selectedDialog || !selectedNode) return;
        const existingNodeIds = new Set(Object.keys(selectedDialog.nodes));
        const duplicatedNodeId = createUniqueId(`${selectedNode.id}_copy`, existingNodeIds);
        const duplicatedNode = cloneDialogNode(selectedNode);
        duplicatedNode.id = duplicatedNodeId;

        updateDialogById(selectedDialog.id, dialog => ({
            ...dialog,
            nodes: {
                ...dialog.nodes,
                [duplicatedNodeId]: duplicatedNode,
            },
        }));
        setSelectedNodeId(duplicatedNodeId);
    };

    const removeSelectedNode = (): void => {
        if (!selectedDialog || !selectedNode) return;
        if (nodeIds.length <= 1) return;

        const nextNodeId = nodeIds.find(nodeId => nodeId !== selectedNode.id) ?? null;
        updateDialogById(selectedDialog.id, dialog => {
            const remainingNodes: Record<string, AreaDialogNode> = {};
            Object.values(dialog.nodes).forEach(node => {
                if (node.id === selectedNode.id) return;
                const nextNode = node.nextNodeId === selectedNode.id ? undefined : node.nextNodeId;
                const nextChoices = (node.choices ?? []).map(choice => {
                    const choiceNextNodeId = choice.nextNodeId === selectedNode.id ? undefined : choice.nextNodeId;
                    return {
                        id: choice.id,
                        label: choice.label,
                        ...(choiceNextNodeId ? { nextNodeId: choiceNextNodeId } : {}),
                        ...(choice.onDialogEndAction ? { onDialogEndAction: { ...choice.onDialogEndAction } } : {}),
                    };
                });
                remainingNodes[node.id] = {
                    ...node,
                    ...(nextNode ? { nextNodeId: nextNode } : {}),
                    ...(nextChoices.length > 0 ? { choices: nextChoices } : {}),
                };
            });

            const cleanedNodes = stripInvalidNodeLinks(remainingNodes);
            const fallbackNodeId = nextNodeId ?? listNodeIds({ ...dialog, nodes: cleanedNodes })[0];
            return {
                ...dialog,
                startNodeId: dialog.startNodeId === selectedNode.id ? fallbackNodeId : dialog.startNodeId,
                nodes: cleanedNodes,
            };
        });
        setSelectedNodeId(nextNodeId);
    };

    const renameSelectedNode = (nextNodeIdRaw: string): void => {
        if (!selectedDialog || !selectedNode) return;
        const nextNodeId = nextNodeIdRaw.trim();
        if (nextNodeId.length === 0 || nextNodeId === selectedNode.id) return;
        if (selectedDialog.nodes[nextNodeId]) return;

        updateDialogById(selectedDialog.id, dialog => {
            const currentNode = dialog.nodes[selectedNode.id];
            if (!currentNode) return dialog;

            const renamedNode: AreaDialogNode = { ...currentNode, id: nextNodeId };
            const nextNodes: Record<string, AreaDialogNode> = {};

            Object.values(dialog.nodes).forEach(node => {
                if (node.id === selectedNode.id) return;
                const nextNodeLink = node.nextNodeId === selectedNode.id ? nextNodeId : node.nextNodeId;
                const nextChoices = (node.choices ?? []).map(choice => {
                    const choiceNextNodeId = choice.nextNodeId === selectedNode.id ? nextNodeId : choice.nextNodeId;
                    return {
                        id: choice.id,
                        label: choice.label,
                        ...(choiceNextNodeId ? { nextNodeId: choiceNextNodeId } : {}),
                        ...(choice.onDialogEndAction ? { onDialogEndAction: { ...choice.onDialogEndAction } } : {}),
                    };
                });
                nextNodes[node.id] = {
                    ...node,
                    ...(nextNodeLink ? { nextNodeId: nextNodeLink } : {}),
                    ...(nextChoices.length > 0 ? { choices: nextChoices } : {}),
                };
            });

            nextNodes[nextNodeId] = renamedNode;
            const cleanedNodes = stripInvalidNodeLinks(nextNodes);
            const startNodeId = dialog.startNodeId === selectedNode.id ? nextNodeId : dialog.startNodeId;
            return {
                ...dialog,
                startNodeId: cleanedNodes[startNodeId] ? startNodeId : nextNodeId,
                nodes: cleanedNodes,
            };
        });
        setSelectedNodeId(nextNodeId);
    };

    const addChoiceToSelectedNode = (): void => {
        if (!selectedNode) return;
        updateSelectedNode(node => {
            const existingChoices = node.choices ?? [];
            const existingChoiceIds = new Set(existingChoices.map(choice => choice.id));
            const choiceId = createUniqueId("choice", existingChoiceIds);
            return {
                ...node,
                choices: [...existingChoices, { id: choiceId, label: "Option" }],
            };
        });
    };

    const renameChoice = (choiceId: string, nextChoiceIdRaw: string): void => {
        const nextChoiceId = nextChoiceIdRaw.trim();
        if (nextChoiceId.length === 0) return;
        updateSelectedNode(node => {
            const choices = node.choices ?? [];
            if (choices.some(choice => choice.id === nextChoiceId && choice.id !== choiceId)) {
                return node;
            }
            const nextChoices = choices.map(choice => (
                choice.id === choiceId
                    ? { ...choice, id: nextChoiceId }
                    : choice
            ));
            return { ...node, choices: nextChoices };
        });
    };

    const updateChoiceLabel = (choiceId: string, label: string): void => {
        updateSelectedNode(node => {
            const choices = node.choices ?? [];
            const nextChoices = choices.map(choice => (
                choice.id === choiceId
                    ? { ...choice, label }
                    : choice
            ));
            return { ...node, choices: nextChoices };
        });
    };

    const updateChoiceNextNodeId = (choiceId: string, nextNodeId: string): void => {
        updateSelectedNode(node => {
            const choices = node.choices ?? [];
            const nextChoices = choices.map(choice => (
                choice.id === choiceId
                    ? {
                        id: choice.id,
                        label: choice.label,
                        ...(nextNodeId ? { nextNodeId } : {}),
                        ...(choice.onDialogEndAction ? { onDialogEndAction: { ...choice.onDialogEndAction } } : {}),
                    }
                    : choice
            ));
            return { ...node, choices: nextChoices };
        });
    };

    const updateChoiceDialogEndAction = (choiceId: string, menuId: string): void => {
        updateSelectedNode(node => {
            const nextAction = toDialogEndAction(menuId);
            const choices = node.choices ?? [];
            const nextChoices = choices.map(choice => (
                choice.id === choiceId
                    ? {
                        ...choice,
                        ...(nextAction ? { onDialogEndAction: nextAction } : { onDialogEndAction: undefined }),
                    }
                    : choice
            ));
            return { ...node, choices: nextChoices };
        });
    };

    const removeChoice = (choiceId: string): void => {
        updateSelectedNode(node => {
            const choices = node.choices ?? [];
            const nextChoices = choices.filter(choice => choice.id !== choiceId);
            return {
                ...node,
                ...(nextChoices.length > 0 ? { choices: nextChoices } : { choices: undefined }),
            };
        });
    };

    const saveDraftDialogs = (): void => {
        if (validationErrors.length > 0) return;
        onSave(draftDialogs.map(cloneDialogDefinition));
    };

    return (
        <div
            style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0, 0, 0, 0.68)",
                zIndex: 2600,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 20,
                pointerEvents: dialogConditionPicker ? "none" : "auto",
            }}
        >
            <div
                style={{
                    width: "min(1520px, calc(100vw - 40px))",
                    maxHeight: "calc(100vh - 40px)",
                    background: "#1f2433",
                    border: "1px solid #495064",
                    borderRadius: 10,
                    boxShadow: "0 18px 40px rgba(0, 0, 0, 0.45)",
                    color: "#f3f4f6",
                    display: "flex",
                    flexDirection: "column",
                    overflow: "hidden",
                    pointerEvents: "auto",
                }}
            >
                <div style={{ padding: "14px 16px", borderBottom: "1px solid #3e4558", display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ fontSize: 18, fontWeight: 700 }}>Dialog And Trigger Studio</div>
                    <div style={{ color: "#a7b2cd", fontSize: 12 }}>Compose dialog trees and wire map trigger conditions in one place.</div>
                    <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                        <button
                            onClick={onClose}
                            style={{ padding: "8px 10px", background: "#444b60", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12 }}
                        >
                            Cancel
                        </button>
                        <button
                            onClick={saveDraftDialogs}
                            disabled={validationErrors.length > 0}
                            style={{
                                padding: "8px 12px",
                                background: validationErrors.length > 0 ? "#5b6276" : "#2f9f63",
                                color: "#fff",
                                border: "none",
                                borderRadius: 6,
                                cursor: validationErrors.length > 0 ? "not-allowed" : "pointer",
                                fontSize: 12,
                                opacity: validationErrors.length > 0 ? 0.7 : 1,
                            }}
                        >
                            Save Dialogs
                        </button>
                    </div>
                </div>

                {dialogConditionPicker && (
                    <div style={{ padding: "8px 12px", borderBottom: "1px solid #7f6b2e", background: "rgba(210, 170, 66, 0.2)", display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ flex: 1, fontSize: 12, color: "#ffe2a6" }}>
                            Region picker active for {dialogConditionPicker.triggerId}. Drag on map canvas to set region.
                        </span>
                        <button
                            onClick={onCancelRegionPicker}
                            style={{ padding: "5px 9px", fontSize: 11, background: "#6b4a00", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}
                        >
                            Cancel Picker
                        </button>
                    </div>
                )}

                <div style={{ padding: 14, overflow: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
                    <div style={{ display: "grid", gridTemplateColumns: "260px 300px 1fr", gap: 12, minHeight: 420 }}>
                    <div style={{ border: "1px solid #3f475b", borderRadius: 8, background: "#252b3c", padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                            <div style={{ fontSize: 13, fontWeight: 700 }}>Dialogs</div>
                            <button
                                onClick={addDialog}
                                style={{ padding: "4px 8px", fontSize: 11, background: "#3484d0", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}
                            >
                                + Dialog
                            </button>
                        </div>

                        <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 280, overflowY: "auto" }}>
                            {draftDialogs.length === 0 && (
                                <div style={{ fontSize: 12, color: "#9aa6c5", padding: "6px 2px" }}>No dialogs yet.</div>
                            )}
                            {draftDialogs.map(dialog => (
                                <button
                                    key={dialog.id}
                                    onClick={() => {
                                        setSelectedDialogId(dialog.id);
                                        setSelectedNodeId(listNodeIds(dialog)[0] ?? null);
                                    }}
                                    style={{
                                        textAlign: "left",
                                        padding: "8px 10px",
                                        borderRadius: 6,
                                        border: resolvedSelectedDialogId === dialog.id ? "1px solid #5ea5ff" : "1px solid #4b5369",
                                        background: resolvedSelectedDialogId === dialog.id ? "#2d3d5c" : "#2a3041",
                                        color: "#fff",
                                        cursor: "pointer",
                                        display: "flex",
                                        flexDirection: "column",
                                        gap: 3,
                                    }}
                                >
                                    <span style={{ fontSize: 12, fontWeight: 600 }}>{dialog.id}</span>
                                    <span style={{ fontSize: 11, color: "#b9c4de" }}>{Object.keys(dialog.nodes).length} nodes</span>
                                </button>
                            ))}
                        </div>

                        {selectedDialog && (
                            <>
                                <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                    <span style={{ fontSize: 12, color: "#b8c2d9" }}>Dialog ID</span>
                                    <input
                                        value={selectedDialog.id}
                                        onChange={event => renameSelectedDialog(event.target.value)}
                                        style={{ padding: 6, borderRadius: 4, border: "1px solid #5a627a", background: "#1f2433", color: "#fff", fontSize: 12 }}
                                    />
                                </label>
                                <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                    <span style={{ fontSize: 12, color: "#b8c2d9" }}>Start Node</span>
                                    <select
                                        value={selectedDialog.startNodeId}
                                        onChange={event => {
                                            const nextStartNodeId = event.target.value;
                                            updateDialogById(selectedDialog.id, dialog => ({
                                                ...dialog,
                                                startNodeId: nextStartNodeId,
                                            }));
                                        }}
                                        style={{ padding: 6, borderRadius: 4, border: "1px solid #5a627a", background: "#1f2433", color: "#fff", fontSize: 12 }}
                                    >
                                        {nodeIds.map(nodeId => (
                                            <option key={`start-${nodeId}`} value={nodeId}>{nodeId}</option>
                                        ))}
                                    </select>
                                </label>

                                <div style={{ display: "flex", gap: 6 }}>
                                    <button
                                        onClick={duplicateSelectedDialog}
                                        style={{ flex: 1, padding: "6px 8px", fontSize: 11, background: "#4d5d96", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}
                                    >
                                        Duplicate
                                    </button>
                                    <button
                                        onClick={removeSelectedDialog}
                                        style={{ flex: 1, padding: "6px 8px", fontSize: 11, background: "#9d4040", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}
                                    >
                                        Delete
                                    </button>
                                </div>
                            </>
                        )}
                    </div>

                    <div style={{ border: "1px solid #3f475b", borderRadius: 8, background: "#252b3c", padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                            <div style={{ fontSize: 13, fontWeight: 700 }}>Nodes</div>
                            <button
                                onClick={addNodeToSelectedDialog}
                                disabled={!selectedDialog}
                                style={{
                                    padding: "4px 8px",
                                    fontSize: 11,
                                    background: selectedDialog ? "#3484d0" : "#5b6276",
                                    color: "#fff",
                                    border: "none",
                                    borderRadius: 4,
                                    cursor: selectedDialog ? "pointer" : "not-allowed",
                                }}
                            >
                                + Node
                            </button>
                        </div>

                        <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 520, overflowY: "auto" }}>
                            {!selectedDialog && (
                                <div style={{ fontSize: 12, color: "#9aa6c5", padding: "6px 2px" }}>Select a dialog to edit nodes.</div>
                            )}
                            {selectedDialog && nodeIds.map(nodeId => {
                                const node = selectedDialog.nodes[nodeId];
                                const preview = node.text.trim().length > 0 ? getNodePreview(node.text) : "(empty)";
                                return (
                                    <button
                                        key={`${selectedDialog.id}-${node.id}`}
                                        onClick={() => setSelectedNodeId(node.id)}
                                        style={{
                                            textAlign: "left",
                                            padding: "8px 10px",
                                            borderRadius: 6,
                                            border: resolvedSelectedNodeId === node.id ? "1px solid #5ea5ff" : "1px solid #4b5369",
                                            background: resolvedSelectedNodeId === node.id ? "#2d3d5c" : "#2a3041",
                                            color: "#fff",
                                            cursor: "pointer",
                                            display: "flex",
                                            flexDirection: "column",
                                            gap: 3,
                                        }}
                                    >
                                        <span style={{ fontSize: 12, fontWeight: 600 }}>{node.id}</span>
                                        <span style={{ fontSize: 11, color: "#b9c4de" }}>{DIALOG_SPEAKERS[node.speakerId].name}</span>
                                        <span style={{ fontSize: 11, color: "#a7b3d2" }}>{preview}</span>
                                    </button>
                                );
                            })}
                        </div>

                        {selectedNode && (
                            <div style={{ display: "flex", gap: 6 }}>
                                <button
                                    onClick={duplicateSelectedNode}
                                    style={{ flex: 1, padding: "6px 8px", fontSize: 11, background: "#4d5d96", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}
                                >
                                    Duplicate
                                </button>
                                <button
                                    onClick={removeSelectedNode}
                                    disabled={nodeIds.length <= 1}
                                    style={{
                                        flex: 1,
                                        padding: "6px 8px",
                                        fontSize: 11,
                                        background: nodeIds.length <= 1 ? "#5b6276" : "#9d4040",
                                        color: "#fff",
                                        border: "none",
                                        borderRadius: 4,
                                        cursor: nodeIds.length <= 1 ? "not-allowed" : "pointer",
                                    }}
                                >
                                    Delete
                                </button>
                            </div>
                        )}
                    </div>

                    <div style={{ border: "1px solid #3f475b", borderRadius: 8, background: "#252b3c", padding: 10, display: "flex", flexDirection: "column", gap: 10 }}>
                        {!selectedNode && (
                            <div style={{ fontSize: 13, color: "#9aa6c5" }}>Select a node to edit dialog text and choices.</div>
                        )}

                        {selectedNode && selectedDialog && (
                            <>
                                <div style={{ display: "flex", gap: 8 }}>
                                    <label style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
                                        <span style={{ fontSize: 12, color: "#b8c2d9" }}>Node ID</span>
                                        <input
                                            value={selectedNode.id}
                                            onChange={event => renameSelectedNode(event.target.value)}
                                            style={{ padding: 6, borderRadius: 4, border: "1px solid #5a627a", background: "#1f2433", color: "#fff", fontSize: 12 }}
                                        />
                                    </label>
                                    <label style={{ width: 220, display: "flex", flexDirection: "column", gap: 4 }}>
                                        <span style={{ fontSize: 12, color: "#b8c2d9" }}>Speaker</span>
                                        <select
                                            value={selectedNode.speakerId}
                                            onChange={event => {
                                                const nextSpeakerId = event.target.value;
                                                if (!isDialogSpeakerId(nextSpeakerId)) return;
                                                updateSelectedNode(node => ({ ...node, speakerId: nextSpeakerId }));
                                            }}
                                            style={{ padding: 6, borderRadius: 4, border: "1px solid #5a627a", background: "#1f2433", color: "#fff", fontSize: 12 }}
                                        >
                                            {speakerOptions.map(speaker => (
                                                <option key={`speaker-${speaker.id}`} value={speaker.id}>{speaker.name}</option>
                                            ))}
                                        </select>
                                    </label>
                                </div>

                                <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                    <span style={{ fontSize: 12, color: "#b8c2d9" }}>Dialog Text</span>
                                    <textarea
                                        value={selectedNode.text}
                                        onChange={event => updateSelectedNode(node => ({ ...node, text: event.target.value }))}
                                        rows={7}
                                        style={{ padding: 8, borderRadius: 4, border: "1px solid #5a627a", background: "#1f2433", color: "#fff", fontSize: 13, resize: "vertical", lineHeight: 1.45 }}
                                    />
                                </label>

                                <div style={{ display: "flex", gap: 8 }}>
                                    <label style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
                                        <span style={{ fontSize: 12, color: "#b8c2d9" }}>Next Node (no choices)</span>
                                        <select
                                            value={selectedNode.nextNodeId ?? ""}
                                            onChange={event => {
                                                const nextNodeId = event.target.value;
                                                updateSelectedNode(node => ({
                                                    ...node,
                                                    ...(nextNodeId ? { nextNodeId } : { nextNodeId: undefined }),
                                                }));
                                            }}
                                            style={{ padding: 6, borderRadius: 4, border: "1px solid #5a627a", background: "#1f2433", color: "#fff", fontSize: 12 }}
                                        >
                                            <option value="">(end dialog)</option>
                                            {nodeIds.map(nodeId => (
                                                <option key={`next-node-${nodeId}`} value={nodeId}>{nodeId}</option>
                                            ))}
                                        </select>
                                    </label>
                                    <label style={{ width: 220, display: "flex", flexDirection: "column", gap: 4 }}>
                                        <span style={{ fontSize: 12, color: "#b8c2d9" }}>Continue Button Label</span>
                                        <input
                                            value={selectedNode.continueLabel ?? ""}
                                            onChange={event => updateSelectedNode(node => ({
                                                ...node,
                                                ...(event.target.value.trim().length > 0
                                                    ? { continueLabel: event.target.value }
                                                    : { continueLabel: undefined }),
                                            }))}
                                            placeholder="Continue"
                                            style={{ padding: 6, borderRadius: 4, border: "1px solid #5a627a", background: "#1f2433", color: "#fff", fontSize: 12 }}
                                        />
                                    </label>
                                    <label style={{ width: 220, display: "flex", flexDirection: "column", gap: 4 }}>
                                        <span style={{ fontSize: 12, color: "#b8c2d9" }}>After Dialog Ends</span>
                                        <select
                                            value={toDialogEndActionMenuId(selectedNode.onDialogEndAction)}
                                            onChange={event => updateSelectedNode(node => {
                                                const nextAction = toDialogEndAction(event.target.value);
                                                return {
                                                    ...node,
                                                    ...(nextAction ? { onDialogEndAction: nextAction } : { onDialogEndAction: undefined }),
                                                };
                                            })}
                                            style={{ padding: 6, borderRadius: 4, border: "1px solid #5a627a", background: "#1f2433", color: "#fff", fontSize: 12 }}
                                        >
                                            <option value="">(none)</option>
                                            {DIALOG_END_MENU_OPTIONS.map(option => (
                                                <option key={`dialog-end-action-${option.value}`} value={option.value}>{option.label}</option>
                                            ))}
                                        </select>
                                    </label>
                                </div>

                                <div style={{ borderTop: "1px solid #3d465b", paddingTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                        <div style={{ fontSize: 13, fontWeight: 700 }}>Choices</div>
                                        <button
                                            onClick={addChoiceToSelectedNode}
                                            style={{ padding: "4px 8px", fontSize: 11, background: "#3484d0", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}
                                        >
                                            + Choice
                                        </button>
                                    </div>

                                    {(selectedNode.choices ?? []).length === 0 && (
                                        <div style={{ fontSize: 12, color: "#9aa6c5" }}>
                                            No choices. Node advances using "Next Node" + continue key/button.
                                        </div>
                                    )}

                                    {(selectedNode.choices ?? []).map(choice => (
                                        <div
                                            key={`${selectedNode.id}-${choice.id}`}
                                            style={{
                                                border: "1px solid #4b5369",
                                                borderRadius: 6,
                                                padding: 8,
                                                background: "#2a3041",
                                                display: "grid",
                                                gridTemplateColumns: "160px 1fr 170px 170px 70px",
                                                gap: 8,
                                                alignItems: "center",
                                            }}
                                        >
                                            <input
                                                value={choice.id}
                                                onChange={event => renameChoice(choice.id, event.target.value)}
                                                style={{ padding: 6, borderRadius: 4, border: "1px solid #5a627a", background: "#1f2433", color: "#fff", fontSize: 12 }}
                                            />
                                            <input
                                                value={choice.label}
                                                onChange={event => updateChoiceLabel(choice.id, event.target.value)}
                                                placeholder="Choice label"
                                                style={{ padding: 6, borderRadius: 4, border: "1px solid #5a627a", background: "#1f2433", color: "#fff", fontSize: 12 }}
                                            />
                                            <select
                                                value={choice.nextNodeId ?? ""}
                                                onChange={event => updateChoiceNextNodeId(choice.id, event.target.value)}
                                                style={{ padding: 6, borderRadius: 4, border: "1px solid #5a627a", background: "#1f2433", color: "#fff", fontSize: 12 }}
                                            >
                                                <option value="">(end dialog)</option>
                                                {nodeIds.map(nodeId => (
                                                    <option key={`choice-next-${choice.id}-${nodeId}`} value={nodeId}>{nodeId}</option>
                                                ))}
                                            </select>
                                            <select
                                                value={toDialogEndActionMenuId(choice.onDialogEndAction)}
                                                onChange={event => updateChoiceDialogEndAction(choice.id, event.target.value)}
                                                style={{ padding: 6, borderRadius: 4, border: "1px solid #5a627a", background: "#1f2433", color: "#fff", fontSize: 12 }}
                                            >
                                                <option value="">(no end action)</option>
                                                {DIALOG_END_MENU_OPTIONS.map(option => (
                                                    <option key={`choice-end-action-${choice.id}-${option.value}`} value={option.value}>{option.label}</option>
                                                ))}
                                            </select>
                                            <button
                                                onClick={() => removeChoice(choice.id)}
                                                style={{ padding: "6px 8px", fontSize: 11, background: "#9d4040", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}
                                            >
                                                Remove
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </>
                        )}
                    </div>

                    <div style={{ border: "1px solid #3f475b", borderRadius: 8, background: "#252b3c", padding: 10, display: "flex", flexDirection: "column", gap: 10 }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                            <h3 style={{ margin: 0, fontSize: 16 }}>Dialog Triggers</h3>
                            <button
                                onClick={onAddDialogTrigger}
                                style={{ padding: "6px 10px", fontSize: 12, background: "#2f5", color: "#111", border: "none", borderRadius: 4, cursor: "pointer" }}
                            >
                                + Trigger
                            </button>
                        </div>

                        {missingDialogTriggerCount > 0 && (
                            <div style={{ fontSize: 12, color: "#ffb4b4", background: "rgba(154, 62, 62, 0.2)", border: "1px solid #8f4747", borderRadius: 6, padding: "6px 8px" }}>
                                {missingDialogTriggerCount} trigger{missingDialogTriggerCount === 1 ? "" : "s"} reference dialog IDs that are not defined.
                            </div>
                        )}

                        {dialogTriggers.length === 0 && (
                            <div style={{ fontSize: 12, color: "#888" }}>No dialog triggers in this area.</div>
                        )}

                        {dialogTriggers.map((trigger, triggerIndex) => {
                            const isMissingDialogId = !availableDialogIdSet.has(trigger.dialogId);
                            const dialogIdOptions = isMissingDialogId
                                ? [trigger.dialogId, ...availableDialogIds]
                                : availableDialogIds;

                            return (
                                <div
                                    key={trigger.id}
                                    style={{
                                        border: isMissingDialogId ? "1px solid #a05f5f" : "1px solid #4b5165",
                                        background: "#2a2f3f",
                                        borderRadius: 8,
                                        padding: 10,
                                        display: "flex",
                                        flexDirection: "column",
                                        gap: 8
                                    }}
                                >
                                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                        <span style={{ fontSize: 12, color: "#9fb5dc" }}>Trigger {triggerIndex + 1}</span>
                                        <button
                                            onClick={() => onRemoveDialogTrigger(trigger.id)}
                                            style={{ marginLeft: "auto", padding: "4px 8px", fontSize: 11, background: "#a44", color: "#fff", border: "none", borderRadius: 3, cursor: "pointer" }}
                                        >
                                            Remove
                                        </button>
                                    </div>

                                    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                        <span style={{ fontSize: 12 }}>ID</span>
                                        <input
                                            value={trigger.id}
                                            onChange={event => {
                                                const nextId = event.target.value.trim();
                                                if (!nextId) return;
                                                onUpdateDialogTrigger(trigger.id, current => ({ ...current, id: nextId }));
                                            }}
                                            style={{ padding: 6, fontSize: 12, background: "#1f2433", border: "1px solid #555d73", borderRadius: 4, color: "#fff" }}
                                        />
                                    </label>

                                    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                        <span style={{ fontSize: 12 }}>Dialog ID</span>
                                        {dialogIdOptions.length > 0 ? (
                                            <select
                                                value={trigger.dialogId}
                                                onChange={event => onUpdateDialogTrigger(trigger.id, current => ({ ...current, dialogId: event.target.value }))}
                                                style={{
                                                    padding: 6,
                                                    fontSize: 12,
                                                    background: "#1f2433",
                                                    border: isMissingDialogId ? "1px solid #9b5d5d" : "1px solid #555d73",
                                                    borderRadius: 4,
                                                    color: "#fff"
                                                }}
                                            >
                                                {dialogIdOptions.map(dialogId => (
                                                    <option key={dialogId} value={dialogId}>{dialogId}</option>
                                                ))}
                                            </select>
                                        ) : (
                                            <input
                                                value={trigger.dialogId}
                                                onChange={event => onUpdateDialogTrigger(trigger.id, current => ({ ...current, dialogId: event.target.value }))}
                                                style={{
                                                    padding: 6,
                                                    fontSize: 12,
                                                    background: "#1f2433",
                                                    border: isMissingDialogId ? "1px solid #9b5d5d" : "1px solid #555d73",
                                                    borderRadius: 4,
                                                    color: "#fff"
                                                }}
                                            />
                                        )}
                                        {isMissingDialogId && (
                                            <span style={{ fontSize: 11, color: "#ffb4b4" }}>
                                                Missing dialog definition for "{trigger.dialogId}".
                                            </span>
                                        )}
                                    </label>

                                    <div style={{ display: "flex", gap: 8 }}>
                                        <label style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
                                            <span style={{ fontSize: 12 }}>Priority</span>
                                            <input
                                                type="number"
                                                value={trigger.priority ?? 0}
                                                onChange={event => onUpdateDialogTrigger(trigger.id, current => ({ ...current, priority: Number(event.target.value) || 0 }))}
                                                style={{ padding: 6, fontSize: 12, background: "#1f2433", border: "1px solid #555d73", borderRadius: 4, color: "#fff" }}
                                            />
                                        </label>
                                        <label style={{ width: 130, display: "flex", alignItems: "center", gap: 8, fontSize: 12, marginTop: 20 }}>
                                            <input
                                                type="checkbox"
                                                checked={trigger.once !== false}
                                                onChange={event => onUpdateDialogTrigger(trigger.id, current => ({ ...current, once: event.target.checked }))}
                                            />
                                            Once per visit
                                        </label>
                                    </div>

                                    <div style={{ fontSize: 12, color: "#a8b2cc", marginTop: 2 }}>Conditions (all must be true)</div>
                                    {trigger.conditions.map((condition, conditionIndex) => (
                                        <div key={`${trigger.id}-condition-${conditionIndex}`} style={{ border: "1px solid #475067", borderRadius: 6, padding: 8, background: "#23293a", display: "flex", flexDirection: "column", gap: 8 }}>
                                            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                                <select
                                                    value={condition.type}
                                                    onChange={event => {
                                                        const nextType = event.target.value as AreaDialogTriggerCondition["type"];
                                                        onUpdateDialogTriggerCondition(trigger.id, conditionIndex, () => createConditionByType(nextType));
                                                        if (nextType !== "party_enters_region") {
                                                            onCancelRegionPicker();
                                                        }
                                                    }}
                                                    style={{ flex: 1, padding: 6, fontSize: 12, background: "#1f2433", border: "1px solid #555d73", borderRadius: 4, color: "#fff" }}
                                                >
                                                    <option value="on_area_load">Load Into Map</option>
                                                    <option value="enemy_killed">Specific Unit Killed</option>
                                                    <option value="party_enters_region">Enter Dragged Region</option>
                                                    <option value="unit_seen">Unit Seen</option>
                                                    <option value="party_out_of_combat_range">Out Of Combat Range</option>
                                                    <option value="after_delay">Delay After Load</option>
                                                </select>
                                                <button
                                                    onClick={() => onRemoveDialogCondition(trigger.id, conditionIndex)}
                                                    style={{ padding: "4px", fontSize: 11, background: "#934", color: "#fff", border: "none", borderRadius: 3, cursor: "pointer" }}
                                                >
                                                    <XIcon style={{ width: 12, height: 12 }} />
                                                </button>
                                            </div>

                                            {condition.type === "enemy_killed" && (
                                                <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                                    <span style={{ fontSize: 12 }}>Enemy Spawn</span>
                                                    <select
                                                        value={condition.spawnIndex}
                                                        onChange={event => onUpdateDialogTriggerCondition(trigger.id, conditionIndex, current => {
                                                            if (current.type !== "enemy_killed") return current;
                                                            return { ...current, spawnIndex: parseInt(event.target.value, 10) || 0 };
                                                        })}
                                                        style={{ padding: 6, fontSize: 12, background: "#1f2433", border: "1px solid #555d73", borderRadius: 4, color: "#fff" }}
                                                    >
                                                        {enemySpawnOptions.map(spawn => (
                                                            <option key={`enemy-killed-${spawn.spawnIndex}`} value={spawn.spawnIndex}>
                                                                #{spawn.spawnIndex}: {spawn.enemyType} ({spawn.x},{spawn.z})
                                                            </option>
                                                        ))}
                                                        {enemySpawnOptions.length === 0 && <option value={0}>No enemy spawns</option>}
                                                    </select>
                                                </label>
                                            )}

                                            {condition.type === "unit_seen" && (
                                                <div style={{ display: "flex", gap: 8 }}>
                                                    <label style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
                                                        <span style={{ fontSize: 12 }}>Enemy Spawn</span>
                                                        <select
                                                            value={condition.spawnIndex}
                                                            onChange={event => onUpdateDialogTriggerCondition(trigger.id, conditionIndex, current => {
                                                                if (current.type !== "unit_seen") return current;
                                                                return { ...current, spawnIndex: parseInt(event.target.value, 10) || 0 };
                                                            })}
                                                            style={{ padding: 6, fontSize: 12, background: "#1f2433", border: "1px solid #555d73", borderRadius: 4, color: "#fff" }}
                                                        >
                                                            {enemySpawnOptions.map(spawn => (
                                                                <option key={`unit-seen-${spawn.spawnIndex}`} value={spawn.spawnIndex}>
                                                                    #{spawn.spawnIndex}: {spawn.enemyType} ({spawn.x},{spawn.z})
                                                                </option>
                                                            ))}
                                                            {enemySpawnOptions.length === 0 && <option value={0}>No enemy spawns</option>}
                                                        </select>
                                                    </label>
                                                    <label style={{ width: 120, display: "flex", flexDirection: "column", gap: 4 }}>
                                                        <span style={{ fontSize: 12 }}>Range</span>
                                                        <input
                                                            type="number"
                                                            min={0.1}
                                                            step={0.1}
                                                            value={condition.range ?? 12}
                                                            onChange={event => onUpdateDialogTriggerCondition(trigger.id, conditionIndex, current => {
                                                                if (current.type !== "unit_seen") return current;
                                                                return { ...current, range: Math.max(0.1, Number(event.target.value) || 12) };
                                                            })}
                                                            style={{ padding: 6, fontSize: 12, background: "#1f2433", border: "1px solid #555d73", borderRadius: 4, color: "#fff" }}
                                                        />
                                                    </label>
                                                </div>
                                            )}

                                            {condition.type === "party_enters_region" && (
                                                <>
                                                    <div style={{ display: "flex", gap: 8 }}>
                                                        <label style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
                                                            <span style={{ fontSize: 12 }}>X</span>
                                                            <input
                                                                type="number"
                                                                value={condition.x}
                                                                onChange={event => onUpdateDialogTriggerCondition(trigger.id, conditionIndex, current => {
                                                                    if (current.type !== "party_enters_region") return current;
                                                                    return { ...current, x: clampGridCoord(Number(event.target.value), mapWidth) };
                                                                })}
                                                                style={{ padding: 6, fontSize: 12, background: "#1f2433", border: "1px solid #555d73", borderRadius: 4, color: "#fff" }}
                                                            />
                                                        </label>
                                                        <label style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
                                                            <span style={{ fontSize: 12 }}>Z</span>
                                                            <input
                                                                type="number"
                                                                value={condition.z}
                                                                onChange={event => onUpdateDialogTriggerCondition(trigger.id, conditionIndex, current => {
                                                                    if (current.type !== "party_enters_region") return current;
                                                                    return { ...current, z: clampGridCoord(Number(event.target.value), mapHeight) };
                                                                })}
                                                                style={{ padding: 6, fontSize: 12, background: "#1f2433", border: "1px solid #555d73", borderRadius: 4, color: "#fff" }}
                                                            />
                                                        </label>
                                                        <label style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
                                                            <span style={{ fontSize: 12 }}>W</span>
                                                            <input
                                                                type="number"
                                                                min={1}
                                                                value={condition.w}
                                                                onChange={event => onUpdateDialogTriggerCondition(trigger.id, conditionIndex, current => {
                                                                    if (current.type !== "party_enters_region") return current;
                                                                    return { ...current, w: Math.max(1, parseInt(event.target.value, 10) || 1) };
                                                                })}
                                                                style={{ padding: 6, fontSize: 12, background: "#1f2433", border: "1px solid #555d73", borderRadius: 4, color: "#fff" }}
                                                            />
                                                        </label>
                                                        <label style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
                                                            <span style={{ fontSize: 12 }}>H</span>
                                                            <input
                                                                type="number"
                                                                min={1}
                                                                value={condition.h}
                                                                onChange={event => onUpdateDialogTriggerCondition(trigger.id, conditionIndex, current => {
                                                                    if (current.type !== "party_enters_region") return current;
                                                                    return { ...current, h: Math.max(1, parseInt(event.target.value, 10) || 1) };
                                                                })}
                                                                style={{ padding: 6, fontSize: 12, background: "#1f2433", border: "1px solid #555d73", borderRadius: 4, color: "#fff" }}
                                                            />
                                                        </label>
                                                    </div>
                                                    <button
                                                        onClick={() => onToggleRegionPicker(trigger.id, conditionIndex)}
                                                        style={{
                                                            padding: "6px 8px",
                                                            fontSize: 11,
                                                            background: dialogConditionPicker?.triggerId === trigger.id && dialogConditionPicker.conditionIndex === conditionIndex ? "#b8860b" : "#555",
                                                            color: "#fff",
                                                            border: "none",
                                                            borderRadius: 4,
                                                            cursor: "pointer"
                                                        }}
                                                    >
                                                        {dialogConditionPicker?.triggerId === trigger.id && dialogConditionPicker.conditionIndex === conditionIndex ? "Cancel Region Pick" : "Pick Region By Drag"}
                                                    </button>
                                                </>
                                            )}

                                            {condition.type === "party_out_of_combat_range" && (
                                                <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                                    <span style={{ fontSize: 12 }}>Range</span>
                                                    <input
                                                        type="number"
                                                        min={0.1}
                                                        step={0.1}
                                                        value={condition.range}
                                                        onChange={event => onUpdateDialogTriggerCondition(trigger.id, conditionIndex, current => {
                                                            if (current.type !== "party_out_of_combat_range") return current;
                                                            return { ...current, range: Math.max(0.1, Number(event.target.value) || 12) };
                                                        })}
                                                        style={{ padding: 6, fontSize: 12, background: "#1f2433", border: "1px solid #555d73", borderRadius: 4, color: "#fff" }}
                                                    />
                                                </label>
                                            )}

                                            {condition.type === "after_delay" && (
                                                <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                                    <span style={{ fontSize: 12 }}>Delay (ms)</span>
                                                    <input
                                                        type="number"
                                                        min={0}
                                                        step={100}
                                                        value={condition.ms}
                                                        onChange={event => onUpdateDialogTriggerCondition(trigger.id, conditionIndex, current => {
                                                            if (current.type !== "after_delay") return current;
                                                            return { ...current, ms: Math.max(0, parseInt(event.target.value, 10) || 0) };
                                                        })}
                                                        style={{ padding: 6, fontSize: 12, background: "#1f2433", border: "1px solid #555d73", borderRadius: 4, color: "#fff" }}
                                                    />
                                                </label>
                                            )}
                                        </div>
                                    ))}

                                    <button
                                        onClick={() => onAddDialogCondition(trigger.id)}
                                        style={{ alignSelf: "flex-start", padding: "6px 10px", fontSize: 11, background: "#355eaa", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}
                                    >
                                        + Condition
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                </div>
                </div>

                <div style={{ borderTop: "1px solid #3e4558", padding: "10px 14px", background: "#202637" }}>
                    {validationErrors.length === 0 ? (
                        <div style={{ color: "#71d7a2", fontSize: 12 }}>Dialog data is valid.</div>
                    ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                            <div style={{ color: "#ffb7b7", fontSize: 12, fontWeight: 700 }}>Resolve these issues before saving:</div>
                            <div style={{ color: "#ffd6d6", fontSize: 12, maxHeight: 86, overflowY: "auto", lineHeight: 1.4 }}>
                                {validationErrors.map(error => (
                                    <div key={error}>- {error}</div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
