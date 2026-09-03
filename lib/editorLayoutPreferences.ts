export const CLEANUP_SIDEBAR_STORAGE_KEY = "kwikscript.cleanup-sidebar-visible";
export const VIDEO_PREVIEW_STORAGE_KEY = "kwikscript.video-preview-visible";
export const WORD_CLICK_PLAYBACK_STORAGE_KEY =
  "kwikscript.word-click-playback";

function loadBoolean(storageKey: string, fallback: boolean): boolean {
  if (typeof window === "undefined") return fallback;
  try {
    const stored = window.localStorage.getItem(storageKey);
    return stored == null ? fallback : stored === "true";
  } catch {
    return fallback;
  }
}

function saveBoolean(storageKey: string, value: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey, String(value));
  } catch {
    // Private mode or disabled storage: keep the current session usable.
  }
}

export function loadCleanupSidebarVisible(): boolean {
  return loadBoolean(CLEANUP_SIDEBAR_STORAGE_KEY, true);
}

export function saveCleanupSidebarVisible(value: boolean): void {
  saveBoolean(CLEANUP_SIDEBAR_STORAGE_KEY, value);
}

export function loadVideoPreviewVisible(): boolean {
  return loadBoolean(VIDEO_PREVIEW_STORAGE_KEY, true);
}

export function saveVideoPreviewVisible(value: boolean): void {
  saveBoolean(VIDEO_PREVIEW_STORAGE_KEY, value);
}

export function loadWordClickPlayback(): boolean {
  return loadBoolean(WORD_CLICK_PLAYBACK_STORAGE_KEY, true);
}

export function saveWordClickPlayback(value: boolean): void {
  saveBoolean(WORD_CLICK_PLAYBACK_STORAGE_KEY, value);
}
