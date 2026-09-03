import {
  contextBridge,
  ipcRenderer,
  webUtils,
  type IpcRendererEvent,
} from "electron";
import { totalmem } from "node:os";

let activeCoreMLJobId: string | null = null;
let activePreviewJobId: string | null = null;

/**
 * Minimal bridge for the renderer. Rescript's UI is still a normal web
 * surface; we only expose host metadata so the page can adapt chrome / skip
 * the COI service worker (headers come from the app:// protocol instead),
 * plus the few window controls the page drives (sizing, title-bar state).
 */
contextBridge.exposeInMainWorld("rescriptDesktop", {
  platform: process.platform as NodeJS.Platform,
  systemMemoryBytes: totalmem(),
  nativeMediaAvailable: ipcRenderer.sendSync("media:native-available") === true,
  nativeTranscriptionAvailable:
    ipcRenderer.sendSync("transcription:coreml-available") === true,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
  /** Switch between the compact upload window and the full editor window. */
  setWindowMode: (mode: "compact" | "expanded") => {
    ipcRenderer.send("window:set-mode", mode);
  },
  /**
   * Mirror the renderer's telemetry preference into the main process, which can't
   * read localStorage but needs the preference to gate its own crash reporting.
   */
  setTelemetryEnabled: (enabled: boolean) => {
    ipcRenderer.send("telemetry:set-enabled", enabled);
  },
  /** Keep native menus and dialogs in sync with the renderer preference. */
  setUiLocale: (locale: string) => {
    ipcRenderer.send("ui:set-locale", locale);
  },
  /**
   * Publish the saved-project list (newest first) so the main process can draw
   * it under File › Recent Projects. Only id + name are sent.
   */
  setRecentProjects: (projects: Array<{ id: string; name: string }>) => {
    ipcRenderer.send(
      "menu:set-recents",
      projects.map(({ id, name }) => ({ id, name }))
    );
  },
  getFilePath: (file: File): string | null => {
    const path = webUtils.getPathForFile(file);
    return path || null;
  },
  resolveMediaPath: (path: string, expectedName: string) =>
    ipcRenderer.invoke("media:resolve-path", path, expectedName),
  extractAudio: (path: string) => ipcRenderer.invoke("media:extract-audio", path),
  prepareAudioPreview: (path: string) =>
    ipcRenderer.invoke("media:prepare-audio-preview", path),
  transcribeCoreML: async (
    path: string,
    onProgress: (progress: { stage: string; fraction: number }) => void
  ) => {
    const jobId = crypto.randomUUID();
    const channel = `transcription:coreml-progress:${jobId}`;
    const listener = (_event: IpcRendererEvent, value: unknown) => {
      if (!value || typeof value !== "object") return;
      const progress = value as { stage?: unknown; fraction?: unknown };
      if (
        typeof progress.stage === "string" &&
        typeof progress.fraction === "number"
      ) {
        onProgress({ stage: progress.stage, fraction: progress.fraction });
      }
    };
    activeCoreMLJobId = jobId;
    ipcRenderer.on(channel, listener);
    try {
      return await ipcRenderer.invoke("transcription:coreml", jobId, path);
    } finally {
      ipcRenderer.off(channel, listener);
      if (activeCoreMLJobId === jobId) activeCoreMLJobId = null;
    }
  },
  cancelCoreMLTranscription: () => {
    if (!activeCoreMLJobId) return;
    ipcRenderer.send("transcription:cancel", activeCoreMLJobId);
    activeCoreMLJobId = null;
  },
  prepareVideoPreview: async (
    path: string,
    duration: number,
    onProgress: (ratio: number) => void
  ) => {
    const jobId = crypto.randomUUID();
    const channel = `media:preview-progress:${jobId}`;
    const listener = (_event: IpcRendererEvent, value: unknown) => {
      if (typeof value === "number" && Number.isFinite(value)) onProgress(value);
    };
    activePreviewJobId = jobId;
    ipcRenderer.on(channel, listener);
    try {
      return await ipcRenderer.invoke("media:prepare-preview", jobId, path, duration);
    } finally {
      ipcRenderer.off(channel, listener);
      if (activePreviewJobId === jobId) activePreviewJobId = null;
    }
  },
  cancelVideoPreview: () => {
    if (!activePreviewJobId) return;
    ipcRenderer.send("media:preview-cancel", activePreviewJobId);
    activePreviewJobId = null;
  },
  exportMedia: async (
    options: unknown,
    onProgress: (ratio: number) => void
  ) => {
    const jobId = crypto.randomUUID();
    const channel = `media:export-progress:${jobId}`;
    const listener = (_event: IpcRendererEvent, value: unknown) => {
      if (typeof value === "number" && Number.isFinite(value)) onProgress(value);
    };
    ipcRenderer.on(channel, listener);
    try {
      return await ipcRenderer.invoke("media:export", jobId, options);
    } finally {
      ipcRenderer.off(channel, listener);
    }
  },
  /** Subscribe to File-menu actions; returns an unsubscribe function. */
  onMenuCommand: (callback: (command: unknown) => void) => {
    const listener = (_event: IpcRendererEvent, command: unknown) => callback(command);
    ipcRenderer.on("menu:command", listener);
    // Tell the main process the page is listening, so commands fired at a
    // window that was opened *by* the menu aren't lost before mount.
    ipcRenderer.send("menu:renderer-ready");
    return () => {
      ipcRenderer.off("menu:command", listener);
    };
  },
  isFullScreen: (): Promise<boolean> => ipcRenderer.invoke("window:is-full-screen"),
  onFullScreenChange: (callback: (value: boolean) => void) => {
    const listener = (_event: IpcRendererEvent, value: boolean) => callback(value);
    ipcRenderer.on("window:full-screen-changed", listener);
    return () => {
      ipcRenderer.off("window:full-screen-changed", listener);
    };
  },
});
