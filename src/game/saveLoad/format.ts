import type { SaveSlotData, SaveSlotInfo, SavedPlayer } from "./types";

/** Format timestamp for display */
export function formatSaveTimestamp(timestamp: number): string {
    const date = new Date(timestamp);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();

    if (isToday) {
        return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }

    return date.toLocaleDateString([], {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}

/** Get average party level for display */
export function getPartyLevel(players: SavedPlayer[]): number {
    const corePlayers = players.filter(player => !player.summonType);
    if (corePlayers.length === 0) return 1;
    const total = corePlayers.reduce((sum, player) => sum + (player.level ?? 1), 0);
    return Math.round(total / corePlayers.length);
}

/** Get slot display info */
export function getSlotInfo(slot: SaveSlotData | null): SaveSlotInfo | null {
    if (!slot) return null;
    return {
        slotName: slot.slotName,
        timestamp: slot.timestamp,
        partyLevel: getPartyLevel(slot.players),
        areaId: slot.currentAreaId,
    };
}

/** Get human-readable area name */
export function getAreaDisplayName(areaId: string): string {
    const names: Record<string, string> = {
        coast: "The Coast",
        forest: "The Forest",
        dungeon: "Kobold Warrens",
        ruins: "Ancient Ruins",
        sanctum: "The Sanctum",
        cliffs: "Coastal Cliffs",
        magma_cave: "The Magma Cave",
        glade: "The Glade",
    };

    return names[areaId] ?? areaId;
}
