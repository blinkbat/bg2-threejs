import { useState, useRef, useCallback, useEffect } from "react";
import { Link } from "react-router-dom";
import Tippy from "@tippyjs/react";
import {
    DEFAULT_AREA_LIGHT_ANGLE,
    DEFAULT_AREA_LIGHT_BRIGHTNESS,
    DEFAULT_AREA_LIGHT_DECAY,
    DEFAULT_AREA_LIGHT_DIFFUSION,
    DEFAULT_AREA_LIGHT_HEIGHT,
    DEFAULT_AREA_LIGHT_RADIUS,
    DEFAULT_AREA_LIGHT_TINT,
    MAX_PINE_TREE_SIZE,
    MAX_TREE_SIZE,
    MIN_TREE_SIZE,
    type AreaId,
    type AreaData,
    type EnemySpawn,
    type AreaTransition,
    type ChestLocation,
    type TreeLocation,
    type Decoration,
    type AreaLight,
} from "../game/areas/types";
import { AREAS } from "../game/areas";
import { areaDataToText } from "./areaTextFormat";
import { DEFAULT_CANDLE_LIGHT_COLOR, DEFAULT_TORCH_LIGHT_COLOR } from "../core/constants";

// Editor modules
import type { Tool, Layer, MapMetadata, EntityDef, TreeDef, DecorationDef, EditorSnapshot } from "./types";
import { getAvailableAreaIds, BASE_CELL_SIZE, MAX_HISTORY, LAYER_COLORS, LAYER_BRUSHES, PROP_TYPE_TO_CHAR, PROP_CHAR_TO_TYPE, PROP_TREE_CHARS, PROP_CHAR_TO_TREE_TYPE, PROP_TREE_TYPE_TO_CHAR } from "./constants";
import { registerAreaFromText } from "../game/areas";
import { EntityEditPopup, TreeEditPopup, DecorationEditPopup } from "./popups";
import { ConnectionsPanel } from "./panels";

function getCharColor(char: string, layer: Layer): string {
    return LAYER_COLORS[layer].get(char) ?? "#666";
}

function getLayerColor(layer: Layer): string {
    switch (layer) {
        case "geometry": return "#888";
        case "terrain": return "#f80";
        case "floor": return "#a86";
        case "props": return "#4a4";
        case "entities": return "#f44";
    }
}

function drawLayer(ctx: CanvasRenderingContext2D, layer: string[][], layerType: Layer, cellSize: number): void {
    for (let z = 0; z < layer.length; z++) {
        for (let x = 0; x < layer[z].length; x++) {
            const char = layer[z][x];
            if (char === ".") continue;

            const color = getCharColor(char, layerType);
            ctx.fillStyle = color;
            ctx.fillRect(x * cellSize + 1, z * cellSize + 1, cellSize - 2, cellSize - 2);

            // Draw char label (skip for floor layer - just show color)
            if (layerType !== "floor") {
                ctx.fillStyle = "#fff";
                ctx.font = "14px monospace";
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText(char, x * cellSize + cellSize / 2, z * cellSize + cellSize / 2);
            }
        }
    }
}

const LAST_SAVED_AREA_ID_STORAGE_KEY = "bg2-editor-last-saved-area-id";

type EditorClipboard =
    | { kind: "entity"; entity: EntityDef }
    | { kind: "tree"; tree: TreeDef }
    | { kind: "decoration"; decoration: DecorationDef };

interface EditorContextMenuState {
    screenX: number;
    screenY: number;
    tileX: number;
    tileZ: number;
    entity: EntityDef | null;
    tree: { value: TreeDef; index: number } | null;
    decoration: { value: DecorationDef; index: number } | null;
}

function loadLastSavedAreaId(): string | null {
    try {
        const raw = localStorage.getItem(LAST_SAVED_AREA_ID_STORAGE_KEY);
        return raw && raw.trim().length > 0 ? raw.trim() : null;
    } catch {
        return null;
    }
}

function persistLastSavedAreaId(areaId: string): void {
    try {
        localStorage.setItem(LAST_SAVED_AREA_ID_STORAGE_KEY, areaId);
    } catch {
        // Ignore storage failures (private mode/quota).
    }
}

// =============================================================================
// COMPONENT
// =============================================================================

export function MapEditor() {
    // Map metadata
    const [metadata, setMetadata] = useState<MapMetadata>({
        id: "new_area",
        name: "New Area",
        flavor: "A mysterious place.",
        width: 30,
        height: 20,
        background: "#1a1a2e",
        ground: "#2a2a3e",
        ambient: 0.4,
        directional: 0.5,
        fog: true,
        spawnX: 3,
        spawnZ: 10,
    });

    // Layer data (2D arrays of characters)
    const [geometryLayer, setGeometryLayer] = useState<string[][]>(() =>
        createEmptyLayer(metadata.width, metadata.height, ".")
    );
    const [terrainLayer, setTerrainLayer] = useState<string[][]>(() =>
        createEmptyLayer(metadata.width, metadata.height, ".")
    );
    const [floorLayer, setFloorLayer] = useState<string[][]>(() =>
        createEmptyLayer(metadata.width, metadata.height, ".")
    );
    const [propsLayer, setPropsLayer] = useState<string[][]>(() =>
        createEmptyLayer(metadata.width, metadata.height, ".")
    );
    const [entitiesLayer, setEntitiesLayer] = useState<string[][]>(() =>
        createEmptyLayer(metadata.width, metadata.height, ".")
    );

    // Detailed data (preserves info that can't be shown in grid)
    const [entities, setEntities] = useState<EntityDef[]>([]);
    const [trees, setTrees] = useState<TreeDef[]>([]);
    const [decorations, setDecorations] = useState<DecorationDef[]>([]);

    // Editor state
    const [activeLayer, setActiveLayer] = useState<Layer>("geometry");
    const [activeTool, setActiveTool] = useState<Tool>("paint");
    const [activeBrush, setActiveBrush] = useState<string>("#");
    const [brushSize, setBrushSize] = useState<number>(1);
    const [showGrid, setShowGrid] = useState(true);
    const [layerVisibility, setLayerVisibility] = useState({
        geometry: true,
        terrain: true,
        floor: true,
        props: true,
        entities: true,
    });

    // Canvas refs
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const saveMapRef = useRef<(() => void) | null>(null);
    const [isPainting, setIsPainting] = useState(false);
    const [zoom, setZoom] = useState(1);
    const [isometric, setIsometric] = useState(false);
    const ISO_ZOOM = 0.5;  // Fixed zoom for isometric view

    // Door drag state for click-drag to create multi-tile doors
    const [doorDrag, setDoorDrag] = useState<{ startX: number; startZ: number; endX: number; endZ: number } | null>(null);

    // Entity editor popup
    const [editingEntity, setEditingEntity] = useState<{ entity: EntityDef; screenX: number; screenY: number } | null>(null);
    const [editingTree, setEditingTree] = useState<{ tree: TreeDef; index: number; screenX: number; screenY: number } | null>(null);
    const [editingDecoration, setEditingDecoration] = useState<{ decoration: DecorationDef; index: number; screenX: number; screenY: number } | null>(null);
    const [clipboard, setClipboard] = useState<EditorClipboard | null>(null);
    const [contextMenu, setContextMenu] = useState<EditorContextMenuState | null>(null);

    // Undo/Redo history
    const historyRef = useRef<EditorSnapshot[]>([]);
    const historyIndexRef = useRef(-1);

    const createSnapshot = useCallback((): EditorSnapshot => ({
        geometryLayer: geometryLayer.map(row => [...row]),
        terrainLayer: terrainLayer.map(row => [...row]),
        floorLayer: floorLayer.map(row => [...row]),
        propsLayer: propsLayer.map(row => [...row]),
        entitiesLayer: entitiesLayer.map(row => [...row]),
        entities: entities.map(e => ({ ...e })),
        trees: trees.map(t => ({ ...t })),
        decorations: decorations.map(d => ({ ...d })),
    }), [geometryLayer, terrainLayer, floorLayer, propsLayer, entitiesLayer, entities, trees, decorations]);

    const pushHistory = useCallback(() => {
        const snapshot = createSnapshot();
        // Remove any redo history beyond current index
        historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1);
        historyRef.current.push(snapshot);
        // Trim to max length
        if (historyRef.current.length > MAX_HISTORY) {
            historyRef.current.shift();
        } else {
            historyIndexRef.current++;
        }
    }, [createSnapshot]);

    const applySnapshot = useCallback((snapshot: EditorSnapshot) => {
        setGeometryLayer(snapshot.geometryLayer.map(row => [...row]));
        setTerrainLayer(snapshot.terrainLayer.map(row => [...row]));
        setFloorLayer(snapshot.floorLayer.map(row => [...row]));
        setPropsLayer(snapshot.propsLayer.map(row => [...row]));
        setEntitiesLayer(snapshot.entitiesLayer.map(row => [...row]));
        setEntities(snapshot.entities.map(e => ({ ...e })));
        setTrees(snapshot.trees.map(t => ({ ...t })));
        setDecorations(snapshot.decorations.map(d => ({ ...d })));
    }, []);

    const undo = useCallback(() => {
        if (historyIndexRef.current > 0) {
            historyIndexRef.current--;
            applySnapshot(historyRef.current[historyIndexRef.current]);
        }
    }, [applySnapshot]);

    const redo = useCallback(() => {
        if (historyIndexRef.current < historyRef.current.length - 1) {
            historyIndexRef.current++;
            applySnapshot(historyRef.current[historyIndexRef.current]);
        }
    }, [applySnapshot]);

    // Initialize history with first snapshot
    useEffect(() => {
        if (historyRef.current.length === 0) {
            pushHistory();
        }
    }, [pushHistory]);

    // Keyboard shortcuts for undo/redo
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
                e.preventDefault();
                undo();
            } else if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.key === "z" && e.shiftKey))) {
                e.preventDefault();
                redo();
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [undo, redo]);

    // In isometric mode, lock zoom at 50%
    const effectiveZoom = isometric ? ISO_ZOOM : zoom;
    const CELL_SIZE = Math.round(BASE_CELL_SIZE * effectiveZoom);

    // Transform mouse coordinates for isometric view
    // Inverts rotateX(60deg) rotateZ(45deg) transformation
    const transformMouseCoords = useCallback((clientX: number, clientY: number, rect: DOMRect): { x: number; z: number } => {
        if (!isometric) {
            // Normal top-down view - direct mapping
            return {
                x: Math.floor((clientX - rect.left) / CELL_SIZE),
                z: Math.floor((clientY - rect.top) / CELL_SIZE)
            };
        }

        // Isometric view - need to invert the CSS transform
        // Transform is: rotateX(60deg) rotateZ(45deg)
        const canvasWidth = metadata.width * CELL_SIZE;
        const canvasHeight = metadata.height * CELL_SIZE;

        // Get mouse position relative to center of the transformed container
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const mouseX = clientX - centerX;
        const mouseY = clientY - centerY;

        // Invert rotateX(60deg) - Y is compressed by cos(60°) = 0.5
        const cosX = Math.cos(60 * Math.PI / 180); // 0.5
        const expandedY = mouseY / cosX;

        // Invert rotateZ(45deg) - rotate back by -45°
        const cosZ = Math.cos(-45 * Math.PI / 180);
        const sinZ = Math.sin(-45 * Math.PI / 180);
        const canvasX = mouseX * cosZ - expandedY * sinZ;
        const canvasY = mouseX * sinZ + expandedY * cosZ;

        // Convert from center-relative back to top-left relative
        const finalX = canvasX + canvasWidth / 2;
        const finalY = canvasY + canvasHeight / 2;

        return {
            x: Math.floor(finalX / CELL_SIZE),
            z: Math.floor(finalY / CELL_SIZE)
        };
    }, [isometric, CELL_SIZE, metadata.width, metadata.height]);

    // Resize layers when dimensions change
    useEffect(() => {
        setGeometryLayer(prev => resizeLayer(prev, metadata.width, metadata.height, "."));
        setTerrainLayer(prev => resizeLayer(prev, metadata.width, metadata.height, "."));
        setFloorLayer(prev => resizeLayer(prev, metadata.width, metadata.height, "."));
        setPropsLayer(prev => resizeLayer(prev, metadata.width, metadata.height, "."));
        setEntitiesLayer(prev => resizeLayer(prev, metadata.width, metadata.height, "."));
    }, [metadata.width, metadata.height]);

    // Draw canvas
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        canvas.width = metadata.width * CELL_SIZE;
        canvas.height = metadata.height * CELL_SIZE;

        // Clear
        ctx.fillStyle = metadata.ground;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Draw layers bottom to top (floor first as base, then everything on top)
        if (layerVisibility.floor) drawLayer(ctx, floorLayer, "floor", CELL_SIZE);
        if (layerVisibility.geometry) drawLayer(ctx, geometryLayer, "geometry", CELL_SIZE);
        if (layerVisibility.terrain) drawLayer(ctx, terrainLayer, "terrain", CELL_SIZE);
        if (layerVisibility.props) drawLayer(ctx, propsLayer, "props", CELL_SIZE);
        if (layerVisibility.entities) drawLayer(ctx, entitiesLayer, "entities", CELL_SIZE);

        // Grid
        if (showGrid) {
            ctx.strokeStyle = "rgba(255,255,255,0.1)";
            ctx.lineWidth = 1;
            for (let x = 0; x <= metadata.width; x++) {
                ctx.beginPath();
                ctx.moveTo(x * CELL_SIZE, 0);
                ctx.lineTo(x * CELL_SIZE, canvas.height);
                ctx.stroke();
            }
            for (let z = 0; z <= metadata.height; z++) {
                ctx.beginPath();
                ctx.moveTo(0, z * CELL_SIZE);
                ctx.lineTo(canvas.width, z * CELL_SIZE);
                ctx.stroke();
            }
        }

        // Highlight active layer border
        ctx.strokeStyle = getLayerColor(activeLayer);
        ctx.lineWidth = 3;
        ctx.strokeRect(0, 0, canvas.width, canvas.height);

        // Door drag preview
        if (doorDrag) {
            const minX = Math.min(doorDrag.startX, doorDrag.endX);
            const maxX = Math.max(doorDrag.startX, doorDrag.endX);
            const minZ = Math.min(doorDrag.startZ, doorDrag.endZ);
            const maxZ = Math.max(doorDrag.startZ, doorDrag.endZ);

            ctx.fillStyle = "rgba(136, 68, 255, 0.4)";
            ctx.fillRect(
                minX * CELL_SIZE,
                minZ * CELL_SIZE,
                (maxX - minX + 1) * CELL_SIZE,
                (maxZ - minZ + 1) * CELL_SIZE
            );
            ctx.strokeStyle = "#84f";
            ctx.lineWidth = 2;
            ctx.strokeRect(
                minX * CELL_SIZE,
                minZ * CELL_SIZE,
                (maxX - minX + 1) * CELL_SIZE,
                (maxZ - minZ + 1) * CELL_SIZE
            );
        }

        // Draw transition labels and arrows
        if (layerVisibility.entities) {
            for (const entity of entities) {
                if (entity.type !== "transition") continue;

                const x = entity.x;
                const z = entity.z;
                const w = entity.transitionW || 1;
                const h = entity.transitionH || 1;
                const target = entity.transitionTarget || "?";
                const dir = entity.transitionDirection || "north";

                // Center of the transition area
                const centerX = (x + w / 2) * CELL_SIZE;
                const centerZ = (z + h / 2) * CELL_SIZE;

                // Draw direction arrow
                ctx.save();
                ctx.translate(centerX, centerZ);
                const arrowRotation = { north: -Math.PI / 2, south: Math.PI / 2, east: 0, west: Math.PI }[dir];
                ctx.rotate(arrowRotation);
                ctx.fillStyle = "#fff";
                ctx.beginPath();
                ctx.moveTo(12, 0);
                ctx.lineTo(4, -6);
                ctx.lineTo(4, 6);
                ctx.closePath();
                ctx.fill();
                ctx.restore();

                // Draw target label above the transition
                ctx.fillStyle = "#000";
                ctx.fillRect(x * CELL_SIZE, z * CELL_SIZE - 16, w * CELL_SIZE, 14);
                ctx.fillStyle = "#4cf";
                ctx.font = "600 10px \"DM Mono\", monospace";
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText(target, centerX, z * CELL_SIZE - 9);
            }
        }

    }, [geometryLayer, terrainLayer, floorLayer, propsLayer, entitiesLayer, metadata, showGrid, layerVisibility, activeLayer, CELL_SIZE, doorDrag, entities]);

    const getActiveLayer = useCallback((): string[][] => {
        switch (activeLayer) {
            case "geometry": return geometryLayer;
            case "terrain": return terrainLayer;
            case "floor": return floorLayer;
            case "props": return propsLayer;
            case "entities": return entitiesLayer;
        }
    }, [activeLayer, geometryLayer, terrainLayer, floorLayer, propsLayer, entitiesLayer]);

    const setActiveLayerData = useCallback((newLayer: string[][]) => {
        switch (activeLayer) {
            case "geometry": setGeometryLayer(newLayer); break;
            case "terrain": setTerrainLayer(newLayer); break;
            case "floor": setFloorLayer(newLayer); break;
            case "props": setPropsLayer(newLayer); break;
            case "entities": setEntitiesLayer(newLayer); break;
        }
    }, [activeLayer]);

    const getEntityFootprint = useCallback((entity: EntityDef): { x: number; z: number; w: number; h: number } => {
        if (entity.type === "transition") {
            return {
                x: Math.floor(entity.x),
                z: Math.floor(entity.z),
                w: Math.max(1, Math.floor(entity.transitionW ?? 1)),
                h: Math.max(1, Math.floor(entity.transitionH ?? 1)),
            };
        }
        if (entity.type === "secret_door") {
            return {
                x: Math.floor(entity.secretBlockX ?? entity.x),
                z: Math.floor(entity.secretBlockZ ?? entity.z),
                w: Math.max(1, Math.floor(entity.secretBlockW ?? 1)),
                h: Math.max(1, Math.floor(entity.secretBlockH ?? 1)),
            };
        }
        return { x: Math.floor(entity.x), z: Math.floor(entity.z), w: 1, h: 1 };
    }, []);

    const entityOccupiesCell = useCallback((entity: EntityDef, x: number, z: number): boolean => {
        const footprint = getEntityFootprint(entity);
        return x >= footprint.x
            && x < footprint.x + footprint.w
            && z >= footprint.z
            && z < footprint.z + footprint.h;
    }, [getEntityFootprint]);

    const footprintsOverlap = useCallback(
        (a: { x: number; z: number; w: number; h: number }, b: { x: number; z: number; w: number; h: number }): boolean =>
            a.x < b.x + b.w && a.x + a.w > b.x && a.z < b.z + b.h && a.z + a.h > b.z,
        []
    );

    const buildEntitiesLayerFromDefs = useCallback((entityDefs: EntityDef[]): string[][] => {
        const grid = createEmptyLayer(metadata.width, metadata.height, ".");
        const spawnX = Math.floor(metadata.spawnX);
        const spawnZ = Math.floor(metadata.spawnZ);
        if (spawnX >= 0 && spawnX < metadata.width && spawnZ >= 0 && spawnZ < metadata.height) {
            grid[spawnZ][spawnX] = "@";
        }

        for (const entity of entityDefs) {
            const markCell = (x: number, z: number, char: string) => {
                if (x < 0 || x >= metadata.width || z < 0 || z >= metadata.height) return;
                grid[z][x] = char;
            };

            if (entity.type === "enemy") {
                markCell(Math.floor(entity.x), Math.floor(entity.z), "E");
                continue;
            }
            if (entity.type === "chest") {
                markCell(Math.floor(entity.x), Math.floor(entity.z), "X");
                continue;
            }
            if (entity.type === "candle") {
                markCell(Math.floor(entity.x), Math.floor(entity.z), "L");
                continue;
            }
            if (entity.type === "torch") {
                markCell(Math.floor(entity.x), Math.floor(entity.z), "Y");
                continue;
            }
            if (entity.type === "light") {
                markCell(Math.floor(entity.x), Math.floor(entity.z), "H");
                continue;
            }
            if (entity.type === "transition") {
                const footprint = getEntityFootprint(entity);
                for (let dz = 0; dz < footprint.h; dz++) {
                    for (let dx = 0; dx < footprint.w; dx++) {
                        markCell(footprint.x + dx, footprint.z + dz, "D");
                    }
                }
                continue;
            }
            if (entity.type === "secret_door") {
                const footprint = getEntityFootprint(entity);
                for (let dz = 0; dz < footprint.h; dz++) {
                    for (let dx = 0; dx < footprint.w; dx++) {
                        markCell(footprint.x + dx, footprint.z + dz, "S");
                    }
                }
            }
        }
        return grid;
    }, [metadata.width, metadata.height, metadata.spawnX, metadata.spawnZ, getEntityFootprint]);

    const setSpawnPoint = useCallback((x: number, z: number) => {
        const clampedX = Math.max(0, Math.min(metadata.width - 1, Math.floor(x)));
        const clampedZ = Math.max(0, Math.min(metadata.height - 1, Math.floor(z)));

        setMetadata(prev => ({ ...prev, spawnX: clampedX, spawnZ: clampedZ }));
        setEntitiesLayer(prev => {
            const next = prev.map(row => row.map(cell => (cell === "@" ? "." : cell)));
            if (clampedZ >= 0 && clampedZ < next.length && clampedX >= 0 && clampedX < next[clampedZ].length) {
                next[clampedZ][clampedX] = "@";
            }
            return next;
        });
    }, [metadata.width, metadata.height]);

    const paintCell = useCallback((x: number, z: number) => {
        const layer = getActiveLayer();
        if (x < 0 || x >= metadata.width || z < 0 || z >= metadata.height) return;

        if (activeLayer === "entities" && activeTool === "paint" && activeBrush === "@") {
            setSpawnPoint(x, z);
            return;
        }

        if (
            activeLayer === "entities"
            && activeTool === "paint"
            && activeBrush === "E"
            && isBlockingPropCell(propsLayer, x, z)
        ) {
            console.warn(`Blocked enemy placement at (${x}, ${z}) due to blocking prop/tree.`);
            return;
        }

        const newLayer = layer.map(row => [...row]);
        const halfSize = Math.floor(brushSize / 2);

        // Paint a square area based on brush size
        for (let dz = -halfSize; dz < brushSize - halfSize; dz++) {
            for (let dx = -halfSize; dx < brushSize - halfSize; dx++) {
                const px = x + dx;
                const pz = z + dz;
                if (px >= 0 && px < metadata.width && pz >= 0 && pz < metadata.height) {
                    if (activeTool === "paint") {
                        newLayer[pz][px] = activeBrush;
                    } else if (activeTool === "erase") {
                        newLayer[pz][px] = ".";
                    }
                }
            }
        }
        setActiveLayerData(newLayer);

        // For entities layer, sync the entities array for special types that need detailed config
        if (activeLayer === "entities") {
            const existingEntity = entities.find(e => Math.floor(e.x) === x && Math.floor(e.z) === z);

            if (activeTool === "erase" && existingEntity) {
                // Remove entity when erasing
                setEntities(prev => prev.filter(e => e.id !== existingEntity.id));
            } else if (activeTool === "paint") {
                // Remove any existing entity at this position first
                if (existingEntity) {
                    setEntities(prev => prev.filter(e => e.id !== existingEntity.id));
                }

                // Create new entity for special types
                const entityId = `e${Date.now()}-${x}-${z}`;
                if (activeBrush === "D") {
                    setEntities(prev => [...prev, {
                        id: entityId, x, z, type: "transition",
                        transitionTarget: getAvailableAreaIds()[0], transitionSpawnX: 5, transitionSpawnZ: 5,
                        transitionDirection: "north", transitionW: 1, transitionH: 1
                    }]);
                } else if (activeBrush === "L") {
                    setEntities(prev => [...prev, {
                        id: entityId, x, z, type: "candle",
                        candleDx: 0, candleDz: 1,
                        lightColor: DEFAULT_CANDLE_LIGHT_COLOR
                    }]);
                } else if (activeBrush === "Y") {
                    setEntities(prev => [...prev, {
                        id: entityId, x, z, type: "torch",
                        candleDx: 0, candleDz: 1,
                        lightColor: DEFAULT_TORCH_LIGHT_COLOR
                    }]);
                } else if (activeBrush === "H") {
                    setEntities(prev => [...prev, {
                        id: entityId, x: x + 0.5, z: z + 0.5, type: "light",
                        lightRadius: DEFAULT_AREA_LIGHT_RADIUS,
                        lightAngle: DEFAULT_AREA_LIGHT_ANGLE,
                        lightColor: DEFAULT_AREA_LIGHT_TINT,
                        lightBrightness: DEFAULT_AREA_LIGHT_BRIGHTNESS,
                        lightHeight: DEFAULT_AREA_LIGHT_HEIGHT,
                        lightDiffusion: DEFAULT_AREA_LIGHT_DIFFUSION,
                        lightDecay: DEFAULT_AREA_LIGHT_DECAY,
                    }]);
                } else if (activeBrush === "S") {
                    setEntities(prev => [...prev, {
                        id: entityId, x, z, type: "secret_door",
                        secretBlockX: x, secretBlockZ: z, secretBlockW: 1, secretBlockH: 1
                    }]);
                } else if (activeBrush === "E") {
                    setEntities(prev => [...prev, {
                        id: entityId, x, z, type: "enemy", enemyType: "skeleton_warrior"
                    }]);
                } else if (activeBrush === "X") {
                    setEntities(prev => [...prev, {
                        id: entityId, x, z, type: "chest", chestGold: 0, chestItems: ""
                    }]);
                }
            }
        }
    }, [getActiveLayer, setActiveLayerData, activeTool, activeBrush, brushSize, metadata.width, metadata.height, activeLayer, entities, propsLayer, setSpawnPoint]);

    const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
        // Ignore right-click (handled by onContextMenu)
        if (e.button !== 0) return;
        // Disable painting in isometric view (view-only mode)
        if (isometric) return;

        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;

        const { x, z } = transformMouseCoords(e.clientX, e.clientY, rect);
        if (x < 0 || z < 0 || x >= metadata.width || z >= metadata.height) return;

        // Push history before starting to paint
        pushHistory();

        // For door brush, use drag-to-size
        if (activeLayer === "entities" && activeBrush === "D" && activeTool === "paint") {
            setDoorDrag({ startX: x, startZ: z, endX: x, endZ: z });
        } else {
            setIsPainting(true);
            paintCell(x, z);
        }
    };

    const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;

        const { x, z } = transformMouseCoords(e.clientX, e.clientY, rect);

        // Update door drag preview
        if (doorDrag) {
            setDoorDrag(prev => prev ? { ...prev, endX: x, endZ: z } : null);
            return;
        }

        if (!isPainting) return;
        paintCell(x, z);
    };

    const handleCanvasMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
        // Finalize door drag
        if (doorDrag) {
            const rect = canvasRef.current?.getBoundingClientRect();
            if (rect) {
                const { x, z } = transformMouseCoords(e.clientX, e.clientY, rect);

                const minX = Math.min(doorDrag.startX, x);
                const maxX = Math.max(doorDrag.startX, x);
                const minZ = Math.min(doorDrag.startZ, z);
                const maxZ = Math.max(doorDrag.startZ, z);
                const w = maxX - minX + 1;
                const h = maxZ - minZ + 1;

                // Paint door cells on the grid
                const newLayer = entitiesLayer.map(row => [...row]);
                for (let dz = minZ; dz <= maxZ; dz++) {
                    for (let dx = minX; dx <= maxX; dx++) {
                        if (dx >= 0 && dx < metadata.width && dz >= 0 && dz < metadata.height) {
                            newLayer[dz][dx] = "D";
                        }
                    }
                }
                setEntitiesLayer(newLayer);

                // Remove any existing entities in this area
                setEntities(prev => prev.filter(e => {
                    const ex = Math.floor(e.x);
                    const ez = Math.floor(e.z);
                    return !(ex >= minX && ex <= maxX && ez >= minZ && ez <= maxZ);
                }));

                // Create single door entity with w/h
                const entityId = `e${Date.now()}-${minX}-${minZ}`;
                setEntities(prev => [...prev, {
                    id: entityId, x: minX, z: minZ, type: "transition",
                    transitionTarget: getAvailableAreaIds()[0], transitionSpawnX: 5, transitionSpawnZ: 5,
                    transitionDirection: "north", transitionW: w, transitionH: h
                }]);
            }
            setDoorDrag(null);
            return;
        }

        setIsPainting(false);
    };

    const openPropertiesPopup = useCallback((menu: EditorContextMenuState) => {
        if (menu.entity) {
            setEditingEntity({ entity: menu.entity, screenX: menu.screenX, screenY: menu.screenY });
            setEditingTree(null);
            setEditingDecoration(null);
            return;
        }
        if (menu.tree) {
            setEditingTree({
                tree: menu.tree.value,
                index: menu.tree.index,
                screenX: menu.screenX,
                screenY: menu.screenY
            });
            setEditingEntity(null);
            setEditingDecoration(null);
            return;
        }
        if (menu.decoration) {
            setEditingDecoration({
                decoration: menu.decoration.value,
                index: menu.decoration.index,
                screenX: menu.screenX,
                screenY: menu.screenY
            });
            setEditingEntity(null);
            setEditingTree(null);
        }
    }, []);

    const copyFromContextMenu = useCallback((menu: EditorContextMenuState) => {
        if (menu.entity) {
            setClipboard({ kind: "entity", entity: { ...menu.entity } });
            return;
        }
        if (menu.tree) {
            setClipboard({ kind: "tree", tree: { ...menu.tree.value } });
            return;
        }
        if (menu.decoration) {
            setClipboard({ kind: "decoration", decoration: { ...menu.decoration.value } });
        }
    }, []);

    const pasteClipboardAt = useCallback((x: number, z: number) => {
        if (!clipboard) return;
        if (x < 0 || x >= metadata.width || z < 0 || z >= metadata.height) return;

        pushHistory();

        if (clipboard.kind === "entity") {
            const source = clipboard.entity;
            const nextId = `e${Date.now()}-${x}-${z}`;
            let pasted: EntityDef;

            if (source.type === "light") {
                pasted = { ...source, id: nextId, x: x + 0.5, z: z + 0.5 };
            } else if (source.type === "transition") {
                pasted = { ...source, id: nextId, x, z };
            } else if (source.type === "secret_door") {
                pasted = {
                    ...source,
                    id: nextId,
                    x,
                    z,
                    secretBlockX: x,
                    secretBlockZ: z,
                };
            } else {
                pasted = { ...source, id: nextId, x, z };
            }

            const pasteFootprint = getEntityFootprint(pasted);
            const cellInPasteFootprint = (cellX: number, cellZ: number): boolean =>
                cellX >= pasteFootprint.x
                && cellX < pasteFootprint.x + pasteFootprint.w
                && cellZ >= pasteFootprint.z
                && cellZ < pasteFootprint.z + pasteFootprint.h;

            const nextEntities = entities
                .filter(ent => !footprintsOverlap(getEntityFootprint(ent), pasteFootprint))
                .concat(pasted);

            setEntities(nextEntities);
            setEntitiesLayer(buildEntitiesLayerFromDefs(nextEntities));
            setTrees(prev => prev.filter(tree => !cellInPasteFootprint(Math.floor(tree.x), Math.floor(tree.z))));
            setDecorations(prev => prev.filter(decoration => !cellInPasteFootprint(Math.floor(decoration.x), Math.floor(decoration.z))));
            setPropsLayer(prev => {
                const next = prev.map(row => [...row]);
                for (let dz = 0; dz < pasteFootprint.h; dz++) {
                    for (let dx = 0; dx < pasteFootprint.w; dx++) {
                        const cellX = pasteFootprint.x + dx;
                        const cellZ = pasteFootprint.z + dz;
                        if (cellX < 0 || cellX >= metadata.width || cellZ < 0 || cellZ >= metadata.height) continue;
                        next[cellZ][cellX] = ".";
                    }
                }
                return next;
            });
            return;
        }

        const nextEntities = entities.filter(entity => !entityOccupiesCell(entity, x, z));
        if (nextEntities.length !== entities.length) {
            setEntities(nextEntities);
            setEntitiesLayer(buildEntitiesLayerFromDefs(nextEntities));
        }

        if (clipboard.kind === "tree") {
            const treeType = clipboard.tree.type ?? "pine";
            const treeChar = PROP_TREE_TYPE_TO_CHAR.get(treeType) ?? "T";
            setPropsLayer(prev => {
                const next = prev.map(row => [...row]);
                next[z][x] = treeChar;
                return next;
            });
            setTrees(prev => [
                ...prev.filter(tree => Math.floor(tree.x) !== x || Math.floor(tree.z) !== z),
                { ...clipboard.tree, x, z, type: treeType }
            ]);
            setDecorations(prev => prev.filter(decoration => Math.floor(decoration.x) !== x || Math.floor(decoration.z) !== z));
            return;
        }

        const decorationType = clipboard.decoration.type;
        const decorationChar = PROP_TYPE_TO_CHAR.get(decorationType) ?? ".";
        setPropsLayer(prev => {
            const next = prev.map(row => [...row]);
            next[z][x] = decorationChar;
            return next;
        });
        setDecorations(prev => [
            ...prev.filter(decoration => Math.floor(decoration.x) !== x || Math.floor(decoration.z) !== z),
            { ...clipboard.decoration, x, z }
        ]);
        setTrees(prev => prev.filter(tree => Math.floor(tree.x) !== x || Math.floor(tree.z) !== z));
    }, [
        clipboard,
        metadata.width,
        metadata.height,
        pushHistory,
        getEntityFootprint,
        entities,
        footprintsOverlap,
        buildEntitiesLayerFromDefs,
        entityOccupiesCell
    ]);

    const handleCanvasContextMenu = (e: React.MouseEvent<HTMLCanvasElement>) => {
        e.preventDefault();
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;

        const { x, z } = transformMouseCoords(e.clientX, e.clientY, rect);
        if (x < 0 || x >= metadata.width || z < 0 || z >= metadata.height) {
            setContextMenu(null);
            return;
        }

        const entity = entities.find(ent => entityOccupiesCell(ent, x, z));
        const treeIndex = trees.findIndex(t => Math.floor(t.x) === x && Math.floor(t.z) === z);
        const decIndex = decorations.findIndex(d => Math.floor(d.x) === x && Math.floor(d.z) === z);
        const tree = treeIndex >= 0 ? { value: { ...trees[treeIndex] }, index: treeIndex } : null;
        const decoration = decIndex >= 0 ? { value: { ...decorations[decIndex] }, index: decIndex } : null;

        const menuWidth = 188;
        const menuHeight = 132;
        const screenX = Math.min(e.clientX, window.innerWidth - menuWidth);
        const screenY = Math.min(e.clientY, window.innerHeight - menuHeight);
        const menu: EditorContextMenuState = {
            screenX,
            screenY,
            tileX: x,
            tileZ: z,
            entity: entity ? { ...entity } : null,
            tree,
            decoration
        };

        // Shift + right-click keeps the existing edit popup behavior.
        if (e.shiftKey) {
            openPropertiesPopup(menu);
            setContextMenu(null);
            return;
        }

        setContextMenu(menu);
    };

    useEffect(() => {
        if (!contextMenu) return;

        const handleGlobalPointerDown = () => setContextMenu(null);
        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                setContextMenu(null);
            }
        };

        window.addEventListener("pointerdown", handleGlobalPointerDown);
        window.addEventListener("keydown", handleEscape);
        return () => {
            window.removeEventListener("pointerdown", handleGlobalPointerDown);
            window.removeEventListener("keydown", handleEscape);
        };
    }, [contextMenu]);

    const updateEntity = (updated: EntityDef) => {
        pushHistory();
        setEntities(prev => prev.map(e => e.id === updated.id ? updated : e));
        setEditingEntity(null);
    };

    const updateTree = (index: number, updated: TreeDef) => {
        pushHistory();
        const normalizedType = updated.type ?? "pine";
        const normalized: TreeDef = {
            ...updated,
            type: normalizedType,
            size: clampTreeSizeByType(updated.size, normalizedType),
        };
        setTrees(prev => prev.map((t, i) => i === index ? normalized : t));
        setEditingTree(null);
    };

    const updateDecoration = (index: number, updated: DecorationDef) => {
        pushHistory();
        setDecorations(prev => prev.map((d, i) => i === index ? updated : d));
        setEditingDecoration(null);
    };

    const loadArea = (areaId: AreaId) => {
        const area = AREAS[areaId];
        if (!area) return;

        // Update metadata
        setMetadata({
            id: area.id,
            name: area.name,
            flavor: area.flavor,
            width: area.gridWidth,
            height: area.gridHeight,
            background: area.backgroundColor,
            ground: area.groundColor,
            ambient: area.ambientLight,
            directional: area.directionalLight,
            fog: area.hasFogOfWar,
            spawnX: area.defaultSpawn.x,
            spawnZ: area.defaultSpawn.z,
        });

        // Use geometry, terrain, and floor directly from area data
        setGeometryLayer(area.geometry.map(row => [...row]));
        setTerrainLayer(area.terrain.map(row => [...row]));
        // Floor layer - use empty if not present in area data
        if (area.floor && area.floor.length > 0) {
            setFloorLayer(area.floor.map(row => [...row]));
        } else {
            setFloorLayer(createEmptyLayer(area.gridWidth, area.gridHeight, "."));
        }

        // Compute props layer from trees and decorations
        const newProps = computePropsFromArea(area, area.gridWidth, area.gridHeight);
        setPropsLayer(newProps);

        // Compute entities layer from enemies, chests, transitions
        const newEntities = computeEntitiesFromArea(area, area.gridWidth, area.gridHeight);
        setEntitiesLayer(newEntities);

        // Store detailed data that can't be shown in grid
        setTrees(area.trees.map(t => {
            const normalizedType = t.type ?? "pine";
            return {
                x: t.x,
                z: t.z,
                size: clampTreeSizeByType(t.size, normalizedType),
                type: normalizedType,
            };
        }));
        setDecorations((area.decorations ?? []).map(d => ({ x: d.x, z: d.z, type: d.type, rotation: d.rotation, size: d.size })));

        // Build entity definitions
        const entityDefs: EntityDef[] = [];
        let entityId = 0;
        area.enemySpawns.forEach(e => {
            entityDefs.push({ id: `e${entityId++}`, x: e.x, z: e.z, type: "enemy", enemyType: e.type });
        });
        area.chests.forEach(c => {
            const items = c.contents.map(i => `${i.itemId}:${i.quantity}`).join(",");
            entityDefs.push({
                id: `e${entityId++}`, x: c.x, z: c.z, type: "chest",
                chestGold: c.gold, chestItems: items, chestLocked: c.locked ? (c.requiredKeyId ?? "true") : undefined
            });
        });
        area.transitions.forEach(t => {
            entityDefs.push({
                id: `e${entityId++}`, x: t.x, z: t.z, type: "transition",
                transitionTarget: t.targetArea, transitionSpawnX: t.targetSpawn.x, transitionSpawnZ: t.targetSpawn.z,
                transitionDirection: t.direction, transitionW: t.w, transitionH: t.h
            });
        });
        (area.candles ?? []).forEach(c => {
            entityDefs.push({
                id: `e${entityId++}`,
                x: c.x,
                z: c.z,
                type: c.kind === "torch" ? "torch" : "candle",
                candleDx: c.dx,
                candleDz: c.dz,
                lightColor: normalizeLightHexColor(c.lightColor, c.kind === "torch" ? DEFAULT_TORCH_LIGHT_COLOR : DEFAULT_CANDLE_LIGHT_COLOR),
            });
        });
        (area.lights ?? []).forEach(l => {
            entityDefs.push({
                id: `e${entityId++}`,
                x: l.x,
                z: l.z,
                type: "light",
                lightRadius: l.radius,
                lightAngle: l.angle,
                lightColor: normalizeLightHexColor(l.tint, DEFAULT_AREA_LIGHT_TINT),
                lightBrightness: l.brightness,
                lightHeight: l.height,
                lightDiffusion: l.diffusion,
                lightDecay: l.decay ?? DEFAULT_AREA_LIGHT_DECAY,
            });
        });
        (area.secretDoors ?? []).forEach(s => {
            entityDefs.push({
                id: `e${entityId++}`, x: s.x, z: s.z, type: "secret_door",
                secretBlockX: s.blockingWall.x, secretBlockZ: s.blockingWall.z,
                secretBlockW: s.blockingWall.w, secretBlockH: s.blockingWall.h
            });
        });
        setEntities(entityDefs);
    };

    const createNewArea = () => {
        const newId = `area_${Date.now()}`;
        const width = 30;
        const height = 20;
        const spawnX = 3;
        const spawnZ = 10;
        const newEntities = createEmptyLayer(width, height, ".");
        if (spawnZ >= 0 && spawnZ < height && spawnX >= 0 && spawnX < width) {
            newEntities[spawnZ][spawnX] = "@";
        }

        setMetadata({
            id: newId,
            name: "New Area",
            flavor: "A mysterious place.",
            width,
            height,
            background: "#1a1a2e",
            ground: "#2a2a3e",
            ambient: 0.4,
            directional: 0.5,
            fog: true,
            spawnX,
            spawnZ,
        });

        setGeometryLayer(createEmptyLayer(width, height, "."));
        setTerrainLayer(createEmptyLayer(width, height, "."));
        setFloorLayer(createEmptyLayer(width, height, "."));
        setPropsLayer(createEmptyLayer(width, height, "."));
        setEntitiesLayer(newEntities);
        setEntities([]);
        setTrees([]);
        setDecorations([]);

        // Reset history for new area
        historyRef.current = [];
        historyIndexRef.current = -1;
        pushHistory();
    };

    // Load last saved map on mount when available, otherwise fall back to coast.
    useEffect(() => {
        const savedAreaId = loadLastSavedAreaId();
        if (savedAreaId && AREAS[savedAreaId]) {
            loadArea(savedAreaId as AreaId);
            return;
        }
        loadArea("coast");
    }, []);

    const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

    const saveMap = async () => {
        const area = buildAreaDataFromEditor();
        const content = areaDataToText(area);

        setSaveStatus("saving");
        try {
            const res = await fetch("/__save-map", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ areaId: metadata.id, content }),
            });
            const data = await res.json();
            if (data.success) {
                // Register the area so it's immediately available for loading/transitions
                registerAreaFromText(metadata.id, content);
                persistLastSavedAreaId(metadata.id);
                setSaveStatus("saved");
                setTimeout(() => setSaveStatus("idle"), 2000);
            } else {
                console.error("Save failed:", data.error);
                setSaveStatus("error");
            }
        } catch (err) {
            console.error("Save error:", err);
            setSaveStatus("error");
        }
    };
    saveMapRef.current = () => {
        if (saveStatus !== "saving") {
            void saveMap();
        }
    };

    useEffect(() => {
        const handleSaveKeyDown = (e: KeyboardEvent) => {
            const isSaveShortcut = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s";
            if (!isSaveShortcut || e.repeat) {
                return;
            }

            e.preventDefault();
            saveMapRef.current?.();
        };

        window.addEventListener("keydown", handleSaveKeyDown);
        return () => window.removeEventListener("keydown", handleSaveKeyDown);
    }, []);

    const buildAreaDataFromEditor = (): AreaData => {
        // Extract trees and decorations from props layer, merging with detailed state for metadata
        const gridProps = extractPropsFromLayer(propsLayer);
        const mergedTrees: TreeLocation[] = gridProps.trees.map(gt => {
            // Find matching tree in state for metadata (size), grid-derived type wins
            const stateTree = trees.find(t => Math.floor(t.x) === gt.x && Math.floor(t.z) === gt.z);
            const normalizedType = gt.type ?? stateTree?.type ?? "pine";
            const sourceSize = stateTree?.size ?? gt.size;
            return {
                x: gt.x,
                z: gt.z,
                size: clampTreeSizeByType(sourceSize, normalizedType),
                type: normalizedType,
            };
        });
        const mergedDecorations: Decoration[] = gridProps.decorations.map(gd => {
            // Find matching decoration in state for metadata (rotation, size)
            const stateDec = decorations.find(d => Math.floor(d.x) === gd.x && Math.floor(d.z) === gd.z);
            return stateDec ? { ...stateDec } : { x: gd.x, z: gd.z, type: gd.type };
        });

        // Extract enemies and chests from entities layer, merging with detailed state
        const gridEntities = extractEntitiesFromGrid(entitiesLayer);
        const rawEnemySpawns: EnemySpawn[] = gridEntities.enemies.map(ge => {
            const stateEnemy = entities.find(e => e.type === "enemy" && Math.floor(e.x) === ge.x && Math.floor(e.z) === ge.z);
            return { x: ge.x + 0.5, z: ge.z + 0.5, type: stateEnemy?.enemyType ?? "skeleton_warrior" };
        });
        const enemySpawns = sanitizeEnemySpawns(
            rawEnemySpawns,
            geometryLayer,
            terrainLayer,
            propsLayer,
            metadata.width,
            metadata.height
        );
        const chestList: ChestLocation[] = gridEntities.chests.map(gc => {
            const stateChest = entities.find(e => e.type === "chest" && Math.floor(e.x) === gc.x && Math.floor(e.z) === gc.z);
            if (stateChest) {
                const contents = (stateChest.chestItems ?? "").split(",").filter(Boolean).map(item => {
                    const [itemId, qty] = item.split(":");
                    return { itemId, quantity: parseInt(qty) || 1 };
                });
                const chest: ChestLocation = { x: gc.x + 0.5, z: gc.z + 0.5, contents };
                if (stateChest.chestGold) chest.gold = stateChest.chestGold;
                if (stateChest.chestLocked) {
                    chest.locked = true;
                    if (stateChest.chestLocked !== "true") chest.requiredKeyId = stateChest.chestLocked;
                }
                return chest;
            }
            return { x: gc.x + 0.5, z: gc.z + 0.5, contents: [] };
        });

        // Transitions come from state (can't be represented well in grid)
        const transitionList: AreaTransition[] = entities
            .filter(e => e.type === "transition")
            .map(e => ({
                x: e.x, z: e.z, w: e.transitionW ?? 1, h: e.transitionH ?? 1,
                targetArea: e.transitionTarget!,
                targetSpawn: { x: e.transitionSpawnX ?? 0, z: e.transitionSpawnZ ?? 0 },
                direction: e.transitionDirection ?? "north"
            }));

        // Candles come from state
        const candleList = entities
            .filter(e => e.type === "candle" || e.type === "torch")
            .map(e => {
                const kind: "candle" | "torch" = e.type === "torch" ? "torch" : "candle";
                const defaultColor = kind === "torch" ? DEFAULT_TORCH_LIGHT_COLOR : DEFAULT_CANDLE_LIGHT_COLOR;
                const normalizedColor = normalizeLightHexColor(e.lightColor, defaultColor);
                return {
                    x: e.x,
                    z: e.z,
                    dx: e.candleDx ?? 0,
                    dz: e.candleDz ?? 0,
                    kind,
                    lightColor: normalizedColor,
                };
            });

        // High lights come from state
        const lightList: AreaLight[] = entities
            .filter(e => e.type === "light")
            .map(e => ({
                x: e.x,
                z: e.z,
                radius: clampFiniteNumber(e.lightRadius, 1, 60, DEFAULT_AREA_LIGHT_RADIUS),
                angle: clampFiniteNumber(e.lightAngle, 5, 90, DEFAULT_AREA_LIGHT_ANGLE),
                tint: normalizeLightHexColor(e.lightColor, DEFAULT_AREA_LIGHT_TINT),
                brightness: clampFiniteNumber(e.lightBrightness, 0, 50, DEFAULT_AREA_LIGHT_BRIGHTNESS),
                height: clampFiniteNumber(e.lightHeight, 1, 30, DEFAULT_AREA_LIGHT_HEIGHT),
                diffusion: clampFiniteNumber(e.lightDiffusion, 0, 1, DEFAULT_AREA_LIGHT_DIFFUSION),
                decay: clampFiniteNumber(e.lightDecay, 0, 3, DEFAULT_AREA_LIGHT_DECAY),
            }));

        // Secret doors come from state
        const secretDoorList = entities
            .filter(e => e.type === "secret_door")
            .map(e => ({
                x: e.x, z: e.z,
                blockingWall: { x: e.secretBlockX ?? 0, z: e.secretBlockZ ?? 0, w: e.secretBlockW ?? 1, h: e.secretBlockH ?? 1 }
            }));

        return {
            id: metadata.id as AreaId,
            name: metadata.name,
            flavor: metadata.flavor,
            gridSize: Math.max(metadata.width, metadata.height),
            gridWidth: metadata.width,
            gridHeight: metadata.height,
            backgroundColor: metadata.background,
            groundColor: metadata.ground,
            ambientLight: metadata.ambient,
            directionalLight: metadata.directional,
            hasFogOfWar: metadata.fog,
            defaultSpawn: { x: metadata.spawnX, z: metadata.spawnZ },
            geometry: geometryLayer,
            terrain: terrainLayer,
            floor: floorLayer,
            enemySpawns,
            transitions: transitionList,
            chests: chestList,
            trees: mergedTrees,
            decorations: mergedDecorations.length > 0 ? mergedDecorations : undefined,
            candles: candleList.length > 0 ? candleList : undefined,
            lights: lightList.length > 0 ? lightList : undefined,
            secretDoors: secretDoorList.length > 0 ? secretDoorList : undefined,
        };
    };

    const getBrushOptions = (): { char: string; label: string }[] => {
        return LAYER_BRUSHES[activeLayer];
    };

    const availableAreaIds = getAvailableAreaIds();
    const selectedAreaId = availableAreaIds.includes(metadata.id) ? metadata.id : "";

    return (
        <div style={{ display: "flex", height: "100vh", background: "#1a1a2e", color: "#eee" }}>
            <button
                onClick={saveMap}
                disabled={saveStatus === "saving"}
                title="Save map (Ctrl+S)"
                style={{
                    position: "fixed",
                    top: 16,
                    right: 16,
                    zIndex: 1000,
                    padding: "14px 34px",
                    fontSize: 18,
                    fontWeight: 600,
                    background: saveStatus === "saved" ? "#2a6" : saveStatus === "error" ? "#a44" : "#4a9",
                    color: "#fff",
                    border: "none",
                    borderRadius: 6,
                    cursor: saveStatus === "saving" ? "wait" : "pointer",
                    boxShadow: "0 4px 10px rgba(0, 0, 0, 0.35)",
                }}
            >
                {saveStatus === "saving" ? "Saving..." : saveStatus === "saved" ? "Saved!" : saveStatus === "error" ? "Error" : "Save Map"}
            </button>

            {/* Left Panel - Tools */}
            <div style={{ width: 280, padding: 20, borderRight: "1px solid #333", display: "flex", flexDirection: "column", gap: 20, overflowY: "auto" }}>
                <Link to="/" style={{ color: "#4af", textDecoration: "none" }}>&larr; Back to Game</Link>

                <h2 style={{ margin: 0, fontSize: 22 }}>Map Editor</h2>

                {/* Load Existing Area */}
                <div>
                    <h3 style={{ margin: "0 0 12px", fontSize: 16 }}>Load Area</h3>
                    <select
                        value={selectedAreaId}
                        onChange={(e) => e.target.value && loadArea(e.target.value as AreaId)}
                        style={{
                            width: "100%",
                            padding: "8px 12px",
                            fontSize: 14,
                            background: "#333",
                            color: "#fff",
                            border: "1px solid #555",
                            borderRadius: 4,
                        }}
                    >
                        <option value="">-- Select area --</option>
                        {availableAreaIds.map((id: string) => (
                            <option key={id} value={id}>{id}</option>
                        ))}
                    </select>
                    <button
                        onClick={createNewArea}
                        style={{
                            width: "100%",
                            marginTop: 8,
                            padding: "8px 12px",
                            fontSize: 14,
                            background: "#4a9",
                            color: "#fff",
                            border: "none",
                            borderRadius: 4,
                            cursor: "pointer",
                        }}
                    >
                        + New Area
                    </button>
                </div>

                {/* Layer Selection */}
                <div>
                    <h3 style={{ margin: "0 0 12px", fontSize: 16 }}>Layers</h3>
                    {(["geometry", "terrain", "floor", "props", "entities"] as Layer[]).map(layer => (
                        <div key={layer} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                            <input
                                type="checkbox"
                                checked={layerVisibility[layer]}
                                onChange={() => setLayerVisibility(prev => ({ ...prev, [layer]: !prev[layer] }))}
                                style={{ width: 18, height: 18 }}
                            />
                            <button
                                onClick={() => { setActiveLayer(layer); setActiveBrush(getBrushOptions()[0]?.char ?? "."); }}
                                style={{
                                    flex: 1,
                                    padding: "8px 12px",
                                    fontSize: 14,
                                    background: activeLayer === layer ? getLayerColor(layer) : "#333",
                                    color: "#fff",
                                    border: "none",
                                    borderRadius: 4,
                                    cursor: "pointer",
                                    textTransform: "capitalize",
                                }}
                            >
                                {layer}
                            </button>
                        </div>
                    ))}
                </div>

                {/* Tools */}
                <div>
                    <h3 style={{ margin: "0 0 12px", fontSize: 16 }}>Tools</h3>
                    <div style={{ display: "flex", gap: 8 }}>
                        {(["paint", "erase"] as Tool[]).map(tool => (
                            <button
                                key={tool}
                                onClick={() => setActiveTool(tool)}
                                style={{
                                    flex: 1,
                                    padding: "10px 16px",
                                    fontSize: 14,
                                    background: activeTool === tool ? "#4a9" : "#333",
                                    color: "#fff",
                                    border: "none",
                                    borderRadius: 4,
                                    cursor: "pointer",
                                    textTransform: "capitalize",
                                }}
                            >
                                {tool}
                            </button>
                        ))}
                    </div>
                    <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                        <Tippy content="Undo (Ctrl+Z)" delay={0}>
                            <button
                                onClick={undo}
                                style={{ flex: 1, padding: 8, background: "#333", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontSize: 12 }}
                            >
                                Undo
                            </button>
                        </Tippy>
                        <Tippy content="Redo (Ctrl+Y)" delay={0}>
                            <button
                                onClick={redo}
                                style={{ flex: 1, padding: 8, background: "#333", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontSize: 12 }}
                            >
                                Redo
                            </button>
                        </Tippy>
                    </div>
                    <div style={{ marginTop: 12 }}>
                        <span style={{ fontSize: 13 }}>Brush Size: {brushSize}x{brushSize}</span>
                        <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                            {[1, 2, 3, 5, 8].map(size => (
                                <button
                                    key={size}
                                    onClick={() => setBrushSize(size)}
                                    style={{
                                        flex: 1,
                                        padding: "6px 0",
                                        fontSize: 12,
                                        background: brushSize === size ? "#4a9" : "#333",
                                        color: "#fff",
                                        border: "none",
                                        borderRadius: 4,
                                        cursor: "pointer",
                                    }}
                                >
                                    {size}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Brush */}
                <div>
                    <h3 style={{ margin: "0 0 12px", fontSize: 16 }}>Brush ({activeLayer})</h3>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                        {getBrushOptions().map(opt => (
                            <Tippy key={opt.char} content={opt.label} delay={0}>
                                <button
                                    onClick={() => setActiveBrush(opt.char)}
                                    style={{
                                        width: 48,
                                        height: 48,
                                        background: activeBrush === opt.char ? getCharColor(opt.char, activeLayer) : "#333",
                                        color: "#fff",
                                        border: activeBrush === opt.char ? "2px solid #fff" : "1px solid #555",
                                        borderRadius: 6,
                                        cursor: "pointer",
                                        fontSize: 20,
                                    }}
                                >
                                    {opt.char}
                                </button>
                            </Tippy>
                        ))}
                    </div>
                </div>

                {/* Grid Toggle */}
                <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14 }}>
                    <input type="checkbox" checked={showGrid} onChange={() => setShowGrid(!showGrid)} style={{ width: 18, height: 18 }} />
                    Show Grid
                </label>

                {/* Isometric Toggle */}
                <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14 }}>
                    <input type="checkbox" checked={isometric} onChange={() => setIsometric(!isometric)} style={{ width: 18, height: 18 }} />
                    Isometric View
                </label>

                {/* Zoom */}
                <div>
                    <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>Zoom: {Math.round(zoom * 100)}%</h3>
                    <div style={{ display: "flex", gap: 8 }}>
                        <button onClick={() => setZoom(z => Math.max(0.25, z - 0.25))} style={{ flex: 1, padding: 8, background: "#333", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}>-</button>
                        <button onClick={() => setZoom(1)} style={{ flex: 1, padding: 8, background: "#333", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}>Reset</button>
                        <button onClick={() => setZoom(z => Math.min(3, z + 0.25))} style={{ flex: 1, padding: 8, background: "#333", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}>+</button>
                    </div>
                </div>
            </div>

            {/* Center - Canvas */}
            <div style={{ flex: 1, overflow: "auto", padding: 16, background: metadata.background }}>
                <div style={{
                    perspective: isometric ? "1000px" : "none",
                    perspectiveOrigin: "center center",
                }}>
                    <canvas
                        ref={canvasRef}
                        onMouseDown={handleCanvasMouseDown}
                        onMouseMove={handleCanvasMouseMove}
                        onMouseUp={handleCanvasMouseUp}
                        onMouseLeave={() => { setIsPainting(false); setDoorDrag(null); }}
                        onContextMenu={handleCanvasContextMenu}
                        style={{
                            border: "1px solid #333",
                            cursor: isometric ? "default" : "crosshair",
                            transform: isometric ? "rotateX(60deg) rotateZ(45deg)" : "none",
                            transformOrigin: "center center",
                            transition: "transform 0.3s ease",
                        }}
                    />
                </div>

                {contextMenu && (
                    <div
                        style={{
                            position: "fixed",
                            left: contextMenu.screenX,
                            top: contextMenu.screenY,
                            minWidth: 188,
                            padding: 6,
                            borderRadius: 8,
                            background: "#1f2330",
                            border: "1px solid #4a4f61",
                            boxShadow: "0 8px 24px rgba(0, 0, 0, 0.45)",
                            zIndex: 2200,
                            display: "flex",
                            flexDirection: "column",
                            gap: 4,
                        }}
                        onPointerDown={event => event.stopPropagation()}
                        onContextMenu={event => event.preventDefault()}
                    >
                        <button
                            onClick={() => {
                                openPropertiesPopup(contextMenu);
                                setContextMenu(null);
                            }}
                            disabled={!contextMenu.entity && !contextMenu.tree && !contextMenu.decoration}
                            style={{
                                textAlign: "left",
                                padding: "8px 10px",
                                fontSize: 13,
                                borderRadius: 6,
                                border: "1px solid #414655",
                                background: "#2a3040",
                                color: "#fff",
                                cursor: contextMenu.entity || contextMenu.tree || contextMenu.decoration ? "pointer" : "not-allowed",
                                opacity: contextMenu.entity || contextMenu.tree || contextMenu.decoration ? 1 : 0.45,
                            }}
                        >
                            Properties
                        </button>
                        <button
                            onClick={() => {
                                copyFromContextMenu(contextMenu);
                                setContextMenu(null);
                            }}
                            disabled={!contextMenu.entity && !contextMenu.tree && !contextMenu.decoration}
                            style={{
                                textAlign: "left",
                                padding: "8px 10px",
                                fontSize: 13,
                                borderRadius: 6,
                                border: "1px solid #414655",
                                background: "#2a3040",
                                color: "#fff",
                                cursor: contextMenu.entity || contextMenu.tree || contextMenu.decoration ? "pointer" : "not-allowed",
                                opacity: contextMenu.entity || contextMenu.tree || contextMenu.decoration ? 1 : 0.45,
                            }}
                        >
                            Copy
                        </button>
                        <button
                            onClick={() => {
                                pasteClipboardAt(contextMenu.tileX, contextMenu.tileZ);
                                setContextMenu(null);
                            }}
                            disabled={!clipboard}
                            style={{
                                textAlign: "left",
                                padding: "8px 10px",
                                fontSize: 13,
                                borderRadius: 6,
                                border: "1px solid #414655",
                                background: "#2a3040",
                                color: "#fff",
                                cursor: clipboard ? "pointer" : "not-allowed",
                                opacity: clipboard ? 1 : 0.45,
                            }}
                        >
                            Paste (overwrite)
                        </button>
                    </div>
                )}

                {/* Entity Edit Popup */}
                {editingEntity && (
                    <EntityEditPopup
                        entity={editingEntity.entity}
                        screenX={editingEntity.screenX}
                        screenY={editingEntity.screenY}
                        onSave={updateEntity}
                        onClose={() => setEditingEntity(null)}
                        onNavigate={(areaId) => {
                            setEditingEntity(null);
                            loadArea(areaId);
                        }}
                    />
                )}

                {/* Tree Edit Popup */}
                {editingTree && (
                    <TreeEditPopup
                        tree={editingTree.tree}
                        screenX={editingTree.screenX}
                        screenY={editingTree.screenY}
                        onSave={(t) => updateTree(editingTree.index, t)}
                        onClose={() => setEditingTree(null)}
                    />
                )}

                {/* Decoration Edit Popup */}
                {editingDecoration && (
                    <DecorationEditPopup
                        decoration={editingDecoration.decoration}
                        screenX={editingDecoration.screenX}
                        screenY={editingDecoration.screenY}
                        onSave={(d) => updateDecoration(editingDecoration.index, d)}
                        onClose={() => setEditingDecoration(null)}
                    />
                )}
            </div>

            {/* Right Panel - Metadata */}
            <div style={{ width: 500, padding: 20, borderLeft: "1px solid #333", display: "flex", flexDirection: "column", gap: 16, overflowY: "auto" }}>
                <h3 style={{ margin: 0, fontSize: 18 }}>Map Properties</h3>

                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <span style={{ fontSize: 13 }}>ID</span>
                    <input
                        value={metadata.id}
                        onChange={e => setMetadata(prev => ({ ...prev, id: e.target.value }))}
                        style={{ padding: 8, fontSize: 14, background: "#333", border: "1px solid #555", borderRadius: 4, color: "#fff" }}
                    />
                </label>

                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <span style={{ fontSize: 13 }}>Name</span>
                    <input
                        value={metadata.name}
                        onChange={e => setMetadata(prev => ({ ...prev, name: e.target.value }))}
                        style={{ padding: 8, fontSize: 14, background: "#333", border: "1px solid #555", borderRadius: 4, color: "#fff" }}
                    />
                </label>

                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <span style={{ fontSize: 13 }}>Flavor Text</span>
                    <textarea
                        value={metadata.flavor}
                        onChange={e => setMetadata(prev => ({ ...prev, flavor: e.target.value }))}
                        rows={2}
                        style={{ padding: 8, fontSize: 14, background: "#333", border: "1px solid #555", borderRadius: 4, color: "#fff", resize: "vertical" }}
                    />
                </label>

                <div style={{ display: "flex", gap: 12 }}>
                    <label style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
                        <span style={{ fontSize: 13 }}>Width</span>
                        <input
                            type="number"
                            value={metadata.width}
                            onChange={e => setMetadata(prev => ({ ...prev, width: Math.max(5, Math.min(50, parseInt(e.target.value) || 5)) }))}
                            style={{ padding: 8, fontSize: 14, background: "#333", border: "1px solid #555", borderRadius: 4, color: "#fff" }}
                        />
                    </label>
                    <label style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
                        <span style={{ fontSize: 13 }}>Height</span>
                        <input
                            type="number"
                            value={metadata.height}
                            onChange={e => setMetadata(prev => ({ ...prev, height: Math.max(5, Math.min(50, parseInt(e.target.value) || 5)) }))}
                            style={{ padding: 8, fontSize: 14, background: "#333", border: "1px solid #555", borderRadius: 4, color: "#fff" }}
                        />
                    </label>
                </div>

                <div style={{ display: "flex", gap: 12 }}>
                    <label style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
                        <span style={{ fontSize: 13 }}>Background</span>
                        <input
                            type="color"
                            value={metadata.background}
                            onChange={e => setMetadata(prev => ({ ...prev, background: e.target.value }))}
                            style={{ padding: 2, height: 40, background: "#333", border: "1px solid #555", borderRadius: 4 }}
                        />
                    </label>
                    <label style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
                        <span style={{ fontSize: 13 }}>Ground</span>
                        <input
                            type="color"
                            value={metadata.ground}
                            onChange={e => setMetadata(prev => ({ ...prev, ground: e.target.value }))}
                            style={{ padding: 2, height: 40, background: "#333", border: "1px solid #555", borderRadius: 4 }}
                        />
                    </label>
                </div>

                <div style={{ display: "flex", gap: 12 }}>
                    <label style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
                        <span style={{ fontSize: 13 }}>Ambient</span>
                        <input
                            type="range"
                            min="0"
                            max="1"
                            step="0.05"
                            value={metadata.ambient}
                            onChange={e => setMetadata(prev => ({ ...prev, ambient: parseFloat(e.target.value) }))}
                        />
                        <span style={{ fontSize: 12, textAlign: "center" }}>{metadata.ambient}</span>
                    </label>
                    <label style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
                        <span style={{ fontSize: 13 }}>Directional</span>
                        <input
                            type="range"
                            min="0"
                            max="1"
                            step="0.05"
                            value={metadata.directional}
                            onChange={e => setMetadata(prev => ({ ...prev, directional: parseFloat(e.target.value) }))}
                        />
                        <span style={{ fontSize: 12, textAlign: "center" }}>{metadata.directional}</span>
                    </label>
                </div>

                <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14 }}>
                    <input
                        type="checkbox"
                        checked={metadata.fog}
                        onChange={e => setMetadata(prev => ({ ...prev, fog: e.target.checked }))}
                        style={{ width: 18, height: 18 }}
                    />
                    Fog of War
                </label>

                <div style={{ display: "flex", gap: 12 }}>
                    <label style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
                        <span style={{ fontSize: 13 }}>Spawn X</span>
                        <input
                            type="number"
                            value={metadata.spawnX}
                            onChange={e => setSpawnPoint(parseInt(e.target.value) || 0, metadata.spawnZ)}
                            style={{ padding: 8, fontSize: 14, background: "#333", border: "1px solid #555", borderRadius: 4, color: "#fff" }}
                        />
                    </label>
                    <label style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
                        <span style={{ fontSize: 13 }}>Spawn Z</span>
                        <input
                            type="number"
                            value={metadata.spawnZ}
                            onChange={e => setSpawnPoint(metadata.spawnX, parseInt(e.target.value) || 0)}
                            style={{ padding: 8, fontSize: 14, background: "#333", border: "1px solid #555", borderRadius: 4, color: "#fff" }}
                        />
                    </label>
                </div>

                {/* Connections Panel */}
                <div style={{ borderTop: "1px solid #444", paddingTop: 16, marginTop: 8 }}>
                    <ConnectionsPanel
                        currentAreaId={metadata.id}
                        entities={entities}
                        onEditTransition={(entity, screenX, screenY) => {
                            setEditingEntity({ entity, screenX, screenY });
                        }}
                        onNavigate={loadArea}
                    />
                </div>
            </div>
        </div>
    );
}

// =============================================================================
// HELPERS
// =============================================================================

function normalizeLightHexColor(color: string | undefined, fallback: string): string {
    if (typeof color === "string" && /^#[0-9a-fA-F]{6}$/.test(color)) {
        return color.toLowerCase();
    }
    return fallback;
}

function clampFiniteNumber(value: number | undefined, min: number, max: number, fallback: number): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return fallback;
    }
    return Math.max(min, Math.min(max, value));
}

function createEmptyLayer(width: number, height: number, fill: string): string[][] {
    return Array.from({ length: height }, () => Array(width).fill(fill));
}

function resizeLayer(layer: string[][], newWidth: number, newHeight: number, fill: string): string[][] {
    const result: string[][] = [];
    for (let z = 0; z < newHeight; z++) {
        const row: string[] = [];
        for (let x = 0; x < newWidth; x++) {
            if (z < layer.length && x < layer[z].length) {
                row.push(layer[z][x]);
            } else {
                row.push(fill);
            }
        }
        result.push(row);
    }
    return result;
}

// =============================================================================
// AREA DATA CONVERSION HELPERS
// =============================================================================

function computePropsFromArea(area: AreaData, width: number, height: number): string[][] {
    const grid: string[][] = Array.from({ length: height }, () => Array(width).fill("."));

    for (const tree of area.trees) {
        const x = Math.floor(tree.x);
        const z = Math.floor(tree.z);
        if (x >= 0 && x < width && z >= 0 && z < height) {
            grid[z][x] = PROP_TREE_TYPE_TO_CHAR.get(tree.type ?? "pine") ?? "T";
        }
    }

    if (area.decorations) {
        for (const dec of area.decorations) {
            const x = Math.floor(dec.x);
            const z = Math.floor(dec.z);
            if (x >= 0 && x < width && z >= 0 && z < height) {
                const char = PROP_TYPE_TO_CHAR.get(dec.type);
                if (char) grid[z][x] = char;
            }
        }
    }

    return grid;
}

function computeEntitiesFromArea(area: AreaData, width: number, height: number): string[][] {
    const grid: string[][] = Array.from({ length: height }, () => Array(width).fill("."));

    // Spawn point
    const sx = Math.floor(area.defaultSpawn.x);
    const sz = Math.floor(area.defaultSpawn.z);
    if (sx >= 0 && sx < width && sz >= 0 && sz < height) grid[sz][sx] = "@";

    // Enemies
    for (const enemy of area.enemySpawns) {
        const x = Math.floor(enemy.x);
        const z = Math.floor(enemy.z);
        if (x >= 0 && x < width && z >= 0 && z < height) grid[z][x] = "E";
    }

    // Chests
    for (const chest of area.chests) {
        const x = Math.floor(chest.x);
        const z = Math.floor(chest.z);
        if (x >= 0 && x < width && z >= 0 && z < height) grid[z][x] = "X";
    }

    // Transitions (doors) - fill entire door area for multi-tile doors
    for (const trans of area.transitions) {
        const startX = Math.floor(trans.x);
        const startZ = Math.floor(trans.z);
        for (let dz = 0; dz < trans.h; dz++) {
            for (let dx = 0; dx < trans.w; dx++) {
                const x = startX + dx;
                const z = startZ + dz;
                if (x >= 0 && x < width && z >= 0 && z < height) grid[z][x] = "D";
            }
        }
    }

    // Candles
    if (area.candles) {
        for (const candle of area.candles) {
            const x = Math.floor(candle.x);
            const z = Math.floor(candle.z);
            if (x >= 0 && x < width && z >= 0 && z < height) {
                grid[z][x] = candle.kind === "torch" ? "Y" : "L";
            }
        }
    }

    // High lights
    if (area.lights) {
        for (const light of area.lights) {
            const x = Math.floor(light.x);
            const z = Math.floor(light.z);
            if (x >= 0 && x < width && z >= 0 && z < height) grid[z][x] = "H";
        }
    }

    // Secret doors
    if (area.secretDoors) {
        for (const sd of area.secretDoors) {
            const x = Math.floor(sd.x);
            const z = Math.floor(sd.z);
            if (x >= 0 && x < width && z >= 0 && z < height) grid[z][x] = "S";
        }
    }

    return grid;
}

function extractPropsFromLayer(props: string[][]): { trees: TreeLocation[]; decorations: Decoration[] } {
    const trees: TreeLocation[] = [];
    const decorations: Decoration[] = [];

    for (let z = 0; z < props.length; z++) {
        for (let x = 0; x < props[z].length; x++) {
            const char = props[z][x];
            if (PROP_TREE_CHARS.has(char)) {
                trees.push({ x, z, size: 1.0, type: PROP_CHAR_TO_TREE_TYPE.get(char) });
            } else {
                const decType = PROP_CHAR_TO_TYPE.get(char);
                if (decType) {
                    decorations.push({ x, z, type: decType });
                }
            }
        }
    }

    return { trees, decorations };
}

function extractEntitiesFromGrid(entitiesLayer: string[][]): { enemies: { x: number; z: number }[]; chests: { x: number; z: number }[] } {
    const enemies: { x: number; z: number }[] = [];
    const chests: { x: number; z: number }[] = [];

    for (let z = 0; z < entitiesLayer.length; z++) {
        for (let x = 0; x < entitiesLayer[z].length; x++) {
            const char = entitiesLayer[z][x];
            if (char === "E") enemies.push({ x, z });
            else if (char === "X") chests.push({ x, z });
        }
    }

    return { enemies, chests };
}

const NON_BLOCKING_PROP_DECORATIONS = new Set<Decoration["type"]>([
    "small_rock",
    "mushroom",
    "small_mushroom",
    "fern",
    "small_fern",
    "weeds",
    "small_weeds",
]);

function clampTreeSizeByType(size: number, treeType: TreeLocation["type"]): number {
    const normalizedType = treeType ?? "pine";
    const clampedBase = Math.max(MIN_TREE_SIZE, Math.min(MAX_TREE_SIZE, Number.isFinite(size) ? size : 1));
    if (normalizedType === "pine") {
        return Math.min(clampedBase, MAX_PINE_TREE_SIZE);
    }
    return clampedBase;
}

function isBlockingPropCell(propsLayer: string[][], x: number, z: number): boolean {
    const char = propsLayer[z]?.[x] ?? ".";
    if (PROP_TREE_CHARS.has(char)) {
        return true;
    }
    const decType = PROP_CHAR_TO_TYPE.get(char);
    if (!decType) {
        return false;
    }
    return !NON_BLOCKING_PROP_DECORATIONS.has(decType);
}

function isValidEnemySpawnCell(
    x: number,
    z: number,
    geometryLayer: string[][],
    terrainLayer: string[][],
    propsLayer: string[][],
    width: number,
    height: number,
    occupied: Set<string>
): boolean {
    if (x < 0 || z < 0 || x >= width || z >= height) {
        return false;
    }

    if ((geometryLayer[z]?.[x] ?? "#") !== ".") {
        return false;
    }

    const terrain = terrainLayer[z]?.[x] ?? ".";
    if (terrain === "~" || terrain === "w") {
        return false;
    }

    if (isBlockingPropCell(propsLayer, x, z)) {
        return false;
    }

    return !occupied.has(`${x},${z}`);
}

function findNearestValidEnemySpawnCell(
    startX: number,
    startZ: number,
    geometryLayer: string[][],
    terrainLayer: string[][],
    propsLayer: string[][],
    width: number,
    height: number,
    occupied: Set<string>
): { x: number; z: number } | null {
    if (isValidEnemySpawnCell(startX, startZ, geometryLayer, terrainLayer, propsLayer, width, height, occupied)) {
        return { x: startX, z: startZ };
    }

    const maxRadius = Math.max(width, height);
    for (let radius = 1; radius <= maxRadius; radius++) {
        let best: { x: number; z: number; distSq: number } | null = null;

        for (let dz = -radius; dz <= radius; dz++) {
            for (let dx = -radius; dx <= radius; dx++) {
                if (Math.abs(dx) !== radius && Math.abs(dz) !== radius) {
                    continue;
                }

                const x = startX + dx;
                const z = startZ + dz;
                if (!isValidEnemySpawnCell(x, z, geometryLayer, terrainLayer, propsLayer, width, height, occupied)) {
                    continue;
                }

                const distSq = dx * dx + dz * dz;
                if (
                    best === null
                    || distSq < best.distSq
                    || (distSq === best.distSq && (z < best.z || (z === best.z && x < best.x)))
                ) {
                    best = { x, z, distSq };
                }
            }
        }

        if (best) {
            return { x: best.x, z: best.z };
        }
    }

    return null;
}

function sanitizeEnemySpawns(
    spawns: EnemySpawn[],
    geometryLayer: string[][],
    terrainLayer: string[][],
    propsLayer: string[][],
    width: number,
    height: number
): EnemySpawn[] {
    const sanitized: EnemySpawn[] = [];
    const occupied = new Set<string>();

    for (const spawn of spawns) {
        const startX = Math.floor(spawn.x);
        const startZ = Math.floor(spawn.z);
        const nearest = findNearestValidEnemySpawnCell(
            startX,
            startZ,
            geometryLayer,
            terrainLayer,
            propsLayer,
            width,
            height,
            occupied
        );

        if (!nearest) {
            sanitized.push(spawn);
            continue;
        }

        occupied.add(`${nearest.x},${nearest.z}`);
        sanitized.push({ ...spawn, x: nearest.x + 0.5, z: nearest.z + 0.5 });
    }

    return sanitized;
}
