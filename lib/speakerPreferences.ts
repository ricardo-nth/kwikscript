const SPEAKER_DETECTION_KEY = "rescript-detect-multiple-speakers";

/** Talking-head editing is the common path; extra speaker analysis is opt-in. */
export const DEFAULT_DETECT_MULTIPLE_SPEAKERS = false;

export function loadSpeakerDetectionPreference(): boolean {
  if (typeof localStorage === "undefined") {
    return DEFAULT_DETECT_MULTIPLE_SPEAKERS;
  }
  try {
    const stored = localStorage.getItem(SPEAKER_DETECTION_KEY);
    if (stored === null) return DEFAULT_DETECT_MULTIPLE_SPEAKERS;
    return stored === "true";
  } catch {
    return DEFAULT_DETECT_MULTIPLE_SPEAKERS;
  }
}

export function saveSpeakerDetectionPreference(enabled: boolean): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(SPEAKER_DETECTION_KEY, String(enabled));
  } catch {
    // Private mode or disabled storage: keep the current session usable.
  }
}
