// Re-export from unified localStorage module
export type { HotbarAssignments } from "./localStorage";
export {
    HOTBAR_SLOT_COUNT,
    createEmptyHotbarSlots,
    loadHotbarAssignments,
    normalizeHotbarSlots,
    saveHotbarAssignments,
} from "./localStorage";
