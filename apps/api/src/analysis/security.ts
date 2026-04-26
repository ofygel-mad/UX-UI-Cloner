import type { NetworkEntry, SecurityHeaderCheck, SecurityReport } from "../capture/types.js";

const HEADER_CHECKS: Array<{
  header: string;
  severity: "critical" | "warning" | "info";
  recommendation: string;
}> = [
  {
    header: "content-security-policy",
    severity: "critical",
    recommendation: "Добавьте CSP для защиты от XSS. Минимум: default-src 'self'",
  },
  {
    header: "strict-transport-security",
    severity: "critical",
    recommendation: "Включите HSTS: Strict-Transport-Security: max-age=31536000; includeSubDomains",
  },
  {
    header: "x-frame-options",
    severity: "warning",
    recommendation: "Добавьте X-Frame-Options: DENY или SAMEORIGIN для защиты от clickjacking",
  },
  {
    header: "x-content-type-options",
    severity: "warning",
    recommendation: "Добавьте X-Content-Type-Options: nosniff",
  },
  {
    header: "referrer-policy",
    severity: "info",
    recommendation: "Добавьте Referrer-Policy: strict-origin-when-cross-origin",
  },
  {
    header: "permissions-policy",
    severity: "info",
    recommendation: "Ограничьте браузерные API через Permissions-Policy",
  },
  {
    header: "x-xss-protection",
    severity: "info",
    recommendation: "X-XSS-Protection: 1; mode=block (устаревший, но поддерживается старыми браузерами)",
  },
  {
    header: "cross-origin-opener-policy",
    severity: "info",
    recommendation: "Добавьте Cross-Origin-Opener-Policy: same-origin для изоляции контекста",
  },
];

export function analyzeSecurityHeaders(
  mainPageHeaders: Record<string, string>,
  network: NetworkEntry[],
  baseUrl: string
): SecurityReport {
  const lower = Object.fromEntries(Object.entries(mainPageHeaders).map(([k, v]) => [k.toLowerCase(), v]));

  const headers: SecurityHeaderCheck[] = HEADER_CHECKS.map(({ header, severity, recommendation }) => {
    const value = lower[header];
    return { header, present: !!value, value, severity, recommendation };
  });

  const isHttps = baseUrl.startsWith("https://");
  const mixedContentCount = isHttps
    ? network.filter((e) => e.url.startsWith("http://") && !e.failure).length
    : 0;

  const presentCritical = headers.filter((h) => h.severity === "critical" && h.present).length;
  const totalCritical = headers.filter((h) => h.severity === "critical").length;
  const presentWarning = headers.filter((h) => h.severity === "warning" && h.present).length;
  const totalWarning = headers.filter((h) => h.severity === "warning").length;
  const presentInfo = headers.filter((h) => h.severity === "info" && h.present).length;
  const totalInfo = headers.filter((h) => h.severity === "info").length;

  const score = Math.round(
    ((presentCritical / totalCritical) * 50 +
      (presentWarning / totalWarning) * 30 +
      (presentInfo / totalInfo) * 20) *
      (mixedContentCount > 0 ? 0.8 : 1)
  );

  return { headers, mixedContentCount, httpsOnly: isHttps, score };
}
