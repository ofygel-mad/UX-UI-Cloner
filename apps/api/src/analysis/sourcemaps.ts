import fs from "node:fs/promises";
import path from "node:path";
import type { CapturedResource, SourceMapFile } from "../capture/types.js";
import { ensureDir, writeText } from "../utils/fs.js";

type RawSourceMap = {
  version?: number;
  sources?: string[];
  sourcesContent?: (string | null)[];
  file?: string;
};

function sanitizeSourcePath(rawPath: string): string {
  // Strip webpack:// and similar prefixes, normalize traversal
  return rawPath
    .replace(/^webpack:\/\/\//, "")
    .replace(/^webpack:\/\//, "")
    .replace(/^\.\//, "")
    .replace(/\.\.\//g, "_parent_/")
    .replace(/[<>:"|?*]/g, "_")
    .slice(0, 200);
}

export async function analyzeSourceMaps(
  resources: CapturedResource[],
  scanDir: string
): Promise<SourceMapFile[]> {
  const mapResources = resources.filter((r) => r.kind === "map");
  const results: SourceMapFile[] = [];

  for (const res of mapResources) {
    try {
      const raw = await fs.readFile(path.join(scanDir, res.localPath), "utf-8");
      const map: RawSourceMap = JSON.parse(raw);

      if (!map.sources || map.sources.length === 0) continue;

      const hasContent = Array.isArray(map.sourcesContent) && map.sourcesContent.some((c) => c && c.length > 0);

      if (hasContent && map.sourcesContent) {
        const sourcesDir = path.join(scanDir, "analysis", "sources");
        await ensureDir(sourcesDir);

        for (let i = 0; i < map.sources.length; i++) {
          const content = map.sourcesContent[i];
          if (!content) continue;

          const safePath = sanitizeSourcePath(map.sources[i]);
          if (!safePath || safePath.startsWith("node_modules/")) continue;

          const outPath = path.join(sourcesDir, safePath);
          await ensureDir(path.dirname(outPath));
          await writeText(outPath, content).catch(() => undefined);
        }
      }

      results.push({
        originalPath: res.url,
        mapResourceId: res.id,
        sources: map.sources.map(sanitizeSourcePath).filter(Boolean),
        hasContent,
      });
    } catch {}
  }

  return results;
}
