# Performance baseline

This is a reproducible baseline, not a marketing benchmark. It exists to catch
regressions and to decide whether moving more of KwikScript out of Electron is
worth the engineering cost.

## Test machine

- MacBook with Apple M1
- 8 GB unified memory
- Apple-Silicon release build
- Parakeet v3 Core ML int8, warm model cache
- Native Homebrew FFmpeg 8.1.2

## Real-world source

- HEVC MP4
- 3840 × 2880 at 25 fps
- AAC mono audio at 48 kHz
- 558.17 seconds (9:18)
- 4,964,054,043 bytes (4.96 GB decimal)

## 2026-09-02 baseline

| Stage | Wall time | Maximum RSS | Result |
| --- | ---: | ---: | --- |
| FFmpeg audio extraction | 2.07–2.24 s | 22.5 MB | 16 kHz mono WAV |
| Parakeet v3 + Silero | 9.54–10.29 s | 166.1 MB | 1,725 words |

The transcription reached the final spoken sentence, preserved 18 literal
`um`/`uh` fillers, and inserted four timed hesitation placeholders. The
repeatable benchmark completed both stages in 12.36 seconds, approximately 45×
faster than the source duration. The current app extracts once more for the
waveform, so a complete fresh import is expected to be roughly 14–15 seconds
before UI rendering overhead.

## AVFoundation ingestion experiment

A self-contained AVFoundation decoder was tested against the same source. It
was not adopted:

| Path | Full fresh-import estimate | Extraction maximum RSS |
| --- | ---: | ---: |
| Native FFmpeg | ~14.0 s | 22.5 MB |
| AVFoundation experiment | ~15.5 s | 94.6 MB |

AVFoundation removed the Homebrew dependency but was about 10% slower and used
roughly four times the extraction memory. For this fork, the documented FFmpeg
prerequisite is the better current tradeoff.

## Short regression clip

The 103.81-second `test2.mp4` fixture remains the transcript-quality check:

- 309 timed words
- five literal spoken `um` tokens
- one Silero hesitation placeholder
- final word timestamp at 103.12 seconds
- no half-video run of placeholder dots

## What to measure next

1. Cold model download and first Core ML compilation separately from warm runs.
2. A 30–60 minute 4K source to verify memory remains bounded.
3. Electron idle RSS after import and after closing a project.
4. Waveform zoom/pan frame time on long recordings.
5. Playback seek latency across hundreds of cuts.
6. FCPXML export and relink accuracy with proxy/original media pairs.
7. Native export time, memory and temperature once the export path is optimized.

Run the benchmark with:

```bash
npm run benchmark:coreml -- /absolute/path/to/source.mp4
```
