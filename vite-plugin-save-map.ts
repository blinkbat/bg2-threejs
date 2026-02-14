import type { Plugin } from "vite";
import fs from "fs";
import path from "path";

const PERF_LOG_MAX_LINES = 5000;

function trimFileToMaxLines(filePath: string, maxLines: number): number {
    if (!fs.existsSync(filePath)) {
        return 0;
    }

    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split(/\r?\n/).filter(line => line.length > 0);
    if (lines.length <= maxLines) {
        return lines.length;
    }

    const trimmed = lines.slice(-maxLines);
    fs.writeFileSync(filePath, `${trimmed.join("\n")}\n`, "utf-8");
    return trimmed.length;
}

/**
 * Vite plugin that adds a dev server endpoint for saving map files.
 * POST /__save-map with { areaId: string, content: string } body.
 */
export function saveMapPlugin(): Plugin {
    return {
        name: "save-map",
        configureServer(server) {
            const logsDir = path.join(process.cwd(), "logs");
            const perfLogPath = path.join(logsDir, "perf-debug.txt");
            if (fs.existsSync(perfLogPath)) {
                trimFileToMaxLines(perfLogPath, PERF_LOG_MAX_LINES);
            }

            server.middlewares.use("/__save-map", (req, res) => {
                if (req.method !== "POST") {
                    res.statusCode = 405;
                    res.end(JSON.stringify({ error: "Method not allowed" }));
                    return;
                }

                let body = "";
                req.on("data", (chunk: Buffer) => {
                    body += chunk.toString();
                });
                req.on("end", () => {
                    try {
                        const { areaId, content } = JSON.parse(body);
                        if (!areaId || typeof content !== "string") {
                            res.statusCode = 400;
                            res.end(JSON.stringify({ error: "Missing areaId or content" }));
                            return;
                        }

                        // Validate areaId to prevent path traversal
                        if (!/^[a-z0-9_]+$/.test(areaId)) {
                            res.statusCode = 400;
                            res.end(JSON.stringify({ error: "Invalid areaId format" }));
                            return;
                        }

                        // Use process.cwd() which is the project root
                        const mapsDir = path.join(process.cwd(), "src", "game", "areas", "maps");
                        const filePath = path.join(mapsDir, `${areaId}.txt`);

                        console.log(`[save-map] Saving to: ${filePath}`);

                        // Ensure maps directory exists
                        if (!fs.existsSync(mapsDir)) {
                            fs.mkdirSync(mapsDir, { recursive: true });
                        }

                        fs.writeFileSync(filePath, content, "utf-8");
                        console.log(`[save-map] Saved ${areaId}.txt successfully`);

                        res.setHeader("Content-Type", "application/json");
                        res.end(JSON.stringify({ success: true, path: filePath }));
                    } catch (err) {
                        console.error("[save-map] Error:", err);
                        res.statusCode = 500;
                        res.end(JSON.stringify({ error: String(err) }));
                    }
                });
            });

            server.middlewares.use("/__perf-log", (req, res) => {
                if (req.method !== "POST") {
                    res.statusCode = 405;
                    res.end(JSON.stringify({ error: "Method not allowed" }));
                    return;
                }

                let body = "";
                req.on("data", (chunk: Buffer) => {
                    body += chunk.toString();
                });
                req.on("end", () => {
                    try {
                        const parsed = body.length > 0 ? JSON.parse(body) : {};
                        const linesRaw = Reflect.get(parsed, "lines");
                        const sessionIdRaw = Reflect.get(parsed, "sessionId");

                        if (!Array.isArray(linesRaw) || linesRaw.some(line => typeof line !== "string")) {
                            res.statusCode = 400;
                            res.end(JSON.stringify({ error: "Missing or invalid lines" }));
                            return;
                        }

                        const safeSessionId = typeof sessionIdRaw === "string"
                            ? sessionIdRaw.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64)
                            : "dev";
                        const lines = linesRaw
                            .slice(0, 2000)
                            .map(line => line.replace(/\r?\n/g, " ").slice(0, 4000));

                        if (lines.length === 0) {
                            res.setHeader("Content-Type", "application/json");
                            res.end(JSON.stringify({ success: true, appended: 0 }));
                            return;
                        }

                        const filePath = perfLogPath;

                        if (!fs.existsSync(logsDir)) {
                            fs.mkdirSync(logsDir, { recursive: true });
                        }

                        const payload = lines.map(line => `[${safeSessionId}] ${line}`).join("\n") + "\n";
                        fs.appendFileSync(filePath, payload, "utf-8");
                        const totalLines = trimFileToMaxLines(filePath, PERF_LOG_MAX_LINES);

                        res.setHeader("Content-Type", "application/json");
                        res.end(JSON.stringify({
                            success: true,
                            appended: lines.length,
                            totalLines,
                            maxLines: PERF_LOG_MAX_LINES,
                            path: filePath
                        }));
                    } catch (err) {
                        console.error("[perf-log] Error:", err);
                        res.statusCode = 500;
                        res.end(JSON.stringify({ error: String(err) }));
                    }
                });
            });
        },
    };
}
