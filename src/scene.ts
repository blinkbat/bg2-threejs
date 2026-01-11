// =============================================================================
// THREE.JS SCENE SETUP
// =============================================================================

import * as THREE from "three";
import { GRID_SIZE } from "./constants";
import { candlePositions, mergedObstacles, roomFloors } from "./dungeon";
import { UNIT_DATA, KOBOLD_STATS } from "./units";
import type { Unit, UnitGroup, FogTexture } from "./types";

export interface SceneRefs {
    scene: THREE.Scene;
    camera: THREE.OrthographicCamera;
    renderer: THREE.WebGLRenderer;
    flames: THREE.Mesh[];
    candleLights: THREE.PointLight[];
    fogTexture: FogTexture;
    fogMesh: THREE.Mesh;
    moveMarker: THREE.Mesh;
    rangeIndicator: THREE.Mesh;
    aoeIndicator: THREE.Mesh;
    unitGroups: Record<number, UnitGroup>;
    selectRings: Record<number, THREE.Mesh>;
    unitMeshes: Record<number, THREE.Mesh>;
    unitOriginalColors: Record<number, THREE.Color>;
    maxHp: Record<number, number>;
}

export function createScene(container: HTMLDivElement, units: Unit[]): SceneRefs {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#0d1117");

    const aspect = container.clientWidth / container.clientHeight;
    const camera = new THREE.OrthographicCamera(-15 * aspect, 15 * aspect, 15, -15, 0.1, 1000);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);

    // Lighting
    scene.add(new THREE.AmbientLight(0xffffff, 0.15));
    const dir = new THREE.DirectionalLight(0xffffff, 0.25);
    dir.position.set(10, 20, 10);
    scene.add(dir);

    // Ground
    const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(GRID_SIZE, GRID_SIZE),
        new THREE.MeshStandardMaterial({ color: "#12121a", metalness: 0.3, roughness: 0.7 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(GRID_SIZE / 2, 0, GRID_SIZE / 2);
    ground.name = "ground";
    scene.add(ground);

    // Room floors
    roomFloors.forEach(r => {
        const floor = new THREE.Mesh(
            new THREE.PlaneGeometry(r.w, r.h),
            new THREE.MeshStandardMaterial({ color: r.color, metalness: 0.4, roughness: 0.6 })
        );
        floor.rotation.x = -Math.PI / 2;
        floor.position.set(r.x + r.w / 2, 0.01, r.z + r.h / 2);
        floor.name = "ground";
        scene.add(floor);
    });

    // Torches with flames and lights
    const flames: THREE.Mesh[] = [];
    const candleLights: THREE.PointLight[] = [];
    candlePositions.forEach((pos) => {
        const candle = new THREE.Mesh(
            new THREE.CylinderGeometry(0.06, 0.08, 0.3, 8),
            new THREE.MeshStandardMaterial({ color: "#e8d4a8", metalness: 0.1, roughness: 0.9 })
        );
        candle.position.set(pos.x + pos.dx * 0.3, 1.85, pos.z + pos.dz * 0.3);
        scene.add(candle);

        const flame = new THREE.Mesh(
            new THREE.SphereGeometry(0.08, 8, 8),
            new THREE.MeshBasicMaterial({ color: "#ffcc44", transparent: true, opacity: 0.85 })
        );
        flame.position.set(pos.x + pos.dx * 0.3, 2.05, pos.z + pos.dz * 0.3);
        flame.scale.y = 1.8;
        scene.add(flame);
        flames.push(flame);

        const light = new THREE.PointLight("#ffaa44", 5, 18, 1.2);
        light.position.set(pos.x + pos.dx * 1.5, 2.2, pos.z + pos.dz * 1.5);
        scene.add(light);
        candleLights.push(light);
    });

    // Walls
    mergedObstacles.forEach((o, i) => {
        const shade = 0x2d3748 + (i % 3) * 0x050505;
        const mesh = new THREE.Mesh(
            new THREE.BoxGeometry(o.w, 2.5, o.h),
            new THREE.MeshStandardMaterial({ color: shade, metalness: 0.2, roughness: 0.8 })
        );
        mesh.position.set(o.x + o.w / 2, 1.25, o.z + o.h / 2);
        mesh.name = "obstacle";
        scene.add(mesh);
    });

    // Grid lines
    const gridMat = new THREE.LineBasicMaterial({ color: "#333" });
    for (let i = 0; i <= GRID_SIZE; i++) {
        scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.01, i), new THREE.Vector3(GRID_SIZE, 0.01, i)]), gridMat));
        scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(i, 0.01, 0), new THREE.Vector3(i, 0.01, GRID_SIZE)]), gridMat));
    }

    // Fog of war
    const fogCanvas = document.createElement("canvas");
    fogCanvas.width = GRID_SIZE;
    fogCanvas.height = GRID_SIZE;
    const fogCtx = fogCanvas.getContext("2d")!;
    fogCtx.fillStyle = "#000";
    fogCtx.fillRect(0, 0, GRID_SIZE, GRID_SIZE);
    const fogTextureObj = new THREE.CanvasTexture(fogCanvas);
    fogTextureObj.magFilter = THREE.NearestFilter;
    fogTextureObj.minFilter = THREE.NearestFilter;
    const fogTexture: FogTexture = { canvas: fogCanvas, ctx: fogCtx, texture: fogTextureObj };

    const fogMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(GRID_SIZE, GRID_SIZE),
        new THREE.MeshBasicMaterial({ map: fogTextureObj, transparent: true, depthWrite: false })
    );
    fogMesh.rotation.x = -Math.PI / 2;
    fogMesh.position.set(GRID_SIZE / 2, 2.6, GRID_SIZE / 2);
    fogMesh.renderOrder = 999;
    scene.add(fogMesh);

    // Move marker
    const moveMarker = new THREE.Mesh(
        new THREE.RingGeometry(0.2, 0.3, 4),
        new THREE.MeshBasicMaterial({ color: "#ffff00", side: THREE.DoubleSide, transparent: true, opacity: 0.8 })
    );
    moveMarker.rotation.x = -Math.PI / 2;
    moveMarker.visible = false;
    scene.add(moveMarker);

    // Range indicator
    const rangeIndicator = new THREE.Mesh(
        new THREE.RingGeometry(0.1, 10, 64),
        new THREE.MeshBasicMaterial({ color: "#3b82f6", side: THREE.DoubleSide, transparent: true, opacity: 0.2 })
    );
    rangeIndicator.rotation.x = -Math.PI / 2;
    rangeIndicator.position.y = 0.02;
    rangeIndicator.visible = false;
    scene.add(rangeIndicator);

    // AOE indicator
    const aoeIndicator = new THREE.Mesh(
        new THREE.RingGeometry(0.1, 2.5, 32),
        new THREE.MeshBasicMaterial({ color: "#ff4400", side: THREE.DoubleSide, transparent: true, opacity: 0.3 })
    );
    aoeIndicator.rotation.x = -Math.PI / 2;
    aoeIndicator.position.y = 0.03;
    aoeIndicator.visible = false;
    scene.add(aoeIndicator);

    // Create unit meshes
    const unitGroups: Record<number, UnitGroup> = {};
    const selectRings: Record<number, THREE.Mesh> = {};
    const unitMeshes: Record<number, THREE.Mesh> = {};
    const unitOriginalColors: Record<number, THREE.Color> = {};
    const maxHp: Record<number, number> = {};

    units.forEach(unit => {
        const isPlayer = unit.team === "player";
        const data = isPlayer ? UNIT_DATA[unit.id] : KOBOLD_STATS;
        const group = new THREE.Group();

        const base = new THREE.Mesh(
            new THREE.RingGeometry(0.35, 0.45, 32),
            new THREE.MeshBasicMaterial({ color: isPlayer ? "#444" : "#660000", side: THREE.DoubleSide, transparent: true, opacity: 0.5 })
        );
        base.rotation.x = -Math.PI / 2;
        base.position.y = 0.02;
        group.add(base);

        const boxH = isPlayer ? 1 : 0.6;
        const boxMat = new THREE.MeshStandardMaterial({ color: data.color, metalness: 0.5, roughness: 0.5 });
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.6, boxH, 0.6), boxMat);
        box.position.y = boxH / 2;
        box.userData.unitId = unit.id;
        group.add(box);
        unitMeshes[unit.id] = box;
        unitOriginalColors[unit.id] = new THREE.Color(data.color);

        const sel = new THREE.Mesh(
            new THREE.RingGeometry(0.5, 0.55, 32),
            new THREE.MeshBasicMaterial({ color: "#00ff00", side: THREE.DoubleSide })
        );
        sel.rotation.x = -Math.PI / 2;
        sel.position.y = 0.03;
        sel.visible = false;
        group.add(sel);
        selectRings[unit.id] = sel;
        maxHp[unit.id] = data.maxHp;

        group.position.set(unit.x, 0, unit.z);
        group.userData = { unitId: unit.id, targetX: unit.x, targetZ: unit.z, attackTarget: null };
        scene.add(group);
        unitGroups[unit.id] = group as UnitGroup;
    });

    return {
        scene,
        camera,
        renderer,
        flames,
        candleLights,
        fogTexture,
        fogMesh,
        moveMarker,
        rangeIndicator,
        aoeIndicator,
        unitGroups,
        selectRings,
        unitMeshes,
        unitOriginalColors,
        maxHp,
    };
}

export function updateCamera(camera: THREE.OrthographicCamera, offset: { x: number; z: number }) {
    const d = 20;
    camera.position.set(offset.x + d, d, offset.z + d);
    camera.lookAt(offset.x, 0, offset.z);
}
