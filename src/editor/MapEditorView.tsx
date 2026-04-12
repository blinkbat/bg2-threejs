import type { MouseEventHandler, RefObject } from "react";
import { Link } from "react-router-dom";
import Tippy from "@tippyjs/react";
import type {
    AreaSceneEffectId,
    AreaDialogDefinition,
    AreaDialogTrigger,
    AreaDialogTriggerCondition,
    AreaId,
    AreaLocation,
} from "../game/areas/types";
import { AREA_SCENE_EFFECT_IDS } from "../game/areas/types";
import { DialogEditorModal, ItemRegistryEditorModal } from "./components";
import type { EnemySpawnOption } from "./components/dialogEditorHelpers";
import { ConnectionsPanel } from "./panels";
import { DecorationEditPopup, EntityEditPopup, LocationEditPopup, TreeEditPopup } from "./popups";
import { getCharColor, getLayerColor } from "./editorViewUtils";
import type { EditorClipboard, EditorContextMenuState } from "./mapEditorHelpers";
import type { DecorationDef, EntityDef, Layer, MapMetadata, Tool, TreeDef } from "./types";

const EDITOR_LAYERS: Layer[] = ["geometry", "terrain", "floor", "props", "entities", "locations"];
const EDITOR_TOOLS: Tool[] = ["paint", "erase"];
const BRUSH_SIZES = [1, 2, 3, 5, 8];

interface MapEditorViewProps {
    metadata: MapMetadata;
    entities: EntityDef[];
    saveStatus: "idle" | "saving" | "saved" | "error";
    availableAreaIds: string[];
    selectedAreaId: string;
    layerVisibility: Record<Layer, boolean>;
    activeLayer: Layer;
    activeTool: Tool;
    brushSize: number;
    activeBrush: string;
    brushOptions: Array<{ char: string; label: string }>;
    isTileLayerEditable: boolean;
    activeTileLayerIndex: number;
    activeTileLayerCount: number;
    activeTileTint: number;
    showGrid: boolean;
    isometric: boolean;
    zoom: number;
    canvasRef: RefObject<HTMLCanvasElement | null>;
    onSaveMap: () => void;
    onLoadArea: (areaId: AreaId) => void;
    onCreateNewArea: () => void;
    onToggleLayerVisibility: (layer: Layer) => void;
    onSelectLayer: (layer: Layer) => void;
    onSelectTool: (tool: Tool) => void;
    onUndo: () => void;
    onRedo: () => void;
    onBrushSizeChange: (size: number) => void;
    onActiveBrushChange: (char: string) => void;
    onSelectTileLayer: (index: number) => void;
    onAddActiveTileLayer: () => void;
    onRemoveActiveTileLayer: () => void;
    onActiveTileTintChange: (value: number) => void;
    onToggleShowGrid: () => void;
    onToggleIsometric: () => void;
    onZoomOut: () => void;
    onZoomReset: () => void;
    onZoomIn: () => void;
    onCanvasMouseDown: MouseEventHandler<HTMLCanvasElement>;
    onCanvasMouseMove: MouseEventHandler<HTMLCanvasElement>;
    onCanvasMouseUp: MouseEventHandler<HTMLCanvasElement>;
    onCanvasMouseLeave: () => void;
    onCanvasContextMenu: MouseEventHandler<HTMLCanvasElement>;
    contextMenu: EditorContextMenuState | null;
    clipboard: EditorClipboard | null;
    onOpenPropertiesFromContextMenu: () => void;
    onCopyFromContextMenu: () => void;
    onPasteFromContextMenu: () => void;
    editingEntity: { entity: EntityDef; screenX: number; screenY: number } | null;
    editingTree: { tree: TreeDef; index: number; screenX: number; screenY: number } | null;
    editingDecoration: { decoration: DecorationDef; index: number; screenX: number; screenY: number } | null;
    editingLocation: { location: AreaLocation; screenX: number; screenY: number } | null;
    itemRegistryRevision: number;
    onSaveEditingEntity: (entity: EntityDef) => void;
    onCloseEditingEntity: () => void;
    onEditTransition: (entity: EntityDef, screenX: number, screenY: number) => void;
    onSaveEditingTree: (tree: TreeDef) => void;
    onCloseEditingTree: () => void;
    onSaveEditingDecoration: (decoration: DecorationDef) => void;
    onCloseEditingDecoration: () => void;
    onSaveEditingLocation: (location: AreaLocation) => void;
    onDeleteEditingLocation: () => void;
    onCloseEditingLocation: () => void;
    onMetadataIdChange: (value: string) => void;
    onMetadataIdBlur: () => void;
    onMetadataNameChange: (value: string) => void;
    onMetadataFlavorChange: (value: string) => void;
    onMetadataWidthChange: (value: string) => void;
    onMetadataHeightChange: (value: string) => void;
    onMetadataBackgroundChange: (value: string) => void;
    onMetadataGroundChange: (value: string) => void;
    onMetadataAmbientChange: (value: string) => void;
    onMetadataDirectionalChange: (value: string) => void;
    onMetadataFogChange: (checked: boolean) => void;
    onMetadataSceneEffectChange: (effectId: AreaSceneEffectId, checked: boolean) => void;
    itemRegistryEditorOpen: boolean;
    onOpenItemRegistry: () => void;
    onCloseItemRegistry: () => void;
    onItemRegistryApplied: () => void;
    dialogs: AreaDialogDefinition[];
    activeDialogTriggers: AreaDialogTrigger[];
    dialogEditorOpen: boolean;
    dialogLocations: AreaLocation[];
    availableDialogIds: string[];
    availableDialogIdSet: Set<string>;
    enemySpawnOptions: EnemySpawnOption[];
    onOpenDialogEditor: () => void;
    onCloseDialogEditor: () => void;
    onAddDialogTrigger: () => void;
    onRemoveDialogTrigger: (triggerId: string) => void;
    onUpdateDialogTrigger: (triggerId: string, updater: (trigger: AreaDialogTrigger) => AreaDialogTrigger) => void;
    onUpdateDialogTriggerCondition: (
        triggerId: string,
        conditionIndex: number,
        updater: (condition: AreaDialogTriggerCondition) => AreaDialogTriggerCondition
    ) => void;
    onAddDialogCondition: (triggerId: string) => void;
    onRemoveDialogCondition: (triggerId: string, conditionIndex: number) => void;
    onSaveDialogs: (dialogs: AreaDialogDefinition[], dialogIdRemap?: Record<string, string>) => void;
    onSaveTriggers: (triggers: AreaDialogTrigger[]) => void;
}

export function MapEditorView(props: MapEditorViewProps) {
    const {
        metadata,
        entities,
        saveStatus,
        availableAreaIds,
        selectedAreaId,
        layerVisibility,
        activeLayer,
        activeTool,
        brushSize,
        activeBrush,
        brushOptions,
        isTileLayerEditable,
        activeTileLayerIndex,
        activeTileLayerCount,
        activeTileTint,
        showGrid,
        isometric,
        zoom,
        canvasRef,
        onSaveMap,
        onLoadArea,
        onCreateNewArea,
        onToggleLayerVisibility,
        onSelectLayer,
        onSelectTool,
        onUndo,
        onRedo,
        onBrushSizeChange,
        onActiveBrushChange,
        onSelectTileLayer,
        onAddActiveTileLayer,
        onRemoveActiveTileLayer,
        onActiveTileTintChange,
        onToggleShowGrid,
        onToggleIsometric,
        onZoomOut,
        onZoomReset,
        onZoomIn,
        onCanvasMouseDown,
        onCanvasMouseMove,
        onCanvasMouseUp,
        onCanvasMouseLeave,
        onCanvasContextMenu,
        contextMenu,
        clipboard,
        onOpenPropertiesFromContextMenu,
        onCopyFromContextMenu,
        onPasteFromContextMenu,
        editingEntity,
        editingTree,
        editingDecoration,
        editingLocation,
        itemRegistryRevision,
        onSaveEditingEntity,
        onCloseEditingEntity,
        onEditTransition,
        onSaveEditingTree,
        onCloseEditingTree,
        onSaveEditingDecoration,
        onCloseEditingDecoration,
        onSaveEditingLocation,
        onDeleteEditingLocation,
        onCloseEditingLocation,
        onMetadataIdChange,
        onMetadataIdBlur,
        onMetadataNameChange,
        onMetadataFlavorChange,
        onMetadataWidthChange,
        onMetadataHeightChange,
        onMetadataBackgroundChange,
        onMetadataGroundChange,
        onMetadataAmbientChange,
        onMetadataDirectionalChange,
        onMetadataFogChange,
        onMetadataSceneEffectChange,
        itemRegistryEditorOpen,
        onOpenItemRegistry,
        onCloseItemRegistry,
        onItemRegistryApplied,
        dialogs,
        activeDialogTriggers,
        dialogEditorOpen,
        dialogLocations,
        availableDialogIds,
        availableDialogIdSet,
        enemySpawnOptions,
        onOpenDialogEditor,
        onCloseDialogEditor,
        onAddDialogTrigger,
        onRemoveDialogTrigger,
        onUpdateDialogTrigger,
        onUpdateDialogTriggerCondition,
        onAddDialogCondition,
        onRemoveDialogCondition,
        onSaveDialogs,
        onSaveTriggers,
    } = props;

    return (
        <div style={{ display: "flex", height: "100vh", background: "#1a1a2e", color: "#eee" }}>
            <Tippy content="Save map (Ctrl+S)" placement="bottom" delay={[300, 0]}>
            <button
                onClick={onSaveMap}
                disabled={saveStatus === "saving"}
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
            </Tippy>

            <div
                style={{
                    width: 280,
                    padding: 20,
                    borderRight: "1px solid #333",
                    display: "flex",
                    flexDirection: "column",
                    gap: 20,
                    overflowY: "auto",
                }}
            >
                <Link to="/" style={{ color: "#4af", textDecoration: "none" }}>&larr; Back to Game</Link>

                <h2 style={{ margin: 0, fontSize: 22 }}>Map Editor</h2>

                <div>
                    <h3 style={{ margin: "0 0 12px", fontSize: 16 }}>Load Area</h3>
                    <select
                        value={selectedAreaId}
                        onChange={(event) => event.target.value && onLoadArea(event.target.value as AreaId)}
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
                        {availableAreaIds.map((id) => (
                            <option key={id} value={id}>{id}</option>
                        ))}
                    </select>
                    <button
                        onClick={onCreateNewArea}
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

                <div>
                    <h3 style={{ margin: "0 0 12px", fontSize: 16 }}>Layers</h3>
                    {EDITOR_LAYERS.map((layer) => (
                        <div key={layer} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                            <input
                                type="checkbox"
                                checked={layerVisibility[layer]}
                                onChange={() => onToggleLayerVisibility(layer)}
                                style={{ width: 18, height: 18 }}
                            />
                            <button
                                onClick={() => onSelectLayer(layer)}
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

                <div>
                    <h3 style={{ margin: "0 0 12px", fontSize: 16 }}>Tools</h3>
                    <div style={{ display: "flex", gap: 8 }}>
                        {EDITOR_TOOLS.map((tool) => (
                            <button
                                key={tool}
                                onClick={() => onSelectTool(tool)}
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
                                onClick={onUndo}
                                style={{
                                    flex: 1,
                                    padding: 8,
                                    background: "#333",
                                    color: "#fff",
                                    border: "none",
                                    borderRadius: 4,
                                    cursor: "pointer",
                                    fontSize: 12,
                                }}
                            >
                                Undo
                            </button>
                        </Tippy>
                        <Tippy content="Redo (Ctrl+Y)" delay={0}>
                            <button
                                onClick={onRedo}
                                style={{
                                    flex: 1,
                                    padding: 8,
                                    background: "#333",
                                    color: "#fff",
                                    border: "none",
                                    borderRadius: 4,
                                    cursor: "pointer",
                                    fontSize: 12,
                                }}
                            >
                                Redo
                            </button>
                        </Tippy>
                    </div>
                    <div style={{ marginTop: 12 }}>
                        <span style={{ fontSize: 13 }}>Brush Size: {brushSize}x{brushSize}</span>
                        <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                            {BRUSH_SIZES.map((size) => (
                                <button
                                    key={size}
                                    onClick={() => onBrushSizeChange(size)}
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

                <div>
                    <h3 style={{ margin: "0 0 12px", fontSize: 16 }}>Brush ({activeLayer})</h3>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                        {brushOptions.map((option) => (
                            <Tippy key={option.char} content={option.label} delay={0}>
                                <button
                                    onClick={() => onActiveBrushChange(option.char)}
                                    style={{
                                        width: 48,
                                        height: 48,
                                        background: activeBrush === option.char ? getCharColor(option.char, activeLayer) : "#333",
                                        color: "#fff",
                                        border: activeBrush === option.char ? "2px solid #fff" : "1px solid #555",
                                        borderRadius: 6,
                                        cursor: "pointer",
                                        fontSize: 20,
                                    }}
                                >
                                    {option.char}
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
                                    onClick={() => onSelectTileLayer(index)}
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
                                onClick={onAddActiveTileLayer}
                                style={{
                                    flex: 1,
                                    padding: "6px 0",
                                    fontSize: 12,
                                    background: "#2f5",
                                    color: "#111",
                                    border: "none",
                                    borderRadius: 4,
                                    cursor: "pointer",
                                }}
                            >
                                + Layer
                            </button>
                            <button
                                onClick={onRemoveActiveTileLayer}
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
                                onChange={(event) => onActiveTileTintChange(parseInt(event.target.value, 10) || 0)}
                            />
                        </label>
                    </div>
                )}

                <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14 }}>
                    <input
                        type="checkbox"
                        checked={showGrid}
                        onChange={onToggleShowGrid}
                        style={{ width: 18, height: 18 }}
                    />
                    Show Grid
                </label>

                <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14 }}>
                    <input
                        type="checkbox"
                        checked={isometric}
                        onChange={onToggleIsometric}
                        style={{ width: 18, height: 18 }}
                    />
                    Isometric View
                </label>

                <div>
                    <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>Zoom: {Math.round(zoom * 100)}%</h3>
                    <div style={{ display: "flex", gap: 8 }}>
                        <button
                            onClick={onZoomOut}
                            style={{ flex: 1, padding: 8, background: "#333", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}
                        >
                            -
                        </button>
                        <button
                            onClick={onZoomReset}
                            style={{ flex: 1, padding: 8, background: "#333", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}
                        >
                            Reset
                        </button>
                        <button
                            onClick={onZoomIn}
                            style={{ flex: 1, padding: 8, background: "#333", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}
                        >
                            +
                        </button>
                    </div>
                </div>
            </div>

            <div style={{ flex: 1, overflow: "auto", padding: 16, background: metadata.background }}>
                <div
                    style={{
                        perspective: isometric ? "1000px" : "none",
                        perspectiveOrigin: "center center",
                    }}
                >
                    <canvas
                        ref={canvasRef}
                        onMouseDown={onCanvasMouseDown}
                        onMouseMove={onCanvasMouseMove}
                        onMouseUp={onCanvasMouseUp}
                        onMouseLeave={onCanvasMouseLeave}
                        onContextMenu={onCanvasContextMenu}
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
                        onPointerDown={(event) => event.stopPropagation()}
                        onContextMenu={(event) => event.preventDefault()}
                    >
                        <button
                            onClick={onOpenPropertiesFromContextMenu}
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
                            onClick={onCopyFromContextMenu}
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
                            onClick={onPasteFromContextMenu}
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

                {editingEntity && (
                    <EntityEditPopup
                        entity={editingEntity.entity}
                        itemRegistryRevision={itemRegistryRevision}
                        onSave={onSaveEditingEntity}
                        onClose={onCloseEditingEntity}
                        onNavigate={onLoadArea}
                    />
                )}

                {editingTree && (
                    <TreeEditPopup
                        tree={editingTree.tree}
                        onSave={onSaveEditingTree}
                        onClose={onCloseEditingTree}
                    />
                )}

                {editingDecoration && (
                    <DecorationEditPopup
                        decoration={editingDecoration.decoration}
                        onSave={onSaveEditingDecoration}
                        onClose={onCloseEditingDecoration}
                    />
                )}

                {editingLocation && (
                    <LocationEditPopup
                        location={editingLocation.location}
                        mapWidth={metadata.width}
                        mapHeight={metadata.height}
                        onSave={onSaveEditingLocation}
                        onDelete={onDeleteEditingLocation}
                        onClose={onCloseEditingLocation}
                    />
                )}
            </div>

            <div
                style={{
                    width: 500,
                    padding: 20,
                    borderLeft: "1px solid #333",
                    display: "flex",
                    flexDirection: "column",
                    gap: 16,
                    overflowY: "auto",
                }}
            >
                <h3 style={{ margin: 0, fontSize: 18 }}>Map Properties</h3>

                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <span style={{ fontSize: 13 }}>ID</span>
                    <input
                        value={metadata.id}
                        onChange={(event) => onMetadataIdChange(event.target.value)}
                        onBlur={onMetadataIdBlur}
                        style={{ padding: 8, fontSize: 14, background: "#333", border: "1px solid #555", borderRadius: 4, color: "#fff" }}
                    />
                </label>

                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <span style={{ fontSize: 13 }}>Name</span>
                    <input
                        value={metadata.name}
                        onChange={(event) => onMetadataNameChange(event.target.value)}
                        style={{ padding: 8, fontSize: 14, background: "#333", border: "1px solid #555", borderRadius: 4, color: "#fff" }}
                    />
                </label>

                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <span style={{ fontSize: 13 }}>Flavor Text</span>
                    <textarea
                        value={metadata.flavor}
                        onChange={(event) => onMetadataFlavorChange(event.target.value)}
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
                            onChange={(event) => onMetadataWidthChange(event.target.value)}
                            style={{ padding: 8, fontSize: 14, background: "#333", border: "1px solid #555", borderRadius: 4, color: "#fff" }}
                        />
                    </label>
                    <label style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
                        <span style={{ fontSize: 13 }}>Height</span>
                        <input
                            type="number"
                            value={metadata.height}
                            onChange={(event) => onMetadataHeightChange(event.target.value)}
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
                            onChange={(event) => onMetadataBackgroundChange(event.target.value)}
                            style={{ padding: 2, height: 40, background: "#333", border: "1px solid #555", borderRadius: 4 }}
                        />
                    </label>
                    <label style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
                        <span style={{ fontSize: 13 }}>Ground</span>
                        <input
                            type="color"
                            value={metadata.ground}
                            onChange={(event) => onMetadataGroundChange(event.target.value)}
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
                            onChange={(event) => onMetadataAmbientChange(event.target.value)}
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
                            onChange={(event) => onMetadataDirectionalChange(event.target.value)}
                        />
                        <span style={{ fontSize: 12, textAlign: "center" }}>{metadata.directional}</span>
                    </label>
                </div>

                <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14 }}>
                    <input
                        type="checkbox"
                        checked={metadata.fog}
                        onChange={(event) => onMetadataFogChange(event.target.checked)}
                        style={{ width: 18, height: 18 }}
                    />
                    Fog of War
                </label>

                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ fontSize: 13, color: "#c9d4e7" }}>Scene Effects</div>
                    {AREA_SCENE_EFFECT_IDS.map((effectId) => (
                        <label
                            key={effectId}
                            style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14 }}
                        >
                            <input
                                type="checkbox"
                                checked={metadata.sceneEffects?.[effectId] === true}
                                onChange={(event) => onMetadataSceneEffectChange(effectId, event.target.checked)}
                                style={{ width: 18, height: 18 }}
                            />
                            {effectId.charAt(0).toUpperCase() + effectId.slice(1)}
                        </label>
                    ))}
                </div>

                <div style={{ borderTop: "1px solid #444", paddingTop: 14, marginTop: 2, display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                        <h3 style={{ margin: 0, fontSize: 16 }}>Items</h3>
                        <button
                            className="editor-btn editor-btn--small editor-btn--primary"
                            onClick={onOpenItemRegistry}
                        >
                            Open Item Registry
                        </button>
                    </div>
                    <div style={{ fontSize: 12, color: "#9fb5dc" }}>
                        Edit global items (weapons, gear, keys, consumables) used by chests and gameplay.
                    </div>
                </div>

                <div className="editor-trigger-studio">
                    <div className="editor-trigger-studio-header">
                        <h3 className="editor-trigger-studio-title">Triggers</h3>
                        <button
                            onClick={onOpenDialogEditor}
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
                            {dialogs.map((dialog) => (
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

                <div style={{ borderTop: "1px solid #444", paddingTop: 16, marginTop: 2 }}>
                    <ConnectionsPanel
                        currentAreaId={metadata.id}
                        entities={entities}
                        onEditTransition={onEditTransition}
                        onNavigate={onLoadArea}
                    />
                </div>
            </div>

            {itemRegistryEditorOpen && (
                <ItemRegistryEditorModal
                    onClose={onCloseItemRegistry}
                    onApplied={onItemRegistryApplied}
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
                    onAddDialogTrigger={onAddDialogTrigger}
                    onRemoveDialogTrigger={onRemoveDialogTrigger}
                    onUpdateDialogTrigger={onUpdateDialogTrigger}
                    onUpdateDialogTriggerCondition={onUpdateDialogTriggerCondition}
                    onAddDialogCondition={onAddDialogCondition}
                    onRemoveDialogCondition={onRemoveDialogCondition}
                    onClose={onCloseDialogEditor}
                    onSaveDialogs={onSaveDialogs}
                    onSaveTriggers={onSaveTriggers}
                />
            )}
        </div>
    );
}
