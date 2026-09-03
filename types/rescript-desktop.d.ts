import type { UiLocale } from "@/lib/i18n/locales";
import type { Word } from "@/lib/types";

/** Resting sizes the Electron shell switches between. */
export type WindowMode = "compact" | "expanded";

export interface ResolvedDesktopMedia {
  path: string;
  url: string;
  size: number;
  lastModified: number;
  type: string;
}

export interface DesktopAudioExtraction {
  /** False when no native FFmpeg executable is available; the renderer falls back to wasm. */
  available: boolean;
  /** Null means the selected media has no audio track. */
  audio?: ArrayBuffer | null;
}

export interface DesktopCoreMLTranscription {
  /** False only when the native helper is absent from this build. */
  available: boolean;
  words?: Word[];
  audioDuration?: number;
  processingTime?: number;
  realtimeFactor?: number;
  model?: string;
}

export interface DesktopMediaExportOptions {
  sourcePath: string;
  kind: "video" | "audio";
  format: "mp4" | "webm" | "m4a" | "mp3" | "wav";
  resolution?: "original" | "720" | "1080" | "2160";
  withAudio?: boolean;
  keepRanges: Array<{ start: number; end: number }>;
  editedDuration: number;
}

export interface DesktopMediaExportResult {
  available: boolean;
  url?: string;
}

/** Actions the native File menu delegates to the renderer over IPC. Opening the
 *  file picker isn't one of them — a file chooser needs user activation, so the
 *  main process calls `window.rescriptOpenFilePicker` instead. */
export type MenuCommand =
  | { type: "open-project"; id: string }
  | { type: "clear-recents" }
  /** Leave the editor for the upload screen (an intercepted window close). */
  | { type: "close-project" };

/** Desktop bridge exposed by electron/preload.ts when running inside Electron. */
export interface RescriptDesktop {
  platform: NodeJS.Platform;
  /** Physical memory reported by the host, used to avoid oversized GPU models. */
  systemMemoryBytes: number;
  nativeMediaAvailable: boolean;
  /** True when this Apple-Silicon build contains the Core ML speech helper. */
  nativeTranscriptionAvailable: boolean;
  versions: {
    electron: string;
    chrome: string;
    node: string;
  };
  /** Resize the shell: "compact" for the upload screen, "expanded" for the editor. */
  setWindowMode: (mode: WindowMode) => void;
  /** Mirror the telemetry opt-out to the main process, which gates its own reporting. */
  setTelemetryEnabled: (enabled: boolean) => void;
  /** Keep native menus and dialogs aligned with the resolved UI locale. */
  setUiLocale: (locale: UiLocale) => void;
  /** Publish the saved-project list (newest first) for File › Recent Projects. */
  setRecentProjects: (projects: Array<{ id: string; name: string }>) => void;
  /** Resolve the disk path Chromium associates with a user-selected File. */
  getFilePath: (file: File) => string | null;
  /** Reopen a path-backed project, asking the user to locate a moved source when needed. */
  resolveMediaPath: (
    path: string,
    expectedName: string
  ) => Promise<ResolvedDesktopMedia | null>;
  /** Extract mono 16 kHz PCM with native FFmpeg when the desktop host provides it. */
  extractAudio: (path: string) => Promise<DesktopAudioExtraction>;
  /** Transcribe with the bundled Core ML Parakeet engine. */
  transcribeCoreML: (
    path: string,
    onProgress: (progress: { stage: string; fraction: number }) => void
  ) => Promise<DesktopCoreMLTranscription>;
  cancelCoreMLTranscription: () => void;
  /** Build an H.264 viewing proxy without changing the source used for export. */
  prepareVideoPreview: (
    path: string,
    duration: number,
    onProgress: (ratio: number) => void
  ) => Promise<{ available: boolean; url?: string }>;
  cancelVideoPreview: () => void;
  /** Render directly from a path-backed source without copying it into Chromium. */
  exportMedia: (
    options: DesktopMediaExportOptions,
    onProgress: (ratio: number) => void
  ) => Promise<DesktopMediaExportResult>;
  /** Subscribe to File-menu actions; returns an unsubscribe function. */
  onMenuCommand: (callback: (command: MenuCommand) => void) => () => void;
  isFullScreen: () => Promise<boolean>;
  /** Subscribe to full-screen changes; returns an unsubscribe function. */
  onFullScreenChange: (callback: (value: boolean) => void) => () => void;
}

declare global {
  interface Window {
    rescriptDesktop?: RescriptDesktop;
    /** Opens the media picker. Set by the renderer, called by the main process
     *  through executeJavaScript so the dialog gets a user activation. */
    rescriptOpenFilePicker?: () => void;
  }
}

export {};
