export const CUSTOM_FILLERS_STORAGE_KEY = "kwikscript.custom-fillers";

const listeners = new Set<(fillers: string[]) => void>();
let cachedFillers: string[] | null = null;

/** Canonical form used for storage and phrase matching. */
export function normalizeCustomFiller(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((part) =>
      part.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}-]+$/gu, ""),
    )
    .filter(Boolean)
    .join(" ");
}

export function normalizeCustomFillers(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const unique = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string") continue;
    const normalized = normalizeCustomFiller(value);
    if (normalized) unique.add(normalized);
  }
  return Array.from(unique).sort((left, right) => left.localeCompare(right));
}

export function loadCustomFillers(): string[] {
  if (cachedFillers) return cachedFillers;
  if (typeof window === "undefined") return [];
  try {
    const stored = window.localStorage.getItem(CUSTOM_FILLERS_STORAGE_KEY);
    cachedFillers = stored
      ? normalizeCustomFillers(JSON.parse(stored) as unknown)
      : [];
  } catch {
    cachedFillers = [];
  }
  return cachedFillers;
}

function persistCustomFillers(fillers: string[]): void {
  cachedFillers = normalizeCustomFillers(fillers);
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(
        CUSTOM_FILLERS_STORAGE_KEY,
        JSON.stringify(cachedFillers),
      );
    } catch {
      // Private mode or disabled storage: keep the current session usable.
    }
  }
  for (const listener of listeners) listener(cachedFillers);
}

export function addCustomFiller(value: string): void {
  const normalized = normalizeCustomFiller(value);
  if (!normalized) return;
  persistCustomFillers([...loadCustomFillers(), normalized]);
}

export function removeCustomFiller(value: string): void {
  const normalized = normalizeCustomFiller(value);
  persistCustomFillers(
    loadCustomFillers().filter((filler) => filler !== normalized),
  );
}

export function subscribeCustomFillers(
  listener: (fillers: string[]) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
