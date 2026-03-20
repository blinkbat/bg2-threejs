import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import {
    AREA_SCENE_EFFECT_IDS,
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
    type AreaSceneEffectId,
} from "../game/areas/types";
import { AREAS } from "../game/areas";
import { areaDataToText } from "./areaTextFormat";
import { DEFAULT_CANDLE_LIGHT_COLOR, DEFAULT_TORCH_LIGHT_COLOR } from "../core/constants";
import { getDialogDefinitionIds } from "../dialog/registry";

// Editor modules
import type { Tool, Layer, MapMetadata, EntityDef, TreeDef, DecorationDef, EditorSnapshot } from "./types";
import { getAvailableAreaIds, BASE_CELL_SIZE, MAX_HISTORY, LAYER_BRUSHES, PROP_TYPE_TO_CHAR, PROP_TREE_TYPE_TO_CHAR } from "./constants";
import { registerAreaFromText } from "../game/areas";
import {
    clampTreeSizeByType,
    createEmptyLayer,
    isBlockingPropCell,
    resizeLayer,
    resizeTintLayer,
} from "./areaConversion";
import {
    drawLayer,
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
import { buildAreaDataFromEditor as buildAreaDataFromEditorState } from "./mapEditorAreaBuilder";
import { createLoadedAreaState, createNewAreaState } from "./mapEditorAreaState";
import { MapEditorView } from "./MapEditorView";
import {
    createEditorSnapshot,
    getBrushCells,
    normalizeAreaId,
    remapEnemyLinkedTriggerConditions,
} from "./mapEditorShared";
import "../styles/07-map-editor.css";

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
        sceneEffects: undefined,
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

    const setMetadataSceneEffect = useCallback((effectId: AreaSceneEffectId, checked: boolean): void => {
        setMetadataWithHistory((prev) => {
            const nextSceneEffects = { ...(prev.sceneEffects ?? {}) };
            if (checked) {
                nextSceneEffects[effectId] = true;
            } else {
                delete nextSceneEffects[effectId];
            }

            const hasSceneEffect = AREA_SCENE_EFFECT_IDS.some((id) => nextSceneEffects[id] === true);
            return {
                ...prev,
                sceneEffects: hasSceneEffect ? nextSceneEffects : undefined,
            };
        });
    }, [setMetadataWithHistory]);

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
                ctx.font = "600 10px \"DM Mono\"";
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
                ctx.font = "600 10px \"DM Mono\"";
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
                ctx.font = "600 10px \"DM Mono\"";
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
            if (entity.type === "waystone") {
                markCell(Math.floor(entity.x), Math.floor(entity.z), "W");
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
                if (activeBrush === "W") {
                    nextEntities.push({
                        id: entityId,
                        x: cell.x,
                        z: cell.z,
                        type: "waystone",
                        waystoneDirection: "north",
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

        const loadedState = createLoadedAreaState(area);
        setMetadata(loadedState.metadata);
        setGeometryLayer(loadedState.geometryLayer);
        setTerrainLayers(loadedState.terrainLayers);
        setFloorLayers(loadedState.floorLayers);
        setTerrainTintLayers(loadedState.terrainTintLayers);
        setFloorTintLayers(loadedState.floorTintLayers);
        setActiveTerrainPaintLayer(loadedState.activeTerrainPaintLayer);
        setActiveFloorPaintLayer(loadedState.activeFloorPaintLayer);
        setPropsLayer(loadedState.propsLayer);
        setEntitiesLayer(loadedState.entitiesLayer);
        setEntities(loadedState.entities);
        setTrees(loadedState.trees);
        setDecorations(loadedState.decorations);
        setDialogs(loadedState.dialogs);
        setDialogLocations(loadedState.locations);
        setSelectedDialogLocationId(loadedState.locations[0]?.id ?? null);
        setDialogTriggers(loadedState.dialogTriggers);
        setDialogTriggersDraft(null);
        setDialogRegionDrag(null);
        setDialogEditorOpen(false);
        setEditingLocation(null);
        setContextMenu(null);
        resetHistory(createEditorSnapshot(loadedState));
    }, [resetHistory]);

    const createNewArea = () => {
        const newAreaState = createNewAreaState();
        setMetadata(newAreaState.metadata);
        setGeometryLayer(newAreaState.geometryLayer);
        setTerrainLayers(newAreaState.terrainLayers);
        setFloorLayers(newAreaState.floorLayers);
        setTerrainTintLayers(newAreaState.terrainTintLayers);
        setFloorTintLayers(newAreaState.floorTintLayers);
        setActiveTerrainPaintLayer(newAreaState.activeTerrainPaintLayer);
        setActiveFloorPaintLayer(newAreaState.activeFloorPaintLayer);
        setActiveTileTint(newAreaState.activeTileTint);
        setPropsLayer(newAreaState.propsLayer);
        setEntitiesLayer(newAreaState.entitiesLayer);
        setEntities(newAreaState.entities);
        setTrees(newAreaState.trees);
        setDecorations(newAreaState.decorations);
        setDialogs(newAreaState.dialogs);
        setDialogLocations(newAreaState.locations);
        setSelectedDialogLocationId(null);
        setDialogTriggers(newAreaState.dialogTriggers);
        setDialogTriggersDraft(null);
        setDialogRegionDrag(null);
        setDialogEditorOpen(false);
        setEditingLocation(null);
        setContextMenu(null);
        resetHistory(createEditorSnapshot(newAreaState));
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

    const buildAreaDataFromEditor = useCallback(() => {
        return buildAreaDataFromEditorState({
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
            dialogLocations,
            dialogTriggers,
        });
    }, [
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
        dialogLocations,
        dialogTriggers,
    ]);

    const saveMap = useCallback(async () => {
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
    }, [buildAreaDataFromEditor, metadata.id]);

    useEffect(() => {
        const handleSaveKeyDown = (e: KeyboardEvent) => {
            const isSaveShortcut = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s";
            if (!isSaveShortcut || e.repeat) {
                return;
            }

            e.preventDefault();
            if (saveStatus !== "saving") {
                void saveMap();
            }
        };

        window.addEventListener("keydown", handleSaveKeyDown);
        return () => window.removeEventListener("keydown", handleSaveKeyDown);
    }, [saveMap, saveStatus]);

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

    const handleCanvasMouseLeave = useCallback(() => {
        setIsPainting(false);
        setDoorDrag(null);
    }, []);

    const openDialogEditor = useCallback(() => {
        setDialogTriggersDraft(dialogTriggers.map(cloneDialogTrigger));
        setDialogEditorOpen(true);
    }, [dialogTriggers]);

    const closeDialogEditor = useCallback(() => {
        setDialogEditorOpen(false);
        setDialogTriggersDraft(null);
    }, []);

    const openPropertiesFromContextMenu = useCallback(() => {
        if (!contextMenu) return;
        openPropertiesPopup(contextMenu);
        setContextMenu(null);
    }, [contextMenu, openPropertiesPopup]);

    const copyContextMenuSelection = useCallback(() => {
        if (!contextMenu) return;
        copyFromContextMenu(contextMenu);
        setContextMenu(null);
    }, [contextMenu, copyFromContextMenu]);

    const pasteClipboardFromContextMenu = useCallback(() => {
        if (!contextMenu) return;
        pasteClipboardAt(contextMenu.tileX, contextMenu.tileZ);
        setContextMenu(null);
    }, [contextMenu, pasteClipboardAt]);

    const saveEditingLocation = useCallback((nextLocation: AreaLocation) => {
        if (!editingLocation) return;
        const didSave = saveDialogLocation(editingLocation.location.id, nextLocation);
        if (didSave) {
            setEditingLocation(null);
        }
    }, [editingLocation, saveDialogLocation]);

    const deleteEditingLocation = useCallback(() => {
        if (!editingLocation) return;
        removeDialogLocation(editingLocation.location.id);
        setEditingLocation(null);
    }, [editingLocation, removeDialogLocation]);

    const availableAreaIds = getAvailableAreaIds();
    const selectedAreaId = availableAreaIds.includes(metadata.id) ? metadata.id : "";

    return (
        <MapEditorView
            metadata={metadata}
            entities={entities}
            saveStatus={saveStatus}
            availableAreaIds={availableAreaIds}
            selectedAreaId={selectedAreaId}
            layerVisibility={layerVisibility}
            activeLayer={activeLayer}
            activeTool={activeTool}
            brushSize={brushSize}
            activeBrush={activeBrush}
            brushOptions={getBrushOptions()}
            isTileLayerEditable={isTileLayerEditable}
            activeTileLayerIndex={activeTileLayerIndex}
            activeTileLayerCount={activeTileLayerCount}
            activeTileTint={activeTileTint}
            showGrid={showGrid}
            isometric={isometric}
            zoom={zoom}
            canvasRef={canvasRef}
            onSaveMap={() => {
                void saveMap();
            }}
            onLoadArea={loadArea}
            onCreateNewArea={createNewArea}
            onToggleLayerVisibility={(layer) => setLayerVisibility((prev) => ({ ...prev, [layer]: !prev[layer] }))}
            onSelectLayer={(layer) => {
                setActiveLayer(layer);
                setActiveBrush(LAYER_BRUSHES[layer][0]?.char ?? ".");
            }}
            onSelectTool={setActiveTool}
            onUndo={undo}
            onRedo={redo}
            onBrushSizeChange={setBrushSize}
            onActiveBrushChange={setActiveBrush}
            onSelectTileLayer={(index) => {
                if (activeLayer === "terrain") {
                    setActiveTerrainPaintLayer(index);
                    return;
                }
                setActiveFloorPaintLayer(index);
            }}
            onAddActiveTileLayer={addActiveTileLayer}
            onRemoveActiveTileLayer={removeActiveTileLayer}
            onActiveTileTintChange={(value) => setActiveTileTint(clampTileTintPercent(value))}
            onToggleShowGrid={() => setShowGrid((prev) => !prev)}
            onToggleIsometric={() => setIsometric((prev) => !prev)}
            onZoomOut={() => setZoom((value) => Math.max(0.25, value - 0.25))}
            onZoomReset={() => setZoom(1)}
            onZoomIn={() => setZoom((value) => Math.min(3, value + 0.25))}
            onCanvasMouseDown={handleCanvasMouseDown}
            onCanvasMouseMove={handleCanvasMouseMove}
            onCanvasMouseUp={handleCanvasMouseUp}
            onCanvasMouseLeave={handleCanvasMouseLeave}
            onCanvasContextMenu={handleCanvasContextMenu}
            contextMenu={contextMenu}
            clipboard={clipboard}
            onOpenPropertiesFromContextMenu={openPropertiesFromContextMenu}
            onCopyFromContextMenu={copyContextMenuSelection}
            onPasteFromContextMenu={pasteClipboardFromContextMenu}
            editingEntity={editingEntity}
            editingTree={editingTree}
            editingDecoration={editingDecoration}
            editingLocation={editingLocation}
            itemRegistryRevision={itemRegistryRevision}
            onSaveEditingEntity={updateEntity}
            onCloseEditingEntity={() => setEditingEntity(null)}
            onEditTransition={(entity, screenX, screenY) => setEditingEntity({ entity, screenX, screenY })}
            onSaveEditingTree={(tree) => {
                if (!editingTree) return;
                updateTree(editingTree.index, tree);
            }}
            onCloseEditingTree={() => setEditingTree(null)}
            onSaveEditingDecoration={(decoration) => {
                if (!editingDecoration) return;
                updateDecoration(editingDecoration.index, decoration);
            }}
            onCloseEditingDecoration={() => setEditingDecoration(null)}
            onSaveEditingLocation={saveEditingLocation}
            onDeleteEditingLocation={deleteEditingLocation}
            onCloseEditingLocation={() => setEditingLocation(null)}
            onMetadataIdChange={(value) => {
                const nextId = normalizeAreaId(value, "");
                if (nextId === metadata.id) return;
                setMetadataWithHistory((prev) => ({ ...prev, id: nextId }));
            }}
            onMetadataIdBlur={() => {
                const nextId = normalizeAreaId(metadata.id);
                if (nextId === metadata.id) return;
                setMetadataWithHistory((prev) => ({ ...prev, id: nextId }));
            }}
            onMetadataNameChange={(value) => setMetadataWithHistory((prev) => ({ ...prev, name: value }))}
            onMetadataFlavorChange={(value) => setMetadataWithHistory((prev) => ({ ...prev, flavor: value }))}
            onMetadataWidthChange={(value) => setMetadataWithHistory((prev) => ({
                ...prev,
                width: Math.max(5, Math.min(100, parseInt(value, 10) || 5)),
            }))}
            onMetadataHeightChange={(value) => setMetadataWithHistory((prev) => ({
                ...prev,
                height: Math.max(5, Math.min(100, parseInt(value, 10) || 5)),
            }))}
            onMetadataBackgroundChange={(value) => setMetadataWithHistory((prev) => ({ ...prev, background: value }))}
            onMetadataGroundChange={(value) => setMetadataWithHistory((prev) => ({ ...prev, ground: value }))}
            onMetadataAmbientChange={(value) => setMetadataWithHistory((prev) => ({ ...prev, ambient: parseFloat(value) }))}
            onMetadataDirectionalChange={(value) => setMetadataWithHistory((prev) => ({ ...prev, directional: parseFloat(value) }))}
            onMetadataFogChange={(checked) => setMetadataWithHistory((prev) => ({ ...prev, fog: checked }))}
            onMetadataSceneEffectChange={setMetadataSceneEffect}
            itemRegistryEditorOpen={itemRegistryEditorOpen}
            onOpenItemRegistry={() => setItemRegistryEditorOpen(true)}
            onCloseItemRegistry={() => setItemRegistryEditorOpen(false)}
            onItemRegistryApplied={() => setItemRegistryRevision((prev) => prev + 1)}
            dialogs={dialogs}
            activeDialogTriggers={activeDialogTriggers}
            dialogEditorOpen={dialogEditorOpen}
            dialogLocations={dialogLocations}
            availableDialogIds={availableDialogIds}
            availableDialogIdSet={availableDialogIdSet}
            enemySpawnOptions={enemySpawnOptions}
            onOpenDialogEditor={openDialogEditor}
            onCloseDialogEditor={closeDialogEditor}
            onAddDialogTrigger={addDialogTrigger}
            onRemoveDialogTrigger={removeDialogTrigger}
            onUpdateDialogTrigger={updateDialogTrigger}
            onUpdateDialogTriggerCondition={updateDialogTriggerCondition}
            onAddDialogCondition={addDialogCondition}
            onRemoveDialogCondition={removeDialogCondition}
            onSaveDialogs={saveDialogsFromModal}
            onSaveTriggers={saveTriggersFromModal}
        />
    );
}
