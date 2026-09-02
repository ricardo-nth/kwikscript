import assert from "node:assert/strict";
import { shouldRetryEmptyParakeetSegment } from "../lib/parakeetRecovery";

assert.equal(shouldRetryEmptyParakeetSegment("webgpu", 0, 1.2), true);
assert.equal(shouldRetryEmptyParakeetSegment("webgpu", 4, 1.2), false);
assert.equal(shouldRetryEmptyParakeetSegment("wasm", 0, 1.2), false);
assert.equal(shouldRetryEmptyParakeetSegment("webgpu", 0, 0.1), false);

console.log("PARAKEET RECOVERY TESTS PASSED");
