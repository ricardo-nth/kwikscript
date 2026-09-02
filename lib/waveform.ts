/**
 * Downsampled min/max envelope of the audio, for drawing the timeline waveform.
 *
 * The timeline is the only thing on the main thread that ever wanted the raw
 * PCM, and it does not really want it: at every zoom level it collapses a span
 * of samples down to one min/max pair per pixel column. Keeping the decoded
 * Float32Array around to recompute that is expensive in the one place we can
 * least afford it — an hour of mono 16 kHz float32 is 230 MB, held for the whole
 * session, alongside the model weights and the onnxruntime heap. WebKit reloads
 * the tab well before that adds up.
 *
 * So the envelope is computed once, the raw buffer is handed to the worker, and
 * the main thread keeps a few megabytes instead of a few hundred.
 */

export interface WaveformPeaks {
  /** Sample rate used to convert envelope frames back to media time. */
  sampleRate: number;
  /** Source samples summarised by each min/max pair. */
  bucketSize: number;
  /** Length of the audio this was built from, in samples. */
  sampleCount: number;
  /** Per-bucket extremes, quantised to signed bytes. */
  min: Int8Array;
  max: Int8Array;
  /** Samples represented by each RMS loudness frame. */
  rmsFrameSize: number;
  /** Per-frame RMS amplitude in 0..1, quantised to unsigned 16-bit values. */
  rms: Uint16Array;
}

export const WAVEFORM_SAMPLE_RATE = 16_000;
export const RMS_FRAME_DURATION = 0.01;

/**
 * Envelope resolution ceiling — about 4 MB at two bytes per bucket.
 *
 * This is comfortably finer than the timeline can render. The finest span the
 * timeline ever asks for is one pixel at maximum zoom, i.e.
 * `sampleCount / (trackWidthPx * MAX_ZOOM)` samples; with a 256x zoom cap that
 * stays coarser than `sampleCount / 2e6` for any track narrower than ~7800 px.
 * Media short enough to fall under the cap keeps full sample resolution.
 */
const MAX_BUCKETS = 2_000_000;

/** Quantise [-1, 1] to a signed byte, clamping the overshoot hot sources have. */
function quantise(v: number): number {
  const clamped = v < -1 ? -1 : v > 1 ? 1 : v;
  return Math.round(clamped * 127);
}

function quantiseRms(v: number): number {
  return Math.round(Math.min(1, Math.max(0, v)) * 65_535);
}

/**
 * Summarise `audio` into a min/max envelope.
 *
 * One pass, no allocation beyond the two output arrays. `bucketSize` is 1 —
 * i.e. lossless in time, only quantised in amplitude — whenever the audio is
 * short enough for that to fit under {@link MAX_BUCKETS}.
 */
export function buildWaveformPeaks(
  audio: Float32Array,
  maxBuckets = MAX_BUCKETS,
  sampleRate = WAVEFORM_SAMPLE_RATE
): WaveformPeaks {
  const sampleCount = audio.length;
  const bucketSize = Math.max(1, Math.ceil(sampleCount / Math.max(1, maxBuckets)));
  const buckets = Math.ceil(sampleCount / bucketSize);
  const min = new Int8Array(buckets);
  const max = new Int8Array(buckets);
  const rmsFrameSize = Math.max(1, Math.round(sampleRate * RMS_FRAME_DURATION));
  const rms = new Uint16Array(Math.ceil(sampleCount / rmsFrameSize));

  let bucket = 0;
  let lo = 0;
  let hi = 0;
  let rmsFrame = 0;
  let sumSquares = 0;
  let rmsSamples = 0;
  for (let i = 0; i < sampleCount; i++) {
    const value = audio[i];
    if (value < lo) lo = value;
    else if (value > hi) hi = value;
    sumSquares += value * value;
    rmsSamples++;

    if ((i + 1) % bucketSize === 0 || i + 1 === sampleCount) {
      min[bucket] = quantise(lo);
      max[bucket] = quantise(hi);
      bucket++;
      lo = 0;
      hi = 0;
    }
    if ((i + 1) % rmsFrameSize === 0 || i + 1 === sampleCount) {
      rms[rmsFrame] = quantiseRms(Math.sqrt(sumSquares / rmsSamples));
      rmsFrame++;
      sumSquares = 0;
      rmsSamples = 0;
    }
  }
  return { sampleRate, bucketSize, sampleCount, min, max, rmsFrameSize, rms };
}

/**
 * Peak amplitude over `[startSample, endSample)`, as a 0..1 fraction of full
 * scale — half the peak-to-peak swing, which is what the timeline draws.
 *
 * Buckets are inclusive at both ends, so a span never reads as silent just
 * because it fell between two of them.
 */
export function peakBetween(
  peaks: WaveformPeaks,
  startSample: number,
  endSample: number
): number {
  const { bucketSize, min, max } = peaks;
  const buckets = min.length;
  if (buckets === 0) return 0;
  const from = Math.max(0, Math.min(buckets - 1, Math.floor(startSample / bucketSize)));
  const to = Math.max(from, Math.min(buckets - 1, Math.floor((endSample - 1) / bucketSize)));

  let lo = 0;
  let hi = 0;
  for (let b = from; b <= to; b++) {
    if (min[b] < lo) lo = min[b];
    if (max[b] > hi) hi = max[b];
  }
  return Math.min(1, (hi - lo) / 2 / 127);
}
