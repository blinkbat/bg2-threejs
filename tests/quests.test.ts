import { afterEach, describe, expect, it } from "vitest";
import {
    abandonQuest,
    clearQuestRegistry,
    completeQuest,
    getAllQuestProgress,
    getObjectiveProgress,
    getQuestProgress,
    getQuestStatus,
    isObjectiveCompleted,
    isQuestConditionSatisfied,
    recordEnemyKillForQuests,
    registerQuest,
    resetQuestState,
    restoreQuestState,
    serializeQuestState,
    startQuest,
    subscribeToQuestState,
    turnInQuest,
    type Quest,
} from "../src/quests";
import { parseSaveSlotData } from "../src/game/saveLoad/sanitize";

function makeKillQuest(id: string, enemyType: string, count: number, objectiveId = "kill"): Quest {
    return {
        id,
        name: id,
        objectives: [
            { type: "kill_enemy", id: objectiveId, enemyType: enemyType as Quest["objectives"][number]["enemyType"], count },
        ],
    };
}

afterEach(() => {
    resetQuestState();
    clearQuestRegistry();
});

describe("quest registry + lifecycle", () => {
    it("starts a quest, records kills, and auto-completes when objectives are met", () => {
        registerQuest(makeKillQuest("ogre_hunt_1", "ogre", 2));

        expect(getQuestStatus("ogre_hunt_1")).toBe("inactive");
        expect(startQuest("ogre_hunt_1")).toBe(true);
        expect(getQuestStatus("ogre_hunt_1")).toBe("active");

        recordEnemyKillForQuests("ogre");
        expect(getObjectiveProgress("ogre_hunt_1", "kill")).toBe(1);
        expect(getQuestStatus("ogre_hunt_1")).toBe("active");

        recordEnemyKillForQuests("ogre");
        expect(getObjectiveProgress("ogre_hunt_1", "kill")).toBe(2);
        expect(getQuestStatus("ogre_hunt_1")).toBe("completed");
        expect(isObjectiveCompleted("ogre_hunt_1", "kill")).toBe(true);
    });

    it("does not start unregistered or already-active quests", () => {
        expect(startQuest("missing_quest")).toBe(false);

        registerQuest(makeKillQuest("dup_q", "ogre", 1));
        expect(startQuest("dup_q")).toBe(true);
        expect(startQuest("dup_q")).toBe(false);
    });

    it("returns newly-completed quest ids from recordEnemyKillForQuests", () => {
        registerQuest(makeKillQuest("complete_signal_q", "ogre", 1));
        startQuest("complete_signal_q");

        const completed = recordEnemyKillForQuests("ogre");
        expect(completed).toEqual(["complete_signal_q"]);

        const completedAgain = recordEnemyKillForQuests("ogre");
        expect(completedAgain).toEqual([]);
    });

    it("advances multiple objectives sharing the same enemy type from a single kill", () => {
        registerQuest({
            id: "multi_q",
            name: "multi_q",
            objectives: [
                { type: "kill_enemy", id: "main", enemyType: "ogre", count: 1 },
                { type: "kill_enemy", id: "bonus", enemyType: "ogre", count: 1 },
            ],
        });
        startQuest("multi_q");

        const completed = recordEnemyKillForQuests("ogre");
        expect(getObjectiveProgress("multi_q", "main")).toBe(1);
        expect(getObjectiveProgress("multi_q", "bonus")).toBe(1);
        expect(completed).toEqual(["multi_q"]);
    });

    it("ignores kills of unrelated enemy types and clamps progress at the count", () => {
        registerQuest(makeKillQuest("kobold_q", "kobold", 1));
        startQuest("kobold_q");

        recordEnemyKillForQuests("ogre");
        expect(getObjectiveProgress("kobold_q", "kill")).toBe(0);

        recordEnemyKillForQuests("kobold");
        recordEnemyKillForQuests("kobold");
        expect(getObjectiveProgress("kobold_q", "kill")).toBe(1);
    });

    it("turns in only when objectives are complete", () => {
        registerQuest(makeKillQuest("turnin_q", "ogre", 1));
        startQuest("turnin_q");

        expect(turnInQuest("turnin_q")).toBe(false);

        recordEnemyKillForQuests("ogre");
        expect(getQuestStatus("turnin_q")).toBe("completed");
        expect(turnInQuest("turnin_q")).toBe(true);
        expect(getQuestStatus("turnin_q")).toBe("turned_in");

        expect(turnInQuest("turnin_q")).toBe(false);
    });

    it("completeQuest fills objectives and is rejected for non-active states", () => {
        registerQuest(makeKillQuest("force_q", "ogre", 5));
        expect(completeQuest("force_q")).toBe(false);

        startQuest("force_q");
        expect(completeQuest("force_q")).toBe(true);
        expect(getObjectiveProgress("force_q", "kill")).toBe(5);
        expect(getQuestStatus("force_q")).toBe("completed");

        expect(completeQuest("force_q")).toBe(false);
    });

    it("abandonQuest removes progress for active/completed quests but not turned_in", () => {
        registerQuest(makeKillQuest("abandon_q", "ogre", 1));
        startQuest("abandon_q");
        expect(abandonQuest("abandon_q")).toBe(true);
        expect(getQuestStatus("abandon_q")).toBe("inactive");

        startQuest("abandon_q");
        completeQuest("abandon_q");
        turnInQuest("abandon_q");
        expect(abandonQuest("abandon_q")).toBe(false);
        expect(getQuestStatus("abandon_q")).toBe("turned_in");
    });

    it("notifies subscribers when abandonQuest succeeds", () => {
        registerQuest(makeKillQuest("abandon_notify_q", "ogre", 1));
        startQuest("abandon_notify_q");

        let calls = 0;
        const unsubscribe = subscribeToQuestState(() => { calls += 1; });
        abandonQuest("abandon_notify_q");
        expect(calls).toBe(1);

        const before = calls;
        abandonQuest("abandon_notify_q");
        expect(calls).toBe(before);
        unsubscribe();
    });

    it("tolerates progress for an unregistered quest id", () => {
        restoreQuestState({
            ghost_q: {
                questId: "ghost_q",
                status: "active",
                objectives: { kill: { progress: 1 } },
            },
        });

        expect(getQuestStatus("ghost_q")).toBe("active");
        expect(() => recordEnemyKillForQuests("ogre")).not.toThrow();
        expect(isObjectiveCompleted("ghost_q", "kill")).toBe(false);
    });
});

describe("quest conditions", () => {
    it("evaluates quest_status and quest_objective_complete", () => {
        registerQuest(makeKillQuest("cond_q", "ogre", 1));

        expect(isQuestConditionSatisfied({ type: "quest_status", questId: "cond_q", status: "inactive" })).toBe(true);
        startQuest("cond_q");
        expect(isQuestConditionSatisfied({ type: "quest_status", questId: "cond_q", status: "active" })).toBe(true);
        expect(isQuestConditionSatisfied({ type: "quest_objective_complete", questId: "cond_q", objectiveId: "kill" })).toBe(false);

        recordEnemyKillForQuests("ogre");
        expect(isQuestConditionSatisfied({ type: "quest_objective_complete", questId: "cond_q", objectiveId: "kill" })).toBe(true);
    });
});

describe("subscription", () => {
    it("notifies subscribers on state changes and stops after unsubscribe", () => {
        registerQuest(makeKillQuest("sub_q", "ogre", 1));

        let calls = 0;
        const unsubscribe = subscribeToQuestState(() => { calls += 1; });

        startQuest("sub_q");
        expect(calls).toBe(1);

        recordEnemyKillForQuests("ogre");
        expect(calls).toBeGreaterThanOrEqual(2);

        const beforeUnsubscribe = calls;
        unsubscribe();
        startQuest("sub_q");
        expect(calls).toBe(beforeUnsubscribe);
    });
});

describe("save round-trip", () => {
    it("serializes and restores active progress through sanitize", () => {
        registerQuest(makeKillQuest("save_q", "ogre", 3));
        startQuest("save_q");
        recordEnemyKillForQuests("ogre");

        const serialized = serializeQuestState();
        expect(serialized.save_q.status).toBe("active");
        expect(serialized.save_q.objectives.kill.progress).toBe(1);

        resetQuestState();
        expect(getQuestStatus("save_q")).toBe("inactive");

        restoreQuestState(serialized);
        expect(getQuestStatus("save_q")).toBe("active");
        expect(getObjectiveProgress("save_q", "kill")).toBe(1);

        const parsed = parseSaveSlotData({
            version: 1,
            timestamp: 1,
            slotName: "slot",
            players: [{ id: 1, hp: 10 }],
            currentAreaId: "coast",
            openedChests: [],
            openedSecretDoors: [],
            killedEnemies: [],
            gold: 0,
            equipment: {},
            inventory: { items: [] },
            questState: serialized,
        });
        if (!parsed.ok) throw new Error("parseSaveSlotData rejected valid input");
        expect(parsed.data.questState?.save_q.status).toBe("active");
        expect(parsed.data.questState?.save_q.objectives.kill.progress).toBe(1);
    });

    it("sanitizer drops malformed quest entries", () => {
        const parsed = parseSaveSlotData({
            version: 1,
            timestamp: 1,
            slotName: "slot",
            players: [{ id: 1, hp: 10 }],
            currentAreaId: "coast",
            openedChests: [],
            openedSecretDoors: [],
            killedEnemies: [],
            gold: 0,
            equipment: {},
            inventory: { items: [] },
            questState: {
                ok: { questId: "ok", status: "active", objectives: {} },
                bad_status: { questId: "bad_status", status: "weird", objectives: {} },
                missing_id: { status: "active", objectives: {} },
            },
        });
        if (!parsed.ok) throw new Error("parseSaveSlotData rejected valid input");
        expect(Object.keys(parsed.data.questState ?? {})).toEqual(["ok"]);
    });

    it("getAllQuestProgress reflects current state", () => {
        registerQuest(makeKillQuest("a_q", "ogre", 1));
        registerQuest(makeKillQuest("b_q", "ogre", 1));
        startQuest("a_q");
        startQuest("b_q");

        const progress = getAllQuestProgress();
        expect(progress.map(p => p.questId).sort()).toEqual(["a_q", "b_q"]);
        expect(getQuestProgress("a_q")?.status).toBe("active");
    });
});
