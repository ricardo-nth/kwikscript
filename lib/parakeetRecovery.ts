/**
 * WebGPU can fail softly under memory pressure: Parakeet resolves a speech
 * segment with no timestamped words instead of throwing. Downstream VAD then
 * represents the missing speech as `...`, which looks like a completed but
 * mostly empty transcript. A VAD segment this long should get one reliable
 * WASM retry before it is accepted as empty.
 */
export function shouldRetryEmptyParakeetSegment(
  device: "webgpu" | "wasm",
  wordCount: number,
  segmentDuration: number
): boolean {
  return device === "webgpu" && wordCount === 0 && segmentDuration >= 0.25;
}

export type ParakeetTimedWord = {
  text: string;
  start_time: number;
  end_time: number;
};

export type ParakeetTranscriber = {
  transcribe: (
    audio: Float32Array,
    sampleRate?: number,
    options?: { returnTimestamps?: boolean; timeOffset?: number }
  ) => Promise<{ utterance_text: string; words: ParakeetTimedWord[] }>;
  transcribeLongAudio: (
    audio: Float32Array,
    sampleRate?: number,
    options?: {
      returnTimestamps?: boolean | "word";
      chunkLengthS?: number;
      timeOffset?: number;
    }
  ) => Promise<{ text: string; words?: ParakeetTimedWord[] }>;
};

/**
 * Bound every Parakeet inference window. The old one-shot path could return a
 * perfectly valid but truncated result for a 1–2 minute talking-head clip;
 * because it contained some words, the empty-result retry never ran and VAD
 * filled the untranscribed tail with `...` placeholders.
 *
 * parakeet.js ships a sentence-aware long-audio path specifically for this.
 * Thirty seconds keeps inference comfortably bounded while its overlap and
 * timestamp merger preserve words at window boundaries.
 */
export const PARAKEET_LONG_AUDIO_CHUNK_S = 30;

export async function transcribeParakeetAudio(
  model: ParakeetTranscriber,
  audio: Float32Array,
  sampleRate: number
): Promise<{ utterance_text: string; words: ParakeetTimedWord[] }> {
  const result = await model.transcribeLongAudio(audio, sampleRate, {
    returnTimestamps: "word",
    chunkLengthS: PARAKEET_LONG_AUDIO_CHUNK_S,
    timeOffset: 0,
  });
  return {
    utterance_text: result.text ?? "",
    words: result.words ?? [],
  };
}
