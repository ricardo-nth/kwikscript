import {
  MEMORY_SAVING_ASR_MAX_BYTES,
  shouldPreferMemorySavingAsr,
} from "../lib/runtimeCapacity";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

assert(shouldPreferMemorySavingAsr(8 * 1024 ** 3), "8 GiB prefers smaller ASR");
assert(
  shouldPreferMemorySavingAsr(MEMORY_SAVING_ASR_MAX_BYTES),
  "boundary prefers smaller ASR"
);
assert(
  !shouldPreferMemorySavingAsr(16 * 1024 ** 3),
  "16 GiB keeps the faster GPU path"
);
assert(!shouldPreferMemorySavingAsr(undefined), "web builds keep normal policy");
assert(!shouldPreferMemorySavingAsr(Number.NaN), "invalid memory is ignored");

console.log("ALL RUNTIME CAPACITY TESTS PASSED");
