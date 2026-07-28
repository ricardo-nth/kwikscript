import { getCutRanges, originalToEdited } from "./edits";
import type { Word } from "./types";

export type TranscriptFormat = "srt" | "vtt" | "json";

export interface SerializeOptions {
  /**
   * When true (default for SRT/VTT), omit deleted words and remap times onto
   * the edited timeline so captions sync with the exported media.
   * JSON ignores this and always writes the full word list for round-trips.
   */
  editedTimeline?: boolean;
  /** Media duration in seconds; used when remapping onto the edited timeline. */
  duration?: number;
}

interface Cue {
  start: number;
  end: number;
  text: string;
  speaker: number;
}

/** Split a cue when the gap between consecutive words exceeds this (seconds). */
const CUE_GAP = 0.75;

const MIME: Record<TranscriptFormat, string> = {
  srt: "application/x-subrip",
  vtt: "text/vtt",
  json: "application/json",
};

export function transcriptMime(format: TranscriptFormat): string {
  return MIME[format];
}

export function transcriptExtension(format: TranscriptFormat): string {
  return `.${format}`;
}

/**
 * Serialize editor words to SRT, WebVTT, or JSON.
 * SRT/VTT group consecutive same-speaker words into cues (splitting on gaps).
 * JSON writes `{ "words": [...] }` matching `parseTranscript` import.
 */
export function serializeTranscript(
  words: Word[],
  format: TranscriptFormat,
  options: SerializeOptions = {}
): string {
  if (format === "json") return serializeJson(words);

  const editedTimeline = options.editedTimeline !== false;
  const prepared = prepareCaptionWords(words, editedTimeline, options.duration ?? 0);
  if (prepared.length === 0) {
    throw new Error("No words to export.");
  }
  const cues = wordsToCues(prepared);
  return format === "vtt" ? serializeVtt(cues) : serializeSrt(cues);
}

/** Trigger a browser download of the serialized transcript. */
export function downloadTranscript(
  words: Word[],
  format: TranscriptFormat,
  filename: string,
  options: SerializeOptions = {}
): void {
  const text = serializeTranscript(words, format, options);
  const blob = new Blob([text], { type: `${MIME[format]};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(`.${format}`)
    ? filename
    : `${filename}${transcriptExtension(format)}`;
  a.click();
  URL.revokeObjectURL(url);
}

function serializeJson(words: Word[]): string {
  return JSON.stringify(
    {
      words: words.map((w) => ({
        text: w.text,
        start: roundTime(w.start),
        end: roundTime(w.end),
        speaker: w.speaker,
        deleted: w.deleted,
      })),
    },
    null,
    2
  );
}

function prepareCaptionWords(
  words: Word[],
  editedTimeline: boolean,
  duration: number
): Word[] {
  const kept = words.filter((w) => !w.deleted);
  if (!editedTimeline || kept.length === 0) return kept;

  const cuts = getCutRanges(words, duration > 0 ? duration : Infinity);
  if (cuts.length === 0) return kept;

  return kept.map((w) => ({
    ...w,
    start: originalToEdited(w.start, cuts),
    end: originalToEdited(w.end, cuts),
  }));
}

function wordsToCues(words: Word[]): Cue[] {
  const cues: Cue[] = [];
  let batch: Word[] = [];

  const flush = () => {
    if (batch.length === 0) return;
    cues.push({
      start: batch[0].start,
      end: Math.max(batch[batch.length - 1].end, batch[0].start + 0.02),
      text: batch.map((w) => w.text).join(" "),
      speaker: batch[0].speaker,
    });
    batch = [];
  };

  for (const w of words) {
    const last = batch[batch.length - 1];
    if (
      last &&
      (w.speaker !== last.speaker || w.start - last.end > CUE_GAP)
    ) {
      flush();
    }
    batch.push(w);
  }
  flush();
  return cues;
}

function serializeSrt(cues: Cue[]): string {
  return (
    cues
      .map((cue, i) => {
        const lines = [
          String(i + 1),
          `${formatSrtTimestamp(cue.start)} --> ${formatSrtTimestamp(cue.end)}`,
        ];
        if (cue.speaker >= 0) {
          lines.push(`Speaker ${cue.speaker + 1}: ${cue.text}`);
        } else {
          lines.push(cue.text);
        }
        return lines.join("\n");
      })
      .join("\n\n") + "\n"
  );
}

function serializeVtt(cues: Cue[]): string {
  const body = cues
    .map((cue) => {
      const timing = `${formatVttTimestamp(cue.start)} --> ${formatVttTimestamp(cue.end)}`;
      const text =
        cue.speaker >= 0
          ? `<v Speaker ${cue.speaker + 1}>${cue.text}`
          : cue.text;
      return `${timing}\n${text}`;
    })
    .join("\n\n");
  return `WEBVTT\n\n${body}\n`;
}

/** SRT timestamps use a comma decimal separator: `HH:MM:SS,mmm`. */
export function formatSrtTimestamp(seconds: number): string {
  return formatCaptionTimestamp(seconds, ",");
}

/** WebVTT timestamps use a dot decimal separator: `HH:MM:SS.mmm`. */
export function formatVttTimestamp(seconds: number): string {
  return formatCaptionTimestamp(seconds, ".");
}

function formatCaptionTimestamp(seconds: number, decimal: "," | "."): string {
  const t = Math.max(0, seconds);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  const ms = Math.round((t - Math.floor(t)) * 1000);
  // Carry if rounding pushed ms to 1000.
  const carry = ms === 1000 ? 1 : 0;
  const msClamped = ms === 1000 ? 0 : ms;
  const s2 = s + carry;
  const m2 = m + Math.floor(s2 / 60);
  const h2 = h + Math.floor(m2 / 60);
  return (
    `${pad(h2, 2)}:${pad(m2 % 60, 2)}:${pad(s2 % 60, 2)}` +
    `${decimal}${pad(msClamped, 3)}`
  );
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

function roundTime(t: number): number {
  return Math.round(t * 1000) / 1000;
}
