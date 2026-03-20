import * as THREE from "three";
import type { Decoration } from "../../game/areas/types";

export interface DecorationSceneBuildResult {
    columnGroups: THREE.Mesh[][];
    columnMeshes: THREE.Mesh[];
}

export function buildDecorationsScene(
    scene: THREE.Scene,
    decorations: Decoration[] | undefined,
    registerFogOccluderMesh: (
        mesh: THREE.Mesh,
        tileX: number,
        tileZ: number,
        baseY: number,
        fullHeight: number
    ) => void
): DecorationSceneBuildResult {
    // Decorations - columns, broken walls, etc.
    const columnMeshes: THREE.Mesh[] = [];
    const columnGroups: THREE.Mesh[][] = [];  // Groups of column parts that fade together

    // Shared unit-radius sphere geometries for decorations (ferns, weeds).
    // Individual meshes use mesh.scale to set the visual radius.
    const _decoSphere6x5 = new THREE.SphereGeometry(1, 6, 5);
    const _decoSphere5x4 = new THREE.SphereGeometry(1, 5, 4);
    const _decoSphere8x6 = new THREE.SphereGeometry(1, 8, 6);
    const _decoSphere10x8 = new THREE.SphereGeometry(1, 10, 8);
    const _decoSphere9x8 = new THREE.SphereGeometry(1, 9, 8);

    const addWeedsCluster = (
        centerX: number,
        centerZ: number,
        size: number,
        variant: "large" | "small"
    ): void => {
        const isLarge = variant === "large";
        const frondCount = isLarge ? 4 + Math.floor(Math.random() * 3) : 2 + Math.floor(Math.random() * 2);
        const palette = isLarge
            ? ["#6f9639", "#83ab47", "#98bf57", "#b0d16b"]
            : ["#7fa544", "#91b854", "#a8cb66"];
        const spreadMin = (isLarge ? 0.24 : 0.14) * size;
        const spreadMax = (isLarge ? 0.52 : 0.3) * size;
        const anchorCount = 2;
        const anchorRadius = (isLarge ? 0.22 : 0.14) * size;
        const anchors = Array(anchorCount).fill(null).map(() => {
            const a = Math.random() * Math.PI * 2;
            const r = Math.random() * anchorRadius;
            return { x: Math.cos(a) * r, z: Math.sin(a) * r };
        });

        for (let j = 0; j < frondCount; j++) {
            const angle = (j / frondCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.45;
            const lobeRadius = (isLarge ? 0.085 : 0.058) * size * (0.85 + Math.random() * 0.4);
            const baseOffset = spreadMin + Math.random() * (spreadMax - spreadMin);
            const lean = THREE.MathUtils.degToRad((isLarge ? 46 : 40) + Math.random() * 16);
            const anchor = anchors[j % anchors.length];
            const lobeScaleX = 1.25 + Math.random() * 0.55;
            const lobeScaleY = 1.75 + Math.random() * 0.65;
            const lobeScaleZ = 0.95 + Math.random() * 0.45;
            const lobeLift = lobeRadius * lobeScaleY * 0.42;
            const frondColor = palette[Math.floor(Math.random() * palette.length)];
            const useStalk = Math.random() < (isLarge ? 0.38 : 0.32);

            if (useStalk) {
                const stalkRadius = lobeRadius * (0.46 + Math.random() * 0.18);
                const stalkHeight = lobeRadius * (2.9 + Math.random() * 1.3);
                const stalk = new THREE.Mesh(
                    new THREE.CylinderGeometry(stalkRadius * 0.82, stalkRadius, stalkHeight, 9),
                    new THREE.MeshStandardMaterial({
                        color: frondColor,
                        metalness: 0.0,
                        roughness: 0.77,
                        transparent: true,
                        opacity: 0.98,
                        emissive: "#28340f",
                        emissiveIntensity: 0.06
                    })
                );
                stalk.position.set(
                    centerX + anchor.x + Math.cos(angle) * baseOffset,
                    stalkHeight * 0.5,
                    centerZ + anchor.z + Math.sin(angle) * baseOffset
                );
                stalk.rotation.y = angle + (Math.random() - 0.5) * 0.3;
                stalk.rotation.x = -lean;
                stalk.rotation.z = (Math.random() - 0.5) * 0.35;
                if (j === 0) stalk.name = "decoration";
                scene.add(stalk);

                const tipBulb = new THREE.Mesh(
                    _decoSphere8x6,
                    new THREE.MeshStandardMaterial({
                        color: frondColor,
                        metalness: 0.0,
                        roughness: 0.76,
                        emissive: "#28340f",
                        emissiveIntensity: 0.05
                    })
                );
                tipBulb.position.set(0, stalkHeight * 0.5, 0);
                tipBulb.scale.setScalar(stalkRadius * 0.85);
                stalk.add(tipBulb);
            } else {
                const blade = new THREE.Mesh(
                    _decoSphere10x8,
                    new THREE.MeshStandardMaterial({
                        color: frondColor,
                        metalness: 0.0,
                        roughness: 0.76,
                        transparent: true,
                        opacity: 0.98,
                        emissive: "#28340f",
                        emissiveIntensity: 0.06
                    })
                );
                blade.position.set(
                    centerX + anchor.x + Math.cos(angle) * baseOffset,
                    lobeLift,
                    centerZ + anchor.z + Math.sin(angle) * baseOffset
                );
                blade.rotation.y = angle + (Math.random() - 0.5) * 0.35;
                blade.rotation.x = -lean;
                blade.rotation.z = (Math.random() - 0.5) * 0.45;
                blade.scale.set(lobeRadius * lobeScaleX, lobeRadius * lobeScaleY, lobeRadius * lobeScaleZ);
                if (j === 0) blade.name = "decoration";
                scene.add(blade);

                // Optional top nub keeps silhouette playful/chunky.
                if (Math.random() < 0.45) {
                    const nub = new THREE.Mesh(
                        _decoSphere8x6,
                        new THREE.MeshStandardMaterial({
                            color: frondColor,
                            metalness: 0.0,
                            roughness: 0.78,
                            emissive: "#28340f",
                            emissiveIntensity: 0.04
                        })
                    );
                    nub.scale.setScalar(lobeRadius * 0.45);
                    nub.position.set(
                        blade.position.x + Math.cos(angle) * lobeRadius * 0.2,
                        blade.position.y + lobeRadius * lobeScaleY * 0.6,
                        blade.position.z + Math.sin(angle) * lobeRadius * 0.2
                    );
                    scene.add(nub);
                }
            }
        }

        const rootCount = isLarge ? 2 : 1;
        for (let r = 0; r < rootCount; r++) {
            const rootRadius = (isLarge ? 0.05 : 0.035) * size * (0.8 + Math.random() * 0.5);
            const rootAngle = Math.random() * Math.PI * 2;
            const rootDist = Math.random() * (isLarge ? 0.08 : 0.05) * size;
            const root = new THREE.Mesh(
                _decoSphere9x8,
                new THREE.MeshStandardMaterial({
                    color: isLarge ? "#8daf60" : "#95b769",
                    metalness: 0.0,
                    roughness: 0.88
                })
            );
            root.scale.setScalar(rootRadius);
            root.position.set(
                centerX + Math.cos(rootAngle) * rootDist,
                rootRadius * 0.65,
                centerZ + Math.sin(rootAngle) * rootDist
            );
            if (r === 0) root.name = "decoration";
            scene.add(root);
        }
    };

    if (decorations) {
        decorations.forEach(dec => {
            const size = dec.size ?? 1;

            if (dec.type === "column") {
                // Full standing column - track for transparency
                const columnRadius = 0.3 * size;
                const columnHeight = 2.5 * size;
                const column = new THREE.Mesh(
                    new THREE.CylinderGeometry(columnRadius, columnRadius * 1.1, columnHeight, 12),
                    new THREE.MeshStandardMaterial({ color: "#a6a08f", metalness: 0.1, roughness: 0.9, transparent: true })
                );
                column.position.set(dec.x, columnHeight / 2, dec.z);
                column.name = "decoration";
                scene.add(column);
                columnMeshes.push(column);
                registerFogOccluderMesh(column, dec.x, dec.z, 0, columnHeight);

                // Column base
                const base = new THREE.Mesh(
                    new THREE.CylinderGeometry(columnRadius * 1.4, columnRadius * 1.5, 0.2, 12),
                    new THREE.MeshStandardMaterial({ color: "#979080", metalness: 0.1, roughness: 0.9, transparent: true })
                );
                base.position.set(dec.x, 0.1, dec.z);
                scene.add(base);
                columnMeshes.push(base);
                registerFogOccluderMesh(base, dec.x, dec.z, 0, 0.2);

                // Column capital (top)
                const capital = new THREE.Mesh(
                    new THREE.CylinderGeometry(columnRadius * 1.3, columnRadius, 0.25, 12),
                    new THREE.MeshStandardMaterial({ color: "#b6ae9d", metalness: 0.1, roughness: 0.9, transparent: true })
                );
                capital.position.set(dec.x, columnHeight, dec.z);
                scene.add(capital);
                columnMeshes.push(capital);
                registerFogOccluderMesh(capital, dec.x, dec.z, columnHeight - 0.125, 0.25);

                // Group all parts of this column together for synchronized transparency
                columnGroups.push([column, base, capital]);
            } else if (dec.type === "broken_column") {
                // Broken/fallen column - shorter with debris
                const columnRadius = 0.3 * size;
                const columnHeight = (0.8 + Math.random() * 0.8) * size;  // Random broken height
                const column = new THREE.Mesh(
                    new THREE.CylinderGeometry(columnRadius * 0.9, columnRadius * 1.1, columnHeight, 12),
                    new THREE.MeshStandardMaterial({ color: "#958f80", metalness: 0.1, roughness: 0.95, transparent: true, opacity: 1 })
                );
                column.position.set(dec.x, columnHeight / 2, dec.z);
                column.name = "decoration";
                scene.add(column);
                columnMeshes.push(column);
                registerFogOccluderMesh(column, dec.x, dec.z, 0, columnHeight);

                // Column base (crumbled)
                const base = new THREE.Mesh(
                    new THREE.CylinderGeometry(columnRadius * 1.3, columnRadius * 1.5, 0.15, 8),
                    new THREE.MeshStandardMaterial({ color: "#878072", metalness: 0.1, roughness: 0.95, transparent: true, opacity: 1 })
                );
                base.position.set(dec.x, 0.075, dec.z);
                scene.add(base);
                columnMeshes.push(base);
                registerFogOccluderMesh(base, dec.x, dec.z, 0, 0.15);

                // Fallen debris pieces
                for (let j = 0; j < 3; j++) {
                    const debris = new THREE.Mesh(
                        new THREE.BoxGeometry(0.2 + Math.random() * 0.2, 0.15, 0.2 + Math.random() * 0.2),
                        new THREE.MeshStandardMaterial({ color: "#878072", metalness: 0.1, roughness: 0.95 })
                    );
                    const angle = Math.random() * Math.PI * 2;
                    const dist = 0.4 + Math.random() * 0.4;
                    debris.position.set(dec.x + Math.cos(angle) * dist, 0.075, dec.z + Math.sin(angle) * dist);
                    debris.rotation.y = Math.random() * Math.PI;
                    scene.add(debris);
                }
            } else if (dec.type === "broken_wall") {
                // Broken wall segment
                const wallLength = (1.5 + Math.random() * 1) * size;
                const wallHeight = (0.8 + Math.random() * 1.2) * size;
                const wallThick = 0.4 * size;

                const wall = new THREE.Mesh(
                    new THREE.BoxGeometry(wallLength, wallHeight, wallThick),
                    new THREE.MeshStandardMaterial({ color: "#8f8a79", metalness: 0.1, roughness: 0.95, transparent: true, opacity: 1 })
                );
                wall.position.set(dec.x, wallHeight / 2, dec.z);
                wall.rotation.y = dec.rotation ?? 0;
                wall.name = "decoration";
                scene.add(wall);
                columnMeshes.push(wall);
                registerFogOccluderMesh(wall, dec.x, dec.z, 0, wallHeight);

                // Rubble at base
                for (let j = 0; j < 4; j++) {
                    const rubble = new THREE.Mesh(
                        new THREE.BoxGeometry(0.15 + Math.random() * 0.25, 0.1 + Math.random() * 0.15, 0.15 + Math.random() * 0.25),
                        new THREE.MeshStandardMaterial({ color: "#7a7567", metalness: 0.1, roughness: 0.95 })
                    );
                    const offsetX = (Math.random() - 0.5) * wallLength;
                    const offsetZ = (Math.random() - 0.5) * 0.8;
                    rubble.position.set(dec.x + offsetX, 0.1, dec.z + offsetZ);
                    rubble.rotation.y = Math.random() * Math.PI;
                    scene.add(rubble);
                }
            } else if (dec.type === "stalactite") {
                const stalactiteGroup = new THREE.Group();
                stalactiteGroup.position.set(dec.x, 0, dec.z);
                stalactiteGroup.rotation.y = dec.rotation ?? Math.random() * Math.PI * 2;
                scene.add(stalactiteGroup);

                const mainHeight = 1.5 * size;
                const mainRadius = 0.22 * size;
                const spikeMaterial = new THREE.MeshStandardMaterial({ color: "#8e919b", metalness: 0.04, roughness: 0.94 });
                const mainSpike = new THREE.Mesh(
                    new THREE.ConeGeometry(mainRadius, mainHeight, 7),
                    spikeMaterial
                );
                mainSpike.position.y = 2.5 - mainHeight * 0.5;
                mainSpike.rotation.x = Math.PI;
                mainSpike.name = "decoration";
                stalactiteGroup.add(mainSpike);

                const sideOffsets: Array<[number, number, number]> = [
                    [-0.22 * size, 0.85, -0.08 * size],
                    [0.18 * size, 0.7, 0.12 * size],
                ];
                sideOffsets.forEach(([ox, scale, oz]) => {
                    const sideSpike = new THREE.Mesh(
                        new THREE.ConeGeometry(mainRadius * 0.62, mainHeight * scale, 6),
                        spikeMaterial.clone()
                    );
                    sideSpike.position.set(ox, 2.5 - mainHeight * scale * 0.5, oz);
                    sideSpike.rotation.x = Math.PI;
                    stalactiteGroup.add(sideSpike);
                });
            } else if (dec.type === "stalagmite") {
                const stalagmiteGroup = new THREE.Group();
                stalagmiteGroup.position.set(dec.x, 0, dec.z);
                stalagmiteGroup.rotation.y = dec.rotation ?? 0;
                scene.add(stalagmiteGroup);

                const mainHeight = 1.28 * size;
                const mainRadius = 0.26 * size;
                const spikeMaterial = new THREE.MeshStandardMaterial({ color: "#8b8478", metalness: 0.05, roughness: 0.95, transparent: true, opacity: 1 });
                const mainSpike = new THREE.Mesh(
                    new THREE.ConeGeometry(mainRadius, mainHeight, 8),
                    spikeMaterial
                );
                mainSpike.position.y = mainHeight * 0.5;
                mainSpike.name = "decoration";
                stalagmiteGroup.add(mainSpike);
                columnMeshes.push(mainSpike);
                registerFogOccluderMesh(mainSpike, dec.x, dec.z, 0, mainHeight);

                const sideOffsets: Array<[number, number, number, number]> = [
                    [-0.18 * size, 0.75, -0.12 * size, 0.58],
                    [0.16 * size, 0.66, 0.14 * size, 0.52],
                ];
                sideOffsets.forEach(([ox, oyScale, oz, radiusScale]) => {
                    const sideSpike = new THREE.Mesh(
                        new THREE.ConeGeometry(mainRadius * radiusScale, mainHeight * oyScale, 7),
                        spikeMaterial.clone()
                    );
                    sideSpike.position.set(ox, mainHeight * oyScale * 0.5, oz);
                    stalagmiteGroup.add(sideSpike);
                    columnMeshes.push(sideSpike);
                });
            } else if (dec.type === "geyser") {
                const geyserGroup = new THREE.Group();
                geyserGroup.position.set(dec.x, 0, dec.z);
                geyserGroup.rotation.y = dec.rotation ?? 0;
                scene.add(geyserGroup);

                const basin = new THREE.Mesh(
                    new THREE.CylinderGeometry(0.42 * size, 0.5 * size, 0.24 * size, 10),
                    new THREE.MeshStandardMaterial({ color: "#756f66", metalness: 0.05, roughness: 0.94, transparent: true, opacity: 1 })
                );
                basin.position.y = 0.12 * size;
                basin.name = "decoration";
                geyserGroup.add(basin);
                columnMeshes.push(basin);

                const plumeMaterial = new THREE.MeshStandardMaterial({
                    color: "#b8e6ff",
                    emissive: "#62bfff",
                    emissiveIntensity: 0.32,
                    metalness: 0.0,
                    roughness: 0.26,
                    transparent: true,
                    opacity: 0.58,
                });
                const plume = new THREE.Mesh(
                    new THREE.ConeGeometry(0.15 * size, 1.25 * size, 8),
                    plumeMaterial
                );
                plume.position.y = 0.24 * size + 0.625 * size;
                geyserGroup.add(plume);
                columnMeshes.push(plume);
                registerFogOccluderMesh(plume, dec.x, dec.z, 0, 1.5 * size);

                const innerCore = new THREE.Mesh(
                    new THREE.CylinderGeometry(0.07 * size, 0.05 * size, 0.95 * size, 8),
                    new THREE.MeshStandardMaterial({
                        color: "#ebf9ff",
                        emissive: "#7bd4ff",
                        emissiveIntensity: 0.45,
                        metalness: 0.0,
                        roughness: 0.2,
                        transparent: true,
                        opacity: 0.7,
                    })
                );
                innerCore.position.y = 0.24 * size + 0.48 * size;
                geyserGroup.add(innerCore);
                columnMeshes.push(innerCore);
            } else if (dec.type === "rock") {
                // Large rock - irregular boulder shape
                const rockSize = 0.75 * size;  // Slightly bigger
                const rock = new THREE.Mesh(
                    new THREE.DodecahedronGeometry(rockSize, 0),
                    new THREE.MeshStandardMaterial({ color: "#9b907d", metalness: 0.1, roughness: 0.95, transparent: true, opacity: 1 })
                );
                rock.position.set(dec.x, rockSize * 0.6, dec.z);
                rock.rotation.set(Math.random() * 0.3, Math.random() * Math.PI, Math.random() * 0.3);
                rock.scale.set(1, 0.7, 1.1);  // Flatten slightly
                rock.userData.disableOcclusionFade = true;
                rock.name = "decoration";
                scene.add(rock);
                columnMeshes.push(rock);
            } else if (dec.type === "small_rock") {
                // Small rock - pebble
                const rockSize = 0.35 * size;  // Slightly bigger
                const rock = new THREE.Mesh(
                    new THREE.DodecahedronGeometry(rockSize, 0),
                    new THREE.MeshStandardMaterial({ color: "#afa38f", metalness: 0.1, roughness: 0.95 })
                );
                rock.position.set(dec.x, rockSize * 0.5, dec.z);
                rock.rotation.set(Math.random() * 0.5, Math.random() * Math.PI, Math.random() * 0.5);
                rock.scale.set(1, 0.6, 1.2);
                rock.userData.disableOcclusionFade = true;
                rock.name = "decoration";
                scene.add(rock);
            } else if (dec.type === "bones") {
                const bonesGroup = new THREE.Group();
                bonesGroup.position.set(dec.x, 0, dec.z);
                bonesGroup.rotation.y = dec.rotation ?? Math.random() * Math.PI * 2;
                scene.add(bonesGroup);

                const boneMaterial = new THREE.MeshStandardMaterial({ color: "#d7d0c2", metalness: 0.01, roughness: 0.96 });
                const shaftGeo = new THREE.CylinderGeometry(0.032 * size, 0.036 * size, 0.34 * size, 6);
                const knobGeo = new THREE.SphereGeometry(0.055 * size, 6, 5);
                const boneLayouts: Array<[number, number, number]> = [
                    [0, 0.03 * size, 0],
                    [-0.1 * size, 0.02 * size, 0.12 * size],
                    [0.14 * size, 0.02 * size, -0.08 * size],
                ];

                boneLayouts.forEach(([ox, oy, oz], index) => {
                    const bone = new THREE.Group();
                    bone.position.set(ox, oy, oz);
                    bone.rotation.y = (index - 1) * 0.75;
                    bone.rotation.z = 0.3 - index * 0.18;

                    const shaft = new THREE.Mesh(shaftGeo, boneMaterial.clone());
                    shaft.rotation.z = Math.PI * 0.5;
                    if (index === 0) shaft.name = "decoration";
                    bone.add(shaft);

                    const leftKnobA = new THREE.Mesh(knobGeo, boneMaterial.clone());
                    leftKnobA.position.set(-0.14 * size, 0.03 * size, 0);
                    bone.add(leftKnobA);
                    const leftKnobB = new THREE.Mesh(knobGeo, boneMaterial.clone());
                    leftKnobB.position.set(-0.14 * size, -0.03 * size, 0);
                    bone.add(leftKnobB);
                    const rightKnobA = new THREE.Mesh(knobGeo, boneMaterial.clone());
                    rightKnobA.position.set(0.14 * size, 0.03 * size, 0);
                    bone.add(rightKnobA);
                    const rightKnobB = new THREE.Mesh(knobGeo, boneMaterial.clone());
                    rightKnobB.position.set(0.14 * size, -0.03 * size, 0);
                    bone.add(rightKnobB);

                    bonesGroup.add(bone);
                });
            } else if (dec.type === "crystals") {
                const crystalGroup = new THREE.Group();
                crystalGroup.position.set(dec.x, 0, dec.z);
                crystalGroup.rotation.y = dec.rotation ?? 0;
                scene.add(crystalGroup);

                const crystalMaterial = new THREE.MeshStandardMaterial({
                    color: "#7bd7ff",
                    emissive: "#2a76d8",
                    emissiveIntensity: 0.42,
                    metalness: 0.03,
                    roughness: 0.2,
                    transparent: true,
                    opacity: 0.88,
                });
                const crystalLayout: Array<[number, number, number, number]> = [
                    [0, 0.42, 0, 0.17],
                    [-0.12, 0.3, 0.1, 0.12],
                    [0.14, 0.34, -0.08, 0.13],
                    [0.08, 0.24, 0.14, 0.1],
                ];
                crystalLayout.forEach(([ox, height, oz, radius], index) => {
                    const crystal = new THREE.Mesh(
                        new THREE.OctahedronGeometry(radius * size, 0),
                        crystalMaterial.clone()
                    );
                    crystal.scale.set(0.75, height / radius, 0.75);
                    crystal.position.set(ox * size, height * size * 0.5, oz * size);
                    crystal.rotation.y = index * 0.55;
                    if (index === 0) crystal.name = "decoration";
                    crystalGroup.add(crystal);
                });
            } else if (dec.type === "large_crystals") {
                const crystalGroup = new THREE.Group();
                crystalGroup.position.set(dec.x, 0, dec.z);
                crystalGroup.rotation.y = dec.rotation ?? 0;
                scene.add(crystalGroup);

                const crystalMaterial = new THREE.MeshStandardMaterial({
                    color: "#76c3ff",
                    emissive: "#376bff",
                    emissiveIntensity: 0.6,
                    metalness: 0.04,
                    roughness: 0.18,
                    transparent: true,
                    opacity: 0.9,
                });
                const crystalLayout: Array<[number, number, number, number]> = [
                    [0, 1.28, 0, 0.26],
                    [-0.24, 0.9, 0.18, 0.18],
                    [0.26, 0.82, -0.12, 0.16],
                ];
                let mainCrystal: THREE.Mesh | null = null;
                crystalLayout.forEach(([ox, height, oz, radius], index) => {
                    const crystal = new THREE.Mesh(
                        new THREE.OctahedronGeometry(radius * size, 0),
                        crystalMaterial.clone()
                    );
                    crystal.scale.set(0.82, height / radius, 0.82);
                    crystal.position.set(ox * size, height * size * 0.5, oz * size);
                    crystal.rotation.y = index * 0.7;
                    if (index === 0) crystal.name = "decoration";
                    if (index === 0) mainCrystal = crystal;
                    crystalGroup.add(crystal);
                    columnMeshes.push(crystal);
                });
                if (mainCrystal) {
                    registerFogOccluderMesh(mainCrystal, dec.x, dec.z, 0, 1.35 * size);
                }
            } else if (dec.type === "mushroom") {
                // Large mushroom - stem + cap with randomized proportions
                const sizeJitter = 0.8 + Math.random() * 0.4;  // 0.8-1.2x
                const stemHeight = (0.5 + Math.random() * 0.4) * size * sizeJitter;
                const stemRadius = (0.12 + Math.random() * 0.08) * size * sizeJitter;
                const capRadius = (0.4 + Math.random() * 0.3) * size * sizeJitter;
                const capColors = ["#c44", "#b33", "#a52", "#c55", "#943"];
                const capColor = capColors[Math.floor(Math.random() * capColors.length)];
                const tiltX = (Math.random() - 0.5) * 0.15;
                const tiltZ = (Math.random() - 0.5) * 0.15;

                // Stem
                const stem = new THREE.Mesh(
                    new THREE.CylinderGeometry(stemRadius * 0.8, stemRadius, stemHeight, 8),
                    new THREE.MeshStandardMaterial({ color: "#e8dcc8", metalness: 0.0, roughness: 0.9 })
                );
                stem.position.set(dec.x, stemHeight / 2, dec.z);
                stem.rotation.x = tiltX;
                stem.rotation.z = tiltZ;
                scene.add(stem);

                // Cap - dome shape with random flatness
                const capFlatness = 0.3 + Math.random() * 0.2;  // How much of hemisphere to show
                const cap = new THREE.Mesh(
                    new THREE.SphereGeometry(capRadius, 12, 8, 0, Math.PI * 2, 0, Math.PI * capFlatness),
                    new THREE.MeshStandardMaterial({ color: capColor, metalness: 0.0, roughness: 0.8 })
                );
                cap.position.set(dec.x, stemHeight, dec.z);
                cap.rotation.x = tiltX;
                cap.rotation.z = tiltZ;
                cap.name = "decoration";
                scene.add(cap);

                // Add spots to only some large mushrooms.
                if (Math.random() < 0.68) {
                    const spotCount = 4 + Math.floor(Math.random() * 6);
                    const spotColors = ["#fff8da", "#f5efcd", "#efe5bc"];
                    for (let j = 0; j < spotCount; j++) {
                        const spotSize = (0.04 + Math.random() * 0.05) * size * sizeJitter;
                        const spot = new THREE.Mesh(
                            new THREE.CircleGeometry(spotSize, 9),
                            new THREE.MeshStandardMaterial({
                                color: spotColors[Math.floor(Math.random() * spotColors.length)],
                                metalness: 0.0,
                                roughness: 0.8,
                                side: THREE.DoubleSide
                            })
                        );
                        const theta = Math.random() * Math.PI * 2;
                        const phi = Math.random() * Math.PI * capFlatness * 0.82;
                        const radial = capRadius * 0.99;
                        spot.position.set(
                            dec.x + Math.sin(phi) * Math.cos(theta) * radial,
                            stemHeight + Math.cos(phi) * radial,
                            dec.z + Math.sin(phi) * Math.sin(theta) * radial
                        );
                        // Orient spots outward from the cap center so they are visible.
                        spot.lookAt(
                            spot.position.x * 2 - dec.x,
                            spot.position.y * 2 - stemHeight,
                            spot.position.z * 2 - dec.z
                        );
                        scene.add(spot);
                    }
                }
            } else if (dec.type === "small_mushroom") {
                // Small mushroom cluster with randomized count and layout
                const clusterCount = 2 + Math.floor(Math.random() * 3);  // 2-4 mushrooms
                const capColors = ["#c66", "#a55", "#b64", "#c77", "#a44"];
                for (let j = 0; j < clusterCount; j++) {
                    const angle = (j / clusterCount) * Math.PI * 2 + Math.random() * 0.5;
                    const spread = 0.1 + Math.random() * 0.15;
                    const ox = j === 0 ? 0 : Math.cos(angle) * spread;
                    const oz = j === 0 ? 0 : Math.sin(angle) * spread;
                    const sizeJitter = 0.7 + Math.random() * 0.6;
                    const stemHeight = (0.2 + Math.random() * 0.2) * size * sizeJitter;
                    const stemRadius = (0.04 + Math.random() * 0.04) * size * sizeJitter;
                    const capRadius = (0.12 + Math.random() * 0.12) * size * sizeJitter;
                    const tiltX = (Math.random() - 0.5) * 0.2;
                    const tiltZ = (Math.random() - 0.5) * 0.2;

                    const stem = new THREE.Mesh(
                        new THREE.CylinderGeometry(stemRadius * 0.7, stemRadius, stemHeight, 6),
                        new THREE.MeshStandardMaterial({ color: "#e8dcc8", metalness: 0.0, roughness: 0.9 })
                    );
                    stem.position.set(dec.x + ox, stemHeight / 2, dec.z + oz);
                    stem.rotation.x = tiltX;
                    stem.rotation.z = tiltZ;
                    scene.add(stem);

                    const cap = new THREE.Mesh(
                        new THREE.SphereGeometry(capRadius, 8, 6, 0, Math.PI * 2, 0, Math.PI * (0.3 + Math.random() * 0.2)),
                        new THREE.MeshStandardMaterial({ color: capColors[Math.floor(Math.random() * capColors.length)], metalness: 0.0, roughness: 0.8 })
                    );
                    cap.position.set(dec.x + ox, stemHeight, dec.z + oz);
                    cap.rotation.x = tiltX;
                    cap.rotation.z = tiltZ;
                    if (j === 0) cap.name = "decoration";
                    scene.add(cap);
                }
            } else if (dec.type === "weeds") {
                // Large weeds - curved ribbon fronds with varied bend and width.
                addWeedsCluster(dec.x, dec.z, size, "large");
            } else if (dec.type === "small_weeds") {
                // Small weeds - compact variant of the same curved blade treatment.
                addWeedsCluster(dec.x, dec.z, size, "small");
            } else if (dec.type === "fern") {
                // Large bush - cluster of spheres with variation
                const colors = ["#2a6a3a", "#3a8a4e", "#4a9a5e", "#5aaa6e", "#6aba7e"];
                const bushScale = (1.0 + Math.random() * 1.2) * size;  // Varies 1.0 to 2.2

                // Bottom layer - larger, darker spheres spreading out
                const bottomCount = 5 + Math.floor(Math.random() * 3);
                for (let j = 0; j < bottomCount; j++) {
                    const angle = (j / bottomCount) * Math.PI * 2 + Math.random() * 0.5;
                    const radius = (0.25 + Math.random() * 0.15) * bushScale;
                    const sphereSize = (0.18 + Math.random() * 0.1) * bushScale;
                    const color = colors[Math.floor(Math.random() * 2)];  // Darker colors

                    const sphere = new THREE.Mesh(
                        _decoSphere6x5,
                        new THREE.MeshStandardMaterial({ color, metalness: 0.0, roughness: 0.9 })
                    );
                    sphere.scale.setScalar(sphereSize);
                    sphere.position.set(
                        dec.x + Math.cos(angle) * radius,
                        sphereSize * 0.7,
                        dec.z + Math.sin(angle) * radius
                    );
                    if (j === 0) sphere.name = "decoration";
                    scene.add(sphere);
                }

                // Middle layer - medium spheres
                const midCount = 4 + Math.floor(Math.random() * 3);
                for (let j = 0; j < midCount; j++) {
                    const angle = (j / midCount) * Math.PI * 2 + Math.random() * 0.6;
                    const radius = (0.1 + Math.random() * 0.15) * bushScale;
                    const sphereSize = (0.15 + Math.random() * 0.08) * bushScale;
                    const color = colors[1 + Math.floor(Math.random() * 2)];

                    const sphere = new THREE.Mesh(
                        _decoSphere6x5,
                        new THREE.MeshStandardMaterial({ color, metalness: 0.0, roughness: 0.85 })
                    );
                    sphere.scale.setScalar(sphereSize);
                    sphere.position.set(
                        dec.x + Math.cos(angle) * radius,
                        sphereSize + 0.15 * bushScale,
                        dec.z + Math.sin(angle) * radius
                    );
                    scene.add(sphere);
                }

                // Top layer - smaller, brighter spheres
                const topCount = 2 + Math.floor(Math.random() * 2);
                for (let j = 0; j < topCount; j++) {
                    const angle = Math.random() * Math.PI * 2;
                    const radius = Math.random() * 0.08 * bushScale;
                    const sphereSize = (0.1 + Math.random() * 0.06) * bushScale;
                    const color = colors[3 + Math.floor(Math.random() * 2)];

                    const sphere = new THREE.Mesh(
                        _decoSphere6x5,
                        new THREE.MeshStandardMaterial({ color, metalness: 0.0, roughness: 0.8 })
                    );
                    sphere.scale.setScalar(sphereSize);
                    sphere.position.set(
                        dec.x + Math.cos(angle) * radius,
                        0.3 * bushScale + sphereSize,
                        dec.z + Math.sin(angle) * radius
                    );
                    scene.add(sphere);
                }
            } else if (dec.type === "small_fern") {
                // Small bush - simpler cluster
                const colors = ["#3a7a4a", "#4a9a5e", "#5aaa6e", "#7aca8e"];
                const bushScale = (0.6 + Math.random() * 0.8) * size;  // Varies 0.6 to 1.4

                // Bottom spheres
                const count = 3 + Math.floor(Math.random() * 2);
                for (let j = 0; j < count; j++) {
                    const angle = (j / count) * Math.PI * 2 + Math.random() * 0.5;
                    const radius = (0.12 + Math.random() * 0.08) * bushScale;
                    const sphereSize = (0.12 + Math.random() * 0.06) * bushScale;
                    const color = colors[Math.floor(Math.random() * 2)];

                    const sphere = new THREE.Mesh(
                        _decoSphere5x4,
                        new THREE.MeshStandardMaterial({ color, metalness: 0.0, roughness: 0.9 })
                    );
                    sphere.scale.setScalar(sphereSize);
                    sphere.position.set(
                        dec.x + Math.cos(angle) * radius,
                        sphereSize * 0.7,
                        dec.z + Math.sin(angle) * radius
                    );
                    if (j === 0) sphere.name = "decoration";
                    scene.add(sphere);
                }

                // Top accent
                const topSize = (0.08 + Math.random() * 0.05) * bushScale;
                const topColor = colors[2 + Math.floor(Math.random() * 2)];
                const top = new THREE.Mesh(
                    _decoSphere5x4,
                    new THREE.MeshStandardMaterial({ color: topColor, metalness: 0.0, roughness: 0.85 })
                );
                top.scale.setScalar(topSize);
                top.position.set(
                    dec.x + (Math.random() - 0.5) * 0.1 * bushScale,
                    0.15 * bushScale + topSize,
                    dec.z + (Math.random() - 0.5) * 0.1 * bushScale
                );
                scene.add(top);
            } else if (dec.type === "bookshelf") {
                const shelfGroup = new THREE.Group();
                shelfGroup.position.set(dec.x, 0, dec.z);
                shelfGroup.rotation.y = dec.rotation ?? 0;
                scene.add(shelfGroup);

                const frameWidth = 0.95 * size;
                const frameDepth = 0.28 * size;
                const frameHeight = 1.9 * size;
                const sideWidth = 0.08 * size;
                const boardHeight = 0.08 * size;
                const shelfThickness = 0.05 * size;
                const innerWidth = frameWidth - sideWidth * 2;
                const sideMaterial = new THREE.MeshStandardMaterial({ color: "#6f4b2d", metalness: 0.06, roughness: 0.92 });
                const boardMaterial = new THREE.MeshStandardMaterial({ color: "#845834", metalness: 0.05, roughness: 0.9 });
                const backMaterial = new THREE.MeshStandardMaterial({ color: "#5e3e24", metalness: 0.03, roughness: 0.95 });

                const leftSide = new THREE.Mesh(
                    new THREE.BoxGeometry(sideWidth, frameHeight, frameDepth),
                    sideMaterial
                );
                leftSide.position.set(-frameWidth * 0.5 + sideWidth * 0.5, frameHeight / 2, 0);
                leftSide.name = "decoration";
                shelfGroup.add(leftSide);
                columnMeshes.push(leftSide);

                const rightSide = new THREE.Mesh(
                    new THREE.BoxGeometry(sideWidth, frameHeight, frameDepth),
                    sideMaterial.clone()
                );
                rightSide.position.set(frameWidth * 0.5 - sideWidth * 0.5, frameHeight / 2, 0);
                shelfGroup.add(rightSide);
                columnMeshes.push(rightSide);

                const topBoard = new THREE.Mesh(
                    new THREE.BoxGeometry(frameWidth, boardHeight, frameDepth),
                    boardMaterial
                );
                topBoard.position.y = frameHeight - boardHeight * 0.5;
                shelfGroup.add(topBoard);
                columnMeshes.push(topBoard);

                const bottomBoard = new THREE.Mesh(
                    new THREE.BoxGeometry(frameWidth, boardHeight, frameDepth),
                    boardMaterial.clone()
                );
                bottomBoard.position.y = boardHeight * 0.5;
                shelfGroup.add(bottomBoard);
                columnMeshes.push(bottomBoard);

                const backPanel = new THREE.Mesh(
                    new THREE.BoxGeometry(innerWidth, frameHeight - boardHeight * 1.2, frameDepth * 0.16),
                    backMaterial
                );
                backPanel.position.set(0, frameHeight * 0.5, -frameDepth * 0.34);
                shelfGroup.add(backPanel);
                columnMeshes.push(backPanel);
                registerFogOccluderMesh(backPanel, dec.x, dec.z, 0, frameHeight);

                for (let shelfIndex = 0; shelfIndex < 4; shelfIndex++) {
                    const shelf = new THREE.Mesh(
                        new THREE.BoxGeometry(innerWidth * 0.98, shelfThickness, frameDepth * 0.88),
                        boardMaterial.clone()
                    );
                    shelf.position.y = 0.28 * size + shelfIndex * 0.4 * size;
                    shelfGroup.add(shelf);
                    columnMeshes.push(shelf);

                    const bookColors = ["#6f3d2c", "#30506a", "#5c6b34", "#7c5b2f", "#503a6c", "#7a2f37"];
                    let cursorX = -innerWidth * 0.46;
                    while (cursorX < innerWidth * 0.4) {
                        const bookWidth = (0.06 + Math.random() * 0.06) * size;
                        const bookHeight = (0.2 + Math.random() * 0.18) * size;
                        const book = new THREE.Mesh(
                            new THREE.BoxGeometry(bookWidth, bookHeight, frameDepth * 0.26),
                            new THREE.MeshStandardMaterial({
                                color: bookColors[Math.floor(Math.random() * bookColors.length)],
                                metalness: 0.01,
                                roughness: 0.88
                            })
                        );
                        book.position.set(
                            cursorX + bookWidth * 0.5,
                            shelf.position.y + shelfThickness * 0.5 + bookHeight * 0.5,
                            frameDepth * 0.12
                        );
                        shelfGroup.add(book);
                        columnMeshes.push(book);
                        cursorX += bookWidth + (0.01 + Math.random() * 0.03) * size;
                    }
                }
            } else if (dec.type === "bar") {
                const barGroup = new THREE.Group();
                barGroup.position.set(dec.x, 0, dec.z);
                barGroup.rotation.y = dec.rotation ?? 0;
                scene.add(barGroup);

                const barWidth = 1.7 * size;
                const barDepth = 0.7 * size;
                const barHeight = 0.95 * size;

                const base = new THREE.Mesh(
                    new THREE.BoxGeometry(barWidth, barHeight, barDepth),
                    new THREE.MeshStandardMaterial({ color: "#76492a", metalness: 0.08, roughness: 0.9, transparent: true, opacity: 1 })
                );
                base.position.y = barHeight / 2;
                base.name = "decoration";
                barGroup.add(base);
                columnMeshes.push(base);
                registerFogOccluderMesh(base, dec.x, dec.z, 0, barHeight);

                const top = new THREE.Mesh(
                    new THREE.BoxGeometry(barWidth * 1.02, 0.08 * size, barDepth * 1.02),
                    new THREE.MeshStandardMaterial({ color: "#9a6237", metalness: 0.12, roughness: 0.82, transparent: true, opacity: 1 })
                );
                top.position.y = barHeight + 0.04 * size;
                barGroup.add(top);
                columnMeshes.push(top);
            } else if (dec.type === "chair") {
                const chairGroup = new THREE.Group();
                chairGroup.position.set(dec.x, 0, dec.z);
                chairGroup.rotation.y = dec.rotation ?? 0;
                scene.add(chairGroup);

                const seatWidth = 0.44 * size;
                const seatDepth = 0.44 * size;
                const seatHeight = 0.48 * size;

                const seat = new THREE.Mesh(
                    new THREE.BoxGeometry(seatWidth, 0.08 * size, seatDepth),
                    new THREE.MeshStandardMaterial({ color: "#8b5c33", metalness: 0.05, roughness: 0.9 })
                );
                seat.position.y = seatHeight;
                seat.name = "decoration";
                chairGroup.add(seat);

                const legGeo = new THREE.BoxGeometry(0.06 * size, seatHeight, 0.06 * size);
                const legMat = new THREE.MeshStandardMaterial({ color: "#704625", metalness: 0.04, roughness: 0.92 });
                const legOffsets: Array<[number, number]> = [
                    [-seatWidth * 0.4, -seatDepth * 0.4],
                    [seatWidth * 0.4, -seatDepth * 0.4],
                    [-seatWidth * 0.4, seatDepth * 0.4],
                    [seatWidth * 0.4, seatDepth * 0.4]
                ];
                for (const [lx, lz] of legOffsets) {
                    const leg = new THREE.Mesh(legGeo, legMat);
                    leg.position.set(lx, seatHeight / 2, lz);
                    chairGroup.add(leg);
                }

                const back = new THREE.Mesh(
                    new THREE.BoxGeometry(seatWidth, 0.5 * size, 0.08 * size),
                    new THREE.MeshStandardMaterial({ color: "#8b5c33", metalness: 0.05, roughness: 0.9 })
                );
                back.position.set(0, seatHeight + 0.25 * size, -seatDepth * 0.45);
                chairGroup.add(back);
            } else if (dec.type === "bed") {
                const bedGroup = new THREE.Group();
                bedGroup.position.set(dec.x, 0, dec.z);
                bedGroup.rotation.y = dec.rotation ?? 0;
                scene.add(bedGroup);

                const bedWidth = 1.7 * size;
                const bedDepth = 1.0 * size;

                const frame = new THREE.Mesh(
                    new THREE.BoxGeometry(bedWidth, 0.28 * size, bedDepth),
                    new THREE.MeshStandardMaterial({ color: "#6b4328", metalness: 0.06, roughness: 0.9, transparent: true, opacity: 1 })
                );
                frame.position.y = 0.14 * size;
                frame.name = "decoration";
                bedGroup.add(frame);
                columnMeshes.push(frame);

                const mattress = new THREE.Mesh(
                    new THREE.BoxGeometry(bedWidth * 0.92, 0.18 * size, bedDepth * 0.92),
                    new THREE.MeshStandardMaterial({ color: "#d9d3c5", metalness: 0, roughness: 0.95, transparent: true, opacity: 1 })
                );
                mattress.position.y = 0.14 * size + 0.14 * size + 0.09 * size;
                bedGroup.add(mattress);
                columnMeshes.push(mattress);

                const pillowMat = new THREE.MeshStandardMaterial({ color: "#f0ebe0", metalness: 0, roughness: 0.95, transparent: true, opacity: 1 });
                const pillowGeo = new THREE.BoxGeometry(bedWidth * 0.32, 0.1 * size, bedDepth * 0.2);
                const pillowY = mattress.position.y + 0.11 * size;
                const pillowZ = -bedDepth * 0.36;

                const pillowLeft = new THREE.Mesh(pillowGeo, pillowMat);
                pillowLeft.position.set(-bedWidth * 0.2, pillowY, pillowZ);
                bedGroup.add(pillowLeft);
                columnMeshes.push(pillowLeft);

                const pillowRight = new THREE.Mesh(pillowGeo, pillowMat.clone());
                pillowRight.position.set(bedWidth * 0.2, pillowY, pillowZ);
                bedGroup.add(pillowRight);
                columnMeshes.push(pillowRight);
            } else if (dec.type === "warrior_statue") {
                const statueGroup = new THREE.Group();
                statueGroup.position.set(dec.x, 0, dec.z);
                statueGroup.rotation.y = dec.rotation ?? 0;
                scene.add(statueGroup);

                const stoneMaterial = new THREE.MeshStandardMaterial({ color: "#948d82", metalness: 0.05, roughness: 0.94, transparent: true, opacity: 1 });
                const pedestal = new THREE.Mesh(
                    new THREE.CylinderGeometry(0.36 * size, 0.42 * size, 0.24 * size, 10),
                    stoneMaterial
                );
                pedestal.position.y = 0.12 * size;
                pedestal.name = "decoration";
                statueGroup.add(pedestal);
                columnMeshes.push(pedestal);

                const legs = new THREE.Mesh(
                    new THREE.BoxGeometry(0.22 * size, 0.54 * size, 0.18 * size),
                    stoneMaterial.clone()
                );
                legs.position.y = 0.24 * size + 0.27 * size;
                statueGroup.add(legs);
                columnMeshes.push(legs);

                const torso = new THREE.Mesh(
                    new THREE.BoxGeometry(0.34 * size, 0.62 * size, 0.2 * size),
                    stoneMaterial.clone()
                );
                torso.position.y = 0.24 * size + 0.54 * size + 0.31 * size;
                statueGroup.add(torso);
                columnMeshes.push(torso);
                registerFogOccluderMesh(torso, dec.x, dec.z, 0, 1.65 * size);

                const head = new THREE.Mesh(
                    new THREE.SphereGeometry(0.14 * size, 8, 6),
                    stoneMaterial.clone()
                );
                head.position.y = torso.position.y + 0.44 * size;
                statueGroup.add(head);
                columnMeshes.push(head);

                const sword = new THREE.Mesh(
                    new THREE.BoxGeometry(0.06 * size, 0.9 * size, 0.06 * size),
                    new THREE.MeshStandardMaterial({ color: "#7c827f", metalness: 0.2, roughness: 0.8, transparent: true, opacity: 1 })
                );
                sword.position.set(0.2 * size, 0.72 * size, 0);
                sword.rotation.z = -0.18;
                statueGroup.add(sword);
                columnMeshes.push(sword);

                const shield = new THREE.Mesh(
                    new THREE.CylinderGeometry(0.14 * size, 0.14 * size, 0.06 * size, 10),
                    stoneMaterial.clone()
                );
                shield.rotation.z = Math.PI * 0.5;
                shield.position.set(-0.2 * size, torso.position.y, 0.08 * size);
                statueGroup.add(shield);
                columnMeshes.push(shield);
            } else if (dec.type === "robed_statue") {
                const statueGroup = new THREE.Group();
                statueGroup.position.set(dec.x, 0, dec.z);
                statueGroup.rotation.y = dec.rotation ?? 0;
                scene.add(statueGroup);

                const stoneMaterial = new THREE.MeshStandardMaterial({ color: "#8f897f", metalness: 0.04, roughness: 0.95, transparent: true, opacity: 1 });
                const pedestal = new THREE.Mesh(
                    new THREE.CylinderGeometry(0.36 * size, 0.42 * size, 0.22 * size, 10),
                    stoneMaterial
                );
                pedestal.position.y = 0.11 * size;
                pedestal.name = "decoration";
                statueGroup.add(pedestal);
                columnMeshes.push(pedestal);

                const robe = new THREE.Mesh(
                    new THREE.ConeGeometry(0.3 * size, 1.18 * size, 10),
                    stoneMaterial.clone()
                );
                robe.position.y = 0.22 * size + 0.59 * size;
                statueGroup.add(robe);
                columnMeshes.push(robe);
                registerFogOccluderMesh(robe, dec.x, dec.z, 0, 1.45 * size);

                const shoulders = new THREE.Mesh(
                    new THREE.BoxGeometry(0.34 * size, 0.14 * size, 0.18 * size),
                    stoneMaterial.clone()
                );
                shoulders.position.y = robe.position.y + 0.42 * size;
                statueGroup.add(shoulders);
                columnMeshes.push(shoulders);

                const head = new THREE.Mesh(
                    new THREE.SphereGeometry(0.13 * size, 8, 6),
                    stoneMaterial.clone()
                );
                head.position.y = shoulders.position.y + 0.22 * size;
                statueGroup.add(head);
                columnMeshes.push(head);
            } else if (dec.type === "beast_statue") {
                const statueGroup = new THREE.Group();
                statueGroup.position.set(dec.x, 0, dec.z);
                statueGroup.rotation.y = dec.rotation ?? 0;
                scene.add(statueGroup);

                const stoneMaterial = new THREE.MeshStandardMaterial({ color: "#888074", metalness: 0.05, roughness: 0.95, transparent: true, opacity: 1 });
                const pedestal = new THREE.Mesh(
                    new THREE.BoxGeometry(0.9 * size, 0.2 * size, 0.62 * size),
                    stoneMaterial
                );
                pedestal.position.y = 0.1 * size;
                pedestal.name = "decoration";
                statueGroup.add(pedestal);
                columnMeshes.push(pedestal);

                const body = new THREE.Mesh(
                    new THREE.BoxGeometry(0.56 * size, 0.28 * size, 0.28 * size),
                    stoneMaterial.clone()
                );
                body.position.set(0, 0.34 * size, 0);
                statueGroup.add(body);
                columnMeshes.push(body);
                registerFogOccluderMesh(body, dec.x, dec.z, 0, 0.9 * size);

                const head = new THREE.Mesh(
                    new THREE.BoxGeometry(0.22 * size, 0.22 * size, 0.2 * size),
                    stoneMaterial.clone()
                );
                head.position.set(0.3 * size, 0.42 * size, 0);
                statueGroup.add(head);
                columnMeshes.push(head);

                const earGeo = new THREE.ConeGeometry(0.05 * size, 0.14 * size, 4);
                const leftEar = new THREE.Mesh(earGeo, stoneMaterial.clone());
                leftEar.position.set(0.34 * size, 0.58 * size, -0.06 * size);
                leftEar.rotation.z = -0.18;
                statueGroup.add(leftEar);
                columnMeshes.push(leftEar);

                const rightEar = new THREE.Mesh(earGeo, stoneMaterial.clone());
                rightEar.position.set(0.34 * size, 0.58 * size, 0.06 * size);
                rightEar.rotation.z = -0.18;
                statueGroup.add(rightEar);
                columnMeshes.push(rightEar);

                const legGeo = new THREE.BoxGeometry(0.08 * size, 0.22 * size, 0.08 * size);
                const legOffsets: Array<[number, number]> = [
                    [-0.18, -0.09],
                    [0.08, -0.09],
                    [-0.18, 0.09],
                    [0.08, 0.09],
                ];
                legOffsets.forEach(([lx, lz]) => {
                    const leg = new THREE.Mesh(legGeo, stoneMaterial.clone());
                    leg.position.set(lx * size, 0.21 * size, lz * size);
                    statueGroup.add(leg);
                    columnMeshes.push(leg);
                });
            }
        });
    }

        return {
        columnGroups,
        columnMeshes,
    };
}
