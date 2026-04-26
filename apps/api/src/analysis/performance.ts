import type { Page } from "playwright";
import type { PerformanceMetrics } from "../capture/types.js";

export async function injectPerformanceObservers(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as any).__FCB_LCP = 0;
    (window as any).__FCB_CLS = 0;

    try {
      new PerformanceObserver((list) => {
        const entries = list.getEntries();
        const last = entries[entries.length - 1];
        if (last) (window as any).__FCB_LCP = last.startTime;
      }).observe({ type: "largest-contentful-paint", buffered: true });
    } catch {}

    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!(entry as any).hadRecentInput) {
            (window as any).__FCB_CLS += (entry as any).value;
          }
        }
      }).observe({ type: "layout-shift", buffered: true });
    } catch {}
  });
}

export async function capturePerformanceMetrics(page: Page): Promise<PerformanceMetrics> {
  try {
    return await page.evaluate((): PerformanceMetrics => {
      const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
      const paint = performance.getEntriesByType("paint");
      const fcp = paint.find((p) => p.name === "first-contentful-paint")?.startTime ?? null;

      return {
        ttfb: nav ? nav.responseStart - nav.requestStart : null,
        fcp,
        lcp: (window as any).__FCB_LCP || null,
        cls: (window as any).__FCB_CLS ?? null,
        domContentLoaded: nav ? nav.domContentLoadedEventEnd : null,
        loadTime: nav ? nav.loadEventEnd : null,
      };
    });
  } catch {
    return { ttfb: null, fcp: null, lcp: null, cls: null, domContentLoaded: null, loadTime: null };
  }
}
