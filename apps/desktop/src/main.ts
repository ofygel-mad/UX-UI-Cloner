import os from "node:os";
import path from "node:path";
import { appendFileSync } from "node:fs";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import type { ApiServerHandle } from "../../api/src/app.ts";
import type { DesktopRuntimeInfo } from "./api-runtime.ts";
import type { BrowserWindow as ElectronBrowserWindow, BrowserWindowConstructorOptions } from "electron";
import type { ImportedSessionSnapshot } from "../../api/src/capture/types.ts";

const DEFAULT_WINDOW_STATE = {
  width: 1680,
  height: 1040
};
const RUNTIME_LOG_FILE = path.join(os.tmpdir(), "frontend-capture-browser-runtime.log");
const TRACE_LOG_FILE = path.join(os.tmpdir(), "frontend-capture-browser-trace.log");

let apiHandle: ApiServerHandle | null = null;
let mainWindow: ElectronBrowserWindow | null = null;
let runtimeInfo: DesktopRuntimeInfo | null = null;
let startEmbeddedApi:
  | ((options: {
      appVersion: string;
      platform: string;
      playwrightBrowsersPath?: string;
      storageRoot: string;
    }) => Promise<{
      apiHandle: ApiServerHandle;
      runtimeInfo: DesktopRuntimeInfo;
    }>)
  | null = null;

function writeTrace(message: string): void {
  if (process.env.FCB_RUNTIME_TRACE !== "1") {
    return;
  }

  try {
    appendFileSync(TRACE_LOG_FILE, `[${new Date().toISOString()}] ${message}\n`, "utf-8");
  } catch {
    // Ignore trace write failures during diagnostics.
  }
}

function serializeError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}\n${error.stack || ""}`;
  }

  return String(error);
}

async function writeRuntimeLog(message: string): Promise<void> {
  await appendFile(
    RUNTIME_LOG_FILE,
    `[${new Date().toISOString()}] ${message}\n`,
    "utf-8"
  ).catch(() => undefined);
}

function writeBootLog(message: string): void {
  try {
    appendFileSync(RUNTIME_LOG_FILE, `[${new Date().toISOString()}] boot ${message}\n`, "utf-8");
  } catch {
    // Ignore early boot logging failures.
  }
}

process.on("uncaughtException", (error) => {
  void writeRuntimeLog(`uncaughtException\n${serializeError(error)}`);
});

process.on("unhandledRejection", (reason) => {
  void writeRuntimeLog(`unhandledRejection\n${serializeError(reason)}`);
});

writeBootLog("module:start");

const electron = (() => {
  try {
    const loaded = require("electron") as typeof import("electron");
    writeBootLog(`electron:keys=${Object.keys(loaded).slice(0, 12).join(",")}`);
    return loaded;
  } catch (error) {
    writeBootLog(`electron:require-failed ${serializeError(error)}`);
    throw error;
  }
})();

const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  webContents
} = electron;

if (typeof app?.whenReady !== "function" || typeof ipcMain?.handle !== "function") {
  const reason = `invalid electron runtime app=${typeof app} ipcMain.handle=${typeof ipcMain?.handle}`;
  writeBootLog(reason);
  throw new Error(reason);
}

app.setName("Frontend Capture Browser");
if (process.platform === "win32") {
  app.setAppUserModelId("com.fcb.desktop");
}

writeBootLog(`app:name=${app.getName()} packaged=${String(app.isPackaged)}`);

function getStartEmbeddedApi() {
  if (startEmbeddedApi) {
    return startEmbeddedApi;
  }

  try {
    const apiRuntime = require("./api-runtime.js") as {
      startEmbeddedApi: (options: {
        appVersion: string;
        platform: string;
        playwrightBrowsersPath?: string;
        storageRoot: string;
      }) => Promise<{
        apiHandle: ApiServerHandle;
        runtimeInfo: DesktopRuntimeInfo;
      }>;
    };

    startEmbeddedApi = apiRuntime.startEmbeddedApi;
    writeBootLog("api-runtime:loaded");
    return startEmbeddedApi;
  } catch (error) {
    writeBootLog(`api-runtime:require-failed ${serializeError(error)}`);
    throw error;
  }
}

async function readWindowState(userDataPath: string): Promise<BrowserWindowConstructorOptions> {
  const stateFile = path.join(userDataPath, "window-state.json");

  try {
    const content = await readFile(stateFile, "utf-8");
    const parsed = JSON.parse(content) as Partial<BrowserWindowConstructorOptions>;
    return {
      ...DEFAULT_WINDOW_STATE,
      ...parsed
    };
  } catch {
    return DEFAULT_WINDOW_STATE;
  }
}

async function saveWindowState(window: ElectronBrowserWindow): Promise<void> {
  const bounds = window.getBounds();
  const stateFile = path.join(app.getPath("userData"), "window-state.json");
  await mkdir(path.dirname(stateFile), { recursive: true });
  await writeFile(stateFile, JSON.stringify(bounds, null, 2), "utf-8");
}

async function ensureApiServer(): Promise<ApiServerHandle> {
  if (apiHandle) return apiHandle;

  writeTrace("ensureApiServer:start");
  const storageRoot = path.join(app.getPath("userData"), "storage");
  const playwrightBrowsersPath = app.isPackaged
    ? path.join(process.resourcesPath, "ms-playwright")
    : undefined;

  if (playwrightBrowsersPath) {
    writeTrace(`ensureApiServer:playwright=${playwrightBrowsersPath}`);
  }

  const started = await getStartEmbeddedApi()({
    appVersion: app.getVersion(),
    platform: process.platform,
    playwrightBrowsersPath,
    storageRoot
  });

  apiHandle = started.apiHandle;
  runtimeInfo = started.runtimeInfo;
  writeTrace(`ensureApiServer:ready:${apiHandle.baseUrl}`);

  return apiHandle;
}

async function createMainWindow(): Promise<ElectronBrowserWindow> {
  writeTrace("createMainWindow:start");
  await ensureApiServer();
  const state = await readWindowState(app.getPath("userData"));

  mainWindow = new BrowserWindow({
    width: Number(state.width) || DEFAULT_WINDOW_STATE.width,
    height: Number(state.height) || DEFAULT_WINDOW_STATE.height,
    x: typeof state.x === "number" ? state.x : undefined,
    y: typeof state.y === "number" ? state.y : undefined,
    minWidth: 1280,
    minHeight: 820,
    backgroundColor: "#08111d",
    title: "Frontend Capture Browser",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true
    }
  });

  const rendererPath = path.join(__dirname, "renderer", "index.html");
  writeTrace(`createMainWindow:loadFile:${rendererPath}`);
  await mainWindow.loadFile(rendererPath);
  writeTrace("createMainWindow:loaded");

  mainWindow.on("close", () => {
    if (mainWindow) {
      void saveWindowState(mainWindow);
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  return mainWindow;
}

ipcMain.handle("desktop:get-runtime-info", async () => {
  await ensureApiServer();

  if (!runtimeInfo) {
    throw new Error("Runtime information is unavailable");
  }

  return runtimeInfo;
});

ipcMain.handle("desktop:open-external", async (_event, url: string) => {
  await shell.openExternal(url);
});

ipcMain.handle(
  "desktop:save-text-file",
  async (
    _event,
    options: {
      defaultPath: string;
      content: string;
      title?: string;
    }
  ) => {
    const result = await dialog.showSaveDialog({
      title: options.title || "Save file",
      defaultPath: options.defaultPath
    });

    if (result.canceled || !result.filePath) {
      return null;
    }

    await mkdir(path.dirname(result.filePath), { recursive: true });
    await writeFile(result.filePath, options.content, "utf-8");
    return result.filePath;
  }
);

ipcMain.handle(
  "desktop:extract-tab-session",
  async (
    _event,
    options: {
      webContentsId: number;
      sourceUrl: string;
    }
  ): Promise<ImportedSessionSnapshot> => {
    const contents = webContents.fromId(options.webContentsId);

    if (!contents) {
      throw new Error("Active browser tab was not found");
    }

    const sessionCookies = await contents.session.cookies.get({});
    const sourceHost = new URL(options.sourceUrl).hostname;
    const cookies = sessionCookies
      .filter((cookie) => {
        const domain = cookie.domain.replace(/^\./, "");
        return sourceHost === domain || sourceHost.endsWith(`.${domain}`);
      })
      .map((cookie) => ({
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path,
        expires: typeof cookie.expirationDate === "number" ? cookie.expirationDate : undefined,
        httpOnly: cookie.httpOnly,
        secure: cookie.secure,
        sameSite: cookie.sameSite === "strict"
          ? "Strict"
          : cookie.sameSite === "no_restriction"
            ? "None"
            : cookie.sameSite === "lax"
              ? "Lax"
              : undefined
      }));

    const userAgent = contents.getUserAgent();

    return {
      sourceUrl: options.sourceUrl,
      userAgent,
      cookies,
      storages: []
    };
  }
);

app.whenReady().then(async () => {
  writeTrace("app.whenReady");
  await createMainWindow();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow();
    }
  });
}).catch(async (error) => {
  await writeRuntimeLog(`app.whenReady failed\n${serializeError(error)}`);
  app.quit();
});

app.on("before-quit", async () => {
  if (apiHandle) {
    await apiHandle.app.close();
    apiHandle = null;
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
