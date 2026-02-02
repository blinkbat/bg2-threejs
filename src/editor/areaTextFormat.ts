// =============================================================================
// AREA TEXT FORMAT - Parser and serializer for human-readable map format
// =============================================================================

import { GRID_SIZE } from "../core/constants";
import type { AreaData, AreaId, RoomFloor, EnemySpawn, AreaTransition, ChestLocation, TreeLocation, Decoration, SecretDoor, LavaZone } from "../game/areas/types";
import type { Room, CandlePosition, EnemyType } from "../core/types";

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
// === FLOOR_COLORS ===
// x,z,w,h:color
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
    floorColors: RoomFloor[];
    enemies: EnemySpawn[];
    chests: ChestLocation[];
    transitions: AreaTransition[];
    trees: TreeLocation[];
    decorations: Decoration[];
    secretDoors: SecretDoor[];
    candles: CandlePosition[];
    lavaZones: LavaZone[];
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

    // Compute geometry grid from rooms and hallways
    const geometry = computeGeometryGrid(area.rooms, area.hallways, size, area.transitions);
    lines.push("=== GEOMETRY ===");
    geometry.forEach(row => lines.push(row.join("")));
    lines.push("");

    // Terrain layer (lava zones)
    const terrain = computeTerrainGrid(area.lavaZones ?? [], size);
    lines.push("=== TERRAIN ===");
    terrain.forEach(row => lines.push(row.join("")));
    lines.push("");

    // Floor colors
    if (area.roomFloors.length > 0) {
        lines.push("=== FLOOR_COLORS ===");
        area.roomFloors.forEach(floor => {
            lines.push(`${floor.x},${floor.z},${floor.w},${floor.h}:${floor.color}`);
        });
        lines.push("");
    }

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

function computeGeometryGrid(rooms: Room[], hallways: { x1: number; z1: number; x2: number; z2: number }[], size: number, transitions: AreaTransition[]): string[][] {
    // Start with all walls
    const grid: string[][] = Array.from({ length: size }, () => Array(size).fill("#"));

    // Carve out rooms
    for (const room of rooms) {
        for (let z = room.z; z < room.z + room.h && z < size; z++) {
            for (let x = room.x; x < room.x + room.w && x < size; x++) {
                if (x >= 0 && z >= 0) {
                    grid[z][x] = ".";
                }
            }
        }
    }

    // Carve out hallways
    for (const hall of hallways) {
        const minX = Math.min(hall.x1, hall.x2);
        const maxX = Math.max(hall.x1, hall.x2);
        const minZ = Math.min(hall.z1, hall.z2);
        const maxZ = Math.max(hall.z1, hall.z2);

        for (let z = minZ; z <= maxZ && z < size; z++) {
            for (let x = minX; x <= maxX && x < size; x++) {
                if (x >= 0 && z >= 0) {
                    grid[z][x] = ".";
                }
            }
        }
    }

    // Mark transitions with door characters
    for (const trans of transitions) {
        const doorChar = trans.direction === "north" ? "^" :
                         trans.direction === "south" ? "v" :
                         trans.direction === "east" ? ">" : "<";

        for (let dz = 0; dz < trans.h; dz++) {
            for (let dx = 0; dx < trans.w; dx++) {
                const x = trans.x + dx;
                const z = trans.z + dz;
                if (x >= 0 && x < size && z >= 0 && z < size) {
                    grid[z][x] = doorChar;
                }
            }
        }
    }

    return grid;
}

function computeTerrainGrid(lavaZones: LavaZone[], size: number): string[][] {
    const grid: string[][] = Array.from({ length: size }, () => Array(size).fill("."));

    for (const zone of lavaZones) {
        for (let z = zone.z; z < zone.z + zone.h && z < size; z++) {
            for (let x = zone.x; x < zone.x + zone.w && x < size; x++) {
                if (x >= 0 && z >= 0) {
                    grid[z][x] = "~";
                }
            }
        }
    }

    return grid;
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
        floorColors: [],
        enemies: [],
        chests: [],
        transitions: [],
        trees: [],
        decorations: [],
        secretDoors: [],
        candles: [],
        lavaZones: [],
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
            case "floor_colors":
                parseFloorColorLine(line, result.floorColors);
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

function parseFloorColorLine(line: string, floors: RoomFloor[]) {
    const [coords, color] = line.split(":");
    const [x, z, w, h] = coords.split(",").map(Number);
    floors.push({ x, z, w, h, color });
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
    // Extract rooms from geometry grid
    const { rooms, hallways } = extractRoomsFromGeometry(parsed.geometry);

    // Extract lava zones from terrain grid
    const lavaZones = extractLavaFromTerrain(parsed.terrain);

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
        rooms,
        hallways,
        roomFloors: parsed.floorColors,
        enemySpawns: parsed.enemies,
        transitions: parsed.transitions,
        chests: parsed.chests,
        trees: parsed.trees,
        decorations: parsed.decorations.length > 0 ? parsed.decorations : undefined,
        secretDoors: parsed.secretDoors.length > 0 ? parsed.secretDoors : undefined,
        candles: parsed.candles.length > 0 ? parsed.candles : undefined,
        lavaZones: lavaZones.length > 0 ? lavaZones : undefined,
    };
}

function extractRoomsFromGeometry(geometry: string[][]): { rooms: Room[]; hallways: { x1: number; z1: number; x2: number; z2: number }[] } {
    if (geometry.length === 0) return { rooms: [], hallways: [] };

    const height = geometry.length;
    const width = geometry[0].length;

    // Find all walkable cells (., ^, v, <, >)
    const walkable: boolean[][] = Array.from({ length: height }, () => Array(width).fill(false));

    for (let z = 0; z < height; z++) {
        for (let x = 0; x < width; x++) {
            const char = geometry[z]?.[x] ?? "#";
            walkable[z][x] = char !== "#";
        }
    }

    // Extract rectangular regions using greedy algorithm
    const visited: boolean[][] = Array.from({ length: height }, () => Array(width).fill(false));
    const rooms: Room[] = [];

    for (let z = 0; z < height; z++) {
        for (let x = 0; x < width; x++) {
            if (walkable[z][x] && !visited[z][x]) {
                // Find the largest rectangle starting at this point
                const rect = findLargestRect(walkable, visited, x, z, width, height);
                if (rect.w >= 2 && rect.h >= 2) {
                    rooms.push(rect);
                    // Mark as visited
                    for (let rz = rect.z; rz < rect.z + rect.h; rz++) {
                        for (let rx = rect.x; rx < rect.x + rect.w; rx++) {
                            visited[rz][rx] = true;
                        }
                    }
                }
            }
        }
    }

    // Any remaining unvisited walkable cells become small rooms
    for (let z = 0; z < height; z++) {
        for (let x = 0; x < width; x++) {
            if (walkable[z][x] && !visited[z][x]) {
                rooms.push({ x, z, w: 1, h: 1 });
                visited[z][x] = true;
            }
        }
    }

    return { rooms, hallways: [] };
}

function findLargestRect(walkable: boolean[][], visited: boolean[][], startX: number, startZ: number, maxWidth: number, maxHeight: number): Room {
    // Expand right as far as possible
    let w = 0;
    while (startX + w < maxWidth && walkable[startZ][startX + w] && !visited[startZ][startX + w]) {
        w++;
    }

    // Expand down as far as possible while maintaining width
    let h = 1;
    outer: while (startZ + h < maxHeight) {
        for (let x = startX; x < startX + w; x++) {
            if (!walkable[startZ + h][x] || visited[startZ + h][x]) {
                break outer;
            }
        }
        h++;
    }

    return { x: startX, z: startZ, w, h };
}

function extractLavaFromTerrain(terrain: string[][]): LavaZone[] {
    if (terrain.length === 0) return [];

    const height = terrain.length;
    const width = terrain[0].length;
    const visited: boolean[][] = Array.from({ length: height }, () => Array(width).fill(false));
    const zones: LavaZone[] = [];

    for (let z = 0; z < height; z++) {
        for (let x = 0; x < width; x++) {
            if (terrain[z][x] === "~" && !visited[z][x]) {
                // Find rectangle of lava
                let w = 0;
                while (x + w < width && terrain[z][x + w] === "~" && !visited[z][x + w]) {
                    w++;
                }

                let h = 1;
                outer: while (z + h < height) {
                    for (let dx = 0; dx < w; dx++) {
                        if (terrain[z + h][x + dx] !== "~" || visited[z + h][x + dx]) {
                            break outer;
                        }
                    }
                    h++;
                }

                zones.push({ x, z, w, h });

                for (let dz = 0; dz < h; dz++) {
                    for (let dx = 0; dx < w; dx++) {
                        visited[z + dz][x + dx] = true;
                    }
                }
            }
        }
    }

    return zones;
}
