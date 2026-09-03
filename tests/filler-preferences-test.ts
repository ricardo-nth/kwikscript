import {
  CUSTOM_FILLERS_STORAGE_KEY,
  addCustomFiller,
  loadCustomFillers,
  normalizeCustomFiller,
  normalizeCustomFillers,
  removeCustomFiller,
  subscribeCustomFillers,
} from "../lib/fillerPreferences";

if (normalizeCustomFiller("  You KNOW, ") !== "you know") {
  throw new Error("custom filler phrases should normalize for matching");
}

const normalized = normalizeCustomFillers([
  "Like",
  "like ",
  "you know",
  "",
  null,
]);
if (normalized.join("|") !== "like|you know") {
  throw new Error(`unexpected normalized library: ${normalized.join("|")}`);
}

const storage = new Map<string, string>();
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
  },
});

let observed = "";
const unsubscribe = subscribeCustomFillers((fillers) => {
  observed = fillers.join("|");
});
addCustomFiller(" Like ");
addCustomFiller("you KNOW");
if (loadCustomFillers().join("|") !== "like|you know") {
  throw new Error("custom filler library should persist normalized phrases");
}
if (observed !== "like|you know") {
  throw new Error("custom filler consumers should update after a change");
}
if (!storage.get(CUSTOM_FILLERS_STORAGE_KEY)?.includes("you know")) {
  throw new Error("custom filler library should be written to device storage");
}
removeCustomFiller("LIKE");
if (loadCustomFillers().join("|") !== "you know") {
  throw new Error("custom fillers should be removable");
}
unsubscribe();

console.log("ALL FILLER PREFERENCE TESTS PASSED");
