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

    class Vector3Stub {
        x: number;
        y: number;
        z: number;

        constructor(x: number = 0, y: number = 0, z: number = 0) {
            this.x = x;
            this.y = y;
            this.z = z;
        }

        set(x: number = 0, y: number = 0, z: number = 0): this {
            this.x = x;
            this.y = y;
            this.z = z;
            return this;
        }

        copy(vector: { x: number; y: number; z: number }): this {
            this.x = vector.x;
            this.y = vector.y;
            this.z = vector.z;
            return this;
        }

        add(vector: { x: number; y: number; z: number }): this {
            this.x += vector.x;
            this.y += vector.y;
            this.z += vector.z;
            return this;
        }

        subVectors(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): this {
            this.x = a.x - b.x;
            this.y = a.y - b.y;
            this.z = a.z - b.z;
            return this;
        }

        length(): number {
            return Math.hypot(this.x, this.y, this.z);
        }

        normalize(): this {
            const len = this.length();
            if (len > 0) {
                this.x /= len;
                this.y /= len;
                this.z /= len;
            }
            return this;
        }

        multiplyScalar(scale: number): this {
            this.x *= scale;
            this.y *= scale;
            this.z *= scale;
            return this;
        }
    }

    class MeshStub {
        position = new Vector3Stub();
        rotation = { x: 0, y: 0, z: 0 };
        scale = { set() {} };
        quaternion = { setFromUnitVectors() {} };
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
