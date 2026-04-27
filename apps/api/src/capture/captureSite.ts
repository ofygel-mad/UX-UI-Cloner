import path from "node:path";
import { chromium, type Request, type Response } from "playwright";
import prettier from "prettier";
import { nanoid } from "nanoid";
import { classifyResource, folderForKind } from "./classifyResource.js";
import { runSafeInteractions } from "./safeInteractions.js";
import { zipDirectory } from "./zipScan.js";
import type {
  AnalysisReport,
  CapturedResource,
  CaptureOptions,
  CaptureResult,
  ImportedCookie,
  ImportedStorageBucket,
  NetworkEntry
} from "./types.js";
import { ensureDir, writeBuffer, writeJson, writeText } from "../utils/fs.js";
import { sha256 } from "../utils/hash.js";
import { normalizeUrl, safeFilePart } from "../utils/sanitize.js";
import { injectPerformanceObservers, capturePerformanceMetrics } from "../analysis/performance.js";
import { analyzeSecurityHeaders } from "../analysis/security.js";
import { detectFrameworks } from "../analysis/frameworks.js";
import { scanForSecrets } from "../analysis/secrets.js";
import { extractApiEndpoints } from "../analysis/endpoints.js";
import { analyzeSourceMaps } from "../analysis/sourcemaps.js";

const API_ROOT = process.env.FCB_STORAGE_ROOT
  ? path.resolve(process.env.FCB_STORAGE_ROOT, "..")
  : process.cwd();
const STORAGE_ROOT = path.join(API_ROOT, "storage", "scans");

function extensionForResource(url: string, mime: string): string {
  const cleanPath = new URL(url).pathname.toLowerCase();
  const fromPath = path.extname(cleanPath);

  if (fromPath && fromPath.length <= 8) return fromPath;

  if (mime.includes("html")) return ".html";
  if (mime.includes("css")) return ".css";
  if (mime.includes("javascript")) return ".js";
  if (mime.includes("json")) return ".json";
  if (mime.includes("svg")) return ".svg";
  if (mime.includes("png")) return ".png";
  if (mime.includes("jpeg") || mime.includes("jpg")) return ".jpg";
  if (mime.includes("webp")) return ".webp";
  if (mime.includes("woff2")) return ".woff2";
  if (mime.includes("woff")) return ".woff";
  if (mime.includes("wasm")) return ".wasm";

  return ".bin";
}

async function maybePrettify(kind: string, content: Buffer): Promise<string | null> {
  const text = content.toString("utf-8");

  try {
    if (kind === "js") {
      return await prettier.format(text, { parser: "babel" });
    }

    if (kind === "css") {
      return await prettier.format(text, { parser: "css" });
    }

    if (kind === "html") {
      return await prettier.format(text, { parser: "html" });
    }

    if (kind === "json") {
      return await prettier.format(text, { parser: "json" });
    }

    return null;
  } catch {
    return null;
  }
}

function countByKind(resources: CapturedResource[]): Record<string, number> {
  const result: Record<string, number> = {};

  for (const resource of resources) {
    result[resource.kind] = (result[resource.kind] || 0) + 1;
  }

  return result;
}

function isExternal(baseUrl: string, resourceUrl: string): boolean {
  return new URL(baseUrl).hostname !== new URL(resourceUrl).hostname;
}

function matchesDomainFilter(
  resourceUrl: string,
  domainFilter?: { include?: string[]; exclude?: string[] }
): boolean {
  if (!domainFilter) return true;

  try {
    const resourceHostname = new URL(resourceUrl).hostname || "";

    // If include list exists, resource must match one of the includes
    if (domainFilter.include && domainFilter.include.length > 0) {
      const matchesInclude = domainFilter.include.some((domain) => {
        const normalizedDomain = domain.toLowerCase();
        return (
          resourceHostname === normalizedDomain ||
          resourceHostname.endsWith(`.${normalizedDomain}`)
        );
      });
      if (!matchesInclude) return false;
    }

    // If exclude list exists, resource must not match any excludes
    if (domainFilter.exclude && domainFilter.exclude.length > 0) {
      const matchesExclude = domainFilter.exclude.some((domain) => {
        const normalizedDomain = domain.toLowerCase();
        return (
          resourceHostname === normalizedDomain ||
          resourceHostname.endsWith(`.${normalizedDomain}`) ||
          resourceHostname.match(new RegExp(normalizedDomain.replace(/\*/g, ".*")))
        );
      });
      if (matchesExclude) return false;
    }

    return true;
  } catch {
    return true;
  }
}

function sanitizeImportedCookies(cookies: ImportedCookie[]): ImportedCookie[] {
  return cookies.filter((cookie) => Boolean(cookie.name) && Boolean(cookie.domain) && Boolean(cookie.path));
}

function buildStorageInitScript(storages: ImportedStorageBucket[]): string {
  return `
    (() => {
      const buckets = ${JSON.stringify(storages)};
      const bucket = buckets.find((item) => item.origin === window.location.origin);
      if (!bucket) return;

      for (const [key, value] of Object.entries(bucket.localStorage || {})) {
        try {
          window.localStorage.setItem(key, value);
        } catch {
          // Ignore blocked localStorage writes.
        }
      }

      for (const [key, value] of Object.entries(bucket.sessionStorage || {})) {
        try {
          window.sessionStorage.setItem(key, value);
        } catch {
          // Ignore blocked sessionStorage writes.
        }
      }
    })();
  `;
}

export async function captureSite(options: CaptureOptions): Promise<CaptureResult> {
  const url = normalizeUrl(options.url);
  const scanId = `scan_${Date.now()}_${nanoid(8)}`;
  const startedAt = new Date().toISOString();

  const urlHost = safeFilePart(new URL(url).hostname);
  const scanFolder = `${urlHost}_${scanId}`;
  const scanDir = path.join(STORAGE_ROOT, scanFolder);
  const zipPath = `${scanDir}.zip`;

  await ensureDir(scanDir);

  const resources: CapturedResource[] = [];
  const networkMap = new Map<Request, NetworkEntry>();
  const seenResponseHashes = new Set<string>();
  let mainPageHeaders: Record<string, string> = {};
  let mainPageHeadersCaptured = false;
  const importedCookies = sanitizeImportedCookies(options.session?.cookies ?? []);
  const importedStorages = (options.session?.storages ?? []).filter((bucket) => Boolean(bucket.origin));

  const browser = await chromium.launch({
    headless: true
  });

  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      ignoreHTTPSErrors: true,
      userAgent:
        options.session?.userAgent ||
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari/537.36 FrontendCaptureBrowser/0.1",
      acceptDownloads: false
    });

    if (importedCookies.length > 0) {
      await context.addCookies(importedCookies);
    }

    if (importedStorages.length > 0) {
      await context.addInitScript(buildStorageInitScript(importedStorages));
    }

    const page = await context.newPage();

    // Inject performance observers before navigation so LCP/CLS are tracked from the start
    await injectPerformanceObservers(page);

    page.on("request", (request: Request) => {
      networkMap.set(request, {
        url: request.url(),
        method: request.method(),
        resourceType: request.resourceType(),
        requestHeaders: request.headers()
      });
    });

    page.on("requestfailed", (request: Request) => {
      const entry = networkMap.get(request);

      if (entry) {
        entry.failure = request.failure()?.errorText;
      }
    });

    page.on("response", async (response: Response) => {
      try {
        const request = response.request();
        const responseUrl = response.url();
        const status = response.status();
        const headers = response.headers();
        const mime = headers["content-type"] || "";
        const body = await response.body().catch(() => null);
        const entry = networkMap.get(request);

        if (entry) {
          entry.status = status;
          entry.responseHeaders = headers;
        }

        // Capture main page response headers for security analysis
        if (!mainPageHeadersCaptured && responseUrl === url && status < 400) {
          mainPageHeaders = headers;
          mainPageHeadersCaptured = true;
        }

        if (!body) return;

        // Check domain filter
        if (!matchesDomainFilter(responseUrl, options.domainFilter)) {
          return;
        }

        const kind = classifyResource(responseUrl, mime);
        const digest = sha256(body);
        const uniquenessKey = `${responseUrl}:${digest}`;

        if (seenResponseHashes.has(uniquenessKey)) return;
        seenResponseHashes.add(uniquenessKey);

        const id = `res_${String(resources.length + 1).padStart(5, "0")}`;
        const ext = extensionForResource(responseUrl, mime);
        const urlPart = safeFilePart(path.basename(new URL(responseUrl).pathname) || "index");
        const fileName = `${id}_${urlPart}${ext}`;
        const folder = folderForKind(kind);
        const localPath = path.join(folder, fileName);
        const absolutePath = path.join(scanDir, localPath);

        await writeBuffer(absolutePath, body);

        let prettyPath: string | undefined;

        if (["html", "css", "js", "json"].includes(kind)) {
          const pretty = await maybePrettify(kind, body);

          if (pretty) {
            const prettyFolder =
              kind === "js"
                ? "resources/js/pretty"
                : kind === "css"
                  ? "resources/css/pretty"
                  : kind === "html"
                    ? "resources/html/pretty"
                    : "resources/json/pretty";

            const prettyFileName = fileName.replace(ext, `.pretty${ext}`);
            prettyPath = path.join(prettyFolder, prettyFileName);
            await writeText(path.join(scanDir, prettyPath), pretty);
          }
        }

        resources.push({
          id,
          url: responseUrl,
          method: request.method(),
          status,
          mime,
          kind,
          sizeBytes: body.length,
          sha256: digest,
          domain: new URL(responseUrl).hostname,
          localPath,
          prettyPath,
          fromCache: response.fromServiceWorker()
        });
      } catch {
        // Keep the scan running if one response cannot be serialized.
      }
    });

    const consoleMessages: unknown[] = [];
    let consoleErrors = 0;

    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors += 1;
      }

      consoleMessages.push({
        type: message.type(),
        text: message.text(),
        location: message.location()
      });
    });

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: options.timeoutMs
    });

    await page
      .waitForLoadState("networkidle", {
        timeout: Math.min(options.timeoutMs, 15000)
      })
      .catch(() => undefined);

    // Capture performance metrics right after page load (before interactions change the page)
    const performanceMetrics = await capturePerformanceMetrics(page);

    const initialHtml = await page.content();
    await writeText(path.join(scanDir, "page", "initial-or-current.html"), initialHtml);

    const screenshotDesktop = path.join("screenshots", "desktop.png");
    await page.screenshot({
      path: path.join(scanDir, screenshotDesktop),
      fullPage: false
    });

    // Mobile viewport screenshot
    const screenshotMobile = path.join("screenshots", "mobile.png");
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(400);
    await page.screenshot({
      path: path.join(scanDir, screenshotMobile),
      fullPage: false
    }).catch(() => undefined);
    await page.setViewportSize({ width: 1440, height: 900 });

    const interactions = await runSafeInteractions(
      page,
      options.maxActionsPerPage,
      options.pathExclusions,
      options.adminMode,
      options.crawlDepth
    );

    await page.waitForTimeout(1200);

    const finalDom = await page.content();
    await writeText(path.join(scanDir, "page", "final-dom.html"), finalDom);

    const fullPageScreenshot = path.join("screenshots", "fullpage.png");
    await page
      .screenshot({
        path: path.join(scanDir, fullPageScreenshot),
        fullPage: true
      })
      .catch(() => undefined);

    const cookies = await context.cookies().catch(() => []);
    const localStorageDump = await page
      .evaluate(() => {
        const result: Record<string, string | null> = {};

        for (let i = 0; i < localStorage.length; i += 1) {
          const key = localStorage.key(i);
          if (key) result[key] = localStorage.getItem(key);
        }

        return result;
      })
      .catch(() => ({}));

    await writeJson(path.join(scanDir, "page", "console.json"), consoleMessages);
    await writeJson(
      path.join(scanDir, "page", "cookies.redacted.json"),
      cookies.map((cookie) => ({
        name: cookie.name,
        domain: cookie.domain,
        path: cookie.path,
        expires: cookie.expires,
        httpOnly: cookie.httpOnly,
        secure: cookie.secure,
        sameSite: cookie.sameSite
      }))
    );
    await writeJson(path.join(scanDir, "page", "localStorage.json"), localStorageDump);

    // Run all analysis modules
    const [securityReport, frameworks, secrets, sourceMaps] = await Promise.all([
      Promise.resolve(analyzeSecurityHeaders(mainPageHeaders, Array.from(networkMap.values()), url)),
      detectFrameworks(page, resources, scanDir),
      scanForSecrets(resources, scanDir),
      analyzeSourceMaps(resources, scanDir),
    ]);

    const network = Array.from(networkMap.values());
    const apiEndpoints = extractApiEndpoints(network);

    const analysis: AnalysisReport = {
      performance: performanceMetrics,
      security: securityReport,
      frameworks,
      secrets,
      apiEndpoints,
      sourceMaps,
    };

    await ensureDir(path.join(scanDir, "analysis"));
    await writeJson(path.join(scanDir, "analysis", "report.json"), analysis);

    const externalDomains = Array.from(
      new Set(
        resources.filter((resource) => isExternal(url, resource.url)).map((resource) => resource.domain)
      )
    ).sort();

    const summary = {
      resourceCounts: countByKind(resources),
      totalSizeBytes: resources.reduce((sum, item) => sum + item.sizeBytes, 0),
      externalDomains,
      jsFiles: resources.filter((item) => item.kind === "js").length,
      cssFiles: resources.filter((item) => item.kind === "css").length,
      sourcemapsFound: resources.filter((item) => item.kind === "map").length,
      actionsCompleted: interactions.filter((item) => item.status === "completed").length,
      actionsSkipped: interactions.filter((item) => item.status === "skipped").length,
      totalRequests: network.length,
      failedRequests: network.filter((item) => item.failure || (item.status ?? 0) >= 400).length,
      consoleErrors
    };

    const finishedAt = new Date().toISOString();

    const manifest = {
      scanId,
      url,
      startedAt,
      finishedAt,
      browser: "chromium/playwright",
      viewport: {
        width: 1440,
        height: 900
      },
      resources,
      analysis
    };

    await writeJson(path.join(scanDir, "manifest.json"), manifest);
    await writeJson(
      path.join(scanDir, "result.json"),
      {
        scanId,
        url,
        scanDir,
        scanFolder,
        zipPath,
        startedAt,
        finishedAt,
        resources,
        network,
        interactions,
        screenshots: {
          desktop: screenshotDesktop,
          fullPage: fullPageScreenshot,
          mobile: screenshotMobile,
        },
        summary,
        analysis
      } satisfies CaptureResult
    );
    await writeJson(path.join(scanDir, "summary.json"), summary);
    await writeJson(path.join(scanDir, "network", "requests.json"), network);
    await writeJson(path.join(scanDir, "interactions", "actions.json"), interactions);

    await writeText(
      path.join(scanDir, "README.md"),
      [
        "# Frontend Capture Snapshot",
        "",
        `URL: ${url}`,
        `Scan ID: ${scanId}`,
        `Started: ${startedAt}`,
        `Finished: ${finishedAt}`,
        "",
        "## Analysis Summary",
        `- Frameworks: ${frameworks.map((f) => `${f.name}${f.version ? ` v${f.version}` : ""}`).join(", ") || "none detected"}`,
        `- Security Score: ${securityReport.score}/100`,
        `- Secrets Found: ${secrets.length}`,
        `- Source Maps: ${sourceMaps.length}`,
        `- API Endpoints: ${apiEndpoints.length}`,
        "",
        "This archive contains client-side resources captured by a controlled Chromium session.",
        "",
        "Important limitation: this archive contains only files and runtime states delivered to the browser. It does not contain backend source code or private repository files."
      ].join("\n")
    );

    await zipDirectory(scanDir, zipPath);

    return {
      scanId,
      url,
      scanDir,
      scanFolder,
      zipPath,
      startedAt,
      finishedAt,
      resources,
      network,
      interactions,
      screenshots: {
        desktop: screenshotDesktop,
        fullPage: fullPageScreenshot,
        mobile: screenshotMobile,
      },
      summary,
      analysis
    };
  } finally {
    await browser.close();
  }
}
