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
        value: unknown;

        constructor(value?: unknown) {
            this.value = value;
        }

        set(value: unknown): this {
            this.value = value;
            return this;
        }

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

    class Object3DStub {
        position = new Vector3Stub();
        rotation = { x: 0, y: 0, z: 0 };
        scale = new Vector3Stub(1, 1, 1);
        quaternion = { setFromUnitVectors() {} };
        renderOrder = 0;
        userData: Record<string, unknown> = {};
        visible = true;
        parent: Object3DStub | null = null;
        children: Object3DStub[] = [];

        add(child: Object3DStub): this {
            child.parent = this;
            this.children.push(child);
            return this;
        }

        remove(child: Object3DStub): this {
            this.children = this.children.filter(existing => existing !== child);
            child.parent = null;
            return this;
        }

        traverse(visitor: (object: Object3DStub) => void): void {
            visitor(this);
            for (const child of this.children) {
                child.traverse(visitor);
            }
        }
    }

    class GeometryStub {
        parameters: Record<string, unknown>;

        constructor(parameters: Record<string, unknown> = {}) {
            this.parameters = parameters;
        }

        translate(): this {
            return this;
        }

        dispose(): void {}
    }

    class PlaneGeometryStub extends GeometryStub {
        constructor(width: number = 0, height: number = 0) {
            super({ width, height });
        }
    }

    class CircleGeometryStub extends GeometryStub {
        constructor(radius: number = 0, segments?: number) {
            super({ radius, segments });
        }
    }

    class SphereGeometryStub extends GeometryStub {
        constructor(radius: number = 0, widthSegments?: number, heightSegments?: number) {
            super({ radius, widthSegments, heightSegments });
        }
    }

    class RingGeometryStub extends GeometryStub {
        constructor(innerRadius: number = 0, outerRadius: number = 0, thetaSegments?: number) {
            super({ innerRadius, outerRadius, radius: outerRadius, thetaSegments });
        }
    }

    class CylinderGeometryStub extends GeometryStub {
        constructor(radiusTop?: number, radiusBottom?: number, height?: number) {
            super({ radiusTop, radiusBottom, height });
        }
    }

    class OctahedronGeometryStub extends GeometryStub {
        constructor(radius?: number, detail?: number) {
            super({ radius, detail });
        }
    }

    class IcosahedronGeometryStub extends GeometryStub {
        constructor(radius?: number, detail?: number) {
            super({ radius, detail });
        }
    }

    class BufferGeometryStub extends GeometryStub {}

    class MeshBasicMaterialStub {
        color = new ColorStub();
        opacity = 1;
        transparent = false;
        depthWrite = true;
        side = 0;
        blending = 0;
        map = {
            image: {
                getContext() {
                    return createCanvasContextStub();
                },
            },
            needsUpdate: false,
        };

        constructor(init: Record<string, unknown> = {}) {
            if (init.color !== undefined) {
                this.color.set(init.color);
            }
            if (typeof init.opacity === "number") {
                this.opacity = init.opacity;
            }
            if (typeof init.transparent === "boolean") {
                this.transparent = init.transparent;
            }
            if (typeof init.depthWrite === "boolean") {
                this.depthWrite = init.depthWrite;
            }
            if (typeof init.side === "number") {
                this.side = init.side;
            }
            if (typeof init.blending === "number") {
                this.blending = init.blending;
            }
        }

        dispose(): void {}

        clone(): MeshBasicMaterialStub {
            return new MeshBasicMaterialStub({
                opacity: this.opacity,
                transparent: this.transparent,
                depthWrite: this.depthWrite,
                side: this.side,
                blending: this.blending,
                color: this.color.value,
            });
        }
    }

    class MeshPhongMaterialStub extends MeshBasicMaterialStub {
        emissive = new ColorStub();
        emissiveIntensity = 0;
        shininess = 0;
        specular = new ColorStub();

        constructor(init: Record<string, unknown> = {}) {
            super(init);
            if (init.emissive !== undefined) {
                this.emissive.set(init.emissive);
            }
            if (typeof init.emissiveIntensity === "number") {
                this.emissiveIntensity = init.emissiveIntensity;
            }
            if (typeof init.shininess === "number") {
                this.shininess = init.shininess;
            }
            if (init.specular !== undefined) {
                this.specular.set(init.specular);
            }
        }

        clone(): MeshPhongMaterialStub {
            return new MeshPhongMaterialStub({
                opacity: this.opacity,
                transparent: this.transparent,
                depthWrite: this.depthWrite,
                side: this.side,
                blending: this.blending,
                color: this.color.value,
                emissive: this.emissive.value,
                emissiveIntensity: this.emissiveIntensity,
                shininess: this.shininess,
                specular: this.specular.value,
            });
        }
    }

    class MeshStandardMaterialStub extends MeshPhongMaterialStub {}

    class MeshStub extends Object3DStub {
        material: MeshBasicMaterialStub | MeshPhongMaterialStub | MeshStandardMaterialStub;
        geometry: GeometryStub;

        constructor(
            geometry: GeometryStub = new GeometryStub(),
            material: MeshBasicMaterialStub | MeshPhongMaterialStub | MeshStandardMaterialStub = new MeshBasicMaterialStub({
                map: {
                    image: {
                        getContext() {
                            return createCanvasContextStub();
                        },
                    },
                    needsUpdate: false,
                },
            })
        ) {
            super();
            this.geometry = geometry;
            this.material = material;
        }
    }

    class GroupStub extends Object3DStub {}

    class SceneStub extends GroupStub {}

    class LineStub extends Object3DStub {}

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
        Object3D: Object3DStub,
        Group: GroupStub,
        PlaneGeometry: PlaneGeometryStub,
        CircleGeometry: CircleGeometryStub,
        MeshBasicMaterial: MeshBasicMaterialStub,
        MeshPhongMaterial: MeshPhongMaterialStub,
        MeshStandardMaterial: MeshStandardMaterialStub,
        SphereGeometry: SphereGeometryStub,
        RingGeometry: RingGeometryStub,
        CylinderGeometry: CylinderGeometryStub,
        IcosahedronGeometry: IcosahedronGeometryStub,
        OctahedronGeometry: OctahedronGeometryStub,
        BufferGeometry: BufferGeometryStub,
        LineBasicMaterial: EmptyStub,
        Line: LineStub,
        CanvasTexture: CanvasTextureStub,
        LinearFilter: 0,
        SRGBColorSpace: "",
        DoubleSide: 0,
        AdditiveBlending: 1,
        Color: ColorStub,
        Vector3: Vector3Stub,
    };
}
