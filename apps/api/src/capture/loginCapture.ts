import { chromium, type Browser, type BrowserContext } from "playwright";

export type LoginAction =
  | { type: "goto"; url: string }
  | { type: "fill"; selector: string; value: string }
  | { type: "click"; selector: string; waitMs?: number }
  | { type: "wait"; selector: string; timeoutMs?: number }
  | { type: "screenshot"; path?: string };

export type LoginSessionSnapshot = {
  sourceUrl: string;
  cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    expires?: number;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: "Strict" | "Lax" | "None";
  }>;
  storages: Array<{
    origin: string;
    localStorage: Record<string, string>;
    sessionStorage: Record<string, string>;
  }>;
};

export async function captureLoginSession(
  actions: LoginAction[],
  timeoutMs: number = 60000
): Promise<LoginSessionSnapshot> {
  const browser = await chromium.launch({ headless: true });
  let context: BrowserContext | null = null;

  try {
    context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();

    const startTime = Date.now();

    for (const action of actions) {
      if (Date.now() - startTime > timeoutMs) {
        throw new Error(`Login capture timeout exceeded (${timeoutMs}ms)`);
      }

      if (action.type === "goto") {
        await page.goto(action.url, { waitUntil: "networkidle", timeout: 15000 });
      } else if (action.type === "fill") {
        await page.fill(action.selector, action.value);
      } else if (action.type === "click") {
        await page.click(action.selector);
        if (action.waitMs) {
          await page.waitForTimeout(action.waitMs);
        } else {
          await page.waitForLoadState("networkidle").catch(() => {});
        }
      } else if (action.type === "wait") {
        await page.waitForSelector(action.selector, { timeout: action.timeoutMs ?? 5000 });
      } else if (action.type === "screenshot") {
        const path = action.path || `./login_screenshot_${Date.now()}.png`;
        await page.screenshot({ path, fullPage: true });
      }
    }

    // Extract session
    const cookieObjects = await context.cookies();
    const cookies = cookieObjects.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      expires: c.expires,
      httpOnly: c.httpOnly,
      secure: c.secure,
      sameSite: c.sameSite as "Strict" | "Lax" | "None" | undefined
    }));

    // Get storage
    const storages = await page.evaluate(() => {
      const origins: string[] = [];
      const iframes = document.querySelectorAll("iframe");
      origins.push(window.location.origin);
      iframes.forEach((iframe) => {
        try {
          origins.push(iframe.contentWindow?.location.origin || "");
        } catch {}
      });

      return Array.from(new Set(origins))
        .filter((o) => o && o !== "")
        .map((origin) => ({
          origin,
          localStorage: {},
          sessionStorage: {}
        }));
    });

    // Populate storage data from main page
    const mainStorage = await page.evaluate(() => ({
      localStorage: { ...window.localStorage },
      sessionStorage: { ...window.sessionStorage }
    }));

    if (storages.length > 0) {
      storages[0].localStorage = mainStorage.localStorage;
      storages[0].sessionStorage = mainStorage.sessionStorage;
    }

    return {
      sourceUrl: page.url(),
      cookies,
      storages
    };
  } finally {
    if (context) {
      await context.close();
    }
    await browser.close();
  }
}
