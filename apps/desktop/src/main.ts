import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  type BrowserWindowConstructorOptions
} from "electron";
import { startApiServer, type ApiServerHandle } from "../../api/src/app.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_WINDOW_STATE = {
  width: 1680,
  height: 1040
};

let apiHandle: ApiServerHandle | null = null;
let runtimeInfo: {
  apiBase: string;
  appVersion: string;
  platform: string;
  storageRoot: string;
} | null = null;

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

async function saveWindowState(window: BrowserWindow): Promise<void> {
  const bounds = window.getBounds();
  const stateFile = path.join(app.getPath("userData"), "window-state.json");
  await mkdir(path.dirname(stateFile), { recursive: true });
  await writeFile(stateFile, JSON.stringify(bounds, null, 2), "utf-8");
}

async function ensureApiServer(): Promise<ApiServerHandle> {
  if (apiHandle) return apiHandle;

  const storageRoot = path.join(app.getPath("userData"), "storage");
  process.env.FCB_STORAGE_ROOT = storageRoot;

  apiHandle = await startApiServer({
    host: "127.0.0.1",
    port: 0
  });

  runtimeInfo = {
    apiBase: apiHandle.baseUrl,
    appVersion: app.getVersion(),
    platform: process.platform,
    storageRoot
  };

  return apiHandle;
}

async function createMainWindow(): Promise<BrowserWindow> {
  await ensureApiServer();
  const state = await readWindowState(app.getPath("userData"));

  const window = new BrowserWindow({
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
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true
    }
  });

  const rendererPath = path.join(__dirname, "renderer", "index.html");
  await window.loadFile(rendererPath);

  window.on("close", () => {
    void saveWindowState(window);
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  return window;
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

app.whenReady().then(async () => {
  await createMainWindow();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow();
    }
  });
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
