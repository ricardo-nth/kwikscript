import assert from "node:assert/strict";
import {
  PARAKEET_LONG_AUDIO_CHUNK_S,
  shouldRetryEmptyParakeetSegment,
  transcribeParakeetAudio,
} from "../lib/parakeetRecovery";

assert.equal(shouldRetryEmptyParakeetSegment("webgpu", 0, 1.2), true);
assert.equal(shouldRetryEmptyParakeetSegment("webgpu", 4, 1.2), false);
assert.equal(shouldRetryEmptyParakeetSegment("wasm", 0, 1.2), false);
assert.equal(shouldRetryEmptyParakeetSegment("webgpu", 0, 0.1), false);

async function testLongAudioPath() {
  let oneShotCalls = 0;
  let longAudioOptions: Record<string, unknown> | undefined;
  const result = await transcribeParakeetAudio(
    {
      async transcribe() {
        oneShotCalls += 1;
        return { utterance_text: "truncated", words: [] };
      },
      async transcribeLongAudio(_audio, _sampleRate, options) {
        longAudioOptions = options;
        return {
          text: "complete transcript",
          words: [{ text: "complete", start_time: 95, end_time: 96 }],
        };
      },
    },
    new Float32Array(104 * 16_000),
    16_000
  );

  assert.equal(oneShotCalls, 0, "long clips must not use Parakeet's one-shot API");
  assert.equal(longAudioOptions?.returnTimestamps, "word");
  assert.equal(longAudioOptions?.chunkLengthS, PARAKEET_LONG_AUDIO_CHUNK_S);
  assert.equal(result.words.at(-1)?.end_time, 96);
}

testLongAudioPath()
  .then(() => console.log("PARAKEET RECOVERY TESTS PASSED"))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
