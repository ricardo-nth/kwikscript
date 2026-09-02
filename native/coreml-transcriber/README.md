# Rescript Core ML transcriber

This is the macOS/Apple-Silicon transcription process used by Rescript Punchy.
The Electron host extracts a mono 16 kHz WAV with native FFmpeg, invokes this
helper, and reads its timestamped JSON result. There is deliberately no
browser/WASM or Intel fallback in the Punchy build.

The executable accepts an audio file and writes one JSON object to standard
output. `words` already matches ReScript's `Word[]` shape, including word-level
timestamps and the single-speaker default.

```sh
CPLUS_INCLUDE_PATH="$(xcrun --sdk macosx --show-sdk-path)/usr/include/c++/v1" \
  swift build -c release
.build/release/rescript-coreml-transcriber /path/to/audio.wav > transcript.json
```

For Electron IPC, pass a second path. The helper writes the JSON there
atomically, which prevents incidental Core ML diagnostics from corrupting the
machine-readable result:

```sh
.build/release/rescript-coreml-transcriber /path/to/audio.wav /path/to/transcript.json
```

The explicit C++ include path works around an Apple Command Line Tools 26 issue
where Swift Package Manager does not discover the SDK's libc++ headers. It is
only needed while compiling the helper, not while running it.

The first run downloads the pinned Parakeet v3 Core ML model and native Silero
VAD model. FluidAudio keeps both in its user cache, so rebuilding or replacing
the app does not download them again. Parakeet supplies verbatim word timings;
Silero exposes omitted middle-of-sentence vocalisations as timed `...` words so
the existing filler-word remove/restore flow can preview and cut them.
