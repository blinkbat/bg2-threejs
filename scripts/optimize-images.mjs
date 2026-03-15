import { spawn } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";

const assetsDirectory = path.resolve("src/assets");
const oxipngCli = path.resolve("node_modules", "oxipng", "cli.js");
const oxipngArgs = ["-o", "3", "--strip", "safe", "--alpha", "-q"];

async function collectPngFiles(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    const pngFiles = [];

    for (const entry of entries) {
        const entryPath = path.join(directory, entry.name);

        if (entry.isDirectory()) {
            pngFiles.push(...await collectPngFiles(entryPath));
            continue;
        }

        if (path.extname(entry.name).toLowerCase() === ".png") {
            pngFiles.push(entryPath);
        }
    }

    return pngFiles;
}

function runOxipng(files) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [oxipngCli, ...oxipngArgs, ...files], {
            stdio: "inherit",
        });

        child.once("error", reject);
        child.once("close", (code) => {
            if (code === 0) {
                resolve();
                return;
            }

            reject(new Error(`oxipng exited with code ${code ?? "unknown"}`));
        });
    });
}

async function getTotalBytes(files) {
    let totalBytes = 0;

    for (const file of files) {
        totalBytes += (await stat(file)).size;
    }

    return totalBytes;
}

function formatKilobytes(bytes) {
    return `${(bytes / 1024).toFixed(2)} KB`;
}

async function main() {
    const pngFiles = (await collectPngFiles(assetsDirectory)).sort();

    if (pngFiles.length === 0) {
        console.log("No PNG assets found under src/assets.");
        return;
    }

    const beforeBytes = await getTotalBytes(pngFiles);
    console.log(`Optimizing ${pngFiles.length} PNG assets with oxipng...`);
    await runOxipng(pngFiles);
    const afterBytes = await getTotalBytes(pngFiles);
    const savedBytes = beforeBytes - afterBytes;

    if (savedBytes > 0) {
        console.log(
            `Saved ${formatKilobytes(savedBytes)} across ${pngFiles.length} PNG assets `
                + `(${formatKilobytes(beforeBytes)} -> ${formatKilobytes(afterBytes)}).`,
        );
        return;
    }

    console.log(`PNG assets already optimized at ${formatKilobytes(afterBytes)} total.`);
}

await main();
