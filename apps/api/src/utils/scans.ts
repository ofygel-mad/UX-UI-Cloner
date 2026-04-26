import path from "node:path";
import type { AnalysisReport, CaptureResult, CapturedResource, InteractionLog, NetworkEntry } from "../capture/types.js";
import { listDirectories, pathExists, readJson } from "./fs.js";

const STORAGE_ROOT = process.env.FCB_STORAGE_ROOT
  ? path.join(process.env.FCB_STORAGE_ROOT, "scans")
  : path.join(process.cwd(), "storage", "scans");

export type ScanListItem = {
  scanId: string;
  url: string;
  startedAt: string;
  finishedAt: string;
  summary: CaptureResult["summary"];
  screenshots: {
    desktop?: string;
    fullPage?: string;
    mobile?: string;
  };
  analysis?: AnalysisReport;
};

export type ScanDetail = ScanListItem & {
  downloadUrl: string;
  scanFolder: string;
  artifacts: {
    initialHtmlUrl: string;
    finalDomUrl: string;
    consoleUrl: string;
    cookiesUrl: string;
    localStorageUrl: string;
    networkUrl: string;
    interactionsUrl: string;
    manifestUrl: string;
    resultUrl: string;
    analysisUrl: string;
    screenshotDesktopUrl?: string;
    screenshotFullPageUrl?: string;
    screenshotMobileUrl?: string;
  };
  resources: Array<
    CapturedResource & {
      storageUrl: string;
      prettyUrl?: string;
    }
  >;
  network: NetworkEntry[];
  interactions: InteractionLog[];
};

type StoredCaptureResult = CaptureResult;

function toStorageUrl(scanFolder: string, relativePath: string): string {
  const normalizedPath = relativePath.split(path.sep).join("/");
  return `/storage/scans/${scanFolder}/${normalizedPath}`;
}

async function findScanFolder(scanId: string): Promise<string | null> {
  const directories = await listDirectories(STORAGE_ROOT);
  return directories.find((dir) => dir.includes(scanId)) ?? null;
}

function toListItem(result: StoredCaptureResult): ScanListItem {
  return {
    scanId: result.scanId,
    url: result.url,
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    summary: result.summary,
    screenshots: {
      desktop: result.screenshots.desktop
        ? toStorageUrl(result.scanFolder, result.screenshots.desktop)
        : undefined,
      fullPage: result.screenshots.fullPage
        ? toStorageUrl(result.scanFolder, result.screenshots.fullPage)
        : undefined,
      mobile: result.screenshots.mobile
        ? toStorageUrl(result.scanFolder, result.screenshots.mobile)
        : undefined,
    },
    analysis: result.analysis,
  };
}

export async function loadStoredScan(scanId: string): Promise<ScanDetail | null> {
  const scanFolder = await findScanFolder(scanId);
  if (!scanFolder) return null;

  const scanDir = path.join(STORAGE_ROOT, scanFolder);
  const resultFile = path.join(scanDir, "result.json");
  const hasResultFile = await pathExists(resultFile);

  if (!hasResultFile) return null;

  const result = await readJson<StoredCaptureResult>(resultFile);
  const resolvedFolder = result.scanFolder || scanFolder;

  return {
    ...toListItem({ ...result, scanFolder: resolvedFolder }),
    downloadUrl: `/api/scans/${result.scanId}/download`,
    scanFolder: resolvedFolder,
    artifacts: {
      initialHtmlUrl: toStorageUrl(resolvedFolder, "page/initial-or-current.html"),
      finalDomUrl: toStorageUrl(resolvedFolder, "page/final-dom.html"),
      consoleUrl: toStorageUrl(resolvedFolder, "page/console.json"),
      cookiesUrl: toStorageUrl(resolvedFolder, "page/cookies.redacted.json"),
      localStorageUrl: toStorageUrl(resolvedFolder, "page/localStorage.json"),
      networkUrl: toStorageUrl(resolvedFolder, "network/requests.json"),
      interactionsUrl: toStorageUrl(resolvedFolder, "interactions/actions.json"),
      manifestUrl: toStorageUrl(resolvedFolder, "manifest.json"),
      resultUrl: toStorageUrl(resolvedFolder, "result.json"),
      analysisUrl: toStorageUrl(resolvedFolder, "analysis/report.json"),
      screenshotDesktopUrl: result.screenshots.desktop
        ? toStorageUrl(resolvedFolder, result.screenshots.desktop)
        : undefined,
      screenshotFullPageUrl: result.screenshots.fullPage
        ? toStorageUrl(resolvedFolder, result.screenshots.fullPage)
        : undefined,
      screenshotMobileUrl: result.screenshots.mobile
        ? toStorageUrl(resolvedFolder, result.screenshots.mobile)
        : undefined,
    },
    resources: result.resources.map((resource) => ({
      ...resource,
      storageUrl: toStorageUrl(resolvedFolder, resource.localPath),
      prettyUrl: resource.prettyPath ? toStorageUrl(resolvedFolder, resource.prettyPath) : undefined
    })),
    network: result.network,
    interactions: result.interactions
  };
}

export async function listStoredScans(limit = 20): Promise<ScanListItem[]> {
  const directories = await listDirectories(STORAGE_ROOT);
  const items = await Promise.all(
    directories.map(async (scanFolder) => {
      const resultFile = path.join(STORAGE_ROOT, scanFolder, "result.json");
      const hasResultFile = await pathExists(resultFile);

      if (!hasResultFile) return null;

      const result = await readJson<StoredCaptureResult>(resultFile);
      return toListItem({ ...result, scanFolder: result.scanFolder || scanFolder });
    })
  );

  return items
    .filter((item): item is ScanListItem => item !== null)
    .sort((a, b) => b.finishedAt.localeCompare(a.finishedAt))
    .slice(0, limit);
}

export function resolveZipPath(scanFolder: string): string {
  return path.join(STORAGE_ROOT, `${scanFolder}.zip`);
}
