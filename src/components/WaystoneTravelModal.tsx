import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { AREAS, type AreaId } from "../game/areas";
import { normalizeTileLayerStack, normalizeTintLayerStack, TILE_EMPTY } from "../game/areas/tileLayers";
import { applyTileTintColor } from "../rendering/scene/floorUtils";
import { ModalShell } from "./ModalShell";

export interface WaystoneDestination {
    key: string;
    areaId: AreaId;
    areaName: string;
    areaFlavor: string;
    waystoneIndex: number;
    x: number;
    z: number;
    direction: "north" | "south" | "east" | "west";
    isCurrent: boolean;
}

interface WaystoneTravelModalProps {
    currentAreaName: string;
    destinations: WaystoneDestination[];
    onTravel: (destination: WaystoneDestination) => void;
    onClose: () => void;
}

interface WaystonePreviewProps {
    destination: WaystoneDestination | null;
}

interface PreviewTileLayer {
    char: string;
    tint: number;
}

const PREVIEW_WIDTH = 296;
const PREVIEW_HEIGHT = 176;
const PREVIEW_PADDING = 10;
const PREVIEW_MAX_VISIBLE_STACKS = 3;

const FLOOR_TILE_COLORS: Record<string, string> = {
    "s": "#c2b280",
    "S": "#d4c490",
    "d": "#8b7355",
    "D": "#6b5344",
    "g": "#668a5a",
    "G": "#567a4a",
    "w": "#5ba5b7",
    "W": "#4a8797",
    "t": "#707070",
    "T": "#606060",
};

const TERRAIN_TILE_COLORS: Record<string, string> = {
    "~": "#ff6422",
    "w": "#5ba5b7",
    "W": "#4a8797",
};

function collectVisibleTileLayers(
    layers: string[][][],
    tintLayers: number[][][],
    x: number,
    z: number
): PreviewTileLayer[] {
    const visibleLayers: PreviewTileLayer[] = [];
    for (let layerIndex = 0; layerIndex < layers.length; layerIndex++) {
        const char = layers[layerIndex]?.[z]?.[x];
        if (!char || char === " " || char === TILE_EMPTY) {
            continue;
        }

        visibleLayers.push({
            char,
            tint: tintLayers[layerIndex]?.[z]?.[x] ?? 0,
        });
    }

    return visibleLayers;
}

function drawTileStack(
    context: CanvasRenderingContext2D,
    tiles: PreviewTileLayer[],
    colorMap: Record<string, string>,
    drawX: number,
    drawZ: number,
    cellSize: number,
    baseOpacity: number,
    opacityStep: number
): void {
    if (tiles.length === 0) {
        return;
    }

    const visibleTiles = tiles.slice(-PREVIEW_MAX_VISIBLE_STACKS);
    const insetStep = cellSize >= 4 ? Math.min(cellSize * 0.16, 1.35) : 0;

    for (let index = 0; index < visibleTiles.length; index++) {
        const depthFromTop = visibleTiles.length - index - 1;
        const inset = depthFromTop * insetStep;
        const size = Math.max(1, cellSize - inset * 2);
        const tile = visibleTiles[index];
        const baseColor = colorMap[tile.char] ?? "#6a7482";

        context.globalAlpha = Math.min(1, baseOpacity + index * opacityStep);
        context.fillStyle = applyTileTintColor(baseColor, tile.tint);
        context.fillRect(drawX + inset, drawZ + inset, size, size);
    }

    if (tiles.length > visibleTiles.length && cellSize >= 5) {
        const badgeSize = Math.max(1.5, cellSize * 0.16);
        context.globalAlpha = 0.9;
        context.fillStyle = "#f8fbff";
        context.fillRect(drawX + cellSize - badgeSize - 1, drawZ + 1, badgeSize, badgeSize);
    }

    context.globalAlpha = 1;
}

function getDecorationPreviewColor(type: string): string {
    if (type === "bookshelf" || type === "bar" || type === "bed" || type === "chair") {
        return "rgba(196, 164, 120, 0.8)";
    }

    if (type === "weeds" || type === "small_weeds" || type === "fern" || type === "small_fern") {
        return "rgba(114, 154, 102, 0.7)";
    }

    if (type === "mushroom" || type === "small_mushroom") {
        return "rgba(198, 160, 188, 0.72)";
    }

    return "rgba(162, 172, 186, 0.76)";
}

function getDecorationPreviewRadius(type: string, cellSize: number): number {
    if (type === "bar" || type === "bed" || type === "bookshelf" || type === "broken_wall") {
        return Math.max(2.4, cellSize * 0.34);
    }

    if (type === "column" || type === "broken_column" || type === "rock") {
        return Math.max(2.1, cellSize * 0.28);
    }

    return Math.max(1.3, cellSize * 0.18);
}

function getPreferredDestinationKey(destinations: WaystoneDestination[]): string | null {
    const firstTravelTarget = destinations.find(destination => !destination.isCurrent);
    return firstTravelTarget?.key ?? destinations[0]?.key ?? null;
}

function WaystonePreview({ destination }: WaystonePreviewProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || !destination) {
            return;
        }

        const area = AREAS[destination.areaId];
        if (!area) {
            return;
        }

        const context = canvas.getContext("2d");
        if (!context) {
            return;
        }

        canvas.width = PREVIEW_WIDTH;
        canvas.height = PREVIEW_HEIGHT;
        context.clearRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
        context.fillStyle = "#0d1420";
        context.fillRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
        context.imageSmoothingEnabled = false;

        const usableWidth = PREVIEW_WIDTH - PREVIEW_PADDING * 2;
        const usableHeight = PREVIEW_HEIGHT - PREVIEW_PADDING * 2;
        const cellSize = Math.min(usableWidth / area.gridWidth, usableHeight / area.gridHeight);
        const areaPixelWidth = area.gridWidth * cellSize;
        const areaPixelHeight = area.gridHeight * cellSize;
        const offsetX = PREVIEW_PADDING + (usableWidth - areaPixelWidth) * 0.5;
        const offsetZ = PREVIEW_PADDING + (usableHeight - areaPixelHeight) * 0.5;
        const floorLayerStack = normalizeTileLayerStack(area.floorLayers ?? [area.floor], area.gridWidth, area.gridHeight, TILE_EMPTY);
        const terrainLayerStack = normalizeTileLayerStack(area.terrainLayers ?? [area.terrain], area.gridWidth, area.gridHeight, TILE_EMPTY);
        const floorTintLayerStack = normalizeTintLayerStack(area.floorTintLayers, floorLayerStack.length, area.gridWidth, area.gridHeight);
        const terrainTintLayerStack = normalizeTintLayerStack(area.terrainTintLayers, terrainLayerStack.length, area.gridWidth, area.gridHeight);

        context.save();
        context.translate(offsetX, offsetZ);
        context.fillStyle = area.groundColor;
        context.fillRect(0, 0, areaPixelWidth, areaPixelHeight);

        for (let z = 0; z < area.gridHeight; z++) {
            for (let x = 0; x < area.gridWidth; x++) {
                const drawX = x * cellSize;
                const drawZ = z * cellSize;
                const floorTiles = collectVisibleTileLayers(floorLayerStack, floorTintLayerStack, x, z);
                const terrainTiles = collectVisibleTileLayers(terrainLayerStack, terrainTintLayerStack, x, z);

                drawTileStack(context, floorTiles, FLOOR_TILE_COLORS, drawX, drawZ, cellSize, 0.48, 0.18);
                drawTileStack(context, terrainTiles, TERRAIN_TILE_COLORS, drawX, drawZ, cellSize, 0.42, 0.2);
            }
        }

        for (let z = 0; z < area.gridHeight; z++) {
            for (let x = 0; x < area.gridWidth; x++) {
                if (area.geometry[z]?.[x] !== "#") {
                    continue;
                }
                context.fillStyle = "#2b394d";
                context.fillRect(x * cellSize, z * cellSize, cellSize, cellSize);
            }
        }

        area.transitions.forEach(transition => {
            context.fillStyle = "rgba(120, 145, 190, 0.42)";
            context.fillRect(
                transition.x * cellSize,
                transition.z * cellSize,
                transition.w * cellSize,
                transition.h * cellSize
            );
        });

        area.secretDoors?.forEach(secretDoor => {
            context.strokeStyle = "rgba(194, 211, 228, 0.5)";
            context.lineWidth = Math.max(1, cellSize * 0.08);
            context.strokeRect(
                secretDoor.blockingWall.x * cellSize,
                secretDoor.blockingWall.z * cellSize,
                secretDoor.blockingWall.w * cellSize,
                secretDoor.blockingWall.h * cellSize
            );
        });

        area.trees.forEach(tree => {
            const centerX = tree.x * cellSize;
            const centerZ = tree.z * cellSize;
            const radius = Math.max(1.8, cellSize * 0.18 + tree.size * cellSize * 0.08);
            const treeColor = tree.type === "palm"
                ? "rgba(118, 162, 108, 0.7)"
                : tree.type === "oak"
                    ? "rgba(88, 124, 84, 0.78)"
                    : "rgba(94, 136, 104, 0.76)";

            context.beginPath();
            context.fillStyle = treeColor;
            context.arc(centerX, centerZ, radius, 0, Math.PI * 2);
            context.fill();
        });

        area.decorations?.forEach(decoration => {
            const centerX = decoration.x * cellSize;
            const centerZ = decoration.z * cellSize;
            const radius = getDecorationPreviewRadius(decoration.type, cellSize);

            context.beginPath();
            context.fillStyle = getDecorationPreviewColor(decoration.type);
            context.arc(centerX, centerZ, radius, 0, Math.PI * 2);
            context.fill();
        });

        area.chests.forEach(chest => {
            const centerX = chest.x * cellSize;
            const centerZ = chest.z * cellSize;
            const size = Math.max(2.4, cellSize * 0.34);
            context.fillStyle = chest.decorOnly ? "rgba(169, 138, 89, 0.68)" : "rgba(225, 182, 92, 0.9)";
            context.fillRect(centerX - size * 0.5, centerZ - size * 0.5, size, size);
        });

        (area.waystones ?? []).forEach((waystone, index) => {
            const centerX = waystone.x * cellSize;
            const centerZ = waystone.z * cellSize;
            const isSelected = index === destination.waystoneIndex;

            context.beginPath();
            context.fillStyle = isSelected ? "rgba(98, 210, 255, 0.95)" : "rgba(68, 144, 214, 0.72)";
            context.arc(centerX, centerZ, Math.max(2.2, cellSize * 0.2), 0, Math.PI * 2);
            context.fill();

            if (isSelected) {
                context.beginPath();
                context.strokeStyle = "rgba(210, 244, 255, 0.95)";
                context.lineWidth = Math.max(1.3, cellSize * 0.12);
                context.arc(centerX, centerZ, Math.max(4.6, cellSize * 0.42), 0, Math.PI * 2);
                context.stroke();
            }
        });

        context.strokeStyle = "rgba(244, 249, 255, 0.16)";
        context.lineWidth = 1;
        context.strokeRect(0, 0, areaPixelWidth, areaPixelHeight);
        context.restore();
    }, [destination]);

    if (!destination) {
        return <div className="waystone-preview-empty">No activated waystones.</div>;
    }

    return (
        <canvas
            ref={canvasRef}
            className="waystone-preview-canvas"
            width={PREVIEW_WIDTH}
            height={PREVIEW_HEIGHT}
        />
    );
}

export function WaystoneTravelModal({
    currentAreaName,
    destinations,
    onTravel,
    onClose,
}: WaystoneTravelModalProps) {
    const [selectedKey, setSelectedKey] = useState<string | null>(() => getPreferredDestinationKey(destinations));
    const resolvedSelectedKey = useMemo(() => {
        if (selectedKey && destinations.some(destination => destination.key === selectedKey)) {
            return selectedKey;
        }

        return getPreferredDestinationKey(destinations);
    }, [destinations, selectedKey]);

    const selectedDestination = useMemo(() => {
        if (!resolvedSelectedKey) {
            return destinations[0] ?? null;
        }
        return destinations.find(destination => destination.key === resolvedSelectedKey) ?? destinations[0] ?? null;
    }, [destinations, resolvedSelectedKey]);

    const availableDestinations = useMemo(
        () => destinations.filter(destination => !destination.isCurrent),
        [destinations]
    );

    return (
        <ModalShell onClose={onClose} contentClassName="waystone-modal" closeOnEscape>
            <div className="help-header">
                <div>
                    <h2 className="help-title">Waystone Network</h2>
                    <div className="waystone-modal-subtitle">Activated waystones linked to {currentAreaName}.</div>
                </div>
                <div className="close-btn" onClick={onClose}><X size={18} /></div>
            </div>

            <div className="waystone-modal-layout">
                <div className="waystone-destination-list">
                    {destinations.map(destination => {
                        const disabled = destination.isCurrent;
                        return (
                            <button
                                key={destination.key}
                                type="button"
                                className={`waystone-destination-btn${resolvedSelectedKey === destination.key ? " selected" : ""}${disabled ? " current" : ""}`}
                                onClick={() => setSelectedKey(destination.key)}
                            >
                                <div className="waystone-destination-name">{destination.areaName}</div>
                                <div className="waystone-destination-status">
                                    {disabled ? "Current location" : "Activated"}
                                </div>
                            </button>
                        );
                    })}
                </div>

                <div className="waystone-preview-panel">
                    <div className="waystone-preview-frame">
                        <WaystonePreview destination={selectedDestination} />
                    </div>
                    {selectedDestination && (
                        <>
                            <div className="waystone-preview-title">{selectedDestination.areaName}</div>
                            <div className="waystone-preview-flavor">{selectedDestination.areaFlavor}</div>
                        </>
                    )}
                    {availableDestinations.length === 0 && (
                        <div className="waystone-preview-note">No other waystones have been activated yet.</div>
                    )}
                    {selectedDestination && !selectedDestination.isCurrent && (
                        <button
                            type="button"
                            className="waystone-travel-btn"
                            onClick={() => onTravel(selectedDestination)}
                        >
                            Travel
                        </button>
                    )}
                </div>
            </div>
        </ModalShell>
    );
}
