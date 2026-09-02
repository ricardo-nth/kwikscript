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
