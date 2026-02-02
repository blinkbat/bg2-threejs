import type { Plugin } from "vite";
import fs from "fs";
import path from "path";

/**
 * Vite plugin that adds a dev server endpoint for saving map files.
 * POST /__save-map with { areaId: string, content: string } body.
 */
export function saveMapPlugin(): Plugin {
    return {
        name: "save-map",
        configureServer(server) {
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
        },
    };
}
