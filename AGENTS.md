# KwikScript - Agent Guidelines

Shared instructions for any AI coding agent (Codex reads this file directly; Claude Code reads it via `CLAUDE.md`).

## What this is

KwikScript is an Apple-Silicon fork of [Rescript](https://github.com/wassgha/rescript): a local, transcript-based editor for talking-head video. It cuts by transcript and silence, then exports FCPXML for Final Cut Pro. See `README.md` for features and scope.

Target: one reliable workflow on an M1 Mac. macOS 14+, Apple Silicon only, single-speaker English. Intel, Windows, Linux and the web build are not maintained. Don't add work for them unless asked.

## Git remotes

- `kwikscript` → `github.com/ricardo-nth/kwikscript`, the fork. **Push here.**
- `origin` → `github.com/wassgha/rescript`, upstream. **Never push to `origin`.** Fetch from it only to pull upstream changes.

## Stack and layout

- npm (`package-lock.json`). Node 22, Homebrew FFmpeg at runtime.
- Next.js (App Router, client-only editor) packaged in Electron via static export.
- `app/`, `components/`: editor UI (transcript panel, timeline, cleanup sidebar)
- `lib/`: editor logic: store (zustand), edits, silences, fillers, alignment, timeline serialization, i18n
- `electron/`: main process, preload, menu, updater
- `native/coreml-transcriber/`: Swift helper (Parakeet v3 + word alignment via Core ML, FluidAudio pinned in `Package.resolved`)
- `scripts/`: build, asset copy, native build/benchmark, release notes
- `tests/`: i18n and timeline serialization tests
- `dist/`: local build output (gitignored)

## Checks

These match CI (`.github/workflows/ci.yml`):

```bash
npm run lint
npx next typegen && npx tsc --noEmit   # web typecheck
npm run typecheck:electron
npm run test:i18n
npm run test:timeline
npm run test:native:alignment          # native alignment, when touching lib/align* or native/
```

The dev machine is an M1 MacBook Air with limited headroom. Validate with the checks above. **Don't run `npm run build`, `npm run dist` or `npm run build:native:coreml` mid-task** unless the task is about building or packaging.

Run the app locally with `npm run electron:dev`.

## Docs

- `README.md`: features, caveats, local build steps
- `DESIGN.md`: design tokens and UI conventions. Follow it for UI changes.
- `ROADMAP.md`: planned work
- `docs/PERFORMANCE.md`, `docs/SWIFT-MIGRATION.md`: performance notes and the gates for any Swift rewrite
- `PLAN.md`, `RELEASING.md`: inherited from upstream Rescript and partly outdated. `PLAN.md` describes the original browser Whisper/ffmpeg.wasm architecture, and `RELEASING.md` points at upstream's GitHub Actions. Check against the current code before relying on them.

## License

Upstream's PolyForm Noncommercial license applies. Don't add anything that implies commercial distribution.
