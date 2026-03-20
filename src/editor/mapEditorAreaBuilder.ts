import {
    DEFAULT_AREA_LIGHT_ANGLE,
    DEFAULT_AREA_LIGHT_BRIGHTNESS,
    DEFAULT_AREA_LIGHT_DECAY,
    DEFAULT_AREA_LIGHT_DIFFUSION,
    DEFAULT_AREA_LIGHT_HEIGHT,
    DEFAULT_AREA_LIGHT_RADIUS,
    DEFAULT_AREA_LIGHT_TINT,
    type AreaData,
    type AreaDialogDefinition,
    type AreaDialogTrigger,
    type AreaId,
    type AreaLight,
    type AreaLocation,
    type AreaTransition,
    type ChestLocation,
    type Decoration,
    type EnemySpawn,
    type TreeLocation,
    type Waystone,
} from "../game/areas/types";
import { DEFAULT_CANDLE_LIGHT_COLOR, DEFAULT_TORCH_LIGHT_COLOR } from "../core/constants";
import {
    clampFiniteNumber,
    clampTreeSizeByType,
    extractEntitiesFromGrid,
    extractPropsFromLayer,
    normalizeLightHexColor,
    sanitizeEnemySpawns,
} from "./areaConversion";
import { normalizeSecretDoorEntity } from "./editorViewUtils";
import {
    cloneDialogDefinition,
    cloneDialogLocation,
    cloneDialogTrigger,
    getOrderedEnemyEntities,
} from "./mapEditorHelpers";
import { normalizeAreaId } from "./mapEditorShared";
import {
    composeTileLayers,
    hasTintData,
    normalizeTileLayerStack,
    normalizeTintLayerStack,
    TILE_EMPTY,
} from "../game/areas/tileLayers";
import type { DecorationDef, EntityDef, MapMetadata, TreeDef } from "./types";

export interface BuildAreaDataFromEditorInput {
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
    dialogLocations: AreaLocation[];
    dialogTriggers: AreaDialogTrigger[];
}

export function buildAreaDataFromEditor(input: BuildAreaDataFromEditorInput): AreaData {
    const {
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
    } = input;

    const areaId = normalizeAreaId(metadata.id);
    const normalizedTerrainLayers = normalizeTileLayerStack(terrainLayers, metadata.width, metadata.height, TILE_EMPTY);
    const normalizedFloorLayers = normalizeTileLayerStack(floorLayers, metadata.width, metadata.height, TILE_EMPTY);
    const normalizedTerrainTintLayers = normalizeTintLayerStack(
        terrainTintLayers,
        normalizedTerrainLayers.length,
        metadata.width,
        metadata.height
    );
    const normalizedFloorTintLayers = normalizeTintLayerStack(
        floorTintLayers,
        normalizedFloorLayers.length,
        metadata.width,
        metadata.height
    );
    const composedTerrain = composeTileLayers(normalizedTerrainLayers, metadata.width, metadata.height, TILE_EMPTY);
    const composedFloor = composeTileLayers(normalizedFloorLayers, metadata.width, metadata.height, TILE_EMPTY);

    const gridProps = extractPropsFromLayer(propsLayer);
    const mergedTrees: TreeLocation[] = gridProps.trees.map((gridTree) => {
        const stateTree = trees.find((tree) => Math.floor(tree.x) === gridTree.x && Math.floor(tree.z) === gridTree.z);
        const normalizedType = gridTree.type ?? stateTree?.type ?? "pine";
        const sourceSize = stateTree?.size ?? gridTree.size;
        return {
            x: gridTree.x,
            z: gridTree.z,
            size: clampTreeSizeByType(sourceSize, normalizedType),
            type: normalizedType,
        };
    });
    const mergedDecorations: Decoration[] = gridProps.decorations.map((gridDecoration) => {
        const stateDecoration = decorations.find(
            (decoration) => Math.floor(decoration.x) === gridDecoration.x && Math.floor(decoration.z) === gridDecoration.z
        );
        return stateDecoration ? { ...stateDecoration } : { x: gridDecoration.x, z: gridDecoration.z, type: gridDecoration.type };
    });

    const orderedEnemies = getOrderedEnemyEntities(entities);
    const rawEnemySpawns: EnemySpawn[] = orderedEnemies.map((enemy) => ({
        x: Math.floor(enemy.x) + 0.5,
        z: Math.floor(enemy.z) + 0.5,
        type: enemy.enemyType ?? "skeleton_warrior",
    }));
    const gridEntities = extractEntitiesFromGrid(entitiesLayer);
    const enemySpawns = sanitizeEnemySpawns(
        rawEnemySpawns,
        geometryLayer,
        composedTerrain,
        propsLayer,
        metadata.width,
        metadata.height
    );
    const chestList: ChestLocation[] = gridEntities.chests.map((gridChest) => {
        const stateChest = entities.find(
            (entity) => entity.type === "chest" && Math.floor(entity.x) === gridChest.x && Math.floor(entity.z) === gridChest.z
        );
        if (stateChest) {
            const contents = (stateChest.chestItems ?? "").split(",").filter(Boolean).map((item) => {
                const [itemId, qty] = item.split(":");
                return { itemId, quantity: parseInt(qty) || 1 };
            });
            const chest: ChestLocation = { x: gridChest.x + 0.5, z: gridChest.z + 0.5, contents };
            if (stateChest.chestGold) {
                chest.gold = stateChest.chestGold;
            }
            if (stateChest.chestLocked) {
                chest.locked = true;
                if (stateChest.chestLocked !== "true") {
                    chest.requiredKeyId = stateChest.chestLocked;
                }
            }
            if (stateChest.chestDecorOnly) {
                chest.decorOnly = true;
            }
            return chest;
        }
        return { x: gridChest.x + 0.5, z: gridChest.z + 0.5, contents: [] };
    });

    const transitionList: AreaTransition[] = entities
        .filter((entity) => entity.type === "transition")
        .map((entity) => ({
            x: entity.x,
            z: entity.z,
            w: entity.transitionW ?? 1,
            h: entity.transitionH ?? 1,
            targetArea: entity.transitionTarget!,
            targetSpawn: { x: entity.transitionSpawnX ?? 0, z: entity.transitionSpawnZ ?? 0 },
            direction: entity.transitionDirection ?? "north",
        }));

    const waystoneList: Waystone[] = entities
        .filter((entity) => entity.type === "waystone")
        .map((entity) => ({
            x: Math.floor(entity.x) + 0.5,
            z: Math.floor(entity.z) + 0.5,
            direction: entity.waystoneDirection ?? "north",
        }));

    const candleList = entities
        .filter((entity) => entity.type === "candle" || entity.type === "torch")
        .map((entity) => {
            const kind: "candle" | "torch" = entity.type === "torch" ? "torch" : "candle";
            const defaultColor = kind === "torch" ? DEFAULT_TORCH_LIGHT_COLOR : DEFAULT_CANDLE_LIGHT_COLOR;
            const normalizedColor = normalizeLightHexColor(entity.lightColor, defaultColor);
            return {
                x: entity.x,
                z: entity.z,
                dx: entity.candleDx ?? 0,
                dz: entity.candleDz ?? 0,
                kind,
                lightColor: normalizedColor,
            };
        });

    const lightList: AreaLight[] = entities
        .filter((entity) => entity.type === "light")
        .map((entity) => ({
            x: entity.x,
            z: entity.z,
            radius: clampFiniteNumber(entity.lightRadius, 1, 60, DEFAULT_AREA_LIGHT_RADIUS),
            angle: clampFiniteNumber(entity.lightAngle, 5, 90, DEFAULT_AREA_LIGHT_ANGLE),
            tint: normalizeLightHexColor(entity.lightColor, DEFAULT_AREA_LIGHT_TINT),
            brightness: clampFiniteNumber(entity.lightBrightness, 0, 50, DEFAULT_AREA_LIGHT_BRIGHTNESS),
            height: clampFiniteNumber(entity.lightHeight, 1, 30, DEFAULT_AREA_LIGHT_HEIGHT),
            diffusion: clampFiniteNumber(entity.lightDiffusion, 0, 1, DEFAULT_AREA_LIGHT_DIFFUSION),
            decay: clampFiniteNumber(entity.lightDecay, 0, 3, DEFAULT_AREA_LIGHT_DECAY),
        }));

    const secretDoorList = entities
        .filter((entity) => entity.type === "secret_door")
        .map((entity) => normalizeSecretDoorEntity(entity))
        .map((entity) => ({
            x: entity.x,
            z: entity.z,
            blockingWall: {
                x: entity.secretBlockX ?? 0,
                z: entity.secretBlockZ ?? 0,
                w: entity.secretBlockW ?? 1,
                h: entity.secretBlockH ?? 1,
            },
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
        sceneEffects: metadata.sceneEffects ? { ...metadata.sceneEffects } : undefined,
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
        waystones: waystoneList.length > 0 ? waystoneList : undefined,
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
}
