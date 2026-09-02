import { formatRelativeTime } from "../lib/i18n";
import { projectMediaStorage } from "../lib/projects";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const now = Date.parse("2026-07-27T12:00:00Z");

const justNow = formatRelativeTime("en", now - 10_000, now).toLowerCase();
assert(justNow.includes("now") || justNow.includes("second"), "just now");
assert(formatRelativeTime("en", now - 5 * 60_000, now).includes("5"), "minutes");
assert(formatRelativeTime("en", now - 3 * 3600_000, now).includes("3"), "hours");
assert(formatRelativeTime("en", now - 3 * 86400_000, now).includes("3"), "days");

const media = new Blob([new Uint8Array(1024)]);
const desktop = projectMediaStorage({
  media,
  mediaPath: "/Volumes/Media/source.mp4",
  mediaSize: 5_000_000_000,
  mediaLastModified: now,
});
assert(!("media" in desktop), "desktop projects do not copy source bytes");
assert(desktop.mediaPath === "/Volumes/Media/source.mp4", "desktop keeps source path");
assert(desktop.mediaSize === 5_000_000_000, "desktop keeps source size");

const web = projectMediaStorage({
  media,
  mediaPath: null,
  mediaSize: media.size,
  mediaLastModified: now,
});
assert(web.media === media, "web projects retain Blob fallback");

console.log("ALL PROJECT HELPER TESTS PASSED");
