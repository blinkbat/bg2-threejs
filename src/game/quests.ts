import { registerQuest } from "../quests";
import type { Quest } from "../quests";

const QUESTS: readonly Quest[] = [];

for (const quest of QUESTS) {
    registerQuest(quest);
}
