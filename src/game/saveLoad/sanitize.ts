import type {
    CharacterEquipment,
    CharacterStats,
    DamageType,
    InventoryEntry,
    PartyInventory,
    StatusEffect,
    StatusEffectType,
    SummonType,
} from "../../core/types";
import type { HotbarAssignments } from "../../hooks/localStorage";
import { MAX_SLOTS, SAVE_VERSION } from "./constants";
import type { DialogTriggerProgress, EnemyPositionMap, SaveSlotData, SavedPlayer } from "./types";
import type { FogVisibilityByArea } from "../fogMemory";

const HOTBAR_SLOT_COUNT = 5;

const DAMAGE_TYPES: ReadonlySet<DamageType> = new Set([
    "physical",
    "fire",
    "cold",
    "lightning",
    "chaos",
    "holy",
]);

const STATUS_EFFECT_TYPES: ReadonlySet<StatusEffectType> = new Set([
    "poison",
    "burn",
    "regen",
    "shielded",
    "stunned",
    "cleansed",
    "pinned",
    "slowed",
    "chilled",
    "qi_drain",
    "energy_shield",
    "defiance",
    "doom",
    "invul",
    "sleep",
    "sun_stance",
    "thorns",
    "highland_defense",
    "divine_lattice",
    "weakened",
    "hamstrung",
    "blind",
    "vanquishing_light",
    "enraged",
    "feared",
    "blood_marked",
]);

const SUMMON_TYPES: ReadonlySet<SummonType> = new Set([
    "ancestor_warrior",
    "vishas_eye_orb",
]);

function isDamageType(value: string): value is DamageType {
    return DAMAGE_TYPES.has(value as DamageType);
}

function isStatusEffectType(value: string): value is StatusEffectType {
    return STATUS_EFFECT_TYPES.has(value as StatusEffectType);
}

function isSummonType(value: string): value is SummonType {
    return SUMMON_TYPES.has(value as SummonType);
}

interface ParsedSaveSlotSuccess {
    ok: true;
    data: SaveSlotData;
}

interface ParsedSaveSlotFailure {
    ok: false;
    code: "version_unsupported" | "invalid";
}

type ParsedSaveSlotResult = ParsedSaveSlotSuccess | ParsedSaveSlotFailure;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasField(record: Record<string, unknown>, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(record, key);
}

function getField(record: Record<string, unknown>, key: string): unknown {
    return hasField(record, key) ? record[key] : undefined;
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
    const value = getField(record, key);
    return typeof value === "string" ? value : undefined;
}

function readNullableString(record: Record<string, unknown>, key: string): string | null | undefined {
    const value = getField(record, key);
    if (value === null) return null;
    if (typeof value === "string") return value;
    return undefined;
}

function readFiniteNumber(record: Record<string, unknown>, key: string): number | undefined {
    const value = getField(record, key);
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readPositiveInteger(record: Record<string, unknown>, key: string): number | undefined {
    const value = readFiniteNumber(record, key);
    if (value === undefined) return undefined;
    const normalized = Math.floor(value);
    return normalized > 0 ? normalized : undefined;
}

function readNonNegativeInteger(record: Record<string, unknown>, key: string): number | undefined {
    const value = readFiniteNumber(record, key);
    if (value === undefined) return undefined;
    const normalized = Math.floor(value);
    return normalized >= 0 ? normalized : undefined;
}

function sanitizeStringArray(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [];
    const result: string[] = [];
    const seen = new Set<string>();
    for (const entry of raw) {
        if (typeof entry !== "string") continue;
        const trimmed = entry.trim();
        if (trimmed.length === 0 || seen.has(trimmed)) continue;
        seen.add(trimmed);
        result.push(trimmed);
    }
    return result;
}

function sanitizePositiveIntegerArray(raw: unknown): number[] {
    if (!Array.isArray(raw)) return [];
    const result: number[] = [];
    const seen = new Set<number>();
    for (const entry of raw) {
        if (typeof entry !== "number" || !Number.isFinite(entry)) continue;
        const normalized = Math.floor(entry);
        if (normalized <= 0 || seen.has(normalized)) continue;
        seen.add(normalized);
        result.push(normalized);
    }
    return result;
}

function sanitizeCharacterStats(raw: unknown): CharacterStats | undefined {
    if (!isRecord(raw)) return undefined;

    const strength = readNonNegativeInteger(raw, "strength") ?? 0;
    const dexterity = readNonNegativeInteger(raw, "dexterity") ?? 0;
    const vitality = readNonNegativeInteger(raw, "vitality") ?? 0;
    const intelligence = readNonNegativeInteger(raw, "intelligence") ?? 0;
    const faith = readNonNegativeInteger(raw, "faith") ?? 0;

    return {
        strength,
        dexterity,
        vitality,
        intelligence,
        faith,
    };
}

function sanitizeCantripUses(raw: unknown): Record<string, number> | undefined {
    if (!isRecord(raw)) return undefined;
    const sanitized: Record<string, number> = {};
    for (const [skillName, usesRaw] of Object.entries(raw)) {
        if (typeof skillName !== "string" || skillName.trim().length === 0) continue;
        if (typeof usesRaw !== "number" || !Number.isFinite(usesRaw)) continue;
        const normalized = Math.max(0, Math.floor(usesRaw));
        sanitized[skillName] = normalized;
    }
    return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

function sanitizeStatusEffect(raw: unknown): StatusEffect | null {
    if (!isRecord(raw)) return null;

    const typeRaw = readString(raw, "type");
    if (!typeRaw || !isStatusEffectType(typeRaw)) {
        return null;
    }

    const duration = readFiniteNumber(raw, "duration") ?? 0;
    const tickIntervalRaw = readFiniteNumber(raw, "tickInterval");
    const tickInterval = tickIntervalRaw !== undefined && tickIntervalRaw > 0 ? tickIntervalRaw : 1000;
    const timeSinceTick = readFiniteNumber(raw, "timeSinceTick") ?? 0;
    const lastUpdateTime = readFiniteNumber(raw, "lastUpdateTime") ?? Date.now();
    const damagePerTick = readFiniteNumber(raw, "damagePerTick") ?? 0;
    const sourceIdRaw = readFiniteNumber(raw, "sourceId");
    const sourceId = sourceIdRaw !== undefined ? Math.floor(sourceIdRaw) : -1;

    const effect: StatusEffect = {
        type: typeRaw,
        duration,
        tickInterval,
        timeSinceTick,
        lastUpdateTime,
        damagePerTick,
        sourceId,
    };

    const shieldAmount = readFiniteNumber(raw, "shieldAmount");
    if (shieldAmount !== undefined) effect.shieldAmount = shieldAmount;

    const thornsDamage = readFiniteNumber(raw, "thornsDamage");
    if (thornsDamage !== undefined) effect.thornsDamage = thornsDamage;

    const interceptRemaining = readFiniteNumber(raw, "interceptRemaining");
    if (interceptRemaining !== undefined) effect.interceptRemaining = interceptRemaining;

    const interceptCooldownEnd = readFiniteNumber(raw, "interceptCooldownEnd");
    if (interceptCooldownEnd !== undefined) effect.interceptCooldownEnd = interceptCooldownEnd;

    const auraRadius = readFiniteNumber(raw, "auraRadius");
    if (auraRadius !== undefined) effect.auraRadius = auraRadius;

    const blindChance = readFiniteNumber(raw, "blindChance");
    if (blindChance !== undefined) effect.blindChance = blindChance;

    const blindDuration = readFiniteNumber(raw, "blindDuration");
    if (blindDuration !== undefined) effect.blindDuration = blindDuration;

    const auraDamageTypeRaw = readString(raw, "auraDamageType");
    if (auraDamageTypeRaw && isDamageType(auraDamageTypeRaw)) {
        effect.auraDamageType = auraDamageTypeRaw;
    }

    const fearSourceX = readFiniteNumber(raw, "fearSourceX");
    if (fearSourceX !== undefined) effect.fearSourceX = fearSourceX;

    const fearSourceZ = readFiniteNumber(raw, "fearSourceZ");
    if (fearSourceZ !== undefined) effect.fearSourceZ = fearSourceZ;

    const lifestealPercent = readFiniteNumber(raw, "lifestealPercent");
    if (lifestealPercent !== undefined) effect.lifestealPercent = lifestealPercent;

    return effect;
}

function sanitizeStatusEffects(raw: unknown): StatusEffect[] | undefined {
    if (!Array.isArray(raw)) return undefined;
    const sanitized: StatusEffect[] = [];
    for (const entry of raw) {
        const effect = sanitizeStatusEffect(entry);
        if (effect) sanitized.push(effect);
    }
    return sanitized.length > 0 ? sanitized : undefined;
}

function sanitizeSavedPlayer(raw: unknown): SavedPlayer | null {
    if (!isRecord(raw)) return null;

    const id = readPositiveInteger(raw, "id");
    const hpRaw = readFiniteNumber(raw, "hp");
    if (id === undefined || hpRaw === undefined) return null;

    const player: SavedPlayer = {
        id,
        hp: Math.max(0, hpRaw),
    };

    const x = readFiniteNumber(raw, "x");
    const z = readFiniteNumber(raw, "z");
    if (x !== undefined && z !== undefined) {
        player.x = x;
        player.z = z;
    }

    const mana = readFiniteNumber(raw, "mana");
    if (mana !== undefined) player.mana = Math.max(0, mana);

    const level = readPositiveInteger(raw, "level");
    if (level !== undefined) player.level = level;

    const exp = readNonNegativeInteger(raw, "exp");
    if (exp !== undefined) player.exp = exp;

    const stats = sanitizeCharacterStats(getField(raw, "stats"));
    if (stats) player.stats = stats;

    const statPoints = readNonNegativeInteger(raw, "statPoints");
    if (statPoints !== undefined) player.statPoints = statPoints;

    const skillPoints = readNonNegativeInteger(raw, "skillPoints");
    if (skillPoints !== undefined) player.skillPoints = skillPoints;

    const learnedSkills = sanitizeStringArray(getField(raw, "learnedSkills"));
    if (learnedSkills.length > 0) player.learnedSkills = learnedSkills;

    const statusEffects = sanitizeStatusEffects(getField(raw, "statusEffects"));
    if (statusEffects) player.statusEffects = statusEffects;

    const cantripUses = sanitizeCantripUses(getField(raw, "cantripUses"));
    if (cantripUses) player.cantripUses = cantripUses;

    const summonTypeRaw = readString(raw, "summonType");
    if (summonTypeRaw && isSummonType(summonTypeRaw)) {
        player.summonType = summonTypeRaw;
    }

    const summonedBy = readPositiveInteger(raw, "summonedBy");
    if (summonedBy !== undefined) player.summonedBy = summonedBy;

    const summonExpireAt = readFiniteNumber(raw, "summonExpireAt");
    if (summonExpireAt !== undefined) player.summonExpireAt = summonExpireAt;

    const summonRemainingDurationMs = readNonNegativeInteger(raw, "summonRemainingDurationMs");
    if (summonRemainingDurationMs !== undefined) {
        player.summonRemainingDurationMs = summonRemainingDurationMs;
    }

    return player;
}

function sanitizeSavedPlayers(raw: unknown): SavedPlayer[] {
    if (!Array.isArray(raw)) return [];
    const sanitized: SavedPlayer[] = [];
    const seenIds = new Set<number>();
    for (const entry of raw) {
        const player = sanitizeSavedPlayer(entry);
        if (!player || seenIds.has(player.id)) continue;
        seenIds.add(player.id);
        sanitized.push(player);
    }
    return sanitized;
}

function sanitizeCharacterEquipment(raw: unknown): CharacterEquipment {
    if (!isRecord(raw)) {
        return {
            armor: null,
            leftHand: null,
            rightHand: null,
            accessory1: null,
            accessory2: null,
        };
    }

    const normalize = (value: string | null | undefined): string | null => {
        if (value === null) return null;
        if (typeof value === "string") {
            const trimmed = value.trim();
            return trimmed.length > 0 ? trimmed : null;
        }
        return null;
    };

    return {
        armor: normalize(readNullableString(raw, "armor")),
        leftHand: normalize(readNullableString(raw, "leftHand")),
        rightHand: normalize(readNullableString(raw, "rightHand")),
        accessory1: normalize(readNullableString(raw, "accessory1")),
        accessory2: normalize(readNullableString(raw, "accessory2")),
    };
}

function sanitizeEquipmentMap(raw: unknown): Record<number, CharacterEquipment> {
    if (!isRecord(raw)) return {};
    const sanitized: Record<number, CharacterEquipment> = {};
    for (const [unitIdRaw, equipmentRaw] of Object.entries(raw)) {
        const numericId = Number(unitIdRaw);
        if (!Number.isFinite(numericId)) continue;
        const unitId = Math.floor(numericId);
        if (unitId <= 0) continue;
        sanitized[unitId] = sanitizeCharacterEquipment(equipmentRaw);
    }
    return sanitized;
}

function sanitizeInventoryEntry(raw: unknown): InventoryEntry | null {
    if (!isRecord(raw)) return null;
    const itemId = readString(raw, "itemId")?.trim();
    if (!itemId) return null;
    const quantity = readPositiveInteger(raw, "quantity");
    if (quantity === undefined) return null;
    return { itemId, quantity };
}

function sanitizeInventory(raw: unknown): PartyInventory {
    if (!isRecord(raw)) return { items: [] };

    const itemsRaw = getField(raw, "items");
    if (!Array.isArray(itemsRaw)) return { items: [] };

    const quantityByItem = new Map<string, number>();
    for (const entryRaw of itemsRaw) {
        const entry = sanitizeInventoryEntry(entryRaw);
        if (!entry) continue;
        const existing = quantityByItem.get(entry.itemId) ?? 0;
        quantityByItem.set(entry.itemId, existing + entry.quantity);
    }

    return {
        items: Array.from(quantityByItem.entries()).map(([itemId, quantity]) => ({ itemId, quantity })),
    };
}

function sanitizeHotbarAssignments(raw: unknown): HotbarAssignments {
    if (!isRecord(raw)) return {};

    const sanitized: HotbarAssignments = {};
    for (const [unitIdRaw, slotsRaw] of Object.entries(raw)) {
        const unitId = Number(unitIdRaw);
        if (!Number.isFinite(unitId) || unitId <= 0) continue;
        if (!Array.isArray(slotsRaw)) continue;

        const slots: (string | null)[] = [];
        for (let i = 0; i < HOTBAR_SLOT_COUNT; i++) {
            const value = slotsRaw[i];
            if (typeof value === "string") {
                const trimmed = value.trim();
                slots.push(trimmed.length > 0 ? trimmed : null);
                continue;
            }
            slots.push(null);
        }

        sanitized[Math.floor(unitId)] = slots;
    }

    return sanitized;
}

function sanitizeDialogTriggerProgress(raw: unknown): DialogTriggerProgress {
    if (!isRecord(raw)) return {};

    const sanitized: DialogTriggerProgress = {};
    for (const [areaIdRaw, triggerIdsRaw] of Object.entries(raw)) {
        const areaId = areaIdRaw.trim();
        if (areaId.length === 0) continue;
        const triggerIds = sanitizeStringArray(triggerIdsRaw);
        if (triggerIds.length > 0) {
            sanitized[areaId] = triggerIds;
        }
    }

    return sanitized;
}

function sanitizeEnemyPositions(raw: unknown): EnemyPositionMap {
    if (!isRecord(raw)) return {};

    const sanitized: EnemyPositionMap = {};
    for (const [enemyKeyRaw, positionRaw] of Object.entries(raw)) {
        const enemyKey = enemyKeyRaw.trim();
        if (enemyKey.length === 0) continue;
        if (!isRecord(positionRaw)) continue;
        const x = readFiniteNumber(positionRaw, "x");
        const z = readFiniteNumber(positionRaw, "z");
        if (x === undefined || z === undefined) continue;
        sanitized[enemyKey] = { x, z };
    }

    return sanitized;
}

function sanitizeFogVisibilityArea(raw: unknown): number[][] | null {
    if (!Array.isArray(raw) || raw.length === 0) return null;

    const sanitizedColumns: number[][] = [];
    let expectedHeight: number | null = null;

    for (const columnRaw of raw) {
        if (!Array.isArray(columnRaw)) return null;

        const sanitizedColumn: number[] = [];
        for (const cellRaw of columnRaw) {
            if (typeof cellRaw !== "number" || !Number.isFinite(cellRaw)) {
                return null;
            }

            const cell = Math.floor(cellRaw);
            if (cell < 0 || cell > 2) {
                return null;
            }

            sanitizedColumn.push(cell);
        }

        if (expectedHeight === null) {
            expectedHeight = sanitizedColumn.length;
        } else if (sanitizedColumn.length !== expectedHeight) {
            return null;
        }

        sanitizedColumns.push(sanitizedColumn);
    }

    return sanitizedColumns;
}

function sanitizeFogVisibilityByArea(raw: unknown): FogVisibilityByArea {
    if (!isRecord(raw)) return {};

    const sanitized: FogVisibilityByArea = {};
    for (const [areaIdRaw, visibilityRaw] of Object.entries(raw)) {
        const areaId = areaIdRaw.trim();
        if (areaId.length === 0) continue;

        const visibility = sanitizeFogVisibilityArea(visibilityRaw);
        if (!visibility) continue;

        sanitized[areaId] = visibility;
    }

    return sanitized;
}

function sanitizeLastWaystone(raw: unknown): NonNullable<SaveSlotData["lastWaystone"]> | undefined {
    if (!isRecord(raw)) return undefined;

    const areaId = readString(raw, "areaId")?.trim();
    const waystoneIndex = readNonNegativeInteger(raw, "waystoneIndex");
    if (!areaId || waystoneIndex === undefined) {
        return undefined;
    }

    return { areaId, waystoneIndex };
}

function parseVersion(raw: Record<string, unknown>): number | null {
    const version = readFiniteNumber(raw, "version");
    if (version === undefined) return SAVE_VERSION;
    if (!Number.isInteger(version)) return null;
    return version;
}

function sanitizeSaveSlotV1(raw: Record<string, unknown>): SaveSlotData | null {
    const currentAreaId = readString(raw, "currentAreaId")?.trim();
    if (!currentAreaId) return null;

    const timestamp = readFiniteNumber(raw, "timestamp") ?? Date.now();
    const slotNameRaw = readString(raw, "slotName")?.trim();
    const slotName = slotNameRaw && slotNameRaw.length > 0 ? slotNameRaw : currentAreaId;

    const saveData: SaveSlotData = {
        version: SAVE_VERSION,
        timestamp,
        slotName,
        players: sanitizeSavedPlayers(getField(raw, "players")),
        currentAreaId,
        openedChests: sanitizeStringArray(getField(raw, "openedChests")),
        openedSecretDoors: sanitizeStringArray(getField(raw, "openedSecretDoors")),
        activatedWaystones: sanitizeStringArray(getField(raw, "activatedWaystones")),
        killedEnemies: sanitizeStringArray(getField(raw, "killedEnemies")),
        gold: Math.max(0, readFiniteNumber(raw, "gold") ?? 0),
        equipment: sanitizeEquipmentMap(getField(raw, "equipment")),
        inventory: sanitizeInventory(getField(raw, "inventory")),
    };

    if (hasField(raw, "hotbarAssignments")) {
        saveData.hotbarAssignments = sanitizeHotbarAssignments(getField(raw, "hotbarAssignments"));
    }

    if (hasField(raw, "formationOrder")) {
        saveData.formationOrder = sanitizePositiveIntegerArray(getField(raw, "formationOrder"));
    }

    if (hasField(raw, "dialogTriggerProgress")) {
        saveData.dialogTriggerProgress = sanitizeDialogTriggerProgress(getField(raw, "dialogTriggerProgress"));
    }

    if (hasField(raw, "enemyPositions")) {
        saveData.enemyPositions = sanitizeEnemyPositions(getField(raw, "enemyPositions"));
    }

    if (hasField(raw, "fogVisibilityByArea")) {
        saveData.fogVisibilityByArea = sanitizeFogVisibilityByArea(getField(raw, "fogVisibilityByArea"));
    }

    if (hasField(raw, "lastWaystone")) {
        const lastWaystone = sanitizeLastWaystone(getField(raw, "lastWaystone"));
        if (lastWaystone) {
            saveData.lastWaystone = lastWaystone;
        }
    }

    return saveData;
}

export function parseSaveSlotData(raw: unknown): ParsedSaveSlotResult {
    if (!isRecord(raw)) {
        return { ok: false, code: "invalid" };
    }

    const version = parseVersion(raw);
    if (version === null) {
        return { ok: false, code: "invalid" };
    }

    if (version > SAVE_VERSION) {
        return { ok: false, code: "version_unsupported" };
    }

    const sanitized = sanitizeSaveSlotV1(raw);
    if (!sanitized) {
        return { ok: false, code: "invalid" };
    }

    return { ok: true, data: sanitized };
}

export function normalizeSlots(rawSlots: unknown): (SaveSlotData | null)[] {
    const slots: (SaveSlotData | null)[] = [];
    const source = Array.isArray(rawSlots) ? rawSlots : [];

    for (let index = 0; index < MAX_SLOTS; index++) {
        const rawSlot = source[index];
        if (rawSlot === null || rawSlot === undefined) {
            slots.push(null);
            continue;
        }

        const parsed = parseSaveSlotData(rawSlot);
        slots.push(parsed.ok ? parsed.data : null);
    }

    return slots;
}
