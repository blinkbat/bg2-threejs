import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { updateHpBars } from "../src/rendering/scene";
import { makeUnit, makeUnitGroup } from "./gameplayTestUtils";

describe("updateHpBars", () => {
    it("uses the player's live effective max HP when scaling the fill bar", () => {
        const unit = makeUnit({
            id: 1,
            hp: 33,
            stats: {
                strength: 0,
                dexterity: 0,
                vitality: 10,
                intelligence: 0,
                faith: 0,
            },
        });
        const unitGroups = {
            1: makeUnitGroup({ position: { x: 4, y: 0, z: 6 } }),
        };
        const hpBarGroup = new THREE.Group();
        const fillMesh = new THREE.Mesh(
            new THREE.PlaneGeometry(1, 1),
            new THREE.MeshBasicMaterial({ color: 0x22c55e })
        );
        hpBarGroup.userData.fillMesh = fillMesh;
        const hpBarGroups = { 1: hpBarGroup };
        const maxHpById = { 1: 33 };

        updateHpBars(hpBarGroups, unitGroups, [unit], maxHpById);

        expect(fillMesh.scale.x).toBeCloseTo(33 / 43);
        expect(maxHpById[1]).toBe(43);
        expect(hpBarGroup.position.x).toBe(4);
        expect(hpBarGroup.position.z).toBe(6);
    });
});
