import {
  addSilenceCuts,
  findSilenceCuts,
  findSilenceRanges,
  MIN_SILENCE_DURATION,
  removeOwnedSilenceCuts,
  SILENCE_PAD,
} from "../lib/silences";
import type { ManualCut, Word } from "../lib/types";
import { addManualCut } from "../lib/edits";

function nearly(a: number, b: number, eps = 1e-4): boolean {
  return Math.abs(a - b) < eps;
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
