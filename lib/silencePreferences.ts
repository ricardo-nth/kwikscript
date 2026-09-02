import {
  MIN_SILENCE_DURATION,
  SILENCE_PAD,
} from "./silences";

export const SILENCE_PREFERENCES_STORAGE_KEY = "rescript.silence-cleanup";

export const SILENCE_DURATION_MIN = 0.1;
export const SILENCE_DURATION_MAX = 2;
export const SILENCE_DURATION_STEP = 0.01;
export const SILENCE_PAD_MIN = 0;
export const SILENCE_PAD_MAX = 0.5;
export const SILENCE_PAD_STEP = 0.01;
export const LONG_PAUSE_MIN = 0.5;
export const LONG_PAUSE_MAX = 10;
export const LONG_PAUSE_STEP = 0.1;
export const DEFAULT_LONG_PAUSE_LIMIT = 2.5;
export const SILENCE_THRESHOLD_MIN = 0;
// Speech below 0.1 (-20 dBFS peak-equivalent) is already very quiet; keeping
// the useful range compact makes the native slider precise around 0.03.
export const SILENCE_THRESHOLD_MAX = 0.1;
export const SILENCE_THRESHOLD_STEP = 0.001;

export interface SilencePreferences {
  /** RMS amplitude below which audio is treated as silent. */
  threshold: number;
  /** Gaps shorter than this stay untouched. */
  minDuration: number;
  /** Existing quiet audio retained after the speech on the left of a cut. */
  padStart: number;
  /** Existing quiet audio retained before the speech on the right of a cut. */
  padEnd: number;
  /** When enabled, gaps longer than this stay untouched. */
  protectLongPauses: boolean;
  maxDuration: number;
}

export const DEFAULT_SILENCE_PREFERENCES: SilencePreferences = {
  threshold: 0.03,
  minDuration: MIN_SILENCE_DURATION,
  padStart: SILENCE_PAD,
  padEnd: SILENCE_PAD,
  protectLongPauses: false,
  maxDuration: DEFAULT_LONG_PAUSE_LIMIT,
};

/** Matches the ReCut settings supplied for fast short-form delivery. */
export const PUNCHY_SILENCE_PREFERENCES: SilencePreferences = {
  threshold: 0.03,
  minDuration: 0.13,
  padStart: 0,
  padEnd: 0,
  protectLongPauses: false,
  maxDuration: DEFAULT_LONG_PAUSE_LIMIT,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Validate stored or imported preferences before the editor uses them. */
export function normalizeSilencePreferences(
  value:
    | (Partial<SilencePreferences> & { pad?: unknown })
    | null
    | undefined
): SilencePreferences {
  const minDuration = clamp(
    finiteNumber(value?.minDuration, DEFAULT_SILENCE_PREFERENCES.minDuration),
    SILENCE_DURATION_MIN,
    SILENCE_DURATION_MAX
  );
  const maxDuration = clamp(
    finiteNumber(value?.maxDuration, DEFAULT_SILENCE_PREFERENCES.maxDuration),
    Math.max(LONG_PAUSE_MIN, minDuration),
    LONG_PAUSE_MAX
  );
  return {
    threshold: clamp(
      finiteNumber(value?.threshold, DEFAULT_SILENCE_PREFERENCES.threshold),
      SILENCE_THRESHOLD_MIN,
      SILENCE_THRESHOLD_MAX
    ),
    minDuration,
    padStart: clamp(
      finiteNumber(
        value?.padStart,
        finiteNumber(value?.pad, DEFAULT_SILENCE_PREFERENCES.padStart)
      ),
      SILENCE_PAD_MIN,
      SILENCE_PAD_MAX
    ),
    padEnd: clamp(
      finiteNumber(
        value?.padEnd,
        finiteNumber(value?.pad, DEFAULT_SILENCE_PREFERENCES.padEnd)
      ),
      SILENCE_PAD_MIN,
      SILENCE_PAD_MAX
    ),
    protectLongPauses:
      typeof value?.protectLongPauses === "boolean"
        ? value.protectLongPauses
        : DEFAULT_SILENCE_PREFERENCES.protectLongPauses,
    maxDuration,
  };
}

export function loadSilencePreferences(): SilencePreferences {
  if (typeof window === "undefined") return DEFAULT_SILENCE_PREFERENCES;
  try {
    const raw = window.localStorage.getItem(SILENCE_PREFERENCES_STORAGE_KEY);
    if (!raw) return DEFAULT_SILENCE_PREFERENCES;
    return normalizeSilencePreferences(JSON.parse(raw) as Partial<SilencePreferences>);
  } catch {
    return DEFAULT_SILENCE_PREFERENCES;
  }
}

export function saveSilencePreferences(preferences: SilencePreferences): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      SILENCE_PREFERENCES_STORAGE_KEY,
      JSON.stringify(normalizeSilencePreferences(preferences))
    );
  } catch {
    // Private mode or disabled storage: keep the current session usable.
  }
}
