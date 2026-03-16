import { useState, useRef, useCallback, useEffect, useMemo } from "react";
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
    type AreaDialogDefinition,
    type AreaDialogTrigger,
    type AreaDialogTriggerCondition,
    type AreaLocation,
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
import { getDialogDefinitionIds } from "../dialog/registry";

// Editor modules
import type { Tool, Layer, MapMetadata, EntityDef, TreeDef, DecorationDef, EditorSnapshot } from "./types";
import { getAvailableAreaIds, BASE_CELL_SIZE, MAX_HISTORY, LAYER_BRUSHES, PROP_TYPE_TO_CHAR, PROP_TREE_TYPE_TO_CHAR } from "./constants";
import { registerAreaFromText } from "../game/areas";
import { EntityEditPopup, TreeEditPopup, DecorationEditPopup, LocationEditPopup } from "./popups";
import { ConnectionsPanel } from "./panels";
import { DialogEditorModal, ItemRegistryEditorModal } from "./components";
import {
    clampFiniteNumber,
    clampTreeSizeByType,
    computeEntitiesFromArea,
    computePropsFromArea,
    createEmptyLayer,
    extractEntitiesFromGrid,
    extractPropsFromLayer,
    isBlockingPropCell,
    normalizeLightHexColor,
    resizeLayer,
    resizeTintLayer,
    sanitizeEnemySpawns,
} from "./areaConversion";
import {
    drawLayer,
    getCharColor,
    getLayerColor,
    loadLastSavedAreaId,
    normalizeSecretDoorEntity,
    persistLastSavedAreaId,
} from "./editorViewUtils";
import {
    clampTileTintPercent,
    cloneTileLayerStack,
    cloneTintLayerStack,
    composeTileLayers,
    composeTintLayers,
    createEmptyTintGrid,
    hasTintData,
    normalizeTileLayerStack,
    normalizeTintLayerStack,
    TILE_EMPTY,
} from "../game/areas/tileLayers";
import {
    clampGridCoord,
    cloneDialogDefinition,
    cloneDialogLocation,
    cloneDialogTrigger,
    createDefaultDialogCondition,
    createDialogLocationId,
    createDialogTriggerId,
    getNextEnemySpawnIndex,
    getOrderedEnemyEntities,
    locationContainsCell,
    remapTriggerDialogTargetsInList,
    type DialogRegionDragState,
    type DragEntityBrush,
    type EditorClipboard,
    type EditorContextMenuState,
} from "./mapEditorHelpers";
import "../styles/07-map-editor.css";

// =============================================================================
// COMPONENT
// =============================================================================

const DEFAULT_AREA_ID = "area";

function normalizeAreaId(value: string, fallback: string = DEFAULT_AREA_ID): string {
    const normalized = value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, "_")
        .replace(/^_+|_+$/g, "");
    return normalized.length > 0 ? normalized : fallback;
}

interface EditorSnapshotSource {
    metadata: MapMetadata;
    geometryLayer: string[][];
    terrainLayers: string[][][];
    floorLayers: string[][][];
    terrainTintLayers: number[][][];
    floorTintLayers: number[][][];
    propsLayer: string[][];
    entitiesLayer: string[][];
    entities: EntityDef[];
    trees: TreeDef[];
    decorations: DecorationDef[];
    dialogs: AreaDialogDefinition[];
    locations: AreaLocation[];
    dialogTriggers: AreaDialogTrigger[];
}

function createEditorSnapshot(source: EditorSnapshotSource): EditorSnapshot {
    return {
        metadata: { ...source.metadata },
        geometryLayer: source.geometryLayer.map(row => [...row]),
        terrainLayers: cloneTileLayerStack(source.terrainLayers),
        floorLayers: cloneTileLayerStack(source.floorLayers),
        terrainTintLayers: cloneTintLayerStack(source.terrainTintLayers),
        floorTintLayers: cloneTintLayerStack(source.floorTintLayers),
        propsLayer: source.propsLayer.map(row => [...row]),
        entitiesLayer: source.entitiesLayer.map(row => [...row]),
        entities: source.entities.map(entity => ({ ...entity })),
        trees: source.trees.map(tree => ({ ...tree })),
        decorations: source.decorations.map(decoration => ({ ...decoration })),
        dialogs: source.dialogs.map(cloneDialogDefinition),
        locations: source.locations.map(cloneDialogLocation),
        dialogTriggers: source.dialogTriggers.map(cloneDialogTrigger),
    };
}

function getBrushCells(x: number, z: number, size: number, width: number, height: number): Array<{ x: number; z: number }> {
    const cells: Array<{ x: number; z: number }> = [];
    const halfSize = Math.floor(size / 2);
    for (let dz = -halfSize; dz < size - halfSize; dz++) {
        for (let dx = -halfSize; dx < size - halfSize; dx++) {
            const cellX = x + dx;
            const cellZ = z + dz;
            if (cellX < 0 || cellX >= width || cellZ < 0 || cellZ >= height) {
                continue;
            }
            cells.push({ x: cellX, z: cellZ });
        }
    }
    return cells;
}

function remapEnemyLinkedTriggerConditions(
    triggers: AreaDialogTrigger[],
    previousEntities: EntityDef[],
    nextEntities: EntityDef[]
): AreaDialogTrigger[] {
    const previousEnemies = getOrderedEnemyEntities(previousEntities);
    const nextEnemies = getOrderedEnemyEntities(nextEntities);
    const previousEnemyIds = previousEnemies.map(enemy => enemy.id);
    const nextEnemyIds = nextEnemies.map(enemy => enemy.id);
    const enemyOrderChanged = previousEnemyIds.length !== nextEnemyIds.length
        || previousEnemyIds.some((enemyId, index) => nextEnemyIds[index] !== enemyId);
    if (!enemyOrderChanged) {
        return triggers;
    }

    const nextIndexByEnemyId = new Map<string, number>();
    nextEnemies.forEach((enemy, index) => {
        nextIndexByEnemyId.set(enemy.id, index);
    });
    const invalidSpawnIndex = nextEnemies.length;

    return triggers.map(trigger => {
        let didChange = false;
        let removedTarget = false;
        const nextConditions = trigger.conditions.map(condition => {
            if (
                condition.type !== "enemy_killed"
                && condition.type !== "unit_seen"
                && condition.type !== "npc_engaged"
            ) {
                return condition;
            }

            const previousEnemy = previousEnemies[condition.spawnIndex];
            if (!previousEnemy) {
                return condition;
            }

            const nextIndex = nextIndexByEnemyId.get(previousEnemy.id);
            if (nextIndex === undefined) {
                didChange = true;
                removedTarget = true;
                return {
                    ...condition,
                    spawnIndex: invalidSpawnIndex,
                };
            }

            if (nextIndex === condition.spawnIndex) {
                return condition;
            }

            didChange = true;
            return {
                ...condition,
                spawnIndex: nextIndex,
            };
        });

        if (!didChange) {
            return trigger;
        }

        return {
            ...trigger,
            ...(removedTarget ? { wip: true } : {}),
            conditions: nextConditions,
        };
    });
}

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
    const [terrainLayers, setTerrainLayers] = useState<string[][][]>(() =>
        [createEmptyLayer(metadata.width, metadata.height, TILE_EMPTY)]
    );
    const [floorLayers, setFloorLayers] = useState<string[][][]>(() =>
        [createEmptyLayer(metadata.width, metadata.height, TILE_EMPTY)]
    );
    const [terrainTintLayers, setTerrainTintLayers] = useState<number[][][]>(() =>
        [createEmptyTintGrid(metadata.width, metadata.height)]
    );
    const [floorTintLayers, setFloorTintLayers] = useState<number[][][]>(() =>
        [createEmptyTintGrid(metadata.width, metadata.height)]
    );
    const [activeTerrainPaintLayer, setActiveTerrainPaintLayer] = useState(0);
    const [activeFloorPaintLayer, setActiveFloorPaintLayer] = useState(0);
    const [activeTileTint, setActiveTileTint] = useState(0);
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
    const [dialogs, setDialogs] = useState<AreaDialogDefinition[]>([]);
    const [dialogLocations, setDialogLocations] = useState<AreaLocation[]>([]);
    const [dialogTriggers, setDialogTriggers] = useState<AreaDialogTrigger[]>([]);

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
        locations: true,
    });
    const [selectedDialogLocationId, setSelectedDialogLocationId] = useState<string | null>(null);

    // Canvas refs
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const saveMapRef = useRef<(() => void) | null>(null);
    const [isPainting, setIsPainting] = useState(false);
    const [zoom, setZoom] = useState(1);
    const [isometric, setIsometric] = useState(false);
    const ISO_ZOOM = 0.5;  // Fixed zoom for isometric view

    // Door/secret-door drag state for click-drag placement
    const [doorDrag, setDoorDrag] = useState<{ brush: DragEntityBrush; startX: number; startZ: number; endX: number; endZ: number } | null>(null);
    const [dialogRegionDrag, setDialogRegionDrag] = useState<DialogRegionDragState | null>(null);
    const dialogRegionDragRef = useRef<DialogRegionDragState | null>(null);
    const [dialogTriggersDraft, setDialogTriggersDraft] = useState<AreaDialogTrigger[] | null>(null);
    const [dialogEditorOpen, setDialogEditorOpen] = useState(false);
    const [itemRegistryEditorOpen, setItemRegistryEditorOpen] = useState(false);
    const [itemRegistryRevision, setItemRegistryRevision] = useState(0);
    const activeDialogTriggers = dialogTriggersDraft ?? dialogTriggers;

    const composedTerrainLayer = useMemo(
        () => composeTileLayers(terrainLayers, metadata.width, metadata.height, TILE_EMPTY),
        [terrainLayers, metadata.width, metadata.height]
    );
    const composedFloorLayer = useMemo(
        () => composeTileLayers(floorLayers, metadata.width, metadata.height, TILE_EMPTY),
        [floorLayers, metadata.width, metadata.height]
    );
    const composedTerrainTintLayer = useMemo(
        () => composeTintLayers(terrainLayers, terrainTintLayers, metadata.width, metadata.height, TILE_EMPTY),
        [terrainLayers, terrainTintLayers, metadata.width, metadata.height]
    );
    const composedFloorTintLayer = useMemo(
        () => composeTintLayers(floorLayers, floorTintLayers, metadata.width, metadata.height, TILE_EMPTY),
        [floorLayers, floorTintLayers, metadata.width, metadata.height]
    );
    const registryDialogIds = useMemo(() => getDialogDefinitionIds(), []);
    const availableDialogIds = useMemo(() => {
        const ids = new Set<string>();
        dialogs.forEach(dialog => {
            if (dialog.id.trim().length > 0) {
                ids.add(dialog.id);
            }
        });
        registryDialogIds.forEach(dialogId => ids.add(dialogId));
        return Array.from(ids).sort((a, b) => a.localeCompare(b));
    }, [dialogs, registryDialogIds]);
    const availableDialogIdSet = useMemo(() => new Set(availableDialogIds), [availableDialogIds]);

    useEffect(() => {
        if (dialogLocations.length === 0) {
            if (selectedDialogLocationId !== null) {
                setSelectedDialogLocationId(null);
            }
            return;
        }
        if (!selectedDialogLocationId || !dialogLocations.some(location => location.id === selectedDialogLocationId)) {
            setSelectedDialogLocationId(dialogLocations[0].id);
        }
    }, [dialogLocations, selectedDialogLocationId]);

    // Entity editor popup
    const [editingEntity, setEditingEntity] = useState<{ entity: EntityDef; screenX: number; screenY: number } | null>(null);
    const [editingTree, setEditingTree] = useState<{ tree: TreeDef; index: number; screenX: number; screenY: number } | null>(null);
    const [editingDecoration, setEditingDecoration] = useState<{ decoration: DecorationDef; index: number; screenX: number; screenY: number } | null>(null);
    const [editingLocation, setEditingLocation] = useState<{ location: AreaLocation; screenX: number; screenY: number } | null>(null);
    const [clipboard, setClipboard] = useState<EditorClipboard | null>(null);
    const [contextMenu, setContextMenu] = useState<EditorContextMenuState | null>(null);

    // Undo/Redo history
    const historyRef = useRef<EditorSnapshot[]>([]);
    const historyIndexRef = useRef(-1);

    const createSnapshot = useCallback((): EditorSnapshot => createEditorSnapshot({
        metadata,
        geometryLayer,
        terrainLayers,
        floorLayers,
        terrainTintLayers,
        floorTintLayers,
        propsLayer,
        entitiesLayer,
        entities,
        trees,
        decorations,
        dialogs,
        locations: dialogLocations,
        dialogTriggers,
    }), [metadata, geometryLayer, terrainLayers, floorLayers, terrainTintLayers, floorTintLayers, propsLayer, entitiesLayer, entities, trees, decorations, dialogs, dialogLocations, dialogTriggers]);

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

    const resetHistory = useCallback((snapshot: EditorSnapshot): void => {
        historyRef.current = [snapshot];
        historyIndexRef.current = 0;
    }, []);

    const applySnapshot = useCallback((snapshot: EditorSnapshot) => {
        setMetadata({ ...snapshot.metadata });
        setGeometryLayer(snapshot.geometryLayer.map(row => [...row]));
        setTerrainLayers(cloneTileLayerStack(snapshot.terrainLayers));
        setFloorLayers(cloneTileLayerStack(snapshot.floorLayers));
        setTerrainTintLayers(cloneTintLayerStack(snapshot.terrainTintLayers));
        setFloorTintLayers(cloneTintLayerStack(snapshot.floorTintLayers));
        setPropsLayer(snapshot.propsLayer.map(row => [...row]));
        setEntitiesLayer(snapshot.entitiesLayer.map(row => [...row]));
        setEntities(snapshot.entities.map(e => ({ ...e })));
        setTrees(snapshot.trees.map(t => ({ ...t })));
        setDecorations(snapshot.decorations.map(d => ({ ...d })));
        setDialogs(snapshot.dialogs.map(cloneDialogDefinition));
        setDialogLocations(snapshot.locations.map(cloneDialogLocation));
        setSelectedDialogLocationId(snapshot.locations[0]?.id ?? null);
        setDialogTriggers(snapshot.dialogTriggers.map(cloneDialogTrigger));
        setDialogTriggersDraft(null);
        setDialogRegionDrag(null);
        setDialogEditorOpen(false);
        setEditingLocation(null);
        setContextMenu(null);
    }, []);

    const setMetadataWithHistory = useCallback((updater: (prev: MapMetadata) => MapMetadata): void => {
        pushHistory();
        setMetadata(prev => updater(prev));
    }, [pushHistory]);

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

    useEffect(() => {
        setTerrainLayer(composedTerrainLayer);
    }, [composedTerrainLayer]);

    useEffect(() => {
        setFloorLayer(composedFloorLayer);
    }, [composedFloorLayer]);

    useEffect(() => {
        dialogRegionDragRef.current = dialogRegionDrag;
    }, [dialogRegionDrag]);

    useEffect(() => {
        setActiveTerrainPaintLayer(prev => Math.max(0, Math.min(prev, terrainLayers.length - 1)));
    }, [terrainLayers.length]);

    useEffect(() => {
        setActiveFloorPaintLayer(prev => Math.max(0, Math.min(prev, floorLayers.length - 1)));
    }, [floorLayers.length]);

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
        setTerrainLayers(prev => normalizeTileLayerStack(
            prev.map(layer => resizeLayer(layer, metadata.width, metadata.height, TILE_EMPTY)),
            metadata.width,
            metadata.height,
            TILE_EMPTY
        ));
        setFloorLayers(prev => normalizeTileLayerStack(
            prev.map(layer => resizeLayer(layer, metadata.width, metadata.height, TILE_EMPTY)),
            metadata.width,
            metadata.height,
            TILE_EMPTY
        ));
        setTerrainTintLayers(prev => normalizeTintLayerStack(
            prev.map(layer => resizeTintLayer(layer, metadata.width, metadata.height)),
            Math.max(1, terrainLayers.length),
            metadata.width,
            metadata.height
        ));
        setFloorTintLayers(prev => normalizeTintLayerStack(
            prev.map(layer => resizeTintLayer(layer, metadata.width, metadata.height)),
            Math.max(1, floorLayers.length),
            metadata.width,
            metadata.height
        ));
        setPropsLayer(prev => resizeLayer(prev, metadata.width, metadata.height, "."));
        setEntitiesLayer(prev => resizeLayer(prev, metadata.width, metadata.height, "."));
    }, [metadata.width, metadata.height, terrainLayers.length, floorLayers.length]);

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
        if (layerVisibility.floor) drawLayer(ctx, floorLayer, "floor", CELL_SIZE, composedFloorTintLayer);
        if (layerVisibility.geometry) drawLayer(ctx, geometryLayer, "geometry", CELL_SIZE);
        if (layerVisibility.terrain) drawLayer(ctx, terrainLayer, "terrain", CELL_SIZE, composedTerrainTintLayer);
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

            const previewFill = doorDrag.brush === "S" ? "rgba(255, 171, 64, 0.35)" : "rgba(136, 68, 255, 0.4)";
            const previewStroke = doorDrag.brush === "S" ? "#ffab40" : "#84f";
            ctx.fillStyle = previewFill;
            ctx.fillRect(
                minX * CELL_SIZE,
                minZ * CELL_SIZE,
                (maxX - minX + 1) * CELL_SIZE,
                (maxZ - minZ + 1) * CELL_SIZE
            );
            ctx.strokeStyle = previewStroke;
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

        // Draw named locations
        if (layerVisibility.locations) {
            for (const location of dialogLocations) {
                const isSelected = selectedDialogLocationId === location.id;
                const drawX = location.x * CELL_SIZE;
                const drawZ = location.z * CELL_SIZE;
                const drawW = location.w * CELL_SIZE;
                const drawH = location.h * CELL_SIZE;

                ctx.fillStyle = isSelected ? "rgba(221, 188, 255, 0.24)" : "rgba(185, 140, 255, 0.14)";
                ctx.fillRect(drawX, drawZ, drawW, drawH);

                ctx.strokeStyle = isSelected ? "#ddbcff" : "#b98cff";
                ctx.lineWidth = isSelected ? 3 : 2;
                ctx.strokeRect(drawX, drawZ, drawW, drawH);

                ctx.fillStyle = isSelected ? "#f0e0ff" : "#d7c0ff";
                ctx.font = "600 10px \"DM Mono\", monospace";
                ctx.textAlign = "left";
                ctx.textBaseline = "top";
                ctx.fillText(`loc:${location.id}`, drawX + 3, drawZ + 3);
            }
        }

        // Draw dialog trigger regions
        for (const trigger of activeDialogTriggers) {
            trigger.conditions.forEach((condition) => {
                if (condition.type !== "party_enters_region") return;
                const drawX = condition.x * CELL_SIZE;
                const drawZ = condition.z * CELL_SIZE;
                const drawW = condition.w * CELL_SIZE;
                const drawH = condition.h * CELL_SIZE;

                ctx.fillStyle = "rgba(126, 233, 255, 0.16)";
                ctx.fillRect(drawX, drawZ, drawW, drawH);

                ctx.strokeStyle = "#7ee9ff";
                ctx.lineWidth = 2;
                ctx.strokeRect(drawX, drawZ, drawW, drawH);

                ctx.fillStyle = "#9af2ff";
                ctx.font = "600 10px \"DM Mono\", monospace";
                ctx.textAlign = "left";
                ctx.textBaseline = "top";
                ctx.fillText(`dlg:${trigger.id}`, drawX + 3, drawZ + 3);
            });
        }

        // Draw region-drag preview
        if (dialogRegionDrag) {
            const minX = Math.min(dialogRegionDrag.startX, dialogRegionDrag.endX);
            const maxX = Math.max(dialogRegionDrag.startX, dialogRegionDrag.endX);
            const minZ = Math.min(dialogRegionDrag.startZ, dialogRegionDrag.endZ);
            const maxZ = Math.max(dialogRegionDrag.startZ, dialogRegionDrag.endZ);
            const drawX = minX * CELL_SIZE;
            const drawZ = minZ * CELL_SIZE;
            const drawW = (maxX - minX + 1) * CELL_SIZE;
            const drawH = (maxZ - minZ + 1) * CELL_SIZE;

            ctx.fillStyle = "rgba(255, 214, 102, 0.3)";
            ctx.fillRect(drawX, drawZ, drawW, drawH);
            ctx.strokeStyle = "#ffd666";
            ctx.lineWidth = 2;
            ctx.strokeRect(drawX, drawZ, drawW, drawH);
        }

    }, [geometryLayer, terrainLayer, floorLayer, propsLayer, entitiesLayer, metadata, showGrid, layerVisibility, activeLayer, CELL_SIZE, doorDrag, entities, dialogLocations, selectedDialogLocationId, activeDialogTriggers, dialogRegionDrag, composedFloorTintLayer, composedTerrainTintLayer]);

    const getActiveLayer = useCallback((): string[][] => {
        switch (activeLayer) {
            case "geometry": return geometryLayer;
            case "terrain": return terrainLayers[activeTerrainPaintLayer] ?? createEmptyLayer(metadata.width, metadata.height, TILE_EMPTY);
            case "floor": return floorLayers[activeFloorPaintLayer] ?? createEmptyLayer(metadata.width, metadata.height, TILE_EMPTY);
            case "props": return propsLayer;
            case "entities": return entitiesLayer;
            case "locations": return createEmptyLayer(metadata.width, metadata.height, ".");
        }
    }, [
        activeLayer,
        geometryLayer,
        terrainLayers,
        floorLayers,
        activeTerrainPaintLayer,
        activeFloorPaintLayer,
        propsLayer,
        entitiesLayer,
        metadata.width,
        metadata.height
    ]);

    const setActiveLayerData = useCallback((newLayer: string[][]) => {
        switch (activeLayer) {
            case "geometry": setGeometryLayer(newLayer); break;
            case "terrain":
                setTerrainLayers(prev => prev.map((layer, index) => index === activeTerrainPaintLayer ? newLayer : layer));
                break;
            case "floor":
                setFloorLayers(prev => prev.map((layer, index) => index === activeFloorPaintLayer ? newLayer : layer));
                break;
            case "props": setPropsLayer(newLayer); break;
            case "entities": setEntitiesLayer(newLayer); break;
            case "locations": break;
        }
    }, [activeLayer, activeTerrainPaintLayer, activeFloorPaintLayer]);

    const getActiveTintLayer = useCallback((): number[][] | null => {
        if (activeLayer === "terrain") {
            return terrainTintLayers[activeTerrainPaintLayer] ?? createEmptyTintGrid(metadata.width, metadata.height);
        }
        if (activeLayer === "floor") {
            return floorTintLayers[activeFloorPaintLayer] ?? createEmptyTintGrid(metadata.width, metadata.height);
        }
        return null;
    }, [
        activeLayer,
        terrainTintLayers,
        floorTintLayers,
        activeTerrainPaintLayer,
        activeFloorPaintLayer,
        metadata.width,
        metadata.height
    ]);

    const setActiveTintLayerData = useCallback((newTintLayer: number[][]): void => {
        if (activeLayer === "terrain") {
            setTerrainTintLayers(prev => prev.map((layer, index) => index === activeTerrainPaintLayer ? newTintLayer : layer));
            return;
        }
        if (activeLayer === "floor") {
            setFloorTintLayers(prev => prev.map((layer, index) => index === activeFloorPaintLayer ? newTintLayer : layer));
        }
    }, [activeLayer, activeTerrainPaintLayer, activeFloorPaintLayer]);

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

    const applyEntitiesUpdate = useCallback((nextEntities: EntityDef[]): void => {
        const remappedPersistedTriggers = remapEnemyLinkedTriggerConditions(dialogTriggers, entities, nextEntities);
        setEntities(nextEntities);
        setEntitiesLayer(buildEntitiesLayerFromDefs(nextEntities));
        setDialogTriggers(remappedPersistedTriggers);
        setDialogTriggersDraft(prev => {
            if (!prev) return prev;
            return remapEnemyLinkedTriggerConditions(prev, entities, nextEntities);
        });
    }, [buildEntitiesLayerFromDefs, dialogTriggers, entities]);

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
        const tintLayer = getActiveTintLayer();
        const isTintableLayer = activeLayer === "terrain" || activeLayer === "floor";
        if (x < 0 || x >= metadata.width || z < 0 || z >= metadata.height) return;

        if (activeLayer === "entities" && activeTool === "paint" && activeBrush === "@") {
            setSpawnPoint(x, z);
            return;
        }

        if (activeLayer === "entities") {
            const targetCells = getBrushCells(x, z, brushSize, metadata.width, metadata.height);
            if (activeTool === "erase") {
                const nextEntities = entities.filter(entity =>
                    !targetCells.some(cell => entityOccupiesCell(entity, cell.x, cell.z))
                );
                applyEntitiesUpdate(nextEntities);
                return;
            }

            const overlappingEntityIds = new Set(
                entities
                    .filter(entity => targetCells.some(cell => entityOccupiesCell(entity, cell.x, cell.z)))
                    .map(entity => entity.id)
            );
            const nextEntities = entities.filter(entity => !overlappingEntityIds.has(entity.id));
            const entitySeed = Date.now();
            targetCells.forEach((cell, index) => {
                const entityId = `e${entitySeed}-${cell.x}-${cell.z}-${index}`;
                if (activeBrush === "E") {
                    if (isBlockingPropCell(propsLayer, cell.x, cell.z)) {
                        console.warn(`Blocked enemy placement at (${cell.x}, ${cell.z}) due to blocking prop/tree.`);
                        return;
                    }
                    nextEntities.push({
                        id: entityId,
                        x: cell.x,
                        z: cell.z,
                        type: "enemy",
                        enemyType: "skeleton_warrior",
                        enemySpawnIndex: getNextEnemySpawnIndex(nextEntities),
                    });
                    return;
                }
                if (activeBrush === "X") {
                    nextEntities.push({
                        id: entityId,
                        x: cell.x,
                        z: cell.z,
                        type: "chest",
                        chestGold: 0,
                        chestItems: "",
                        chestDecorOnly: false,
                    });
                    return;
                }
                if (activeBrush === "L") {
                    nextEntities.push({
                        id: entityId,
                        x: cell.x,
                        z: cell.z,
                        type: "candle",
                        candleDx: 0,
                        candleDz: 1,
                        lightColor: DEFAULT_CANDLE_LIGHT_COLOR,
                    });
                    return;
                }
                if (activeBrush === "Y") {
                    nextEntities.push({
                        id: entityId,
                        x: cell.x,
                        z: cell.z,
                        type: "torch",
                        candleDx: 0,
                        candleDz: 1,
                        lightColor: DEFAULT_TORCH_LIGHT_COLOR,
                    });
                    return;
                }
                if (activeBrush === "H") {
                    nextEntities.push({
                        id: entityId,
                        x: cell.x + 0.5,
                        z: cell.z + 0.5,
                        type: "light",
                        lightRadius: DEFAULT_AREA_LIGHT_RADIUS,
                        lightAngle: DEFAULT_AREA_LIGHT_ANGLE,
                        lightColor: DEFAULT_AREA_LIGHT_TINT,
                        lightBrightness: DEFAULT_AREA_LIGHT_BRIGHTNESS,
                        lightHeight: DEFAULT_AREA_LIGHT_HEIGHT,
                        lightDiffusion: DEFAULT_AREA_LIGHT_DIFFUSION,
                        lightDecay: DEFAULT_AREA_LIGHT_DECAY,
                    });
                    return;
                }
            });

            applyEntitiesUpdate(nextEntities);
            return;
        }

        const newLayer = layer.map(row => [...row]);
        const newTintLayer = tintLayer ? tintLayer.map(row => [...row]) : null;
        const halfSize = Math.floor(brushSize / 2);

        // Paint a square area based on brush size
        for (let dz = -halfSize; dz < brushSize - halfSize; dz++) {
            for (let dx = -halfSize; dx < brushSize - halfSize; dx++) {
                const px = x + dx;
                const pz = z + dz;
                if (px >= 0 && px < metadata.width && pz >= 0 && pz < metadata.height) {
                    if (activeTool === "paint") {
                        newLayer[pz][px] = activeBrush;
                        if (isTintableLayer && newTintLayer) {
                            newTintLayer[pz][px] = activeBrush === TILE_EMPTY ? 0 : clampTileTintPercent(activeTileTint);
                        }
                    } else if (activeTool === "erase") {
                        newLayer[pz][px] = TILE_EMPTY;
                        if (isTintableLayer && newTintLayer) {
                            newTintLayer[pz][px] = 0;
                        }
                    }
                }
            }
        }
        setActiveLayerData(newLayer);
        if (isTintableLayer && newTintLayer) {
            setActiveTintLayerData(newTintLayer);
        }
    }, [
        getActiveLayer,
        getActiveTintLayer,
        setActiveLayerData,
        setActiveTintLayerData,
        activeTool,
        activeBrush,
        activeTileTint,
        brushSize,
        metadata.width,
        metadata.height,
        activeLayer,
        entities,
        propsLayer,
        setSpawnPoint,
        entityOccupiesCell,
        applyEntitiesUpdate
    ]);

    const updateDialogRegionDragEndpoint = useCallback((clientX: number, clientY: number): void => {
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;

        const { x, z } = transformMouseCoords(clientX, clientY, rect);
        const clampedX = clampGridCoord(x, metadata.width);
        const clampedZ = clampGridCoord(z, metadata.height);
        setDialogRegionDrag(prev => prev ? { ...prev, endX: clampedX, endZ: clampedZ } : null);
    }, [metadata.width, metadata.height, transformMouseCoords]);

    const applyDialogRegionDrag = useCallback((dragState: DialogRegionDragState, clientX: number, clientY: number): void => {
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) {
            dialogRegionDragRef.current = null;
            setDialogRegionDrag(null);
                return;
        }

        const { x, z } = transformMouseCoords(clientX, clientY, rect);
        const endX = clampGridCoord(x, metadata.width);
        const endZ = clampGridCoord(z, metadata.height);
        const minX = Math.min(dragState.startX, endX);
        const maxX = Math.max(dragState.startX, endX);
        const minZ = Math.min(dragState.startZ, endZ);
        const maxZ = Math.max(dragState.startZ, endZ);
        const w = maxX - minX + 1;
        const h = maxZ - minZ + 1;

        const { locationId } = dragState;
        const targetLocation = dialogLocations.find(location => location.id === locationId);
        if (targetLocation) {
            const didChange = targetLocation.x !== minX
                || targetLocation.z !== minZ
                || targetLocation.w !== w
                || targetLocation.h !== h;
            if (didChange) {
                pushHistory();
            }
            setDialogLocations(prev => prev.map(location => {
                if (location.id !== locationId) return location;
                return {
                    ...location,
                    x: minX,
                    z: minZ,
                    w,
                    h
                };
            }));
        }

        dialogRegionDragRef.current = null;
        setDialogRegionDrag(null);
    }, [dialogLocations, metadata.width, metadata.height, pushHistory, transformMouseCoords]);

    const isDialogRegionDragging = dialogRegionDrag !== null;

    useEffect(() => {
        if (!isDialogRegionDragging) return;

        const handleWindowMouseMove = (event: MouseEvent) => {
            updateDialogRegionDragEndpoint(event.clientX, event.clientY);
        };
        const handleWindowMouseUp = (event: MouseEvent) => {
            const activeDrag = dialogRegionDragRef.current;
            if (!activeDrag) return;
            applyDialogRegionDrag(activeDrag, event.clientX, event.clientY);
        };

        window.addEventListener("mousemove", handleWindowMouseMove);
        window.addEventListener("mouseup", handleWindowMouseUp);
        return () => {
            window.removeEventListener("mousemove", handleWindowMouseMove);
            window.removeEventListener("mouseup", handleWindowMouseUp);
        };
    }, [applyDialogRegionDrag, isDialogRegionDragging, updateDialogRegionDragEndpoint]);

    const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
        // Ignore right-click (handled by onContextMenu)
        if (e.button !== 0) return;
        // Disable painting in isometric view (view-only mode)
        if (isometric) return;

        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;

        const { x, z } = transformMouseCoords(e.clientX, e.clientY, rect);
        if (x < 0 || z < 0 || x >= metadata.width || z >= metadata.height) return;

        if (activeLayer === "locations") {
            const clampedX = clampGridCoord(x, metadata.width);
            const clampedZ = clampGridCoord(z, metadata.height);
            const locationAtPointer = [...dialogLocations]
                .reverse()
                .find(location => locationContainsCell(location, clampedX, clampedZ));

            if (activeTool === "erase") {
                if (locationAtPointer) {
                    removeDialogLocation(locationAtPointer.id);
                }
                return;
            }

            let targetLocationId = locationAtPointer?.id ?? null;
            if (!targetLocationId) {
                const nextLocationId = createDialogLocationId(dialogLocations);
                targetLocationId = nextLocationId;
                pushHistory();
                setDialogLocations(prev => [...prev, { id: nextLocationId, x: clampedX, z: clampedZ, w: 1, h: 1 }]);
            }

            setSelectedDialogLocationId(targetLocationId);
            const nextDragState: DialogRegionDragState = {
                locationId: targetLocationId,
                startX: clampedX,
                startZ: clampedZ,
                endX: clampedX,
                endZ: clampedZ,
            };
            dialogRegionDragRef.current = nextDragState;
            setDialogRegionDrag(nextDragState);
            return;
        }

        // Push history before starting to paint
        pushHistory();

        // For door and secret-door brushes, use drag-to-size
        if (activeLayer === "entities" && activeTool === "paint" && (activeBrush === "D" || activeBrush === "S")) {
            const brush = activeBrush as DragEntityBrush;
            setDoorDrag({ brush, startX: x, startZ: z, endX: x, endZ: z });
        } else {
            setIsPainting(true);
            paintCell(x, z);
        }
    };

    const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;

        const { x, z } = transformMouseCoords(e.clientX, e.clientY, rect);

        if (dialogRegionDrag) {
            updateDialogRegionDragEndpoint(e.clientX, e.clientY);
            return;
        }

        // Update door drag preview
        if (doorDrag) {
            setDoorDrag(prev => prev ? { ...prev, endX: x, endZ: z } : null);
            return;
        }

        if (!isPainting) return;
        paintCell(x, z);
    };

    const handleCanvasMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
        if (dialogRegionDrag) {
            return;
        }

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

                const draggedFootprint = { x: minX, z: minZ, w, h };

                // Remove existing entities whose footprints overlap with dragged footprint.
                const filteredEntities = entities.filter(entity =>
                    !footprintsOverlap(getEntityFootprint(entity), draggedFootprint)
                );

                const entityId = `e${Date.now()}-${minX}-${minZ}`;
                if (doorDrag.brush === "D") {
                    const transitionDoor: EntityDef = {
                        id: entityId, x: minX, z: minZ, type: "transition",
                        transitionTarget: getAvailableAreaIds()[0], transitionSpawnX: 5, transitionSpawnZ: 5,
                        transitionDirection: "north", transitionW: w, transitionH: h
                    };
                    const nextEntities: EntityDef[] = [...filteredEntities, transitionDoor];
                    applyEntitiesUpdate(nextEntities);
                } else {
                    const secretDoor = normalizeSecretDoorEntity({
                        id: entityId,
                        x: minX,
                        z: minZ,
                        type: "secret_door",
                        secretBlockX: minX,
                        secretBlockZ: minZ,
                        secretBlockW: w,
                        secretBlockH: h
                    });
                    const nextEntities: EntityDef[] = [...filteredEntities, secretDoor];
                    applyEntitiesUpdate(nextEntities);
                }
            }
            setDoorDrag(null);
            return;
        }

        setIsPainting(false);
    };

    const openPropertiesPopup = useCallback((menu: EditorContextMenuState) => {
        if (menu.location && activeLayer === "locations") {
            setEditingLocation({ location: menu.location, screenX: menu.screenX, screenY: menu.screenY });
            setSelectedDialogLocationId(menu.location.id);
            setEditingEntity(null);
            setEditingTree(null);
            setEditingDecoration(null);
            return;
        }
        if (menu.entity) {
            setEditingEntity({ entity: menu.entity, screenX: menu.screenX, screenY: menu.screenY });
            setEditingTree(null);
            setEditingDecoration(null);
            setEditingLocation(null);
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
            setEditingLocation(null);
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
            setEditingLocation(null);
            return;
        }
        if (menu.location) {
            setEditingLocation({ location: menu.location, screenX: menu.screenX, screenY: menu.screenY });
            setSelectedDialogLocationId(menu.location.id);
            setEditingEntity(null);
            setEditingTree(null);
            setEditingDecoration(null);
        }
    }, [activeLayer]);

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
                pasted = normalizeSecretDoorEntity({
                    ...source,
                    id: nextId,
                    x,
                    z,
                    secretBlockX: x,
                    secretBlockZ: z,
                });
            } else {
                pasted = { ...source, id: nextId, x, z };
            }

            const pasteFootprint = getEntityFootprint(pasted);
            const cellInPasteFootprint = (cellX: number, cellZ: number): boolean =>
                cellX >= pasteFootprint.x
                && cellX < pasteFootprint.x + pasteFootprint.w
                && cellZ >= pasteFootprint.z
                && cellZ < pasteFootprint.z + pasteFootprint.h;

            const baseEntities = entities.filter(ent => !footprintsOverlap(getEntityFootprint(ent), pasteFootprint));
            if (pasted.type === "enemy") {
                pasted = {
                    ...pasted,
                    enemySpawnIndex: getNextEnemySpawnIndex(baseEntities),
                };
            }
            const nextEntities = baseEntities.concat(pasted);

            applyEntitiesUpdate(nextEntities);
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
        applyEntitiesUpdate(nextEntities);

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
        entityOccupiesCell,
        applyEntitiesUpdate
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
        const location = [...dialogLocations]
            .reverse()
            .find(entry => locationContainsCell(entry, x, z));
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
            decoration,
            location: location ? cloneDialogLocation(location) : null,
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
        const normalized = normalizeSecretDoorEntity(updated);
        const nextEntities = entities.map(entity => entity.id === normalized.id ? normalized : entity);
        applyEntitiesUpdate(nextEntities);
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

    const setEditableDialogTriggers = useCallback(
        (updater: (prev: AreaDialogTrigger[]) => AreaDialogTrigger[]) => {
            if (dialogTriggersDraft !== null) {
                setDialogTriggersDraft(prev => prev ? updater(prev) : prev);
                return;
            }
            setDialogTriggers(prev => updater(prev));
        },
        [dialogTriggersDraft]
    );

    const updateDialogTrigger = useCallback(
        (triggerId: string, updater: (trigger: AreaDialogTrigger) => AreaDialogTrigger) => {
            setEditableDialogTriggers(prev => prev.map(trigger => {
                if (trigger.id !== triggerId) return trigger;
                return updater(trigger);
            }));
        },
        [setEditableDialogTriggers]
    );

    const updateDialogTriggerCondition = useCallback(
        (
            triggerId: string,
            conditionIndex: number,
            updater: (condition: AreaDialogTriggerCondition) => AreaDialogTriggerCondition
        ) => {
            updateDialogTrigger(triggerId, trigger => {
                const nextConditions = trigger.conditions.map((condition, index) => {
                    if (index !== conditionIndex) return condition;
                    return updater(condition);
                });
                return { ...trigger, conditions: nextConditions };
            });
        },
        [updateDialogTrigger]
    );

    const saveDialogLocation = useCallback((locationId: string, draft: AreaLocation): boolean => {
        const currentLocation = dialogLocations.find(location => location.id === locationId);
        if (!currentLocation) return false;

        const nextId = draft.id.trim();
        if (nextId.length === 0) return false;
        const idAlreadyUsed = dialogLocations.some(location => location.id === nextId && location.id !== locationId);
        if (idAlreadyUsed) return false;

        const clampedX = clampGridCoord(draft.x, metadata.width);
        const clampedZ = clampGridCoord(draft.z, metadata.height);
        const maxWidth = Math.max(1, metadata.width - clampedX);
        const maxHeight = Math.max(1, metadata.height - clampedZ);
        const rawWidth = Number.isFinite(draft.w) ? Math.floor(draft.w) : 1;
        const rawHeight = Number.isFinite(draft.h) ? Math.floor(draft.h) : 1;
        const normalized: AreaLocation = {
            id: nextId,
            x: clampedX,
            z: clampedZ,
            w: Math.max(1, Math.min(rawWidth, maxWidth)),
            h: Math.max(1, Math.min(rawHeight, maxHeight)),
        };
        const changed = normalized.id !== currentLocation.id
            || normalized.x !== currentLocation.x
            || normalized.z !== currentLocation.z
            || normalized.w !== currentLocation.w
            || normalized.h !== currentLocation.h;

        if (changed) {
            pushHistory();
            setDialogLocations(prev => prev.map(location => location.id === locationId ? normalized : location));
            if (normalized.id !== currentLocation.id) {
                const remapLocationInTriggers = (triggers: AreaDialogTrigger[]): AreaDialogTrigger[] => (
                    triggers.map(trigger => ({
                        ...trigger,
                        conditions: trigger.conditions.map(condition => {
                            if (condition.type !== "party_enters_location") return condition;
                            if (condition.locationId !== currentLocation.id) return condition;
                            return {
                                ...condition,
                                locationId: normalized.id,
                            };
                        })
                    }))
                );
                setDialogTriggers(prev => remapLocationInTriggers(prev));
                setDialogTriggersDraft(prev => prev ? remapLocationInTriggers(prev) : prev);
            }
        }

        setSelectedDialogLocationId(normalized.id);
        return true;
    }, [dialogLocations, metadata.width, metadata.height, pushHistory]);

    const removeDialogLocation = useCallback((locationId: string) => {
        pushHistory();
        setDialogLocations(prev => prev.filter(location => location.id !== locationId));
        setSelectedDialogLocationId(prev => prev === locationId ? null : prev);
        setEditingLocation(prev => prev?.location.id === locationId ? null : prev);
        setContextMenu(prev => prev?.location?.id === locationId ? null : prev);
        setDialogRegionDrag(prev =>
            prev && prev.locationId === locationId ? null : prev
        );
    }, [pushHistory]);

    const addDialogTrigger = useCallback(() => {
        if (dialogTriggersDraft === null) {
            pushHistory();
        }
        const existingTriggerIds = new Set(activeDialogTriggers.map(trigger => trigger.id));
        let nextTriggerId = createDialogTriggerId();
        while (existingTriggerIds.has(nextTriggerId)) {
            nextTriggerId = createDialogTriggerId();
        }
        const nextTrigger: AreaDialogTrigger = {
            id: nextTriggerId,
            wip: true,
            once: true,
            priority: 0,
            conditions: [createDefaultDialogCondition()],
            actions: []
        };
        setEditableDialogTriggers(prev => [...prev, nextTrigger]);
    }, [activeDialogTriggers, dialogTriggersDraft, pushHistory, setEditableDialogTriggers]);

    const removeDialogTrigger = useCallback((triggerId: string) => {
        if (dialogTriggersDraft === null) {
            pushHistory();
        }
        setEditableDialogTriggers(prev => prev.filter(trigger => trigger.id !== triggerId));
    }, [dialogTriggersDraft, pushHistory, setEditableDialogTriggers]);

    const addDialogCondition = useCallback((triggerId: string) => {
        if (dialogTriggersDraft === null) {
            pushHistory();
        }
        updateDialogTrigger(triggerId, trigger => ({
            ...trigger,
            conditions: [...trigger.conditions, createDefaultDialogCondition()]
        }));
    }, [dialogTriggersDraft, pushHistory, updateDialogTrigger]);

    const removeDialogCondition = useCallback((triggerId: string, conditionIndex: number) => {
        if (dialogTriggersDraft === null) {
            pushHistory();
        }
        updateDialogTrigger(triggerId, trigger => {
            const nextConditions = trigger.conditions.filter((_, index) => index !== conditionIndex);
            return {
                ...trigger,
                conditions: nextConditions.length > 0 ? nextConditions : [createDefaultDialogCondition()]
            };
        });
    }, [dialogTriggersDraft, pushHistory, updateDialogTrigger]);

    const saveDialogsFromModal = useCallback((nextDialogs: AreaDialogDefinition[], dialogIdRemap?: Record<string, string>) => {
        pushHistory();
        setDialogs(nextDialogs.map(cloneDialogDefinition));
        if (dialogIdRemap && Object.keys(dialogIdRemap).length > 0) {
            setDialogTriggers(prev => remapTriggerDialogTargetsInList(prev, dialogIdRemap));
            setDialogTriggersDraft(prev => prev ? remapTriggerDialogTargetsInList(prev, dialogIdRemap) : prev);
        }
    }, [pushHistory]);

    const saveTriggersFromModal = useCallback((nextTriggers: AreaDialogTrigger[]) => {
        pushHistory();
        const persistedTriggers = nextTriggers.map(cloneDialogTrigger);
        setDialogTriggers(persistedTriggers);
        setDialogTriggersDraft(persistedTriggers.map(cloneDialogTrigger));
    }, [pushHistory]);

    const loadArea = useCallback((areaId: AreaId) => {
        const area = AREAS[areaId];
        if (!area) return;

        const loadedMetadata: MapMetadata = {
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
        };

        // Use geometry, terrain, and floor directly from area data
        const loadedGeometryLayer = area.geometry.map(row => [...row]);
        const loadedTerrainLayers = normalizeTileLayerStack(area.terrainLayers ?? [area.terrain], area.gridWidth, area.gridHeight, TILE_EMPTY);
        const loadedFloorLayers = normalizeTileLayerStack(
            area.floor && area.floor.length > 0 ? (area.floorLayers ?? [area.floor]) : [createEmptyLayer(area.gridWidth, area.gridHeight, TILE_EMPTY)],
            area.gridWidth,
            area.gridHeight,
            TILE_EMPTY
        );
        const loadedTerrainTintLayers = normalizeTintLayerStack(area.terrainTintLayers, loadedTerrainLayers.length, area.gridWidth, area.gridHeight);
        const loadedFloorTintLayers = normalizeTintLayerStack(area.floorTintLayers, loadedFloorLayers.length, area.gridWidth, area.gridHeight);

        // Compute props layer from trees and decorations
        const newProps = computePropsFromArea(area, area.gridWidth, area.gridHeight);

        // Compute entities layer from enemies, chests, transitions
        const newEntities = computeEntitiesFromArea(area, area.gridWidth, area.gridHeight);

        // Store detailed data that can't be shown in grid
        const loadedTrees = area.trees.map(t => {
            const normalizedType = t.type ?? "pine";
            return {
                x: t.x,
                z: t.z,
                size: clampTreeSizeByType(t.size, normalizedType),
                type: normalizedType,
            };
        });
        const loadedDecorations = (area.decorations ?? []).map(d => ({ x: d.x, z: d.z, type: d.type, rotation: d.rotation, size: d.size }));

        // Build entity definitions
        const entityDefs: EntityDef[] = [];
        let entityId = 0;
        area.enemySpawns.forEach((e, spawnIndex) => {
            entityDefs.push({
                id: `e${entityId++}`,
                x: e.x,
                z: e.z,
                type: "enemy",
                enemyType: e.type,
                enemySpawnIndex: spawnIndex,
            });
        });
        area.chests.forEach(c => {
            const items = c.contents.map(i => `${i.itemId}:${i.quantity}`).join(",");
            entityDefs.push({
                id: `e${entityId++}`, x: c.x, z: c.z, type: "chest",
                chestGold: c.gold,
                chestItems: items,
                chestLocked: c.locked ? (c.requiredKeyId ?? "true") : undefined,
                chestDecorOnly: c.decorOnly ?? false
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
            const secretDoor = normalizeSecretDoorEntity({
                id: `e${entityId++}`, x: s.x, z: s.z, type: "secret_door",
                secretBlockX: s.blockingWall.x, secretBlockZ: s.blockingWall.z,
                secretBlockW: s.blockingWall.w, secretBlockH: s.blockingWall.h
            });
            entityDefs.push(secretDoor);
        });
        const loadedDialogs = (area.dialogs ?? []).map(cloneDialogDefinition);
        const loadedLocations = (area.locations ?? []).map(cloneDialogLocation);

        const loadedTriggers = (area.dialogTriggers ?? []).map(cloneDialogTrigger);
        setMetadata(loadedMetadata);
        setGeometryLayer(loadedGeometryLayer);
        setTerrainLayers(loadedTerrainLayers);
        setFloorLayers(loadedFloorLayers);
        setTerrainTintLayers(loadedTerrainTintLayers);
        setFloorTintLayers(loadedFloorTintLayers);
        setActiveTerrainPaintLayer(Math.max(0, loadedTerrainLayers.length - 1));
        setActiveFloorPaintLayer(Math.max(0, loadedFloorLayers.length - 1));
        setPropsLayer(newProps);
        setEntitiesLayer(newEntities);
        setEntities(entityDefs);
        setTrees(loadedTrees);
        setDecorations(loadedDecorations);
        setDialogs(loadedDialogs);
        setDialogLocations(loadedLocations);
        setSelectedDialogLocationId(loadedLocations[0]?.id ?? null);
        setDialogTriggers(loadedTriggers);
        setDialogTriggersDraft(null);
        setDialogRegionDrag(null);
        setDialogEditorOpen(false);
        setEditingLocation(null);
        setContextMenu(null);
        resetHistory(createEditorSnapshot({
            metadata: loadedMetadata,
            geometryLayer: loadedGeometryLayer,
            terrainLayers: loadedTerrainLayers,
            floorLayers: loadedFloorLayers,
            terrainTintLayers: loadedTerrainTintLayers,
            floorTintLayers: loadedFloorTintLayers,
            propsLayer: newProps,
            entitiesLayer: newEntities,
            entities: entityDefs,
            trees: loadedTrees,
            decorations: loadedDecorations,
            dialogs: loadedDialogs,
            locations: loadedLocations,
            dialogTriggers: loadedTriggers,
        }));
    }, [resetHistory]);

    const createNewArea = () => {
        const newId = normalizeAreaId(`area_${Date.now()}`);
        const width = 30;
        const height = 20;
        const spawnX = 3;
        const spawnZ = 10;
        const newMetadata: MapMetadata = {
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
        };
        const newGeometryLayer = createEmptyLayer(width, height, ".");
        const newTerrainLayers = [createEmptyLayer(width, height, TILE_EMPTY)];
        const newFloorLayers = [createEmptyLayer(width, height, TILE_EMPTY)];
        const newTerrainTintLayers = [createEmptyTintGrid(width, height)];
        const newFloorTintLayers = [createEmptyTintGrid(width, height)];
        const newPropsLayer = createEmptyLayer(width, height, ".");
        const newEntitiesLayer = createEmptyLayer(width, height, ".");
        if (spawnZ >= 0 && spawnZ < height && spawnX >= 0 && spawnX < width) {
            newEntitiesLayer[spawnZ][spawnX] = "@";
        }

        setMetadata(newMetadata);
        setGeometryLayer(newGeometryLayer);
        setTerrainLayers(newTerrainLayers);
        setFloorLayers(newFloorLayers);
        setTerrainTintLayers(newTerrainTintLayers);
        setFloorTintLayers(newFloorTintLayers);
        setActiveTerrainPaintLayer(0);
        setActiveFloorPaintLayer(0);
        setActiveTileTint(0);
        setPropsLayer(newPropsLayer);
        setEntitiesLayer(newEntitiesLayer);
        setEntities([]);
        setTrees([]);
        setDecorations([]);
        setDialogs([]);
        setDialogLocations([]);
        setSelectedDialogLocationId(null);
        setDialogTriggers([]);
        setDialogTriggersDraft(null);
        setDialogRegionDrag(null);
        setDialogEditorOpen(false);
        setEditingLocation(null);
        setContextMenu(null);
        resetHistory(createEditorSnapshot({
            metadata: newMetadata,
            geometryLayer: newGeometryLayer,
            terrainLayers: newTerrainLayers,
            floorLayers: newFloorLayers,
            terrainTintLayers: newTerrainTintLayers,
            floorTintLayers: newFloorTintLayers,
            propsLayer: newPropsLayer,
            entitiesLayer: newEntitiesLayer,
            entities: [],
            trees: [],
            decorations: [],
            dialogs: [],
            locations: [],
            dialogTriggers: [],
        }));
    };

    // Load last saved map on mount when available, otherwise fall back to coast.
    useEffect(() => {
        const savedAreaId = loadLastSavedAreaId();
        if (savedAreaId && AREAS[savedAreaId]) {
            loadArea(savedAreaId as AreaId);
            return;
        }
        loadArea("coast");
    }, [loadArea]);

    const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

    const saveMap = async () => {
        const area = buildAreaDataFromEditor();
        const content = areaDataToText(area);
        if (area.id !== metadata.id) {
            setMetadata(prev => ({ ...prev, id: area.id }));
        }

        setSaveStatus("saving");
        try {
            const res = await fetch("/__save-map", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ areaId: area.id, content }),
            });
            const data = await res.json();
            if (data.success) {
                // Register the area so it's immediately available for loading/transitions
                registerAreaFromText(area.id, content);
                persistLastSavedAreaId(area.id);
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

    const enemySpawnOptions = useMemo(() => {
        const orderedEnemies = getOrderedEnemyEntities(entities);
        return orderedEnemies.map((enemy, index) => {
            return {
                spawnIndex: index,
                x: Math.floor(enemy.x),
                z: Math.floor(enemy.z),
                enemyType: enemy.enemyType ?? "skeleton_warrior",
            };
        });
    }, [entities]);

    const buildAreaDataFromEditor = (): AreaData => {
        const areaId = normalizeAreaId(metadata.id);
        const normalizedTerrainLayers = normalizeTileLayerStack(terrainLayers, metadata.width, metadata.height, TILE_EMPTY);
        const normalizedFloorLayers = normalizeTileLayerStack(floorLayers, metadata.width, metadata.height, TILE_EMPTY);
        const normalizedTerrainTintLayers = normalizeTintLayerStack(terrainTintLayers, normalizedTerrainLayers.length, metadata.width, metadata.height);
        const normalizedFloorTintLayers = normalizeTintLayerStack(floorTintLayers, normalizedFloorLayers.length, metadata.width, metadata.height);
        const composedTerrain = composeTileLayers(normalizedTerrainLayers, metadata.width, metadata.height, TILE_EMPTY);
        const composedFloor = composeTileLayers(normalizedFloorLayers, metadata.width, metadata.height, TILE_EMPTY);

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

        // Extract enemies from detailed state so trigger spawnIndex ordering remains stable.
        const orderedEnemies = getOrderedEnemyEntities(entities);
        const rawEnemySpawns: EnemySpawn[] = orderedEnemies.map(enemy => {
            return {
                x: Math.floor(enemy.x) + 0.5,
                z: Math.floor(enemy.z) + 0.5,
                type: enemy.enemyType ?? "skeleton_warrior",
            };
        });
        // Extract chests from entities layer, merging with detailed state.
        const gridEntities = extractEntitiesFromGrid(entitiesLayer);
        const enemySpawns = sanitizeEnemySpawns(
            rawEnemySpawns,
            geometryLayer,
            composedTerrain,
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
                if (stateChest.chestDecorOnly) {
                    chest.decorOnly = true;
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
            .map(e => normalizeSecretDoorEntity(e))
            .map(e => ({
                x: e.x,
                z: e.z,
                blockingWall: {
                    x: e.secretBlockX ?? 0,
                    z: e.secretBlockZ ?? 0,
                    w: e.secretBlockW ?? 1,
                    h: e.secretBlockH ?? 1
                }
            }));

        return {
            id: areaId as AreaId,
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
            terrain: composedTerrain,
            floor: composedFloor,
            terrainLayers: normalizedTerrainLayers.length > 1 || hasTintData(normalizedTerrainTintLayers) ? normalizedTerrainLayers : undefined,
            floorLayers: normalizedFloorLayers.length > 1 || hasTintData(normalizedFloorTintLayers) ? normalizedFloorLayers : undefined,
            terrainTintLayers: hasTintData(normalizedTerrainTintLayers) ? normalizedTerrainTintLayers : undefined,
            floorTintLayers: hasTintData(normalizedFloorTintLayers) ? normalizedFloorTintLayers : undefined,
            enemySpawns,
            transitions: transitionList,
            chests: chestList,
            trees: mergedTrees,
            decorations: mergedDecorations.length > 0 ? mergedDecorations : undefined,
            candles: candleList.length > 0 ? candleList : undefined,
            lights: lightList.length > 0 ? lightList : undefined,
            secretDoors: secretDoorList.length > 0 ? secretDoorList : undefined,
            dialogs: dialogs.length > 0 ? dialogs.map(cloneDialogDefinition) : undefined,
            locations: dialogLocations.length > 0 ? dialogLocations.map(cloneDialogLocation) : undefined,
            dialogTriggers: dialogTriggers.length > 0 ? dialogTriggers.map(cloneDialogTrigger) : undefined,
        };
    };

    const getBrushOptions = (): { char: string; label: string }[] => {
        return LAYER_BRUSHES[activeLayer];
    };

    const isTileLayerEditable = activeLayer === "terrain" || activeLayer === "floor";
    const activeTileLayerIndex = activeLayer === "terrain" ? activeTerrainPaintLayer : activeFloorPaintLayer;
    const activeTileLayerCount = activeLayer === "terrain" ? terrainLayers.length : floorLayers.length;

    const addActiveTileLayer = () => {
        if (!isTileLayerEditable) return;
        pushHistory();
        if (activeLayer === "terrain") {
            const newLayer = createEmptyLayer(metadata.width, metadata.height, TILE_EMPTY);
            const newTint = createEmptyTintGrid(metadata.width, metadata.height);
            setTerrainLayers(prev => [...prev, newLayer]);
            setTerrainTintLayers(prev => [...prev, newTint]);
            setActiveTerrainPaintLayer(terrainLayers.length);
            return;
        }

        const newLayer = createEmptyLayer(metadata.width, metadata.height, TILE_EMPTY);
        const newTint = createEmptyTintGrid(metadata.width, metadata.height);
        setFloorLayers(prev => [...prev, newLayer]);
        setFloorTintLayers(prev => [...prev, newTint]);
        setActiveFloorPaintLayer(floorLayers.length);
    };

    const removeActiveTileLayer = () => {
        if (!isTileLayerEditable || activeTileLayerCount <= 1) return;
        pushHistory();
        if (activeLayer === "terrain") {
            setTerrainLayers(prev => prev.filter((_, index) => index !== activeTerrainPaintLayer));
            setTerrainTintLayers(prev => prev.filter((_, index) => index !== activeTerrainPaintLayer));
            setActiveTerrainPaintLayer(prev => Math.max(0, Math.min(prev - 1, terrainLayers.length - 2)));
            return;
        }

        setFloorLayers(prev => prev.filter((_, index) => index !== activeFloorPaintLayer));
        setFloorTintLayers(prev => prev.filter((_, index) => index !== activeFloorPaintLayer));
        setActiveFloorPaintLayer(prev => Math.max(0, Math.min(prev - 1, floorLayers.length - 2)));
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
                    {(["geometry", "terrain", "floor", "props", "entities", "locations"] as Layer[]).map(layer => (
                        <div key={layer} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                            <input
                                type="checkbox"
                                checked={layerVisibility[layer]}
                                onChange={() => setLayerVisibility(prev => ({ ...prev, [layer]: !prev[layer] }))}
                                style={{ width: 18, height: 18 }}
                            />
                            <button
                                onClick={() => {
                                    setActiveLayer(layer);
                                    setActiveBrush(LAYER_BRUSHES[layer][0]?.char ?? ".");
                                }}
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

                {isTileLayerEditable && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        <h3 style={{ margin: 0, fontSize: 16 }}>Tile Layers</h3>
                        <div style={{ display: "flex", gap: 8 }}>
                            {Array.from({ length: activeTileLayerCount }, (_, index) => (
                                <button
                                    key={`tile-layer-${index}`}
                                    onClick={() => {
                                        if (activeLayer === "terrain") setActiveTerrainPaintLayer(index);
                                        else setActiveFloorPaintLayer(index);
                                    }}
                                    style={{
                                        flex: 1,
                                        padding: "6px 0",
                                        fontSize: 12,
                                        background: activeTileLayerIndex === index ? "#4a9" : "#333",
                                        color: "#fff",
                                        border: "none",
                                        borderRadius: 4,
                                        cursor: "pointer",
                                    }}
                                >
                                    {index + 1}
                                </button>
                            ))}
                        </div>
                        <div style={{ display: "flex", gap: 8 }}>
                            <button
                                onClick={addActiveTileLayer}
                                style={{ flex: 1, padding: "6px 0", fontSize: 12, background: "#2f5", color: "#111", border: "none", borderRadius: 4, cursor: "pointer" }}
                            >
                                + Layer
                            </button>
                            <button
                                onClick={removeActiveTileLayer}
                                disabled={activeTileLayerCount <= 1}
                                style={{
                                    flex: 1,
                                    padding: "6px 0",
                                    fontSize: 12,
                                    background: activeTileLayerCount <= 1 ? "#555" : "#b44",
                                    color: "#fff",
                                    border: "none",
                                    borderRadius: 4,
                                    cursor: activeTileLayerCount <= 1 ? "not-allowed" : "pointer",
                                    opacity: activeTileLayerCount <= 1 ? 0.6 : 1,
                                }}
                            >
                                - Layer
                            </button>
                        </div>
                        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                            <span style={{ fontSize: 13 }}>Tint: {activeTileTint}%</span>
                            <input
                                type="range"
                                min={-35}
                                max={35}
                                step={1}
                                value={activeTileTint}
                                onChange={e => setActiveTileTint(clampTileTintPercent(parseInt(e.target.value, 10) || 0))}
                            />
                        </label>
                    </div>
                )}

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
                            disabled={!contextMenu.entity && !contextMenu.tree && !contextMenu.decoration && !contextMenu.location}
                            style={{
                                textAlign: "left",
                                padding: "8px 10px",
                                fontSize: 13,
                                borderRadius: 6,
                                border: "1px solid #414655",
                                background: "#2a3040",
                                color: "#fff",
                                cursor: contextMenu.entity || contextMenu.tree || contextMenu.decoration || contextMenu.location ? "pointer" : "not-allowed",
                                opacity: contextMenu.entity || contextMenu.tree || contextMenu.decoration || contextMenu.location ? 1 : 0.45,
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
                        itemRegistryRevision={itemRegistryRevision}
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
                        onSave={(t) => updateTree(editingTree.index, t)}
                        onClose={() => setEditingTree(null)}
                    />
                )}

                {/* Decoration Edit Popup */}
                {editingDecoration && (
                    <DecorationEditPopup
                        decoration={editingDecoration.decoration}
                        onSave={(d) => updateDecoration(editingDecoration.index, d)}
                        onClose={() => setEditingDecoration(null)}
                    />
                )}

                {/* Location Edit Popup */}
                {editingLocation && (
                    <LocationEditPopup
                        location={editingLocation.location}
                        mapWidth={metadata.width}
                        mapHeight={metadata.height}
                        onSave={(nextLocation) => {
                            const didSave = saveDialogLocation(editingLocation.location.id, nextLocation);
                            if (didSave) {
                                setEditingLocation(null);
                            }
                        }}
                        onDelete={() => {
                            removeDialogLocation(editingLocation.location.id);
                            setEditingLocation(null);
                        }}
                        onClose={() => setEditingLocation(null)}
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
                        onChange={e => {
                            const nextId = normalizeAreaId(e.target.value, "");
                            if (nextId === metadata.id) return;
                            setMetadataWithHistory(prev => ({ ...prev, id: nextId }));
                        }}
                        onBlur={() => {
                            const nextId = normalizeAreaId(metadata.id);
                            if (nextId === metadata.id) return;
                            setMetadataWithHistory(prev => ({ ...prev, id: nextId }));
                        }}
                        style={{ padding: 8, fontSize: 14, background: "#333", border: "1px solid #555", borderRadius: 4, color: "#fff" }}
                    />
                </label>

                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <span style={{ fontSize: 13 }}>Name</span>
                    <input
                        value={metadata.name}
                        onChange={e => setMetadataWithHistory(prev => ({ ...prev, name: e.target.value }))}
                        style={{ padding: 8, fontSize: 14, background: "#333", border: "1px solid #555", borderRadius: 4, color: "#fff" }}
                    />
                </label>

                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <span style={{ fontSize: 13 }}>Flavor Text</span>
                    <textarea
                        value={metadata.flavor}
                        onChange={e => setMetadataWithHistory(prev => ({ ...prev, flavor: e.target.value }))}
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
                            onChange={e => setMetadataWithHistory(prev => ({ ...prev, width: Math.max(5, Math.min(100, parseInt(e.target.value) || 5)) }))}
                            style={{ padding: 8, fontSize: 14, background: "#333", border: "1px solid #555", borderRadius: 4, color: "#fff" }}
                        />
                    </label>
                    <label style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
                        <span style={{ fontSize: 13 }}>Height</span>
                        <input
                            type="number"
                            value={metadata.height}
                            onChange={e => setMetadataWithHistory(prev => ({ ...prev, height: Math.max(5, Math.min(100, parseInt(e.target.value) || 5)) }))}
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
                            onChange={e => setMetadataWithHistory(prev => ({ ...prev, background: e.target.value }))}
                            style={{ padding: 2, height: 40, background: "#333", border: "1px solid #555", borderRadius: 4 }}
                        />
                    </label>
                    <label style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
                        <span style={{ fontSize: 13 }}>Ground</span>
                        <input
                            type="color"
                            value={metadata.ground}
                            onChange={e => setMetadataWithHistory(prev => ({ ...prev, ground: e.target.value }))}
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
                            onChange={e => setMetadataWithHistory(prev => ({ ...prev, ambient: parseFloat(e.target.value) }))}
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
                            onChange={e => setMetadataWithHistory(prev => ({ ...prev, directional: parseFloat(e.target.value) }))}
                        />
                        <span style={{ fontSize: 12, textAlign: "center" }}>{metadata.directional}</span>
                    </label>
                </div>

                <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14 }}>
                    <input
                        type="checkbox"
                        checked={metadata.fog}
                        onChange={e => setMetadataWithHistory(prev => ({ ...prev, fog: e.target.checked }))}
                        style={{ width: 18, height: 18 }}
                    />
                    Fog of War
                </label>

                <div style={{ borderTop: "1px solid #444", paddingTop: 14, marginTop: 2, display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                        <h3 style={{ margin: 0, fontSize: 16 }}>Items</h3>
                        <button
                            className="editor-btn editor-btn--small editor-btn--primary"
                            onClick={() => setItemRegistryEditorOpen(true)}
                        >
                            Open Item Registry
                        </button>
                    </div>
                    <div style={{ fontSize: 12, color: "#9fb5dc" }}>
                        Edit global items (weapons, gear, keys, consumables) used by chests and gameplay.
                    </div>
                </div>

                {/* Trigger Studio */}
                <div className="editor-trigger-studio">
                    <div className="editor-trigger-studio-header">
                        <h3 className="editor-trigger-studio-title">Triggers</h3>
                        <button
                            onClick={() => {
                                setDialogTriggersDraft(dialogTriggers.map(cloneDialogTrigger));
                                setDialogEditorOpen(true);
                            }}
                            className="editor-btn editor-btn--primary editor-btn--small"
                        >
                            Open Trigger Studio
                        </button>
                    </div>
                    <div className="editor-trigger-studio-summary">
                        {activeDialogTriggers.length === 0
                            ? "0 triggers"
                            : `${activeDialogTriggers.length} trigger${activeDialogTriggers.length === 1 ? "" : "s"} configured.`}
                    </div>
                    {dialogs.length > 0 && (
                        <div className="editor-trigger-studio-dialog-list">
                            {dialogs.map(dialog => (
                                <div
                                    key={`dialog-summary-${dialog.id}`}
                                    className="editor-trigger-studio-dialog-item"
                                >
                                    <span>{dialog.id}</span>
                                    <span className="editor-trigger-studio-dialog-nodes">{Object.keys(dialog.nodes).length} nodes</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div style={{ borderTop: "1px solid #444", paddingTop: 12, marginTop: 2, fontSize: 12, color: "#8fa0c5" }}>
                    {dialogs.length === 0
                        ? "0 dialog payloads"
                        : `${dialogs.length} dialog payload${dialogs.length === 1 ? "" : "s"}`}
                </div>

                {/* Connections Panel */}
                <div style={{ borderTop: "1px solid #444", paddingTop: 16, marginTop: 2 }}>
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

            {itemRegistryEditorOpen && (
                <ItemRegistryEditorModal
                    onClose={() => setItemRegistryEditorOpen(false)}
                    onApplied={() => {
                        setItemRegistryRevision(prev => prev + 1);
                    }}
                />
            )}

            {dialogEditorOpen && (
                <DialogEditorModal
                    dialogs={dialogs}
                    dialogLocations={dialogLocations}
                    dialogTriggers={activeDialogTriggers}
                    availableDialogIds={availableDialogIds}
                    availableDialogIdSet={availableDialogIdSet}
                    enemySpawnOptions={enemySpawnOptions}
                    mapWidth={metadata.width}
                    mapHeight={metadata.height}
                    onAddDialogTrigger={addDialogTrigger}
                    onRemoveDialogTrigger={removeDialogTrigger}
                    onUpdateDialogTrigger={updateDialogTrigger}
                    onUpdateDialogTriggerCondition={updateDialogTriggerCondition}
                    onAddDialogCondition={addDialogCondition}
                    onRemoveDialogCondition={removeDialogCondition}
                    onClose={() => {
                        setDialogEditorOpen(false);
                        setDialogTriggersDraft(null);
                    }}
                    onSaveDialogs={saveDialogsFromModal}
                    onSaveTriggers={saveTriggersFromModal}
                />
            )}
        </div>
    );
}
