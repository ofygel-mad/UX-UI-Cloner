import { startApiServer, type ApiServerHandle } from "../../api/src/app.ts";

export type DesktopRuntimeInfo = {
  apiBase: string;
  appVersion: string;
  platform: string;
  storageRoot: string;
};

export async function startEmbeddedApi(options: {
  appVersion: string;
  platform: string;
  playwrightBrowsersPath?: string;
  storageRoot: string;
}): Promise<{
  apiHandle: ApiServerHandle;
  runtimeInfo: DesktopRuntimeInfo;
}> {
  process.env.FCB_STORAGE_ROOT = options.storageRoot;

  if (options.playwrightBrowsersPath) {
    process.env.PLAYWRIGHT_BROWSERS_PATH = options.playwrightBrowsersPath;
  }

  const apiHandle = await startApiServer({
    host: "127.0.0.1",
    port: 0
  });

  return {
    apiHandle,
    runtimeInfo: {
      apiBase: apiHandle.baseUrl,
      appVersion: options.appVersion,
      platform: options.platform,
      storageRoot: options.storageRoot
    }
  };
}
