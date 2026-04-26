import type { ResourceKind } from "./types.js";

export function classifyResource(url: string, mime: string): ResourceKind {
  const lowerUrl = url.toLowerCase();
  const lowerMime = mime.toLowerCase();

  if (lowerUrl.endsWith(".map") || lowerMime.includes("source-map")) return "map";
  if (lowerMime.includes("text/html")) return "html";
  if (lowerMime.includes("text/css")) return "css";

  if (
    lowerMime.includes("javascript") ||
    lowerMime.includes("ecmascript") ||
    lowerUrl.endsWith(".js") ||
    lowerUrl.endsWith(".mjs")
  ) {
    return "js";
  }

  if (lowerMime.includes("json") || lowerUrl.endsWith(".json")) return "json";
  if (lowerMime.includes("image/svg") || lowerUrl.endsWith(".svg")) return "svg";
  if (lowerMime.startsWith("image/")) return "image";

  if (
    lowerMime.includes("font") ||
    lowerUrl.endsWith(".woff") ||
    lowerUrl.endsWith(".woff2") ||
    lowerUrl.endsWith(".ttf") ||
    lowerUrl.endsWith(".otf")
  ) {
    return "font";
  }

  if (lowerMime.includes("wasm") || lowerUrl.endsWith(".wasm")) return "wasm";

  return "other";
}

export function folderForKind(kind: ResourceKind): string {
  switch (kind) {
    case "html":
      return "resources/html";
    case "css":
      return "resources/css/original";
    case "js":
      return "resources/js/original";
    case "json":
      return "resources/json";
    case "image":
      return "resources/images";
    case "font":
      return "resources/fonts";
    case "wasm":
      return "resources/wasm";
    case "map":
      return "resources/maps";
    case "svg":
      return "resources/svg";
    default:
      return "resources/other";
  }
}
