#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { performance } from "node:perf_hooks";

const args = process.argv.slice(2);
const keepTemp = args.includes("--keep-temp");
const mediaPath = args.find((value) => value !== "--keep-temp");

if (!mediaPath || !existsSync(mediaPath)) {
  throw new Error(
    "Usage: npm run benchmark:coreml -- /absolute/path/to/media [--keep-temp]"
  );
}

if (process.platform !== "darwin" || process.arch !== "arm64") {
  throw new Error("The Core ML benchmark requires an Apple-Silicon Mac.");
}

const helper = join(
  process.cwd(),
  "native",
  "coreml-transcriber",
  ".build",
  "release",
  "rescript-coreml-transcriber"
);
if (!existsSync(helper)) {
  throw new Error("Build the native helper first with: npm run build:native:coreml");
}

const ffmpegCandidates = [
  process.env.RESCRIPT_FFMPEG_PATH,
  "/opt/homebrew/bin/ffmpeg",
  "/usr/local/bin/ffmpeg",
].filter(Boolean);
const ffmpeg = ffmpegCandidates.find((path) => existsSync(path));
if (!ffmpeg) {
  throw new Error("FFmpeg was not found. Install it with: brew install ffmpeg");
}
const ffprobe = join(dirname(ffmpeg), "ffprobe");

function run(executable, commandArgs, { captureStdout = false } = {}) {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const child = spawn(executable, commandArgs, {
      stdio: ["ignore", captureStdout ? "pipe" : "ignore", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    child.stdout?.on("data", (chunk) => stdout.push(chunk));
    child.stderr?.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code, signal) => {
      const elapsedSeconds = (performance.now() - started) / 1000;
      if (code === 0) {
        resolve({
          elapsedSeconds,
          stdout: Buffer.concat(stdout).toString("utf8"),
          stderr: Buffer.concat(stderr).toString("utf8"),
        });
        return;
      }
      reject(
        new Error(
          signal
            ? `${basename(executable)} was interrupted by ${signal}`
            : Buffer.concat(stderr).toString("utf8").trim() ||
                `${basename(executable)} exited with code ${code ?? "unknown"}`
        )
      );
    });
  });
}

const workDir = mkdtempSync(join(tmpdir(), "kwikscript-benchmark-"));
const audioPath = join(workDir, "audio.wav");
const transcriptPath = join(workDir, "transcript.json");

try {
  let source = null;
  if (existsSync(ffprobe)) {
    const probe = await run(
      ffprobe,
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration,size:stream=codec_type,codec_name,width,height,sample_rate,channels",
        "-of",
        "json",
        mediaPath,
      ],
      { captureStdout: true }
    );
    source = JSON.parse(probe.stdout);
  }

  const extraction = await run(ffmpeg, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
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
    audioPath,
  ]);
  const transcription = await run(helper, [audioPath, transcriptPath]);
  const result = JSON.parse(readFileSync(transcriptPath, "utf8"));
  const words = Array.isArray(result.words) ? result.words : [];

  const metrics = {
    sourcePath: mediaPath,
    source,
    extractedAudioBytes: statSync(audioPath).size,
    extractionSeconds: Number(extraction.elapsedSeconds.toFixed(3)),
    helperWallSeconds: Number(transcription.elapsedSeconds.toFixed(3)),
    combinedSeconds: Number(
      (extraction.elapsedSeconds + transcription.elapsedSeconds).toFixed(3)
    ),
    modelProcessingSeconds: result.processingTime,
    realtimeFactor: result.realtimeFactor,
    audioDuration: result.audioDuration,
    wordCount: words.length,
    literalFillers: words.filter((word) => /^(um|uh)$/i.test(word.text)).length,
    hesitationPlaceholders: words.filter((word) => word.text === "...").length,
    firstWords: words.slice(0, 12).map((word) => word.text).join(" "),
    lastWords: words.slice(-18).map((word) => word.text).join(" "),
    tempDirectory: keepTemp ? workDir : undefined,
  };
  process.stdout.write(`${JSON.stringify(metrics, null, 2)}\n`);
} finally {
  if (!keepTemp) rmSync(workDir, { recursive: true, force: true });
}
