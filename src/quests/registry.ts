import type { Quest } from "./types";

const questsById: Record<string, Quest> = {};

export function registerQuest(quest: Quest): void {
    if (questsById[quest.id]) {
        console.warn(`[quests] duplicate registerQuest for id "${quest.id}"; previous definition is being overwritten.`);
    }
    questsById[quest.id] = quest;
}

export function getQuestById(questId: string): Quest | undefined {
    return questsById[questId];
}

export function getAllQuests(): Quest[] {
    return Object.values(questsById);
}

export function getQuestIds(): string[] {
    return Object.keys(questsById).sort((a, b) => a.localeCompare(b));
}

/** Test-only: clears all registered quests. */
export function clearQuestRegistry(): void {
    for (const key of Object.keys(questsById)) {
        delete questsById[key];
    }
}
