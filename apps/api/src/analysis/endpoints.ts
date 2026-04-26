import type { ApiEndpoint, NetworkEntry } from "../capture/types.js";

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const NUMERIC_SEGMENT_RE = /\/\d+(?=\/|$)/g;
const HASH_SEGMENT_RE = /\/[a-f0-9]{32,}(?=\/|$)/gi;

function normalizeApiPath(url: string): string {
  try {
    const parsed = new URL(url);
    let pathname = parsed.pathname
      .replace(UUID_RE, "/{id}")
      .replace(NUMERIC_SEGMENT_RE, "/{id}")
      .replace(HASH_SEGMENT_RE, "/{hash}");
    // Remove trailing slash
    pathname = pathname.replace(/\/$/, "") || "/";
    return `${parsed.origin}${pathname}`;
  } catch {
    return url;
  }
}

export function extractApiEndpoints(network: NetworkEntry[]): ApiEndpoint[] {
  const counts = new Map<string, { method: string; url: string; count: number }>();

  for (const entry of network) {
    const type = entry.resourceType?.toLowerCase();
    if (type !== "fetch" && type !== "xhr") continue;
    // Skip static assets accidentally typed as fetch
    if (/\.(js|css|png|jpg|gif|woff2?|svg|ico)(\?|$)/i.test(entry.url)) continue;

    const normalizedUrl = normalizeApiPath(entry.url);
    const key = `${entry.method}:${normalizedUrl}`;
    const existing = counts.get(key);

    if (existing) {
      existing.count += 1;
    } else {
      counts.set(key, { method: entry.method, url: normalizedUrl, count: 1 });
    }
  }

  return Array.from(counts.values()).sort((a, b) => b.count - a.count);
}
