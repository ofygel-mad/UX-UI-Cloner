// ─── Constants ────────────────────────────────────────────────────────────────

const PREVIEWABLE_KINDS = new Set(["html", "css", "js", "json", "svg", "map"]);
const ARTIFACTS = [
  ["manifest",    "Manifest",      "artifacts.manifestUrl"],
  ["analysis",    "Analysis",      "artifacts.analysisUrl"],
  ["initialDom",  "Initial DOM",   "artifacts.initialHtmlUrl"],
  ["finalDom",    "Final DOM",     "artifacts.finalDomUrl"],
  ["console",     "Console",       "artifacts.consoleUrl"],
  ["network",     "Network",       "artifacts.networkUrl"],
  ["cookies",     "Cookies",       "artifacts.cookiesUrl"],
  ["storage",     "Local Storage", "artifacts.localStorageUrl"],
];
const STORAGE_KEY = "fcb.desktop.state.v4";

// ─── State ────────────────────────────────────────────────────────────────────

const state = {
  apiBase: "",
  runtime: null,
  tabs: [],
  activeTabId: null,
  scans: [],
  selectedScan: null,
  selectedResource: null,
  selectedArtifactKey: "manifest",
  selectedArtifactUrl: null,
  resourceSearch: "",
  resourceKind: "all",
  reuseCapturedSession: true,
  currentJob: null,
  jobTimer: null,
  sourceSelectedFile: null,
};

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const el = {
  runtimeBadge:         document.getElementById("runtime-badge"),
  apiBaseInput:         document.getElementById("api-base-input"),
  captureUrlInput:      document.getElementById("capture-url-input"),
  captureSessionInput:  document.getElementById("capture-session-input"),
  safeActionsInput:     document.getElementById("safe-actions-input"),
  timeoutInput:         document.getElementById("timeout-input"),
  captureButton:        document.getElementById("capture-button"),
  refreshScansButton:   document.getElementById("refresh-scans-button"),
  jobStatusCard:        document.getElementById("job-status-card"),
  scanList:             document.getElementById("scan-list"),
  scanCountBadge:       document.getElementById("scan-count-badge"),
  tabList:              document.getElementById("tab-list"),
  browserStack:         document.getElementById("browser-stack"),
  newTabButton:         document.getElementById("new-tab-button"),
  backButton:           document.getElementById("back-button"),
  forwardButton:        document.getElementById("forward-button"),
  reloadButton:         document.getElementById("reload-button"),
  addressInput:         document.getElementById("address-input"),
  goButton:             document.getElementById("go-button"),
  activeTabMeta:        document.getElementById("active-tab-meta"),
  scanTitle:            document.getElementById("scan-title"),
  securityScoreBadge:   document.getElementById("security-score-badge"),
  summaryMetrics:       document.getElementById("summary-metrics"),
  screenshotsGrid:      document.getElementById("screenshots-grid"),
  downloadZipButton:    document.getElementById("download-zip-button"),
  openScanButton:       document.getElementById("open-scan-button"),
  exportReportButton:   document.getElementById("export-report-button"),
  resourceCountBadge:   document.getElementById("resource-count-badge"),
  resourceSearchInput:  document.getElementById("resource-search-input"),
  resourceKindSelect:   document.getElementById("resource-kind-select"),
  resourceList:         document.getElementById("resource-list"),
  resourceTitle:        document.getElementById("resource-title"),
  resourceMeta:         document.getElementById("resource-meta"),
  resourcePreview:      document.getElementById("resource-preview"),
  openResourceButton:   document.getElementById("open-resource-button"),
  openPrettyButton:     document.getElementById("open-pretty-button"),
  artifactTabList:      document.getElementById("artifact-tab-list"),
  artifactPreview:      document.getElementById("artifact-preview"),
  openArtifactButton:   document.getElementById("open-artifact-button"),
  netErrorCount:        document.getElementById("net-error-count"),
  interactionCount:     document.getElementById("interaction-count"),
  networkErrorList:     document.getElementById("network-error-list"),
  interactionList:      document.getElementById("interaction-list"),
  // Analysis
  analysisEmpty:        document.getElementById("analysis-empty"),
  analysisScoreChip:    document.getElementById("analysis-score-chip"),
  secretsAlertChip:     document.getElementById("secrets-alert-chip"),
  perfGrid:             document.getElementById("perf-grid"),
  secScoreInline:       document.getElementById("sec-score-inline"),
  securityList:         document.getElementById("security-list"),
  frameworkList:        document.getElementById("framework-list"),
  secretsList:          document.getElementById("secrets-list"),
  endpointsList:        document.getElementById("endpoints-list"),
  sourcemapCountBadge:  document.getElementById("sourcemap-count-badge"),
  sourceTree:           document.getElementById("source-tree"),
  sourceViewer:         document.getElementById("source-viewer"),
};

// ─── Persistence ──────────────────────────────────────────────────────────────

function saveState() {
  const persisted = {
    tabs: state.tabs.map((t) => ({ id: t.id, title: t.title, url: t.url })),
    activeTabId: state.activeTabId,
    selectedScanId: state.selectedScan?.scanId || null,
    selectedResourceId: state.selectedResource?.id || null,
    selectedArtifactKey: state.selectedArtifactKey,
    resourceSearch: state.resourceSearch,
    resourceKind: state.resourceKind,
    reuseCapturedSession: el.captureSessionInput.checked,
    safeActions: el.safeActionsInput.value,
    timeoutMs: el.timeoutInput.value,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
}

function loadPersistedState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

// ─── Formatters ───────────────────────────────────────────────────────────────

function fmtBytes(b) {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1073741824) return `${(b / 1048576).toFixed(1)} MB`;
  return `${(b / 1073741824).toFixed(1)} GB`;
}

function fmtDate(v) {
  return new Date(v).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "medium" });
}

function fmtMs(ms) {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function normalizeUrl(input) {
  const s = String(input || "").trim();
  if (!s) return "https://example.com";
  if (/^https?:\/\//i.test(s)) return s;
  return `https://${s}`;
}

// ─── API ──────────────────────────────────────────────────────────────────────

async function apiRequest(pathname, init) {
  const response = await fetch(`${state.apiBase}${pathname}`, init);
  const ct = response.headers.get("content-type") || "";
  const payload = ct.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) {
    const msg = typeof payload === "string" ? payload
      : payload?.error ? String(payload.error) : "Request failed";
    throw new Error(msg);
  }
  return payload;
}

async function fetchArtifactText(url) {
  const response = await fetch(`${state.apiBase}${url}`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const text = await response.text();
  try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return text; }
}

// ─── Job status card ──────────────────────────────────────────────────────────

function setJobCard(html, mode = "info") {
  el.jobStatusCard.className = `job-card ${mode}`;
  el.jobStatusCard.classList.remove("hidden");
  el.jobStatusCard.innerHTML = html;
}

function clearJobCard() {
  el.jobStatusCard.className = "job-card hidden";
  el.jobStatusCard.innerHTML = "";
}

// ─── Browser tabs ─────────────────────────────────────────────────────────────

function getActiveTab() {
  return state.tabs.find((t) => t.id === state.activeTabId) || null;
}

function renderActiveTabMeta() {
  const tab = getActiveTab();

  if (!tab) {
    el.activeTabMeta.textContent = "No active tab yet.";
    return;
  }

  const reuseMode = el.captureSessionInput.checked
    ? "capture will reuse current auth session"
    : "capture will start with a clean Playwright session";

  el.activeTabMeta.textContent = `${tab.url} | ${reuseMode}`;
}

async function collectActiveTabSession(tab) {
  const sourceUrl = normalizeUrl(tab?.url || el.captureUrlInput.value);
  const [session, storageBucket] = await Promise.all([
    window.desktopAPI.extractTabSession({
      webContentsId: tab.webview.getWebContentsId(),
      sourceUrl,
    }),
    tab.webview.executeJavaScript(
      `(() => {
        const dumpStorage = (store) => {
          const output = {};
          for (let index = 0; index < store.length; index += 1) {
            const key = store.key(index);
            if (key) {
              output[key] = store.getItem(key) ?? "";
            }
          }
          return output;
        };

        return {
          origin: window.location.origin,
          localStorage: dumpStorage(window.localStorage),
          sessionStorage: dumpStorage(window.sessionStorage)
        };
      })()`,
      true
    )
  ]);

  return {
    ...session,
    storages: storageBucket?.origin ? [storageBucket] : []
  };
}

function createTab(initialUrl = "https://example.com", restoredId = null, restoredTitle = null) {
  const tabId = restoredId || `tab_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const webview = document.createElement("webview");
  webview.className = "browser-view";
  webview.src = normalizeUrl(initialUrl);
  webview.setAttribute("allowpopups", "true");
  webview.setAttribute("webpreferences", "contextIsolation=yes");

  const tab = {
    id: tabId,
    title: restoredTitle || "New tab",
    url: normalizeUrl(initialUrl),
    loading: true,
    canGoBack: false,
    canGoForward: false,
    webview,
  };

  webview.addEventListener("did-start-loading", () => {
    tab.loading = true;
    renderTabs();
    renderActiveTabMeta();
  });
  webview.addEventListener("did-stop-loading", () => {
    tab.loading = false;
    tab.url = webview.getURL() || tab.url;
    tab.canGoBack = webview.canGoBack();
    tab.canGoForward = webview.canGoForward();
    tab.title = webview.getTitle() || tab.title;
    if (state.activeTabId === tab.id) {
      el.addressInput.value = tab.url;
      el.captureUrlInput.value = tab.url;
      updateNavButtons();
    }
    saveState();
    renderTabs();
    renderActiveTabMeta();
  });

  webview.addEventListener("page-title-updated", (e) => {
    tab.title = e.title || tab.title;
    saveState();
    renderTabs();
    renderActiveTabMeta();
  });
  webview.addEventListener("did-navigate", (e) => {
    tab.url = e.url;
    if (state.activeTabId === tab.id) { el.addressInput.value = e.url; el.captureUrlInput.value = e.url; }
    saveState();
    renderTabs();
    renderActiveTabMeta();
  });
  webview.addEventListener("did-navigate-in-page", (e) => {
    tab.url = e.url;
    if (state.activeTabId === tab.id) { el.addressInput.value = e.url; el.captureUrlInput.value = e.url; }
    saveState();
    renderTabs();
    renderActiveTabMeta();
  });
  webview.addEventListener("new-window", (e) => { e.preventDefault(); createTab(e.url); });

  state.tabs.push(tab);
  el.browserStack.appendChild(webview);
  setActiveTab(tab.id);
}

function removeTab(tabId) {
  if (state.tabs.length === 1) return;
  const idx = state.tabs.findIndex((t) => t.id === tabId);
  if (idx === -1) return;
  const [tab] = state.tabs.splice(idx, 1);
  tab.webview.remove();
  if (state.activeTabId === tabId) {
    setActiveTab((state.tabs[Math.max(0, idx - 1)] || state.tabs[0]).id);
  } else { renderTabs(); saveState(); }
}

function setActiveTab(tabId) {
  state.activeTabId = tabId;
  for (const t of state.tabs) t.webview.classList.toggle("active", t.id === tabId);
  const active = getActiveTab();
  if (active) { el.addressInput.value = active.url; el.captureUrlInput.value = active.url; }
  updateNavButtons();
  renderActiveTabMeta();
  saveState();
  renderTabs();
}

function navigateCurrent() {
  const tab = getActiveTab();
  if (tab) tab.webview.loadURL(normalizeUrl(el.addressInput.value));
}

function updateNavButtons() {
  const tab = getActiveTab();
  el.backButton.disabled = !tab?.canGoBack;
  el.forwardButton.disabled = !tab?.canGoForward;
}

function renderTabs() {
  el.tabList.innerHTML = "";
  for (const tab of state.tabs) {
    const btn = document.createElement("button");
    btn.className = `tab-chip ${tab.id === state.activeTabId ? "active" : ""}`;
    btn.innerHTML = `<span class="tab-chip-title">${tab.loading ? "Loading..." : tab.title}</span><span class="tab-chip-close">x</span>`;
    btn.addEventListener("click", (e) => {
      if (e.target instanceof HTMLElement && e.target.classList.contains("tab-chip-close")) {
        removeTab(tab.id); return;
      }
      setActiveTab(tab.id);
    });
    el.tabList.appendChild(btn);
  }
}

// ─── Scans ────────────────────────────────────────────────────────────────────

async function loadScans(preselectScanId = null) {
  try {
    const data = await apiRequest("/api/scans?limit=30");
    state.scans = data.items || [];
    renderScanList();

    const persisted = loadPersistedState();
    const candidateId = preselectScanId || persisted?.selectedScanId;
    if (candidateId && state.scans.some((s) => s.scanId === candidateId)) {
      await selectScan(candidateId); return;
    }
    if (!state.selectedScan && state.scans[0]) await selectScan(state.scans[0].scanId);
  } catch (e) {
    setJobCard(`<strong>Failed to load scans</strong><span>${e.message}</span>`, "error");
  }
}

function renderScanList() {
  el.scanList.innerHTML = "";
  el.scanCountBadge.textContent = String(state.scans.length);
  if (state.scans.length === 0) {
    el.scanList.innerHTML = `<p class="muted">No stored scans yet.</p>`; return;
  }
  for (const scan of state.scans) {
    const score = scan.analysis?.security?.score;
    const scoreHtml = score !== undefined
      ? `<span class="scan-score ${scoreClass(score)}">S:${score}</span>` : "";
    const secretCount = scan.analysis?.secrets?.length || 0;
    const secretHtml = secretCount > 0
      ? `<span class="scan-secret-alert">⚠${secretCount}</span>` : "";
    const btn = document.createElement("button");
    btn.className = `scan-item ${state.selectedScan?.scanId === scan.scanId ? "active" : ""}`;
    btn.innerHTML = `
      <div class="scan-item-row">
        <strong class="scan-url">${scan.url}</strong>
        <div class="scan-badges">${scoreHtml}${secretHtml}</div>
      </div>
      <span class="scan-meta">${scan.scanId} · ${fmtDate(scan.finishedAt)}</span>
    `;
    btn.addEventListener("click", () => void selectScan(scan.scanId));
    el.scanList.appendChild(btn);
  }
}

async function selectScan(scanId) {
  try {
    const detail = await apiRequest(`/api/scans/${scanId}`);
    state.selectedScan = detail;
    state.selectedResource = null;
    state.sourceSelectedFile = null;
    state.selectedArtifactKey = loadPersistedState()?.selectedArtifactKey || "manifest";
    renderScanList();
    renderSelectedScan();
    renderAnalysis();
    renderSourceMaps();
    populateResourceKindOptions();
    renderResourceList();
    renderAuxiliaryLists();
    renderArtifactTabs();
    await loadSelectedArtifact();
    const persisted = loadPersistedState();
    const preferredId = persisted?.selectedResourceId;
    const initialResource = detail.resources.find((r) => r.id === preferredId) || detail.resources[0] || null;
    if (initialResource) await selectResource(initialResource.id); else await renderResourceInspector();
    saveState();
  } catch (e) {
    setJobCard(`<strong>Failed to load scan</strong><span>${e.message}</span>`, "error");
  }
}

// ─── Scan summary ─────────────────────────────────────────────────────────────

function scoreClass(score) {
  if (score >= 80) return "score-good";
  if (score >= 50) return "score-warn";
  return "score-bad";
}

function renderSelectedScan() {
  const scan = state.selectedScan;
  if (!scan) {
    el.scanTitle.textContent = "No scan selected";
    el.summaryMetrics.className = "metrics-grid metrics-grid-empty";
    el.summaryMetrics.innerHTML = `<p class="muted">Select a scan from history.</p>`;
    el.screenshotsGrid.innerHTML = "";
    el.downloadZipButton.disabled = true;
    el.openScanButton.disabled = true;
    el.exportReportButton.disabled = true;
    el.securityScoreBadge.className = "score-badge hidden";
    return;
  }

  el.scanTitle.textContent = scan.url;
  el.downloadZipButton.disabled = false;
  el.openScanButton.disabled = false;
  el.exportReportButton.disabled = false;

  el.downloadZipButton.onclick = () => void window.desktopAPI.openExternal(`${state.apiBase}${scan.downloadUrl}`);
  el.openScanButton.onclick = () => void window.desktopAPI.openExternal(`${state.apiBase}${scan.artifacts.resultUrl}`);
  el.exportReportButton.onclick = () => void exportHtmlReport();

  const score = scan.analysis?.security?.score;
  if (score !== undefined) {
    el.securityScoreBadge.textContent = `Security: ${score}/100`;
    el.securityScoreBadge.className = `score-badge ${scoreClass(score)}`;
  } else {
    el.securityScoreBadge.className = "score-badge hidden";
  }

  const s = scan.summary;
  el.summaryMetrics.className = "metrics-grid";
  el.summaryMetrics.innerHTML = `
    <div class="metric-card"><span>JS</span><strong>${s.jsFiles}</strong></div>
    <div class="metric-card"><span>CSS</span><strong>${s.cssFiles}</strong></div>
    <div class="metric-card"><span>Maps</span><strong>${s.sourcemapsFound}</strong></div>
    <div class="metric-card"><span>Requests</span><strong>${s.totalRequests}</strong></div>
    <div class="metric-card"><span>Failures</span><strong>${s.failedRequests}</strong></div>
    <div class="metric-card"><span>Console</span><strong>${s.consoleErrors}</strong></div>
    <div class="metric-card"><span>Payload</span><strong>${fmtBytes(s.totalSizeBytes)}</strong></div>
    ${score !== undefined ? `<div class="metric-card ${scoreClass(score)}"><span>Security</span><strong>${score}/100</strong></div>` : ""}
  `;

  el.screenshotsGrid.innerHTML = "";
  const shots = [
    ["Desktop 1440px", scan.artifacts.screenshotDesktopUrl],
    ["Mobile 375px",   scan.artifacts.screenshotMobileUrl],
    ["Full page",      scan.artifacts.screenshotFullPageUrl],
  ].filter(([, url]) => url);

  for (const [label, url] of shots) {
    const btn = document.createElement("button");
    btn.className = "screenshot-card";
    btn.innerHTML = `<img src="${state.apiBase}${url}" alt="${label}" loading="lazy" /><span>${label}</span>`;
    btn.addEventListener("click", () => void window.desktopAPI.openExternal(`${state.apiBase}${url}`));
    el.screenshotsGrid.appendChild(btn);
  }
}

// ─── Analysis panel ───────────────────────────────────────────────────────────

function perfColor(metric, val) {
  if (val === null || val === undefined) return "perf-unknown";
  const thresholds = {
    lcp:  [2500, 4000],
    fcp:  [1800, 3000],
    ttfb: [800,  1800],
    cls:  [0.1,  0.25],
    domContentLoaded: [2000, 4000],
    loadTime: [3000, 6000],
  };
  const [good, bad] = thresholds[metric] || [1000, 3000];
  if (val <= good) return "perf-good";
  if (val <= bad)  return "perf-warn";
  return "perf-bad";
}

function renderAnalysis() {
  const analysis = state.selectedScan?.analysis;

  if (!analysis) {
    el.analysisEmpty.classList.remove("hidden");
    el.analysisScoreChip.className = "score-badge hidden";
    el.secretsAlertChip.className = "secrets-alert hidden";
    el.perfGrid.innerHTML = "";
    el.securityList.innerHTML = "";
    el.frameworkList.innerHTML = "";
    el.secretsList.innerHTML = "";
    el.endpointsList.innerHTML = "";
    return;
  }

  el.analysisEmpty.classList.add("hidden");

  // Score chip
  const score = analysis.security?.score ?? 0;
  el.analysisScoreChip.textContent = `S:${score}/100`;
  el.analysisScoreChip.className = `score-badge ${scoreClass(score)}`;

  // Secrets alert
  const secretCount = analysis.secrets?.length || 0;
  if (secretCount > 0) {
    el.secretsAlertChip.textContent = `⚠ ${secretCount} секрет${secretCount === 1 ? "" : "ов"}`;
    el.secretsAlertChip.className = "secrets-alert";
  } else {
    el.secretsAlertChip.className = "secrets-alert hidden";
  }

  // ── Performance ──
  const perf = analysis.performance || {};
  const perfItems = [
    ["TTFB",       "ttfb",             fmtMs(perf.ttfb)],
    ["FCP",        "fcp",              fmtMs(perf.fcp)],
    ["LCP",        "lcp",              fmtMs(perf.lcp)],
    ["CLS",        "cls",              perf.cls !== null && perf.cls !== undefined ? perf.cls.toFixed(3) : "—"],
    ["DOM Ready",  "domContentLoaded", fmtMs(perf.domContentLoaded)],
    ["Load",       "loadTime",         fmtMs(perf.loadTime)],
  ];
  el.perfGrid.innerHTML = perfItems.map(([label, key, val]) => `
    <div class="perf-card ${perfColor(key, perf[key])}">
      <span class="perf-label">${label}</span>
      <strong class="perf-value">${val}</strong>
    </div>
  `).join("");

  // ── Security headers ──
  el.secScoreInline.textContent = `${score}/100`;
  el.secScoreInline.className = `score-badge-inline ${scoreClass(score)}`;

  const secHeaders = analysis.security?.headers || [];
  const mixedCount = analysis.security?.mixedContentCount || 0;

  el.securityList.innerHTML = [
    mixedCount > 0 ? `<div class="sec-warning">⚠ Mixed content: ${mixedCount} http-ресурсов на HTTPS странице</div>` : "",
    ...secHeaders
      .sort((a, b) => ({ critical: 0, warning: 1, info: 2 }[a.severity] - { critical: 0, warning: 1, info: 2 }[b.severity]))
      .map((h) => `
        <div class="security-row sev-${h.severity}">
          <span class="sec-icon ${h.present ? "sec-ok" : "sec-fail"}">${h.present ? "✓" : "✗"}</span>
          <div class="sec-info">
            <code>${h.header}</code>
            ${h.present && h.value
              ? `<span class="sec-value">${h.value.slice(0, 90)}${h.value.length > 90 ? "…" : ""}</span>`
              : `<span class="sec-rec">${h.recommendation}</span>`}
          </div>
          <span class="sev-badge sev-${h.severity}">${h.severity}</span>
        </div>
      `),
  ].join("");

  // ── Frameworks ──
  const fws = analysis.frameworks || [];
  if (fws.length === 0) {
    el.frameworkList.innerHTML = `<p class="muted small">Фреймворки не распознаны.</p>`;
  } else {
    el.frameworkList.innerHTML = fws.map((fw) => `
      <span class="fw-chip">
        <strong>${fw.name}</strong>
        ${fw.version ? `<span class="fw-ver">v${fw.version}</span>` : ""}
        <span class="fw-conf conf-${fw.confidence}">${fw.confidence}</span>
      </span>
    `).join("");
  }

  // ── Secrets ──
  const secrets = analysis.secrets || [];
  if (secrets.length === 0) {
    el.secretsList.innerHTML = `<div class="secrets-clean">✓ Потенциальных секретов не обнаружено</div>`;
  } else {
    el.secretsList.innerHTML = secrets.map((s) => `
      <div class="secret-row sev-${s.severity}">
        <span class="sev-badge sev-${s.severity}">${s.severity}</span>
        <div class="secret-info">
          <strong>${s.type}</strong>
          <code>${s.maskedValue}</code>
          <span class="small muted">${s.resourceUrl.slice(0, 80)}…</span>
        </div>
      </div>
    `).join("");
  }

  // ── API Endpoints ──
  const endpoints = analysis.apiEndpoints || [];
  if (endpoints.length === 0) {
    el.endpointsList.innerHTML = `<p class="muted small">Fetch/XHR запросы не зафиксированы.</p>`;
  } else {
    el.endpointsList.innerHTML = endpoints.map((ep) => `
      <div class="endpoint-row">
        <span class="method-chip method-${ep.method.toLowerCase()}">${ep.method}</span>
        <span class="ep-url">${ep.url}</span>
        ${ep.count > 1 ? `<span class="ep-count">${ep.count}×</span>` : ""}
      </div>
    `).join("");
  }
}

// ─── Source maps panel ────────────────────────────────────────────────────────

function buildSourceTree(paths) {
  const root = {};
  for (const p of paths) {
    const parts = p.split("/");
    let node = root;
    for (const part of parts) {
      if (!node[part]) node[part] = {};
      node = node[part];
    }
    node["__file__"] = p;
  }
  return root;
}

function renderTreeNode(node, prefix, depth) {
  let html = "";
  const indent = depth * 14;
  for (const [key, val] of Object.entries(node)) {
    if (key === "__file__") continue;
    const isFile = "__file__" in val;
    if (isFile) {
      const fullPath = val["__file__"];
      const isActive = state.sourceSelectedFile === fullPath;
      html += `<button class="tree-file ${isActive ? "active" : ""}" data-path="${fullPath}" style="padding-left:${indent + 8}px">${key}</button>`;
    } else {
      html += `<div class="tree-dir" style="padding-left:${indent}px">▸ ${key}/</div>`;
      html += renderTreeNode(val, prefix + key + "/", depth + 1);
    }
  }
  return html;
}

function renderSourceMaps() {
  const analysis = state.selectedScan?.analysis;
  const sourceMaps = analysis?.sourceMaps || [];
  const allPaths = sourceMaps.flatMap((sm) => sm.sources).filter((p) => !p.startsWith("node_modules/"));

  el.sourcemapCountBadge.textContent = String(allPaths.length);

  if (allPaths.length === 0) {
    el.sourceTree.innerHTML = `<p class="muted small">Source maps не обнаружены.</p>`;
    el.sourceViewer.textContent = "Source maps не обнаружены.";
    return;
  }

  const hasContent = sourceMaps.some((sm) => sm.hasContent);
  if (!hasContent) {
    el.sourceTree.innerHTML = [
      `<p class="muted small">Source maps найдены (${sourceMaps.length}), но оригинальный код не включён.</p>`,
      `<div class="source-path-list">`,
      allPaths.slice(0, 60).map((p) => `<span class="source-path-chip">${p.split("/").pop()}</span>`).join(""),
      `</div>`,
    ].join("");
    el.sourceViewer.textContent = "sourcesContent отсутствует в map-файлах.";
    return;
  }

  const tree = buildSourceTree(allPaths);
  el.sourceTree.innerHTML = renderTreeNode(tree, "", 0);

  el.sourceTree.querySelectorAll(".tree-file").forEach((btn) => {
    btn.addEventListener("click", () => void loadSourceFile(btn.dataset.path));
  });

  // expand dir buttons
  el.sourceTree.querySelectorAll(".tree-dir").forEach((btn) => {
    btn.style.cursor = "pointer";
  });
}

async function loadSourceFile(filePath) {
  if (!state.selectedScan) return;
  state.sourceSelectedFile = filePath;

  // Re-render tree to update active state
  renderSourceMaps();

  el.sourceViewer.textContent = "Загрузка…";
  try {
    const url = `${state.apiBase}/storage/scans/${state.selectedScan.scanFolder}/analysis/sources/${filePath}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    el.sourceViewer.textContent = text.slice(0, 120000);
  } catch (e) {
    el.sourceViewer.textContent = `// Ошибка загрузки: ${e.message}`;
  }
}

// ─── Resources ────────────────────────────────────────────────────────────────

function populateResourceKindOptions() {
  const kinds = Array.from(new Set((state.selectedScan?.resources || []).map((r) => r.kind))).sort();
  el.resourceKindSelect.innerHTML = `<option value="all">All types</option>`;
  for (const k of kinds) {
    const opt = document.createElement("option");
    opt.value = k; opt.textContent = k;
    el.resourceKindSelect.appendChild(opt);
  }
  el.resourceKindSelect.value = state.resourceKind;
}

function getFilteredResources() {
  if (!state.selectedScan) return [];
  return state.selectedScan.resources.filter((r) => {
    const hay = `${r.url} ${r.localPath} ${r.mime}`.toLowerCase();
    return hay.includes(state.resourceSearch.toLowerCase()) &&
      (state.resourceKind === "all" || r.kind === state.resourceKind);
  });
}

function renderResourceList() {
  const resources = getFilteredResources();
  el.resourceCountBadge.textContent = String(state.selectedScan?.resources.length || 0);
  el.resourceList.innerHTML = "";

  if (!state.selectedScan) { el.resourceList.innerHTML = `<p class="muted">No scan loaded.</p>`; return; }
  if (resources.length === 0) { el.resourceList.innerHTML = `<p class="muted">No resources match the current filters.</p>`; return; }

  for (const r of resources) {
    const btn = document.createElement("button");
    btn.className = `resource-item ${state.selectedResource?.id === r.id ? "active" : ""}`;
    btn.innerHTML = `
      <span class="resource-pill">${r.kind}</span>
      <div class="resource-copy">
        <strong>${r.localPath.split(/[/\\]/).pop()}</strong>
        <small>${r.url}</small>
      </div>
      <span class="resource-size">${r.status} · ${fmtBytes(r.sizeBytes)}</span>
    `;
    btn.addEventListener("click", () => void selectResource(r.id));
    el.resourceList.appendChild(btn);
  }
}

async function selectResource(resourceId) {
  if (!state.selectedScan) return;
  state.selectedResource = state.selectedScan.resources.find((r) => r.id === resourceId) || null;
  renderResourceList();
  await renderResourceInspector();
  saveState();
}

async function renderResourceInspector() {
  const r = state.selectedResource;
  if (!r) {
    el.resourceTitle.textContent = "No resource selected";
    el.resourceMeta.innerHTML = "";
    el.resourcePreview.className = "resource-preview empty-preview";
    el.resourcePreview.textContent = "Select a resource to preview it.";
    el.openResourceButton.disabled = true;
    el.openPrettyButton.disabled = true;
    return;
  }

  el.resourceTitle.textContent = r.localPath.split(/[/\\]/).pop() || r.localPath;
  el.resourceMeta.innerHTML = `
    <span>${r.mime || "unknown"}</span>
    <span>${r.domain}</span>
    <span>${r.sha256.slice(0, 16)}…</span>
    ${r.fromCache ? `<span class="cache-badge">cache</span>` : ""}
  `;
  el.openResourceButton.disabled = false;
  el.openResourceButton.onclick = () => void window.desktopAPI.openExternal(`${state.apiBase}${r.storageUrl}`);
  el.openPrettyButton.disabled = !r.prettyUrl;
  el.openPrettyButton.onclick = () => r.prettyUrl && void window.desktopAPI.openExternal(`${state.apiBase}${r.prettyUrl}`);

  if (r.kind === "image") {
    el.resourcePreview.className = "resource-preview image-host";
    el.resourcePreview.innerHTML = `<img src="${state.apiBase}${r.storageUrl}" alt="${r.localPath}" />`;
    return;
  }

  if (!PREVIEWABLE_KINDS.has(r.kind)) {
    el.resourcePreview.className = "resource-preview empty-preview";
    el.resourcePreview.textContent = `Inline preview is unavailable for "${r.kind}".`;
    return;
  }

  el.resourcePreview.className = "resource-preview code-host";
  el.resourcePreview.textContent = "Loading preview...";
  try {
    const response = await fetch(`${state.apiBase}${r.prettyUrl || r.storageUrl}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    el.resourcePreview.textContent = text.slice(0, 80000);
  } catch (e) {
    el.resourcePreview.textContent = String(e.message);
  }
}

// ─── Artifacts ────────────────────────────────────────────────────────────────

function resolvePathSpec(obj, spec) {
  return spec.split(".").reduce((v, k) => v?.[k], obj) || null;
}

function renderArtifactTabs() {
  el.artifactTabList.innerHTML = "";
  for (const [key, label, spec] of ARTIFACTS) {
    const btn = document.createElement("button");
    btn.className = `artifact-tab ${state.selectedArtifactKey === key ? "active" : ""}`;
    btn.textContent = label;
    btn.disabled = !state.selectedScan || !resolvePathSpec(state.selectedScan, spec);
    btn.addEventListener("click", () => {
      state.selectedArtifactKey = key;
      void loadSelectedArtifact();
      saveState();
    });
    el.artifactTabList.appendChild(btn);
  }
}

async function loadSelectedArtifact() {
  if (!state.selectedScan) {
    el.openArtifactButton.disabled = true;
    el.artifactPreview.textContent = "Select a scan first.";
    return;
  }
  const artifact = ARTIFACTS.find(([k]) => k === state.selectedArtifactKey) || ARTIFACTS[0];
  const url = resolvePathSpec(state.selectedScan, artifact[2]);
  el.openArtifactButton.disabled = !url;
  el.openArtifactButton.onclick = () => url && void window.desktopAPI.openExternal(`${state.apiBase}${url}`);

  if (!url) { el.artifactPreview.textContent = "Artifact is unavailable for this scan."; return; }
  el.artifactPreview.textContent = "Loading artifact...";
  try {
    const text = await fetchArtifactText(url);
    el.artifactPreview.textContent = text.slice(0, 120000);
  } catch (e) {
    el.artifactPreview.textContent = String(e.message);
  }
  renderArtifactTabs();
}

// ─── Auxiliary lists ──────────────────────────────────────────────────────────

function renderAuxiliaryLists() {
  if (!state.selectedScan) {
    el.networkErrorList.innerHTML = `<p class="muted">No network data.</p>`;
    el.interactionList.innerHTML  = `<p class="muted">No interaction data.</p>`;
    el.netErrorCount.textContent = "0";
    el.interactionCount.textContent = "0";
    return;
  }

  const netErrors = state.selectedScan.network.filter((e) => e.failure || (e.status || 0) >= 400);
  el.netErrorCount.textContent = String(netErrors.length);
  el.networkErrorList.innerHTML = netErrors.length === 0
    ? `<p class="muted">No failing requests.</p>`
    : netErrors.slice(0, 30).map((e) => `
        <div class="mini-row">
          <strong>${e.status || "ERR"} · ${e.method}</strong>
          <span>${e.url}</span>
        </div>
      `).join("");

  const interactions = state.selectedScan.interactions || [];
  el.interactionCount.textContent = String(interactions.length);
  el.interactionList.innerHTML = interactions.length === 0
    ? `<p class="muted">No safe interactions were executed.</p>`
    : interactions.slice(0, 30).map((i) => `
        <div class="mini-row">
          <strong>${i.label}</strong>
          <span class="status-${i.status}">${i.type} · ${i.status}</span>
        </div>
      `).join("");
}

// ─── HTML Report Export ───────────────────────────────────────────────────────

async function exportHtmlReport() {
  if (!state.selectedScan) return;
  const scan = state.selectedScan;
  const a = scan.analysis || {};
  const netErrors = scan.network.filter((e) => e.failure || (e.status || 0) >= 400);

  const secRows = (a.security?.headers || []).map((h) =>
    `<tr><td>${h.header}</td><td>${h.present ? "✓" : "✗"}</td><td>${h.severity}</td><td>${h.value || h.recommendation}</td></tr>`
  ).join("");

  const perfRows = a.performance ? Object.entries(a.performance).map(([k, v]) =>
    `<tr><td>${k}</td><td>${v === null ? "—" : typeof v === "number" && k !== "cls" ? v.toFixed(0) + " ms" : String(v)}</td></tr>`
  ).join("") : "";

  const fwRows = (a.frameworks || []).map((fw) =>
    `<tr><td>${fw.name}</td><td>${fw.version || "—"}</td><td>${fw.confidence}</td></tr>`
  ).join("");

  const secretRows = (a.secrets || []).map((s) =>
    `<tr style="color:red"><td>${s.type}</td><td>${s.severity}</td><td>${s.maskedValue}</td><td>${s.resourceUrl}</td></tr>`
  ).join("");

  const epRows = (a.apiEndpoints || []).map((ep) =>
    `<tr><td>${ep.method}</td><td>${ep.url}</td><td>${ep.count}</td></tr>`
  ).join("");

  const html = `<!doctype html><html lang="ru"><head><meta charset="UTF-8"/>
<title>${scan.scanId}</title>
<style>
  body{font-family:"Segoe UI",sans-serif;margin:32px;color:#111;line-height:1.5}
  h1{font-size:1.6rem;margin:0 0 4px}h2{font-size:1.1rem;margin:24px 0 8px;color:#333;border-bottom:2px solid #eee;padding-bottom:4px}
  section{margin-bottom:28px}table{width:100%;border-collapse:collapse;font-size:.88rem}
  th,td{border:1px solid #ddd;padding:7px 10px;text-align:left}th{background:#f5f5f5}
  code,pre{font-family:Consolas,monospace;white-space:pre-wrap;word-break:break-all;background:#f6f8fa;padding:10px;border-radius:6px;font-size:.82rem}
  .ok{color:green}.fail{color:red}.warn{color:orange}
</style></head><body>
<h1>Frontend Capture Report</h1>
<p><strong>URL:</strong> ${scan.url}<br/>
<strong>Scan ID:</strong> ${scan.scanId}<br/>
<strong>Начало:</strong> ${scan.startedAt} · <strong>Конец:</strong> ${scan.finishedAt}</p>

<section><h2>Сводка</h2><table><tbody>
<tr><td>JS файлов</td><td>${scan.summary.jsFiles}</td></tr>
<tr><td>CSS файлов</td><td>${scan.summary.cssFiles}</td></tr>
<tr><td>Source maps</td><td>${scan.summary.sourcemapsFound}</td></tr>
<tr><td>Всего запросов</td><td>${scan.summary.totalRequests}</td></tr>
<tr><td>Ошибочных запросов</td><td>${scan.summary.failedRequests}</td></tr>
<tr><td>Ошибок в консоли</td><td>${scan.summary.consoleErrors}</td></tr>
<tr><td>Общий размер</td><td>${fmtBytes(scan.summary.totalSizeBytes)}</td></tr>
${a.security?.score !== undefined ? `<tr><td>Security score</td><td>${a.security.score}/100</td></tr>` : ""}
</tbody></table></section>

${a.performance ? `<section><h2>Производительность</h2><table><thead><tr><th>Метрика</th><th>Значение</th></tr></thead><tbody>${perfRows}</tbody></table></section>` : ""}

${a.security ? `<section><h2>Заголовки безопасности (score: ${a.security.score}/100)</h2>
${a.security.mixedContentCount > 0 ? `<p class="fail">⚠ Mixed content: ${a.security.mixedContentCount}</p>` : ""}
<table><thead><tr><th>Заголовок</th><th>Присутствует</th><th>Важность</th><th>Значение / Рекомендация</th></tr></thead><tbody>${secRows}</tbody></table></section>` : ""}

${a.frameworks?.length ? `<section><h2>Обнаруженные технологии</h2><table><thead><tr><th>Название</th><th>Версия</th><th>Уверенность</th></tr></thead><tbody>${fwRows}</tbody></table></section>` : ""}

${a.secrets?.length ? `<section><h2>⚠ Найденные секреты</h2><table><thead><tr><th>Тип</th><th>Severity</th><th>Маскированное значение</th><th>Файл</th></tr></thead><tbody>${secretRows}</tbody></table></section>` : ""}

${a.apiEndpoints?.length ? `<section><h2>API Endpoints</h2><table><thead><tr><th>Метод</th><th>URL</th><th>Вызовов</th></tr></thead><tbody>${epRows}</tbody></table></section>` : ""}

${netErrors.length ? `<section><h2>Сетевые ошибки</h2><pre>${JSON.stringify(netErrors.slice(0, 50), null, 2)}</pre></section>` : ""}

<section><h2>Внешние домены</h2><p>${scan.summary.externalDomains.join(", ") || "Нет"}</p></section>

</body></html>`;

  const savedPath = await window.desktopAPI.saveTextFile({
    title: "Экспорт HTML-отчёта",
    defaultPath: `${scan.scanId}.html`,
    content: html,
  });
  if (savedPath) setJobCard(`<strong>Отчёт сохранён</strong><span>${savedPath}</span>`, "success");
}

// ─── Capture job ──────────────────────────────────────────────────────────────

async function runCapture() {
  const activeTab = getActiveTab();
  const url = activeTab?.url || normalizeUrl(el.captureUrlInput.value);
  el.captureButton.disabled = true;
  setJobCard(`<strong>Preparing capture job...</strong><span>${url}</span>`);
  try {
    let session;

    if (el.captureSessionInput.checked) {
      if (!activeTab) {
        throw new Error("Open and authenticate in a live tab before reusing its session.");
      }

      setJobCard(`<strong>Exporting active tab session...</strong><span>${url}</span>`);
      session = await collectActiveTabSession(activeTab);
      setJobCard(
        `<strong>Session exported</strong><span>${session.cookies.length} cookies</span><span>${session.storages.length} storage bucket(s)</span>`
      );
    }

    const job = await apiRequest("/api/capture", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        maxActionsPerPage: Number(el.safeActionsInput.value || 20),
        timeoutMs: Number(el.timeoutInput.value || 45000),
        session,
      }),
    });
    state.currentJob = job;
    setJobCard(`<strong>Capture job created</strong><span>${job.jobId}</span><span>${job.url}</span><span>Status: ${job.status}</span>`);
    startJobPolling();
  } catch (e) {
    setJobCard(`<strong>Capture failed</strong><span>${e.message}</span>`, "error");
  } finally {
    el.captureButton.disabled = false;
  }
}

function stopJobPolling() {
  if (state.jobTimer) { window.clearInterval(state.jobTimer); state.jobTimer = null; }
}

function startJobPolling() {
  stopJobPolling();
  if (!state.currentJob) return;

  const poll = async () => {
    try {
      const job = await apiRequest(`/api/jobs/${state.currentJob.jobId}`);
      state.currentJob = job;
      setJobCard(`
        <strong>Job: ${job.status}</strong>
        <span>${job.url}</span>
        ${job.error ? `<span class="err">${job.error}</span>` : ""}
      `, job.status === "failed" ? "error" : job.status === "completed" ? "success" : "info");

      if (job.status === "completed" && job.result?.scanId) {
        stopJobPolling();
        await loadScans(job.result.scanId);
      }
      if (job.status === "failed") stopJobPolling();
    } catch (e) {
      stopJobPolling();
      setJobCard(`<strong>Polling failed</strong><span>${e.message}</span>`, "error");
    }
  };

  void poll();
  state.jobTimer = window.setInterval(() => void poll(), 2000);
}

// ─── Events ───────────────────────────────────────────────────────────────────

function bindEvents() {
  el.newTabButton.addEventListener("click", () => createTab("https://example.com"));
  el.goButton.addEventListener("click", navigateCurrent);
  el.addressInput.addEventListener("keydown", (e) => { if (e.key === "Enter") navigateCurrent(); });
  el.backButton.addEventListener("click", () => { const t = getActiveTab(); if (t?.canGoBack) t.webview.goBack(); });
  el.forwardButton.addEventListener("click", () => { const t = getActiveTab(); if (t?.canGoForward) t.webview.goForward(); });
  el.reloadButton.addEventListener("click", () => { const t = getActiveTab(); if (t) t.webview.reload(); });
  el.captureButton.addEventListener("click", () => void runCapture());
  el.refreshScansButton.addEventListener("click", () => void loadScans());
  el.captureSessionInput.addEventListener("change", () => {
    state.reuseCapturedSession = el.captureSessionInput.checked;
    renderActiveTabMeta();
    saveState();
  });
  el.resourceSearchInput.addEventListener("input", (e) => {
    state.resourceSearch = e.target.value; saveState(); renderResourceList();
  });
  el.resourceKindSelect.addEventListener("change", (e) => {
    state.resourceKind = e.target.value; saveState(); renderResourceList();
  });
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

function restoreTabs() {
  const p = loadPersistedState();
  if (p?.safeActions) el.safeActionsInput.value = String(p.safeActions);
  if (p?.timeoutMs)   el.timeoutInput.value = String(p.timeoutMs);
  if (typeof p?.reuseCapturedSession === "boolean") {
    state.reuseCapturedSession = p.reuseCapturedSession;
    el.captureSessionInput.checked = p.reuseCapturedSession;
  }
  if (p?.resourceSearch) { state.resourceSearch = p.resourceSearch; el.resourceSearchInput.value = p.resourceSearch; }
  if (p?.resourceKind) state.resourceKind = p.resourceKind;

  if (p?.tabs?.length) {
    for (const tab of p.tabs) createTab(tab.url, tab.id, tab.title);
    if (p.activeTabId && state.tabs.some((t) => t.id === p.activeTabId)) setActiveTab(p.activeTabId);
    return;
  }
  createTab("https://example.com");
}

async function bootstrap() {
  const runtime = await window.desktopAPI.getRuntimeInfo();
  state.runtime = runtime;
  state.apiBase = runtime.apiBase;
  el.apiBaseInput.value = runtime.apiBase;
  el.runtimeBadge.textContent = runtime.platform;
  bindEvents();
  clearJobCard();
  restoreTabs();
  await loadScans();
}

void bootstrap();
