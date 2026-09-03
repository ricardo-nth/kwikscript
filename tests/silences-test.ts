import {
  addSilenceCuts,
  findSilenceCuts,
  findSilenceRanges,
  findWaveformSilenceRanges,
  mapSilencePreviewsToWords,
  MIN_SILENCE_DURATION,
  removeOwnedSilenceCuts,
  SILENCE_PAD,
} from "../lib/silences";
import type { ManualCut, Word } from "../lib/types";
import { addManualCut } from "../lib/edits";
import { buildWaveformPeaks } from "../lib/waveform";

function nearly(a: number, b: number, eps = 1e-4): boolean {
  return Math.abs(a - b) < eps;
}

{
  const words = [w(1, 0, 0.2), w(2, 0.5, 0.8)];
  const ranges = [
    { start: 0.2, end: 0.5 },
    { start: 0.8, end: 1 },
  ];
  const mapped = mapSilencePreviewsToWords(words, ranges);
  assert(mapped.beforeWordId.get(2)?.[0] === ranges[0], "inter-word preview anchors before speech");
  assert(mapped.trailing[0] === ranges[1], "trailing preview stays after transcript");
  console.log("transcript silence preview anchors: ok");
}

function w(
  id: number,
  start: number,
  end: number,
  deleted = false
): Word {
  return { id, text: `w${id}`, start, end, speaker: 0, deleted };
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function toneSectionAudio(): Float32Array {
  const sampleRate = 16_000;
  const audio = new Float32Array(sampleRate);
  for (let i = 0; i < audio.length; i++) {
    const t = i / sampleRate;
    const amplitude = t >= 0.2 && t < 0.5 ? 0.01 : 0.1;
    audio[i] = Math.sin(2 * Math.PI * 200 * t) * amplitude;
  }
  return audio;
}

{
  // Loudness locates the quiet tail, while transcript words remain protected.
  const waveform = buildWaveformPeaks(toneSectionAudio());
  const words = [w(1, 0, 0.25), w(2, 0.45, 1)];
  const ranges = findWaveformSilenceRanges(
    waveform,
    words,
    1,
    [],
    0.03,
    0.13,
    0,
    0
  );
  assert(ranges.length === 1, `expected one waveform silence, got ${ranges.length}`);
  assert(nearly(ranges[0]!.start, 0.25) && nearly(ranges[0]!.end, 0.45), "waveform boundaries");

  const belowNoiseFloor = findWaveformSilenceRanges(
    waveform,
    words,
    1,
    [],
    0.005,
    0.13,
    0,
    0
  );
  assert(belowNoiseFloor.length === 0, "lower threshold should retain the quiet audio");

  const padded = findWaveformSilenceRanges(
    waveform,
    words,
    1,
    [],
    0.03,
    0.13,
    0.02,
    0.03
  );
  assert(nearly(padded[0]!.start, 0.27) && nearly(padded[0]!.end, 0.42), "waveform padding");
  console.log("waveform threshold and padding: ok");
}

{
  // A quiet run that contains recognized speech is split around the word. The
  // waveform tool can remove the breaths either side but never the word span.
  const sampleRate = 16_000;
  const audio = new Float32Array(sampleRate);
  for (let i = 0; i < audio.length; i++) {
    const t = i / sampleRate;
    const amplitude = t >= 0.1 && t < 0.9 ? 0.01 : 0.1;
    audio[i] = Math.sin(2 * Math.PI * 200 * t) * amplitude;
  }
  const waveform = buildWaveformPeaks(audio);
  const words = [w(1, 0.4, 0.6)];
  const ranges = findWaveformSilenceRanges(waveform, words, 1, [], 0.03, 0.1, 0, 0);
  assert(ranges.length === 2, `expected quiet audio around speech, got ${ranges.length}`);
  assert(nearly(ranges[0]!.start, 0.1) && nearly(ranges[0]!.end, 0.4), "quiet before word");
  assert(nearly(ranges[1]!.start, 0.6) && nearly(ranges[1]!.end, 0.9), "quiet after word");
  console.log("waveform cleanup protects transcript words: ok");
}

{
  // Duration eligibility always uses the original quiet run. Padding changes
  // only what gets cut; it must never make a too-short run eligible.
  const sampleRate = 16_000;
  const audio = new Float32Array(sampleRate);
  for (let i = 0; i < audio.length; i++) {
    const t = i / sampleRate;
    const amplitude = t >= 0.2 && t < 0.45 ? 0.01 : 0.1;
    audio[i] = Math.sin(2 * Math.PI * 200 * t) * amplitude;
  }
  const waveform = buildWaveformPeaks(audio);
  const tooShort = findWaveformSilenceRanges(waveform, [], 1, [], 0.03, 0.3, 0.05, 0.05);
  assert(tooShort.length === 0, "padding must not qualify a 0.25s quiet run for a 0.3s minimum");
  const eligible = findWaveformSilenceRanges(waveform, [], 1, [], 0.03, 0.2, 0.05, 0.05);
  assert(
    eligible.length === 1 && nearly(eligible[0]!.end - eligible[0]!.start, 0.15),
    "eligible run should be shortened only after duration matching"
  );
  console.log("waveform duration is independent of padding: ok");
}

{
  // Existing edits are never proposed again, and waveform cuts share the same
  // owned restore path as transcript-gap silence cuts.
  const waveform = buildWaveformPeaks(toneSectionAudio());
  const manual: ManualCut[] = [{ id: 1, start: 0.2, end: 0.35 }];
  const ranges = findWaveformSilenceRanges(
    waveform,
    [],
    1,
    manual,
    0.03,
    0.13,
    0,
    0
  );
  assert(ranges.length === 1, "remaining quiet audio should still be found");
  assert(nearly(ranges[0]!.start, 0.35) && nearly(ranges[0]!.end, 0.5), "existing cut subtracted");
  const added = addSilenceCuts(manual, ranges, 2);
  const overlappingWords = [w(1, 0, 0.25), w(2, 0.45, 1)];
  assert(
    findSilenceCuts(overlappingWords, added.cuts).length === 1,
    "owned waveform cut remains restorable despite loose word timestamps"
  );
  const restored = removeOwnedSilenceCuts(added.cuts);
  assert(restored.length === 1 && restored[0]!.id === 1, "unified restore preserves manual cut");
  console.log("waveform silence restore ownership: ok");
}

{
  // Leading + inter-word + trailing silences above the threshold.
  const words = [w(1, 1.0, 1.5), w(2, 3.0, 3.5)];
  const ranges = findSilenceRanges(words, 5.0);
  assert(ranges.length === 3, `expected 3 silences, got ${ranges.length}`);
  // Leading: flush start, pad before speech.
  assert(nearly(ranges[0]!.start, 0) && nearly(ranges[0]!.end, 1.0 - SILENCE_PAD), "leading");
  // Between words: pad both sides.
  assert(
    nearly(ranges[1]!.start, 1.5 + SILENCE_PAD) &&
      nearly(ranges[1]!.end, 3.0 - SILENCE_PAD),
    "between"
  );
  // Trailing: pad after speech, flush end.
  assert(
    nearly(ranges[2]!.start, 3.5 + SILENCE_PAD) && nearly(ranges[2]!.end, 5.0),
    "trailing"
  );
  console.log("leading/between/trailing: ok");
}

{
  // Tiny inter-word gaps must not count as silence.
  const words = [w(1, 0.5, 1.0), w(2, 1.05, 1.5)];
  const ranges = findSilenceRanges(words, 1.5);
  assert(ranges.length === 1, "only leading silence");
  assert(nearly(ranges[0]!.end, 0.5 - SILENCE_PAD), "leading only");
  console.log("short gaps ignored: ok");
}

{
  const words = [w(1, 0, 1), w(2, 1.25, 2)];
  const ranges = findSilenceRanges(words, 2, [], 0.3, 0.1, 0.1);
  assert(ranges.length === 0, "padding must not qualify a 0.25s transcript gap for a 0.3s minimum");
  console.log("transcript duration is independent of padding: ok");
}

{
  // Exactly at the threshold (before pad) should be detected.
  const gap = MIN_SILENCE_DURATION;
  const words = [w(1, 0, 1), w(2, 1 + gap, 2)];
  const ranges = findSilenceRanges(words, 2);
  assert(ranges.length === 1, "threshold silence detected");
  assert(
    nearly(ranges[0]!.start, 1 + SILENCE_PAD) &&
      nearly(ranges[0]!.end, 1 + gap - SILENCE_PAD),
    "padded threshold cut"
  );
  console.log("threshold silence: ok");
}

{
  // An optional maximum protects deliberate long pauses while shorter gaps cut.
  const words = [w(1, 0, 1), w(2, 1.5, 2), w(3, 5, 6)];
  const ranges = findSilenceRanges(words, 6, [], 0.3, 0.05, 0.05, 2);
  assert(ranges.length === 1, `expected only the short pause, got ${ranges.length}`);
  assert(
    nearly(ranges[0]!.start, 1 + SILENCE_PAD) &&
      nearly(ranges[0]!.end, 1.5 - SILENCE_PAD),
    "long pause protected"
  );
  console.log("long pause protection: ok");
}

{
  // Left and right padding can be tuned independently (or both set to zero).
  const words = [w(1, 0, 1), w(2, 2, 3)];
  const asymmetric = findSilenceRanges(words, 3, [], 0.13, 0.1, 0.2);
  assert(asymmetric.length === 1, "asymmetric pause detected");
  assert(
    nearly(asymmetric[0]!.start, 1.1) && nearly(asymmetric[0]!.end, 1.8),
    "asymmetric padding"
  );
  const punchy = findSilenceRanges(words, 3, [], 0.13, 0, 0);
  assert(
    nearly(punchy[0]!.start, 1) && nearly(punchy[0]!.end, 2),
    "zero padding cuts the whole pause"
  );
  console.log("independent padding: ok");
}

{
  // Deleted words already cut their span; silence around them is still found,
  // and the already-cut middle is not re-reported.
  const words = [w(1, 0.5, 1.0), w(2, 1.5, 2.0, true), w(3, 3.0, 3.5)];
  const ranges = findSilenceRanges(words, 3.5);
  // Gap 1.0→3.0 minus deleted cut 1.5–2.0 → [1.0,1.5] and [2.0,3.0], each padded.
  assert(ranges.length === 3, `expected leading + 2 remnants, got ${ranges.length}`);
  assert(nearly(ranges[0]!.start, 0) && nearly(ranges[0]!.end, 0.5 - SILENCE_PAD), "leading");
  assert(
    nearly(ranges[1]!.start, 1.0 + SILENCE_PAD) && nearly(ranges[1]!.end, 1.5),
    "before deleted word (flush against existing cut)"
  );
  assert(
    nearly(ranges[2]!.start, 2.0) && nearly(ranges[2]!.end, 3.0 - SILENCE_PAD),
    "after deleted word"
  );
  console.log("around deleted words: ok");
}

{
  // Already-manual-cut silences disappear from the list (button can hide).
  const words = [w(1, 1.0, 1.5), w(2, 3.0, 3.5)];
  const manual: ManualCut[] = [{ id: 1, start: 0, end: 1.0 - SILENCE_PAD }];
  const ranges = findSilenceRanges(words, 5.0, manual);
  assert(ranges.length === 2, `leading already cut; got ${ranges.length}`);
  assert(ranges.every((r) => r.start >= 1.0), "no leading remnant");
  console.log("skips existing manual cuts: ok");
}

{
  // Idempotent: after cutting all detected silences, none remain.
  const words = [w(1, 1.0, 1.5), w(2, 3.0, 3.5)];
  const first = findSilenceRanges(words, 5.0);
  const manual: ManualCut[] = first.map((r, i) => ({
    id: i + 1,
    start: r.start,
    end: r.end,
  }));
  const second = findSilenceRanges(words, 5.0, manual);
  assert(second.length === 0, `expected no remaining silences, got ${second.length}`);
  console.log("idempotent after cut: ok");
}

{
  const words = [w(1, 0, 1), w(2, 2, 3)];
  const manual: ManualCut[] = [{ id: 1, start: 0.2, end: 0.4 }];
  const added = addSilenceCuts(manual, [{ start: 1, end: 2 }], 2);
  assert(added.cuts.length === 2, "silence cut added separately");
  assert(findSilenceCuts(words, added.cuts).length === 1, "owned silence found");
  const restored = removeOwnedSilenceCuts(added.cuts);
  assert(restored.length === 1 && restored[0]!.id === 1, "manual cut preserved");
  const overlapped = addManualCut(added.cuts, 1.5, 2.5, added.nextId);
  assert(
    overlapped.cuts.some((cut) => cut.source === "silence") &&
      overlapped.cuts.some((cut) => cut.source !== "silence"),
    "later manual trim does not erase silence ownership"
  );
  console.log("owned silence restore: ok");
}

console.log("ALL SILENCE TESTS PASSED");
