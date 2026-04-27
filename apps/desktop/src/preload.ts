import { contextBridge, ipcRenderer } from "electron";
import type { ImportedSessionSnapshot } from "../../api/src/capture/types.ts";

contextBridge.exposeInMainWorld("desktopAPI", {
  getRuntimeInfo: async () => {
    return ipcRenderer.invoke("desktop:get-runtime-info");
  },
  openExternal: async (url: string) => {
    return ipcRenderer.invoke("desktop:open-external", url);
  },
  saveTextFile: async (options: {
    defaultPath: string;
    content: string;
    title?: string;
  }) => {
    return ipcRenderer.invoke("desktop:save-text-file", options);
  },
  extractTabSession: async (options: {
    webContentsId: number;
    sourceUrl: string;
  }): Promise<ImportedSessionSnapshot> => {
    return ipcRenderer.invoke("desktop:extract-tab-session", options);
  }
});

declare global {
  interface Window {
    desktopAPI: {
      getRuntimeInfo: () => Promise<{
        apiBase: string;
        appVersion: string;
        platform: string;
        storageRoot: string;
      }>;
      openExternal: (url: string) => Promise<void>;
      saveTextFile: (options: {
        defaultPath: string;
        content: string;
        title?: string;
      }) => Promise<string | null>;
      extractTabSession: (options: {
        webContentsId: number;
        sourceUrl: string;
      }) => Promise<ImportedSessionSnapshot>;
    };
  }
}
