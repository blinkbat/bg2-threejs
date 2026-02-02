import { useState, useRef, useCallback, useEffect } from "react";
import { Link } from "react-router-dom";
import type { AreaId, AreaData } from "../game/areas/types";
import type { EnemyType } from "../core/types";
import { AREAS } from "../game/areas";
import { areaDataToText } from "./areaTextFormat";
import { generateTextFromArea } from "../game/areas/textLoader";

// =============================================================================
// TYPES
// =============================================================================

type Tool = "paint" | "erase" | "select";
type Layer = "geometry" | "terrain" | "props" | "entities";

interface MapMetadata {
    id: string;
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
}

interface EntityDef {
    id: string;
    x: number;
    z: number;
    type: "enemy" | "chest" | "transition" | "candle" | "secret_door";
    enemyType?: EnemyType;
    chestGold?: number;
    chestItems?: string;
    chestLocked?: string;
    transitionTarget?: AreaId;
    transitionSpawnX?: number;
    transitionSpawnZ?: number;
    transitionDirection?: "north" | "south" | "east" | "west";
    transitionW?: number;
    transitionH?: number;
    candleDx?: number;
    candleDz?: number;
    secretBlockX?: number;
    secretBlockZ?: number;
    secretBlockW?: number;
    secretBlockH?: number;
}

interface TreeDef {
    x: number;
    z: number;
    size: number;
}

interface DecorationDef {
    x: number;
    z: number;
    type: "column" | "broken_column" | "broken_wall";
    rotation?: number;
    size?: number;
}

interface FloorColorDef {
    x: number;
    z: number;
    w: number;
    h: number;
    color: string;
}

// Available areas for loading
const AREA_IDS: AreaId[] = ["dungeon", "forest", "coast", "ruins", "sanctum", "cliffs", "magma_cave"];

// Available enemy types
const ENEMY_TYPES: EnemyType[] = [
    "kobold", "kobold_archer", "kobold_witch_doctor", "ogre", "brood_mother", "broodling",
    "giant_amoeba", "acid_slug", "bat", "undead_knight", "ancient_construct",
    "feral_hound", "corrupt_druid", "skeleton_warrior", "baby_kraken", "kraken_tentacle", "magma_imp"
];

// =============================================================================
// EDIT POPUPS
// =============================================================================

const popupStyle: React.CSSProperties = {
    position: "fixed",
    background: "#2a2a3e",
    border: "1px solid #555",
    borderRadius: 8,
    padding: 16,
    zIndex: 1000,
    minWidth: 280,
    boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
};

const inputStyle: React.CSSProperties = {
    padding: "6px 10px",
    fontSize: 13,
    background: "#333",
    border: "1px solid #555",
    borderRadius: 4,
    color: "#fff",
    width: "100%",
};

const selectStyle: React.CSSProperties = {
    ...inputStyle,
    cursor: "pointer",
};

const buttonStyle: React.CSSProperties = {
    padding: "8px 16px",
    fontSize: 13,
    border: "none",
    borderRadius: 4,
    cursor: "pointer",
};

function EntityEditPopup({ entity, screenX, screenY, onSave, onClose }: {
    entity: EntityDef;
    screenX: number;
    screenY: number;
    onSave: (e: EntityDef) => void;
    onClose: () => void;
}) {
    const [draft, setDraft] = useState({ ...entity });

    return (
        <div style={{ ...popupStyle, left: screenX, top: screenY }} onClick={e => e.stopPropagation()}>
            <h4 style={{ margin: "0 0 12px", fontSize: 15 }}>Edit {draft.type}</h4>

            {draft.type === "enemy" && (
                <label style={{ display: "block", marginBottom: 10 }}>
                    <span style={{ fontSize: 12, display: "block", marginBottom: 4 }}>Enemy Type</span>
                    <select
                        style={selectStyle}
                        value={draft.enemyType || ""}
                        onChange={e => setDraft({ ...draft, enemyType: e.target.value as EnemyType })}
                    >
                        {ENEMY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                </label>
            )}

            {draft.type === "chest" && (
                <>
                    <label style={{ display: "block", marginBottom: 10 }}>
                        <span style={{ fontSize: 12, display: "block", marginBottom: 4 }}>Gold</span>
                        <input
                            type="number"
                            style={inputStyle}
                            value={draft.chestGold || 0}
                            onChange={e => setDraft({ ...draft, chestGold: parseInt(e.target.value) || 0 })}
                        />
                    </label>
                    <label style={{ display: "block", marginBottom: 10 }}>
                        <span style={{ fontSize: 12, display: "block", marginBottom: 4 }}>Items (itemId:qty,...)</span>
                        <input
                            style={inputStyle}
                            value={draft.chestItems || ""}
                            onChange={e => setDraft({ ...draft, chestItems: e.target.value })}
                            placeholder="smallManaPotion:2,battleaxe:1"
                        />
                    </label>
                    <label style={{ display: "block", marginBottom: 10 }}>
                        <span style={{ fontSize: 12, display: "block", marginBottom: 4 }}>Locked (keyId or empty)</span>
                        <input
                            style={inputStyle}
                            value={draft.chestLocked || ""}
                            onChange={e => setDraft({ ...draft, chestLocked: e.target.value || undefined })}
                            placeholder="rustyKey"
                        />
                    </label>
                </>
            )}

            {draft.type === "transition" && (
                <>
                    <label style={{ display: "block", marginBottom: 10 }}>
                        <span style={{ fontSize: 12, display: "block", marginBottom: 4 }}>Target Area</span>
                        <select
                            style={selectStyle}
                            value={draft.transitionTarget || ""}
                            onChange={e => setDraft({ ...draft, transitionTarget: e.target.value as AreaId })}
                        >
                            {AREA_IDS.map(id => <option key={id} value={id}>{id}</option>)}
                        </select>
                    </label>
                    <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                        <label style={{ flex: 1 }}>
                            <span style={{ fontSize: 12, display: "block", marginBottom: 4 }}>Spawn X</span>
                            <input
                                type="number"
                                style={inputStyle}
                                value={draft.transitionSpawnX || 0}
                                onChange={e => setDraft({ ...draft, transitionSpawnX: parseFloat(e.target.value) || 0 })}
                            />
                        </label>
                        <label style={{ flex: 1 }}>
                            <span style={{ fontSize: 12, display: "block", marginBottom: 4 }}>Spawn Z</span>
                            <input
                                type="number"
                                style={inputStyle}
                                value={draft.transitionSpawnZ || 0}
                                onChange={e => setDraft({ ...draft, transitionSpawnZ: parseFloat(e.target.value) || 0 })}
                            />
                        </label>
                    </div>
                    <label style={{ display: "block", marginBottom: 10 }}>
                        <span style={{ fontSize: 12, display: "block", marginBottom: 4 }}>Direction</span>
                        <select
                            style={selectStyle}
                            value={draft.transitionDirection || "north"}
                            onChange={e => setDraft({ ...draft, transitionDirection: e.target.value as "north" | "south" | "east" | "west" })}
                        >
                            <option value="north">north</option>
                            <option value="south">south</option>
                            <option value="east">east</option>
                            <option value="west">west</option>
                        </select>
                    </label>
                    <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                        <label style={{ flex: 1 }}>
                            <span style={{ fontSize: 12, display: "block", marginBottom: 4 }}>Width</span>
                            <input
                                type="number"
                                style={inputStyle}
                                value={draft.transitionW || 1}
                                onChange={e => setDraft({ ...draft, transitionW: parseInt(e.target.value) || 1 })}
                            />
                        </label>
                        <label style={{ flex: 1 }}>
                            <span style={{ fontSize: 12, display: "block", marginBottom: 4 }}>Height</span>
                            <input
                                type="number"
                                style={inputStyle}
                                value={draft.transitionH || 1}
                                onChange={e => setDraft({ ...draft, transitionH: parseInt(e.target.value) || 1 })}
                            />
                        </label>
                    </div>
                </>
            )}

            {draft.type === "candle" && (
                <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                    <label style={{ flex: 1 }}>
                        <span style={{ fontSize: 12, display: "block", marginBottom: 4 }}>Dir X</span>
                        <input
                            type="number"
                            style={inputStyle}
                            value={draft.candleDx || 0}
                            onChange={e => setDraft({ ...draft, candleDx: parseFloat(e.target.value) || 0 })}
                        />
                    </label>
                    <label style={{ flex: 1 }}>
                        <span style={{ fontSize: 12, display: "block", marginBottom: 4 }}>Dir Z</span>
                        <input
                            type="number"
                            style={inputStyle}
                            value={draft.candleDz || 0}
                            onChange={e => setDraft({ ...draft, candleDz: parseFloat(e.target.value) || 0 })}
                        />
                    </label>
                </div>
            )}

            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button style={{ ...buttonStyle, background: "#4a9", color: "#fff" }} onClick={() => onSave(draft)}>Save</button>
                <button style={{ ...buttonStyle, background: "#555", color: "#fff" }} onClick={onClose}>Cancel</button>
            </div>
        </div>
    );
}

function TreeEditPopup({ tree, screenX, screenY, onSave, onClose }: {
    tree: TreeDef;
    screenX: number;
    screenY: number;
    onSave: (t: TreeDef) => void;
    onClose: () => void;
}) {
    const [size, setSize] = useState(tree.size);

    return (
        <div style={{ ...popupStyle, left: screenX, top: screenY }} onClick={e => e.stopPropagation()}>
            <h4 style={{ margin: "0 0 12px", fontSize: 15 }}>Edit Tree</h4>
            <label style={{ display: "block", marginBottom: 10 }}>
                <span style={{ fontSize: 12, display: "block", marginBottom: 4 }}>Size</span>
                <input
                    type="number"
                    step="0.1"
                    style={inputStyle}
                    value={size}
                    onChange={e => setSize(parseFloat(e.target.value) || 1)}
                />
            </label>
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button style={{ ...buttonStyle, background: "#4a9", color: "#fff" }} onClick={() => onSave({ ...tree, size })}>Save</button>
                <button style={{ ...buttonStyle, background: "#555", color: "#fff" }} onClick={onClose}>Cancel</button>
            </div>
        </div>
    );
}

function DecorationEditPopup({ decoration, screenX, screenY, onSave, onClose }: {
    decoration: DecorationDef;
    screenX: number;
    screenY: number;
    onSave: (d: DecorationDef) => void;
    onClose: () => void;
}) {
    const [draft, setDraft] = useState({ ...decoration });

    return (
        <div style={{ ...popupStyle, left: screenX, top: screenY }} onClick={e => e.stopPropagation()}>
            <h4 style={{ margin: "0 0 12px", fontSize: 15 }}>Edit Decoration</h4>
            <label style={{ display: "block", marginBottom: 10 }}>
                <span style={{ fontSize: 12, display: "block", marginBottom: 4 }}>Type</span>
                <select
                    style={selectStyle}
                    value={draft.type}
                    onChange={e => setDraft({ ...draft, type: e.target.value as DecorationDef["type"] })}
                >
                    <option value="column">column</option>
                    <option value="broken_column">broken_column</option>
                    <option value="broken_wall">broken_wall</option>
                </select>
            </label>
            <label style={{ display: "block", marginBottom: 10 }}>
                <span style={{ fontSize: 12, display: "block", marginBottom: 4 }}>Rotation (radians)</span>
                <input
                    type="number"
                    step="0.1"
                    style={inputStyle}
                    value={draft.rotation || 0}
                    onChange={e => setDraft({ ...draft, rotation: parseFloat(e.target.value) || 0 })}
                />
            </label>
            <label style={{ display: "block", marginBottom: 10 }}>
                <span style={{ fontSize: 12, display: "block", marginBottom: 4 }}>Size</span>
                <input
                    type="number"
                    step="0.1"
                    style={inputStyle}
                    value={draft.size || 1}
                    onChange={e => setDraft({ ...draft, size: parseFloat(e.target.value) || 1 })}
                />
            </label>
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button style={{ ...buttonStyle, background: "#4a9", color: "#fff" }} onClick={() => onSave(draft)}>Save</button>
                <button style={{ ...buttonStyle, background: "#555", color: "#fff" }} onClick={onClose}>Cancel</button>
            </div>
        </div>
    );
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
    const [floorColors, setFloorColors] = useState<FloorColorDef[]>([]);

    // Editor state
    const [activeLayer, setActiveLayer] = useState<Layer>("geometry");
    const [activeTool, setActiveTool] = useState<Tool>("paint");
    const [activeBrush, setActiveBrush] = useState<string>("#");
    const [showGrid, setShowGrid] = useState(true);
    const [layerVisibility, setLayerVisibility] = useState({
        geometry: true,
        terrain: true,
        props: true,
        entities: true,
    });

    // Canvas refs
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [isPainting, setIsPainting] = useState(false);
    const [zoom, setZoom] = useState(1);

    // Entity editor popup
    const [editingEntity, setEditingEntity] = useState<{ entity: EntityDef; screenX: number; screenY: number } | null>(null);
    const [editingTree, setEditingTree] = useState<{ tree: TreeDef; index: number; screenX: number; screenY: number } | null>(null);
    const [editingDecoration, setEditingDecoration] = useState<{ decoration: DecorationDef; index: number; screenX: number; screenY: number } | null>(null);

    // Undo/Redo history
    type EditorSnapshot = {
        geometryLayer: string[][];
        terrainLayer: string[][];
        propsLayer: string[][];
        entitiesLayer: string[][];
        entities: EntityDef[];
        trees: TreeDef[];
        decorations: DecorationDef[];
        floorColors: FloorColorDef[];
    };
    const MAX_HISTORY = 50;
    const historyRef = useRef<EditorSnapshot[]>([]);
    const historyIndexRef = useRef(-1);

    const createSnapshot = useCallback((): EditorSnapshot => ({
        geometryLayer: geometryLayer.map(row => [...row]),
        terrainLayer: terrainLayer.map(row => [...row]),
        propsLayer: propsLayer.map(row => [...row]),
        entitiesLayer: entitiesLayer.map(row => [...row]),
        entities: entities.map(e => ({ ...e })),
        trees: trees.map(t => ({ ...t })),
        decorations: decorations.map(d => ({ ...d })),
        floorColors: floorColors.map(f => ({ ...f })),
    }), [geometryLayer, terrainLayer, propsLayer, entitiesLayer, entities, trees, decorations, floorColors]);

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
        setPropsLayer(snapshot.propsLayer.map(row => [...row]));
        setEntitiesLayer(snapshot.entitiesLayer.map(row => [...row]));
        setEntities(snapshot.entities.map(e => ({ ...e })));
        setTrees(snapshot.trees.map(t => ({ ...t })));
        setDecorations(snapshot.decorations.map(d => ({ ...d })));
        setFloorColors(snapshot.floorColors.map(f => ({ ...f })));
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
    }, []);

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

    const BASE_CELL_SIZE = 28;
    const CELL_SIZE = Math.round(BASE_CELL_SIZE * zoom);

    // Resize layers when dimensions change
    useEffect(() => {
        setGeometryLayer(resizeLayer(geometryLayer, metadata.width, metadata.height, "."));
        setTerrainLayer(resizeLayer(terrainLayer, metadata.width, metadata.height, "."));
        setPropsLayer(resizeLayer(propsLayer, metadata.width, metadata.height, "."));
        setEntitiesLayer(resizeLayer(entitiesLayer, metadata.width, metadata.height, "."));
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

        // Draw layers bottom to top
        if (layerVisibility.geometry) drawLayer(ctx, geometryLayer, "geometry");
        if (layerVisibility.terrain) drawLayer(ctx, terrainLayer, "terrain");
        if (layerVisibility.props) drawLayer(ctx, propsLayer, "props");
        if (layerVisibility.entities) drawLayer(ctx, entitiesLayer, "entities");

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

    }, [geometryLayer, terrainLayer, propsLayer, entitiesLayer, metadata, showGrid, layerVisibility, activeLayer, CELL_SIZE]);

    function drawLayer(ctx: CanvasRenderingContext2D, layer: string[][], layerType: Layer) {
        for (let z = 0; z < layer.length; z++) {
            for (let x = 0; x < layer[z].length; x++) {
                const char = layer[z][x];
                if (char === ".") continue;

                const color = getCharColor(char, layerType);
                ctx.fillStyle = color;
                ctx.fillRect(x * CELL_SIZE + 1, z * CELL_SIZE + 1, CELL_SIZE - 2, CELL_SIZE - 2);

                // Draw char label
                ctx.fillStyle = "#fff";
                ctx.font = "14px monospace";
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText(char, x * CELL_SIZE + CELL_SIZE / 2, z * CELL_SIZE + CELL_SIZE / 2);
            }
        }
    }

    function getCharColor(char: string, layer: Layer): string {
        if (layer === "geometry") {
            if (char === "#") return "#444";
            if (char === ">" || char === "<" || char === "^" || char === "v") return "#4a9";
        }
        if (layer === "terrain") {
            if (char === "~") return "#f40";
            if (char === "w") return "#48f";
            if (char === "a") return "#8f0";
        }
        if (layer === "props") {
            if (char === "T") return "#2a5";
            if (char === "C" || char === "c") return "#888";
            if (char === "W") return "#665";
        }
        if (layer === "entities") {
            if (char.startsWith("E")) return "#f44";
            if (char.startsWith("X")) return "#ff0";
            if (char === "@") return "#4af";
        }
        return "#666";
    }

    function getLayerColor(layer: Layer): string {
        switch (layer) {
            case "geometry": return "#888";
            case "terrain": return "#f80";
            case "props": return "#4a4";
            case "entities": return "#f44";
        }
    }

    const getActiveLayer = useCallback(() => {
        switch (activeLayer) {
            case "geometry": return geometryLayer;
            case "terrain": return terrainLayer;
            case "props": return propsLayer;
            case "entities": return entitiesLayer;
        }
    }, [activeLayer, geometryLayer, terrainLayer, propsLayer, entitiesLayer]);

    const setActiveLayerData = useCallback((newLayer: string[][]) => {
        switch (activeLayer) {
            case "geometry": setGeometryLayer(newLayer); break;
            case "terrain": setTerrainLayer(newLayer); break;
            case "props": setPropsLayer(newLayer); break;
            case "entities": setEntitiesLayer(newLayer); break;
        }
    }, [activeLayer]);

    const paintCell = useCallback((x: number, z: number) => {
        const layer = getActiveLayer();
        if (x < 0 || x >= metadata.width || z < 0 || z >= metadata.height) return;

        const newLayer = layer.map(row => [...row]);
        if (activeTool === "paint") {
            newLayer[z][x] = activeBrush;
        } else if (activeTool === "erase") {
            newLayer[z][x] = ".";
        }
        setActiveLayerData(newLayer);
    }, [getActiveLayer, setActiveLayerData, activeTool, activeBrush, metadata.width, metadata.height]);

    const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
        // Ignore right-click (handled by onContextMenu)
        if (e.button !== 0) return;

        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;

        const x = Math.floor((e.clientX - rect.left) / CELL_SIZE);
        const z = Math.floor((e.clientY - rect.top) / CELL_SIZE);

        // Push history before starting to paint
        pushHistory();
        setIsPainting(true);
        paintCell(x, z);
    };

    const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
        if (!isPainting) return;

        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;

        const x = Math.floor((e.clientX - rect.left) / CELL_SIZE);
        const z = Math.floor((e.clientY - rect.top) / CELL_SIZE);

        paintCell(x, z);
    };

    const handleCanvasMouseUp = () => {
        setIsPainting(false);
    };

    const handleCanvasContextMenu = (e: React.MouseEvent<HTMLCanvasElement>) => {
        e.preventDefault();
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;

        const x = Math.floor((e.clientX - rect.left) / CELL_SIZE);
        const z = Math.floor((e.clientY - rect.top) / CELL_SIZE);

        // Check for entity at this position
        const entity = entities.find(ent => Math.floor(ent.x) === x && Math.floor(ent.z) === z);
        if (entity) {
            setEditingEntity({ entity, screenX: e.clientX, screenY: e.clientY });
            setEditingTree(null);
            setEditingDecoration(null);
            return;
        }

        // Check for tree at this position
        const treeIndex = trees.findIndex(t => Math.floor(t.x) === x && Math.floor(t.z) === z);
        if (treeIndex >= 0) {
            setEditingTree({ tree: trees[treeIndex], index: treeIndex, screenX: e.clientX, screenY: e.clientY });
            setEditingEntity(null);
            setEditingDecoration(null);
            return;
        }

        // Check for decoration at this position
        const decIndex = decorations.findIndex(d => Math.floor(d.x) === x && Math.floor(d.z) === z);
        if (decIndex >= 0) {
            setEditingDecoration({ decoration: decorations[decIndex], index: decIndex, screenX: e.clientX, screenY: e.clientY });
            setEditingEntity(null);
            setEditingTree(null);
            return;
        }
    };

    const updateEntity = (updated: EntityDef) => {
        pushHistory();
        setEntities(prev => prev.map(e => e.id === updated.id ? updated : e));
        setEditingEntity(null);
    };

    const updateTree = (index: number, updated: TreeDef) => {
        pushHistory();
        setTrees(prev => prev.map((t, i) => i === index ? updated : t));
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
            width: area.gridSize,
            height: area.gridSize,
            background: area.backgroundColor,
            ground: area.groundColor,
            ambient: area.ambientLight,
            directional: area.directionalLight,
            fog: area.hasFogOfWar,
            spawnX: area.defaultSpawn.x,
            spawnZ: area.defaultSpawn.z,
        });

        const size = area.gridSize;

        // Compute geometry layer from rooms and hallways
        const newGeometry = computeGeometryFromArea(area, size);
        setGeometryLayer(newGeometry);

        // Compute terrain layer from lava zones
        const newTerrain = computeTerrainFromArea(area, size);
        setTerrainLayer(newTerrain);

        // Compute props layer from trees and decorations
        const newProps = computePropsFromArea(area, size);
        setPropsLayer(newProps);

        // Compute entities layer from enemies, chests, transitions
        const newEntities = computeEntitiesFromArea(area, size);
        setEntitiesLayer(newEntities);

        // Store detailed data that can't be shown in grid
        setFloorColors(area.roomFloors.map(f => ({ x: f.x, z: f.z, w: f.w, h: f.h, color: f.color })));
        setTrees(area.trees.map(t => ({ x: t.x, z: t.z, size: t.size })));
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
            entityDefs.push({ id: `e${entityId++}`, x: c.x, z: c.z, type: "candle", candleDx: c.dx, candleDz: c.dz });
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

    // Load coast by default on mount
    useEffect(() => {
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

    // Regenerate text file from TypeScript source (fixes any drift)
    const regenerateFromTS = async () => {
        const areaId = metadata.id as AreaId;
        const content = generateTextFromArea(areaId);
        if (!content) {
            console.error("No TypeScript source for area:", areaId);
            return;
        }

        setSaveStatus("saving");
        try {
            const res = await fetch("/__save-map", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ areaId, content }),
            });
            const data = await res.json();
            if (data.success) {
                setSaveStatus("saved");
                // Reload the area to reflect the regenerated data
                loadArea(areaId);
                setTimeout(() => setSaveStatus("idle"), 2000);
            } else {
                console.error("Regenerate failed:", data.error);
                setSaveStatus("error");
            }
        } catch (err) {
            console.error("Regenerate error:", err);
            setSaveStatus("error");
        }
    };

    const buildAreaDataFromEditor = (): AreaData => {
        // Extract rooms from geometry layer
        const { rooms, hallways } = extractRoomsFromGeometryLayer(geometryLayer);

        // Extract lava zones from terrain layer
        const lavaZones = extractLavaFromTerrainLayer(terrainLayer);

        // Extract trees and decorations from props layer, merging with detailed state for metadata
        const gridProps = extractPropsFromLayer(propsLayer);
        const mergedTrees: TreeLocation[] = gridProps.trees.map(gt => {
            // Find matching tree in state for metadata (size)
            const stateTree = trees.find(t => Math.floor(t.x) === gt.x && Math.floor(t.z) === gt.z);
            return stateTree ? { ...stateTree } : { x: gt.x, z: gt.z, size: 1.0 };
        });
        const mergedDecorations: Decoration[] = gridProps.decorations.map(gd => {
            // Find matching decoration in state for metadata (rotation, size)
            const stateDec = decorations.find(d => Math.floor(d.x) === gd.x && Math.floor(d.z) === gd.z);
            return stateDec ? { ...stateDec } : { x: gd.x, z: gd.z, type: gd.type };
        });

        // Extract enemies and chests from entities layer, merging with detailed state
        const gridEntities = extractEntitiesFromGrid(entitiesLayer);
        const enemySpawns: EnemySpawn[] = gridEntities.enemies.map(ge => {
            const stateEnemy = entities.find(e => e.type === "enemy" && Math.floor(e.x) === ge.x && Math.floor(e.z) === ge.z);
            return { x: ge.x + 0.5, z: ge.z + 0.5, type: stateEnemy?.enemyType ?? "skeleton_warrior" };
        });
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
            .filter(e => e.type === "candle")
            .map(e => ({ x: e.x, z: e.z, dx: e.candleDx ?? 0, dz: e.candleDz ?? 0 }));

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
            gridSize: metadata.width,
            backgroundColor: metadata.background,
            groundColor: metadata.ground,
            ambientLight: metadata.ambient,
            directionalLight: metadata.directional,
            hasFogOfWar: metadata.fog,
            defaultSpawn: { x: metadata.spawnX, z: metadata.spawnZ },
            rooms,
            hallways,
            roomFloors: floorColors,
            enemySpawns,
            transitions: transitionList,
            chests: chestList,
            trees: mergedTrees,
            decorations: mergedDecorations.length > 0 ? mergedDecorations : undefined,
            lavaZones: lavaZones.length > 0 ? lavaZones : undefined,
            candles: candleList.length > 0 ? candleList : undefined,
            secretDoors: secretDoorList.length > 0 ? secretDoorList : undefined,
        };
    };

    const getBrushOptions = (): { char: string; label: string }[] => {
        switch (activeLayer) {
            case "geometry":
                return [
                    { char: "#", label: "Wall" },
                    { char: ".", label: "Floor" },
                    { char: "^", label: "Door N" },
                    { char: "v", label: "Door S" },
                    { char: ">", label: "Door E" },
                    { char: "<", label: "Door W" },
                ];
            case "terrain":
                return [
                    { char: ".", label: "Empty" },
                    { char: "~", label: "Lava" },
                    { char: "w", label: "Water" },
                    { char: "a", label: "Acid" },
                ];
            case "props":
                return [
                    { char: ".", label: "Empty" },
                    { char: "T", label: "Tree" },
                    { char: "C", label: "Column" },
                    { char: "c", label: "Broken Col" },
                    { char: "W", label: "Broken Wall" },
                ];
            case "entities":
                return [
                    { char: ".", label: "Empty" },
                    { char: "@", label: "Spawn" },
                    { char: "E", label: "Enemy" },
                    { char: "X", label: "Chest" },
                ];
        }
    };

    return (
        <div style={{ display: "flex", height: "100vh", background: "#1a1a2e", color: "#eee", fontFamily: "sans-serif" }}>
            {/* Left Panel - Tools */}
            <div style={{ width: 280, padding: 20, borderRight: "1px solid #333", display: "flex", flexDirection: "column", gap: 20, overflowY: "auto" }}>
                <Link to="/" style={{ color: "#4af", textDecoration: "none" }}>&larr; Back to Game</Link>

                <h2 style={{ margin: 0, fontSize: 22 }}>Map Editor</h2>

                {/* Load Existing Area */}
                <div>
                    <h3 style={{ margin: "0 0 12px", fontSize: 16 }}>Load Area</h3>
                    <select
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
                        defaultValue=""
                    >
                        <option value="">-- Select area --</option>
                        {AREA_IDS.map(id => (
                            <option key={id} value={id}>{id}</option>
                        ))}
                    </select>
                </div>

                {/* Layer Selection */}
                <div>
                    <h3 style={{ margin: "0 0 12px", fontSize: 16 }}>Layers</h3>
                    {(["geometry", "terrain", "props", "entities"] as Layer[]).map(layer => (
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
                        <button
                            onClick={undo}
                            style={{ flex: 1, padding: 8, background: "#333", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontSize: 12 }}
                            title="Undo (Ctrl+Z)"
                        >
                            Undo
                        </button>
                        <button
                            onClick={redo}
                            style={{ flex: 1, padding: 8, background: "#333", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontSize: 12 }}
                            title="Redo (Ctrl+Y)"
                        >
                            Redo
                        </button>
                    </div>
                </div>

                {/* Brush */}
                <div>
                    <h3 style={{ margin: "0 0 12px", fontSize: 16 }}>Brush ({activeLayer})</h3>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                        {getBrushOptions().map(opt => (
                            <button
                                key={opt.char}
                                onClick={() => setActiveBrush(opt.char)}
                                title={opt.label}
                                style={{
                                    width: 48,
                                    height: 48,
                                    background: activeBrush === opt.char ? getCharColor(opt.char, activeLayer) : "#333",
                                    color: "#fff",
                                    border: activeBrush === opt.char ? "2px solid #fff" : "1px solid #555",
                                    borderRadius: 6,
                                    cursor: "pointer",
                                    fontFamily: "monospace",
                                    fontSize: 20,
                                }}
                            >
                                {opt.char}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Grid Toggle */}
                <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14 }}>
                    <input type="checkbox" checked={showGrid} onChange={() => setShowGrid(!showGrid)} style={{ width: 18, height: 18 }} />
                    Show Grid
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

                {/* Save */}
                <button
                    onClick={saveMap}
                    disabled={saveStatus === "saving"}
                    style={{
                        padding: "12px 20px",
                        fontSize: 14,
                        background: saveStatus === "saved" ? "#2a6" : saveStatus === "error" ? "#a44" : "#4a9",
                        color: "#fff",
                        border: "none",
                        borderRadius: 6,
                        cursor: saveStatus === "saving" ? "wait" : "pointer",
                        marginTop: "auto",
                    }}
                >
                    {saveStatus === "saving" ? "Saving..." : saveStatus === "saved" ? "Saved!" : saveStatus === "error" ? "Error" : "Save Map"}
                </button>

                {/* Regenerate from TypeScript */}
                <button
                    onClick={regenerateFromTS}
                    disabled={saveStatus === "saving"}
                    style={{
                        padding: "10px 16px",
                        fontSize: 13,
                        background: "#666",
                        color: "#fff",
                        border: "none",
                        borderRadius: 6,
                        cursor: "pointer",
                    }}
                    title="Regenerate text file from TypeScript source (fixes any drift)"
                >
                    Regen from TS
                </button>
            </div>

            {/* Center - Canvas */}
            <div style={{ flex: 1, overflow: "auto", padding: 16 }}>
                <canvas
                    ref={canvasRef}
                    onMouseDown={handleCanvasMouseDown}
                    onMouseMove={handleCanvasMouseMove}
                    onMouseUp={handleCanvasMouseUp}
                    onMouseLeave={handleCanvasMouseUp}
                    onContextMenu={handleCanvasContextMenu}
                    style={{ border: "1px solid #333", cursor: "crosshair" }}
                />

                {/* Entity Edit Popup */}
                {editingEntity && (
                    <EntityEditPopup
                        entity={editingEntity.entity}
                        screenX={editingEntity.screenX}
                        screenY={editingEntity.screenY}
                        onSave={updateEntity}
                        onClose={() => setEditingEntity(null)}
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
                            onChange={e => setMetadata(prev => ({ ...prev, spawnX: parseInt(e.target.value) || 0 }))}
                            style={{ padding: 8, fontSize: 14, background: "#333", border: "1px solid #555", borderRadius: 4, color: "#fff" }}
                        />
                    </label>
                    <label style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
                        <span style={{ fontSize: 13 }}>Spawn Z</span>
                        <input
                            type="number"
                            value={metadata.spawnZ}
                            onChange={e => setMetadata(prev => ({ ...prev, spawnZ: parseInt(e.target.value) || 0 }))}
                            style={{ padding: 8, fontSize: 14, background: "#333", border: "1px solid #555", borderRadius: 4, color: "#fff" }}
                        />
                    </label>
                </div>
            </div>
        </div>
    );
}

// =============================================================================
// HELPERS
// =============================================================================

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

import type { EnemySpawn, AreaTransition, ChestLocation, TreeLocation, Decoration, LavaZone } from "../game/areas/types";
import type { Room } from "../core/types";

function computeGeometryFromArea(area: AreaData, size: number): string[][] {
    const grid: string[][] = Array.from({ length: size }, () => Array(size).fill("#"));

    // Carve out rooms
    for (const room of area.rooms) {
        for (let z = room.z; z < room.z + room.h && z < size; z++) {
            for (let x = room.x; x < room.x + room.w && x < size; x++) {
                if (x >= 0 && z >= 0) grid[z][x] = ".";
            }
        }
    }

    // Carve out hallways
    for (const hall of area.hallways) {
        const minX = Math.min(hall.x1, hall.x2);
        const maxX = Math.max(hall.x1, hall.x2);
        const minZ = Math.min(hall.z1, hall.z2);
        const maxZ = Math.max(hall.z1, hall.z2);
        for (let z = minZ; z <= maxZ && z < size; z++) {
            for (let x = minX; x <= maxX && x < size; x++) {
                if (x >= 0 && z >= 0) grid[z][x] = ".";
            }
        }
    }

    // Mark transitions as doors
    for (const trans of area.transitions) {
        const doorChar = trans.direction === "north" ? "^" :
                         trans.direction === "south" ? "v" :
                         trans.direction === "east" ? ">" : "<";
        for (let dz = 0; dz < trans.h; dz++) {
            for (let dx = 0; dx < trans.w; dx++) {
                const x = trans.x + dx;
                const z = trans.z + dz;
                if (x >= 0 && x < size && z >= 0 && z < size) grid[z][x] = doorChar;
            }
        }
    }

    return grid;
}

function computeTerrainFromArea(area: AreaData, size: number): string[][] {
    const grid: string[][] = Array.from({ length: size }, () => Array(size).fill("."));

    if (area.lavaZones) {
        for (const zone of area.lavaZones) {
            for (let z = zone.z; z < zone.z + zone.h && z < size; z++) {
                for (let x = zone.x; x < zone.x + zone.w && x < size; x++) {
                    if (x >= 0 && z >= 0) grid[z][x] = "~";
                }
            }
        }
    }

    return grid;
}

function computePropsFromArea(area: AreaData, size: number): string[][] {
    const grid: string[][] = Array.from({ length: size }, () => Array(size).fill("."));

    // Trees
    for (const tree of area.trees) {
        const x = Math.floor(tree.x);
        const z = Math.floor(tree.z);
        if (x >= 0 && x < size && z >= 0 && z < size) grid[z][x] = "T";
    }

    // Decorations
    if (area.decorations) {
        for (const dec of area.decorations) {
            const x = Math.floor(dec.x);
            const z = Math.floor(dec.z);
            if (x >= 0 && x < size && z >= 0 && z < size) {
                if (dec.type === "column") grid[z][x] = "C";
                else if (dec.type === "broken_column") grid[z][x] = "c";
                else if (dec.type === "broken_wall") grid[z][x] = "W";
            }
        }
    }

    return grid;
}

function computeEntitiesFromArea(area: AreaData, size: number): string[][] {
    const grid: string[][] = Array.from({ length: size }, () => Array(size).fill("."));

    // Spawn point
    const sx = Math.floor(area.defaultSpawn.x);
    const sz = Math.floor(area.defaultSpawn.z);
    if (sx >= 0 && sx < size && sz >= 0 && sz < size) grid[sz][sx] = "@";

    // Enemies
    for (const enemy of area.enemySpawns) {
        const x = Math.floor(enemy.x);
        const z = Math.floor(enemy.z);
        if (x >= 0 && x < size && z >= 0 && z < size) grid[z][x] = "E";
    }

    // Chests
    for (const chest of area.chests) {
        const x = Math.floor(chest.x);
        const z = Math.floor(chest.z);
        if (x >= 0 && x < size && z >= 0 && z < size) grid[z][x] = "X";
    }

    return grid;
}

function extractRoomsFromGeometryLayer(geometry: string[][]): { rooms: Room[]; hallways: { x1: number; z1: number; x2: number; z2: number }[] } {
    if (geometry.length === 0) return { rooms: [], hallways: [] };

    const height = geometry.length;
    const width = geometry[0].length;
    const walkable: boolean[][] = Array.from({ length: height }, () => Array(width).fill(false));

    for (let z = 0; z < height; z++) {
        for (let x = 0; x < width; x++) {
            const char = geometry[z]?.[x] ?? "#";
            walkable[z][x] = char !== "#";
        }
    }

    const visited: boolean[][] = Array.from({ length: height }, () => Array(width).fill(false));
    const rooms: Room[] = [];

    for (let z = 0; z < height; z++) {
        for (let x = 0; x < width; x++) {
            if (walkable[z][x] && !visited[z][x]) {
                let w = 0;
                while (x + w < width && walkable[z][x + w] && !visited[z][x + w]) w++;

                let h = 1;
                outer: while (z + h < height) {
                    for (let dx = 0; dx < w; dx++) {
                        if (!walkable[z + h][x + dx] || visited[z + h][x + dx]) break outer;
                    }
                    h++;
                }

                if (w >= 2 && h >= 2) {
                    rooms.push({ x, z, w, h });
                    for (let rz = z; rz < z + h; rz++) {
                        for (let rx = x; rx < x + w; rx++) {
                            visited[rz][rx] = true;
                        }
                    }
                }
            }
        }
    }

    // Remaining cells become 1x1 rooms
    for (let z = 0; z < height; z++) {
        for (let x = 0; x < width; x++) {
            if (walkable[z][x] && !visited[z][x]) {
                rooms.push({ x, z, w: 1, h: 1 });
            }
        }
    }

    return { rooms, hallways: [] };
}

function extractLavaFromTerrainLayer(terrain: string[][]): LavaZone[] {
    if (terrain.length === 0) return [];

    const height = terrain.length;
    const width = terrain[0].length;
    const visited: boolean[][] = Array.from({ length: height }, () => Array(width).fill(false));
    const zones: LavaZone[] = [];

    for (let z = 0; z < height; z++) {
        for (let x = 0; x < width; x++) {
            if (terrain[z][x] === "~" && !visited[z][x]) {
                let w = 0;
                while (x + w < width && terrain[z][x + w] === "~" && !visited[z][x + w]) w++;

                let h = 1;
                outer: while (z + h < height) {
                    for (let dx = 0; dx < w; dx++) {
                        if (terrain[z + h][x + dx] !== "~" || visited[z + h][x + dx]) break outer;
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

function extractPropsFromLayer(props: string[][]): { trees: TreeLocation[]; decorations: Decoration[] } {
    const trees: TreeLocation[] = [];
    const decorations: Decoration[] = [];

    for (let z = 0; z < props.length; z++) {
        for (let x = 0; x < props[z].length; x++) {
            const char = props[z][x];
            if (char === "T") trees.push({ x, z, size: 1.0 });
            else if (char === "C") decorations.push({ x, z, type: "column" });
            else if (char === "c") decorations.push({ x, z, type: "broken_column" });
            else if (char === "W") decorations.push({ x, z, type: "broken_wall" });
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

// function extractEntitiesFromLayer(
//     entitiesLayer: string[][],
//     entityDefs: EntityDef[],
//     _areaId: AreaId
// ): { enemySpawns: EnemySpawn[]; chests: ChestLocation[]; transitions: AreaTransition[] } {
//     const enemySpawns: EnemySpawn[] = [];
//     const chests: ChestLocation[] = [];
//     const transitions: AreaTransition[] = [];

//     for (let z = 0; z < entitiesLayer.length; z++) {
//         for (let x = 0; x < entitiesLayer[z].length; x++) {
//             const char = entitiesLayer[z][x];
//             if (char === "E") {
//                 // Find matching entity def or default
//                 const def = entityDefs.find(e => e.type === "enemy");
//                 enemySpawns.push({ x, z, type: (def?.enemyType ?? "skeleton_warrior") as EnemyType });
//             } else if (char === "X") {
//                 chests.push({ x: x + 0.5, z: z + 0.5, contents: [] });
//             }
//         }
//     }

//     return { enemySpawns, chests, transitions };
// }
