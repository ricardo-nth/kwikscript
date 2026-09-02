import {
  DEFAULT_DETECT_MULTIPLE_SPEAKERS,
  loadSpeakerDetectionPreference,
  saveSpeakerDetectionPreference,
} from "../lib/speakerPreferences";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const values = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  },
});

assert(DEFAULT_DETECT_MULTIPLE_SPEAKERS === false, "single speaker is default");
assert(loadSpeakerDetectionPreference() === false, "missing setting stays off");
saveSpeakerDetectionPreference(true);
assert(loadSpeakerDetectionPreference() === true, "multi-speaker choice persists");
saveSpeakerDetectionPreference(false);
assert(loadSpeakerDetectionPreference() === false, "single-speaker choice persists");

console.log("ALL SPEAKER PREFERENCE TESTS PASSED");
