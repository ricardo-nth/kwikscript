const SPEAKER_DETECTION_KEY = "rescript-detect-multiple-speakers";

/** Talking-head editing is the common path; extra speaker analysis is opt-in. */
export const DEFAULT_DETECT_MULTIPLE_SPEAKERS = false;

export function loadSpeakerDetectionPreference(): boolean {
  if (typeof localStorage === "undefined") {
    return DEFAULT_DETECT_MULTIPLE_SPEAKERS;
  }
  const stored = localStorage.getItem(SPEAKER_DETECTION_KEY);
  if (stored === null) return DEFAULT_DETECT_MULTIPLE_SPEAKERS;
  return stored === "true";
}

export function saveSpeakerDetectionPreference(enabled: boolean): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(SPEAKER_DETECTION_KEY, String(enabled));
}
