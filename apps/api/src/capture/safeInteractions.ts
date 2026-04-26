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
  "register",
  "upload",
  "authorize",
  "connect wallet",
  "купить",
  "оплатить",
  "удалить",
  "отправить",
  "подтвердить",
  "заказать",
  "войти",
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

export async function runSafeInteractions(
  page: Page,
  maxActions: number
): Promise<InteractionLog[]> {
  const logs: InteractionLog[] = [];

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

  const candidates = await page.locator(CANDIDATE_SELECTORS).evaluateAll((elements) => {
    return elements.slice(0, 120).map((el, index) => {
      const element = el as HTMLElement;
      const text = (element.innerText || "").trim();
      const aria = element.getAttribute("aria-label") || "";
      const title = element.getAttribute("title") || "";
      const href = element.getAttribute("href") || "";
      const label = [text, aria, title, href].filter(Boolean).join(" ");

      return {
        index,
        tag: element.tagName.toLowerCase(),
        label: label.slice(0, 160)
      };
    });
  });

  let completed = 0;

  for (const candidate of candidates) {
    if (completed >= maxActions) break;

    const label = candidate.label || candidate.tag;

    if (isRiskyLabel(label)) {
      logs.push({
        id: `action_${candidate.index}`,
        type: "click",
        label,
        status: "skipped",
        reason: "Risky label"
      });
      continue;
    }

    if (!isSafeLabel(label)) {
      logs.push({
        id: `action_${candidate.index}`,
        type: "click",
        label,
        status: "skipped",
        reason: "Not recognized as safe UI interaction"
      });
      continue;
    }

    try {
      const locator = page.locator(CANDIDATE_SELECTORS).nth(candidate.index);

      await locator.hover({ timeout: 1500 }).catch(() => undefined);
      await page.waitForTimeout(200);

      await locator.click({
        timeout: 2000,
        force: false,
        trial: false,
        noWaitAfter: true
      });

      await page.waitForTimeout(900);
      await page.keyboard.press("Escape").catch(() => undefined);

      logs.push({
        id: `action_${candidate.index}`,
        type: "click",
        label,
        status: "completed"
      });

      completed += 1;
    } catch (error) {
      logs.push({
        id: `action_${candidate.index}`,
        type: "click",
        label,
        status: "failed",
        reason: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return logs;
}
