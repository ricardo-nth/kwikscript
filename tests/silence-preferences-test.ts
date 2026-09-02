import {
  DEFAULT_SILENCE_PREFERENCES,
  SILENCE_DURATION_MAX,
  SILENCE_DURATION_MIN,
  SILENCE_PAD_MAX,
  SILENCE_THRESHOLD_MAX,
  normalizeSilencePreferences,
  silenceDurationBounds,
} from "../lib/silencePreferences";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
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
    threshold: 99,
  });
  assert(clamped.minDuration === SILENCE_DURATION_MIN, "minimum clamped");
  assert(clamped.padStart === SILENCE_PAD_MAX && clamped.padEnd === 0, "padding clamped");
  assert(clamped.maxDuration >= clamped.minDuration, "maximum follows minimum");
  assert(clamped.threshold === SILENCE_THRESHOLD_MAX, "threshold clamped");
}

{
  const range = normalizeSilencePreferences({ minDuration: 0.13, maxDuration: 0.4 });
  assert(range.minDuration === 0.13 && range.maxDuration === 0.4, "duration range retained");
  const crossed = normalizeSilencePreferences({ minDuration: 0.7, maxDuration: 0.2 });
  assert(crossed.maxDuration === crossed.minDuration, "maximum cannot cross minimum");
}

{
  const upTo = normalizeSilencePreferences({
    durationMode: "upTo",
    minDuration: 0.7,
    maxDuration: 0.13,
  });
  const bounds = silenceDurationBounds(upTo);
  assert(upTo.maxDuration === 0.13, "up-to maximum is independent of between minimum");
  assert(bounds.minDuration === SILENCE_DURATION_MIN, "up-to starts at practical floor");
  assert(bounds.maxDuration === 0.13, "up-to uses the selected ceiling");

  const between = normalizeSilencePreferences({
    durationMode: "between",
    minDuration: 0.4,
    maxDuration: 0.8,
  });
  const betweenBounds = silenceDurationBounds(between);
  assert(
    betweenBounds.minDuration === 0.4 && betweenBounds.maxDuration === 0.8,
    "between keeps both selected bounds"
  );

  const legacy = normalizeSilencePreferences({ minDuration: 0.2, maxDuration: 0.6 });
  assert(legacy.durationMode === "between", "existing saved ranges migrate to between");
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
