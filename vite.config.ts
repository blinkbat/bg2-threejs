import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { saveMapPlugin } from "./vite-plugin-save-map";

// https://vite.dev/config/
export default defineConfig({
    plugins: [react(), saveMapPlugin()],
    base: "/bg2-threejs/",
    build: {
        outDir: "dist",
        assetsDir: "assets",
        chunkSizeWarningLimit: 900,
        rollupOptions: {
            output: {
                manualChunks(id) {
                    if (!id.includes("node_modules")) {
                        return undefined;
                    }
                    if (id.includes("three")) {
                        return "vendor-three";
                    }
                    if (id.includes("react")) {
                        return "vendor-react";
                    }
                    if (id.includes("tippy.js")) {
                        return "vendor-ui";
                    }
                    return "vendor";
                }
            }
        }
    }
});
