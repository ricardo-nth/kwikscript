"use client";

import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ChevronLast,
  Check,
  Eye,
  EyeOff,
  Merge,
  Pencil,
  Play,
  RotateCcw,
  Scissors,
  Plus,
  VolumeOff,
  X,
} from "lucide-react";
import { useEditorStore } from "@/lib/store";
import { isDisfluencyPlaceholder } from "@/lib/disfluencies";
import { findFillerWordIds } from "@/lib/fillers";
import { normalizeCustomFiller } from "@/lib/fillerPreferences";
import { loadSpeakerDetectionPreference } from "@/lib/speakerPreferences";
import { mapSilencePreviewsToWords } from "@/lib/silences";
import {
  isTranscriptFile,
  parseTranscriptFile,
  TRANSCRIPT_ACCEPT,
} from "@/lib/parseTranscript";
import type { TimeRange, Word } from "@/lib/types";
import TranscriptScrollIndicator from "./TranscriptScrollIndicator";
import SpeakerLabel, {
  SelectionSpeakerButton,
  SelectionSpeakerPopover,
} from "./SpeakerLabel";
import {
  getActiveSceneBoundaries,
  getKeepRanges,
  isWordCutOut,
  mapSplitsToWords,
} from "@/lib/edits";
import { useTranscriptSelection } from "@/hooks/useTranscriptSelection";
import { useTranscriptPlayheadFollow } from "@/hooks/useTranscriptPlayheadFollow";
import { useCutRanges } from "@/hooks/useCutRanges";
import { useCustomFillers } from "@/hooks/useCustomFillers";
import { findActiveWordId, groupWordsBySpeaker } from "@/lib/transcript";
import { isTypingTarget } from "@/lib/keyboard";
import { useI18n } from "./I18nProvider";
import { localizeRuntimeMessage } from "@/lib/i18n";
import {
  loadWordClickPlayback,
  saveWordClickPlayback,
} from "@/lib/editorLayoutPreferences";

const WordSpan = memo(function WordSpan({
  word,
  cutOut,
  fillerCandidate,
  active,
  onClick,
}: {
  word: Word;
  /** True when the word is removed from the edited media (deleted or covered by a cut). */
  cutOut: boolean;
  /** Playable filler word proposed by Remove filler words. */
  fillerCandidate: boolean;
  active: boolean;
  onClick: (word: Word, el: HTMLElement) => void;
}) {
  const { t } = useI18n();
  const placeholder = isDisfluencyPlaceholder(word.text);
  // The trailing space lives inside the span so that selection and deletion
  // highlights are continuous across words instead of breaking at each gap.
  return (
    <span
      data-wid={word.id}
      data-cut={cutOut ? "" : undefined}
      data-placeholder={placeholder ? "" : undefined}
      title={placeholder ? t("transcript.hesitation") : undefined}
      onClick={(e) => onClick(word, e.currentTarget)}
      className={`py-0.5 cursor-pointer transition-colors duration-75 ${
        cutOut
          ? "word-deleted bg-red-50 text-red-600 line-through decoration-red-300 dark:bg-red-950/40 dark:text-red-400 dark:decoration-red-800"
          : active
            ? "bg-neutral-200/80 text-zinc-900 dark:bg-neutral-700/80 dark:text-zinc-50"
            : placeholder || fillerCandidate
              ? "font-medium text-amber-700/90 hover:bg-amber-50 dark:text-amber-400/90 dark:hover:bg-amber-950/40"
              : "text-zinc-800 hover:bg-neutral-50 dark:text-zinc-200 dark:hover:bg-neutral-800/60"
      }`}
    >
      {word.text}{" "}
    </span>
  );
});

type SilencePreview = TimeRange & { kind: "pause" | "quiet" };

/**
 * Descript-style edit boundary: the "|" between two clips created by a split.
 * Click it to join them back together (the inverse of Split / S).
 */
const SplitMarker = memo(function SplitMarker({
  boundaryId,
  onJoin,
}: {
  boundaryId: number;
  onJoin: (id: number) => void;
}) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      title={t("transcript.joinSplit")}
      aria-label={t("transcript.joinClips")}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => onJoin(boundaryId)}
      className="group relative mx-0.5 inline-flex h-4 w-2 cursor-pointer select-none items-center justify-center align-middle"
    >
      <span className="h-4 w-0.5 rounded-full bg-zinc-300 transition-colors group-hover:bg-zinc-600 dark:bg-zinc-600 dark:group-hover:bg-zinc-300" />
      <span className="pointer-events-none absolute -top-5 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-md bg-zinc-900 px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap text-white opacity-0 transition-opacity group-hover:opacity-100 dark:bg-zinc-100 dark:text-zinc-900">
        <Merge size={9} />
        {t("transcript.joinClips")}
      </span>
    </button>
  );
});

const SilencePreviewMarker = memo(function SilencePreviewMarker({
  range,
  onPreview,
}: {
  range: SilencePreview;
  onPreview: (range: TimeRange) => void;
}) {
  const { t } = useI18n();
  const seconds = (range.end - range.start)
    .toFixed(2)
    .replace(/0+$/, "")
    .replace(/\.$/, "");
  const kindLabel = t(
    range.kind === "quiet" ? "tools.quietAudioCleanup" : "tools.pauseCleanup",
  );
  const label = `${kindLabel} — ${t("transcript.silencePreview", { seconds })}`;
  const quiet = range.kind === "quiet";
  return (
    <button
      type="button"
      data-silence-preview={range.kind}
      title={label}
      aria-label={label}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => onPreview(range)}
      className={`mx-0.5 inline-flex h-5 cursor-pointer select-none items-center gap-1 rounded-md border px-1.5 align-middle text-[10px] font-medium tabular-nums leading-none transition focus-visible:outline-none focus-visible:ring-2 ${
        quiet
          ? "border-slate-300/90 bg-slate-100 text-slate-600 hover:border-slate-400 hover:bg-slate-200 focus-visible:ring-slate-500/40 dark:border-slate-600 dark:bg-slate-800/75 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:bg-slate-800"
          : "border-amber-300/80 bg-amber-50 text-amber-700 hover:border-amber-400 hover:bg-amber-100 focus-visible:ring-amber-500/40 dark:border-amber-700/80 dark:bg-amber-950/45 dark:text-amber-300 dark:hover:border-amber-600 dark:hover:bg-amber-950/70"
      }`}
    >
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 ${quiet ? "rotate-45 bg-slate-400" : "rounded-full bg-amber-400"}`}
      />
      {seconds}s
    </button>
  );
});

export default function TranscriptPanel() {
  const { t } = useI18n();
  const {
    fillers: customFillers,
    addFiller: addCustomFiller,
    removeFiller: removeCustomFiller,
  } = useCustomFillers();
  const words = useEditorStore((s) => s.words);
  const silencePreviewRanges = useEditorStore((s) => s.silencePreviewRanges);
  const quietAudioPreviewRanges = useEditorStore(
    (s) => s.quietAudioPreviewRanges,
  );
  const sceneBoundaries = useEditorStore((s) => s.sceneBoundaries);
  const duration = useEditorStore((s) => s.duration);
  const status = useEditorStore((s) => s.status);
  const progress = useEditorStore((s) => s.progress);
  const partialText = useEditorStore((s) => s.partialText);
  const error = useEditorStore((s) => s.error);
  const showDeleted = useEditorStore((s) => s.showDeleted);
  const toggleShowDeleted = useEditorStore((s) => s.toggleShowDeleted);
  const deleteWords = useEditorStore((s) => s.deleteWords);
  const restoreWords = useEditorStore((s) => s.restoreWords);
  const correctWords = useEditorStore((s) => s.correctWords);
  const importWords = useEditorStore((s) => s.importWords);
  const removeSceneBoundary = useEditorStore((s) => s.removeSceneBoundary);
  const selectedWordIds = useEditorStore((s) => s.selectedWordIds);
  const playing = useEditorStore((s) => s.playing);
  const activeWordId = useEditorStore((s) =>
    findActiveWordId(s.words, s.currentTime),
  );

  const cuts = useCutRanges();
  const cutOutIds = useMemo(() => {
    const ids = new Set<number>();
    for (const w of words) {
      if (isWordCutOut(w, cuts)) ids.add(w.id);
    }
    return ids;
  }, [words, cuts]);
  const fillerCandidateIds = useMemo(
    () => new Set(findFillerWordIds(words, customFillers)),
    [words, customFillers],
  );
  const builtInFillerIds = useMemo(
    () => new Set(findFillerWordIds(words)),
    [words],
  );

  const allSilencePreviews = useMemo<SilencePreview[]>(
    () =>
      [
        ...silencePreviewRanges.map((range) => ({
          ...range,
          kind: "pause" as const,
        })),
        ...quietAudioPreviewRanges.map((range) => ({
          ...range,
          kind: "quiet" as const,
        })),
      ].sort((left, right) => left.start - right.start || left.end - right.end),
    [quietAudioPreviewRanges, silencePreviewRanges],
  );

  const previewAnchors = useMemo(
    () =>
      mapSilencePreviewsToWords(
        showDeleted ? words : words.filter((word) => !cutOutIds.has(word.id)),
        allSilencePreviews,
      ),
    [showDeleted, words, cutOutIds, allSilencePreviews],
  );
  const lastPreviewWordId = useMemo(() => {
    const visible = showDeleted
      ? words
      : words.filter((word) => !cutOutIds.has(word.id));
    return visible[visible.length - 1]?.id ?? null;
  }, [showDeleted, words, cutOutIds]);

  // Splits get a joinable edit boundary in the transcript, like the timeline's
  // marker. Splits at the edge of a skipped region are inert and hidden in both.
  const splitBeforeWordId = useMemo(
    () =>
      mapSplitsToWords(
        words,
        getActiveSceneBoundaries(
          sceneBoundaries,
          getKeepRanges(cuts, duration),
        ),
      ),
    [sceneBoundaries, cuts, duration, words],
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const correctInputRef = useRef<HTMLInputElement>(null);
  const [speakerDetectionEnabled] = useState(loadSpeakerDetectionPreference);
  const [playOnWordClick, setPlayOnWordClick] = useState(
    loadWordClickPlayback,
  );
  const [correcting, setCorrecting] = useState<{ ids: number[] } | null>(null);
  const [correctText, setCorrectText] = useState("");
  const [assigningSpeaker, setAssigningSpeaker] = useState<{
    ids: number[];
  } | null>(null);
  // Mirrors Correct / Speaker pickers so selection handlers freeze highlights.
  const freezeSelectionRef = useRef(false);

  const {
    selection,
    clearSelection,
    clearMarks,
    handleWordClick,
    releaseToolbar,
  } = useTranscriptSelection({
    containerRef,
    scrollRef,
    cutOutIds,
    freezeSelectionRef,
    playOnWordClick,
  });

  const {
    showFollowControl,
    followDirection,
    resumeFollowPlayhead,
    markUserScrollGesture,
  } = useTranscriptPlayheadFollow({
    scrollRef,
    containerRef,
    playing,
    activeWordId,
  });

  // Clicking a word seeks — resume following so playback stays in view.
  const onWordClick = useCallback(
    (word: Word, el: HTMLElement) => {
      resumeFollowPlayhead();
      handleWordClick(word, el);
    },
    [handleWordClick, resumeFollowPlayhead],
  );

  const onSilencePreview = useCallback((range: TimeRange) => {
    useEditorStore.getState().seekTo(range.start);
  }, []);

  const toolbarOpen = !!(selection && !correcting && !assigningSpeaker);
  const selectionPhrase = useMemo(() => {
    if (!selection) return "";
    const ids = new Set(selection.ids);
    return normalizeCustomFiller(
      words
        .filter((word) => ids.has(word.id))
        .map((word) => word.text)
        .join(" "),
    );
  }, [selection, words]);
  const selectionIsCustomFiller =
    selectionPhrase.length > 0 && customFillers.includes(selectionPhrase);
  const selectionIsBuiltInFiller =
    !!selection && selection.ids.every((id) => builtInFillerIds.has(id));

  const turns = useMemo(() => groupWordsBySpeaker(words), [words]);
  const showSpeakerLabels = useMemo(
    () => new Set(words.map((word) => word.speaker)).size > 1,
    [words],
  );

  const deletedCount = useMemo(() => cutOutIds.size, [cutOutIds]);
  const handleImportTranscript = useCallback(
    async (files: FileList | null) => {
      const file = files?.[0];
      if (!file) return;
      if (!isTranscriptFile(file)) {
        alert(t("transcript.invalidFile"));
        return;
      }
      if (words.length > 0 && !confirm(t("transcript.replaceConfirm"))) {
        return;
      }
      try {
        const imported = await parseTranscriptFile(file);
        importWords(imported.words, imported.speakers);
      } catch (err) {
        console.error(err);
        alert(
          err instanceof Error
            ? localizeRuntimeMessage(err.message, t)
            : t("error.readTranscript"),
        );
      }
    },
    [words.length, importWords, t],
  );

  const cutSelection = useCallback(() => {
    if (!selection) return;
    deleteWords(selection.ids);
    clearSelection();
  }, [selection, deleteWords, clearSelection]);

  const restoreSelection = useCallback(() => {
    if (!selection) return;
    restoreWords(selection.ids);
    clearSelection();
  }, [selection, restoreWords, clearSelection]);

  const openCorrect = useCallback(() => {
    if (!selection) return;
    const idSet = new Set(selection.ids);
    const text = words
      .filter((w) => idSet.has(w.id))
      .map((w) => w.text)
      .join(" ");
    freezeSelectionRef.current = true;
    setCorrectText(text);
    setCorrecting({ ids: selection.ids });
    releaseToolbar();
  }, [selection, words, releaseToolbar]);

  const closeCorrect = useCallback(() => {
    freezeSelectionRef.current = false;
    setCorrecting(null);
    clearSelection();
  }, [clearSelection]);

  const openSpeakerAssign = useCallback(() => {
    if (!selection) return;
    freezeSelectionRef.current = true;
    setAssigningSpeaker({ ids: selection.ids });
    releaseToolbar();
  }, [selection, releaseToolbar]);

  const closeSpeakerAssign = useCallback(() => {
    freezeSelectionRef.current = false;
    clearMarks();
    setAssigningSpeaker(null);
    clearSelection();
  }, [clearMarks, clearSelection]);

  const applyCorrection = useCallback(() => {
    if (!correcting) return;
    correctWords(correcting.ids, correctText);
    closeCorrect();
  }, [correcting, correctText, correctWords, closeCorrect]);

  const toggleSelectionFiller = useCallback(() => {
    if (!selectionPhrase) return;
    if (selectionIsCustomFiller) removeCustomFiller(selectionPhrase);
    else addCustomFiller(selectionPhrase);
    clearSelection();
  }, [
    selectionPhrase,
    selectionIsCustomFiller,
    addCustomFiller,
    removeCustomFiller,
    clearSelection,
  ]);

  useEffect(() => {
    if (!correcting) return;
    const frame = window.requestAnimationFrame(() => {
      correctInputRef.current?.focus();
      correctInputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [correcting]);

  // Escape clears the transcript selection chrome. Delete / Backspace are handled
  // globally in Editor (cut words restore; kept words / clips delete).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (isTypingTarget(e.target)) return;
      if (selectedWordIds.length === 0) return;
      e.preventDefault();
      clearSelection();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [selectedWordIds, clearSelection]);

  // "@" opens the speaker picker for the current selection.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "@" || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      if (
        !speakerDetectionEnabled ||
        !selection ||
        assigningSpeaker ||
        correcting
      ) {
        return;
      }
      e.preventDefault();
      openSpeakerAssign();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [
    speakerDetectionEnabled,
    selection,
    assigningSpeaker,
    correcting,
    openSpeakerAssign,
  ]);

  const busy = status === "preparing" || status === "transcribing";

  return (
    // min-h-0 keeps this pane from growing to the transcript's full height —
    // without it the panel wrapper scrolls instead of the list below.
    <section className="relative flex min-h-0 min-w-0 overflow-hidden flex-1 flex-col bg-white dark:bg-zinc-900">
      {/* Floats above the scroller rather than sticking inside it, so the
          rubber-band overscroll only carries the transcript, not the bar. */}
      <div className="absolute inset-x-0 top-0 z-10 flex h-10 min-w-0 items-center gap-2 border-b border-zinc-100/80 bg-white/90 px-2 backdrop-blur-md dark:border-zinc-800/80 dark:bg-zinc-900/90">
        {correcting ? (
          <form
            noValidate
            aria-label={t("transcript.correct")}
            onSubmit={(event) => {
              event.preventDefault();
              applyCorrection();
            }}
            className="flex min-w-0 flex-1 items-center gap-1.5"
          >
            <Pencil size={13} className="shrink-0 text-zinc-400" />
            <input
              ref={correctInputRef}
              value={correctText}
              aria-label={t("transcript.correct")}
              onChange={(event) => setCorrectText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && event.nativeEvent.isComposing) {
                  event.preventDefault();
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  closeCorrect();
                }
              }}
              className="h-7 min-w-0 flex-1 rounded-md border border-zinc-300 bg-white px-2 text-xs text-zinc-800 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/15 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-indigo-500"
            />
            <button
              type="submit"
              disabled={correctText.trim().length === 0}
              title={t("transcript.applyCorrection")}
              aria-label={t("transcript.applyCorrection")}
              className="flex size-7 shrink-0 items-center justify-center rounded-md bg-zinc-900 text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              <Check size={13} />
            </button>
            <button
              type="button"
              onClick={closeCorrect}
              title={t("common.cancel")}
              aria-label={t("common.cancel")}
              className="flex size-7 shrink-0 items-center justify-center rounded-md text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            >
              <X size={13} />
            </button>
          </form>
        ) : toolbarOpen && selection ? (
          <div
            data-transcript-toolbar
            aria-label={t("transcript.selectionActions")}
            className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto"
          >
            {selection.anyKept && (
              <button
                type="button"
                onClick={cutSelection}
                className="flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-medium text-zinc-600 transition hover:bg-red-50 hover:text-red-600 dark:text-zinc-300 dark:hover:bg-red-950/50 dark:hover:text-red-400"
              >
                <Scissors size={12} />
                {t("transcript.cut")}
              </button>
            )}
            {selection.anyDeleted && (
              <button
                type="button"
                onClick={restoreSelection}
                className="flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-medium text-zinc-600 transition hover:bg-emerald-50 hover:text-emerald-600 dark:text-zinc-300 dark:hover:bg-emerald-950/40 dark:hover:text-emerald-400"
              >
                <RotateCcw size={12} />
                {t("common.restore")}
              </button>
            )}
            <button
              type="button"
              onClick={openCorrect}
              className="flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-medium text-zinc-600 transition hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              <Pencil size={12} />
              {t("transcript.correct")}
            </button>
            {!selectionIsBuiltInFiller && (
              <button
                type="button"
                onClick={toggleSelectionFiller}
                className="flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-medium text-zinc-600 transition hover:bg-amber-50 hover:text-amber-700 dark:text-zinc-300 dark:hover:bg-amber-950/40 dark:hover:text-amber-300"
              >
                {selectionIsCustomFiller ? (
                  <X size={12} />
                ) : (
                  <Plus size={12} />
                )}
                {t(
                  selectionIsCustomFiller
                    ? "transcript.unmarkFiller"
                    : "transcript.markFiller",
                )}
              </button>
            )}
            {speakerDetectionEnabled && (
              <SelectionSpeakerButton onClick={openSpeakerAssign} />
            )}
          </div>
        ) : (
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
            {t("transcript.header")}
          </span>
        )}

        {!correcting && (
          <div className="ml-auto flex shrink-0 items-center gap-1">
          {deletedCount > 0 && (
            <span className="rounded-md bg-red-50 px-2 py-0.5 text-[9px] font-medium text-red-600 line-clamp-1 line-through dark:bg-red-950/40 dark:text-red-400">
              {t(
                deletedCount === 1
                  ? "transcript.wordDeleted"
                  : "transcript.wordsDeleted",
                { count: deletedCount },
              )}
            </span>
          )}
          {(status === "ready" ||
            status === "error" ||
            status === "transcribing") && (
            <>
              <label
                title={t("transcript.replace")}
                className="flex cursor-pointer h-7 items-center gap-1.5 rounded-lg px-2 text-xs text-zinc-500 transition hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
              >
                <ArrowDownToLine size={14} />
                <span className="hidden sm:inline">{t("common.import")}</span>
                <input
                  ref={importInputRef}
                  type="file"
                  accept={TRANSCRIPT_ACCEPT}
                  // Keep in the layout tree — display:none can block the OS picker.
                  className="sr-only"
                  onChange={(e) => {
                    const files = e.target.files;
                    e.target.value = "";
                    void handleImportTranscript(files);
                  }}
                />
              </label>
            </>
          )}
          <button
            type="button"
            aria-pressed={playOnWordClick}
            aria-label={t(
              playOnWordClick
                ? "transcript.playOnWordClick"
                : "transcript.seekOnlyOnWordClick",
            )}
            title={t(
              playOnWordClick
                ? "transcript.playOnWordClick"
                : "transcript.seekOnlyOnWordClick",
            )}
            onClick={() => {
              setPlayOnWordClick((current) => {
                const next = !current;
                saveWordClickPlayback(next);
                return next;
              });
            }}
            className={`flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50 ${
              playOnWordClick
                ? "bg-indigo-50 text-indigo-600 hover:bg-indigo-100 dark:bg-indigo-950/50 dark:text-indigo-300 dark:hover:bg-indigo-950/70"
                : "text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
            }`}
          >
            <Play
              size={14}
              fill={playOnWordClick ? "currentColor" : "none"}
            />
          </button>
          <button
            type="button"
            onClick={toggleShowDeleted}
            title={
              showDeleted
                ? t("transcript.hideDeleted")
                : t("transcript.showDeleted")
            }
            className="flex cursor-pointer h-7 items-center gap-1.5 rounded-lg px-2 text-xs text-zinc-500 transition hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            {showDeleted ? <Eye size={14} /> : <EyeOff size={14} />}
          </button>
          </div>
        )}
      </div>

      <div
        ref={scrollRef}
        className="transcript-scrollbar-hidden relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto pt-10 scroll-pt-10"
      >
        <div
          ref={containerRef}
          className="relative mx-auto max-w-2xl px-4 py-6 sm:px-8 sm:py-8"
        >
          {busy && (
            <div className="flex flex-col items-start gap-4">
              <div className="w-full bg-zinc-50 p-2 dark:bg-zinc-800/60">
                <div className="flex items-center gap-2">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-neutral-500 border-t-transparent dark:border-neutral-400" />
                  <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
                    {localizeRuntimeMessage(progress.message, t)}
                  </p>
                  {progress.value !== null && (
                    <>
                      <div className="ml-auto w-[100px] h-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
                        <div
                          className="h-full rounded-full bg-neutral-500 transition-[width] duration-300 dark:bg-neutral-400"
                          style={{ width: `${progress.value * 100}%` }}
                        />
                      </div>
                      <span className="text-xs tabular-nums text-zinc-400 dark:text-zinc-500">
                        {Math.round(progress.value * 100)}%
                      </span>
                    </>
                  )}
                </div>
              </div>
              {partialText && (
                <p className="text-[15px] leading-8 text-zinc-400 dark:text-zinc-500">
                  {partialText}
                  <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-neutral-500 align-middle" />
                </p>
              )}
            </div>
          )}

          {status === "error" && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-600 dark:border-red-900/30 dark:bg-red-950/30 dark:text-red-900">
              {localizeRuntimeMessage(error, t)}
            </div>
          )}

          {status === "ready" && words.length === 0 && (
            <p className="mt-2 flex items-center gap-1 text-sm font-medium text-zinc-500 dark:text-zinc-500">
              <VolumeOff size={16} /> {t("transcript.noSpeech")}
            </p>
          )}

          {status === "ready" && (
            <div className="transcript-words selection:bg-transparent">
              {turns.map((turn) => {
                const visible = showDeleted
                  ? turn.words
                  : turn.words.filter((w) => !cutOutIds.has(w.id));
                if (visible.length === 0) return null;
                // First turn in the full word list has no previous speaker to borrow from.
                const canMove = turn.words[0].id !== words[0]?.id;
                return (
                  <div
                    key={`${turn.speaker}-${turn.words[0].id}`}
                    className="mb-7"
                  >
                    {showSpeakerLabels && (
                      <SpeakerLabel
                        speakerId={turn.speaker}
                        turnWordIds={turn.words.map((w) => w.id)}
                        turnStartWordId={turn.words[0].id}
                        canMove={canMove}
                      />
                    )}
                    <p className="select-text text-[15px] leading-8">
                      {visible.map((w) => {
                        const split = splitBeforeWordId.get(w.id);
                        const previews =
                          previewAnchors.beforeWordId.get(w.id) ?? [];
                        return (
                          <React.Fragment key={w.id}>
                            {previews.map((range) => (
                              <SilencePreviewMarker
                                key={`${range.kind}-${range.start}-${range.end}`}
                                range={range}
                                onPreview={onSilencePreview}
                              />
                            ))}
                            {split && (
                              <SplitMarker
                                boundaryId={split.id}
                                onJoin={removeSceneBoundary}
                              />
                            )}
                            <WordSpan
                              word={w}
                              cutOut={cutOutIds.has(w.id)}
                              fillerCandidate={fillerCandidateIds.has(w.id)}
                              active={w.id === activeWordId}
                              onClick={onWordClick}
                            />
                          </React.Fragment>
                        );
                      })}
                      {visible[visible.length - 1]?.id === lastPreviewWordId &&
                        previewAnchors.trailing.map((range) => (
                          <SilencePreviewMarker
                            key={`trailing-${range.kind}-${range.start}-${range.end}`}
                            range={range}
                            onPreview={onSilencePreview}
                          />
                        ))}
                    </p>
                  </div>
                );
              })}
            </div>
          )}

          {assigningSpeaker && (
            <SelectionSpeakerPopover
              wordIds={assigningSpeaker.ids}
              containerRef={containerRef}
              onClose={closeSpeakerAssign}
            />
          )}

        </div>
      </div>
      {/* Gradient overlay — must match the transcript panel surface */}
      <div className="absolute z-10 pointer-events-none inset-x-0 bottom-0 w-full h-20 bg-gradient-to-t from-white to-transparent dark:from-zinc-900" />
      {showFollowControl && (
        <button
          type="button"
          onClick={resumeFollowPlayhead}
          title={t("transcript.scrollWithPlayhead")}
          className="absolute bottom-5 left-1/2 z-20 flex -translate-x-1/2 cursor-pointer items-center gap-1.5 rounded-full border border-zinc-200 bg-white/95 px-3 py-1.5 text-xs font-medium text-zinc-700 backdrop-blur-sm transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800/95 dark:text-zinc-200 dark:hover:bg-zinc-700"
        >
          {followDirection === "up" && <ArrowUp size={13} />}
          {followDirection === "down" && <ArrowDown size={13} />}
          {followDirection === null && <ChevronLast size={13} />}
          {t("transcript.follow")}
        </button>
      )}
      <TranscriptScrollIndicator
        scrollRef={scrollRef}
        contentRef={containerRef}
        onUserScroll={markUserScrollGesture}
      />
    </section>
  );
}
