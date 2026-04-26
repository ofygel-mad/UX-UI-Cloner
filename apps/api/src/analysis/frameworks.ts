import fs from "node:fs/promises";
import path from "node:path";
import type { Page } from "playwright";
import type { CapturedResource, DetectedFramework } from "../capture/types.js";

const VERSION_PATTERNS: Array<{
  name: string;
  pattern: RegExp;
  group: number;
}> = [
  { name: "React", pattern: /["']react["']\s*:\s*["']([0-9]+\.[0-9]+\.[0-9]+)["']/, group: 1 },
  { name: "React", pattern: /createElement\s*=.*?\/\*\*.*?@license React v([0-9]+\.[0-9]+\.[0-9]+)/, group: 1 },
  { name: "Vue", pattern: /Vue\.version\s*=\s*["']([0-9]+\.[0-9]+\.[0-9]+)["']/, group: 1 },
  { name: "Vue", pattern: /\*\s*Vue\.js v([0-9]+\.[0-9]+\.[0-9]+)/, group: 1 },
  { name: "Angular", pattern: /Angular\s+v([0-9]+\.[0-9]+\.[0-9]+)/, group: 1 },
  { name: "Next.js", pattern: /["']next["']\s*:\s*["']([0-9]+\.[0-9]+\.[0-9]+)["']/, group: 1 },
  { name: "Nuxt", pattern: /["']nuxt["']\s*:\s*["']([0-9]+\.[0-9]+\.[0-9]+)["']/, group: 1 },
  { name: "Svelte", pattern: /\*\s*Svelte v([0-9]+\.[0-9]+\.[0-9]+)/, group: 1 },
  { name: "lodash", pattern: /lodash\s+([0-9]+\.[0-9]+\.[0-9]+)/, group: 1 },
  { name: "axios", pattern: /axios\/([0-9]+\.[0-9]+\.[0-9]+)/, group: 1 },
  { name: "jQuery", pattern: /jQuery\s+v([0-9]+\.[0-9]+\.[0-9]+)/, group: 1 },
  { name: "Webpack", pattern: /webpackBootstrap|__webpack_require__/, group: 0 },
  { name: "Vite", pattern: /\/@vite\/client|vite\/dist\/client/, group: 0 },
];

export async function detectFrameworks(
  page: Page,
  resources: CapturedResource[],
  scanDir: string
): Promise<DetectedFramework[]> {
  const found = new Map<string, DetectedFramework>();

  const windowSignals = await page
    .evaluate(() => ({
      hasReact: !!(window as any).React || !!(document.querySelector("[data-reactroot]")),
      reactVersion: (window as any).React?.version as string | undefined,
      hasVue: !!(window as any).__vue_app__ || !!(window as any).Vue,
      vueVersion: ((window as any).__vue_app__?.version ?? (window as any).Vue?.version) as string | undefined,
      hasAngular: !!(window as any).ng,
      angularVersion: (window as any).ng?.version?.full as string | undefined,
      hasNextData: !!(window as any).__NEXT_DATA__,
      hasNuxt: !!(window as any).__nuxt || !!(window as any).__NUXT__,
      hasSvelte: !!document.querySelector("[class*='svelte-']"),
      hasWebpack: !!(window as any).__webpack_require__ || !!(window as any).webpackJsonp,
      hasVite: !!(window as any).__vite_is_modern_browser,
      hasRemix: !!(window as any).__remixContext,
    }))
    .catch(() => ({} as Record<string, unknown>));

  const addOrUpgrade = (name: string, version: string | undefined, confidence: DetectedFramework["confidence"]) => {
    const existing = found.get(name);
    const confidenceRank = { high: 3, medium: 2, low: 1 };
    if (!existing || confidenceRank[confidence] > confidenceRank[existing.confidence]) {
      found.set(name, { name, version, confidence });
    }
  };

  if (windowSignals.hasReact) addOrUpgrade("React", windowSignals.reactVersion as string, "high");
  if (windowSignals.hasVue) addOrUpgrade("Vue", windowSignals.vueVersion as string, "high");
  if (windowSignals.hasAngular) addOrUpgrade("Angular", windowSignals.angularVersion as string, "high");
  if (windowSignals.hasNextData) addOrUpgrade("Next.js", undefined, "high");
  if (windowSignals.hasNuxt) addOrUpgrade("Nuxt", undefined, "high");
  if (windowSignals.hasSvelte) addOrUpgrade("Svelte", undefined, "medium");
  if (windowSignals.hasWebpack) addOrUpgrade("Webpack", undefined, "high");
  if (windowSignals.hasVite) addOrUpgrade("Vite", undefined, "high");
  if (windowSignals.hasRemix) addOrUpgrade("Remix", undefined, "high");

  const jsResources = resources.filter((r) => r.kind === "js").slice(0, 30);
  for (const res of jsResources) {
    try {
      const content = await fs.readFile(path.join(scanDir, res.localPath), "utf-8");
      const sample = content.slice(0, 50000);

      for (const { name, pattern, group } of VERSION_PATTERNS) {
        const match = sample.match(pattern);
        if (match) {
          const version = group > 0 ? match[group] : undefined;
          addOrUpgrade(name, version, version ? "high" : "medium");
        }
      }
    } catch {}
  }

  return Array.from(found.values()).sort((a, b) => a.name.localeCompare(b.name));
}
