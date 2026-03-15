function createCanvasContextStub() {
    return {
        clearRect() {},
        fillText() {},
        strokeText() {},
        measureText: () => ({ width: 0 }),
        font: "",
        fillStyle: "",
        textAlign: "",
        textBaseline: "",
        lineWidth: 0,
        strokeStyle: "",
    };
}

export function createThreeTestModule(): Record<string, unknown> {
    class ColorStub {
        copy(): this {
            return this;
        }

        multiplyScalar(): this {
            return this;
        }
    }

    class MeshStub {
        position = { set() {}, x: 0, y: 0, z: 0 };
        rotation = { x: 0, y: 0, z: 0 };
        scale = { set() {} };
        renderOrder = 0;
        userData: Record<string, unknown> = {};
        material = {
            map: {
                image: {
                    getContext() {
                        return createCanvasContextStub();
                    },
                },
                needsUpdate: false,
            },
            opacity: 1,
            dispose() {},
        };
        geometry = { dispose() {} };
    }

    class MeshPhongMaterialStub {
        color = new ColorStub();
        emissive = new ColorStub();
        emissiveIntensity = 0;
        shininess = 0;
        transparent = false;
        opacity = 1;

        dispose(): void {}

        clone(): MeshPhongMaterialStub {
            return new MeshPhongMaterialStub();
        }
    }

    class MeshBasicMaterialStub {
        opacity = 1;

        dispose(): void {}
    }

    class SceneStub {
        add(): void {}

        remove(): void {}
    }

    class Vector3Stub {
        x = 0;
        y = 0;
        z = 0;

        set(): this {
            return this;
        }

        copy(): this {
            return this;
        }

        normalize(): this {
            return this;
        }

        multiplyScalar(): this {
            return this;
        }
    }

    class LineStub {
        position = { set() {} };
        userData: Record<string, unknown> = {};
    }

    class CanvasTextureStub {
        generateMipmaps = false;
        minFilter = 0;
        magFilter = 0;
        colorSpace = "";
    }

    class EmptyStub {}

    return {
        Scene: SceneStub,
        Mesh: MeshStub,
        PlaneGeometry: EmptyStub,
        MeshBasicMaterial: MeshBasicMaterialStub,
        MeshPhongMaterial: MeshPhongMaterialStub,
        SphereGeometry: EmptyStub,
        RingGeometry: EmptyStub,
        CylinderGeometry: EmptyStub,
        IcosahedronGeometry: EmptyStub,
        BufferGeometry: EmptyStub,
        LineBasicMaterial: EmptyStub,
        Line: LineStub,
        CanvasTexture: CanvasTextureStub,
        LinearFilter: 0,
        SRGBColorSpace: "",
        DoubleSide: 0,
        Color: ColorStub,
        Vector3: Vector3Stub,
    };
}
