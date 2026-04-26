const PREVIEWABLE_KINDS = new Set(["html", "css", "js", "json", "svg", "map"]);
const ARTIFACTS = [
  ["manifest", "Manifest", "artifacts.manifestUrl"],
  ["initialDom", "Initial DOM", "artifacts.initialHtmlUrl"],
  ["finalDom", "Final DOM", "artifacts.finalDomUrl"],
  ["console", "Console", "artifacts.consoleUrl"],
  ["network", "Network", "artifacts.networkUrl"],
  ["cookies", "Cookies", "artifacts.cookiesUrl"],
  ["storage", "Local Storage", "artifacts.localStorageUrl"]
];
const STORAGE_KEY = "fcb.desktop.state.v2";

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
  artifactPreview: "",
  resourceSearch: "",
  resourceKind: "all",
  currentJob: null,
  jobTimer: null
};

const elements = {
  runtimeBadge: document.getElementById("runtime-badge"),
  apiBaseInput: document.getElementById("api-base-input"),
  captureUrlInput: document.getElementById("capture-url-input"),
  safeActionsInput: document.getElementById("safe-actions-input"),
  timeoutInput: document.getElementById("timeout-input"),
  captureButton: document.getElementById("capture-button"),
  refreshScansButton: document.getElementById("refresh-scans-button"),
  jobStatusCard: document.getElementById("job-status-card"),
  scanList: document.getElementById("scan-list"),
  scanCountBadge: document.getElementById("scan-count-badge"),
  tabList: document.getElementById("tab-list"),
  browserStack: document.getElementById("browser-stack"),
  newTabButton: document.getElementById("new-tab-button"),
  backButton: document.getElementById("back-button"),
  forwardButton: document.getElementById("forward-button"),
  reloadButton: document.getElementById("reload-button"),
  addressInput: document.getElementById("address-input"),
  goButton: document.getElementById("go-button"),
  scanTitle: document.getElementById("scan-title"),
  summaryMetrics: document.getElementById("summary-metrics"),
  screenshotsGrid: document.getElementById("screenshots-grid"),
  downloadZipButton: document.getElementById("download-zip-button"),
  openScanButton: document.getElementById("open-scan-button"),
  exportReportButton: document.getElementById("export-report-button"),
  resourceSearchInput: document.getElementById("resource-search-input"),
  resourceKindSelect: document.getElementById("resource-kind-select"),
  resourceList: document.getElementById("resource-list"),
  resourceTitle: document.getElementById("resource-title"),
  resourceMeta: document.getElementById("resource-meta"),
  resourcePreview: document.getElementById("resource-preview"),
  openResourceButton: document.getElementById("open-resource-button"),
  openPrettyButton: document.getElementById("open-pretty-button"),
  artifactTabList: document.getElementById("artifact-tab-list"),
  artifactPreview: document.getElementById("artifact-preview"),
  openArtifactButton: document.getElementById("open-artifact-button"),
  networkErrorList: document.getElementById("network-error-list"),
  interactionList: document.getElementById("interaction-list")
};

function saveState() {
  const persisted = {
    tabs: state.tabs.map((tab) => ({
      id: tab.id,
      title: tab.title,
      url: tab.url
    })),
    activeTabId: state.activeTabId,
    selectedScanId: state.selectedScan?.scanId || null,
    selectedResourceId: state.selectedResource?.id || null,
    selectedArtifactKey: state.selectedArtifactKey,
    resourceSearch: state.resourceSearch,
    resourceKind: state.resourceKind,
    safeActions: elements.safeActionsInput.value,
    timeoutMs: elements.timeoutInput.value
  };

  localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
}

function loadPersistedState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function formatDate(value) {
  return new Date(value).toLocaleString("en-US", {
    dateStyle: "short",
    timeStyle: "medium"
  });
}

function normalizeUrl(input) {
  const trimmed = String(input || "").trim();
  if (!trimmed) return "https://example.com";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

async function apiRequest(pathname, init) {
  const response = await fetch(`${state.apiBase}${pathname}`, init);
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const message =
      typeof payload === "string"
        ? payload
        : payload && typeof payload === "object" && "error" in payload
          ? String(payload.error)
          : "Request failed";

    throw new Error(message);
  }

  return payload;
}

async function fetchArtifactText(url) {
  const response = await fetch(`${state.apiBase}${url}`);
  if (!response.ok) {
    throw new Error(`Artifact request failed with status ${response.status}`);
  }

  const text = await response.text();

  try {
    const parsed = JSON.parse(text);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return text;
  }
}

function getActiveTab() {
  return state.tabs.find((tab) => tab.id === state.activeTabId) || null;
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
    webview
  };

  webview.addEventListener("did-start-loading", () => {
    tab.loading = true;
    renderTabs();
  });

  webview.addEventListener("did-stop-loading", () => {
    tab.loading = false;
    tab.url = webview.getURL() || tab.url;
    tab.canGoBack = webview.canGoBack();
    tab.canGoForward = webview.canGoForward();
    tab.title = webview.getTitle() || tab.title;

    if (state.activeTabId === tab.id) {
      elements.addressInput.value = tab.url;
      elements.captureUrlInput.value = tab.url;
      updateNavigationButtons();
    }

    saveState();
    renderTabs();
  });

  webview.addEventListener("page-title-updated", (event) => {
    tab.title = event.title || tab.title;
    saveState();
    renderTabs();
  });

  webview.addEventListener("did-navigate", (event) => {
    tab.url = event.url;
    if (state.activeTabId === tab.id) {
      elements.addressInput.value = tab.url;
      elements.captureUrlInput.value = tab.url;
    }
    saveState();
    renderTabs();
  });

  webview.addEventListener("did-navigate-in-page", (event) => {
    tab.url = event.url;
    if (state.activeTabId === tab.id) {
      elements.addressInput.value = tab.url;
      elements.captureUrlInput.value = tab.url;
    }
    saveState();
    renderTabs();
  });

  webview.addEventListener("new-window", (event) => {
    event.preventDefault();
    createTab(event.url);
  });

  state.tabs.push(tab);
  elements.browserStack.appendChild(webview);
  setActiveTab(tab.id);
}

function removeTab(tabId) {
  if (state.tabs.length === 1) return;

  const index = state.tabs.findIndex((tab) => tab.id === tabId);
  if (index === -1) return;

  const [tab] = state.tabs.splice(index, 1);
  tab.webview.remove();

  if (state.activeTabId === tabId) {
    const fallback = state.tabs[Math.max(0, index - 1)] || state.tabs[0];
    setActiveTab(fallback.id);
  } else {
    renderTabs();
    saveState();
  }
}

function setActiveTab(tabId) {
  state.activeTabId = tabId;

  for (const tab of state.tabs) {
    tab.webview.classList.toggle("active", tab.id === tabId);
  }

  const activeTab = getActiveTab();
  if (activeTab) {
    elements.addressInput.value = activeTab.url;
    elements.captureUrlInput.value = activeTab.url;
  }

  updateNavigationButtons();
  saveState();
  renderTabs();
}

function navigateCurrentTab() {
  const activeTab = getActiveTab();
  if (!activeTab) return;

  const nextUrl = normalizeUrl(elements.addressInput.value);
  activeTab.webview.loadURL(nextUrl);
}

function updateNavigationButtons() {
  const activeTab = getActiveTab();
  elements.backButton.disabled = !activeTab || !activeTab.canGoBack;
  elements.forwardButton.disabled = !activeTab || !activeTab.canGoForward;
}

function renderTabs() {
  elements.tabList.innerHTML = "";

  for (const tab of state.tabs) {
    const button = document.createElement("button");
    button.className = `tab-chip ${tab.id === state.activeTabId ? "active" : ""}`;
    button.innerHTML = `
      <span class="tab-chip-title">${tab.loading ? "Loading..." : tab.title}</span>
      <span class="tab-chip-close">x</span>
    `;

    button.addEventListener("click", (event) => {
      const target = event.target;
      if (target instanceof HTMLElement && target.classList.contains("tab-chip-close")) {
        removeTab(tab.id);
        return;
      }

      setActiveTab(tab.id);
    });

    elements.tabList.appendChild(button);
  }
}

function setJobCard(content, mode = "info") {
  elements.jobStatusCard.className = `job-card ${mode}`;
  elements.jobStatusCard.classList.remove("hidden");
  elements.jobStatusCard.innerHTML = content;
}

function clearJobCard() {
  elements.jobStatusCard.className = "job-card hidden";
  elements.jobStatusCard.innerHTML = "";
}

async function loadScans(preselectScanId = null) {
  try {
    const data = await apiRequest("/api/scans?limit=20");
    state.scans = data.items || [];
    renderScanList();

    const persisted = loadPersistedState();
    const candidateScanId = preselectScanId || persisted?.selectedScanId;

    if (candidateScanId) {
      const exists = state.scans.some((scan) => scan.scanId === candidateScanId);
      if (exists) {
        await selectScan(candidateScanId);
        return;
      }
    }

    if (!state.selectedScan && state.scans[0]) {
      await selectScan(state.scans[0].scanId);
    }
  } catch (error) {
    setJobCard(`<strong>Failed to load scans</strong><span>${String(error.message || error)}</span>`, "error");
  }
}

function renderScanList() {
  elements.scanList.innerHTML = "";
  elements.scanCountBadge.textContent = String(state.scans.length);

  if (state.scans.length === 0) {
    elements.scanList.innerHTML = `<p class="muted">No saved scans yet.</p>`;
    return;
  }

  for (const scan of state.scans) {
    const button = document.createElement("button");
    button.className = `scan-item ${state.selectedScan?.scanId === scan.scanId ? "active" : ""}`;
    button.innerHTML = `
      <strong>${scan.url}</strong>
      <span>${scan.scanId}</span>
      <span>${formatDate(scan.finishedAt)}</span>
    `;
    button.addEventListener("click", () => {
      void selectScan(scan.scanId);
    });
    elements.scanList.appendChild(button);
  }
}

async function selectScan(scanId) {
  try {
    const detail = await apiRequest(`/api/scans/${scanId}`);
    state.selectedScan = detail;
    state.selectedResource = null;
    state.selectedArtifactKey = loadPersistedState()?.selectedArtifactKey || "manifest";
    renderScanList();
    renderSelectedScan();
    populateResourceKindOptions();
    renderResourceList();
    renderAuxiliaryLists();
    renderArtifactTabs();
    await loadSelectedArtifact();

    const persisted = loadPersistedState();
    const preferredResourceId = persisted?.selectedResourceId;
    const initialResource =
      detail.resources.find((item) => item.id === preferredResourceId) || detail.resources[0] || null;

    if (initialResource) {
      await selectResource(initialResource.id);
    } else {
      await renderResourceInspector();
    }

    saveState();
  } catch (error) {
    setJobCard(`<strong>Failed to load scan</strong><span>${String(error.message || error)}</span>`, "error");
  }
}

function renderSelectedScan() {
  const scan = state.selectedScan;

  if (!scan) {
    elements.scanTitle.textContent = "No scan selected";
    elements.summaryMetrics.className = "metrics-grid metrics-grid-empty";
    elements.summaryMetrics.innerHTML = `<p class="muted">Pick a scan from history.</p>`;
    elements.screenshotsGrid.innerHTML = "";
    elements.downloadZipButton.disabled = true;
    elements.openScanButton.disabled = true;
    elements.exportReportButton.disabled = true;
    return;
  }

  elements.scanTitle.textContent = `${scan.scanId}  ${scan.url}`;
  elements.downloadZipButton.disabled = false;
  elements.openScanButton.disabled = false;
  elements.exportReportButton.disabled = false;

  elements.downloadZipButton.onclick = () => {
    void window.desktopAPI.openExternal(`${state.apiBase}${scan.downloadUrl}`);
  };

  elements.openScanButton.onclick = () => {
    void window.desktopAPI.openExternal(`${state.apiBase}${scan.artifacts.resultUrl}`);
  };

  elements.exportReportButton.onclick = () => {
    void exportHtmlReport();
  };

  const summary = scan.summary;

  elements.summaryMetrics.className = "metrics-grid";
  elements.summaryMetrics.innerHTML = `
    <div class="metric-card"><span>JS files</span><strong>${summary.jsFiles}</strong></div>
    <div class="metric-card"><span>CSS files</span><strong>${summary.cssFiles}</strong></div>
    <div class="metric-card"><span>Total requests</span><strong>${summary.totalRequests}</strong></div>
    <div class="metric-card"><span>Failed requests</span><strong>${summary.failedRequests}</strong></div>
    <div class="metric-card"><span>Console errors</span><strong>${summary.consoleErrors}</strong></div>
    <div class="metric-card"><span>Total size</span><strong>${formatBytes(summary.totalSizeBytes)}</strong></div>
  `;

  elements.screenshotsGrid.innerHTML = "";
  const screenshots = [
    ["Desktop", scan.artifacts.screenshotDesktopUrl],
    ["Full page", scan.artifacts.screenshotFullPageUrl]
  ].filter((item) => item[1]);

  for (const [label, url] of screenshots) {
    const button = document.createElement("button");
    button.className = "screenshot-card";
    button.innerHTML = `
      <img src="${state.apiBase}${url}" alt="${label}" />
      <span>${label}</span>
    `;
    button.addEventListener("click", () => {
      void window.desktopAPI.openExternal(`${state.apiBase}${url}`);
    });
    elements.screenshotsGrid.appendChild(button);
  }
}

function populateResourceKindOptions() {
  const scan = state.selectedScan;
  const kinds = Array.from(new Set((scan?.resources || []).map((resource) => resource.kind))).sort();
  elements.resourceKindSelect.innerHTML = `<option value="all">All kinds</option>`;

  for (const kind of kinds) {
    const option = document.createElement("option");
    option.value = kind;
    option.textContent = kind;
    elements.resourceKindSelect.appendChild(option);
  }

  elements.resourceKindSelect.value = state.resourceKind;
}

function getFilteredResources() {
  if (!state.selectedScan) return [];

  return state.selectedScan.resources.filter((resource) => {
    const haystack = `${resource.url} ${resource.localPath} ${resource.mime}`.toLowerCase();
    const matchesSearch = haystack.includes(state.resourceSearch.toLowerCase());
    const matchesKind = state.resourceKind === "all" || resource.kind === state.resourceKind;
    return matchesSearch && matchesKind;
  });
}

function renderResourceList() {
  const resources = getFilteredResources();
  elements.resourceList.innerHTML = "";

  if (!state.selectedScan) {
    elements.resourceList.innerHTML = `<p class="muted">No scan selected.</p>`;
    return;
  }

  if (resources.length === 0) {
    elements.resourceList.innerHTML = `<p class="muted">No resources match the current filters.</p>`;
    return;
  }

  for (const resource of resources) {
    const button = document.createElement("button");
    button.className = `resource-item ${state.selectedResource?.id === resource.id ? "active" : ""}`;
    button.innerHTML = `
      <span class="resource-pill">${resource.kind}</span>
      <div class="resource-copy">
        <strong>${resource.localPath}</strong>
        <small>${resource.url}</small>
      </div>
      <span class="resource-size">${resource.status} | ${formatBytes(resource.sizeBytes)}</span>
    `;
    button.addEventListener("click", () => {
      void selectResource(resource.id);
    });
    elements.resourceList.appendChild(button);
  }
}

async function selectResource(resourceId) {
  if (!state.selectedScan) return;

  state.selectedResource =
    state.selectedScan.resources.find((resource) => resource.id === resourceId) || null;
  renderResourceList();
  await renderResourceInspector();
  saveState();
}

async function renderResourceInspector() {
  const resource = state.selectedResource;

  if (!resource) {
    elements.resourceTitle.textContent = "No resource selected";
    elements.resourceMeta.innerHTML = "";
    elements.resourcePreview.className = "resource-preview empty-preview";
    elements.resourcePreview.textContent = "Choose a resource to inspect its content.";
    elements.openResourceButton.disabled = true;
    elements.openPrettyButton.disabled = true;
    return;
  }

  elements.resourceTitle.textContent = resource.localPath;
  elements.resourceMeta.innerHTML = `
    <span>${resource.mime || "unknown mime"}</span>
    <span>${resource.domain}</span>
    <span>${resource.sha256.slice(0, 16)}...</span>
  `;
  elements.openResourceButton.disabled = false;
  elements.openResourceButton.onclick = () => {
    void window.desktopAPI.openExternal(`${state.apiBase}${resource.storageUrl}`);
  };

  elements.openPrettyButton.disabled = !resource.prettyUrl;
  elements.openPrettyButton.onclick = () => {
    if (resource.prettyUrl) {
      void window.desktopAPI.openExternal(`${state.apiBase}${resource.prettyUrl}`);
    }
  };

  if (resource.kind === "image") {
    elements.resourcePreview.className = "resource-preview image-host";
    elements.resourcePreview.innerHTML = `<img src="${state.apiBase}${resource.storageUrl}" alt="${resource.localPath}" />`;
    return;
  }

  if (!PREVIEWABLE_KINDS.has(resource.kind)) {
    elements.resourcePreview.className = "resource-preview empty-preview";
    elements.resourcePreview.textContent = `Inline preview is not enabled for ${resource.kind}.`;
    return;
  }

  elements.resourcePreview.className = "resource-preview code-host";
  elements.resourcePreview.textContent = "Loading preview...";

  try {
    const response = await fetch(`${state.apiBase}${resource.prettyUrl || resource.storageUrl}`);
    if (!response.ok) {
      throw new Error(`Preview request failed with status ${response.status}`);
    }

    const text = await response.text();
    elements.resourcePreview.textContent = text.slice(0, 60000);
  } catch (error) {
    elements.resourcePreview.textContent = String(error.message || error);
  }
}

function renderArtifactTabs() {
  elements.artifactTabList.innerHTML = "";
  const scan = state.selectedScan;

  for (const [key, label, pathSpec] of ARTIFACTS) {
    const button = document.createElement("button");
    button.className = `artifact-tab ${state.selectedArtifactKey === key ? "active" : ""}`;
    button.textContent = label;

    const url = scan ? resolvePathSpec(scan, pathSpec) : null;
    button.disabled = !url;

    button.addEventListener("click", () => {
      state.selectedArtifactKey = key;
      void loadSelectedArtifact();
      saveState();
    });

    elements.artifactTabList.appendChild(button);
  }
}

function resolvePathSpec(scan, pathSpec) {
  return pathSpec.split(".").reduce((value, segment) => value?.[segment], scan) || null;
}

async function loadSelectedArtifact() {
  const scan = state.selectedScan;

  if (!scan) {
    state.selectedArtifactUrl = null;
    elements.openArtifactButton.disabled = true;
    elements.artifactPreview.textContent = "Select a scan to load artifacts.";
    return;
  }

  const artifact = ARTIFACTS.find((item) => item[0] === state.selectedArtifactKey) || ARTIFACTS[0];
  const url = resolvePathSpec(scan, artifact[2]);
  state.selectedArtifactUrl = url;
  elements.openArtifactButton.disabled = !url;
  elements.openArtifactButton.onclick = () => {
    if (url) {
      void window.desktopAPI.openExternal(`${state.apiBase}${url}`);
    }
  };

  if (!url) {
    elements.artifactPreview.textContent = "This artifact is not available for the selected scan.";
    return;
  }

  elements.artifactPreview.textContent = "Loading artifact...";

  try {
    const text = await fetchArtifactText(url);
    elements.artifactPreview.textContent = text.slice(0, 120000);
  } catch (error) {
    elements.artifactPreview.textContent = String(error.message || error);
  }

  renderArtifactTabs();
}

function renderAuxiliaryLists() {
  if (!state.selectedScan) {
    elements.networkErrorList.innerHTML = `<p class="muted">No data.</p>`;
    elements.interactionList.innerHTML = `<p class="muted">No data.</p>`;
    return;
  }

  const networkErrors = state.selectedScan.network.filter(
    (item) => item.failure || (item.status || 0) >= 400
  );

  elements.networkErrorList.innerHTML =
    networkErrors.length === 0
      ? `<p class="muted">No failing requests.</p>`
      : networkErrors
          .slice(0, 24)
          .map(
            (item) => `
              <div class="mini-row">
                <strong>${item.status || "ERR"} | ${item.method}</strong>
                <span>${item.url}</span>
              </div>
            `
          )
          .join("");

  elements.interactionList.innerHTML =
    state.selectedScan.interactions.length === 0
      ? `<p class="muted">No interaction logs.</p>`
      : state.selectedScan.interactions
          .slice(0, 24)
          .map(
            (item) => `
              <div class="mini-row">
                <strong>${item.label}</strong>
                <span>${item.type} | ${item.status}</span>
              </div>
            `
          )
          .join("");
}

async function exportHtmlReport() {
  if (!state.selectedScan) return;

  const scan = state.selectedScan;
  const networkErrors = scan.network.filter((item) => item.failure || (item.status || 0) >= 400);
  const html = [
    "<!doctype html>",
    "<html lang='en'>",
    "<head>",
    "<meta charset='UTF-8' />",
    `<title>${scan.scanId}</title>`,
    "<style>body{font-family:Segoe UI,sans-serif;margin:24px;color:#111}h1,h2{margin:0 0 12px}section{margin:0 0 24px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ddd;padding:8px;text-align:left}code,pre{font-family:Consolas,monospace;white-space:pre-wrap;word-break:break-word;background:#f6f8fa;padding:12px;border-radius:8px}</style>",
    "</head>",
    "<body>",
    `<h1>${scan.scanId}</h1>`,
    `<section><strong>URL:</strong> ${scan.url}<br/><strong>Started:</strong> ${scan.startedAt}<br/><strong>Finished:</strong> ${scan.finishedAt}</section>`,
    "<section><h2>Summary</h2>",
    "<table><tbody>",
    `<tr><td>JS files</td><td>${scan.summary.jsFiles}</td></tr>`,
    `<tr><td>CSS files</td><td>${scan.summary.cssFiles}</td></tr>`,
    `<tr><td>Total requests</td><td>${scan.summary.totalRequests}</td></tr>`,
    `<tr><td>Failed requests</td><td>${scan.summary.failedRequests}</td></tr>`,
    `<tr><td>Console errors</td><td>${scan.summary.consoleErrors}</td></tr>`,
    `<tr><td>Total size</td><td>${formatBytes(scan.summary.totalSizeBytes)}</td></tr>`,
    "</tbody></table></section>",
    "<section><h2>External domains</h2>",
    scan.summary.externalDomains.length
      ? `<pre>${scan.summary.externalDomains.join("\n")}</pre>`
      : "<p>None</p>",
    "</section>",
    "<section><h2>Network errors</h2>",
    networkErrors.length
      ? `<pre>${JSON.stringify(networkErrors, null, 2)}</pre>`
      : "<p>None</p>",
    "</section>",
    "<section><h2>Interactions</h2>",
    `<pre>${JSON.stringify(scan.interactions, null, 2)}</pre>`,
    "</section>",
    "<section><h2>Resources</h2>",
    `<pre>${JSON.stringify(
      scan.resources.map((resource) => ({
        id: resource.id,
        kind: resource.kind,
        url: resource.url,
        localPath: resource.localPath,
        sizeBytes: resource.sizeBytes,
        status: resource.status
      })),
      null,
      2
    )}</pre>`,
    "</section>",
    "</body></html>"
  ].join("");

  const savedPath = await window.desktopAPI.saveTextFile({
    title: "Export HTML report",
    defaultPath: `${scan.scanId}.html`,
    content: html
  });

  if (savedPath) {
    setJobCard(`<strong>Report exported</strong><span>${savedPath}</span>`, "success");
  }
}

async function runCapture() {
  const activeTab = getActiveTab();
  const url = activeTab?.url || normalizeUrl(elements.captureUrlInput.value);
  elements.captureButton.disabled = true;
  setJobCard(`<strong>Creating capture job</strong><span>${url}</span>`);

  try {
    const job = await apiRequest("/api/capture", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        url,
        maxActionsPerPage: Number(elements.safeActionsInput.value || 20),
        timeoutMs: Number(elements.timeoutInput.value || 45000)
      })
    });

    state.currentJob = job;
    setJobCard(
      `<strong>Job created</strong><span>${job.jobId}</span><span>${job.url}</span><span>Status: ${job.status}</span>`
    );
    startJobPolling();
  } catch (error) {
    setJobCard(`<strong>Capture failed</strong><span>${String(error.message || error)}</span>`, "error");
  } finally {
    elements.captureButton.disabled = false;
  }
}

function stopJobPolling() {
  if (state.jobTimer) {
    window.clearInterval(state.jobTimer);
    state.jobTimer = null;
  }
}

function startJobPolling() {
  stopJobPolling();
  if (!state.currentJob) return;

  const poll = async () => {
    try {
      const job = await apiRequest(`/api/jobs/${state.currentJob.jobId}`);
      state.currentJob = job;
      setJobCard(
        `
          <strong>Current job: ${job.status}</strong>
          <span>ID: ${job.jobId}</span>
          <span>${job.url}</span>
          ${job.error ? `<span>${job.error}</span>` : ""}
        `,
        job.status === "failed" ? "error" : job.status === "completed" ? "success" : "info"
      );

      if (job.status === "completed" && job.result?.scanId) {
        stopJobPolling();
        await loadScans(job.result.scanId);
      }

      if (job.status === "failed") {
        stopJobPolling();
      }
    } catch (error) {
      stopJobPolling();
      setJobCard(`<strong>Polling failed</strong><span>${String(error.message || error)}</span>`, "error");
    }
  };

  void poll();
  state.jobTimer = window.setInterval(() => {
    void poll();
  }, 2000);
}

function bindEvents() {
  elements.newTabButton.addEventListener("click", () => createTab("https://example.com"));
  elements.goButton.addEventListener("click", navigateCurrentTab);
  elements.addressInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") navigateCurrentTab();
  });

  elements.backButton.addEventListener("click", () => {
    const activeTab = getActiveTab();
    if (activeTab?.webview.canGoBack()) activeTab.webview.goBack();
  });

  elements.forwardButton.addEventListener("click", () => {
    const activeTab = getActiveTab();
    if (activeTab?.webview.canGoForward()) activeTab.webview.goForward();
  });

  elements.reloadButton.addEventListener("click", () => {
    const activeTab = getActiveTab();
    if (activeTab) activeTab.webview.reload();
  });

  elements.captureButton.addEventListener("click", () => {
    void runCapture();
  });

  elements.refreshScansButton.addEventListener("click", () => {
    void loadScans();
  });

  elements.resourceSearchInput.addEventListener("input", (event) => {
    state.resourceSearch = event.target.value;
    saveState();
    renderResourceList();
  });

  elements.resourceKindSelect.addEventListener("change", (event) => {
    state.resourceKind = event.target.value;
    saveState();
    renderResourceList();
  });
}

function restoreTabs() {
  const persisted = loadPersistedState();
  if (persisted?.safeActions) {
    elements.safeActionsInput.value = String(persisted.safeActions);
  }
  if (persisted?.timeoutMs) {
    elements.timeoutInput.value = String(persisted.timeoutMs);
  }
  if (persisted?.resourceSearch) {
    state.resourceSearch = persisted.resourceSearch;
    elements.resourceSearchInput.value = persisted.resourceSearch;
  }
  if (persisted?.resourceKind) {
    state.resourceKind = persisted.resourceKind;
  }
  if (persisted?.tabs?.length) {
    for (const tab of persisted.tabs) {
      createTab(tab.url, tab.id, tab.title);
    }
    if (persisted.activeTabId && state.tabs.some((tab) => tab.id === persisted.activeTabId)) {
      setActiveTab(persisted.activeTabId);
    }
    return;
  }

  createTab("https://example.com");
}

async function bootstrap() {
  const runtime = await window.desktopAPI.getRuntimeInfo();
  state.runtime = runtime;
  state.apiBase = runtime.apiBase;
  elements.apiBaseInput.value = runtime.apiBase;
  elements.runtimeBadge.textContent = runtime.platform;
  bindEvents();
  clearJobCard();
  restoreTabs();
  await loadScans();
}

void bootstrap();
