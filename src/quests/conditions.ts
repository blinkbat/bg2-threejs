import { getQuestStatus, isObjectiveCompleted } from "./state";
import type { QuestCondition } from "./types";

export function isQuestConditionSatisfied(condition: QuestCondition): boolean {
    if (condition.type === "quest_status") {
        return getQuestStatus(condition.questId) === condition.status;
    }
    if (condition.type === "quest_objective_complete") {
        return isObjectiveCompleted(condition.questId, condition.objectiveId);
    }
    return false;
}
