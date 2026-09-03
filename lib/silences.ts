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

/**
 * Anchor preview badges in the transcript without pretending silence belongs
 * to a spoken word. Each range appears before the first visible word whose
 * midpoint follows it; end-of-media silence is returned as `trailing`.
 */
export function mapSilencePreviewsToWords(
  words: Word[],
  ranges: TimeRange[]
): { beforeWordId: Map<number, TimeRange[]>; trailing: TimeRange[] } {
  const orderedWords = words
    .slice()
    .sort((left, right) => left.start - right.start || left.end - right.end);
  const beforeWordId = new Map<number, TimeRange[]>();
  const trailing: TimeRange[] = [];

  for (const range of ranges) {
    const nextWord = orderedWords.find(
      (word) => word.start + (word.end - word.start) / 2 >= range.end - 1e-4
    );
    if (!nextWord) {
      trailing.push(range);
      continue;
    }
    const current = beforeWordId.get(nextWord.id) ?? [];
    current.push(range);
    beforeWordId.set(nextWord.id, current);
  }

  return { beforeWordId, trailing };
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
 * Find quiet spans from the audio itself, but only outside kept transcript
 * words. The transcript is authoritative: a softly spoken word remains safe
 * even when its waveform falls below the selected threshold.
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
  const protectedSpeech = words
    .filter((word) => !isWordCutOut(word, cuts))
    .map((word) => ({ start: word.start, end: word.end }));
  const out: TimeRange[] = [];
  let quietStart = -1;

  const addQuietRun = (fromFrame: number, toFrame: number) => {
    const start = Math.max(0, fromFrame * frameDuration);
    const end = Math.min(duration, toFrame * frameDuration);
    const editableQuietParts = subtractCuts({ start, end }, cuts).flatMap(
      (part) => subtractCuts(part, protectedSpeech)
    );

    for (const part of editableQuietParts) {
      const quietDuration = part.end - part.start;
      if (
        quietDuration < minDuration - 1e-4 ||
        quietDuration > maxDuration + 1e-4
      ) {
        continue;
      }

      const touchesSpeechOnLeft = protectedSpeech.some(
        (speech) => Math.abs(speech.end - part.start) < 1e-4
      );
      const touchesSpeechOnRight = protectedSpeech.some(
        (speech) => Math.abs(speech.start - part.end) < 1e-4
      );
      const touchesLoudAudioOnLeft =
        fromFrame > 0 && Math.abs(part.start - start) < 1e-4;
      const touchesLoudAudioOnRight =
        toFrame < waveform.rms.length && Math.abs(part.end - end) < 1e-4;
      const paddedStart =
        part.start +
        (touchesLoudAudioOnLeft || touchesSpeechOnLeft ? Math.max(0, leftPad) : 0);
      const paddedEnd =
        part.end -
        (touchesLoudAudioOnRight || touchesSpeechOnRight ? Math.max(0, rightPad) : 0);
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
