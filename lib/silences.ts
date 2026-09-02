import { getCutRanges, isWordCutOut } from "./edits";
import type { ManualCut, TimeRange, Word } from "./types";
import type { WaveformPeaks } from "./waveform";

/**
 * Minimum gap length (seconds) that counts as a removable silence.
 * Shorter gaps are normal inter-word spacing from ASR and should stay.
 */
export const MIN_SILENCE_DURATION = 0.3;

/**
 * Leave this much audio (seconds) beside kept speech so word onsets/offsets
 * aren't clipped when Whisper timestamps are slightly tight.
 */
export const SILENCE_PAD = 0.05;

/**
 * Manual cuts that hold no words at all — what "Remove silences" leaves behind
 * (and any trim that happened to land on a pause). Restoring these brings the
 * quiet audio back without un-deleting speech, so a cut that merged with a
 * word-bearing cut is deliberately left out.
 */
export function findSilenceCuts(
  words: Word[],
  manualCuts: ManualCut[]
): TimeRange[] {
  const owned = manualCuts.filter((cut) => cut.source === "silence");
  if (owned.length > 0) {
    return owned
      .filter((cut) => cut.end - cut.start > 1e-4)
      .map((cut) => ({ start: cut.start, end: cut.end }));
  }
  return manualCuts
    .filter(
      (c) =>
        c.end - c.start > 1e-4 &&
        !words.some((w) => w.end > c.start + 1e-4 && w.start < c.end - 1e-4)
    )
    .map((c) => ({ start: c.start, end: c.end }));
}

/** Add independently reversible silence-cleanup cuts without merging ownership. */
export function addSilenceCuts(
  manualCuts: ManualCut[],
  ranges: TimeRange[],
  nextId: number
): { cuts: ManualCut[]; nextId: number } {
  const added: ManualCut[] = [];
  let id = nextId;
  for (const range of ranges) {
    if (range.end - range.start <= 1e-4) continue;
    added.push({ id: id++, start: range.start, end: range.end, source: "silence" });
  }
  return {
    cuts: [...manualCuts, ...added].sort(
      (left, right) => left.start - right.start || left.end - right.end
    ),
    nextId: id,
  };
}

/** Remove only cuts created by silence cleanup, leaving manual edits intact. */
export function removeOwnedSilenceCuts(manualCuts: ManualCut[]): ManualCut[] {
  return manualCuts.filter((cut) => cut.source !== "silence");
}

/** Split `range` into the pieces not covered by any of `cuts`. */
function subtractCuts(range: TimeRange, cuts: TimeRange[]): TimeRange[] {
  let parts: TimeRange[] = [range];
  for (const cut of cuts) {
    parts = parts.flatMap((p) => {
      if (cut.end <= p.start + 1e-4 || cut.start >= p.end - 1e-4) return [p];
      const out: TimeRange[] = [];
      if (cut.start > p.start + 1e-4) out.push({ start: p.start, end: cut.start });
      if (cut.end < p.end - 1e-4) out.push({ start: cut.end, end: p.end });
      return out;
    });
  }
  return parts;
}

/** Convert the compact RMS envelope back to an amplitude in the 0..1 range. */
function rmsAmplitude(value: number): number {
  return value / 65_535;
}

/**
 * Find quiet spans from the audio itself. Word timings are used only to avoid
 * proposing audio that is already removed by a transcript or manual edit.
 */
export function findWaveformSilenceRanges(
  waveform: WaveformPeaks,
  words: Word[],
  duration: number,
  manualCuts: ManualCut[] = [],
  threshold = 0.03,
  minDuration = MIN_SILENCE_DURATION,
  leftPad = SILENCE_PAD,
  rightPad = leftPad,
  maxDuration = Number.POSITIVE_INFINITY
): TimeRange[] {
  if (duration <= 0 || waveform.rms.length === 0 || threshold <= 0) return [];

  const frameDuration = waveform.rmsFrameSize / waveform.sampleRate;
  const cuts = getCutRanges(words, duration, manualCuts);
  const out: TimeRange[] = [];
  let quietStart = -1;

  const addQuietRun = (fromFrame: number, toFrame: number) => {
    const start = Math.max(0, fromFrame * frameDuration);
    const end = Math.min(duration, toFrame * frameDuration);
    const quietDuration = end - start;
    if (
      quietDuration < minDuration - 1e-4 ||
      quietDuration > maxDuration + 1e-4
    ) {
      return;
    }

    for (const part of subtractCuts({ start, end }, cuts)) {
      if (part.end - part.start < minDuration - 1e-4) continue;
      const touchesLoudAudioOnLeft =
        fromFrame > 0 && Math.abs(part.start - start) < 1e-4;
      const touchesLoudAudioOnRight =
        toFrame < waveform.rms.length && Math.abs(part.end - end) < 1e-4;
      const paddedStart =
        part.start + (touchesLoudAudioOnLeft ? Math.max(0, leftPad) : 0);
      const paddedEnd =
        part.end - (touchesLoudAudioOnRight ? Math.max(0, rightPad) : 0);
      if (paddedEnd - paddedStart > 1e-4) {
        out.push({ start: paddedStart, end: paddedEnd });
      }
    }
  };

  for (let frame = 0; frame < waveform.rms.length; frame++) {
    const quiet = rmsAmplitude(waveform.rms[frame]!) < threshold;
    if (quiet && quietStart < 0) quietStart = frame;
    if (!quiet && quietStart >= 0) {
      addQuietRun(quietStart, frame);
      quietStart = -1;
    }
  }
  if (quietStart >= 0) addQuietRun(quietStart, waveform.rms.length);
  return out;
}

/**
 * Find silence ranges in the media that are not already cut: gaps before the
 * first kept word, between kept words, and after the last kept word, each at
 * least `minDuration` long. A small pad is left beside speech so it isn't
 * clipped; media edges are cut flush.
 */
export function findSilenceRanges(
  words: Word[],
  duration: number,
  manualCuts: ManualCut[] = [],
  minDuration = MIN_SILENCE_DURATION,
  leftPad = SILENCE_PAD,
  rightPad = leftPad,
  maxDuration = Number.POSITIVE_INFINITY
): TimeRange[] {
  if (duration <= 0) return [];

  const cuts = getCutRanges(words, duration, manualCuts);
  const kept = words
    .filter((w) => !isWordCutOut(w, cuts))
    .slice()
    .sort((a, b) => a.start - b.start || a.end - b.end);

  // Raw gaps (no pad yet), tagged with whether each edge abuts speech.
  type Gap = { start: number; end: number; padStart: boolean; padEnd: boolean };
  const gaps: Gap[] = [];
  let cursor = 0;
  let prevWasSpeech = false;
  for (const w of kept) {
    if (w.start > cursor + 1e-4) {
      gaps.push({
        start: cursor,
        end: w.start,
        padStart: prevWasSpeech,
        padEnd: true,
      });
    }
    cursor = Math.max(cursor, w.end);
    prevWasSpeech = true;
  }
  if (duration > cursor + 1e-4) {
    gaps.push({
      start: cursor,
      end: duration,
      padStart: prevWasSpeech,
      padEnd: false,
    });
  }

  const out: TimeRange[] = [];
  for (const gap of gaps) {
    const gapDuration = gap.end - gap.start;
    if (
      gapDuration < minDuration - 1e-4 ||
      gapDuration > maxDuration + 1e-4
    ) {
      continue;
    }
    for (const part of subtractCuts(
      { start: gap.start, end: gap.end },
      cuts
    )) {
      if (part.end - part.start < minDuration - 1e-4) continue;
      // Only pad edges that still sit against speech (not against a prior cut).
      const touchesSpeechOnLeft =
        gap.padStart && Math.abs(part.start - gap.start) < 1e-4;
      const touchesSpeechOnRight =
        gap.padEnd && Math.abs(part.end - gap.end) < 1e-4;
      const start =
        part.start + (touchesSpeechOnLeft ? Math.max(0, leftPad) : 0);
      const end =
        part.end - (touchesSpeechOnRight ? Math.max(0, rightPad) : 0);
      if (end - start > 1e-4) out.push({ start, end });
    }
  }
  return out;
}
