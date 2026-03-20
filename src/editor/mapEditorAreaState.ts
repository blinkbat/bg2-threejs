import {
    DEFAULT_AREA_LIGHT_DECAY,
    DEFAULT_AREA_LIGHT_TINT,
    type AreaData,
    type AreaDialogDefinition,
    type AreaDialogTrigger,
    type AreaLocation,
} from "../game/areas/types";
import { DEFAULT_CANDLE_LIGHT_COLOR, DEFAULT_TORCH_LIGHT_COLOR } from "../core/constants";
import {
    clampTreeSizeByType,
    computeEntitiesFromArea,
    computePropsFromArea,
    createEmptyLayer,
    normalizeLightHexColor,
} from "./areaConversion";
import { normalizeSecretDoorEntity } from "./editorViewUtils";
import { cloneDialogDefinition, cloneDialogLocation, cloneDialogTrigger } from "./mapEditorHelpers";
import { type EditorSnapshotSource, normalizeAreaId } from "./mapEditorShared";
import {
    createEmptyTintGrid,
    normalizeTileLayerStack,
    normalizeTintLayerStack,
    TILE_EMPTY,
} from "../game/areas/tileLayers";
import type { EntityDef, MapMetadata } from "./types";

export interface EditorAreaState extends EditorSnapshotSource {
    activeTerrainPaintLayer: number;
    activeFloorPaintLayer: number;
    activeTileTint: number;
}

export function createLoadedAreaState(area: AreaData): EditorAreaState {
    const metadata: MapMetadata = {
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
        sceneEffects: area.sceneEffects ? { ...area.sceneEffects } : undefined,
        spawnX: area.defaultSpawn.x,
        spawnZ: area.defaultSpawn.z,
    };

    const geometryLayer = area.geometry.map((row) => [...row]);
    const terrainLayers = normalizeTileLayerStack(area.terrainLayers ?? [area.terrain], area.gridWidth, area.gridHeight, TILE_EMPTY);
    const floorLayers = normalizeTileLayerStack(
        area.floor && area.floor.length > 0
            ? (area.floorLayers ?? [area.floor])
            : [createEmptyLayer(area.gridWidth, area.gridHeight, TILE_EMPTY)],
        area.gridWidth,
        area.gridHeight,
        TILE_EMPTY
    );
    const terrainTintLayers = normalizeTintLayerStack(area.terrainTintLayers, terrainLayers.length, area.gridWidth, area.gridHeight);
    const floorTintLayers = normalizeTintLayerStack(area.floorTintLayers, floorLayers.length, area.gridWidth, area.gridHeight);
    const propsLayer = computePropsFromArea(area, area.gridWidth, area.gridHeight);
    const entitiesLayer = computeEntitiesFromArea(area, area.gridWidth, area.gridHeight);

    const trees = area.trees.map((tree) => {
        const normalizedType = tree.type ?? "pine";
        return {
            x: tree.x,
            z: tree.z,
            size: clampTreeSizeByType(tree.size, normalizedType),
            type: normalizedType,
        };
    });
    const decorations = (area.decorations ?? []).map((decoration) => ({
        x: decoration.x,
        z: decoration.z,
        type: decoration.type,
        rotation: decoration.rotation,
        size: decoration.size,
    }));

    const entities: EntityDef[] = [];
    let entityId = 0;
    area.enemySpawns.forEach((enemy, spawnIndex) => {
        entities.push({
            id: `e${entityId++}`,
            x: enemy.x,
            z: enemy.z,
            type: "enemy",
            enemyType: enemy.type,
            enemySpawnIndex: spawnIndex,
        });
    });
    area.chests.forEach((chest) => {
        const items = chest.contents.map((item) => `${item.itemId}:${item.quantity}`).join(",");
        entities.push({
            id: `e${entityId++}`,
            x: chest.x,
            z: chest.z,
            type: "chest",
            chestGold: chest.gold,
            chestItems: items,
            chestLocked: chest.locked ? (chest.requiredKeyId ?? "true") : undefined,
            chestDecorOnly: chest.decorOnly ?? false,
        });
    });
    area.transitions.forEach((transition) => {
        entities.push({
            id: `e${entityId++}`,
            x: transition.x,
            z: transition.z,
            type: "transition",
            transitionTarget: transition.targetArea,
            transitionSpawnX: transition.targetSpawn.x,
            transitionSpawnZ: transition.targetSpawn.z,
            transitionDirection: transition.direction,
            transitionW: transition.w,
            transitionH: transition.h,
        });
    });
    (area.waystones ?? []).forEach((waystone) => {
        entities.push({
            id: `e${entityId++}`,
            x: waystone.x,
            z: waystone.z,
            type: "waystone",
            waystoneDirection: waystone.direction ?? "north",
        });
    });
    (area.candles ?? []).forEach((candle) => {
        entities.push({
            id: `e${entityId++}`,
            x: candle.x,
            z: candle.z,
            type: candle.kind === "torch" ? "torch" : "candle",
            candleDx: candle.dx,
            candleDz: candle.dz,
            lightColor: normalizeLightHexColor(
                candle.lightColor,
                candle.kind === "torch" ? DEFAULT_TORCH_LIGHT_COLOR : DEFAULT_CANDLE_LIGHT_COLOR
            ),
        });
    });
    (area.lights ?? []).forEach((light) => {
        entities.push({
            id: `e${entityId++}`,
            x: light.x,
            z: light.z,
            type: "light",
            lightRadius: light.radius,
            lightAngle: light.angle,
            lightColor: normalizeLightHexColor(light.tint, DEFAULT_AREA_LIGHT_TINT),
            lightBrightness: light.brightness,
            lightHeight: light.height,
            lightDiffusion: light.diffusion,
            lightDecay: light.decay ?? DEFAULT_AREA_LIGHT_DECAY,
        });
    });
    (area.secretDoors ?? []).forEach((secretDoor) => {
        entities.push(normalizeSecretDoorEntity({
            id: `e${entityId++}`,
            x: secretDoor.x,
            z: secretDoor.z,
            type: "secret_door",
            secretBlockX: secretDoor.blockingWall.x,
            secretBlockZ: secretDoor.blockingWall.z,
            secretBlockW: secretDoor.blockingWall.w,
            secretBlockH: secretDoor.blockingWall.h,
        }));
    });

    const dialogs: AreaDialogDefinition[] = (area.dialogs ?? []).map(cloneDialogDefinition);
    const locations: AreaLocation[] = (area.locations ?? []).map(cloneDialogLocation);
    const dialogTriggers: AreaDialogTrigger[] = (area.dialogTriggers ?? []).map(cloneDialogTrigger);

    return {
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
        locations,
        dialogTriggers,
        activeTerrainPaintLayer: Math.max(0, terrainLayers.length - 1),
        activeFloorPaintLayer: Math.max(0, floorLayers.length - 1),
        activeTileTint: 0,
    };
}

export function createNewAreaState(): EditorAreaState {
    const width = 30;
    const height = 20;
    const spawnX = 3;
    const spawnZ = 10;
    const metadata: MapMetadata = {
        id: normalizeAreaId(`area_${Date.now()}`),
        name: "New Area",
        flavor: "A mysterious place.",
        width,
        height,
        background: "#1a1a2e",
        ground: "#2a2a3e",
        ambient: 0.4,
        directional: 0.5,
        fog: true,
        sceneEffects: undefined,
        spawnX,
        spawnZ,
    };
    const geometryLayer = createEmptyLayer(width, height, ".");
    const terrainLayers = [createEmptyLayer(width, height, TILE_EMPTY)];
    const floorLayers = [createEmptyLayer(width, height, TILE_EMPTY)];
    const terrainTintLayers = [createEmptyTintGrid(width, height)];
    const floorTintLayers = [createEmptyTintGrid(width, height)];
    const propsLayer = createEmptyLayer(width, height, ".");
    const entitiesLayer = createEmptyLayer(width, height, ".");

    if (spawnZ >= 0 && spawnZ < height && spawnX >= 0 && spawnX < width) {
        entitiesLayer[spawnZ][spawnX] = "@";
    }

    return {
        metadata,
        geometryLayer,
        terrainLayers,
        floorLayers,
        terrainTintLayers,
        floorTintLayers,
        propsLayer,
        entitiesLayer,
        entities: [],
        trees: [],
        decorations: [],
        dialogs: [],
        locations: [],
        dialogTriggers: [],
        activeTerrainPaintLayer: 0,
        activeFloorPaintLayer: 0,
        activeTileTint: 0,
    };
}
