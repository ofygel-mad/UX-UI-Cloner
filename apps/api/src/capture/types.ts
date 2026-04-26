export type ResourceKind =
  | "html"
  | "css"
  | "js"
  | "json"
  | "image"
  | "font"
  | "wasm"
  | "map"
  | "svg"
  | "other";

export type CapturedResource = {
  id: string;
  url: string;
  method: string;
  status: number;
  mime: string;
  kind: ResourceKind;
  sizeBytes: number;
  sha256: string;
  domain: string;
  localPath: string;
  prettyPath?: string;
  fromCache?: boolean;
};

export type NetworkEntry = {
  url: string;
  method: string;
  status?: number;
  resourceType?: string;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  failure?: string;
};

export type InteractionLog = {
  id: string;
  type: "scroll" | "click" | "hover";
  label: string;
  selector?: string;
  status: "completed" | "skipped" | "failed";
  reason?: string;
  newRequestsCount?: number;
};

export type CaptureOptions = {
  url: string;
  maxActionsPerPage: number;
  timeoutMs: number;
};

// ─── Analysis types ───────────────────────────────────────────────────────────

export type PerformanceMetrics = {
  ttfb: number | null;
  fcp: number | null;
  lcp: number | null;
  cls: number | null;
  domContentLoaded: number | null;
  loadTime: number | null;
};

export type SecurityHeaderCheck = {
  header: string;
  present: boolean;
  value?: string;
  severity: "critical" | "warning" | "info";
  recommendation: string;
};

export type SecurityReport = {
  headers: SecurityHeaderCheck[];
  mixedContentCount: number;
  httpsOnly: boolean;
  score: number;
};

export type DetectedFramework = {
  name: string;
  version?: string;
  confidence: "high" | "medium" | "low";
};

export type SecretFinding = {
  type: string;
  resourceId: string;
  resourceUrl: string;
  maskedValue: string;
  severity: "critical" | "high" | "medium";
};

export type ApiEndpoint = {
  method: string;
  url: string;
  count: number;
};

export type SourceMapFile = {
  originalPath: string;
  mapResourceId: string;
  sources: string[];
  hasContent: boolean;
};

export type AnalysisReport = {
  performance: PerformanceMetrics;
  security: SecurityReport;
  frameworks: DetectedFramework[];
  secrets: SecretFinding[];
  apiEndpoints: ApiEndpoint[];
  sourceMaps: SourceMapFile[];
};

// ─── Capture result ───────────────────────────────────────────────────────────

export type CaptureResult = {
  scanId: string;
  url: string;
  scanDir: string;
  scanFolder: string;
  zipPath: string;
  startedAt: string;
  finishedAt: string;
  resources: CapturedResource[];
  network: NetworkEntry[];
  interactions: InteractionLog[];
  screenshots: {
    desktop?: string;
    fullPage?: string;
    mobile?: string;
  };
  summary: {
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
  analysis: AnalysisReport;
};
