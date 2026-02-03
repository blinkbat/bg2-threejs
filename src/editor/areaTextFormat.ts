// =============================================================================
// AREA TEXT FORMAT - Parser and serializer for human-readable map format
// =============================================================================

import { GRID_SIZE } from "../core/constants";
import type { AreaData, AreaId, EnemySpawn, AreaTransition, ChestLocation, TreeLocation, Decoration, SecretDoor } from "../game/areas/types";
import type { CandlePosition, EnemyType } from "../core/types";

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
// === ENEMIES ===
// x,z:enemy_type
//
// === CHESTS ===
// x,z:gold=N,items=[itemId:qty,...]
// x,z:gold=N,items=[...],locked=keyId
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
// === CANDLES ===
// x,z:dir=dx,dz
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
        spawnX: number;
        spawnZ: number;
    };
    geometry: string[][];
    terrain: string[][];
    floor: string[][];
    enemies: EnemySpawn[];
    chests: ChestLocation[];
    transitions: AreaTransition[];
    trees: TreeLocation[];
    decorations: Decoration[];
    secretDoors: SecretDoor[];
    candles: CandlePosition[];
}

// =============================================================================
// SERIALIZATION - AreaData to Text
// =============================================================================

export function areaDataToText(area: AreaData): string {
    const lines: string[] = [];
    const size = area.gridSize;

    // Metadata
    lines.push(`=== AREA: ${area.id} ===`);
    lines.push(`name: ${area.name}`);
    lines.push(`flavor: ${area.flavor}`);
    lines.push(`size: ${size}x${size}`);
    lines.push(`background: ${area.backgroundColor}`);
    lines.push(`ground: ${area.groundColor}`);
    lines.push(`ambient: ${area.ambientLight}`);
    lines.push(`directional: ${area.directionalLight}`);
    lines.push(`fog: ${area.hasFogOfWar}`);
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
            lines.push(`${tree.x},${tree.z}:${tree.size}`);
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

    // Candles
    if (area.candles && area.candles.length > 0) {
        lines.push("=== CANDLES ===");
        area.candles.forEach(candle => {
            lines.push(`${candle.x},${candle.z}:dir=${candle.dx},${candle.dz}`);
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
        enemies: [],
        chests: [],
        transitions: [],
        trees: [],
        decorations: [],
        secretDoors: [],
        candles: [],
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
            case "candles":
                parseCandleLine(line, result.candles);
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

    const chest: ChestLocation = { x, z, contents: [] };

    // Parse properties
    const goldMatch = props.match(/gold=(\d+)/);
    if (goldMatch) chest.gold = parseInt(goldMatch[1]);

    const itemsMatch = props.match(/items=\[([^\]]*)\]/);
    if (itemsMatch && itemsMatch[1]) {
        const items = itemsMatch[1].split(",");
        for (const item of items) {
            const [itemId, qty] = item.split(":");
            chest.contents.push({ itemId, quantity: parseInt(qty) || 1 });
        }
    }

    const lockedMatch = props.match(/locked=(\w+)/);
    if (lockedMatch) {
        chest.locked = true;
        if (lockedMatch[1] !== "true") {
            chest.requiredKeyId = lockedMatch[1];
        }
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
    const [coords, size] = line.split(":");
    const [x, z] = coords.split(",").map(Number);
    trees.push({ x, z, size: parseFloat(size) });
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
        candles.push({
            x, z,
            dx: parseFloat(dirMatch[1]),
            dz: parseFloat(dirMatch[2])
        });
    }
}

function convertParsedToAreaData(parsed: ParsedArea): AreaData {
    // Create default floor grid if not defined
    const floor = parsed.floor.length > 0
        ? parsed.floor
        : Array.from({ length: parsed.metadata.height }, () =>
            Array(parsed.metadata.width).fill(".")
        );

    return {
        id: parsed.metadata.id,
        name: parsed.metadata.name,
        flavor: parsed.metadata.flavor,
        gridSize: parsed.metadata.width,
        backgroundColor: parsed.metadata.background,
        groundColor: parsed.metadata.ground,
        ambientLight: parsed.metadata.ambient,
        directionalLight: parsed.metadata.directional,
        hasFogOfWar: parsed.metadata.fog,
        defaultSpawn: { x: parsed.metadata.spawnX, z: parsed.metadata.spawnZ },
        geometry: parsed.geometry,
        terrain: parsed.terrain,
        floor,
        enemySpawns: parsed.enemies,
        transitions: parsed.transitions,
        chests: parsed.chests,
        trees: parsed.trees,
        decorations: parsed.decorations.length > 0 ? parsed.decorations : undefined,
        secretDoors: parsed.secretDoors.length > 0 ? parsed.secretDoors : undefined,
        candles: parsed.candles.length > 0 ? parsed.candles : undefined,
    };
}
