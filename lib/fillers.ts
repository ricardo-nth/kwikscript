import { isDisfluencyPlaceholder } from "./disfluencies";
import type { Word } from "./types";

/**
 * Filler sounds that carry no meaning and can safely be cut. Deliberately
 * conservative: ambiguous words like "like", "so" or "right" are excluded
 * because they are usually legitimate. Also includes `...` placeholders for
 * filled pauses ASR dropped (see lib/disfluencies.ts).
 */
const FILLER_WORDS = new Set([
  // English
  "um",
  "umm",
  "ummm",
  "uh",
  "uhh",
  "uhm",
  "erm",
  "er",
  "err",
  "ah",
  "ahh",
  "eh",
  "ehm",
  // German
  "äh",
  "ähh",
  "ähhh",
  "ähm",
  "ähmm",
  "öh",
  "öhm",
  "ööhm",
  // French
  "euh",
  "euuh",
  "euuuh",
  "euhm",
  "heu",
  "heum",
  // Spanish
  "em",
  "emm",
  "emmm",
  "eee",
  // Portuguese
  "hã",
  "hãhã",
  "ahn",
  "ahnn",
  "ãh",
  "ãhh",
  "ãhm",
  "éh",
  "éhh",
  // Chinese
  "嗯",
  "嗯嗯",
  "呃",
  "额",
  "唔",
  // Shared hums / acknowledgements
  "hm",
  "hmm",
  "hmmm",
  "mh",
  "mhh",
  "mm",
  "mmm",
  "mhm",
  "mm-hmm",
  "uh-huh",
]);

/** Normalize a transcript token for matching: lowercase, strip punctuation. */
function normalize(text: string): string {
  return text.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}-]+$/gu, "");
}

export function isFillerWord(text: string): boolean {
  if (isDisfluencyPlaceholder(text)) return true;
  return FILLER_WORDS.has(normalize(text));
}

/** Ids of all not-yet-deleted filler words in the transcript. */
function findCustomPhraseIds(
  words: Word[],
  customFillers: string[],
  deleted: boolean,
): number[] {
  const ids = new Set<number>();
  const normalizedWords = words.map((word) => normalize(word.text));
  for (const filler of customFillers) {
    const phrase = filler
      .split(/\s+/)
      .map(normalize)
      .filter(Boolean);
    if (phrase.length === 0 || phrase.length > words.length) continue;
    for (let start = 0; start <= words.length - phrase.length; start += 1) {
      const matching = phrase.every(
        (token, offset) =>
          normalizedWords[start + offset] === token &&
          words[start + offset].deleted === deleted,
      );
      if (!matching) continue;
      for (let offset = 0; offset < phrase.length; offset += 1) {
        ids.add(words[start + offset].id);
      }
    }
  }
  return Array.from(ids);
}

/** Ids of all not-yet-deleted built-in or custom filler words and phrases. */
export function findFillerWordIds(
  words: Word[],
  customFillers: string[] = [],
): number[] {
  const ids = new Set(
    words
      .filter((word) => !word.deleted && isFillerWord(word.text))
      .map((word) => word.id),
  );
  for (const id of findCustomPhraseIds(words, customFillers, false)) ids.add(id);
  return words.filter((word) => ids.has(word.id)).map((word) => word.id);
}

/** Ids of deleted built-in or custom fillers restored by the bulk action. */
export function findDeletedFillerWordIds(
  words: Word[],
  customFillers: string[] = [],
): number[] {
  const ids = new Set(
    words
      .filter((word) => word.deleted && isFillerWord(word.text))
      .map((word) => word.id),
  );
  for (const id of findCustomPhraseIds(words, customFillers, true)) ids.add(id);
  return words.filter((word) => ids.has(word.id)).map((word) => word.id);
}
