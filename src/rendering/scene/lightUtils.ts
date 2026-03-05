export interface CandleLightSource {
    x: number;
    y: number;
    z: number;
    kind: "candle" | "torch";
    colorHex: string;
    intensity: number;
    range: number;
}

interface CandleLightCluster {
    colorHex: string;
    members: CandleLightSource[];
    weightedX: number;
    weightedY: number;
    weightedZ: number;
    totalWeight: number;
    maxRange: number;
    totalIntensity: number;
}

const CANDLE_LIGHT_CLUSTER_RADIUS = 5.5;
const CANDLE_LIGHT_CLUSTER_MAX_MEMBERS = 6;

export function normalizeHexColor(color: string | undefined, fallback: string): string {
    if (typeof color === "string" && /^#[0-9a-fA-F]{6}$/.test(color)) {
        return color.toLowerCase();
    }
    return fallback;
}

export function clampFinite(value: number | undefined, min: number, max: number, fallback: number): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return fallback;
    }
    return Math.max(min, Math.min(max, value));
}

function createCluster(source: CandleLightSource): CandleLightCluster {
    return {
        colorHex: source.colorHex,
        members: [source],
        weightedX: source.x * source.intensity,
        weightedY: source.y * source.intensity,
        weightedZ: source.z * source.intensity,
        totalWeight: source.intensity,
        maxRange: source.range,
        totalIntensity: source.intensity,
    };
}

function addSourceToCluster(cluster: CandleLightCluster, source: CandleLightSource): void {
    cluster.members.push(source);
    cluster.weightedX += source.x * source.intensity;
    cluster.weightedY += source.y * source.intensity;
    cluster.weightedZ += source.z * source.intensity;
    cluster.totalWeight += source.intensity;
    cluster.maxRange = Math.max(cluster.maxRange, source.range);
    cluster.totalIntensity += source.intensity;
}

export function buildCandleLightClusters(sources: CandleLightSource[]): CandleLightCluster[] {
    const clusters: CandleLightCluster[] = [];

    for (const source of sources) {
        let bestCluster: CandleLightCluster | null = null;
        let bestDistance = Number.POSITIVE_INFINITY;

        for (const cluster of clusters) {
            if (cluster.colorHex !== source.colorHex) continue;
            if (cluster.members.length >= CANDLE_LIGHT_CLUSTER_MAX_MEMBERS) continue;

            const cx = cluster.weightedX / cluster.totalWeight;
            const cz = cluster.weightedZ / cluster.totalWeight;
            const dx = source.x - cx;
            const dz = source.z - cz;
            const distance = Math.hypot(dx, dz);
            if (distance <= CANDLE_LIGHT_CLUSTER_RADIUS && distance < bestDistance) {
                bestCluster = cluster;
                bestDistance = distance;
            }
        }

        if (bestCluster) {
            addSourceToCluster(bestCluster, source);
        } else {
            clusters.push(createCluster(source));
        }
    }

    return clusters;
}
