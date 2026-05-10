import { getGameTime } from "../core/gameClock";
import type { EnemyType } from "../core/types";
import { getQuestById } from "./registry";
import type {
    Quest,
    QuestObjective,
    QuestProgress,
    QuestStateMap,
    QuestStatus,
} from "./types";

let questStateById: QuestStateMap = {};
let revision = 0;
const subscribers = new Set<() => void>();

function notify(): void {
    revision++;
    for (const subscriber of Array.from(subscribers)) {
        subscriber();
    }
}

export function subscribeToQuestState(callback: () => void): () => void {
    subscribers.add(callback);
    return () => {
        subscribers.delete(callback);
    };
}

export function getQuestStateRevision(): number {
    return revision;
}

export function getQuestProgress(questId: string): QuestProgress | undefined {
    return questStateById[questId];
}

export function getQuestStatus(questId: string): QuestStatus {
    return questStateById[questId]?.status ?? "inactive";
}

export function getAllQuestProgress(): QuestProgress[] {
    return Object.values(questStateById);
}

export function getObjectiveProgress(questId: string, objectiveId: string): number {
    return questStateById[questId]?.objectives[objectiveId]?.progress ?? 0;
}

function isObjectiveCompleteWithProgress(objective: QuestObjective, progress: number): boolean {
    if (objective.type === "kill_enemy") {
        return progress >= objective.count;
    }
    return false;
}

function areAllObjectivesComplete(quest: Quest, questProgress: QuestProgress): boolean {
    return quest.objectives.every(objective => {
        const current = questProgress.objectives[objective.id]?.progress ?? 0;
        return isObjectiveCompleteWithProgress(objective, current);
    });
}

function createInitialProgress(quest: Quest): QuestProgress {
    const objectives: Record<string, { progress: number }> = {};
    for (const objective of quest.objectives) {
        objectives[objective.id] = { progress: 0 };
    }
    return {
        questId: quest.id,
        status: "active",
        objectives,
        startedAt: getGameTime(),
    };
}

export function startQuest(questId: string): boolean {
    const quest = getQuestById(questId);
    if (!quest) return false;
    const existing = questStateById[questId];
    if (existing && existing.status !== "inactive") return false;
    questStateById[questId] = createInitialProgress(quest);
    notify();
    return true;
}

export function completeQuest(questId: string): boolean {
    const progress = questStateById[questId];
    if (!progress || progress.status !== "active") return false;
    const quest = getQuestById(questId);
    if (quest) {
        for (const objective of quest.objectives) {
            if (objective.type === "kill_enemy") {
                progress.objectives[objective.id] = { progress: objective.count };
            }
        }
    }
    progress.status = "completed";
    progress.completedAt = getGameTime();
    notify();
    return true;
}

export function abandonQuest(questId: string): boolean {
    const progress = questStateById[questId];
    if (!progress) return false;
    if (progress.status === "turned_in") return false;
    delete questStateById[questId];
    notify();
    return true;
}

export function turnInQuest(questId: string): boolean {
    const progress = questStateById[questId];
    if (!progress) return false;
    if (progress.status === "turned_in" || progress.status === "inactive") return false;
    if (progress.status === "active") {
        const quest = getQuestById(questId);
        if (!quest || !areAllObjectivesComplete(quest, progress)) return false;
        for (const objective of quest.objectives) {
            if (objective.type === "kill_enemy") {
                progress.objectives[objective.id] = { progress: objective.count };
            }
        }
        progress.completedAt = getGameTime();
    }
    progress.status = "turned_in";
    progress.turnedInAt = getGameTime();
    notify();
    return true;
}

export function isObjectiveCompleted(questId: string, objectiveId: string): boolean {
    const progress = questStateById[questId];
    if (!progress) return false;
    const quest = getQuestById(questId);
    if (!quest) return false;
    const objective = quest.objectives.find(candidate => candidate.id === objectiveId);
    if (!objective) return false;
    const current = progress.objectives[objectiveId]?.progress ?? 0;
    return isObjectiveCompleteWithProgress(objective, current);
}

export function recordEnemyKillForQuests(enemyType: EnemyType): string[] {
    let changed = false;
    const newlyCompleted: string[] = [];
    for (const progress of Object.values(questStateById)) {
        if (progress.status !== "active") continue;
        const quest = getQuestById(progress.questId);
        if (!quest) continue;

        for (const objective of quest.objectives) {
            if (objective.type !== "kill_enemy") continue;
            if (objective.enemyType !== enemyType) continue;
            const current = progress.objectives[objective.id]?.progress ?? 0;
            if (current >= objective.count) continue;
            progress.objectives[objective.id] = { progress: current + 1 };
            changed = true;
        }

        if (areAllObjectivesComplete(quest, progress)) {
            progress.status = "completed";
            progress.completedAt = getGameTime();
            newlyCompleted.push(progress.questId);
            changed = true;
        }
    }
    if (changed) notify();
    return newlyCompleted;
}

export function serializeQuestState(): QuestStateMap {
    const clone: QuestStateMap = {};
    for (const [questId, progress] of Object.entries(questStateById)) {
        const objectives: Record<string, { progress: number }> = {};
        for (const [objectiveId, objectiveProgress] of Object.entries(progress.objectives)) {
            objectives[objectiveId] = { progress: objectiveProgress.progress };
        }
        clone[questId] = {
            questId: progress.questId,
            status: progress.status,
            objectives,
            ...(progress.startedAt !== undefined ? { startedAt: progress.startedAt } : {}),
            ...(progress.completedAt !== undefined ? { completedAt: progress.completedAt } : {}),
            ...(progress.turnedInAt !== undefined ? { turnedInAt: progress.turnedInAt } : {}),
        };
    }
    return clone;
}

export function restoreQuestState(state: QuestStateMap): void {
    questStateById = state;
    notify();
}

export function resetQuestState(): void {
    questStateById = {};
    notify();
}
