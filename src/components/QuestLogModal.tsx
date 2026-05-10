import { useEffect, useReducer } from "react";
import { ModalShell } from "./ModalShell";
import {
    getAllQuestProgress,
    getQuestById,
    subscribeToQuestState,
} from "../quests";
import type { Quest, QuestObjective, QuestProgress, QuestStatus } from "../quests";

interface QuestLogModalProps {
    onClose: () => void;
}

const STATUS_LABELS: Record<QuestStatus, string> = {
    inactive: "Inactive",
    active: "Active",
    completed: "Ready to turn in",
    turned_in: "Completed",
};

const STATUS_ORDER: Record<QuestStatus, number> = {
    active: 0,
    completed: 1,
    turned_in: 2,
    inactive: 3,
};

interface DisplayQuest {
    quest: Quest;
    progress: QuestProgress;
}

function getObjectiveLabel(objective: QuestObjective, currentProgress: number): string {
    if (objective.type === "kill_enemy") {
        const text = objective.description ?? `Defeat ${objective.enemyType}`;
        return `${text} (${Math.min(currentProgress, objective.count)}/${objective.count})`;
    }
    return "Unknown objective";
}

export function QuestLogModal({ onClose }: QuestLogModalProps) {
    const [, forceUpdate] = useReducer((counter: number) => counter + 1, 0);

    useEffect(() => {
        return subscribeToQuestState(() => {
            forceUpdate();
        });
    }, []);

    const displayQuests: DisplayQuest[] = getAllQuestProgress()
        .map(progress => {
            const quest = getQuestById(progress.questId);
            return quest ? { quest, progress } : null;
        })
        .filter((entry): entry is DisplayQuest => entry !== null)
        .sort((a, b) => {
            const statusDiff = STATUS_ORDER[a.progress.status] - STATUS_ORDER[b.progress.status];
            if (statusDiff !== 0) return statusDiff;
            return a.quest.name.localeCompare(b.quest.name);
        });

    return (
        <ModalShell onClose={onClose} closeOnEscape>
            <div className="quest-log-modal">
                <header className="quest-log-header">
                    <h2>Quest Log</h2>
                    <button type="button" className="quest-log-close" onClick={onClose}>Close</button>
                </header>
                {displayQuests.length === 0 ? (
                    <p className="quest-log-empty">No quests yet.</p>
                ) : (
                    <ul className="quest-log-list">
                        {displayQuests.map(({ quest, progress }) => (
                            <li key={quest.id} className={`quest-log-entry quest-status-${progress.status}`}>
                                <div className="quest-log-entry-header">
                                    <span className="quest-log-entry-name">{quest.name}</span>
                                    <span className="quest-log-entry-status">{STATUS_LABELS[progress.status]}</span>
                                </div>
                                {quest.summary ? (
                                    <p className="quest-log-entry-summary">{quest.summary}</p>
                                ) : null}
                                <ul className="quest-log-objectives">
                                    {quest.objectives.map(objective => {
                                        const current = progress.objectives[objective.id]?.progress ?? 0;
                                        return (
                                            <li key={objective.id}>
                                                {getObjectiveLabel(objective, current)}
                                            </li>
                                        );
                                    })}
                                </ul>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </ModalShell>
    );
}
