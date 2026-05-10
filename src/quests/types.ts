import type { EnemyType } from "../core/types";

export type QuestStatus = "inactive" | "active" | "completed" | "turned_in";

export interface KillEnemyObjective {
    type: "kill_enemy";
    id: string;
    enemyType: EnemyType;
    count: number;
    description?: string;
}

export type QuestObjective = KillEnemyObjective;

export interface Quest {
    id: string;
    name: string;
    summary?: string;
    description?: string;
    objectives: QuestObjective[];
}

export interface QuestObjectiveProgress {
    progress: number;
}

export interface QuestProgress {
    questId: string;
    status: QuestStatus;
    objectives: Record<string, QuestObjectiveProgress>;
    startedAt?: number;
    completedAt?: number;
    turnedInAt?: number;
}

export type QuestStateMap = Record<string, QuestProgress>;

interface QuestStatusCondition {
    type: "quest_status";
    questId: string;
    status: QuestStatus;
}

interface QuestObjectiveCompleteCondition {
    type: "quest_objective_complete";
    questId: string;
    objectiveId: string;
}

export type QuestCondition =
    | QuestStatusCondition
    | QuestObjectiveCompleteCondition;
