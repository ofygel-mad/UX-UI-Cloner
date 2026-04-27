import { useEffect, useRef, useState } from "react";
import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import cssLang from "highlight.js/lib/languages/css";
import xml from "highlight.js/lib/languages/xml";
import jsonLang from "highlight.js/lib/languages/json";
import "highlight.js/styles/github-dark.min.css";
import { CaptureConfig } from "./CaptureConfig.js";
import "./App.css";

hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("css", cssLang);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("json", jsonLang);

// ─── Types ────────────────────────────────────────────────────────────────────

type PerformanceMetrics = {
  ttfb: number | null;
  fcp: number | null;
  lcp: number | null;
  cls: number | null;
  domContentLoaded: number | null;
  loadTime: number | null;
};

type SecurityHeaderCheck = {
  header: string;
  present: boolean;
  value?: string;
  severity: "critical" | "warning" | "info";
  recommendation: string;
};

type SecurityReport = {
  headers: SecurityHeaderCheck[];
  mixedContentCount: number;
  httpsOnly: boolean;
  score: number;
};

type DetectedFramework = {
  name: string;
  version?: string;
  confidence: "high" | "medium" | "low";
};

type SecretFinding = {
  type: string;
  resourceId: string;
  resourceUrl: string;
  maskedValue: string;
  severity: "critical" | "high" | "medium";
};

type ApiEndpoint = {
  method: string;
  url: string;
  count: number;
};

type SourceMapFile = {
  originalPath: string;
  mapResourceId: string;
  sources: string[];
  hasContent: boolean;
};

type AnalysisReport = {
  performance: PerformanceMetrics;
  security: SecurityReport;
  frameworks: DetectedFramework[];
  secrets: SecretFinding[];
  apiEndpoints: ApiEndpoint[];
  sourceMaps: SourceMapFile[];
};

type CaptureSummary = {
  resourceCounts: Record<string, number>;
  totalSizeBytes: number;
  externalDomains: string[];
  jsFiles: number;
  cssFiles: number;
  sourcemapsFound: number;
  actionsCompleted: number;
  actionsSkipped: number;
  totalRequests: number;
  failedRequests: number;
  consoleErrors: number;
};

type ScanListItem = {
  scanId: string;
  url: string;
  startedAt: string;
  finishedAt: string;
  summary: CaptureSummary;
  screenshots: { desktop?: string; fullPage?: string; mobile?: string };
  analysis?: AnalysisReport;
};

type ScanResource = {
  id: string;
  url: string;
  method: string;
  status: number;
  mime: string;
  kind: string;
  sizeBytes: number;
  sha256: string;
  domain: string;
  localPath: string;
  prettyPath?: string;
  fromCache?: boolean;
  storageUrl: string;
  prettyUrl?: string;
};

type InteractionLog = {
  id: string;
  type: "scroll" | "click" | "hover";
  label: string;
  status: "completed" | "skipped" | "failed";
  reason?: string;
};

type NetworkEntry = {
  url: string;
  method: string;
  status?: number;
  resourceType?: string;
  failure?: string;
};

type ScanDetail = ScanListItem & {
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
    analysisUrl?: string;
    screenshotDesktopUrl?: string;
    screenshotFullPageUrl?: string;
    screenshotMobileUrl?: string;
  };
  resources: ScanResource[];
  network: NetworkEntry[];
  interactions: InteractionLog[];
};

type JobResponse = {
  jobId: string;
  status: "queued" | "running" | "completed" | "failed";
  url: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  scanId?: string;
  error?: string;
  result?: { scanId: string; finishedAt: string; summary: CaptureSummary; downloadUrl: string };
};

type DiffResult = {
  scanA: { scanId: string; url: string; finishedAt: string };
  scanB: { scanId: string; url: string; finishedAt: string };
  resources: {
    added: Array<{ url: string; kind: string; sizeBytes: number }>;
    removed: Array<{ url: string; kind: string; sizeBytes: number }>;
    changed: Array<{ url: string; kind: string; sizeBytesA?: number; sizeBytesB: number }>;
    unchangedCount: number;
  };
  performance: { a: PerformanceMetrics | null; b: PerformanceMetrics | null };
  security: { scoreA: number | null; scoreB: number | null };
  frameworks: { a: DetectedFramework[]; b: DetectedFramework[] };
  secrets: { countA: number; countB: number };
};

type ActiveTab = "overview" | "resources" | "network" | "analysis" | "sources";

// ─── Constants ────────────────────────────────────────────────────────────────

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:4000";
const PREVIEWABLE_KINDS = new Set(["html", "css", "js", "json", "svg", "map"]);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function formatMs(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function formatDateTime(input: string): string {
  return new Date(input).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "medium" });
}

async function apiRequest<T>(pathname: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${pathname}`, init);
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json() : await response.text();

  if (!response.ok) {
    const message =
      typeof payload === "string"
        ? payload
        : payload && typeof payload === "object" && "error" in payload
          ? String(payload.error)
          : "Request failed";
    throw new Error(message);
  }

  return payload as T;
}

function pickDefaultResource(resources: ScanResource[]): ScanResource | null {
  return (
    resources.find((r) => PREVIEWABLE_KINDS.has(r.kind)) ||
    resources.find((r) => r.kind === "image") ||
    resources[0] ||
    null
  );
}

function hljsLang(kind: string): string {
  if (kind === "js") return "javascript";
  if (kind === "css") return "css";
  if (kind === "html") return "xml";
  if (kind === "json" || kind === "map") return "json";
  if (kind === "svg") return "xml";
  return "plaintext";
}

function lcpColor(v: number | null): string {
  if (v === null) return "metric-unknown";
  if (v < 2500) return "metric-good";
  if (v < 4000) return "metric-warn";
  return "metric-bad";
}

function fcpColor(v: number | null): string {
  if (v === null) return "metric-unknown";
  if (v < 1800) return "metric-good";
  if (v < 3000) return "metric-warn";
  return "metric-bad";
}

function ttfbColor(v: number | null): string {
  if (v === null) return "metric-unknown";
  if (v < 800) return "metric-good";
  if (v < 1800) return "metric-warn";
  return "metric-bad";
}

function clsColor(v: number | null): string {
  if (v === null) return "metric-unknown";
  if (v < 0.1) return "metric-good";
  if (v < 0.25) return "metric-warn";
  return "metric-bad";
}

function securityScoreColor(score: number): string {
  if (score >= 80) return "metric-good";
  if (score >= 50) return "metric-warn";
  return "metric-bad";
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function HighlightedCode({ code, lang }: { code: string; lang: string }) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    delete ref.current.dataset.highlighted;
    ref.current.textContent = code;
    try {
      hljs.highlightElement(ref.current);
    } catch {}
  }, [code, lang]);

  return (
    <pre className="hljs-pre">
      <code ref={ref} className={`language-${lang}`} />
    </pre>
  );
}

function PerformancePanel({ perf }: { perf: PerformanceMetrics }) {
  const metrics: Array<{ label: string; value: number | null; colorFn: (v: number | null) => string; unit?: string }> = [
    { label: "TTFB", value: perf.ttfb, colorFn: ttfbColor },
    { label: "FCP", value: perf.fcp, colorFn: fcpColor },
    { label: "LCP", value: perf.lcp, colorFn: lcpColor },
    { label: "CLS", value: perf.cls, colorFn: clsColor, unit: "score" },
    { label: "DOM Ready", value: perf.domContentLoaded, colorFn: fcpColor },
    { label: "Load", value: perf.loadTime, colorFn: lcpColor },
  ];

  return (
    <div className="analysis-section">
      <h3>Производительность</h3>
      <div className="perf-grid">
        {metrics.map(({ label, value, colorFn, unit }) => (
          <div key={label} className={`perf-card ${colorFn(value)}`}>
            <span className="perf-label">{label}</span>
            <strong className="perf-value">
              {unit === "score" ? (value === null ? "—" : value.toFixed(3)) : formatMs(value)}
            </strong>
          </div>
        ))}
      </div>
      <p className="perf-legend">
        <span className="dot-good" /> &lt;2.5s LCP &nbsp;
        <span className="dot-warn" /> 2.5–4s &nbsp;
        <span className="dot-bad" /> &gt;4s
      </p>
    </div>
  );
}

function SecurityPanel({ sec }: { sec: SecurityReport }) {
  const severityOrder = { critical: 0, warning: 1, info: 2 };
  const sorted = [...sec.headers].sort(
    (a, b) => severityOrder[a.severity] - severityOrder[b.severity]
  );

  return (
    <div className="analysis-section">
      <h3>
        Безопасность заголовков
        <span className={`score-badge ${securityScoreColor(sec.score)}`}>{sec.score}/100</span>
      </h3>
      {!sec.httpsOnly && (
        <p className="warn-note">Сайт загружен по HTTP — HSTS и CSP не применимы.</p>
      )}
      {sec.mixedContentCount > 0 && (
        <p className="warn-note danger-text">Mixed content: {sec.mixedContentCount} http-ресурсов на HTTPS странице</p>
      )}
      <div className="security-list">
        {sorted.map((check) => (
          <div key={check.header} className={`security-row severity-${check.severity}`}>
            <span className="security-icon">{check.present ? "✓" : "✗"}</span>
            <div className="security-info">
              <strong>{check.header}</strong>
              {check.present && check.value ? (
                <code className="header-value">{check.value.slice(0, 80)}{check.value.length > 80 ? "…" : ""}</code>
              ) : (
                <span className="muted">{check.recommendation}</span>
              )}
            </div>
            <span className={`sev-badge sev-${check.severity}`}>{check.severity}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function FrameworksPanel({ frameworks }: { frameworks: DetectedFramework[] }) {
  return (
    <div className="analysis-section">
      <h3>Обнаруженные технологии <span className="pill">{frameworks.length}</span></h3>
      {frameworks.length === 0 ? (
        <p className="muted">Фреймворки не распознаны.</p>
      ) : (
        <div className="framework-grid">
          {frameworks.map((fw) => (
            <div key={fw.name} className="framework-card">
              <strong>{fw.name}</strong>
              {fw.version && <span className="fw-version">v{fw.version}</span>}
              <span className={`confidence confidence-${fw.confidence}`}>{fw.confidence}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SecretsPanel({ secrets }: { secrets: SecretFinding[] }) {
  return (
    <div className="analysis-section">
      <h3>
        Сканирование секретов
        {secrets.length > 0 ? (
          <span className="pill pill-danger">{secrets.length} найдено</span>
        ) : (
          <span className="pill pill-ok">чисто</span>
        )}
      </h3>
      {secrets.length === 0 ? (
        <p className="secret-clean">Потенциальных секретов и утечек не обнаружено.</p>
      ) : (
        <div className="secrets-list">
          {secrets.map((s, i) => (
            <div key={i} className={`secret-row severity-${s.severity}`}>
              <span className={`sev-badge sev-${s.severity}`}>{s.severity}</span>
              <div className="secret-info">
                <strong>{s.type}</strong>
                <code>{s.maskedValue}</code>
                <span className="muted truncate">{s.resourceUrl}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EndpointsPanel({ endpoints }: { endpoints: ApiEndpoint[] }) {
  return (
    <div className="analysis-section">
      <h3>API Endpoints <span className="pill">{endpoints.length}</span></h3>
      {endpoints.length === 0 ? (
        <p className="muted">Fetch/XHR запросы не зафиксированы.</p>
      ) : (
        <div className="endpoint-list">
          {endpoints.map((ep, i) => (
            <div key={i} className="endpoint-row">
              <span className={`method-badge method-${ep.method.toLowerCase()}`}>{ep.method}</span>
              <span className="endpoint-url truncate">{ep.url}</span>
              {ep.count > 1 && <span className="pill">{ep.count}×</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Source tree helpers ──────────────────────────────────────────────────────

type TreeNode = {
  name: string;
  path: string;
  isFile: boolean;
  children: TreeNode[];
};

function buildTree(paths: string[]): TreeNode[] {
  const root: TreeNode = { name: "", path: "", isFile: false, children: [] };

  for (const p of paths) {
    const parts = p.split("/");
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      const fullPath = parts.slice(0, i + 1).join("/");
      let child = node.children.find((c) => c.name === part);
      if (!child) {
        child = { name: part, path: fullPath, isFile: isLast, children: [] };
        node.children.push(child);
      }
      node = child;
    }
  }

  return root.children;
}

function TreeNodeView({
  node,
  selected,
  onSelect,
  depth,
}: {
  node: TreeNode;
  selected: string | null;
  onSelect: (path: string) => void;
  depth: number;
}) {
  const [open, setOpen] = useState(depth < 2);

  if (node.isFile) {
    return (
      <button
        type="button"
        className={`tree-file ${selected === node.path ? "active" : ""}`}
        style={{ ["--tree-depth" as string]: depth + 1 }}
        onClick={() => onSelect(node.path)}
      >
        {node.name}
      </button>
    );
  }

  return (
    <div>
      <button
        type="button"
        className="tree-dir"
        style={{ ["--tree-depth" as string]: depth }}
        onClick={() => setOpen(!open)}
      >
        {open ? "▾" : "▸"} {node.name}/
      </button>
      {open &&
        node.children.map((child) => (
          <TreeNodeView key={child.path} node={child} selected={selected} onSelect={onSelect} depth={depth + 1} />
        ))}
    </div>
  );
}

// ─── Diff overlay ─────────────────────────────────────────────────────────────

function DiffOverlay({
  diff,
  onClose,
}: {
  diff: DiffResult;
  onClose: () => void;
}) {
  const deltaPerf = (key: keyof PerformanceMetrics) => {
    const a = diff.performance.a?.[key] as number | null;
    const b = diff.performance.b?.[key] as number | null;
    if (a === null || b === null) return null;
    return b - a;
  };

  return (
    <div className="diff-overlay" onClick={onClose}>
      <div className="diff-modal" onClick={(e) => e.stopPropagation()}>
        <div className="diff-header">
          <div>
            <h2>Сравнение сканов</h2>
            <p className="muted">
              A: {diff.scanA.url} · {formatDateTime(diff.scanA.finishedAt)}<br />
              B: {diff.scanB.url} · {formatDateTime(diff.scanB.finishedAt)}
            </p>
          </div>
          <button type="button" className="secondary-button" onClick={onClose}>✕ Закрыть</button>
        </div>

        <div className="diff-grid">
          <div className="diff-block">
            <h3>Ресурсы</h3>
            <div className="diff-stats">
              <span className="diff-added">+{diff.resources.added.length} добавлено</span>
              <span className="diff-removed">−{diff.resources.removed.length} удалено</span>
              <span className="diff-changed">~{diff.resources.changed.length} изменено</span>
              <span className="muted">{diff.resources.unchangedCount} без изменений</span>
            </div>
            {diff.resources.added.slice(0, 10).map((r, i) => (
              <div key={i} className="diff-row diff-added">
                <span className="resource-kind">{r.kind}</span>
                <span className="truncate">{r.url}</span>
                <span>{formatBytes(r.sizeBytes)}</span>
              </div>
            ))}
            {diff.resources.removed.slice(0, 10).map((r, i) => (
              <div key={i} className="diff-row diff-removed">
                <span className="resource-kind">{r.kind}</span>
                <span className="truncate">{r.url}</span>
              </div>
            ))}
            {diff.resources.changed.slice(0, 10).map((r, i) => (
              <div key={i} className="diff-row diff-changed">
                <span className="resource-kind">{r.kind}</span>
                <span className="truncate">{r.url}</span>
                <span>{formatBytes(r.sizeBytesA ?? 0)} → {formatBytes(r.sizeBytesB)}</span>
              </div>
            ))}
          </div>

          <div className="diff-block">
            <h3>Производительность</h3>
            {(["ttfb", "fcp", "lcp"] as const).map((key) => {
              const delta = deltaPerf(key);
              return (
                <div key={key} className="diff-row">
                  <strong>{key.toUpperCase()}</strong>
                  <span>{formatMs(diff.performance.a?.[key] ?? null)}</span>
                  <span>→</span>
                  <span>{formatMs(diff.performance.b?.[key] ?? null)}</span>
                  {delta !== null && (
                    <span className={delta > 0 ? "diff-removed" : "diff-added"}>
                      {delta > 0 ? "+" : ""}{Math.round(delta)} ms
                    </span>
                  )}
                </div>
              );
            })}
            <h3>Безопасность</h3>
            <div className="diff-row">
              <strong>Score</strong>
              <span>{diff.security.scoreA ?? "—"}</span>
              <span>→</span>
              <span>{diff.security.scoreB ?? "—"}</span>
            </div>
            <h3>Секреты</h3>
            <div className="diff-row">
              <strong>Найдено</strong>
              <span>{diff.secrets.countA}</span>
              <span>→</span>
              <span className={diff.secrets.countB > diff.secrets.countA ? "diff-removed" : "diff-added"}>
                {diff.secrets.countB}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [url, setUrl] = useState("https://example.com");
  const [maxActions, setMaxActions] = useState(20);
  const [timeoutMs, setTimeoutMs] = useState(45000);
  const [activeJob, setActiveJob] = useState<JobResponse | null>(null);
  const [recentScans, setRecentScans] = useState<ScanListItem[]>([]);
  const [selectedScan, setSelectedScan] = useState<ScanDetail | null>(null);
  const [selectedResource, setSelectedResource] = useState<ScanResource | null>(null);
  const [resourcePreview, setResourcePreview] = useState<string>("");
  const [resourceSearch, setResourceSearch] = useState("");
  const [resourceKindFilter, setResourceKindFilter] = useState("all");
  const [loadingScans, setLoadingScans] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [resourcePreviewLoading, setResourcePreviewLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState("https://example.com");
  const [activeTab, setActiveTab] = useState<ActiveTab>("overview");
  const [sourceSelectedFile, setSourceSelectedFile] = useState<string | null>(null);
  const [sourceFileContent, setSourceFileContent] = useState<string>("");
  const [sourceFileLoading, setSourceFileLoading] = useState(false);
  const [diffResult, setDiffResult] = useState<DiffResult | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [compareTargetId, setCompareTargetId] = useState<string>("");

  async function loadRecentScans(preselectScanId?: string) {
    setLoadingScans(true);
    try {
      const data = await apiRequest<{ items: ScanListItem[] }>("/api/scans?limit=20");
      setRecentScans(data.items);
      if (preselectScanId) {
        await loadScanDetail(preselectScanId);
      } else if (!selectedScan && data.items[0]) {
        await loadScanDetail(data.items[0].scanId);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingScans(false);
    }
  }

  async function loadScanDetail(scanId: string) {
    setLoadingDetail(true);
    setError(null);
    setActiveTab("overview");
    setDiffResult(null);
    try {
      const detail = await apiRequest<ScanDetail>(`/api/scans/${scanId}`);
      setSelectedScan(detail);
      setSelectedResource(pickDefaultResource(detail.resources));
      setPreviewUrl(detail.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingDetail(false);
    }
  }

  async function runCapture(config?: any) {
    setSubmitting(true);
    setError(null);

    const captureConfig = config || {
      url,
      maxActionsPerPage: maxActions,
      timeoutMs
    };

    setPreviewUrl(captureConfig.url);
    try {
      const job = await apiRequest<JobResponse>("/api/capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(captureConfig),
      });
      setActiveJob(job);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  async function loadDiff() {
    if (!selectedScan || !compareTargetId) return;
    setDiffLoading(true);
    try {
      const result = await apiRequest<DiffResult>(
        `/api/scans/diff?a=${selectedScan.scanId}&b=${compareTargetId}`
      );
      setDiffResult(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDiffLoading(false);
    }
  }

  async function loadSourceFile(filePath: string) {
    if (!selectedScan) return;
    setSourceSelectedFile(filePath);
    setSourceFileLoading(true);
    try {
      const storageUrl = `/storage/scans/${selectedScan.scanFolder}/analysis/sources/${filePath}`;
      const response = await fetch(`${API_BASE}${storageUrl}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      setSourceFileContent(text.slice(0, 100000));
    } catch (e) {
      setSourceFileContent(`// Не удалось загрузить файл: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSourceFileLoading(false);
    }
  }

  useEffect(() => { void loadRecentScans(); }, []);

  useEffect(() => {
    if (!activeJob || !["queued", "running"].includes(activeJob.status)) return;
    const currentJobId = activeJob.jobId;
    let cancelled = false;

    async function pollJob() {
      try {
        const nextJob = await apiRequest<JobResponse>(`/api/jobs/${currentJobId}`);
        if (cancelled) return;
        setActiveJob(nextJob);
        if (nextJob.status === "completed" && nextJob.result?.scanId) {
          await loadRecentScans(nextJob.result.scanId);
        }
        if (nextJob.status === "failed") {
          setError(nextJob.error || "Capture job failed");
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    }

    void pollJob();
    const id = window.setInterval(() => { void pollJob(); }, 2000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [activeJob?.jobId, activeJob?.status]);

  useEffect(() => {
    if (!selectedResource || !PREVIEWABLE_KINDS.has(selectedResource.kind)) {
      setResourcePreviewLoading(false);
      setResourcePreview("");
      return;
    }

    const previewPath = selectedResource.prettyUrl || selectedResource.storageUrl;
    const controller = new AbortController();

    async function loadPreview() {
      setResourcePreviewLoading(true);
      try {
        const response = await fetch(`${API_BASE}${previewPath}`, { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const text = await response.text();
        setResourcePreview(text.slice(0, 80000));
      } catch (e) {
        if (!controller.signal.aborted) {
          setResourcePreview(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!controller.signal.aborted) setResourcePreviewLoading(false);
      }
    }

    void loadPreview();
    return () => { controller.abort(); };
  }, [selectedResource]);

  const filteredResources = (selectedScan?.resources || []).filter((r) => {
    const matchesKind = resourceKindFilter === "all" || r.kind === resourceKindFilter;
    const haystack = `${r.url} ${r.localPath} ${r.mime}`.toLowerCase();
    return matchesKind && haystack.includes(resourceSearch.toLowerCase());
  });

  const availableKinds = Array.from(new Set((selectedScan?.resources || []).map((r) => r.kind))).sort();
  const failedNetworkEntries = (selectedScan?.network || []).filter(
    (e) => e.failure || (e.status ?? 0) >= 400
  );

  const sourceAllPaths = (selectedScan?.analysis?.sourceMaps || [])
    .flatMap((sm) => sm.sources)
    .filter((p) => !p.startsWith("node_modules/"));
  const sourceTree = buildTree(sourceAllPaths);
  const hasSourceContent = (selectedScan?.analysis?.sourceMaps || []).some((sm) => sm.hasContent);

  const compareOptions = recentScans.filter((s) => s.scanId !== selectedScan?.scanId);

  return (
    <main className="shell">
      {/* Hero */}
      <section className="hero panel">
        <div className="hero-copy">
          <p className="eyebrow">Internal QA Browser</p>
          <h1>Панель для захвата и анализа фронтенда</h1>
          <p className="lead">
            Controlled Chromium-сессия на сервере — захват HTML, CSS, JS, assets, source maps,
            метрик производительности, анализа безопасности и истории взаимодействий.
          </p>
        </div>
        <div className="hero-status">
          <div className="status-card">
            <span>API</span>
            <strong>{API_BASE}</strong>
          </div>
          <div className="status-card">
            <span>Сканов</span>
            <strong>{recentScans.length}</strong>
          </div>
          <div className="status-card accent">
            <span>Очередь</span>
            <strong>{activeJob ? activeJob.status : "idle"}</strong>
          </div>
        </div>
      </section>

      <section className="workspace">
        {/* Sidebar */}
        <aside className="sidebar panel">
          <div className="sidebar-header">
            <div>
              <p className="eyebrow">Launch</p>
              <h2>Новый захват</h2>
            </div>
            <button type="button" className="secondary-button" onClick={() => void loadRecentScans()}>
              ↺ Обновить
            </button>
          </div>

          <CaptureConfig onCapture={runCapture} />

          {activeJob ? (
            <div className="job-card">
              <p className="eyebrow">Current Job</p>
              <strong>{activeJob.status}</strong>
              <span>{activeJob.url}</span>
              <span>ID: {activeJob.jobId}</span>
              {activeJob.error ? <span className="danger-text">{activeJob.error}</span> : null}
            </div>
          ) : null}

          <div className="sidebar-header compact">
            <div>
              <p className="eyebrow">History</p>
              <h2>Сканы</h2>
            </div>
          </div>

          <div className="history-list">
            {loadingScans ? <p className="muted">Загрузка...</p> : null}
            {!loadingScans && recentScans.length === 0 ? (
              <p className="muted">Нет сохранённых сканов.</p>
            ) : null}
            {recentScans.map((scan) => (
              <button
                type="button"
                key={scan.scanId}
                className={`history-item ${selectedScan?.scanId === scan.scanId ? "active" : ""}`}
                onClick={() => void loadScanDetail(scan.scanId)}
              >
                <span className="history-url">{scan.url}</span>
                <span className="muted">{formatDateTime(scan.finishedAt)}</span>
                {scan.analysis?.security?.score !== undefined && (
                  <span className={`score-mini ${securityScoreColor(scan.analysis.security.score)}`}>
                    S:{scan.analysis.security.score}
                  </span>
                )}
              </button>
            ))}
          </div>
        </aside>

        {/* Main column */}
        <section className="main-column">
          {/* Preview panel */}
          <div className="panel preview-panel">
            <div className="section-header">
              <div>
                <p className="eyebrow">Target View</p>
                <h2>Предпросмотр цели</h2>
              </div>
              <a className="link-chip" href={previewUrl} target="_blank" rel="noreferrer">
                Открыть сайт отдельно ↗
              </a>
            </div>
            <div className="browser-chrome">
              <span className="dot red" />
              <span className="dot amber" />
              <span className="dot green" />
              <div className="address-bar">{previewUrl}</div>
            </div>
            <iframe key={previewUrl} className="preview-frame" src={previewUrl} title="Target preview" />
            <p className="muted">
              Если сайт блокирует iframe через X-Frame-Options или CSP — захват всё равно отработает
              на backend через Playwright.
            </p>
          </div>

          {error ? <section className="panel error-banner">{error}</section> : null}
          {loadingDetail ? <section className="panel loading-panel">Загрузка деталей скана...</section> : null}

          {selectedScan ? (
            <>
              {/* Scan header */}
              <section className="panel scan-header-panel">
                <div className="section-header">
                  <div>
                    <p className="eyebrow">Скан</p>
                    <h2>{selectedScan.scanId}</h2>
                    <p className="muted">{selectedScan.url}</p>
                  </div>
                  <div className="scan-header-actions">
                    <a className="primary-link" href={`${API_BASE}${selectedScan.downloadUrl}`}
                      target="_blank" rel="noreferrer">
                      ↓ ZIP
                    </a>
                  </div>
                </div>

                {/* Diff controls */}
                <div className="diff-controls">
                  <select
                    title="Выбрать скан для сравнения"
                    value={compareTargetId}
                    onChange={(e) => setCompareTargetId(e.target.value)}
                  >
                    <option value="">Сравнить с другим сканом...</option>
                    {compareOptions.map((s) => (
                      <option key={s.scanId} value={s.scanId}>
                        {s.url} — {formatDateTime(s.finishedAt)}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={!compareTargetId || diffLoading}
                    onClick={() => void loadDiff()}
                  >
                    {diffLoading ? "Сравниваем..." : "Показать diff"}
                  </button>
                </div>

                {/* Tabs */}
                <div className="tab-bar">
                  {(["overview", "resources", "network", "analysis", "sources"] as ActiveTab[]).map((tab) => {
                    const labels: Record<ActiveTab, string> = {
                      overview: "Обзор",
                      resources: `Ресурсы (${selectedScan.resources.length})`,
                      network: `Сеть (${selectedScan.network.length})`,
                      analysis: "Анализ",
                      sources: `Исходники (${sourceAllPaths.length})`,
                    };
                    return (
                      <button
                        type="button"
                        key={tab}
                        className={`tab-btn ${activeTab === tab ? "active" : ""}`}
                        onClick={() => setActiveTab(tab)}
                      >
                        {labels[tab]}
                        {tab === "analysis" && (selectedScan.analysis?.secrets?.length ?? 0) > 0 && (
                          <span className="tab-alert">!</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </section>

              {/* ── Tab: Overview ── */}
              {activeTab === "overview" && (
                <>
                  <section className="panel">
                    <div className="meta-line">
                      <span>Старт: {formatDateTime(selectedScan.startedAt)}</span>
                      <span>Финиш: {formatDateTime(selectedScan.finishedAt)}</span>
                    </div>
                    <div className="metrics-grid">
                      <article className="metric-card"><span>JS</span><strong>{selectedScan.summary.jsFiles}</strong></article>
                      <article className="metric-card"><span>CSS</span><strong>{selectedScan.summary.cssFiles}</strong></article>
                      <article className="metric-card"><span>Source maps</span><strong>{selectedScan.summary.sourcemapsFound}</strong></article>
                      <article className="metric-card"><span>Размер</span><strong>{formatBytes(selectedScan.summary.totalSizeBytes)}</strong></article>
                      <article className="metric-card"><span>Requests</span><strong>{selectedScan.summary.totalRequests}</strong></article>
                      <article className="metric-card"><span>Ошибки</span><strong>{selectedScan.summary.failedRequests}</strong></article>
                      <article className="metric-card"><span>Console</span><strong>{selectedScan.summary.consoleErrors}</strong></article>
                      {selectedScan.analysis && (
                        <article className={`metric-card ${securityScoreColor(selectedScan.analysis.security.score)}`}>
                          <span>Security</span>
                          <strong>{selectedScan.analysis.security.score}/100</strong>
                        </article>
                      )}
                    </div>

                    {/* Screenshots */}
                    <div className="artifact-grid">
                      {selectedScan.artifacts.screenshotDesktopUrl && (
                        <a className="shot-card" href={`${API_BASE}${selectedScan.artifacts.screenshotDesktopUrl}`}
                          target="_blank" rel="noreferrer">
                          <img src={`${API_BASE}${selectedScan.artifacts.screenshotDesktopUrl}`} alt="Desktop" />
                          <span>Desktop 1440px</span>
                        </a>
                      )}
                      {selectedScan.artifacts.screenshotMobileUrl && (
                        <a className="shot-card" href={`${API_BASE}${selectedScan.artifacts.screenshotMobileUrl}`}
                          target="_blank" rel="noreferrer">
                          <img src={`${API_BASE}${selectedScan.artifacts.screenshotMobileUrl}`} alt="Mobile" />
                          <span>Mobile 375px</span>
                        </a>
                      )}
                      {selectedScan.artifacts.screenshotFullPageUrl && (
                        <a className="shot-card" href={`${API_BASE}${selectedScan.artifacts.screenshotFullPageUrl}`}
                          target="_blank" rel="noreferrer">
                          <img src={`${API_BASE}${selectedScan.artifacts.screenshotFullPageUrl}`} alt="Full page" />
                          <span>Full page</span>
                        </a>
                      )}
                    </div>

                    <div className="link-row">
                      <a href={`${API_BASE}${selectedScan.artifacts.initialHtmlUrl}`} target="_blank" rel="noreferrer">Initial DOM</a>
                      <a href={`${API_BASE}${selectedScan.artifacts.finalDomUrl}`} target="_blank" rel="noreferrer">Final DOM</a>
                      <a href={`${API_BASE}${selectedScan.artifacts.consoleUrl}`} target="_blank" rel="noreferrer">Console Log</a>
                      <a href={`${API_BASE}${selectedScan.artifacts.networkUrl}`} target="_blank" rel="noreferrer">Network Log</a>
                      <a href={`${API_BASE}${selectedScan.artifacts.manifestUrl}`} target="_blank" rel="noreferrer">Manifest</a>
                      {selectedScan.artifacts.analysisUrl && (
                        <a href={`${API_BASE}${selectedScan.artifacts.analysisUrl}`} target="_blank" rel="noreferrer">Analysis JSON</a>
                      )}
                    </div>
                  </section>

                  <section className="triple-section">
                    <div className="panel">
                      <div className="section-header">
                        <div><p className="eyebrow">External</p><h2>Внешние домены</h2></div>
                        <span className="pill">{selectedScan.summary.externalDomains.length}</span>
                      </div>
                      <div className="tag-grid">
                        {selectedScan.summary.externalDomains.length === 0 ? (
                          <p className="muted">Нет.</p>
                        ) : (
                          selectedScan.summary.externalDomains.map((d) => (
                            <span key={d} className="tag">{d}</span>
                          ))
                        )}
                      </div>
                    </div>

                    <div className="panel">
                      <div className="section-header">
                        <div><p className="eyebrow">Interactions</p><h2>Действия</h2></div>
                        <span className="pill">{selectedScan.interactions.length}</span>
                      </div>
                      <div className="list-block">
                        {selectedScan.interactions.slice(0, 20).map((item) => (
                          <div key={item.id} className="list-row">
                            <strong>{item.label}</strong>
                            <span>{item.type}</span>
                            <span className={`status status-${item.status}`}>{item.status}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="panel">
                      <div className="section-header">
                        <div><p className="eyebrow">Network</p><h2>Ошибки сети</h2></div>
                        <span className="pill">{failedNetworkEntries.length}</span>
                      </div>
                      <div className="list-block">
                        {failedNetworkEntries.length === 0 ? (
                          <p className="muted">Ошибок нет.</p>
                        ) : (
                          failedNetworkEntries.slice(0, 15).map((item, i) => (
                            <div key={`${item.url}_${i}`} className="list-row">
                              <strong>{item.status || "ERR"}</strong>
                              <span>{item.method}</span>
                              <span className="truncate">{item.url}</span>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </section>
                </>
              )}

              {/* ── Tab: Resources ── */}
              {activeTab === "resources" && (
                <section className="dual-section">
                  <div className="panel resources-panel">
                    <div className="section-header">
                      <div><p className="eyebrow">Captured Files</p><h2>Ресурсы</h2></div>
                      <span className="pill">{filteredResources.length}</span>
                    </div>
                    <div className="filters">
                      <input value={resourceSearch}
                        onChange={(e) => setResourceSearch(e.target.value)}
                        placeholder="Поиск по URL, mime, пути..." />
                      <select
                        title="Фильтр по типу ресурса"
                        value={resourceKindFilter}
                        onChange={(e) => setResourceKindFilter(e.target.value)}>
                        <option value="all">Все типы</option>
                        {availableKinds.map((k) => (
                          <option key={k} value={k}>{k}</option>
                        ))}
                      </select>
                    </div>
                    <div className="resource-table">
                      {filteredResources.map((r) => (
                        <button
                          type="button"
                          key={r.id}
                          className={`resource-row ${selectedResource?.id === r.id ? "active" : ""}`}
                          onClick={() => setSelectedResource(r)}
                        >
                          <span className="resource-kind">{r.kind}</span>
                          <span className="resource-main">
                            <strong>{r.localPath.split(/[\\/]/).pop()}</strong>
                            <small className="truncate">{r.url}</small>
                          </span>
                          <span className="resource-meta">{r.status} · {formatBytes(r.sizeBytes)}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="panel inspector-panel">
                    <div className="section-header">
                      <div>
                        <p className="eyebrow">Inspector</p>
                        <h2>{selectedResource?.id || "Ресурс не выбран"}</h2>
                      </div>
                      {selectedResource && (
                        <div className="link-row compact">
                          <a href={`${API_BASE}${selectedResource.storageUrl}`} target="_blank" rel="noreferrer">Original</a>
                          {selectedResource.prettyUrl && (
                            <a href={`${API_BASE}${selectedResource.prettyUrl}`} target="_blank" rel="noreferrer">Pretty</a>
                          )}
                        </div>
                      )}
                    </div>

                    {selectedResource ? (
                      <>
                        <div className="resource-facts">
                          <span>{selectedResource.mime || "unknown"}</span>
                          <span>{selectedResource.domain}</span>
                          <span>{selectedResource.sha256.slice(0, 16)}…</span>
                          {selectedResource.fromCache && <span className="tag">from cache</span>}
                        </div>

                        {selectedResource.kind === "image" ? (
                          <img className="image-preview"
                            src={`${API_BASE}${selectedResource.storageUrl}`}
                            alt={selectedResource.localPath} />
                        ) : null}

                        {PREVIEWABLE_KINDS.has(selectedResource.kind) ? (
                          resourcePreviewLoading ? (
                            <div className="loading-panel">Загрузка preview...</div>
                          ) : (
                            <HighlightedCode code={resourcePreview} lang={hljsLang(selectedResource.kind)} />
                          )
                        ) : null}

                        {!PREVIEWABLE_KINDS.has(selectedResource.kind) && selectedResource.kind !== "image" ? (
                          <div className="empty-preview">
                            Для типа <strong>{selectedResource.kind}</strong> встроенный preview недоступен.
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <div className="empty-preview">Выбери ресурс из списка слева.</div>
                    )}
                  </div>
                </section>
              )}

              {/* ── Tab: Network ── */}
              {activeTab === "network" && (
                <section className="panel">
                  <div className="section-header">
                    <div><p className="eyebrow">Network Log</p><h2>Все запросы</h2></div>
                    <span className="pill">{selectedScan.network.length}</span>
                  </div>

                  {selectedScan.analysis?.apiEndpoints && selectedScan.analysis.apiEndpoints.length > 0 && (
                    <EndpointsPanel endpoints={selectedScan.analysis.apiEndpoints} />
                  )}

                  <div className="network-table">
                    <div className="network-header-row">
                      <span>Статус</span>
                      <span>Метод</span>
                      <span>Тип</span>
                      <span>URL</span>
                    </div>
                    {selectedScan.network.map((entry, i) => (
                      <div
                        key={`${entry.url}_${i}`}
                        className={`network-row ${entry.failure || (entry.status ?? 0) >= 400 ? "network-error" : ""}`}
                      >
                        <span className="status-code">{entry.status ?? "—"}</span>
                        <span className={`method-badge method-${entry.method.toLowerCase()}`}>{entry.method}</span>
                        <span className="resource-kind">{entry.resourceType || "—"}</span>
                        <span className="truncate network-url" title={entry.url}>{entry.url}</span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* ── Tab: Analysis ── */}
              {activeTab === "analysis" && (
                <section className="panel analysis-panel">
                  {selectedScan.analysis ? (
                    <>
                      <PerformancePanel perf={selectedScan.analysis.performance} />
                      <SecurityPanel sec={selectedScan.analysis.security} />
                      <FrameworksPanel frameworks={selectedScan.analysis.frameworks} />
                      <SecretsPanel secrets={selectedScan.analysis.secrets} />
                    </>
                  ) : (
                    <div className="empty-preview">
                      Данные анализа недоступны. Скан выполнен до обновления инструмента или анализ не завершился.
                    </div>
                  )}
                </section>
              )}

              {/* ── Tab: Sources ── */}
              {activeTab === "sources" && (
                <section className="dual-section">
                  <div className="panel sources-tree-panel">
                    <div className="section-header">
                      <div><p className="eyebrow">Source Maps</p><h2>Исходные файлы</h2></div>
                      <span className="pill">{sourceAllPaths.length}</span>
                    </div>

                    {sourceAllPaths.length === 0 ? (
                      <div className="empty-preview">
                        Source maps не обнаружены. Сайт может отдавать бандлы без карт или они были исключены из
                        захвата.
                      </div>
                    ) : !hasSourceContent ? (
                      <div className="empty-preview">
                        Source maps найдены ({selectedScan.analysis?.sourceMaps.length}), но оригинальный код в них
                        не включён (sourcesContent отсутствует).
                        <div className="tag-grid sources-tag-list">
                          {sourceAllPaths.slice(0, 50).map((p) => (
                            <span key={p} className="tag">{p.split("/").pop()}</span>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="source-tree">
                        {sourceTree.map((node) => (
                          <TreeNodeView
                            key={node.path}
                            node={node}
                            selected={sourceSelectedFile}
                            onSelect={(path) => void loadSourceFile(path)}
                            depth={0}
                          />
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="panel inspector-panel">
                    <div className="section-header">
                      <div>
                        <p className="eyebrow">Source viewer</p>
                        <h2>{sourceSelectedFile ? sourceSelectedFile.split("/").pop() : "Файл не выбран"}</h2>
                      </div>
                    </div>
                    {sourceSelectedFile ? (
                      sourceFileLoading ? (
                        <div className="loading-panel">Загрузка файла...</div>
                      ) : (
                        <HighlightedCode
                          code={sourceFileContent}
                          lang={
                            sourceSelectedFile.endsWith(".ts") || sourceSelectedFile.endsWith(".tsx") ? "typescript" :
                            sourceSelectedFile.endsWith(".css") || sourceSelectedFile.endsWith(".scss") ? "css" :
                            sourceSelectedFile.endsWith(".json") ? "json" :
                            "javascript"
                          }
                        />
                      )
                    ) : (
                      <div className="empty-preview">Выбери файл из дерева слева.</div>
                    )}
                  </div>
                </section>
              )}
            </>
          ) : (
            <section className="panel empty-state">
              Создай новый захват или выбери скан из истории.
            </section>
          )}
        </section>
      </section>

      {/* Diff overlay */}
      {diffResult && (
        <DiffOverlay diff={diffResult} onClose={() => setDiffResult(null)} />
      )}
    </main>
  );
}
