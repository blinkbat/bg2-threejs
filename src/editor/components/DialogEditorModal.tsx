import { useEffect, useMemo, useRef, useState } from "react";
import type {
    AreaDialogChoiceCondition,
    AreaDialogDefinition,
    AreaDialogEventId,
    AreaDialogMenuId,
    AreaDialogNode,
    AreaLocation,
    AreaDialogTrigger,
    AreaDialogTriggerAction,
    AreaDialogTriggerCondition,
} from "../../game/areas/types";
import { DIALOG_SPEAKERS } from "../../dialog/speakers";
import {
    AlertTriangleIcon,
    CheckIcon,
    ChevronRightIcon,
    MessageSquareIcon,
    PlusIcon,
    SaveIcon,
    XIcon,
} from "lucide-react";
import {
    buildValidationErrors,
    clampGridCoord,
    cloneDialogDefinition,
    cloneDialogNode,
    cloneDialogTrigger,
    cloneDialogTriggerAction,
    createConditionByType,
    createDefaultDialog,
    createDefaultNode,
    createMenuNode,
    createUniqueId,
    describeTriggerCondition,
    getMenuNodeLabel,
    getNodePreview,
    getTriggerConditionTypeLabel,
    getTriggerStartDialogId,
    isDialogConditionValid,
    isDialogSpeakerId,
    listNodeIds,
    MENU_NODE_OPTIONS,
    SAVE_FEEDBACK_MS,
    stripInvalidNodeLinks,
    toDialogEndAction,
    toDialogEndActionMenuId,
    TRIGGER_CONDITION_OPTIONS,
    TRIGGER_FILTER_OPTIONS,
    type EnemySpawnOption,
    type TriggerListFilter,
    type TriggerValidationState,
} from "./dialogEditorHelpers";

interface DialogEditorModalProps {
    dialogs: AreaDialogDefinition[];
    dialogLocations: AreaLocation[];
    dialogTriggers: AreaDialogTrigger[];
    availableDialogIds: string[];
    availableDialogIdSet: Set<string>;
    enemySpawnOptions: EnemySpawnOption[];
    mapWidth: number;
    mapHeight: number;
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
    onClose: () => void;
    onSaveDialogs: (dialogs: AreaDialogDefinition[], dialogIdRemap?: Record<string, string>) => void;
    onSaveTriggers: (triggers: AreaDialogTrigger[]) => void;
}

export function DialogEditorModal({
    dialogs,
    dialogLocations,
    dialogTriggers,
    availableDialogIds,
    availableDialogIdSet,
    enemySpawnOptions,
    mapWidth,
    mapHeight,
    onAddDialogTrigger,
    onRemoveDialogTrigger,
    onUpdateDialogTrigger,
    onUpdateDialogTriggerCondition,
    onAddDialogCondition,
    onRemoveDialogCondition,
    onClose,
    onSaveDialogs,
    onSaveTriggers,
}: DialogEditorModalProps) {
    const [draftDialogs, setDraftDialogs] = useState<AreaDialogDefinition[]>(() => dialogs.map(cloneDialogDefinition));
    const [selectedTriggerId, setSelectedTriggerId] = useState<string | null>(() => dialogTriggers[0]?.id ?? null);
    const [selectedDialogId, setSelectedDialogId] = useState<string | null>(() => dialogs[0]?.id ?? null);
    const [selectedNodeId, setSelectedNodeId] = useState<string | null>(() => {
        const firstDialog = dialogs[0];
        if (!firstDialog) return null;
        return listNodeIds(firstDialog)[0] ?? null;
    });
    const [saved, setSaved] = useState(false);
    const [editorView, setEditorView] = useState<"list" | "trigger" | "dialog">("list");
    const [triggerTab, setTriggerTab] = useState<"conditions" | "actions">("conditions");
    const [triggerSearchText, setTriggerSearchText] = useState("");
    const [triggerFilter, setTriggerFilter] = useState<TriggerListFilter>("all");
    const savedTimeoutRef = useRef<number | null>(null);
    const knownTriggerIdsRef = useRef<Set<string>>(new Set(dialogTriggers.map(trigger => trigger.id)));
    const initialDialogIdsRef = useRef<Set<string>>(new Set(dialogs.map(dialog => dialog.id)));
    const dialogIdRemapRef = useRef<Map<string, string>>(new Map());

    useEffect(() => {
        const onKeyDownCapture = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            event.stopPropagation();
            if (editorView === "dialog") {
                setEditorView("trigger");
                return;
            }
            if (editorView === "trigger") {
                setEditorView("list");
                return;
            }
            onClose();
        };

        window.addEventListener("keydown", onKeyDownCapture, true);
        return () => window.removeEventListener("keydown", onKeyDownCapture, true);
    }, [onClose, editorView]);

    useEffect(() => {
        return () => {
            if (savedTimeoutRef.current !== null) {
                window.clearTimeout(savedTimeoutRef.current);
                savedTimeoutRef.current = null;
            }
        };
    }, []);

    useEffect(() => {
        const previousIds = knownTriggerIdsRef.current;
        const nextIds = new Set(dialogTriggers.map(trigger => trigger.id));
        const newestTrigger = dialogTriggers.find(trigger => !previousIds.has(trigger.id));
        if (newestTrigger) {
            setSelectedTriggerId(newestTrigger.id);
        } else if (selectedTriggerId && !nextIds.has(selectedTriggerId)) {
            setSelectedTriggerId(dialogTriggers[0]?.id ?? null);
        }
        knownTriggerIdsRef.current = nextIds;
    }, [dialogTriggers, selectedTriggerId]);

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

    const selectedTrigger = useMemo(() => {
        if (dialogTriggers.length === 0) return null;
        if (!selectedTriggerId) return dialogTriggers[0];
        return dialogTriggers.find(trigger => trigger.id === selectedTriggerId) ?? dialogTriggers[0];
    }, [dialogTriggers, selectedTriggerId]);

    const nodeIds = useMemo(() => listNodeIds(selectedDialog), [selectedDialog]);
    const speakerOptions = useMemo(
        () => Object.values(DIALOG_SPEAKERS).sort((a, b) => a.name.localeCompare(b.name)),
        []
    );
    const validationErrors = useMemo(() => buildValidationErrors(draftDialogs), [draftDialogs]);
    const triggerValidationById = useMemo(() => {
        const next = new Map<string, TriggerValidationState>();
        const triggerIdCounts = new Map<string, number>();
        dialogTriggers.forEach(trigger => {
            const count = triggerIdCounts.get(trigger.id) ?? 0;
            triggerIdCounts.set(trigger.id, count + 1);
        });
        dialogTriggers.forEach(trigger => {
            const issues: string[] = [];
            const duplicateTriggerId = (triggerIdCounts.get(trigger.id) ?? 0) > 1;
            if (duplicateTriggerId) {
                issues.push(`Trigger ID "${trigger.id}" is duplicated. Trigger IDs must be unique.`);
            }
            const conditionStepValid = trigger.conditions.length > 0
                && trigger.conditions.every(condition => isDialogConditionValid(
                    condition,
                    enemySpawnOptions,
                    dialogLocations,
                    mapWidth,
                    mapHeight
                ));
            if (!conditionStepValid) {
                issues.push("Step 1 is incomplete. Add at least one valid condition.");
            }

            const targetDialogId = getTriggerStartDialogId(trigger).trim();
            const hasTargetDialogId = targetDialogId.length > 0;
            if (!hasTargetDialogId) {
                issues.push("Step 2 is incomplete. Choose a dialog action target.");
            }
            const targetDialogExists = hasTargetDialogId && availableDialogIdSet.has(targetDialogId);
            if (hasTargetDialogId && !targetDialogExists) {
                issues.push(`Dialog "${targetDialogId}" is not defined in this area.`);
            }

            const actionStepValid = hasTargetDialogId && targetDialogExists;
            next.set(trigger.id, {
                conditionStepValid,
                actionStepValid,
                isValid: conditionStepValid && actionStepValid && !duplicateTriggerId,
                hasHardBlockingIssue: duplicateTriggerId,
                targetDialogId,
                issues,
            });
        });
        return next;
    }, [availableDialogIdSet, dialogLocations, dialogTriggers, enemySpawnOptions, mapHeight, mapWidth]);
    const blockingTriggerIssues = useMemo(() => {
        return dialogTriggers.filter(trigger => {
            const validation = triggerValidationById.get(trigger.id);
            if (!validation) return false;
            if (validation.hasHardBlockingIssue) return true;
            return !validation.isValid && !trigger.wip;
        }).length;
    }, [dialogTriggers, triggerValidationById]);
    const canSaveTriggers = blockingTriggerIssues === 0;
    const spawnLabelByIndex = useMemo(() => {
        const next = new Map<number, string>();
        enemySpawnOptions.forEach(spawn => {
            next.set(spawn.spawnIndex, `#${spawn.spawnIndex}: ${spawn.enemyType} (${spawn.x},${spawn.z})`);
        });
        return next;
    }, [enemySpawnOptions]);
    const npcSpawnOptions = useMemo(
        () => enemySpawnOptions.filter(spawn => spawn.enemyType === "innkeeper"),
        [enemySpawnOptions]
    );
    const locationLabelById = useMemo(() => {
        const next = new Map<string, string>();
        dialogLocations.forEach(location => {
            next.set(location.id, `${location.id} (${location.x},${location.z},${location.w}x${location.h})`);
        });
        return next;
    }, [dialogLocations]);
    const normalizedTriggerSearch = triggerSearchText.trim().toLowerCase();
    const filteredDialogTriggers = useMemo(() => {
        return dialogTriggers.filter(trigger => {
            const validation = triggerValidationById.get(trigger.id);
            const targetDialogId = getTriggerStartDialogId(trigger).trim();
            const matchesFilter = (() => {
                if (triggerFilter === "all") return true;
                if (triggerFilter === "needs_fix") {
                    return Boolean(validation && !validation.isValid && !trigger.wip);
                }
                if (triggerFilter === "ready") {
                    return Boolean(validation?.isValid);
                }
                return trigger.wip === true;
            })();
            if (!matchesFilter) return false;
            if (normalizedTriggerSearch.length === 0) return true;
            const conditionSummaries = trigger.conditions
                .map(condition => describeTriggerCondition(condition, spawnLabelByIndex, locationLabelById))
                .join(" ");
            const conditionLabels = trigger.conditions
                .map(condition => getTriggerConditionTypeLabel(condition.type))
                .join(" ");
            const haystack = `${trigger.id} ${targetDialogId} ${conditionLabels} ${conditionSummaries}`.toLowerCase();
            return haystack.includes(normalizedTriggerSearch);
        });
    }, [
        dialogTriggers,
        locationLabelById,
        normalizedTriggerSearch,
        spawnLabelByIndex,
        triggerFilter,
        triggerValidationById,
    ]);

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

    const updateTriggerStartDialogAction = (triggerId: string, nextDialogIdRaw: string): void => {
        const nextDialogId = nextDialogIdRaw.trim();
        onUpdateDialogTrigger(triggerId, current => {
            const nextActions = nextDialogId.length > 0
                ? [{ type: "start_dialog", dialogId: nextDialogId } as AreaDialogTriggerAction]
                : [];
            return {
                ...current,
                actions: nextActions.map(cloneDialogTriggerAction),
                ...(nextDialogId.length > 0 ? { dialogId: nextDialogId } : { dialogId: undefined }),
            };
        });
    };

    const recordDialogIdRename = (currentDialogId: string, nextDialogId: string): void => {
        if (currentDialogId === nextDialogId) return;

        const nextRemap = new Map(dialogIdRemapRef.current);
        let didUpdateExistingMapping = false;
        nextRemap.forEach((mappedDialogId, originalDialogId) => {
            if (mappedDialogId !== currentDialogId) return;
            nextRemap.set(originalDialogId, nextDialogId);
            didUpdateExistingMapping = true;
        });

        if (!didUpdateExistingMapping && initialDialogIdsRef.current.has(currentDialogId)) {
            nextRemap.set(currentDialogId, nextDialogId);
        }

        for (const [originalDialogId, mappedDialogId] of Array.from(nextRemap.entries())) {
            if (originalDialogId === mappedDialogId) {
                nextRemap.delete(originalDialogId);
            }
        }

        dialogIdRemapRef.current = nextRemap;
    };

    const upsertDraftDialog = (dialogIdRaw: string): string => {
        const requestedId = dialogIdRaw.trim();
        const allKnownIds = new Set([
            ...draftDialogs.map(dialog => dialog.id),
            ...availableDialogIds,
        ]);
        const nextDialogId = requestedId.length > 0
            ? requestedId
            : createUniqueId("dialog", allKnownIds);
        const existingDialog = draftDialogs.find(dialog => dialog.id === nextDialogId);
        if (!existingDialog) {
            const created = createDefaultDialog(nextDialogId);
            setDraftDialogs(prevDialogs => [...prevDialogs, created]);
            setSelectedDialogId(nextDialogId);
            setSelectedNodeId(created.startNodeId);
            return nextDialogId;
        }

        setSelectedDialogId(existingDialog.id);
        setSelectedNodeId(listNodeIds(existingDialog)[0] ?? null);
        return existingDialog.id;
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

        recordDialogIdRename(selectedDialog.id, nextDialogId);
        dialogTriggers.forEach(trigger => {
            const triggerDialogId = getTriggerStartDialogId(trigger).trim();
            if (triggerDialogId !== selectedDialog.id) return;
            updateTriggerStartDialogAction(trigger.id, nextDialogId);
        });
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

    const addMenuNodeToSelectedDialog = (menuId: AreaDialogMenuId | AreaDialogEventId): void => {
        if (!selectedDialog) return;
        const existingNodeIds = new Set(Object.keys(selectedDialog.nodes));
        const nodeId = createUniqueId(menuId, existingNodeIds);
        const nextNode = createMenuNode(nodeId, menuId);
        updateDialogById(selectedDialog.id, dialog => ({
            ...dialog,
            nodes: {
                ...dialog.nodes,
                [nodeId]: nextNode,
            },
        }));
        setSelectedNodeId(nodeId);
    };

    const updateMenuNodeAction = (menuId: string): void => {
        if (!selectedNode?.isMenuNode) return;
        const action = toDialogEndAction(menuId);
        updateSelectedNode(node => ({
            ...node,
            ...(action ? { onDialogEndAction: action } : { onDialogEndAction: undefined }),
        }));
    };

    const updateSpendNightGoldCost = (rawValue: string): void => {
        if (!selectedNode?.isMenuNode) return;
        const action = selectedNode.onDialogEndAction;
        if (!action || action.type !== "event" || action.eventId !== "spend_the_night") return;

        const parsed = parseInt(rawValue, 10);
        const goldCost = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;

        updateSelectedNode(node => {
            const currentAction = node.onDialogEndAction;
            if (!currentAction || currentAction.type !== "event" || currentAction.eventId !== "spend_the_night") {
                return node;
            }
            return {
                ...node,
                onDialogEndAction: {
                    ...currentAction,
                    goldCost,
                },
            };
        });
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
                        ...(choice.conditions && choice.conditions.length > 0 ? { conditions: choice.conditions.map(condition => ({ ...condition })) } : {}),
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
                        ...(choice.conditions && choice.conditions.length > 0 ? { conditions: choice.conditions.map(condition => ({ ...condition })) } : {}),
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
                        ...(choice.conditions && choice.conditions.length > 0 ? { conditions: choice.conditions.map(condition => ({ ...condition })) } : {}),
                        ...(choice.onDialogEndAction ? { onDialogEndAction: { ...choice.onDialogEndAction } } : {}),
                    }
                    : choice
            ));
            return { ...node, choices: nextChoices };
        });
    };

    const CHOICE_CONDITION_TYPES: { value: AreaDialogChoiceCondition["type"]; label: string }[] = [
        { value: "party_is_gathered", label: "Party Is Gathered" },
        { value: "party_has_gold", label: "Party Has Gold" },
    ];

    const addChoiceCondition = (choiceId: string, conditionType: AreaDialogChoiceCondition["type"]): void => {
        updateSelectedNode(node => {
            const choices = node.choices ?? [];
            const nextChoices = choices.map(choice => {
                if (choice.id !== choiceId) return choice;
                const existing = choice.conditions ?? [];
                if (existing.some(c => c.type === conditionType)) return choice;
                const newCondition: AreaDialogChoiceCondition = conditionType === "party_has_gold"
                    ? { type: "party_has_gold", amount: 100 }
                    : { type: "party_is_gathered" };
                return { ...choice, conditions: [...existing, newCondition] };
            });
            return { ...node, choices: nextChoices };
        });
    };

    const removeChoiceCondition = (choiceId: string, conditionType: AreaDialogChoiceCondition["type"]): void => {
        updateSelectedNode(node => {
            const choices = node.choices ?? [];
            const nextChoices = choices.map(choice => {
                if (choice.id !== choiceId) return choice;
                const remaining = (choice.conditions ?? []).filter(c => c.type !== conditionType);
                return {
                    ...choice,
                    ...(remaining.length > 0 ? { conditions: remaining } : { conditions: undefined }),
                };
            });
            return { ...node, choices: nextChoices };
        });
    };

    const updateChoiceCondition = (
        choiceId: string,
        conditionType: AreaDialogChoiceCondition["type"],
        updater: (condition: AreaDialogChoiceCondition) => AreaDialogChoiceCondition
    ): void => {
        updateSelectedNode(node => {
            const choices = node.choices ?? [];
            const nextChoices = choices.map(choice => {
                if (choice.id !== choiceId) return choice;
                const nextConditions = (choice.conditions ?? []).map(c =>
                    c.type === conditionType ? updater(c) : c
                );
                return { ...choice, conditions: nextConditions };
            });
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

    const canSave = validationErrors.length === 0 && canSaveTriggers;

    const saveAll = (): void => {
        if (!canSave) return;
        const remapEntries = Array.from(dialogIdRemapRef.current.entries());
        const dialogIdRemap = remapEntries.length > 0
            ? Object.fromEntries(remapEntries)
            : undefined;
        onSaveDialogs(draftDialogs.map(cloneDialogDefinition), dialogIdRemap);
        dialogIdRemapRef.current = new Map();
        initialDialogIdsRef.current = new Set(draftDialogs.map(dialog => dialog.id));
        onSaveTriggers(dialogTriggers.map(cloneDialogTrigger));
        setSaved(true);
        if (savedTimeoutRef.current !== null) {
            window.clearTimeout(savedTimeoutRef.current);
        }
        savedTimeoutRef.current = window.setTimeout(() => {
            setSaved(false);
            savedTimeoutRef.current = null;
        }, SAVE_FEEDBACK_MS);
    };

    const commitTriggerIdDraft = (currentTriggerId: string, nextValueRaw: string): void => {
        const requestedId = nextValueRaw.trim();
        const existingIds = new Set(dialogTriggers.map(trigger => trigger.id));
        existingIds.delete(currentTriggerId);
        const nextTriggerId = requestedId.length > 0 ? createUniqueId(requestedId, existingIds) : currentTriggerId;

        if (nextTriggerId !== currentTriggerId) {
            onUpdateDialogTrigger(currentTriggerId, current => ({ ...current, id: nextTriggerId }));
            if (selectedTriggerId === currentTriggerId) {
                setSelectedTriggerId(nextTriggerId);
            }
        }
    };

    const commitDialogIdDraft = (nextValueRaw: string): void => {
        if (!selectedDialog) return;
        const requestedId = nextValueRaw.trim();
        if (requestedId.length === 0) {
            return;
        }
        const existingIds = new Set(draftDialogs.map(dialog => dialog.id));
        existingIds.delete(selectedDialog.id);
        const nextDialogId = createUniqueId(requestedId, existingIds);
        renameSelectedDialog(nextDialogId);
    };

    const commitNodeIdDraft = (nextValueRaw: string): void => {
        if (!selectedDialog || !selectedNode) return;
        const requestedId = nextValueRaw.trim();
        if (requestedId.length === 0) {
            return;
        }
        const existingIds = new Set(Object.keys(selectedDialog.nodes));
        existingIds.delete(selectedNode.id);
        const nextNodeId = createUniqueId(requestedId, existingIds);
        renameSelectedNode(nextNodeId);
    };

    const modalShellClassName = editorView === "dialog"
        ? "editor-dialog-shell editor-dialog-shell--wide"
        : "editor-dialog-shell";

    return (
        <div className="editor-dialog-overlay">
            <div className={modalShellClassName}>
                {/* ── Header ── */}
                <div className="editor-dialog-header">
                    {editorView !== "list" && (
                        <button
                            onClick={() => setEditorView(editorView === "dialog" ? "trigger" : "list")}
                            className="editor-btn editor-btn--muted editor-btn--small"
                        >
                            <ChevronRightIcon size={14} style={{ transform: "rotate(180deg)" }} />
                            Back
                        </button>
                    )}
                    <div className="editor-dialog-title">
                        {editorView === "list" && "Triggers"}
                        {editorView === "trigger" && (selectedTrigger?.id ?? "Trigger")}
                        {editorView === "dialog" && (selectedDialog ? `Dialog: ${selectedDialog.id}` : "Dialog Editor")}
                    </div>
                    <div className="editor-dialog-header-actions">
                        {editorView === "list" && (
                            <button
                                onClick={() => onAddDialogTrigger()}
                                className="editor-btn editor-btn--primary"
                            >
                                <span className="editor-btn-label">
                                    <PlusIcon size={14} />
                                    New Trigger
                                </span>
                            </button>
                        )}
                        <button
                            title={canSave ? "Save dialogs and triggers" : "Resolve errors before saving"}
                            onClick={saveAll}
                            disabled={!canSave}
                            className="editor-btn editor-btn--success"
                            style={{
                                background: !canSave ? "#5b6276" : (saved ? "#238a57" : "#2f9f63"),
                                cursor: canSave ? "pointer" : "not-allowed",
                                opacity: canSave ? 1 : 0.75,
                            }}
                        >
                            <span className="editor-btn-label">
                                {saved ? <CheckIcon size={14} /> : <SaveIcon size={14} />}
                                {saved ? "Saved" : "Save"}
                            </span>
                        </button>
                        <button
                            onClick={onClose}
                            className="editor-btn editor-btn--muted"
                        >
                            <XIcon size={14} />
                        </button>
                    </div>
                </div>

                {/* ── Body ── */}
                <div className="editor-dialog-body">

                {/* ── View: Trigger List ── */}
                {editorView === "list" && (
                    <div className="editor-trigger-list-view">
                        {dialogTriggers.length > 3 && (
                            <div className="editor-trigger-list-controls">
                                <input
                                    value={triggerSearchText}
                                    onChange={event => setTriggerSearchText(event.target.value)}
                                    placeholder="Search triggers..."
                                    className="editor-trigger-input editor-trigger-input--search"
                                />
                                <select
                                    value={triggerFilter}
                                    onChange={event => setTriggerFilter(event.target.value as TriggerListFilter)}
                                    className="editor-trigger-input editor-trigger-input--filter"
                                >
                                    {TRIGGER_FILTER_OPTIONS.map(option => (
                                        <option key={option.value} value={option.value}>{option.label}</option>
                                    ))}
                                </select>
                                {triggerSearchText.trim().length > 0 && (
                                    <button onClick={() => setTriggerSearchText("")} className="editor-btn editor-btn--muted editor-btn--small">
                                        <XIcon size={12} />
                                    </button>
                                )}
                            </div>
                        )}

                        {dialogTriggers.length === 0 && (
                            <div className="editor-trigger-empty">
                                No triggers yet. Click "New Trigger" to create one.
                            </div>
                        )}

                        {dialogTriggers.length > 0 && filteredDialogTriggers.length === 0 && (
                            <div className="editor-trigger-empty editor-trigger-empty--small">
                                No triggers match the current search/filter.
                            </div>
                        )}

                        {filteredDialogTriggers.map(trigger => {
                            const validation = triggerValidationById.get(trigger.id);
                            const targetDialogId = getTriggerStartDialogId(trigger).trim();
                            const conditionPreview = trigger.conditions.length > 0
                                ? trigger.conditions.slice(0, 2)
                                    .map(condition => describeTriggerCondition(condition, spawnLabelByIndex, locationLabelById))
                                    .join(" ")
                                : "No conditions.";
                            const hasMore = trigger.conditions.length > 2;
                            const statusLabel = validation?.isValid ? "Ready" : (trigger.wip ? "WIP" : "Needs setup");
                            const statusColor = validation?.isValid ? "#9be4bd" : (trigger.wip ? "#ffd18a" : "#f4c2a3");

                            return (
                                <div
                                    key={trigger.id}
                                    onClick={() => {
                                        setSelectedTriggerId(trigger.id);
                                        setEditorView("trigger");
                                        setTriggerTab("conditions");
                                        const linkedDialogId = getTriggerStartDialogId(trigger).trim();
                                        if (linkedDialogId.length === 0) return;
                                        const linkedDialog = draftDialogs.find(dialog => dialog.id === linkedDialogId);
                                        if (!linkedDialog) return;
                                        setSelectedDialogId(linkedDialog.id);
                                        setSelectedNodeId(listNodeIds(linkedDialog)[0] ?? null);
                                    }}
                                    className="editor-trigger-card"
                                >
                                    <div className="editor-trigger-card-top">
                                        <span className="editor-trigger-id">{trigger.id}</span>
                                        {trigger.wip && (
                                            <span className="editor-trigger-wip">WIP</span>
                                        )}
                                        <span className="editor-trigger-status" style={{ color: statusColor }}>{statusLabel}</span>
                                        <button
                                            onClick={event => { event.stopPropagation(); onRemoveDialogTrigger(trigger.id); }}
                                            className="editor-btn editor-btn--danger editor-btn--tiny"
                                        >
                                            <XIcon size={12} />
                                        </button>
                                    </div>
                                    <div className="editor-trigger-card-meta">
                                        <span>{trigger.conditions.length} condition{trigger.conditions.length === 1 ? "" : "s"}</span>
                                        <span className="editor-trigger-action-label">
                                            {targetDialogId.length > 0 ? `Start Dialog (${targetDialogId})` : "No action"}
                                        </span>
                                        <span className="editor-trigger-chevron">
                                            <ChevronRightIcon size={14} />
                                        </span>
                                    </div>
                                    <div className="editor-trigger-preview">
                                        {conditionPreview}{hasMore ? " ..." : ""}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}

                {/* ── View: Trigger Editor ── */}
                {editorView === "trigger" && selectedTrigger && (() => {
                    const trigger = selectedTrigger;
                    const validation = triggerValidationById.get(trigger.id);
                    const targetDialogId = getTriggerStartDialogId(trigger).trim();
                    const isMissingDialogId = targetDialogId.length > 0 && !availableDialogIdSet.has(targetDialogId);
                    const dialogIdOptions = isMissingDialogId ? [targetDialogId, ...availableDialogIds] : availableDialogIds;

                    return (
                        <div className="editor-trigger-editor-view">
                            {/* Trigger settings row */}
                            <div className="editor-trigger-settings-row">
                                <label style={{ flex: 1, minWidth: 160, display: "flex", flexDirection: "column", gap: 4 }}>
                                    <span style={{ fontSize: 14 }}>ID</span>
                                    <input
                                        key={`trigger-id-${trigger.id}`}
                                        defaultValue={trigger.id}
                                        onBlur={event => commitTriggerIdDraft(trigger.id, event.currentTarget.value)}
                                        onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }}
                                        style={{ padding: 8, fontSize: 14, background: "#1f2433", border: "1px solid #555d73", borderRadius: 4, color: "#fff" }}
                                    />
                                </label>
                                <label style={{ width: 100, display: "flex", flexDirection: "column", gap: 4 }}>
                                    <span style={{ fontSize: 14 }}>Priority</span>
                                    <input
                                        type="number"
                                        value={trigger.priority ?? 0}
                                        onChange={event => onUpdateDialogTrigger(trigger.id, current => ({ ...current, priority: Number(event.target.value) || 0 }))}
                                        style={{ padding: 8, fontSize: 14, background: "#1f2433", border: "1px solid #555d73", borderRadius: 4, color: "#fff" }}
                                    />
                                </label>
                                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, padding: "6px 0" }}>
                                    <input type="checkbox" checked={trigger.once !== false} onChange={event => onUpdateDialogTrigger(trigger.id, current => ({ ...current, once: event.target.checked }))} />
                                    Once
                                </label>
                                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, padding: "6px 0" }}>
                                    <input type="checkbox" checked={trigger.wip === true} onChange={event => onUpdateDialogTrigger(trigger.id, current => ({ ...current, wip: event.target.checked ? true : undefined }))} />
                                    WIP
                                </label>
                            </div>

                            {/* Validation issues */}
                            {validation && !validation.isValid && (
                                <div style={{ fontSize: 13, color: trigger.wip ? "#ffe3b2" : "#ffd6d6", background: trigger.wip ? "rgba(122, 90, 36, 0.18)" : "rgba(154, 62, 62, 0.2)", border: trigger.wip ? "1px solid #86632d" : "1px solid #8f4747", borderRadius: 6, padding: "6px 8px", display: "flex", flexDirection: "column", gap: 3 }}>
                                    {validation.issues.map(issue => (
                                        <span key={`${trigger.id}-${issue}`}>{issue}</span>
                                    ))}
                                </div>
                            )}

                            {/* Tabs */}
                            <div className="editor-trigger-tabs">
                                {(["conditions", "actions"] as const).map(tab => {
                                    const isActive = triggerTab === tab;
                                    const tabValid = tab === "conditions" ? validation?.conditionStepValid : validation?.actionStepValid;
                                    return (
                                        <button
                                            key={tab}
                                            onClick={() => setTriggerTab(tab)}
                                            className={`editor-trigger-tab${isActive ? " editor-trigger-tab--active" : ""}`}
                                        >
                                            {tab === "conditions" ? "Conditions" : "Actions"}
                                            {tabValid !== undefined && (
                                                <span style={{ color: tabValid ? "#9be4bd" : "#f4c2a3", display: "inline-flex", alignItems: "center" }}>
                                                    {tabValid ? <CheckIcon size={12} /> : <AlertTriangleIcon size={12} />}
                                                </span>
                                            )}
                                        </button>
                                    );
                                })}
                            </div>

                            {/* Conditions tab */}
                            {triggerTab === "conditions" && (
                                <div className="editor-trigger-conditions">
                                    {trigger.conditions.length === 0 && (
                                        <div style={{ fontSize: 14, color: "#9aa6c5", padding: 6 }}>No conditions yet.</div>
                                    )}
                                    {trigger.conditions.map((condition, conditionIndex) => {
                                        const conditionValid = isDialogConditionValid(condition, enemySpawnOptions, dialogLocations, mapWidth, mapHeight);
                                        const conditionSummary = describeTriggerCondition(condition, spawnLabelByIndex, locationLabelById);
                                        return (
                                            <div key={`${trigger.id}-condition-${conditionIndex}`} style={{ border: "1px solid #475067", borderRadius: 6, padding: 12, background: "#23293a", display: "flex", flexDirection: "column", gap: 8 }}>
                                                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                                                    <select
                                                        value={condition.type}
                                                        onChange={event => {
                                                            const nextType = event.target.value as AreaDialogTriggerCondition["type"];
                                                            const defaultLocationId = dialogLocations[0]?.id ?? "location_1";
                                                            onUpdateDialogTriggerCondition(trigger.id, conditionIndex, () => createConditionByType(nextType, defaultLocationId));
                                                        }}
                                                        style={{ flex: 1, padding: 8, fontSize: 14, background: "#1f2433", border: "1px solid #555d73", borderRadius: 4, color: "#fff" }}
                                                    >
                                                        {TRIGGER_CONDITION_OPTIONS.map(option => (
                                                            <option key={`condition-type-${trigger.id}-${conditionIndex}-${option.value}`} value={option.value}>{option.label}</option>
                                                        ))}
                                                    </select>
                                                    <span style={{ fontSize: 13, color: conditionValid ? "#9be4bd" : "#f4c2a3", display: "inline-flex", alignItems: "center" }}>
                                                        {conditionValid ? <CheckIcon size={12} /> : <AlertTriangleIcon size={12} />}
                                                    </span>
                                                    <button
                                                        onClick={() => onRemoveDialogCondition(trigger.id, conditionIndex)}
                                                        style={{ padding: "4px", fontSize: 13, background: "#934", color: "#fff", border: "none", borderRadius: 3, cursor: "pointer" }}
                                                    >
                                                        <XIcon style={{ width: 12, height: 12 }} />
                                                    </button>
                                                </div>
                                                <div style={{ fontSize: 13, color: "#9fb3d8" }}>{conditionSummary}</div>

                                                {condition.type === "enemy_killed" && (
                                                    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                                        <span style={{ fontSize: 14 }}>Enemy Spawn</span>
                                                        <select value={condition.spawnIndex} onChange={event => onUpdateDialogTriggerCondition(trigger.id, conditionIndex, current => { if (current.type !== "enemy_killed") return current; return { ...current, spawnIndex: parseInt(event.target.value, 10) || 0 }; })} style={{ padding: 8, fontSize: 14, background: "#1f2433", border: "1px solid #555d73", borderRadius: 4, color: "#fff" }}>
                                                            {enemySpawnOptions.map(spawn => (<option key={`enemy-killed-${spawn.spawnIndex}`} value={spawn.spawnIndex}>#{spawn.spawnIndex}: {spawn.enemyType} ({spawn.x},{spawn.z})</option>))}
                                                            {enemySpawnOptions.length === 0 && <option value={0}>No enemy spawns</option>}
                                                        </select>
                                                    </label>
                                                )}
                                                {condition.type === "npc_engaged" && (
                                                    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                                        <span style={{ fontSize: 14 }}>NPC Spawn</span>
                                                        <select value={condition.spawnIndex} onChange={event => onUpdateDialogTriggerCondition(trigger.id, conditionIndex, current => { if (current.type !== "npc_engaged") return current; return { ...current, spawnIndex: parseInt(event.target.value, 10) || 0 }; })} style={{ padding: 8, fontSize: 14, background: "#1f2433", border: "1px solid #555d73", borderRadius: 4, color: "#fff" }}>
                                                            {npcSpawnOptions.map(spawn => (<option key={`npc-engaged-${spawn.spawnIndex}`} value={spawn.spawnIndex}>#{spawn.spawnIndex}: {spawn.enemyType} ({spawn.x},{spawn.z})</option>))}
                                                            {npcSpawnOptions.length === 0 && <option value={0}>No NPC spawns</option>}
                                                        </select>
                                                    </label>
                                                )}
                                                {condition.type === "unit_seen" && (
                                                    <div style={{ display: "flex", gap: 8 }}>
                                                        <label style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
                                                            <span style={{ fontSize: 14 }}>Enemy Spawn</span>
                                                            <select value={condition.spawnIndex} onChange={event => onUpdateDialogTriggerCondition(trigger.id, conditionIndex, current => { if (current.type !== "unit_seen") return current; return { ...current, spawnIndex: parseInt(event.target.value, 10) || 0 }; })} style={{ padding: 8, fontSize: 14, background: "#1f2433", border: "1px solid #555d73", borderRadius: 4, color: "#fff" }}>
                                                                {enemySpawnOptions.map(spawn => (<option key={`unit-seen-${spawn.spawnIndex}`} value={spawn.spawnIndex}>#{spawn.spawnIndex}: {spawn.enemyType} ({spawn.x},{spawn.z})</option>))}
                                                                {enemySpawnOptions.length === 0 && <option value={0}>No enemy spawns</option>}
                                                            </select>
                                                        </label>
                                                        <label style={{ width: 120, display: "flex", flexDirection: "column", gap: 4 }}>
                                                            <span style={{ fontSize: 14 }}>Range</span>
                                                            <input type="number" min={0.1} step={0.1} value={condition.range ?? 12} onChange={event => onUpdateDialogTriggerCondition(trigger.id, conditionIndex, current => { if (current.type !== "unit_seen") return current; return { ...current, range: Math.max(0.1, Number(event.target.value) || 12) }; })} style={{ padding: 8, fontSize: 14, background: "#1f2433", border: "1px solid #555d73", borderRadius: 4, color: "#fff" }} />
                                                        </label>
                                                    </div>
                                                )}
                                                {condition.type === "party_enters_location" && (
                                                    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                                        <span style={{ fontSize: 14 }}>Location</span>
                                                        <select value={condition.locationId} onChange={event => onUpdateDialogTriggerCondition(trigger.id, conditionIndex, current => { if (current.type !== "party_enters_location") return current; return { ...current, locationId: event.target.value }; })} style={{ padding: 8, fontSize: 14, background: "#1f2433", border: "1px solid #555d73", borderRadius: 4, color: "#fff" }}>
                                                            {!dialogLocations.some(location => location.id === condition.locationId) && condition.locationId.trim().length > 0 && (
                                                                <option value={condition.locationId}>Missing: {condition.locationId}</option>
                                                            )}
                                                            {dialogLocations.map(location => (
                                                                <option key={`condition-location-${trigger.id}-${conditionIndex}-${location.id}`} value={location.id}>{location.id} ({location.x},{location.z},{location.w}x{location.h})</option>
                                                            ))}
                                                            {dialogLocations.length === 0 && <option value="">No locations defined</option>}
                                                        </select>
                                                        {dialogLocations.length > 0 && !dialogLocations.some(location => location.id === condition.locationId) && (
                                                            <span style={{ fontSize: 13, color: "#ffb4b4" }}>Missing location "{condition.locationId}".</span>
                                                        )}
                                                    </label>
                                                )}
                                                {condition.type === "party_enters_region" && (
                                                    <>
                                                        <div style={{ display: "flex", gap: 8 }}>
                                                            <label style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}><span style={{ fontSize: 14 }}>X</span><input type="number" value={condition.x} onChange={event => onUpdateDialogTriggerCondition(trigger.id, conditionIndex, current => { if (current.type !== "party_enters_region") return current; return { ...current, x: clampGridCoord(Number(event.target.value), mapWidth) }; })} style={{ padding: 8, fontSize: 14, background: "#1f2433", border: "1px solid #555d73", borderRadius: 4, color: "#fff" }} /></label>
                                                            <label style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}><span style={{ fontSize: 14 }}>Z</span><input type="number" value={condition.z} onChange={event => onUpdateDialogTriggerCondition(trigger.id, conditionIndex, current => { if (current.type !== "party_enters_region") return current; return { ...current, z: clampGridCoord(Number(event.target.value), mapHeight) }; })} style={{ padding: 8, fontSize: 14, background: "#1f2433", border: "1px solid #555d73", borderRadius: 4, color: "#fff" }} /></label>
                                                            <label style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}><span style={{ fontSize: 14 }}>W</span><input type="number" min={1} value={condition.w} onChange={event => onUpdateDialogTriggerCondition(trigger.id, conditionIndex, current => { if (current.type !== "party_enters_region") return current; return { ...current, w: Math.max(1, parseInt(event.target.value, 10) || 1) }; })} style={{ padding: 8, fontSize: 14, background: "#1f2433", border: "1px solid #555d73", borderRadius: 4, color: "#fff" }} /></label>
                                                            <label style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}><span style={{ fontSize: 14 }}>H</span><input type="number" min={1} value={condition.h} onChange={event => onUpdateDialogTriggerCondition(trigger.id, conditionIndex, current => { if (current.type !== "party_enters_region") return current; return { ...current, h: Math.max(1, parseInt(event.target.value, 10) || 1) }; })} style={{ padding: 8, fontSize: 14, background: "#1f2433", border: "1px solid #555d73", borderRadius: 4, color: "#fff" }} /></label>
                                                        </div>
                                                    </>
                                                )}
                                                {condition.type === "party_out_of_combat_range" && (
                                                    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                                        <span style={{ fontSize: 14 }}>Range</span>
                                                        <input type="number" min={0.1} step={0.1} value={condition.range} onChange={event => onUpdateDialogTriggerCondition(trigger.id, conditionIndex, current => { if (current.type !== "party_out_of_combat_range") return current; return { ...current, range: Math.max(0.1, Number(event.target.value) || 12) }; })} style={{ padding: 8, fontSize: 14, background: "#1f2433", border: "1px solid #555d73", borderRadius: 4, color: "#fff" }} />
                                                    </label>
                                                )}
                                                {condition.type === "after_delay" && (
                                                    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                                        <span style={{ fontSize: 14 }}>Delay (ms)</span>
                                                        <input type="number" min={0} step={100} value={condition.ms} onChange={event => onUpdateDialogTriggerCondition(trigger.id, conditionIndex, current => { if (current.type !== "after_delay") return current; return { ...current, ms: Math.max(0, parseInt(event.target.value, 10) || 0) }; })} style={{ padding: 8, fontSize: 14, background: "#1f2433", border: "1px solid #555d73", borderRadius: 4, color: "#fff" }} />
                                                    </label>
                                                )}
                                            </div>
                                        );
                                    })}
                                    <button
                                        onClick={() => onAddDialogCondition(trigger.id)}
                                        style={{ alignSelf: "flex-start", padding: "6px 10px", fontSize: 13, background: "#355eaa", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}
                                    >
                                        <PlusIcon size={12} />
                                        Add Condition
                                    </button>
                                </div>
                            )}

                            {/* Actions tab */}
                            {triggerTab === "actions" && (
                                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                    <div style={{ border: "1px solid #475067", borderRadius: 6, padding: 14, background: "#23293a", display: "flex", flexDirection: "column", gap: 8 }}>
                                        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                            <span style={{ fontSize: 14 }}>Action Type</span>
                                            <select
                                                value={targetDialogId.length > 0 ? "start_dialog" : ""}
                                                onChange={event => {
                                                    if (event.target.value !== "start_dialog") {
                                                        updateTriggerStartDialogAction(trigger.id, "");
                                                        return;
                                                    }
                                                    const defaultDialogId = targetDialogId || selectedDialog?.id || availableDialogIds[0] || "dialog";
                                                    updateTriggerStartDialogAction(trigger.id, defaultDialogId);
                                                }}
                                                style={{ padding: 8, fontSize: 14, background: "#1f2433", border: "1px solid #555d73", borderRadius: 4, color: "#fff" }}
                                            >
                                                <option value="">(no action)</option>
                                                <option value="start_dialog">Start Dialog</option>
                                            </select>
                                        </label>

                                        {targetDialogId.length > 0 && (
                                            <>
                                                <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                                    <span style={{ fontSize: 14 }}>Target Dialog</span>
                                                    {dialogIdOptions.length > 0 ? (
                                                        <select
                                                            value={targetDialogId}
                                                            onChange={event => updateTriggerStartDialogAction(trigger.id, event.target.value)}
                                                            style={{ padding: 8, fontSize: 14, background: "#1f2433", border: isMissingDialogId ? "1px solid #9b5d5d" : "1px solid #555d73", borderRadius: 4, color: "#fff" }}
                                                        >
                                                            {dialogIdOptions.map(dialogId => (<option key={dialogId} value={dialogId}>{dialogId}</option>))}
                                                        </select>
                                                    ) : (
                                                        <input
                                                            value={targetDialogId}
                                                            onChange={event => updateTriggerStartDialogAction(trigger.id, event.target.value)}
                                                            style={{ padding: 8, fontSize: 14, background: "#1f2433", border: isMissingDialogId ? "1px solid #9b5d5d" : "1px solid #555d73", borderRadius: 4, color: "#fff" }}
                                                        />
                                                    )}
                                                    {isMissingDialogId && (
                                                        <span style={{ fontSize: 13, color: "#ffb4b4" }}>Missing dialog: "{targetDialogId}".</span>
                                                    )}
                                                </label>
                                                <button
                                                    title={isMissingDialogId ? "Create dialog payload" : "Edit dialog payload"}
                                                    onClick={() => {
                                                        const dialogId = upsertDraftDialog(targetDialogId);
                                                        updateTriggerStartDialogAction(trigger.id, dialogId);
                                                        setEditorView("dialog");
                                                    }}
                                                    style={{ alignSelf: "flex-start", padding: "6px 10px", fontSize: 13, background: "#4269b8", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}
                                                >
                                                    <MessageSquareIcon size={12} />
                                                    {isMissingDialogId ? "Create Dialog" : "Edit Dialog"}
                                                </button>
                                            </>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })()}

                {/* ── View: Dialog Editor ── */}
                {editorView === "dialog" && (
                    <div style={{ display: "grid", gridTemplateColumns: "220px 260px minmax(0, 1fr)", gap: 12, minHeight: 420 }}>
                        {/* Dialog Payloads */}
                        <div style={{ border: "1px solid #3f475b", borderRadius: 8, background: "#252b3c", padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                <div style={{ fontSize: 15, fontWeight: 700 }}>Dialogs</div>
                                <button onClick={addDialog} style={{ padding: "4px 8px", fontSize: 13, background: "#3484d0", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}>
                                    <PlusIcon size={13} />
                                </button>
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 280, overflowY: "auto" }}>
                                {draftDialogs.length === 0 && (
                                    <div style={{ fontSize: 14, color: "#9aa6c5", padding: "6px 2px" }}>No dialogs yet.</div>
                                )}
                                {draftDialogs.map(dialog => (
                                    <button
                                        key={dialog.id}
                                        onClick={() => { setSelectedDialogId(dialog.id); setSelectedNodeId(listNodeIds(dialog)[0] ?? null); }}
                                        style={{ textAlign: "left", padding: "10px 14px", borderRadius: 6, border: resolvedSelectedDialogId === dialog.id ? "1px solid #5ea5ff" : "1px solid #4b5369", background: resolvedSelectedDialogId === dialog.id ? "#2d3d5c" : "#2a3041", color: "#fff", cursor: "pointer", display: "flex", flexDirection: "column", gap: 3 }}
                                    >
                                        <span style={{ fontSize: 14, fontWeight: 600 }}>{dialog.id}</span>
                                        <span style={{ fontSize: 13, color: "#b9c4de" }}>{Object.keys(dialog.nodes).length} nodes</span>
                                    </button>
                                ))}
                            </div>
                            {selectedDialog && (
                                <>
                                    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                        <span style={{ fontSize: 14, color: "#b8c2d9" }}>Dialog ID</span>
                                        <input key={`dialog-id-${selectedDialog.id}`} defaultValue={selectedDialog.id} onBlur={event => commitDialogIdDraft(event.currentTarget.value)} onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }} style={{ padding: 8, borderRadius: 4, border: "1px solid #5a627a", background: "#1f2433", color: "#fff", fontSize: 14 }} />
                                    </label>
                                    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                        <span style={{ fontSize: 14, color: "#b8c2d9" }}>Start Node</span>
                                        <select value={selectedDialog.startNodeId} onChange={event => updateDialogById(selectedDialog.id, dialog => ({ ...dialog, startNodeId: event.target.value }))} style={{ padding: 8, borderRadius: 4, border: "1px solid #5a627a", background: "#1f2433", color: "#fff", fontSize: 14 }}>
                                            {nodeIds.map(nodeId => (<option key={`start-${nodeId}`} value={nodeId}>{nodeId}</option>))}
                                        </select>
                                    </label>
                                    <div style={{ display: "flex", gap: 6 }}>
                                        <button onClick={duplicateSelectedDialog} style={{ flex: 1, padding: "6px 8px", fontSize: 13, background: "#4d5d96", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}>Duplicate</button>
                                        <button onClick={removeSelectedDialog} style={{ flex: 1, padding: "6px 8px", fontSize: 13, background: "#9d4040", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}>Delete</button>
                                    </div>
                                </>
                            )}
                        </div>

                        {/* Nodes */}
                        <div style={{ border: "1px solid #3f475b", borderRadius: 8, background: "#252b3c", padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                <div style={{ fontSize: 15, fontWeight: 700 }}>Nodes</div>
                                <select
                                    disabled={!selectedDialog}
                                    value=""
                                    onChange={event => {
                                        const val = event.target.value;
                                        if (!val) return;
                                        if (val === "__dialog__") { addNodeToSelectedDialog(); }
                                        else { addMenuNodeToSelectedDialog(val as AreaDialogMenuId | AreaDialogEventId); }
                                    }}
                                    style={{ padding: "4px 8px", fontSize: 13, background: selectedDialog ? "#3484d0" : "#5b6276", color: "#fff", border: "none", borderRadius: 4, cursor: selectedDialog ? "pointer" : "not-allowed" }}
                                >
                                    <option value="">+ Node</option>
                                    <option value="__dialog__">Dialog Node</option>
                                    {MENU_NODE_OPTIONS.map(option => (
                                        <option key={`add-menu-${option.value}`} value={option.value}>{option.label}</option>
                                    ))}
                                </select>
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 520, overflowY: "auto" }}>
                                {!selectedDialog && <div style={{ fontSize: 14, color: "#9aa6c5", padding: "6px 2px" }}>Select a dialog.</div>}
                                {selectedDialog && nodeIds.map(nodeId => {
                                    const node = selectedDialog.nodes[nodeId];
                                    if (node.isMenuNode) {
                                        const menuLabel = getMenuNodeLabel(node);
                                        return (
                                            <button key={`${selectedDialog.id}-${node.id}`} onClick={() => setSelectedNodeId(node.id)} style={{ textAlign: "left", padding: "10px 14px", borderRadius: 6, border: resolvedSelectedNodeId === node.id ? "1px solid #5ea5ff" : "1px solid #6b5b95", background: resolvedSelectedNodeId === node.id ? "#3a2d5c" : "#302841", color: "#fff", cursor: "pointer", display: "flex", flexDirection: "column", gap: 3 }}>
                                                <span style={{ fontSize: 14, fontWeight: 600 }}>{node.id}</span>
                                                <span style={{ fontSize: 13, color: "#c4a8e0" }}>{menuLabel}</span>
                                            </button>
                                        );
                                    }
                                    const preview = node.text.trim().length > 0 ? getNodePreview(node.text) : "(empty)";
                                    return (
                                        <button key={`${selectedDialog.id}-${node.id}`} onClick={() => setSelectedNodeId(node.id)} style={{ textAlign: "left", padding: "10px 14px", borderRadius: 6, border: resolvedSelectedNodeId === node.id ? "1px solid #5ea5ff" : "1px solid #4b5369", background: resolvedSelectedNodeId === node.id ? "#2d3d5c" : "#2a3041", color: "#fff", cursor: "pointer", display: "flex", flexDirection: "column", gap: 3 }}>
                                            <span style={{ fontSize: 14, fontWeight: 600 }}>{node.id}</span>
                                            <span style={{ fontSize: 13, color: "#b9c4de" }}>{DIALOG_SPEAKERS[node.speakerId].name}</span>
                                            <span style={{ fontSize: 13, color: "#a7b3d2" }}>{preview}</span>
                                        </button>
                                    );
                                })}
                            </div>
                            {selectedNode && (
                                <div style={{ display: "flex", gap: 6 }}>
                                    <button onClick={duplicateSelectedNode} style={{ flex: 1, padding: "6px 8px", fontSize: 13, background: "#4d5d96", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}>Duplicate</button>
                                    <button onClick={removeSelectedNode} disabled={nodeIds.length <= 1} style={{ flex: 1, padding: "6px 8px", fontSize: 13, background: nodeIds.length <= 1 ? "#5b6276" : "#9d4040", color: "#fff", border: "none", borderRadius: 4, cursor: nodeIds.length <= 1 ? "not-allowed" : "pointer" }}>Delete</button>
                                </div>
                            )}
                        </div>

                        {/* Node Editor */}
                        <div style={{ border: "1px solid #3f475b", borderRadius: 8, background: "#252b3c", padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
                            {!selectedNode && <div style={{ fontSize: 15, color: "#9aa6c5", padding: 6 }}>Select a node to edit.</div>}
                            {selectedNode && selectedDialog && selectedNode.isMenuNode && (
                                <>
                                    <div style={{ display: "flex", gap: 8 }}>
                                        <label style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
                                            <span style={{ fontSize: 14, color: "#b8c2d9" }}>Node ID</span>
                                            <input key={`node-id-${selectedNode.id}`} defaultValue={selectedNode.id} onBlur={event => commitNodeIdDraft(event.currentTarget.value)} onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }} style={{ padding: 8, borderRadius: 4, border: "1px solid #5a627a", background: "#1f2433", color: "#fff", fontSize: 14 }} />
                                        </label>
                                        <label style={{ width: 220, display: "flex", flexDirection: "column", gap: 4 }}>
                                            <span style={{ fontSize: 14, color: "#b8c2d9" }}>Action</span>
                                            <select value={toDialogEndActionMenuId(selectedNode.onDialogEndAction)} onChange={event => updateMenuNodeAction(event.target.value)} style={{ padding: 8, borderRadius: 4, border: "1px solid #5a627a", background: "#1f2433", color: "#fff", fontSize: 14 }}>
                                                <option value="">(none)</option>
                                                {MENU_NODE_OPTIONS.map(option => (<option key={`menu-action-${option.value}`} value={option.value}>{option.label}</option>))}
                                            </select>
                                        </label>
                                    </div>
                                    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                        <span style={{ fontSize: 14, color: "#b8c2d9" }}>After Menu Closes</span>
                                        <select value={selectedNode.nextNodeId ?? ""} onChange={event => { const nextNodeId = event.target.value; updateSelectedNode(node => ({ ...node, ...(nextNodeId ? { nextNodeId } : { nextNodeId: undefined }) })); }} style={{ padding: 8, borderRadius: 4, border: "1px solid #5a627a", background: "#1f2433", color: "#fff", fontSize: 14 }}>
                                            <option value="">(nothing)</option>
                                            {nodeIds.filter(nid => nid !== selectedNode.id).map(nodeId => (<option key={`menu-next-${nodeId}`} value={nodeId}>{nodeId}</option>))}
                                        </select>
                                    </label>
                                    <div style={{ fontSize: 13, color: "#9aa6c5", padding: "4px 2px" }}>
                                        This is a menu/event node. When the dialog reaches this node, it closes and opens the selected menu or fires the event. Link to this node from other nodes or choices via their "Next Node" dropdown.
                                    </div>
                                    {selectedNode.onDialogEndAction?.type === "event" && selectedNode.onDialogEndAction.eventId === "spend_the_night" && (
                                        <label style={{ width: 220, display: "flex", flexDirection: "column", gap: 4 }}>
                                            <span style={{ fontSize: 14, color: "#b8c2d9" }}>Gold Cost</span>
                                            <input
                                                type="number"
                                                min={0}
                                                step={1}
                                                value={selectedNode.onDialogEndAction.goldCost ?? 0}
                                                onChange={event => updateSpendNightGoldCost(event.target.value)}
                                                style={{ padding: 8, borderRadius: 4, border: "1px solid #5a627a", background: "#1f2433", color: "#fff", fontSize: 14 }}
                                            />
                                        </label>
                                    )}
                                </>
                            )}
                            {selectedNode && selectedDialog && !selectedNode.isMenuNode && (
                                <>
                                    <div style={{ display: "flex", gap: 8 }}>
                                        <label style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
                                            <span style={{ fontSize: 14, color: "#b8c2d9" }}>Node ID</span>
                                            <input key={`node-id-${selectedNode.id}`} defaultValue={selectedNode.id} onBlur={event => commitNodeIdDraft(event.currentTarget.value)} onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }} style={{ padding: 8, borderRadius: 4, border: "1px solid #5a627a", background: "#1f2433", color: "#fff", fontSize: 14 }} />
                                        </label>
                                        <label style={{ width: 220, display: "flex", flexDirection: "column", gap: 4 }}>
                                            <span style={{ fontSize: 14, color: "#b8c2d9" }}>Speaker</span>
                                            <select value={selectedNode.speakerId} onChange={event => { const nextSpeakerId = event.target.value; if (!isDialogSpeakerId(nextSpeakerId)) return; updateSelectedNode(node => ({ ...node, speakerId: nextSpeakerId })); }} style={{ padding: 8, borderRadius: 4, border: "1px solid #5a627a", background: "#1f2433", color: "#fff", fontSize: 14 }}>
                                                {speakerOptions.map(speaker => (<option key={`speaker-${speaker.id}`} value={speaker.id}>{speaker.name}</option>))}
                                            </select>
                                        </label>
                                    </div>
                                    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                        <span style={{ fontSize: 14, color: "#b8c2d9" }}>Dialog Text</span>
                                        <textarea value={selectedNode.text} onChange={event => updateSelectedNode(node => ({ ...node, text: event.target.value }))} rows={7} style={{ padding: 8, borderRadius: 4, border: "1px solid #5a627a", background: "#1f2433", color: "#fff", fontSize: 15, resize: "vertical", lineHeight: 1.45 }} />
                                    </label>
                                    <div style={{ display: "flex", gap: 8 }}>
                                        <label style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
                                            <span style={{ fontSize: 14, color: "#b8c2d9" }}>Next Node (no choices)</span>
                                            <select value={selectedNode.nextNodeId ?? ""} onChange={event => { const nextNodeId = event.target.value; updateSelectedNode(node => ({ ...node, ...(nextNodeId ? { nextNodeId } : { nextNodeId: undefined }) })); }} style={{ padding: 8, borderRadius: 4, border: "1px solid #5a627a", background: "#1f2433", color: "#fff", fontSize: 14 }}>
                                                <option value="">(end dialog)</option>
                                                {nodeIds.map(nodeId => (<option key={`next-node-${nodeId}`} value={nodeId}>{nodeId}</option>))}
                                            </select>
                                        </label>
                                        <label style={{ width: 220, display: "flex", flexDirection: "column", gap: 4 }}>
                                            <span style={{ fontSize: 14, color: "#b8c2d9" }}>Continue Button Label</span>
                                            <input value={selectedNode.continueLabel ?? ""} onChange={event => updateSelectedNode(node => ({ ...node, ...(event.target.value.trim().length > 0 ? { continueLabel: event.target.value } : { continueLabel: undefined }) }))} placeholder="Continue" style={{ padding: 8, borderRadius: 4, border: "1px solid #5a627a", background: "#1f2433", color: "#fff", fontSize: 14 }} />
                                        </label>
                                    </div>
                                    <div style={{ borderTop: "1px solid #3d465b", paddingTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                            <div style={{ fontSize: 15, fontWeight: 700 }}>Choices</div>
                                            <button
                                                onClick={addChoiceToSelectedNode}
                                                className="editor-btn editor-btn--primary editor-btn--small"
                                            >
                                                + Choice
                                            </button>
                                        </div>
                                        {(selectedNode.choices ?? []).length === 0 && (
                                            <div style={{ fontSize: 14, color: "#9aa6c5" }}>No choices. Node advances using "Next Node" + continue button.</div>
                                        )}
                                        {(selectedNode.choices ?? []).map(choice => {
                                            const conditions = choice.conditions ?? [];
                                            const usedTypes = new Set(conditions.map(c => c.type));
                                            const availableTypes = CHOICE_CONDITION_TYPES.filter(t => !usedTypes.has(t.value));

                                            return (
                                                <div key={`${selectedNode.id}-${choice.id}`} className="editor-choice-card">
                                                    <div className="editor-choice-main">
                                                        <label className="editor-choice-field">
                                                            <span className="editor-choice-label">Choice ID</span>
                                                            <input
                                                                value={choice.id}
                                                                onChange={event => renameChoice(choice.id, event.target.value)}
                                                                className="editor-trigger-input editor-choice-input"
                                                            />
                                                        </label>
                                                        <label className="editor-choice-field editor-choice-field--wide">
                                                            <span className="editor-choice-label">Label</span>
                                                            <input
                                                                value={choice.label}
                                                                onChange={event => updateChoiceLabel(choice.id, event.target.value)}
                                                                placeholder="Choice label"
                                                                className="editor-trigger-input editor-choice-input"
                                                            />
                                                        </label>
                                                        <label className="editor-choice-field">
                                                            <span className="editor-choice-label">Next Node</span>
                                                            <select
                                                                value={choice.nextNodeId ?? ""}
                                                                onChange={event => updateChoiceNextNodeId(choice.id, event.target.value)}
                                                                className="editor-trigger-input editor-choice-input"
                                                            >
                                                                <option value="">(end dialog)</option>
                                                                {nodeIds.map(nodeId => (
                                                                    <option key={`choice-next-${choice.id}-${nodeId}`} value={nodeId}>{nodeId}</option>
                                                                ))}
                                                            </select>
                                                        </label>
                                                        <button
                                                            onClick={() => removeChoice(choice.id)}
                                                            className="editor-btn editor-btn--danger editor-btn--small editor-choice-remove"
                                                        >
                                                            Remove
                                                        </button>
                                                    </div>
                                                    {conditions.length > 0 && (
                                                        <div className="editor-choice-conditions">
                                                            {conditions.map(condition => (
                                                                <div key={condition.type} className="editor-choice-condition-row">
                                                                    <span className="editor-choice-condition-type">
                                                                        {CHOICE_CONDITION_TYPES.find(t => t.value === condition.type)?.label ?? condition.type}
                                                                    </span>
                                                                    {condition.type === "party_is_gathered" && (
                                                                        <label className="editor-choice-field">
                                                                            <span className="editor-choice-label">Max Distance</span>
                                                                            <input
                                                                                type="number"
                                                                                min={0.1}
                                                                                step={0.1}
                                                                                value={condition.maxDistance ?? ""}
                                                                                onChange={event => {
                                                                                    const raw = event.target.value.trim();
                                                                                    const val = raw.length === 0 ? undefined : Number(raw);
                                                                                    const maxDistance = val !== undefined && Number.isFinite(val) && val > 0 ? val : undefined;
                                                                                    updateChoiceCondition(choice.id, "party_is_gathered", c => ({
                                                                                        ...c,
                                                                                        ...(maxDistance !== undefined ? { maxDistance } : { maxDistance: undefined }),
                                                                                    }));
                                                                                }}
                                                                                placeholder="Default"
                                                                                className="editor-trigger-input editor-choice-input"
                                                                            />
                                                                        </label>
                                                                    )}
                                                                    {condition.type === "party_has_gold" && (
                                                                        <label className="editor-choice-field">
                                                                            <span className="editor-choice-label">Gold Amount</span>
                                                                            <input
                                                                                type="number"
                                                                                min={1}
                                                                                step={1}
                                                                                value={condition.amount}
                                                                                onChange={event => {
                                                                                    const val = parseInt(event.target.value) || 1;
                                                                                    updateChoiceCondition(choice.id, "party_has_gold", c => ({
                                                                                        ...c,
                                                                                        amount: Math.max(1, val),
                                                                                    }));
                                                                                }}
                                                                                className="editor-trigger-input editor-choice-input"
                                                                            />
                                                                        </label>
                                                                    )}
                                                                    <label className="editor-choice-field editor-choice-field--wide">
                                                                        <span className="editor-choice-label">Disabled Message</span>
                                                                        <input
                                                                            value={condition.disabledMessage ?? ""}
                                                                            onChange={event => {
                                                                                const msg = event.target.value;
                                                                                updateChoiceCondition(choice.id, condition.type, c => ({
                                                                                    ...c,
                                                                                    ...(msg.trim().length > 0 ? { disabledMessage: msg } : { disabledMessage: undefined }),
                                                                                }));
                                                                            }}
                                                                            placeholder="Shown when blocked"
                                                                            className="editor-trigger-input editor-choice-input"
                                                                        />
                                                                    </label>
                                                                    <button
                                                                        onClick={() => removeChoiceCondition(choice.id, condition.type)}
                                                                        className="editor-btn editor-btn--danger editor-btn--small editor-choice-condition-remove"
                                                                                    >
                                                                        <XIcon size={14} />
                                                                    </button>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                    {availableTypes.length > 0 && (
                                                        <select
                                                            value=""
                                                            onChange={event => {
                                                                if (event.target.value) {
                                                                    addChoiceCondition(choice.id, event.target.value as AreaDialogChoiceCondition["type"]);
                                                                    event.target.value = "";
                                                                }
                                                            }}
                                                            className="editor-trigger-input editor-choice-add-condition"
                                                        >
                                                            <option value="">+ Add Condition</option>
                                                            {availableTypes.map(t => (
                                                                <option key={t.value} value={t.value}>{t.label}</option>
                                                            ))}
                                                        </select>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                )}

                </div>
            </div>
        </div>
    );
}
