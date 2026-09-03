import {
  loadCleanupSidebarVisible,
  loadVideoPreviewVisible,
  loadWordClickPlayback,
  saveCleanupSidebarVisible,
  saveVideoPreviewVisible,
  saveWordClickPlayback,
} from "../lib/editorLayoutPreferences";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const values = new Map<string, string>();
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: {
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    },
  },
});

assert(loadCleanupSidebarVisible() === true, "cleanup sidebar defaults on");
assert(loadVideoPreviewVisible() === true, "video preview defaults on");
assert(loadWordClickPlayback() === true, "word-click playback defaults on");

saveCleanupSidebarVisible(false);
saveVideoPreviewVisible(false);
saveWordClickPlayback(false);

assert(loadCleanupSidebarVisible() === false, "cleanup choice persists");
assert(loadVideoPreviewVisible() === false, "preview choice persists");
assert(loadWordClickPlayback() === false, "seek-only choice persists");

saveWordClickPlayback(true);
assert(loadWordClickPlayback() === true, "play-on-click choice persists");

console.log("ALL EDITOR LAYOUT PREFERENCE TESTS PASSED");
