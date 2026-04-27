import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { cp, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import esbuild from "esbuild";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const desktopRoot = path.resolve(__dirname, "..");
const distRoot = path.join(desktopRoot, "dist");
const rendererSrc = path.join(desktopRoot, "src", "renderer");
const rendererDist = path.join(distRoot, "renderer");
const playwrightDist = path.join(distRoot, "ms-playwright");
const require = createRequire(import.meta.url);

function runNodeScript(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: desktopRoot,
      stdio: "inherit"
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Command failed with exit code ${code}`));
    });
  });
}

async function stagePlaywrightChromium() {
  const playwrightPackageJson = require.resolve("playwright/package.json");
  const playwrightCli = path.join(path.dirname(playwrightPackageJson), "cli.js");
  await runNodeScript([playwrightCli, "install", "chromium"]);

  const { chromium } = require("playwright");
  const browserExecutable = chromium.executablePath();
  const browserRevisionDir = path.dirname(path.dirname(browserExecutable));

  await rm(playwrightDist, { recursive: true, force: true });
  await mkdir(playwrightDist, { recursive: true });
  await cp(browserRevisionDir, path.join(playwrightDist, path.basename(browserRevisionDir)), {
    recursive: true
  });
}

await rm(distRoot, { recursive: true, force: true });
await mkdir(distRoot, { recursive: true });

await esbuild.build({
  entryPoints: [path.join(desktopRoot, "src", "main.ts")],
  bundle: false,
  outfile: path.join(distRoot, "main.cjs"),
  platform: "node",
  format: "cjs",
  target: "node20"
});

await esbuild.build({
  entryPoints: [path.join(desktopRoot, "src", "api-runtime.ts")],
  bundle: true,
  outfile: path.join(distRoot, "api-runtime.js"),
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["playwright", "prettier"]
});

await esbuild.build({
  entryPoints: [path.join(desktopRoot, "src", "preload.ts")],
  bundle: true,
  outfile: path.join(distRoot, "preload.cjs"),
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["electron"]
});

await cp(rendererSrc, rendererDist, {
  recursive: true
});

if (process.argv.includes("--stage-playwright")) {
  await stagePlaywrightChromium();
}
