---
version: alpha
name: "KwikScript"
description: "A compact, waveform-led desktop editor for turning spoken media into precise text and timeline cuts."
colors:
  primary: "#18181b"
  background: "#fafafa"
  surface: "#ffffff"
  text: "#18181b"
  muted: "#71717a"
  border: "#e4e4e7"
  selection: "#4f46e5"
  preview: "#f59e0b"
  deletion: "#ef4444"
typography:
  sans:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
  mono:
    fontFamily: "Geist Mono, ui-monospace, monospace"
rounded:
  sm: "0.375rem"
  DEFAULT: "0.5rem"
  lg: "0.75rem"
spacing:
  unit: "0.25rem"
  toolbar-height: "3rem"
components:
  button: {}
  popover: {}
  timeline: {}
  transcript: {}
  media-preview: {}
---

# KwikScript Design System

## Overview

### Creative North Star

KwikScript should feel like a quiet editing console: waveform, transcript, and playback state are the expressive material. It borrows the precision and density of an NLE without reproducing a full professional editor’s chrome.

### Product context and register

- **Audience and primary job:** Video creators making fast transcript-led cuts before final finishing in an NLE.
- **Target markets:** Global desktop and web users; the repository’s nine UI locales are supported equally.
- **Usage scene:** Long, processor-intensive local media sessions on laptops, with frequent timeline adjustments and reversible cleanup actions.
- **Register:** Product. Familiarity, legibility, and stable controls take priority over decoration.
- **Memorable signature:** The transcript and waveform share one edit state: amber transcript-led candidates and cool-gray waveform-led candidates remain playable, while red ranges represent committed cuts.
- **Restraint:** Settings, export, and project-management surfaces remain compact and subordinate to the media.
- **Anti-references:** Avoid template-dashboard cards, marketing gradients, oversized controls, or decorative motion that competes with timing information.
- **Token ownership/runtime mapping:** This document mirrors the canonical Tailwind utilities and shared rules in `app/globals.css`; it does not generate runtime tokens.

## Colors

Neutral zinc surfaces carry the interface. Indigo is reserved for selection, amber/orange for playable filler and transcript-pause candidates, cool gray for playable waveform-led quiet-audio candidates, and red for committed deletion. Pattern and marker shape reinforce these colors. Dark mode preserves the semantic roles rather than inverting their meaning. Focus and high-contrast behavior must remain visible even when the neutral chrome is quiet.

## Typography

Geist is the product face; system fallbacks cover every supported script. Controls use sentence case and compact weights. Timings and numeric settings use tabular or monospaced treatment where alignment matters. Transcript text remains generous enough for sustained reading.

## Layout

The editor is a resizable transcript/media workspace above a full-width timeline. Toolbar height and popover geometry remain stable across state changes. Small settings live in existing popovers; primary editing actions remain visible without navigating away from the transcript. Transcript pauses and waveform-defined quiet audio are separate top-level tools because they answer different editing questions and keep independent remembered settings. Kept transcript words are protected regions: waveform cleanup may tighten quiet audio around them, but cannot propose a cut through recognized speech.

## Elevation & Depth

Hierarchy comes from tonal layers, borders, and restrained shadows on floating popovers or media preview only. Static panels stay flat. Overlays may use subtle backdrop blur without moving underlying controls.

## Shapes

Controls use 6–12 px radii: tighter for dense segmented controls, broader for primary actions and dialogs. Waveform and transcript marks follow timing geometry rather than decorative container shapes.

## Components

### Foundational visual states

Every action has visible hover, focus, pressed, disabled, and busy treatment. Loading indicators reserve their final geometry. Amber transcript-led and cool-gray waveform-led ranges are playable previews; red deleted ranges are committed and restorable. Candidate previews stay visible while settings popovers are closed so opening a tool is never required to inspect its proposed edit.

### Buttons and actions

Solid neutral buttons commit primary actions. Ghost controls handle toolbar and reversible secondary actions. Destructive actions use explicit labels and remain separated from safe actions.

### Navigation and data display

The native desktop menu owns project history. The transcript, preview, and timeline preserve the same selected playhead and cut state. Clicking a transcript word seeks to that word and starts playback; clicking or dragging the timeline seeks without forcing playback. Counts appear beside the action they quantify. App-owned scroll surfaces share one slim neutral scrollbar baseline; the transcript alone hides it because its visible time rail is the authored replacement.

### Forms and overlays

Settings reuse the established compact popover, native checkbox semantics, and localized explanatory text. Popovers do not alter page layout and restore focus when dismissed.

### Media preview

The original source remains authoritative for transcription and export. When Chromium cannot display its video codec, the desktop shell creates a temporary H.264 viewing proxy, shows honest progress in the reserved preview region, and removes the proxy when the app quits.

### Iconography

Lucide outline icons are canonical at 12–16 px in dense controls. Icons supplement rather than replace labels for non-universal editing operations.

### Motion

Motion communicates resize, loading, or edit confirmation and respects reduced-motion preferences. Routine settings changes do not animate decoratively.

### Content and data visualization

Copy names the result in plain language: remove, restore, import, and export. Time values stay explicit about seconds and ranges. Waveform color always has a text or interaction-state equivalent.

## Do's and Don'ts

- **Do:** Keep transcript, waveform, and playback state synchronized and reversible.
- **Do:** Put infrequent performance features in Settings and explain their cost.
- **Don't:** Add top-level controls for options that most single-speaker projects never need.
- **Don't:** Use decoration, hidden scroll behavior, or shifting layouts that obscure timing and edit state.
