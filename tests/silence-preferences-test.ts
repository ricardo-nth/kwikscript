import {
  DEFAULT_SILENCE_PREFERENCES,
  PUNCHY_SILENCE_PREFERENCES,
  SILENCE_DURATION_MAX,
  SILENCE_DURATION_MIN,
  SILENCE_PAD_MAX,
  SILENCE_THRESHOLD_MAX,
  normalizeSilencePreferences,
} from "../lib/silencePreferences";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

{
  const normalized = normalizeSilencePreferences(PUNCHY_SILENCE_PREFERENCES);
  assert(normalized.minDuration === 0.13, "punchy minimum duration");
  assert(normalized.threshold === 0.03, "punchy loudness threshold");
  assert(normalized.padStart === 0 && normalized.padEnd === 0, "punchy zero padding");
}

{
  // Older experimental saves used one symmetric `pad` value.
  const migrated = normalizeSilencePreferences({ pad: 0.12 });
  assert(migrated.padStart === 0.12 && migrated.padEnd === 0.12, "legacy pad migrated");
}

{
  const clamped = normalizeSilencePreferences({
    minDuration: -10,
    padStart: 99,
    padEnd: -2,
    maxDuration: 0,
    protectLongPauses: true,
    threshold: 99,
  });
  assert(clamped.minDuration === SILENCE_DURATION_MIN, "minimum clamped");
  assert(clamped.padStart === SILENCE_PAD_MAX && clamped.padEnd === 0, "padding clamped");
  assert(clamped.maxDuration >= clamped.minDuration, "maximum follows minimum");
  assert(clamped.threshold === SILENCE_THRESHOLD_MAX, "threshold clamped");
}

{
  const defaults = normalizeSilencePreferences({ minDuration: Number.NaN });
  assert(defaults.minDuration === DEFAULT_SILENCE_PREFERENCES.minDuration, "NaN rejected");
  const upper = normalizeSilencePreferences({ minDuration: 99 });
  assert(upper.minDuration === SILENCE_DURATION_MAX, "maximum clamped");
  const legacy = normalizeSilencePreferences({ minDuration: 0.2 });
  assert(
    legacy.threshold === DEFAULT_SILENCE_PREFERENCES.threshold,
    "saved preferences without threshold migrate to default"
  );
}

console.log("ALL SILENCE PREFERENCE TESTS PASSED");
