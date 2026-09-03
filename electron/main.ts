import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  protocol,
  screen,
  shell,
  net,
  type OpenDialogOptions,
  type WebContents,
} from "electron";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  normalize,
} from "node:path";
import { pathToFileURL } from "node:url";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { tmpdir } from "node:os";
import { initMainSentry, setMainTelemetryEnabled } from "./sentry";
import { initAutoUpdater } from "./updater";
import {
  buildAppMenu,
  setRecentProjects,
  type MenuCommand,
  type RecentProject,
} from "./menu";
import {
  isDesktopLocale,
  resolveDesktopLocale,
  setDesktopLocale,
} from "./locale";

const isDev = !app.isPackaged;
const DEV_SERVER_URL = process.env.ELECTRON_START_URL ?? "http://localhost:3000";
const isMac = process.platform === "darwin";

const MEDIA_EXTENSIONS = [
  "mp4",
  "webm",
  "mov",
  "mkv",
  "m4v",
  "mp3",
  "wav",
  "m4a",
  "aac",
  "ogg",
  "flac",
  "opus",
];

/** Source paths are represented by opaque app:// URLs in the renderer. */
const mediaPaths = new Map<string, string>();
const exportTempDirs = new Set<string>();
const nativeTranscriptionJobs = new Map<string, ChildProcess>();
const previewTempDirs = new Set<string>();
const nativePreviewJobs = new Map<string, ChildProcess>();
const previewBySource = new Map<string, { identity: string; url: string }>();
const audioPreviewTempDirs = new Set<string>();
const audioPreviewJobs = new Set<ChildProcess>();
const audioPreviewBySource = new Map<string, { identity: string; url: string }>();

function readableFile(path: unknown): path is string {
  if (typeof path !== "string" || !isAbsolute(path) || !existsSync(path)) return false;
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function mediaMime(path: string): string {
  const ext = extname(path).toLowerCase();
  if ([".mp4", ".m4v"].includes(ext)) return "video/mp4";
  if (ext === ".mov") return "video/quicktime";
  if (ext === ".webm") return "video/webm";
  if (ext === ".mp3") return "audio/mpeg";
  if (ext === ".wav") return "audio/wav";
  if ([".m4a", ".aac"].includes(ext)) return "audio/mp4";
  if (ext === ".flac") return "audio/flac";
  if (ext === ".ogg" || ext === ".opus") return "audio/ogg";
  return "application/octet-stream";
}

function registerMediaPath(path: string) {
  const token = randomUUID();
  mediaPaths.set(token, path);
  const stat = statSync(path);
  return {
    path,
    url: `app://localhost/__media/${token}/${encodeURIComponent(basename(path))}`,
    size: stat.size,
    lastModified: stat.mtimeMs,
    type: mediaMime(path),
  };
}

function nativeFfmpegPath(): string | null {
  const candidates = [
    process.env.RESCRIPT_FFMPEG_PATH,
    process.platform === "darwin" ? "/opt/homebrew/bin/ffmpeg" : undefined,
    process.platform === "darwin" ? "/usr/local/bin/ffmpeg" : undefined,
    process.platform === "linux" ? "/usr/bin/ffmpeg" : undefined,
  ];
  return candidates.find((path): path is string => readableFile(path)) ?? null;
}

function nativeCoreMLTranscriberPath(): string | null {
  if (process.platform !== "darwin" || process.arch !== "arm64") return null;
  const candidates = [
    process.env.RESCRIPT_COREML_TRANSCRIBER_PATH,
    isDev
      ? join(
          app.getAppPath(),
          "native",
          "coreml-transcriber",
          ".build",
          "release",
          "rescript-coreml-transcriber"
        )
      : join(process.resourcesPath, "native", "rescript-coreml-transcriber"),
  ];
  return candidates.find((path): path is string => readableFile(path)) ?? null;
}

function runNativeProcess(
  jobId: string,
  executable: string,
  args: string[],
  onStderr?: (text: string) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { stdio: ["ignore", "ignore", "pipe"] });
    nativeTranscriptionJobs.set(jobId, child);
    const errors: Buffer[] = [];
    let errorBytes = 0;
    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      onStderr?.(text);
      if (errorBytes >= 64 * 1024) return;
      errors.push(chunk);
      errorBytes += chunk.byteLength;
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (nativeTranscriptionJobs.get(jobId) === child) {
        nativeTranscriptionJobs.delete(jobId);
      }
      if (code === 0) {
        resolve();
        return;
      }
      const detail = Buffer.concat(errors).toString("utf8").trim();
      reject(
        new Error(
          signal
            ? "Native transcription was cancelled."
            : detail || `Native transcription exited with code ${code ?? "unknown"}.`
        )
      );
    });
  });
}

async function transcribeCoreML(
  jobId: string,
  mediaPath: string,
  onProgress: (value: { stage: string; fraction: number }) => void
) {
  const ffmpeg = nativeFfmpegPath();
  const transcriber = nativeCoreMLTranscriberPath();
  if (!ffmpeg || !transcriber) return { available: false as const };

  const dir = mkdtempSync(join(tmpdir(), "rescript-coreml-"));
  const audioPath = join(dir, "audio.wav");
  const outputPath = join(dir, "transcript.json");
  try {
    onProgress({ stage: "extracting-audio", fraction: 0 });
    await runNativeProcess(jobId, ffmpeg, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      mediaPath,
      "-map",
      "0:a:0",
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-c:a",
      "pcm_s16le",
      "-y",
      audioPath,
    ]);
    onProgress({ stage: "extracting-audio", fraction: 1 });

    let stderrBuffer = "";
    await runNativeProcess(jobId, transcriber, [audioPath, outputPath], (text) => {
      stderrBuffer += text;
      const lines = stderrBuffer.split("\n");
      stderrBuffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("RESCRIPT_PROGRESS ")) continue;
        try {
          const value = JSON.parse(line.slice("RESCRIPT_PROGRESS ".length)) as {
            stage?: unknown;
            fraction?: unknown;
          };
          if (
            typeof value.stage === "string" &&
            typeof value.fraction === "number" &&
            Number.isFinite(value.fraction)
          ) {
            onProgress({
              stage: value.stage,
              fraction: Math.min(1, Math.max(0, value.fraction)),
            });
          }
        } catch {
          // Other Core ML diagnostics are deliberately ignored.
        }
      }
    });

    const parsed = JSON.parse(readFileSync(outputPath, "utf8")) as {
      words?: unknown;
      audioDuration?: unknown;
      processingTime?: unknown;
      realtimeFactor?: unknown;
      model?: unknown;
    };
    if (!Array.isArray(parsed.words)) {
      throw new Error("The native speech model returned an invalid transcript.");
    }
    return { available: true as const, ...parsed };
  } finally {
    nativeTranscriptionJobs.delete(jobId);
    rmSync(dir, { recursive: true, force: true });
  }
}

async function extractAudioNative(path: string): Promise<ArrayBuffer | null> {
  const ffmpeg = nativeFfmpegPath();
  if (!ffmpeg) throw new Error("NATIVE_FFMPEG_UNAVAILABLE");
  return new Promise((resolve, reject) => {
    const child = spawn(
      ffmpeg,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        path,
        "-map",
        "0:a:0?",
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-f",
        "f32le",
        "pipe:1",
      ],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    const chunks: Buffer[] = [];
    const errors: Buffer[] = [];
    let errorBytes = 0;
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => {
      if (errorBytes >= 64 * 1024) return;
      errors.push(chunk);
      errorBytes += chunk.byteLength;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      const output = Buffer.concat(chunks);
      if (code !== 0 && output.byteLength === 0) {
        const message = Buffer.concat(errors).toString("utf8");
        if (/does not contain any stream|matches no streams/i.test(message)) {
          resolve(null);
          return;
        }
        reject(new Error(message.trim() || "Native audio extraction failed."));
        return;
      }
      const copy = Uint8Array.from(output);
      resolve(copy.buffer);
    });
  });
}

/**
 * Build a small, seek-friendly audio track for edited preview playback.
 * Seeking a long-GOP HEVC video can stall Chromium for hundreds of
 * milliseconds at every cut; the audio proxy stays responsive while the
 * muted picture catches up. It never replaces the source used for export.
 */
async function prepareAudioPreviewNative(mediaPath: string): Promise<string | null> {
  const ffmpeg = nativeFfmpegPath();
  if (!ffmpeg) throw new Error("NATIVE_FFMPEG_UNAVAILABLE");

  const stat = statSync(mediaPath);
  const identity = `${stat.size}:${stat.mtimeMs}`;
  const cached = audioPreviewBySource.get(mediaPath);
  if (cached?.identity === identity) return cached.url;

  const dir = mkdtempSync(join(tmpdir(), "kwikscript-audio-preview-"));
  audioPreviewTempDirs.add(dir);
  const output = join(dir, "preview.m4a");

  try {
    const available = await new Promise<boolean>((resolve, reject) => {
      const child = spawn(
        ffmpeg,
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-i",
          mediaPath,
          "-map",
          "0:a:0?",
          "-vn",
          "-c:a",
          "aac",
          "-b:a",
          "128k",
          "-map_metadata",
          "-1",
          "-movflags",
          "+faststart",
          "-y",
          output,
        ],
        { stdio: ["ignore", "ignore", "pipe"] }
      );
      audioPreviewJobs.add(child);
      const errors: Buffer[] = [];
      let errorBytes = 0;
      child.stderr?.on("data", (chunk: Buffer) => {
        if (errorBytes >= 64 * 1024) return;
        errors.push(chunk);
        errorBytes += chunk.byteLength;
      });
      child.on("error", (error) => {
        audioPreviewJobs.delete(child);
        reject(error);
      });
      child.on("close", (code) => {
        audioPreviewJobs.delete(child);
        if (code === 0 && existsSync(output) && statSync(output).size > 0) {
          resolve(true);
          return;
        }
        const detail = Buffer.concat(errors).toString("utf8");
        if (/does not contain any stream|matches no streams|output file does not contain/i.test(detail)) {
          resolve(false);
          return;
        }
        reject(new Error(detail.trim() || "Audio preview generation failed."));
      });
    });

    if (!available) {
      audioPreviewTempDirs.delete(dir);
      rmSync(dir, { recursive: true, force: true });
      return null;
    }
    const url = pathToFileURL(output).href;
    audioPreviewBySource.set(mediaPath, { identity, url });
    return url;
  } catch (error) {
    audioPreviewTempDirs.delete(dir);
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // The OS temp cleaner will recover anything still in use.
    }
    throw error;
  }
}

/**
 * Chromium cannot render every format macOS cameras and editors produce
 * (notably ProRes MOV). Build a lightweight H.264 viewing proxy while keeping
 * the original path as the only source used for exports.
 */
async function prepareVideoPreviewNative(
  jobId: string,
  mediaPath: string,
  duration: number,
  onProgress: (ratio: number) => void
): Promise<string> {
  const ffmpeg = nativeFfmpegPath();
  if (!ffmpeg) throw new Error("NATIVE_FFMPEG_UNAVAILABLE");

  const stat = statSync(mediaPath);
  const identity = `${stat.size}:${stat.mtimeMs}`;
  const cached = previewBySource.get(mediaPath);
  if (cached?.identity === identity) return cached.url;

  const dir = mkdtempSync(join(tmpdir(), "kwikscript-preview-"));
  previewTempDirs.add(dir);
  const output = join(dir, "preview.mp4");

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        ffmpeg,
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-i",
          mediaPath,
          "-map",
          "0:v:0",
          "-map",
          "0:a:0?",
          "-vf",
          "scale=min(1280\\,iw):-2",
          "-c:v",
          "h264_videotoolbox",
          "-tag:v",
          "avc1",
          "-b:v",
          "4M",
          "-maxrate",
          "6M",
          "-bufsize",
          "8M",
          "-g",
          "30",
          "-c:a",
          "aac",
          "-b:a",
          "128k",
          "-sn",
          "-dn",
          "-map_metadata",
          "-1",
          "-movflags",
          "+faststart",
          "-progress",
          "pipe:2",
          "-nostats",
          "-y",
          output,
        ],
        { stdio: ["ignore", "ignore", "pipe"] }
      );
      nativePreviewJobs.set(jobId, child);
      let stderr = "";
      let pending = "";
      child.stderr?.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf8");
        if (stderr.length < 64 * 1024) stderr += text;
        pending += text;
        const lines = pending.split(/\r?\n/);
        pending = lines.pop() ?? "";
        for (const line of lines) {
          const match = /^(?:out_time_us|out_time_ms)=(\d+)$/.exec(line);
          if (!match) continue;
          const seconds = Number(match[1]) / 1e6;
          onProgress(Math.min(1, Math.max(0, seconds / Math.max(0.001, duration))));
        }
      });
      child.on("error", reject);
      child.on("close", (code, signal) => {
        if (nativePreviewJobs.get(jobId) === child) nativePreviewJobs.delete(jobId);
        if (code === 0 && readableFile(output)) {
          resolve();
          return;
        }
        reject(
          new Error(
            signal
              ? "Preview preparation was cancelled."
              : stderr.trim() || "Video preview preparation failed."
          )
        );
      });
    });
    onProgress(1);
    const url = registerMediaPath(output).url;
    previewBySource.set(mediaPath, { identity, url });
    return url;
  } catch (error) {
    previewTempDirs.delete(dir);
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // The OS temp cleaner will recover a file still held by FFmpeg.
    }
    throw error;
  } finally {
    nativePreviewJobs.delete(jobId);
  }
}

type NativeExportOptions = {
  sourcePath: string;
  kind: "video" | "audio";
  format: "mp4" | "webm" | "m4a" | "mp3" | "wav";
  resolution?: "original" | "720" | "1080" | "2160";
  withAudio?: boolean;
  keepRanges: Array<{ start: number; end: number }>;
  editedDuration: number;
};

function validExportOptions(value: unknown): value is NativeExportOptions {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<NativeExportOptions>;
  const validFormat =
    (v.kind === "video" && (v.format === "mp4" || v.format === "webm")) ||
    (v.kind === "audio" &&
      (v.format === "m4a" || v.format === "mp3" || v.format === "wav"));
  const validResolution =
    v.resolution === undefined ||
    v.resolution === "original" ||
    v.resolution === "720" ||
    v.resolution === "1080" ||
    v.resolution === "2160";
  return (
    readableFile(v.sourcePath) &&
    (v.kind === "video" || v.kind === "audio") &&
    validFormat &&
    validResolution &&
    (v.withAudio === undefined || typeof v.withAudio === "boolean") &&
    Array.isArray(v.keepRanges) &&
    v.keepRanges.length > 0 &&
    v.keepRanges.every(
      (range) =>
        Number.isFinite(range?.start) &&
        Number.isFinite(range?.end) &&
        range.start >= 0 &&
        range.end > range.start
    ) &&
    Number.isFinite(v.editedDuration) &&
    (v.editedDuration ?? 0) > 0
  );
}

function nativeExportArgs(options: NativeExportOptions, output: string): string[] {
  const parts: string[] = [];
  const labels: string[] = [];
  const withAudio = options.withAudio !== false;
  for (let i = 0; i < options.keepRanges.length; i++) {
    const range = options.keepRanges[i];
    const start = range.start.toFixed(3);
    const end = range.end.toFixed(3);
    if (options.kind === "video") {
      parts.push(`[0:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS[v${i}]`);
      labels.push(`[v${i}]`);
      if (withAudio) {
        parts.push(`[0:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS[a${i}]`);
        labels[i] += `[a${i}]`;
      }
    } else {
      parts.push(`[0:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS[a${i}]`);
      labels.push(`[a${i}]`);
    }
  }

  if (options.kind === "audio") {
    const filter =
      parts.join(";") +
      `;${labels.join("")}concat=n=${options.keepRanges.length}:v=0:a=1[outa]`;
    const codec =
      options.format === "mp3"
        ? ["-c:a", "libmp3lame", "-b:a", "192k"]
        : options.format === "wav"
          ? ["-c:a", "pcm_s16le"]
          : ["-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart"];
    return [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      options.sourcePath,
      "-filter_complex",
      filter,
      "-map",
      "[outa]",
      ...codec,
      "-progress",
      "pipe:2",
      "-nostats",
      "-y",
      output,
    ];
  }

  let filter =
    parts.join(";") +
    `;${labels.join("")}concat=n=${options.keepRanges.length}:v=1:a=${
      withAudio ? 1 : 0
    }[outv]${withAudio ? "[outa]" : ""}`;
  let videoMap = "[outv]";
  if (options.resolution && options.resolution !== "original") {
    const height = Number(options.resolution);
    filter += `;[outv]scale=-2:'min(ih,${height})',scale=trunc(iw/2)*2:trunc(ih/2)*2[vout]`;
    videoMap = "[vout]";
  }
  const codec =
    options.format === "webm"
      ? [
          "-c:v",
          "libvpx-vp9",
          "-crf",
          "35",
          "-b:v",
          "0",
          "-row-mt",
          "1",
          "-cpu-used",
          "8",
          ...(withAudio ? ["-c:a", "libopus", "-b:a", "128k"] : []),
        ]
      : [
          "-c:v",
          "libx264",
          "-preset",
          "ultrafast",
          "-crf",
          "22",
          ...(withAudio ? ["-c:a", "aac", "-b:a", "192k"] : []),
          "-movflags",
          "+faststart",
        ];
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    options.sourcePath,
    "-filter_complex",
    filter,
    "-map",
    videoMap,
    ...(withAudio ? ["-map", "[outa]"] : ["-an"]),
    ...codec,
    "-progress",
    "pipe:2",
    "-nostats",
    "-y",
    output,
  ];
}

async function exportMediaNative(
  options: NativeExportOptions,
  onProgress: (ratio: number) => void
): Promise<string> {
  const ffmpeg = nativeFfmpegPath();
  if (!ffmpeg) throw new Error("NATIVE_FFMPEG_UNAVAILABLE");
  const dir = mkdtempSync(join(tmpdir(), "rescript-export-"));
  exportTempDirs.add(dir);
  const output = join(dir, `edited.${options.format}`);
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, nativeExportArgs(options, output), {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    let pending = "";
    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      if (stderr.length < 64 * 1024) stderr += text;
      pending += text;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? "";
      for (const line of lines) {
        const match = /^(?:out_time_us|out_time_ms)=(\d+)$/.exec(line);
        if (!match) continue;
        const seconds = Number(match[1]) / 1e6;
        onProgress(
          Math.min(1, Math.max(0, seconds / Math.max(0.001, options.editedDuration)))
        );
      }
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0 || !readableFile(output)) {
        reject(new Error(stderr.trim() || "Native media export failed."));
        return;
      }
      onProgress(1);
      resolve(output);
    });
  });
}

type WindowMode = "compact" | "expanded";

/** The shell has two resting sizes: a small window for the upload screen, and a
 *  roomy one once the editor (transcript + preview + timeline) takes over. */
const WINDOW_SIZES: Record<WindowMode, { width: number; height: number }> = {
  compact: { width: 560, height: 400 },
  expanded: { width: 1080, height: 752 },
};
const MIN_SIZE = { width: 560, height: 400 };

/** Height of the in-page drag strip (`h-12`), used to centre the traffic lights. */
const TITLE_BAR_HEIGHT = 48;
/** macOS traffic light buttons are 12px tall. */
const TRAFFIC_LIGHT_HEIGHT = 12;

/** MIME types for the custom app:// protocol that serves the Next static export. */
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json",
  ".txt": "text/plain; charset=utf-8",
};

// At module scope, before `app.whenReady()`: a crash while registering the
// protocol or resolving the static root happens before any window exists, and
// those are precisely the failures nothing else can report.
//
// This must also come *before* our own registerSchemesAsPrivileged call below.
// Electron's registerSchemesAsPrivileged replaces the scheme list rather than
// appending to it, and Sentry registers its own `sentry-ipc` scheme during
// init, then proxies the function so *later* calls merge its scheme back in.
// Registering `app` first therefore gets it silently overwritten, and the
// renderer's fetch() of app:// URLs fails with `URL scheme "app" is not
// supported` — which is how ffmpeg.wasm's core fails to load.
initMainSentry();

// Register before app ready so the scheme can be privileged (fetch, workers,
// SharedArrayBuffer via COOP/COEP headers we attach below).
protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

function staticRoot(): string {
  // Packaged: next export lives next to the compiled main process under
  // resources/app (asar) or we copy it beside electron-dist.
  return join(__dirname, "..", "out");
}

function resolveStaticPath(urlPath: string): string | null {
  const root = staticRoot();
  let pathname = decodeURIComponent(urlPath);
  if (pathname === "/" || pathname === "") pathname = "/index.html";
  // Strip leading slash and normalize; reject path escape attempts.
  const rel = normalize(pathname.replace(/^\/+/, ""));
  if (rel.startsWith("..")) return null;
  let filePath = join(root, rel);
  if (existsSync(filePath) && statSync(filePath).isDirectory()) {
    filePath = join(filePath, "index.html");
  }
  if (!existsSync(filePath) || !statSync(filePath).isFile()) return null;
  return filePath;
}

function registerAppProtocol(): void {
  protocol.handle("app", async (request) => {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith("/__media/")) {
      const token = pathname.split("/")[2];
      const mediaPath = token ? mediaPaths.get(token) : undefined;
      if (!mediaPath || !readableFile(mediaPath)) {
        return new Response("Media not found", {
          status: 404,
          statusText: "Not Found",
        });
      }
      const headers = new Headers();
      const range = request.headers.get("range");
      if (range) headers.set("Range", range);
      const response = await net.fetch(pathToFileURL(mediaPath).toString(), {
        headers,
      });
      const responseHeaders = new Headers(response.headers);
      responseHeaders.set("Content-Type", mediaMime(mediaPath));
      // Development runs the renderer on http://localhost while packaged media
      // is same-origin app://. The opaque token is the access boundary, so allow
      // the renderer origin to consume the stream in both modes.
      responseHeaders.set("Cross-Origin-Resource-Policy", "cross-origin");
      responseHeaders.set("Access-Control-Allow-Origin", "*");
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      });
    }
    const filePath = resolveStaticPath(pathname);
    if (!filePath) {
      return new Response("Not found", { status: 404, statusText: "Not Found" });
    }
    const fileUrl = pathToFileURL(filePath).toString();
    const response = await net.fetch(fileUrl);
    const headers = new Headers(response.headers);
    // Enable SharedArrayBuffer for ffmpeg.wasm + onnxruntime (same as Next
    // headers() in next.config.ts for the non-export server).
    headers.set("Cross-Origin-Opener-Policy", "same-origin");
    headers.set("Cross-Origin-Embedder-Policy", "require-corp");
    const type = MIME[extname(filePath).toLowerCase()];
    if (type) headers.set("Content-Type", type);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  });
}

/** Tracks each window's current mode so repeated requests are no-ops. */
const windowModes = new WeakMap<BrowserWindow, WindowMode>();

/** Renderers that have mounted and subscribed to menu commands. A freshly
 *  created (or reloading) window isn't listening yet, so its commands wait. */
const readyRenderers = new WeakSet<WebContents>();
const pendingCommands = new WeakMap<WebContents, MenuCommand[]>();

function deliverMenuCommand(contents: WebContents, command: MenuCommand): void {
  if (command.type === "open-file") {
    // Chromium only opens a file chooser under user activation, which an IPC
    // message doesn't carry — the click() is silently dropped. executeJavaScript
    // can grant one, so the picker is driven that way instead.
    void contents
      .executeJavaScript("window.rescriptOpenFilePicker?.()", true)
      .catch((err: unknown) => console.error("Failed to open the file picker.", err));
    return;
  }
  contents.send("menu:command", command);
}

function flushPendingCommands(contents: WebContents): void {
  const queued = pendingCommands.get(contents);
  pendingCommands.delete(contents);
  for (const command of queued ?? []) deliverMenuCommand(contents, command);
}

/** Deliver a File-menu command, launching a window if the app is running
 *  window-less (macOS keeps the menu bar after the last window closes). */
function dispatchMenuCommand(command: MenuCommand): void {
  const win =
    BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? createWindow();
  const contents = win.webContents;
  if (readyRenderers.has(contents)) {
    deliverMenuCommand(contents, command);
    return;
  }
  const queued = pendingCommands.get(contents) ?? [];
  queued.push(command);
  pendingCommands.set(contents, queued);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Resize a window to the given mode's resting size, keeping it centred on
 *  wherever the user left it rather than snapping to a corner. */
function applyWindowMode(win: BrowserWindow, mode: WindowMode): void {
  if (windowModes.get(win) === mode) return;
  windowModes.set(win, mode);
  // A maximized or full-screen window is already the size the user asked for.
  if (win.isFullScreen() || win.isMaximized()) return;

  const current = win.getBounds();
  const { workArea } = screen.getDisplayMatching(current);
  const width = Math.min(WINDOW_SIZES[mode].width, workArea.width);
  const height = Math.min(WINDOW_SIZES[mode].height, workArea.height);
  win.setBounds(
    {
      width,
      height,
      x: Math.round(
        clamp(
          current.x + (current.width - width) / 2,
          workArea.x,
          workArea.x + workArea.width - width
        )
      ),
      y: Math.round(
        clamp(
          current.y + (current.height - height) / 2,
          workArea.y,
          workArea.y + workArea.height - height
        )
      ),
    },
    true // animate (macOS)
  );
}

/** Set once the app is really terminating, so the close interception below
 *  doesn't swallow the quit. */
let quitting = false;

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    ...WINDOW_SIZES.compact,
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    // Light by default — appearance is a user preference in the renderer.
    backgroundColor: "#fafafa",
    title: "KwikScript",
    show: false,
    // macOS: drop the native title bar and let the page's top bar / upload drag
    // strip move the window instead. Windows and Linux keep their native frame
    // — hiding it there would take the caption buttons with it.
    ...(isMac
      ? {
          titleBarStyle: "hidden" as const,
          trafficLightPosition: {
            x: 16,
            y: Math.round((TITLE_BAR_HEIGHT - TRAFFIC_LIGHT_HEIGHT) / 2),
          },
        }
      : {}),
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  windowModes.set(win, "compact");

  win.once("ready-to-show", () => win.show());

  // A reload tears down the listener the renderer registered; make it re-announce.
  win.webContents.on("did-start-navigation", (event) => {
    if (event.isSameDocument) return;
    readyRenderers.delete(win.webContents);
    pendingCommands.delete(win.webContents);
  });

  // Closing while the editor is open drops the project rather than the window:
  // the renderer returns to the upload screen and the shell shrinks back. The
  // next close (already on the upload screen) is a real close. Guarded on the
  // renderer being live, so an unresponsive page can still be closed.
  win.on("close", (event) => {
    if (quitting) return;
    if (windowModes.get(win) !== "expanded") return;
    if (!readyRenderers.has(win.webContents)) return;
    event.preventDefault();
    win.webContents.send("menu:command", { type: "close-project" } satisfies MenuCommand);
  });

  // The page pads its top bar for the traffic lights, which macOS hides in
  // full screen; tell it when that changes so the gap can collapse.
  const emitFullScreen = () => {
    if (!win.isDestroyed()) {
      win.webContents.send("window:full-screen-changed", win.isFullScreen());
    }
  };
  win.on("enter-full-screen", emitFullScreen);
  win.on("leave-full-screen", emitFullScreen);

  // Open external http(s) links in the OS browser; keep app:// / localhost in-app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http:") || url.startsWith("https:")) {
      void shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    const isApp = url.startsWith("app://");
    const isDevServer = isDev && url.startsWith(DEV_SERVER_URL);
    if (!isApp && !isDevServer) {
      event.preventDefault();
      if (url.startsWith("http:") || url.startsWith("https:")) {
        void shell.openExternal(url);
      }
    }
  });

  if (isDev) {
    void win.loadURL(DEV_SERVER_URL);
  } else {
    void win.loadURL("app://localhost/");
  }

  return win;
}

// Ensure a single instance — second launches focus the existing window.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  ipcMain.on("window:set-mode", (event, mode: unknown) => {
    if (mode !== "compact" && mode !== "expanded") return;
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) applyWindowMode(win, mode);
  });
  ipcMain.handle(
    "window:is-full-screen",
    (event) => BrowserWindow.fromWebContents(event.sender)?.isFullScreen() ?? false
  );
  // The renderer owns the preference; this mirrors it so the next launch can gate
  // reporting before any window exists.
  ipcMain.on("telemetry:set-enabled", (_event, value: unknown) => {
    setMainTelemetryEnabled(value === true);
  });
  ipcMain.on("ui:set-locale", (_event, value: unknown) => {
    if (!isDesktopLocale(value)) return;
    setDesktopLocale(value);
    buildAppMenu();
  });
  // The saved projects live in the renderer's IndexedDB; it pushes a snapshot
  // whenever the list changes so the File menu can list them.
  ipcMain.on("menu:set-recents", (_event, value: unknown) => {
    if (!Array.isArray(value)) return;
    const recents: RecentProject[] = [];
    for (const entry of value) {
      if (!entry || typeof entry !== "object") continue;
      const { id, name } = entry as { id?: unknown; name?: unknown };
      if (typeof id !== "string" || typeof name !== "string") continue;
      recents.push({ id, name });
    }
    setRecentProjects(recents);
  });
  ipcMain.on("media:native-available", (event) => {
    event.returnValue = nativeFfmpegPath() !== null;
  });
  ipcMain.on("transcription:coreml-available", (event) => {
    event.returnValue = nativeCoreMLTranscriberPath() !== null;
  });
  ipcMain.on("transcription:cancel", (_event, value: unknown) => {
    if (typeof value !== "string") return;
    nativeTranscriptionJobs.get(value)?.kill();
  });
  ipcMain.on("media:preview-cancel", (_event, value: unknown) => {
    if (typeof value !== "string") return;
    nativePreviewJobs.get(value)?.kill();
  });
  ipcMain.handle(
    "media:resolve-path",
    async (event, value: unknown, expectedName: unknown) => {
      let path = readableFile(value) ? value : null;
      if (!path) {
        const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
        const expected =
          typeof expectedName === "string" && expectedName.trim()
            ? expectedName.trim()
            : "source media";
        const options: OpenDialogOptions = {
          title: `Locate ${expected}`,
          defaultPath:
            typeof value === "string" && isAbsolute(value)
              ? dirname(value)
              : undefined,
          properties: ["openFile"],
          filters: [
            { name: "Video and audio", extensions: MEDIA_EXTENSIONS },
            { name: "All files", extensions: ["*"] },
          ],
        };
        const result = win
          ? await dialog.showOpenDialog(win, options)
          : await dialog.showOpenDialog(options);
        const selected = result.canceled ? undefined : result.filePaths[0];
        path = readableFile(selected) ? selected : null;
      }
      return path ? registerMediaPath(path) : null;
    }
  );
  ipcMain.handle("media:extract-audio", async (_event, value: unknown) => {
    if (!readableFile(value)) throw new Error("The source media file is missing.");
    if (!nativeFfmpegPath()) return { available: false };
    const audio = await extractAudioNative(value);
    return { available: true, audio };
  });
  ipcMain.handle("media:prepare-audio-preview", async (_event, value: unknown) => {
    if (!readableFile(value)) throw new Error("The source media file is missing.");
    if (!nativeFfmpegPath()) return { available: false as const };
    const url = await prepareAudioPreviewNative(value);
    return url
      ? { available: true as const, url }
      : { available: false as const };
  });
  ipcMain.handle(
    "transcription:coreml",
    async (event, jobId: unknown, value: unknown) => {
      if (typeof jobId !== "string" || !readableFile(value)) {
        throw new Error("Invalid native transcription request.");
      }
      const channel = `transcription:coreml-progress:${jobId}`;
      return transcribeCoreML(jobId, value, (progress) => {
        if (!event.sender.isDestroyed()) event.sender.send(channel, progress);
      });
    }
  );
  ipcMain.handle(
    "media:prepare-preview",
    async (event, jobId: unknown, path: unknown, duration: unknown) => {
      if (!nativeFfmpegPath()) return { available: false as const };
      if (
        typeof jobId !== "string" ||
        !readableFile(path) ||
        typeof duration !== "number" ||
        !Number.isFinite(duration) ||
        duration <= 0
      ) {
        throw new Error("Invalid video preview request.");
      }
      const channel = `media:preview-progress:${jobId}`;
      const url = await prepareVideoPreviewNative(jobId, path, duration, (ratio) => {
        if (!event.sender.isDestroyed()) event.sender.send(channel, ratio);
      });
      return { available: true as const, url };
    }
  );
  ipcMain.handle(
    "media:export",
    async (event, jobId: unknown, value: unknown) => {
      if (!nativeFfmpegPath()) return { available: false };
      if (typeof jobId !== "string" || !validExportOptions(value)) {
        throw new Error("Invalid media export request.");
      }
      const channel = `media:export-progress:${jobId}`;
      const output = await exportMediaNative(value, (ratio) => {
        if (!event.sender.isDestroyed()) event.sender.send(channel, ratio);
      });
      return { available: true, url: registerMediaPath(output).url };
    }
  );
  // The renderer announces itself once it is listening for menu commands; until
  // then anything the menu fired at a just-opened window is held.
  ipcMain.on("menu:renderer-ready", (event) => {
    readyRenderers.add(event.sender);
    flushPendingCommands(event.sender);
  });

  app.on("before-quit", () => {
    quitting = true;
    for (const child of nativeTranscriptionJobs.values()) child.kill();
    nativeTranscriptionJobs.clear();
    for (const child of nativePreviewJobs.values()) child.kill();
    nativePreviewJobs.clear();
    for (const child of audioPreviewJobs) child.kill();
    audioPreviewJobs.clear();
    for (const dir of exportTempDirs) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // The OS temp cleaner will recover anything still in use.
      }
    }
    exportTempDirs.clear();
    for (const dir of previewTempDirs) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // The OS temp cleaner will recover anything still in use.
      }
    }
    previewTempDirs.clear();
    previewBySource.clear();
    for (const dir of audioPreviewTempDirs) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // The OS temp cleaner will recover anything still in use.
      }
    }
    audioPreviewTempDirs.clear();
    audioPreviewBySource.clear();
  });

  app.whenReady().then(() => {
    setDesktopLocale(resolveDesktopLocale(app.getLocale()));
    // Packaged builds serve the whole renderer here; development still needs
    // the same handler for path-backed media reopened from saved projects.
    registerAppProtocol();
    buildAppMenu(dispatchMenuCommand);
    createWindow();
    initAutoUpdater();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
