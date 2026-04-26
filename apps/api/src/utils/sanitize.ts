export function safeFilePart(input: string): string {
  return input
    .replace(/^https?:\/\//i, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 80);
}

export function normalizeUrl(input: string): string {
  const url = new URL(input);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Only http/https URLs are allowed");
  }
  return url.toString();
}

export function sameOriginOrAsset(baseUrl: string, targetUrl: string): boolean {
  const base = new URL(baseUrl);
  const target = new URL(targetUrl);
  return base.hostname === target.hostname;
}
