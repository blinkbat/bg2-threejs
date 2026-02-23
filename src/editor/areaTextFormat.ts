// =============================================================================
// AREA TEXT FORMAT - Parser and serializer for human-readable map format
// =============================================================================

import { GRID_SIZE, DEFAULT_CANDLE_LIGHT_COLOR, DEFAULT_TORCH_LIGHT_COLOR } from "../core/constants";
import {
    DEFAULT_AREA_LIGHT_ANGLE,
    DEFAULT_AREA_LIGHT_BRIGHTNESS,
    DEFAULT_AREA_LIGHT_DECAY,
    DEFAULT_AREA_LIGHT_DIFFUSION,
    DEFAULT_AREA_LIGHT_HEIGHT,
    DEFAULT_AREA_LIGHT_RADIUS,
    DEFAULT_AREA_LIGHT_TINT,
    type AreaData,
    type AreaDialogChoice,
    type AreaDialogDefinition,
    type AreaDialogMenuId,
    type AreaDialogNode,
    type AreaDialogUiAction,
    type AreaId,
    type AreaDialogTrigger,
    type AreaDialogTriggerCondition,
    type EnemySpawn,
    type AreaTransition,
    type ChestLocation,
    type TreeLocation,
    type TreeType,
    type Decoration,
    type SecretDoor,
    type AreaLight,
} from "../game/areas/types";
import type { CandlePosition, EnemyType } from "../core/types";
import type { DialogSpeakerId } from "../dialog/types";
import {
    clampTileTintPercent,
    composeTileLayers,
    hasTintData,
    normalizeTileLayerStack,
    normalizeTintLayerStack,
    TILE_EMPTY,
} from "../game/areas/tileLayers";
import { DIALOG_SPEAKERS } from "../dialog/speakers";

// =============================================================================
// TEXT FORMAT SPECIFICATION
// =============================================================================
// === AREA: area_id ===
// name: Area Name
// flavor: Description text
// size: 50x50
// background: #87CEEB
// ground: #5a7a4a
// ambient: 0.55
// directional: 0.85
// fog: true
// spawn: 47,25
//
// === GEOMETRY ===
// (grid of # for walls, . for floor, ^v<> for doors)
//
// === TERRAIN ===
// (grid with ~ for lava, . for empty)
//
// === FLOOR ===
// (grid with s=sand, d=dirt, g=grass, w=water, t=stone, .=default)
//
// === TERRAIN_LAYER_N ===
// (optional layered terrain stack, bottom -> top)
//
// === FLOOR_LAYER_N ===
// (optional layered floor stack, bottom -> top)
//
// === TERRAIN_TINT_LAYER_N ===
// x,z:tintPercent  (sparse per-tile tint map, -35..35)
//
// === FLOOR_TINT_LAYER_N ===
// x,z:tintPercent  (sparse per-tile tint map, -35..35)
//
// === ENEMIES ===
// x,z:enemy_type
//
// === CHESTS ===
// x,z:gold=N,items=[itemId:qty,...]
// x,z:gold=N,items=[...],locked=keyId
// x,z:...,decorOnly=true
//
// === TRANSITIONS ===
// x,z,w,h:direction->targetArea@spawnX,spawnZ
//
// === TREES ===
// x,z:size
//
// === DECORATIONS ===
// x,z:type,rot=N,size=N
//
// === SECRET_DOORS ===
// x,z:blocking=bx,bz,bw,bh,hint=text
//
// === LIGHTS ===
// x,z:radius=12,angle=45,tint=#ffd28a,brightness=6,height=8,diffusion=0.35,decay=1.2
//
// === CANDLES ===
// x,z:dir=dx,dz,kind=candle|torch,color=#rrggbb
//
// === DIALOGS ===
// One JSON object per line (AreaDialogDefinition)
//
// === DIALOG_TRIGGERS ===
// One JSON object per line (AreaDialogTrigger)
// =============================================================================

interface ParsedArea {
    metadata: {
        id: AreaId;
        name: string;
        flavor: string;
        width: number;
        height: number;
        background: string;
        ground: string;
        ambient: number;
        directional: number;
        fog: boolean;
        invulnerable?: boolean;
        spawnX: number;
        spawnZ: number;
    };
    geometry: string[][];
    terrain: string[][];
    floor: string[][];
    terrainLayersByIndex: Record<number, string[][]>;
    floorLayersByIndex: Record<number, string[][]>;
    terrainTintEntriesByIndex: Record<number, Array<{ x: number; z: number; tint: number }>>;
    floorTintEntriesByIndex: Record<number, Array<{ x: number; z: number; tint: number }>>;
    enemies: EnemySpawn[];
    chests: ChestLocation[];
    transitions: AreaTransition[];
    trees: TreeLocation[];
    decorations: Decoration[];
    secretDoors: SecretDoor[];
    lights: AreaLight[];
    candles: CandlePosition[];
    dialogs: AreaDialogDefinition[];
    dialogTriggers: AreaDialogTrigger[];
}

function normalizeHexColor(color: string | undefined, fallback: string): string {
    if (typeof color === "string" && /^#[0-9a-fA-F]{6}$/.test(color)) {
        return color.toLowerCase();
    }
    return fallback;
}

function writeSparseTintSections(
    lines: string[],
    sectionPrefix: string,
    tintLayers: number[][][],
    tileLayers: string[][][]
): void {
    if (!hasTintData(tintLayers)) return;

    for (let layerIndex = 0; layerIndex < tintLayers.length; layerIndex++) {
        const tintLayer = tintLayers[layerIndex];
        const tileLayer = tileLayers[layerIndex];
        const entries: Array<{ x: number; z: number; tint: number }> = [];

        for (let z = 0; z < tintLayer.length; z++) {
            for (let x = 0; x < tintLayer[z].length; x++) {
                const tint = clampTileTintPercent(tintLayer[z][x]);
                if (tint === 0) continue;
                if ((tileLayer[z]?.[x] ?? TILE_EMPTY) === TILE_EMPTY) continue;
                entries.push({ x, z, tint });
            }
        }

        if (entries.length === 0) continue;
        lines.push(`=== ${sectionPrefix}_${layerIndex} ===`);
        entries.forEach(entry => lines.push(`${entry.x},${entry.z}:${entry.tint}`));
        lines.push("");
    }
}

// =============================================================================
// SERIALIZATION - AreaData to Text
// =============================================================================

export function areaDataToText(area: AreaData): string {
    const lines: string[] = [];
    const terrainLayers = normalizeTileLayerStack(area.terrainLayers ?? [area.terrain], area.gridWidth, area.gridHeight, TILE_EMPTY);
    const floorLayers = normalizeTileLayerStack(area.floorLayers ?? [area.floor], area.gridWidth, area.gridHeight, TILE_EMPTY);
    const terrainTintLayers = normalizeTintLayerStack(area.terrainTintLayers, terrainLayers.length, area.gridWidth, area.gridHeight);
    const floorTintLayers = normalizeTintLayerStack(area.floorTintLayers, floorLayers.length, area.gridWidth, area.gridHeight);

    // Metadata
    lines.push(`=== AREA: ${area.id} ===`);
    lines.push(`name: ${area.name}`);
    lines.push(`flavor: ${area.flavor}`);
    lines.push(`size: ${area.gridWidth}x${area.gridHeight}`);
    lines.push(`background: ${area.backgroundColor}`);
    lines.push(`ground: ${area.groundColor}`);
    lines.push(`ambient: ${area.ambientLight}`);
    lines.push(`directional: ${area.directionalLight}`);
    lines.push(`fog: ${area.hasFogOfWar}`);
    if (area.invulnerable) lines.push(`invulnerable: true`);
    lines.push(`spawn: ${area.defaultSpawn.x},${area.defaultSpawn.z}`);
    lines.push("");

    // Geometry grid
    lines.push("=== GEOMETRY ===");
    area.geometry.forEach(row => lines.push(row.join("")));
    lines.push("");

    // Terrain grid
    lines.push("=== TERRAIN ===");
    area.terrain.forEach(row => lines.push(row.join("")));
    lines.push("");

    // Floor grid
    lines.push("=== FLOOR ===");
    area.floor.forEach(row => lines.push(row.join("")));
    lines.push("");

    // Optional explicit layer stacks
    if (terrainLayers.length > 1) {
        terrainLayers.forEach((layer, index) => {
            lines.push(`=== TERRAIN_LAYER_${index} ===`);
            layer.forEach(row => lines.push(row.join("")));
            lines.push("");
        });
    }
    if (floorLayers.length > 1) {
        floorLayers.forEach((layer, index) => {
            lines.push(`=== FLOOR_LAYER_${index} ===`);
            layer.forEach(row => lines.push(row.join("")));
            lines.push("");
        });
    }

    // Optional sparse tint maps
    writeSparseTintSections(lines, "TERRAIN_TINT_LAYER", terrainTintLayers, terrainLayers);
    writeSparseTintSections(lines, "FLOOR_TINT_LAYER", floorTintLayers, floorLayers);

    // Enemies
    if (area.enemySpawns.length > 0) {
        lines.push("=== ENEMIES ===");
        area.enemySpawns.forEach(enemy => {
            lines.push(`${enemy.x},${enemy.z}:${enemy.type}`);
        });
        lines.push("");
    }

    // Chests
    if (area.chests.length > 0) {
        lines.push("=== CHESTS ===");
        area.chests.forEach(chest => {
            const parts: string[] = [];
            if (chest.gold) parts.push(`gold=${chest.gold}`);
            if (chest.contents.length > 0) {
                const items = chest.contents.map(c => `${c.itemId}:${c.quantity}`).join(",");
                parts.push(`items=[${items}]`);
            }
            if (chest.locked) parts.push(`locked=${chest.requiredKeyId ?? "true"}`);
            if (chest.decorOnly) parts.push("decorOnly=true");
            lines.push(`${chest.x},${chest.z}:${parts.join(",")}`);
        });
        lines.push("");
    }

    // Transitions
    if (area.transitions.length > 0) {
        lines.push("=== TRANSITIONS ===");
        area.transitions.forEach(trans => {
            lines.push(`${trans.x},${trans.z},${trans.w},${trans.h}:${trans.direction}->${trans.targetArea}@${trans.targetSpawn.x},${trans.targetSpawn.z}`);
        });
        lines.push("");
    }

    // Trees
    if (area.trees.length > 0) {
        lines.push("=== TREES ===");
        area.trees.forEach(tree => {
            const typeSuffix = tree.type && tree.type !== "pine" ? `,${tree.type}` : "";
            lines.push(`${tree.x},${tree.z}:${tree.size}${typeSuffix}`);
        });
        lines.push("");
    }

    // Decorations
    if (area.decorations && area.decorations.length > 0) {
        lines.push("=== DECORATIONS ===");
        area.decorations.forEach(dec => {
            const parts: string[] = [dec.type];
            if (dec.rotation !== undefined) parts.push(`rot=${dec.rotation.toFixed(3)}`);
            if (dec.size !== undefined) parts.push(`size=${dec.size}`);
            lines.push(`${dec.x},${dec.z}:${parts.join(",")}`);
        });
        lines.push("");
    }

    // Secret doors
    if (area.secretDoors && area.secretDoors.length > 0) {
        lines.push("=== SECRET_DOORS ===");
        area.secretDoors.forEach(door => {
            const bw = door.blockingWall;
            let line = `${door.x},${door.z}:blocking=${bw.x},${bw.z},${bw.w},${bw.h}`;
            if (door.hint) line += `,hint=${door.hint}`;
            lines.push(line);
        });
        lines.push("");
    }

    // Editor lights
    if (area.lights && area.lights.length > 0) {
        lines.push("=== LIGHTS ===");
        area.lights.forEach(light => {
            const tint = normalizeHexColor(light.tint, DEFAULT_AREA_LIGHT_TINT);
            const decay = light.decay ?? DEFAULT_AREA_LIGHT_DECAY;
            lines.push(
                `${light.x},${light.z}:radius=${light.radius},angle=${light.angle},tint=${tint},brightness=${light.brightness},height=${light.height},diffusion=${light.diffusion},decay=${decay}`
            );
        });
        lines.push("");
    }

    // Candles
    if (area.candles && area.candles.length > 0) {
        lines.push("=== CANDLES ===");
        area.candles.forEach(candle => {
            const kind = candle.kind === "torch" ? "torch" : "candle";
            const fallbackColor = kind === "torch" ? DEFAULT_TORCH_LIGHT_COLOR : DEFAULT_CANDLE_LIGHT_COLOR;
            const color = normalizeHexColor(candle.lightColor, fallbackColor);
            lines.push(`${candle.x},${candle.z}:dir=${candle.dx},${candle.dz},kind=${kind},color=${color}`);
        });
        lines.push("");
    }

    if (area.dialogs && area.dialogs.length > 0) {
        lines.push("=== DIALOGS ===");
        area.dialogs.forEach(dialog => {
            lines.push(JSON.stringify(dialog));
        });
        lines.push("");
    }

    if (area.dialogTriggers && area.dialogTriggers.length > 0) {
        lines.push("=== DIALOG_TRIGGERS ===");
        area.dialogTriggers.forEach(trigger => {
            lines.push(JSON.stringify(trigger));
        });
        lines.push("");
    }

    return lines.join("\n");
}

// =============================================================================
// PARSING - Text to AreaData
// =============================================================================

export function textToAreaData(text: string): AreaData {
    const parsed = parseTextFormat(text);
    return convertParsedToAreaData(parsed);
}

function parseTextFormat(text: string): ParsedArea {
    const lines = text.split("\n").map(l => l.trimEnd());
    let currentSection = "";
    let lineIndex = 0;

    const result: ParsedArea = {
        metadata: {
            id: "dungeon" as AreaId,
            name: "",
            flavor: "",
            width: GRID_SIZE,
            height: GRID_SIZE,
            background: "#1a1a2e",
            ground: "#2a2a3e",
            ambient: 0.4,
            directional: 0.5,
            fog: true,
            spawnX: 5,
            spawnZ: 5,
        },
        geometry: [],
        terrain: [],
        floor: [],
        terrainLayersByIndex: {},
        floorLayersByIndex: {},
        terrainTintEntriesByIndex: {},
        floorTintEntriesByIndex: {},
        enemies: [],
        chests: [],
        transitions: [],
        trees: [],
        decorations: [],
        secretDoors: [],
        lights: [],
        candles: [],
        dialogs: [],
        dialogTriggers: [],
    };

    while (lineIndex < lines.length) {
        const line = lines[lineIndex];
        lineIndex++;

        if (!line || line.trim() === "") continue;

        // Section headers
        if (line.startsWith("=== AREA:")) {
            const match = line.match(/=== AREA: (\w+) ===/);
            if (match) result.metadata.id = match[1] as AreaId;
            currentSection = "metadata";
            continue;
        }

        if (line.startsWith("===")) {
            const terrainLayerMatch = line.match(/^=== TERRAIN_LAYER_(\d+) ===$/i);
            if (terrainLayerMatch) {
                currentSection = `terrain_layer_${terrainLayerMatch[1]}`;
                continue;
            }

            const floorLayerMatch = line.match(/^=== FLOOR_LAYER_(\d+) ===$/i);
            if (floorLayerMatch) {
                currentSection = `floor_layer_${floorLayerMatch[1]}`;
                continue;
            }

            const terrainTintLayerMatch = line.match(/^=== TERRAIN_TINT_LAYER_(\d+) ===$/i);
            if (terrainTintLayerMatch) {
                currentSection = `terrain_tint_layer_${terrainTintLayerMatch[1]}`;
                continue;
            }

            const floorTintLayerMatch = line.match(/^=== FLOOR_TINT_LAYER_(\d+) ===$/i);
            if (floorTintLayerMatch) {
                currentSection = `floor_tint_layer_${floorTintLayerMatch[1]}`;
                continue;
            }

            const sectionMatch = line.match(/=== (\w+) ===/);
            if (sectionMatch) {
                currentSection = sectionMatch[1].toLowerCase();
            }
            continue;
        }

        // Parse based on current section
        switch (currentSection) {
            case "metadata":
                parseMetadataLine(line, result.metadata);
                break;
            case "geometry":
                result.geometry.push(line.split(""));
                break;
            case "terrain":
                result.terrain.push(line.split(""));
                break;
            case "floor":
                result.floor.push(line.split(""));
                break;
            case "enemies":
                parseEnemyLine(line, result.enemies);
                break;
            case "chests":
                parseChestLine(line, result.chests);
                break;
            case "transitions":
                parseTransitionLine(line, result.transitions);
                break;
            case "trees":
                parseTreeLine(line, result.trees);
                break;
            case "decorations":
                parseDecorationLine(line, result.decorations);
                break;
            case "secret_doors":
                parseSecretDoorLine(line, result.secretDoors);
                break;
            case "lights":
                parseLightLine(line, result.lights);
                break;
            case "candles":
                parseCandleLine(line, result.candles);
                break;
            case "dialogs":
                parseDialogDefinitionLine(line, result.dialogs);
                break;
            case "dialog_triggers":
                parseDialogTriggerLine(line, result.dialogTriggers);
                break;
            default:
                if (currentSection.startsWith("terrain_layer_")) {
                    const index = parseInt(currentSection.slice("terrain_layer_".length), 10);
                    if (Number.isFinite(index)) {
                        if (!result.terrainLayersByIndex[index]) result.terrainLayersByIndex[index] = [];
                        result.terrainLayersByIndex[index].push(line.split(""));
                    }
                } else if (currentSection.startsWith("floor_layer_")) {
                    const index = parseInt(currentSection.slice("floor_layer_".length), 10);
                    if (Number.isFinite(index)) {
                        if (!result.floorLayersByIndex[index]) result.floorLayersByIndex[index] = [];
                        result.floorLayersByIndex[index].push(line.split(""));
                    }
                } else if (currentSection.startsWith("terrain_tint_layer_")) {
                    const index = parseInt(currentSection.slice("terrain_tint_layer_".length), 10);
                    if (Number.isFinite(index)) {
                        if (!result.terrainTintEntriesByIndex[index]) result.terrainTintEntriesByIndex[index] = [];
                        parseTintEntryLine(line, result.terrainTintEntriesByIndex[index]);
                    }
                } else if (currentSection.startsWith("floor_tint_layer_")) {
                    const index = parseInt(currentSection.slice("floor_tint_layer_".length), 10);
                    if (Number.isFinite(index)) {
                        if (!result.floorTintEntriesByIndex[index]) result.floorTintEntriesByIndex[index] = [];
                        parseTintEntryLine(line, result.floorTintEntriesByIndex[index]);
                    }
                }
                break;
        }
    }

    return result;
}

function parseMetadataLine(line: string, metadata: ParsedArea["metadata"]) {
    const [key, ...valueParts] = line.split(":");
    const value = valueParts.join(":").trim();

    switch (key.trim()) {
        case "name":
            metadata.name = value;
            break;
        case "flavor":
            metadata.flavor = value;
            break;
        case "size": {
            const [w, h] = value.split("x").map(Number);
            metadata.width = w;
            metadata.height = h;
            break;
        }
        case "background":
            metadata.background = value;
            break;
        case "ground":
            metadata.ground = value;
            break;
        case "ambient":
            metadata.ambient = parseFloat(value);
            break;
        case "directional":
            metadata.directional = parseFloat(value);
            break;
        case "fog":
            metadata.fog = value === "true";
            break;
        case "invulnerable":
            metadata.invulnerable = value === "true";
            break;
        case "spawn": {
            const [x, z] = value.split(",").map(Number);
            metadata.spawnX = x;
            metadata.spawnZ = z;
            break;
        }
    }
}

function parseEnemyLine(line: string, enemies: EnemySpawn[]) {
    const [coords, type] = line.split(":");
    const [x, z] = coords.split(",").map(Number);
    enemies.push({ x, z, type: type as EnemyType });
}

function parseChestLine(line: string, chests: ChestLocation[]) {
    const [coords, props] = line.split(":");
    const [x, z] = coords.split(",").map(Number);
    const propsText = props ?? "";

    const chest: ChestLocation = { x, z, contents: [] };

    // Parse properties
    const goldMatch = propsText.match(/gold=(\d+)/);
    if (goldMatch) chest.gold = parseInt(goldMatch[1]);

    const itemsMatch = propsText.match(/items=\[([^\]]*)\]/);
    if (itemsMatch && itemsMatch[1]) {
        const items = itemsMatch[1].split(",");
        for (const item of items) {
            const [itemId, qty] = item.split(":");
            chest.contents.push({ itemId, quantity: parseInt(qty) || 1 });
        }
    }

    const lockedMatch = propsText.match(/locked=(\w+)/);
    if (lockedMatch) {
        chest.locked = true;
        if (lockedMatch[1] !== "true") {
            chest.requiredKeyId = lockedMatch[1];
        }
    }

    if (/decorOnly=(true|1)/i.test(propsText)) {
        chest.decorOnly = true;
    }

    chests.push(chest);
}

function parseTransitionLine(line: string, transitions: AreaTransition[]) {
    // Format: x,z,w,h:direction->targetArea@spawnX,spawnZ
    const [coords, rest] = line.split(":");
    const [x, z, w, h] = coords.split(",").map(Number);

    const dirMatch = rest.match(/(\w+)->(\w+)@([\d.]+),([\d.]+)/);
    if (dirMatch) {
        transitions.push({
            x, z, w, h,
            direction: dirMatch[1] as "north" | "south" | "east" | "west",
            targetArea: dirMatch[2] as AreaId,
            targetSpawn: { x: parseFloat(dirMatch[3]), z: parseFloat(dirMatch[4]) }
        });
    }
}

function parseTreeLine(line: string, trees: TreeLocation[]) {
    const [coords, rest] = line.split(":");
    const [x, z] = coords.split(",").map(Number);
    const parts = rest.split(",");
    const size = parseFloat(parts[0]);
    const type = parts[1] as TreeType | undefined;
    trees.push({ x, z, size, ...(type ? { type } : {}) });
}

function parseDecorationLine(line: string, decorations: Decoration[]) {
    const [coords, props] = line.split(":");
    const [x, z] = coords.split(",").map(Number);

    const parts = props.split(",");
    const type = parts[0] as Decoration["type"];

    const dec: Decoration = { x, z, type };

    for (const part of parts.slice(1)) {
        const [key, val] = part.split("=");
        if (key === "rot") dec.rotation = parseFloat(val);
        if (key === "size") dec.size = parseFloat(val);
    }

    decorations.push(dec);
}

function parseSecretDoorLine(line: string, secretDoors: SecretDoor[]) {
    const [coords, props] = line.split(":");
    const [x, z] = coords.split(",").map(Number);

    const blockingMatch = props.match(/blocking=([\d,]+)/);
    if (blockingMatch) {
        const [bx, bz, bw, bh] = blockingMatch[1].split(",").map(Number);
        const door: SecretDoor = {
            x, z,
            blockingWall: { x: bx, z: bz, w: bw, h: bh }
        };

        const hintMatch = props.match(/hint=(.+)$/);
        if (hintMatch) door.hint = hintMatch[1];

        secretDoors.push(door);
    }
}

function parseCandleLine(line: string, candles: CandlePosition[]) {
    const [coords, props] = line.split(":");
    const [x, z] = coords.split(",").map(Number);

    const dirMatch = props.match(/dir=([\d.-]+),([\d.-]+)/);
    if (dirMatch) {
        const kindMatch = props.match(/kind=(candle|torch)/);
        const colorMatch = props.match(/color=(#[0-9a-fA-F]{6})/);
        const kind = kindMatch?.[1] === "torch" ? "torch" : "candle";
        const fallbackColor = kind === "torch" ? DEFAULT_TORCH_LIGHT_COLOR : DEFAULT_CANDLE_LIGHT_COLOR;
        candles.push({
            x, z,
            dx: parseFloat(dirMatch[1]),
            dz: parseFloat(dirMatch[2]),
            kind,
            lightColor: normalizeHexColor(colorMatch?.[1], fallbackColor),
        });
    }
}

function parseLightLine(line: string, lights: AreaLight[]) {
    const [coords, props] = line.split(":");
    if (!coords || !props) return;
    const [xStr, zStr] = coords.split(",");
    const x = parseFloat(xStr);
    const z = parseFloat(zStr);
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;

    const defaults: AreaLight = {
        x,
        z,
        radius: DEFAULT_AREA_LIGHT_RADIUS,
        angle: DEFAULT_AREA_LIGHT_ANGLE,
        tint: DEFAULT_AREA_LIGHT_TINT,
        brightness: DEFAULT_AREA_LIGHT_BRIGHTNESS,
        height: DEFAULT_AREA_LIGHT_HEIGHT,
        diffusion: DEFAULT_AREA_LIGHT_DIFFUSION,
        decay: DEFAULT_AREA_LIGHT_DECAY,
    };

    const propsMap = new Map<string, string>();
    for (const part of props.split(",")) {
        const [k, v] = part.split("=");
        if (!k || v === undefined) continue;
        propsMap.set(k.trim().toLowerCase(), v.trim());
    }

    const toNumber = (key: string, fallback: number): number => {
        const raw = propsMap.get(key);
        if (raw === undefined) return fallback;
        const parsed = parseFloat(raw);
        return Number.isFinite(parsed) ? parsed : fallback;
    };

    lights.push({
        x,
        z,
        radius: toNumber("radius", defaults.radius),
        angle: toNumber("angle", defaults.angle),
        tint: normalizeHexColor(propsMap.get("tint"), defaults.tint),
        brightness: toNumber("brightness", defaults.brightness),
        height: toNumber("height", defaults.height),
        diffusion: toNumber("diffusion", defaults.diffusion),
        decay: toNumber("decay", defaults.decay ?? DEFAULT_AREA_LIGHT_DECAY),
    });
}

const DIALOG_SPEAKER_IDS = new Set<string>(Object.keys(DIALOG_SPEAKERS));
const DIALOG_MENU_IDS = new Set<AreaDialogMenuId>(["controls", "save_game", "load_game"]);

function isDialogSpeakerId(value: string): value is DialogSpeakerId {
    return DIALOG_SPEAKER_IDS.has(value);
}

function sanitizeAreaDialogUiAction(raw: unknown): AreaDialogUiAction | undefined {
    if (!isRecord(raw)) return undefined;
    if (raw.type !== "open_menu") return undefined;
    if (typeof raw.menuId !== "string") return undefined;
    if (!DIALOG_MENU_IDS.has(raw.menuId as AreaDialogMenuId)) return undefined;
    return {
        type: "open_menu",
        menuId: raw.menuId as AreaDialogMenuId,
    };
}

function sanitizeAreaDialogChoice(raw: unknown): AreaDialogChoice | null {
    if (!isRecord(raw)) return null;
    if (typeof raw.id !== "string" || raw.id.trim().length === 0) return null;
    if (typeof raw.label !== "string") return null;

    const nextNodeId = typeof raw.nextNodeId === "string" && raw.nextNodeId.trim().length > 0
        ? raw.nextNodeId.trim()
        : undefined;
    const onDialogEndAction = sanitizeAreaDialogUiAction(raw.onDialogEndAction);

    return {
        id: raw.id.trim(),
        label: raw.label,
        ...(nextNodeId ? { nextNodeId } : {}),
        ...(onDialogEndAction ? { onDialogEndAction } : {}),
    };
}

function sanitizeAreaDialogNode(raw: unknown): AreaDialogNode | null {
    if (!isRecord(raw)) return null;
    if (typeof raw.id !== "string" || raw.id.trim().length === 0) return null;
    if (typeof raw.speakerId !== "string" || !isDialogSpeakerId(raw.speakerId)) return null;
    if (typeof raw.text !== "string") return null;

    const nextNodeId = typeof raw.nextNodeId === "string" && raw.nextNodeId.trim().length > 0
        ? raw.nextNodeId.trim()
        : undefined;
    const continueLabel = typeof raw.continueLabel === "string" && raw.continueLabel.trim().length > 0
        ? raw.continueLabel
        : undefined;
    const onDialogEndAction = sanitizeAreaDialogUiAction(raw.onDialogEndAction);

    const choices = Array.isArray(raw.choices)
        ? raw.choices
            .map(choice => sanitizeAreaDialogChoice(choice))
            .filter((choice): choice is AreaDialogChoice => choice !== null)
        : [];

    return {
        id: raw.id.trim(),
        speakerId: raw.speakerId,
        text: raw.text,
        ...(choices.length > 0 ? { choices } : {}),
        ...(nextNodeId ? { nextNodeId } : {}),
        ...(continueLabel ? { continueLabel } : {}),
        ...(onDialogEndAction ? { onDialogEndAction } : {}),
    };
}

function sanitizeAreaDialogDefinition(raw: unknown): AreaDialogDefinition | null {
    if (!isRecord(raw)) return null;
    if (typeof raw.id !== "string" || raw.id.trim().length === 0) return null;
    if (typeof raw.startNodeId !== "string" || raw.startNodeId.trim().length === 0) return null;
    if (!isRecord(raw.nodes)) return null;

    const nodes: Record<string, AreaDialogNode> = {};
    for (const nodeRaw of Object.values(raw.nodes)) {
        const node = sanitizeAreaDialogNode(nodeRaw);
        if (!node) continue;
        nodes[node.id] = node;
    }

    const nodeIds = Object.keys(nodes);
    if (nodeIds.length === 0) return null;

    const requestedStartNodeId = raw.startNodeId.trim();
    const startNodeId = nodes[requestedStartNodeId] ? requestedStartNodeId : nodeIds[0];

    return {
        id: raw.id.trim(),
        startNodeId,
        nodes,
    };
}

function parseDialogDefinitionLine(line: string, dialogs: AreaDialogDefinition[]): void {
    try {
        const parsed = JSON.parse(line) as unknown;
        const dialogDefinition = sanitizeAreaDialogDefinition(parsed);
        if (!dialogDefinition) return;
        dialogs.push(dialogDefinition);
    } catch {
        if (import.meta.env.DEV) {
            console.warn(`[areaTextFormat] Failed to parse dialog definition line: ${line}`);
        }
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function toOptionalFiniteNumber(value: unknown): number | undefined {
    if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
    return value;
}

function toNonNegativeInt(value: unknown): number | null {
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    const rounded = Math.floor(value);
    return rounded >= 0 ? rounded : null;
}

function sanitizeDialogTriggerCondition(raw: unknown): AreaDialogTriggerCondition | null {
    if (!isRecord(raw)) return null;
    const conditionType = raw.type;
    if (typeof conditionType !== "string") return null;

    if (conditionType === "on_area_load") {
        return { type: "on_area_load" };
    }

    if (conditionType === "enemy_killed") {
        const spawnIndex = toNonNegativeInt(raw.spawnIndex);
        if (spawnIndex === null) return null;
        return { type: "enemy_killed", spawnIndex };
    }

    if (conditionType === "party_enters_region") {
        const x = toNonNegativeInt(raw.x);
        const z = toNonNegativeInt(raw.z);
        const w = toNonNegativeInt(raw.w);
        const h = toNonNegativeInt(raw.h);
        if (x === null || z === null || w === null || h === null) return null;
        return {
            type: "party_enters_region",
            x,
            z,
            w: Math.max(1, w),
            h: Math.max(1, h),
        };
    }

    if (conditionType === "unit_seen") {
        const spawnIndex = toNonNegativeInt(raw.spawnIndex);
        if (spawnIndex === null) return null;
        const rawRange = toOptionalFiniteNumber(raw.range);
        const range = rawRange !== undefined ? Math.max(0.1, rawRange) : undefined;
        return { type: "unit_seen", spawnIndex, ...(range !== undefined ? { range } : {}) };
    }

    if (conditionType === "party_out_of_combat_range") {
        const range = toOptionalFiniteNumber(raw.range);
        if (range === undefined) return null;
        return { type: "party_out_of_combat_range", range: Math.max(0.1, range) };
    }

    if (conditionType === "after_delay") {
        const ms = toNonNegativeInt(raw.ms);
        if (ms === null) return null;
        return { type: "after_delay", ms };
    }

    return null;
}

function sanitizeDialogTrigger(raw: unknown): AreaDialogTrigger | null {
    if (!isRecord(raw)) return null;
    if (typeof raw.id !== "string" || raw.id.trim().length === 0) return null;
    if (typeof raw.dialogId !== "string" || raw.dialogId.trim().length === 0) return null;
    if (!Array.isArray(raw.conditions)) return null;

    const conditions: AreaDialogTriggerCondition[] = raw.conditions
        .map(condition => sanitizeDialogTriggerCondition(condition))
        .filter((condition): condition is AreaDialogTriggerCondition => condition !== null);
    if (conditions.length === 0) return null;

    const once = typeof raw.once === "boolean" ? raw.once : undefined;
    const priority = toOptionalFiniteNumber(raw.priority);

    return {
        id: raw.id.trim(),
        dialogId: raw.dialogId.trim(),
        ...(once !== undefined ? { once } : {}),
        ...(priority !== undefined ? { priority } : {}),
        conditions,
    };
}

function parseDialogTriggerLine(line: string, dialogTriggers: AreaDialogTrigger[]): void {
    try {
        const parsed = JSON.parse(line) as unknown;
        const trigger = sanitizeDialogTrigger(parsed);
        if (!trigger) return;
        dialogTriggers.push(trigger);
    } catch {
        if (import.meta.env.DEV) {
            console.warn(`[areaTextFormat] Failed to parse dialog trigger line: ${line}`);
        }
    }
}

function parseTintEntryLine(line: string, entries: Array<{ x: number; z: number; tint: number }>): void {
    const [coords, tintRaw] = line.split(":");
    if (!coords || tintRaw === undefined) return;
    const [xStr, zStr] = coords.split(",");
    const x = parseInt(xStr, 10);
    const z = parseInt(zStr, 10);
    const tint = clampTileTintPercent(parseInt(tintRaw, 10));
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    entries.push({ x, z, tint });
}

function convertParsedToAreaData(parsed: ParsedArea): AreaData {
    const fallbackTerrain = parsed.terrain.length > 0
        ? parsed.terrain
        : Array.from({ length: parsed.metadata.height }, () =>
            Array(parsed.metadata.width).fill(TILE_EMPTY)
        );
    const fallbackFloor = parsed.floor.length > 0
        ? parsed.floor
        : Array.from({ length: parsed.metadata.height }, () =>
            Array(parsed.metadata.width).fill(TILE_EMPTY)
        );

    const explicitTerrainLayers = Object.entries(parsed.terrainLayersByIndex)
        .map(([index, layer]) => ({ index: parseInt(index, 10), layer }))
        .filter(entry => Number.isFinite(entry.index))
        .sort((a, b) => a.index - b.index)
        .map(entry => entry.layer);
    const explicitFloorLayers = Object.entries(parsed.floorLayersByIndex)
        .map(([index, layer]) => ({ index: parseInt(index, 10), layer }))
        .filter(entry => Number.isFinite(entry.index))
        .sort((a, b) => a.index - b.index)
        .map(entry => entry.layer);

    const terrainLayers = normalizeTileLayerStack(
        explicitTerrainLayers.length > 0 ? explicitTerrainLayers : [fallbackTerrain],
        parsed.metadata.width,
        parsed.metadata.height,
        TILE_EMPTY
    );
    const floorLayers = normalizeTileLayerStack(
        explicitFloorLayers.length > 0 ? explicitFloorLayers : [fallbackFloor],
        parsed.metadata.width,
        parsed.metadata.height,
        TILE_EMPTY
    );

    const terrainTintLayers = buildTintLayersFromEntries(
        parsed.terrainTintEntriesByIndex,
        terrainLayers.length,
        parsed.metadata.width,
        parsed.metadata.height
    );
    const floorTintLayers = buildTintLayersFromEntries(
        parsed.floorTintEntriesByIndex,
        floorLayers.length,
        parsed.metadata.width,
        parsed.metadata.height
    );

    const terrain = composeTileLayers(terrainLayers, parsed.metadata.width, parsed.metadata.height, TILE_EMPTY);
    const floor = composeTileLayers(floorLayers, parsed.metadata.width, parsed.metadata.height, TILE_EMPTY);
    const hasLayeredTerrain = terrainLayers.length > 1 || hasTintData(terrainTintLayers);
    const hasLayeredFloor = floorLayers.length > 1 || hasTintData(floorTintLayers);

    return {
        id: parsed.metadata.id,
        name: parsed.metadata.name,
        flavor: parsed.metadata.flavor,
        gridSize: Math.max(parsed.metadata.width, parsed.metadata.height),
        gridWidth: parsed.metadata.width,
        gridHeight: parsed.metadata.height,
        backgroundColor: parsed.metadata.background,
        groundColor: parsed.metadata.ground,
        ambientLight: parsed.metadata.ambient,
        directionalLight: parsed.metadata.directional,
        hasFogOfWar: parsed.metadata.fog,
        invulnerable: parsed.metadata.invulnerable || undefined,
        defaultSpawn: { x: parsed.metadata.spawnX, z: parsed.metadata.spawnZ },
        geometry: parsed.geometry,
        terrain,
        floor,
        terrainLayers: hasLayeredTerrain ? terrainLayers : undefined,
        floorLayers: hasLayeredFloor ? floorLayers : undefined,
        terrainTintLayers: hasLayeredTerrain ? terrainTintLayers : undefined,
        floorTintLayers: hasLayeredFloor ? floorTintLayers : undefined,
        enemySpawns: parsed.enemies,
        transitions: parsed.transitions,
        chests: parsed.chests,
        trees: parsed.trees,
        decorations: parsed.decorations.length > 0 ? parsed.decorations : undefined,
        secretDoors: parsed.secretDoors.length > 0 ? parsed.secretDoors : undefined,
        lights: parsed.lights.length > 0 ? parsed.lights : undefined,
        candles: parsed.candles.length > 0 ? parsed.candles : undefined,
        dialogs: parsed.dialogs.length > 0 ? parsed.dialogs : undefined,
        dialogTriggers: parsed.dialogTriggers.length > 0 ? parsed.dialogTriggers : undefined,
    };
}

function buildTintLayersFromEntries(
    entriesByIndex: Record<number, Array<{ x: number; z: number; tint: number }>>,
    layerCount: number,
    width: number,
    height: number
): number[][][] {
    const tintLayers = normalizeTintLayerStack(undefined, layerCount, width, height);
    for (const [indexRaw, entries] of Object.entries(entriesByIndex)) {
        const layerIndex = parseInt(indexRaw, 10);
        if (!Number.isFinite(layerIndex) || layerIndex < 0 || layerIndex >= tintLayers.length) continue;
        const layer = tintLayers[layerIndex];
        entries.forEach(entry => {
            if (entry.x < 0 || entry.x >= width || entry.z < 0 || entry.z >= height) return;
            layer[entry.z][entry.x] = clampTileTintPercent(entry.tint);
        });
    }
    return tintLayers;
}
