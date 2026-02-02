import { useState, useRef, useCallback, useEffect } from "react";
import { Link } from "react-router-dom";
import type { AreaId } from "../game/areas/types";
import type { EnemyType } from "../core/types";

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
    type: "enemy" | "chest" | "transition";
    enemyType?: EnemyType;
    chestGold?: number;
    chestItems?: string;
    transitionTarget?: AreaId;
    transitionSpawn?: string;
}

// Layer characters
const GEOMETRY_CHARS = { wall: "#", floor: ".", doorN: "^", doorS: "v", doorE: ">", doorW: "<" };
const TERRAIN_CHARS = { empty: ".", lava: "~", water: "w", acid: "a" };
const PROPS_CHARS = { empty: ".", tree: "T", column: "C", brokenColumn: "c", brokenWall: "W" };

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

    // Entity definitions
    const [entities, setEntities] = useState<EntityDef[]>([]);

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

    const CELL_SIZE = 28;

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

    }, [geometryLayer, terrainLayer, propsLayer, entitiesLayer, metadata, showGrid, layerVisibility, activeLayer]);

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
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;

        const x = Math.floor((e.clientX - rect.left) / CELL_SIZE);
        const z = Math.floor((e.clientY - rect.top) / CELL_SIZE);

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

    const exportMap = () => {
        const output = generateMapText();
        navigator.clipboard.writeText(output);
        alert("Map copied to clipboard!");
    };

    const generateMapText = (): string => {
        const lines: string[] = [];

        lines.push(`=== AREA: ${metadata.id} ===`);
        lines.push(`name: ${metadata.name}`);
        lines.push(`flavor: ${metadata.flavor}`);
        lines.push(`size: ${metadata.width}x${metadata.height}`);
        lines.push(`background: ${metadata.background}`);
        lines.push(`ground: ${metadata.ground}`);
        lines.push(`ambient: ${metadata.ambient}`);
        lines.push(`directional: ${metadata.directional}`);
        lines.push(`fog: ${metadata.fog}`);
        lines.push(`spawn: ${metadata.spawnX},${metadata.spawnZ}`);
        lines.push("");

        lines.push("=== GEOMETRY ===");
        geometryLayer.forEach(row => lines.push(row.join("")));
        lines.push("");

        lines.push("=== TERRAIN ===");
        terrainLayer.forEach(row => lines.push(row.join("")));
        lines.push("");

        lines.push("=== PROPS ===");
        propsLayer.forEach(row => lines.push(row.join("")));
        lines.push("");

        lines.push("=== ENTITIES ===");
        entitiesLayer.forEach(row => lines.push(row.join("")));
        lines.push("");

        if (entities.length > 0) {
            lines.push("=== ENEMIES ===");
            entities.filter(e => e.type === "enemy").forEach(e => {
                lines.push(`${e.id}: ${e.enemyType}`);
            });
            lines.push("");

            lines.push("=== CHESTS ===");
            entities.filter(e => e.type === "chest").forEach(e => {
                lines.push(`${e.id}: gold=${e.chestGold ?? 0}, items=[${e.chestItems ?? ""}]`);
            });
            lines.push("");

            lines.push("=== TRANSITIONS ===");
            entities.filter(e => e.type === "transition").forEach(e => {
                lines.push(`${e.id}: target=${e.transitionTarget}, spawn=${e.transitionSpawn}`);
            });
        }

        return lines.join("\n");
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
            <div style={{ width: 280, padding: 20, borderRight: "1px solid #333", display: "flex", flexDirection: "column", gap: 20 }}>
                <Link to="/" style={{ color: "#4af", textDecoration: "none" }}>&larr; Back to Game</Link>

                <h2 style={{ margin: 0, fontSize: 22 }}>Map Editor</h2>

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

                {/* Export */}
                <button
                    onClick={exportMap}
                    style={{
                        padding: "12px 20px",
                        fontSize: 14,
                        background: "#4a9",
                        color: "#fff",
                        border: "none",
                        borderRadius: 6,
                        cursor: "pointer",
                        marginTop: "auto",
                    }}
                >
                    Export to Clipboard
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
                    style={{ border: "1px solid #333", cursor: "crosshair" }}
                />
            </div>

            {/* Right Panel - Metadata */}
            <div style={{ width: 320, padding: 20, borderLeft: "1px solid #333", display: "flex", flexDirection: "column", gap: 16 }}>
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
