// =============================================================================
// AREA MINIMAP - Clickable preview of an area for spawn point selection
// =============================================================================

import { useRef, useEffect, useCallback, useState } from "react";
import { AREAS } from "../../game/areas";

interface AreaMinimapProps {
    areaId: string;
    spawnX: number;
    spawnZ: number;
    onSpawnChange: (x: number, z: number) => void;
    width?: number;
    height?: number;
}

export function AreaMinimap({ areaId, spawnX, spawnZ, onSpawnChange, width = 200, height = 200 }: AreaMinimapProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const area = AREAS[areaId];

    // Zoom and pan state
    const [zoom, setZoom] = useState(1);
    const [offsetX, setOffsetX] = useState(0);
    const [offsetZ, setOffsetZ] = useState(0);
    const [isDragging, setIsDragging] = useState(false);
    const [dragStart, setDragStart] = useState({ x: 0, z: 0 });

    // Calculate scale to fit area in preview
    const gridSize = area?.gridSize || 30;
    const baseCellSize = Math.min(width, height) / gridSize;
    const cellSize = baseCellSize * zoom;

    const draw = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas || !area) return;

        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        canvas.width = width;
        canvas.height = height;

        // Background
        ctx.fillStyle = area.groundColor || "#2a2a3e";
        ctx.fillRect(0, 0, width, height);

        // Apply offset for panning
        ctx.save();
        ctx.translate(offsetX, offsetZ);

        // Draw geometry
        for (let z = 0; z < area.geometry.length; z++) {
            for (let x = 0; x < area.geometry[z].length; x++) {
                const char = area.geometry[z][x];
                if (char === "#") {
                    ctx.fillStyle = "#444";
                    ctx.fillRect(x * cellSize, z * cellSize, cellSize, cellSize);
                }
            }
        }

        // Draw transitions as purple
        for (const trans of area.transitions) {
            ctx.fillStyle = "rgba(136, 68, 255, 0.6)";
            ctx.fillRect(trans.x * cellSize, trans.z * cellSize, trans.w * cellSize, trans.h * cellSize);
        }

        // Draw grid lines (subtle) - only when zoomed in enough
        if (zoom >= 1.5) {
            ctx.strokeStyle = "rgba(255,255,255,0.1)";
            ctx.lineWidth = 0.5;
            for (let i = 0; i <= gridSize; i++) {
                ctx.beginPath();
                ctx.moveTo(i * cellSize, 0);
                ctx.lineTo(i * cellSize, gridSize * cellSize);
                ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(0, i * cellSize);
                ctx.lineTo(gridSize * cellSize, i * cellSize);
                ctx.stroke();
            }
        }

        // Draw spawn point marker
        const spawnPixelX = spawnX * cellSize + cellSize / 2;
        const spawnPixelZ = spawnZ * cellSize + cellSize / 2;
        const markerSize = Math.max(6, 8 * zoom);

        // Outer ring
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(spawnPixelX, spawnPixelZ, markerSize, 0, Math.PI * 2);
        ctx.stroke();

        // Inner dot
        ctx.fillStyle = "#4f4";
        ctx.beginPath();
        ctx.arc(spawnPixelX, spawnPixelZ, markerSize / 2, 0, Math.PI * 2);
        ctx.fill();

        // Crosshair
        ctx.strokeStyle = "#4f4";
        ctx.lineWidth = 1;
        const crossSize = markerSize * 1.5;
        ctx.beginPath();
        ctx.moveTo(spawnPixelX - crossSize, spawnPixelZ);
        ctx.lineTo(spawnPixelX - markerSize * 0.6, spawnPixelZ);
        ctx.moveTo(spawnPixelX + markerSize * 0.6, spawnPixelZ);
        ctx.lineTo(spawnPixelX + crossSize, spawnPixelZ);
        ctx.moveTo(spawnPixelX, spawnPixelZ - crossSize);
        ctx.lineTo(spawnPixelX, spawnPixelZ - markerSize * 0.6);
        ctx.moveTo(spawnPixelX, spawnPixelZ + markerSize * 0.6);
        ctx.lineTo(spawnPixelX, spawnPixelZ + crossSize);
        ctx.stroke();

        ctx.restore();

    }, [area, width, height, cellSize, spawnX, spawnZ, gridSize, zoom, offsetX, offsetZ]);

    useEffect(() => {
        draw();
    }, [draw]);

    const screenToGrid = (screenX: number, screenZ: number): { x: number; z: number } => {
        const gridX = Math.floor((screenX - offsetX) / cellSize);
        const gridZ = Math.floor((screenZ - offsetZ) / cellSize);
        return {
            x: Math.max(0, Math.min(gridSize - 1, gridX)),
            z: Math.max(0, Math.min(gridSize - 1, gridZ))
        };
    };

    const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
        if (e.button === 1 || e.button === 2 || e.shiftKey) {
            // Middle click, right click, or shift+click to pan
            e.preventDefault();
            setIsDragging(true);
            setDragStart({ x: e.clientX - offsetX, z: e.clientY - offsetZ });
        }
    };

    const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
        if (isDragging) {
            setOffsetX(e.clientX - dragStart.x);
            setOffsetZ(e.clientY - dragStart.z);
        }
    };

    const handleMouseUp = () => {
        setIsDragging(false);
    };

    const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
        if (isDragging) return;

        const canvas = canvasRef.current;
        if (!canvas) return;

        const rect = canvas.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const clickZ = e.clientY - rect.top;

        const { x, z } = screenToGrid(clickX, clickZ);
        onSpawnChange(x, z);
    };

    const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
        e.preventDefault();

        const canvas = canvasRef.current;
        if (!canvas) return;

        const rect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseZ = e.clientY - rect.top;

        // Calculate grid position under mouse before zoom
        const gridXBefore = (mouseX - offsetX) / cellSize;
        const gridZBefore = (mouseZ - offsetZ) / cellSize;

        // Update zoom
        const zoomDelta = e.deltaY > 0 ? 0.8 : 1.25;
        const newZoom = Math.max(0.5, Math.min(5, zoom * zoomDelta));
        setZoom(newZoom);

        // Calculate new cell size
        const newCellSize = baseCellSize * newZoom;

        // Adjust offset to keep mouse position over same grid cell
        const newOffsetX = mouseX - gridXBefore * newCellSize;
        const newOffsetZ = mouseZ - gridZBefore * newCellSize;
        setOffsetX(newOffsetX);
        setOffsetZ(newOffsetZ);
    };

    const handleReset = () => {
        setZoom(1);
        setOffsetX(0);
        setOffsetZ(0);
    };

    const handleZoomIn = () => {
        const newZoom = Math.min(5, zoom * 1.5);
        // Zoom toward center
        const centerX = width / 2;
        const centerZ = height / 2;
        const gridXCenter = (centerX - offsetX) / cellSize;
        const gridZCenter = (centerZ - offsetZ) / cellSize;
        const newCellSize = baseCellSize * newZoom;
        setZoom(newZoom);
        setOffsetX(centerX - gridXCenter * newCellSize);
        setOffsetZ(centerZ - gridZCenter * newCellSize);
    };

    const handleZoomOut = () => {
        const newZoom = Math.max(0.5, zoom * 0.67);
        const centerX = width / 2;
        const centerZ = height / 2;
        const gridXCenter = (centerX - offsetX) / cellSize;
        const gridZCenter = (centerZ - offsetZ) / cellSize;
        const newCellSize = baseCellSize * newZoom;
        setZoom(newZoom);
        setOffsetX(centerX - gridXCenter * newCellSize);
        setOffsetZ(centerZ - gridZCenter * newCellSize);
    };

    const handleCenterOnSpawn = () => {
        // Center view on current spawn point
        const spawnPixelX = spawnX * cellSize + cellSize / 2;
        const spawnPixelZ = spawnZ * cellSize + cellSize / 2;
        setOffsetX(width / 2 - spawnPixelX);
        setOffsetZ(height / 2 - spawnPixelZ);
    };

    if (!area) {
        return (
            <div style={{
                width,
                height,
                background: "#333",
                borderRadius: 4,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#888",
                fontSize: 12,
            }}>
                Area not found
            </div>
        );
    }

    return (
        <div style={{ position: "relative" }}>
            <canvas
                ref={canvasRef}
                onClick={handleClick}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                onWheel={handleWheel}
                onContextMenu={e => e.preventDefault()}
                style={{
                    borderRadius: 4,
                    cursor: isDragging ? "grabbing" : "crosshair",
                    border: "1px solid #555",
                }}
            />
            {/* Zoom controls */}
            <div style={{
                position: "absolute",
                top: 4,
                right: 4,
                display: "flex",
                gap: 2,
            }}>
                <button
                    onClick={handleZoomIn}
                    style={{
                        width: 20, height: 20,
                        background: "rgba(0,0,0,0.7)",
                        color: "#fff",
                        border: "none",
                        borderRadius: 3,
                        cursor: "pointer",
                        fontSize: 12,
                        fontWeight: "bold",
                    }}
                    title="Zoom in"
                >+</button>
                <button
                    onClick={handleZoomOut}
                    style={{
                        width: 20, height: 20,
                        background: "rgba(0,0,0,0.7)",
                        color: "#fff",
                        border: "none",
                        borderRadius: 3,
                        cursor: "pointer",
                        fontSize: 12,
                        fontWeight: "bold",
                    }}
                    title="Zoom out"
                >-</button>
                <button
                    onClick={handleReset}
                    style={{
                        width: 20, height: 20,
                        background: "rgba(0,0,0,0.7)",
                        color: "#fff",
                        border: "none",
                        borderRadius: 3,
                        cursor: "pointer",
                        fontSize: 10,
                    }}
                    title="Reset view"
                >R</button>
                <button
                    onClick={handleCenterOnSpawn}
                    style={{
                        width: 20, height: 20,
                        background: "rgba(0,0,0,0.7)",
                        color: "#4f4",
                        border: "none",
                        borderRadius: 3,
                        cursor: "pointer",
                        fontSize: 10,
                    }}
                    title="Center on spawn"
                >C</button>
            </div>
            {/* Info display */}
            <div style={{
                position: "absolute",
                bottom: 4,
                right: 4,
                background: "rgba(0,0,0,0.7)",
                padding: "2px 6px",
                borderRadius: 3,
                fontSize: 10,
                color: "#4f4",
            }}>
                ({spawnX}, {spawnZ}) {zoom !== 1 && <span style={{ color: "#888" }}>{Math.round(zoom * 100)}%</span>}
            </div>
            {/* Pan hint */}
            {zoom > 1 && (
                <div style={{
                    position: "absolute",
                    bottom: 4,
                    left: 4,
                    background: "rgba(0,0,0,0.7)",
                    padding: "2px 6px",
                    borderRadius: 3,
                    fontSize: 9,
                    color: "#888",
                }}>
                    Shift+drag to pan
                </div>
            )}
        </div>
    );
}
