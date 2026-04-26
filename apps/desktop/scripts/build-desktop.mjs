import path from "node:path";
import { fileURLToPath } from "node:url";
import { cp, mkdir, rm } from "node:fs/promises";
import esbuild from "esbuild";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const desktopRoot = path.resolve(__dirname, "..");
const distRoot = path.join(desktopRoot, "dist");
const rendererSrc = path.join(desktopRoot, "src", "renderer");
const rendererDist = path.join(distRoot, "renderer");

await rm(distRoot, { recursive: true, force: true });
await mkdir(distRoot, { recursive: true });

await esbuild.build({
  entryPoints: [path.join(desktopRoot, "src", "main.ts")],
  bundle: true,
  outfile: path.join(distRoot, "main.js"),
  platform: "node",
  format: "esm",
  target: "node20",
  external: ["electron", "playwright"]
});

await esbuild.build({
  entryPoints: [path.join(desktopRoot, "src", "preload.ts")],
  bundle: true,
  outfile: path.join(distRoot, "preload.js"),
  platform: "node",
  format: "esm",
  target: "node20",
  external: ["electron"]
});

await cp(rendererSrc, rendererDist, {
  recursive: true
});
