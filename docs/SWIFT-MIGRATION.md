# Electron-to-Swift migration gates

KwikScript already has a native Swift/Core ML speech boundary. A full Swift UI
rewrite should happen only when profiling shows that Electron is the remaining
cause of a real production problem.

## Current architecture

```text
Electron / React editor
  ├─ source selection, transcript UI, waveform and playback
  ├─ silence/filler previews and reversible edit state
  ├─ FCPXML and other timeline exports
  ├─ native FFmpeg process for media extraction/export
  └─ Swift helper
       ├─ Parakeet v3 Core ML on Apple Neural Engine
       └─ Silero Core ML VAD
```

The hottest inference work is therefore already native. Rewriting React views
would not make Parakeet materially faster.

## Migration order

### 1. Keep the native service boundary

Treat the Swift helper as the stable seam. Add structured commands and tests
there only when a measured bottleneck belongs to media or ML processing.

### 2. Optimize ingestion and export before UI replacement

The next likely native wins are:

- avoiding duplicate audio extraction for waveform and transcription;
- native, hardware-accelerated video export;
- bounded proxy generation and cache cleanup;
- structured progress, cancellation and error reporting.

AVFoundation should not replace FFmpeg merely because it is native. The first
ingestion experiment was slower and used more memory on the real 4K source.

### 3. Instrument the Electron editor

Measure cold launch, idle memory, waveform frame time, seek latency, playback
drops, project-close memory recovery, and long-session stability. Temperature
should be observed over sustained jobs rather than inferred from brief CPU
bursts.

### 4. Replace the shell only if it crosses a decision gate

A SwiftUI/AppKit editor prototype is justified when one or more of these remain
true after bounded fixes:

- idle/editor memory materially prevents using Final Cut or another production
  app alongside KwikScript on an 8 GB Mac;
- waveform interaction or cut preview cannot remain smooth on long projects;
- Chromium media playback causes repeatable synchronization or thermal issues;
- startup and project switching are dominated by the web runtime;
- packaging size or security constraints block useful distribution.

The prototype should first consume the existing transcript/timeline model and
native helper. Do not rewrite ASR, edit semantics and UI simultaneously.

## Suggested Swift prototype slice

Build one vertical slice rather than a second full application:

1. Open a media file.
2. Call the existing native transcriber.
3. Render the waveform and word timeline.
4. Preview one reversible silence cut.
5. Play across the cut.
6. Export the same FCPXML as Electron.

Compare it with Electron on the same M1/8 GB machine. Continue only if the
measured improvement is large enough to matter during real editing, not merely
because the native prototype uses fewer frameworks.
