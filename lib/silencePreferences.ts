import {
  MIN_SILENCE_DURATION,
  SILENCE_PAD,
} from "./silences";

/** Existing key retained so current waveform settings migrate without a reset. */
export const SILENCE_PREFERENCES_STORAGE_KEY = "rescript.silence-cleanup";
export const PAUSE_PREFERENCES_STORAGE_KEY = "kwikscript.pause-cleanup";
export const QUIET_AUDIO_PREFERENCES_STORAGE_KEY = SILENCE_PREFERENCES_STORAGE_KEY;

export const SILENCE_DURATION_MIN = 0.01;
export const SILENCE_DURATION_MAX = 2;
export const SILENCE_DURATION_STEP = 0.01;
export const SILENCE_PAD_MIN = 0;
export const SILENCE_PAD_MAX = 0.5;
export const SILENCE_PAD_STEP = 0.01;
export const SILENCE_MAX_DURATION_MAX = 10;
export const SILENCE_MAX_DURATION_STEP = 0.01;
export const DEFAULT_SILENCE_MAX_DURATION = 2.5;
export const SILENCE_THRESHOLD_MIN = 0;
// Speech below 0.1 (-20 dBFS peak-equivalent) is already very quiet; keeping
// the useful range compact makes the native slider precise around 0.03.
export const SILENCE_THRESHOLD_MAX = 0.1;
export const SILENCE_THRESHOLD_STEP = 0.001;

export type SilenceDurationMode = "upTo" | "between";

export interface SilencePreferences {
  /** RMS amplitude below which audio is treated as silent. */
  threshold: number;
  /** Gaps shorter than this stay untouched. */
  minDuration: number;
  /** Existing quiet audio retained after the speech on the left of a cut. */
  padStart: number;
  /** Existing quiet audio retained before the speech on the right of a cut. */
  padEnd: number;
  /** Whether one control keeps left and right padding equal. */
  paddingLocked: boolean;
  /** Gaps longer than this stay untouched. */
  maxDuration: number;
  /** Whether duration matching starts at the practical floor or a chosen minimum. */
  durationMode: SilenceDurationMode;
}

export const DEFAULT_SILENCE_PREFERENCES: SilencePreferences = {
  threshold: 0.03,
  minDuration: MIN_SILENCE_DURATION,
  padStart: SILENCE_PAD,
  padEnd: SILENCE_PAD,
  paddingLocked: true,
  maxDuration: DEFAULT_SILENCE_MAX_DURATION,
  durationMode: "between",
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
  const durationMode: SilenceDurationMode =
    value?.durationMode === "upTo" || value?.durationMode === "between"
      ? value.durationMode
      : DEFAULT_SILENCE_PREFERENCES.durationMode;
  const minDuration = clamp(
    finiteNumber(value?.minDuration, DEFAULT_SILENCE_PREFERENCES.minDuration),
    SILENCE_DURATION_MIN,
    SILENCE_DURATION_MAX
  );
  const maxDuration = clamp(
    finiteNumber(value?.maxDuration, DEFAULT_SILENCE_PREFERENCES.maxDuration),
    durationMode === "between" ? minDuration : SILENCE_DURATION_MIN,
    SILENCE_MAX_DURATION_MAX
  );
  const storedPadStart = clamp(
    finiteNumber(
      value?.padStart,
      finiteNumber(value?.pad, DEFAULT_SILENCE_PREFERENCES.padStart)
    ),
    SILENCE_PAD_MIN,
    SILENCE_PAD_MAX
  );
  const storedPadEnd = clamp(
    finiteNumber(
      value?.padEnd,
      finiteNumber(value?.pad, DEFAULT_SILENCE_PREFERENCES.padEnd)
    ),
    SILENCE_PAD_MIN,
    SILENCE_PAD_MAX
  );
  const paddingLocked =
    typeof value?.paddingLocked === "boolean"
      ? value.paddingLocked
      : Math.abs(storedPadStart - storedPadEnd) < SILENCE_PAD_STEP / 2;
  const linkedPadding = Math.max(storedPadStart, storedPadEnd);
  return {
    threshold: clamp(
      finiteNumber(value?.threshold, DEFAULT_SILENCE_PREFERENCES.threshold),
      SILENCE_THRESHOLD_MIN,
      SILENCE_THRESHOLD_MAX
    ),
    minDuration,
    padStart: paddingLocked ? linkedPadding : storedPadStart,
    padEnd: paddingLocked ? linkedPadding : storedPadEnd,
    paddingLocked,
    maxDuration,
    durationMode,
  };
}

/** Duration bounds passed to silence detection for the selected UI mode. */
export function silenceDurationBounds(preferences: SilencePreferences): {
  minDuration: number;
  maxDuration: number;
} {
  return preferences.durationMode === "upTo"
    ? {
        minDuration: SILENCE_DURATION_MIN,
        maxDuration: preferences.maxDuration,
      }
    : {
        minDuration: preferences.minDuration,
        maxDuration: preferences.maxDuration,
      };
}

export function loadSilencePreferences(): SilencePreferences {
  return loadPreferences(QUIET_AUDIO_PREFERENCES_STORAGE_KEY);
}

function loadPreferences(storageKey: string): SilencePreferences {
  if (typeof window === "undefined") return DEFAULT_SILENCE_PREFERENCES;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return DEFAULT_SILENCE_PREFERENCES;
    return normalizeSilencePreferences(JSON.parse(raw) as Partial<SilencePreferences>);
  } catch {
    return DEFAULT_SILENCE_PREFERENCES;
  }
}

export function saveSilencePreferences(preferences: SilencePreferences): void {
  savePreferences(QUIET_AUDIO_PREFERENCES_STORAGE_KEY, preferences);
}

function savePreferences(storageKey: string, preferences: SilencePreferences): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      storageKey,
      JSON.stringify(normalizeSilencePreferences(preferences))
    );
  } catch {
    // Private mode or disabled storage: keep the current session usable.
  }
}

export function loadPausePreferences(): SilencePreferences {
  return loadPreferences(PAUSE_PREFERENCES_STORAGE_KEY);
}

export function savePausePreferences(preferences: SilencePreferences): void {
  savePreferences(PAUSE_PREFERENCES_STORAGE_KEY, preferences);
}

export function loadQuietAudioPreferences(): SilencePreferences {
  return loadPreferences(QUIET_AUDIO_PREFERENCES_STORAGE_KEY);
}

export function saveQuietAudioPreferences(preferences: SilencePreferences): void {
  savePreferences(QUIET_AUDIO_PREFERENCES_STORAGE_KEY, preferences);
}
