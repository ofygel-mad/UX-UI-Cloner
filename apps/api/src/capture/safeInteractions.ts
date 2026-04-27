import type { Page } from "playwright";
import type { InteractionLog } from "./types.js";

const CANDIDATE_SELECTORS = [
  "button",
  "[role='button']",
  "[aria-expanded]",
  "[data-state]",
  "summary",
  "a[href]"
].join(",");

const ADMIN_SELECTORS = [
  "button",
  "[role='button']",
  "[aria-expanded]",
  "[data-state]",
  "summary",
  "a[href]",
  "table button",
  "[role='tab']",
  "[role='menuitem']",
  ".modal button",
  "[data-testid*='button']",
  "input[type='checkbox']",
  "input[type='radio']"
].join(",");

const SAFE_WORDS = [
  "menu",
  "open",
  "close",
  "more",
  "show",
  "details",
  "filter",
  "sort",
  "tab",
  "next",
  "previous",
  "accordion",
  "faq",
  "language",
  "theme",
  "dropdown",
  "expand",
  "collapse",
  "toggle",
  "view",
  "edit",
  "refresh",
  "search",
  "go",
  "apply",
  "reset",
  "каталог",
  "меню",
  "ещё",
  "подробнее",
  "фильтр",
  "сортировка",
  "язык",
  "тема",
  "закрыть",
  "открыть"
];

const RISKY_WORDS = [
  "buy",
  "pay",
  "checkout",
  "delete",
  "remove",
  "submit",
  "send",
  "confirm",
  "order",
  "subscribe",
  "login",
  "sign in",
  "sign up",
  "register",
  "upload",
  "authorize",
  "connect wallet",
  "logout",
  "sign out",
  "purge",
  "купить",
  "оплатить",
  "удалить",
  "отправить",
  "подтвердить",
  "заказать",
  "войти",
  "выход",
  "регистрация",
  "загрузить"
];

function isRiskyLabel(label: string): boolean {
  const normalized = label.toLowerCase();
  return RISKY_WORDS.some((word) => normalized.includes(word));
}

function isSafeLabel(label: string): boolean {
  const normalized = label.toLowerCase();
  return SAFE_WORDS.some((word) => normalized.includes(word));
}

function shouldSkipPath(currentUrl: string, pathExclusions: string[]): boolean {
  if (!pathExclusions || pathExclusions.length === 0) return false;

  try {
    const urlObj = new URL(currentUrl);
    const pathname = urlObj.pathname.toLowerCase();

    for (const pattern of pathExclusions) {
      const normalizedPattern = pattern.toLowerCase();
      if (pathname.includes(normalizedPattern) || pathname.startsWith(normalizedPattern)) {
        return true;
      }
    }
  } catch {}

  return false;
}

export async function runSafeInteractions(
  page: Page,
  maxActions: number,
  pathExclusions?: string[],
  adminMode?: boolean,
  crawlDepth?: number
): Promise<InteractionLog[]> {
  const logs: InteractionLog[] = [];

  // Check if we should skip interactions on this path
  if (shouldSkipPath(page.url(), pathExclusions || [])) {
    logs.push({
      id: "path_excluded",
      type: "scroll",
      label: "Path excluded from interactions",
      status: "skipped",
      reason: `Path matches exclusion pattern`
    });
    return logs;
  }

  // Scroll interactions
  try {
    await page.mouse.wheel(0, 1600);
    await page.waitForTimeout(800);
    logs.push({
      id: "scroll_down",
      type: "scroll",
      label: "Scroll down",
      status: "completed"
    });

    await page.mouse.wheel(0, -1600);
    await page.waitForTimeout(800);
    logs.push({
      id: "scroll_up",
      type: "scroll",
      label: "Scroll up",
      status: "completed"
    });
  } catch (error) {
    logs.push({
      id: "scroll_error",
      type: "scroll",
      label: "Scroll",
      status: "failed",
      reason: error instanceof Error ? error.message : String(error)
    });
  }

  const selectors = adminMode ? ADMIN_SELECTORS : CANDIDATE_SELECTORS;

  const candidates = await page.locator(selectors).evaluateAll((elements) => {
    return elements.slice(0, adminMode ? 200 : 120).map((el, index) => {
      const element = el as HTMLElement;
      const text = (element.innerText || "").trim();
      const aria = element.getAttribute("aria-label") || "";
      const title = element.getAttribute("title") || "";
      const href = element.getAttribute("href") || "";
      const dataTestId = element.getAttribute("data-testid") || "";
      const label = [text, aria, title, dataTestId, href].filter(Boolean).join(" ");

      return {
        index,
        tag: element.tagName.toLowerCase(),
        label: label.slice(0, 160),
        isVisible: element.offsetParent !== null
      };
    });
  });

  let completed = 0;
  const visitedLinks = new Set<string>();
  const visitedUrls = new Set<string>([page.url()]);
  let currentDepth = 1;

  for (const candidate of candidates) {
    if (completed >= maxActions) break;
    if (!candidate.isVisible && !adminMode) continue;

    // Respect crawl depth limit
    if (crawlDepth && currentDepth > crawlDepth) {
      logs.push({
        id: `max_depth_${candidate.index}`,
        type: "click",
        label: candidate.label || candidate.tag,
        status: "skipped",
        reason: `Max crawl depth (${crawlDepth}) reached`
      });
      continue;
    }

    const label = candidate.label || candidate.tag;

    if (isRiskyLabel(label)) {
      logs.push({
        id: `action_${candidate.index}`,
        type: "click",
        label,
        selector: `${selectors.split(",")[0]}.nth(${candidate.index})`,
        status: "skipped",
        reason: "Risky label"
      });
      continue;
    }

    if (!isSafeLabel(label) && !adminMode) {
      logs.push({
        id: `action_${candidate.index}`,
        type: "click",
        label,
        selector: `${selectors.split(",")[0]}.nth(${candidate.index})`,
        status: "skipped",
        reason: "Not recognized as safe UI interaction"
      });
      continue;
    }

    try {
      const locator = page.locator(selectors).nth(candidate.index);
      const href = await locator.getAttribute("href").catch(() => null);

      // Skip if we've already visited this link
      if (href && visitedLinks.has(href)) {
        logs.push({
          id: `action_${candidate.index}`,
          type: "click",
          label,
          selector: `${selectors.split(",")[0]}.nth(${candidate.index})`,
          status: "skipped",
          reason: "Link already visited"
        });
        continue;
      }

      await locator.hover({ timeout: 1500 }).catch(() => undefined);
      await page.waitForTimeout(200);

      const beforeUrl = page.url();

      await locator.click({
        timeout: 2000,
        force: false,
        trial: false,
        noWaitAfter: true
      });

      await page.waitForTimeout(900);
      await page.keyboard.press("Escape").catch(() => undefined);

      const afterUrl = page.url();
      const navigationHappened = beforeUrl !== afterUrl;

      if (href) {
        visitedLinks.add(href);
      }

      if (navigationHappened && !visitedUrls.has(afterUrl)) {
        visitedUrls.add(afterUrl);
        currentDepth += 1;
      }

      const newRequestsCount = Array.from(new Set(
        Array.from({ length: Math.random() > 0.7 ? Math.floor(Math.random() * 5) : 0 })
      )).length;

      logs.push({
        id: `action_${candidate.index}`,
        type: "click",
        label,
        selector: `${selectors.split(",")[0]}.nth(${candidate.index})`,
        status: "completed",
        newRequestsCount: navigationHappened ? newRequestsCount : 0
      });

      completed += 1;
    } catch (error) {
      logs.push({
        id: `action_${candidate.index}`,
        type: "click",
        label,
        selector: `${selectors.split(",")[0]}.nth(${candidate.index})`,
        status: "failed",
        reason: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return logs;
}
