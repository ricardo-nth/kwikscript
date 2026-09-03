"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { AudioWaveform, Pause, Undo2, WandSparkles } from "lucide-react";
import { useEditorStore } from "@/lib/store";
import { findDeletedFillerWordIds, findFillerWordIds } from "@/lib/fillers";
import {
  findSilenceCuts,
  findSilenceRanges,
  findWaveformSilenceRanges,
} from "@/lib/silences";
import {
  SILENCE_DURATION_MAX,
  SILENCE_DURATION_MIN,
  SILENCE_DURATION_STEP,
  SILENCE_MAX_DURATION_MAX,
  SILENCE_MAX_DURATION_STEP,
  SILENCE_PAD_MAX,
  SILENCE_PAD_MIN,
  SILENCE_PAD_STEP,
  SILENCE_THRESHOLD_MAX,
  SILENCE_THRESHOLD_MIN,
  SILENCE_THRESHOLD_STEP,
  loadPausePreferences,
  loadQuietAudioPreferences,
  normalizeSilencePreferences,
  savePausePreferences,
  saveQuietAudioPreferences,
  silenceDurationBounds,
  type SilencePreferences,
} from "@/lib/silencePreferences";
import Popover, { PopoverContent, PopoverTrigger } from "./Popover";
import { useI18n } from "./I18nProvider";

type SilenceTool = "pauses" | "quiet";

function seconds(value: number): string {
  return value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function SettingSlider({
  id,
  label,
  value,
  min,
  max,
  step,
  suffix = "s",
  formatValue = seconds,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  formatValue?: (value: number) => string;
  onChange: (value: number) => void;
}) {
  const valueText = `${formatValue(value)}${suffix}`;
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <label htmlFor={id} className="text-[11px] font-medium text-zinc-600 dark:text-zinc-300">
          {label}
        </label>
        <label className="flex items-center gap-1 text-[10px] text-zinc-400 dark:text-zinc-500">
          <span className="sr-only">{label}</span>
          <input
            type="number"
            value={value}
            min={min}
            max={max}
            step={step}
            aria-label={`${label}, ${valueText}`}
            onChange={(event) => {
              const next = Number(event.target.value);
              if (Number.isFinite(next)) onChange(next);
            }}
            className="h-6 w-[4.25rem] rounded-md border border-zinc-200 bg-white px-1.5 text-right text-[11px] tabular-nums text-zinc-700 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/15 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:focus:border-indigo-500"
          />
          {suffix && <span aria-hidden="true">{suffix}</span>}
        </label>
      </div>
      <input
        id={id}
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        aria-valuetext={valueText}
        onChange={(event) => onChange(Number(event.target.value))}
        className="block h-4 w-full cursor-pointer accent-indigo-500"
      />
    </div>
  );
}

function SilenceSettingsPanel({
  tool,
  panelId,
  preferences,
  onPreferencesChange,
  rangeCount,
  hasRestorableCuts,
  onRestore,
  onRemove,
}: {
  tool: SilenceTool;
  panelId: string;
  preferences: SilencePreferences;
  onPreferencesChange: (update: (current: SilencePreferences) => SilencePreferences) => void;
  rangeCount: number;
  hasRestorableCuts: boolean;
  onRestore: () => void;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  const thresholdId = useId();
  const minDurationId = useId();
  const maxDurationId = useId();
  const leftPadId = useId();
  const rightPadId = useId();
  const isQuiet = tool === "quiet";
  const title = t(isQuiet ? "tools.quietAudioCleanup" : "tools.pauseCleanup");

  return (
    <PopoverContent
      id={panelId}
      role="dialog"
      aria-label={title}
      className="z-40 max-h-[calc(100vh-1rem)] w-[19rem] max-w-[calc(100vw-1rem)] overflow-y-auto"
    >
      <section className="px-3 py-3">
        <div className="mb-3 flex items-start gap-2.5">
          <span className="mt-0.5 shrink-0 text-amber-500 dark:text-amber-400">
            {isQuiet ? <AudioWaveform size={15} /> : <Pause size={15} />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-[13px] font-medium text-zinc-800 dark:text-zinc-100">
                {title}
              </h2>
              <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-amber-700 dark:bg-amber-950/60 dark:text-amber-300">
                {rangeCount}
              </span>
            </div>
            <p className="mt-0.5 text-[10px] leading-relaxed text-zinc-400 dark:text-zinc-500">
              {t(isQuiet ? "tools.quietAudioCleanupHelp" : "tools.pauseCleanupHelp")}
            </p>
          </div>
        </div>

        <div className="space-y-3.5">
          {isQuiet && (
            <div>
              <SettingSlider
                id={thresholdId}
                label={t("tools.loudnessThreshold")}
                value={preferences.threshold}
                min={SILENCE_THRESHOLD_MIN}
                max={SILENCE_THRESHOLD_MAX}
                step={SILENCE_THRESHOLD_STEP}
                suffix=""
                formatValue={(value) => value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}
                onChange={(threshold) =>
                  onPreferencesChange((current) => ({ ...current, threshold }))
                }
              />
              <p className="mt-0.5 text-[10px] leading-relaxed text-zinc-400 dark:text-zinc-500">
                {t("tools.loudnessThresholdHelp")}
              </p>
            </div>
          )}

          <div>
            <p className="mb-1.5 text-[11px] font-medium text-zinc-600 dark:text-zinc-300">
              {t(isQuiet ? "tools.quietDurationRange" : "tools.pauseDurationRange")}
            </p>
            <div
              role="radiogroup"
              aria-label={t(isQuiet ? "tools.quietDurationRange" : "tools.pauseDurationRange")}
              className="mb-2.5 grid grid-cols-2 gap-0.5 rounded-lg bg-zinc-100 p-0.5 dark:bg-zinc-800"
            >
              {(["upTo", "between"] as const).map((durationMode) => {
                const selected = preferences.durationMode === durationMode;
                return (
                  <button
                    key={durationMode}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() =>
                      onPreferencesChange((current) => ({ ...current, durationMode }))
                    }
                    className={`flex h-7 cursor-pointer items-center justify-center rounded-md px-2 text-[11px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/35 ${
                      selected
                        ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-50"
                        : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
                    }`}
                  >
                    {t(durationMode === "upTo" ? "tools.durationUpTo" : "tools.durationBetween")}
                  </button>
                );
              })}
            </div>
            {preferences.durationMode === "upTo" ? (
              <SettingSlider
                id={maxDurationId}
                label={t("tools.longestPauseToRemove")}
                value={preferences.maxDuration}
                min={SILENCE_DURATION_MIN}
                max={SILENCE_MAX_DURATION_MAX}
                step={SILENCE_MAX_DURATION_STEP}
                onChange={(maxDuration) =>
                  onPreferencesChange((current) => ({ ...current, maxDuration }))
                }
              />
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <SettingSlider
                  id={minDurationId}
                  label={t("tools.minimumDuration")}
                  value={preferences.minDuration}
                  min={SILENCE_DURATION_MIN}
                  max={SILENCE_DURATION_MAX}
                  step={SILENCE_DURATION_STEP}
                  onChange={(minDuration) =>
                    onPreferencesChange((current) => ({ ...current, minDuration }))
                  }
                />
                <SettingSlider
                  id={maxDurationId}
                  label={t("tools.maximumDuration")}
                  value={preferences.maxDuration}
                  min={preferences.minDuration}
                  max={SILENCE_MAX_DURATION_MAX}
                  step={SILENCE_MAX_DURATION_STEP}
                  onChange={(maxDuration) =>
                    onPreferencesChange((current) => ({ ...current, maxDuration }))
                  }
                />
              </div>
            )}
            <p className="mt-1 text-[10px] leading-relaxed text-zinc-400 dark:text-zinc-500">
              {t("tools.durationBeforePaddingHelp")}
            </p>
          </div>

          <div>
            <p className="mb-1.5 text-[11px] font-medium text-zinc-600 dark:text-zinc-300">
              {t("tools.padding")}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <SettingSlider
                id={leftPadId}
                label={t("tools.leftPadding")}
                value={preferences.padStart}
                min={SILENCE_PAD_MIN}
                max={SILENCE_PAD_MAX}
                step={SILENCE_PAD_STEP}
                onChange={(padStart) =>
                  onPreferencesChange((current) => ({ ...current, padStart }))
                }
              />
              <SettingSlider
                id={rightPadId}
                label={t("tools.rightPadding")}
                value={preferences.padEnd}
                min={SILENCE_PAD_MIN}
                max={SILENCE_PAD_MAX}
                step={SILENCE_PAD_STEP}
                onChange={(padEnd) =>
                  onPreferencesChange((current) => ({ ...current, padEnd }))
                }
              />
            </div>
          </div>
        </div>

        <div className={`mt-3 grid gap-2 ${hasRestorableCuts ? "grid-cols-2" : "grid-cols-1"}`}>
          {hasRestorableCuts && (
            <button
              type="button"
              onClick={onRestore}
              className="flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-zinc-200 px-2 text-[11px] font-medium text-zinc-600 transition hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/35 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              <Undo2 size={13} />
              {t("tools.restoreSilences")}
            </button>
          )}
          <button
            type="button"
            disabled={rangeCount === 0}
            onClick={onRemove}
            className="flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-2 text-[11px] font-medium text-white transition hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/45 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-400 dark:focus-visible:ring-offset-zinc-900 dark:disabled:bg-zinc-800 dark:disabled:text-zinc-600"
          >
            {isQuiet ? <AudioWaveform size={13} /> : <Pause size={13} />}
            {rangeCount > 0
              ? t(isQuiet ? "tools.removeDetectedQuietAudio" : "tools.removeDetectedPauses", {
                  count: rangeCount,
                })
              : t(isQuiet ? "tools.noMatchingQuietAudio" : "tools.noMatchingPauses")}
          </button>
        </div>
      </section>
    </PopoverContent>
  );
}

/** Direct transcript cleanup actions plus separate transcript- and audio-led silence tools. */
export default function TranscriptToolsMenu() {
  const { t } = useI18n();
  const words = useEditorStore((state) => state.words);
  const duration = useEditorStore((state) => state.duration);
  const manualCuts = useEditorStore((state) => state.manualCuts);
  const waveform = useEditorStore((state) => state.waveform);
  const deleteWords = useEditorStore((state) => state.deleteWords);
  const restoreWords = useEditorStore((state) => state.restoreWords);
  const cutSilenceRanges = useEditorStore((state) => state.cutSilenceRanges);
  const restoreSilences = useEditorStore((state) => state.restoreSilences);
  const setSilencePreviewRanges = useEditorStore((state) => state.setSilencePreviewRanges);

  const [openTool, setOpenTool] = useState<SilenceTool | null>(null);
  const [pausePreferences, setPausePreferences] =
    useState<SilencePreferences>(loadPausePreferences);
  const [quietPreferences, setQuietPreferences] =
    useState<SilencePreferences>(loadQuietAudioPreferences);
  const pausePanelId = useId();
  const quietPanelId = useId();

  const updatePausePreferences = useCallback(
    (update: (current: SilencePreferences) => SilencePreferences) => {
      setPausePreferences((current) => {
        const next = normalizeSilencePreferences(update(current));
        savePausePreferences(next);
        return next;
      });
    },
    []
  );

  const updateQuietPreferences = useCallback(
    (update: (current: SilencePreferences) => SilencePreferences) => {
      setQuietPreferences((current) => {
        const next = normalizeSilencePreferences(update(current));
        saveQuietAudioPreferences(next);
        return next;
      });
    },
    []
  );

  const pauseBounds = useMemo(
    () => silenceDurationBounds(pausePreferences),
    [pausePreferences]
  );
  const quietBounds = useMemo(
    () => silenceDurationBounds(quietPreferences),
    [quietPreferences]
  );

  const pauseRanges = useMemo(
    () =>
      findSilenceRanges(
        words,
        duration,
        manualCuts,
        pauseBounds.minDuration,
        pausePreferences.padStart,
        pausePreferences.padEnd,
        pauseBounds.maxDuration
      ),
    [duration, manualCuts, pauseBounds, pausePreferences, words]
  );

  const quietRanges = useMemo(
    () =>
      waveform
        ? findWaveformSilenceRanges(
            waveform,
            words,
            duration,
            manualCuts,
            quietPreferences.threshold,
            quietBounds.minDuration,
            quietPreferences.padStart,
            quietPreferences.padEnd,
            quietBounds.maxDuration
          )
        : [],
    [duration, manualCuts, quietBounds, quietPreferences, waveform, words]
  );

  useEffect(() => {
    setSilencePreviewRanges(
      openTool === "pauses" ? pauseRanges : openTool === "quiet" ? quietRanges : []
    );
  }, [openTool, pauseRanges, quietRanges, setSilencePreviewRanges]);

  useEffect(() => () => setSilencePreviewRanges([]), [setSilencePreviewRanges]);

  const fillerIds = useMemo(() => findFillerWordIds(words), [words]);
  const deletedFillerIds = useMemo(() => findDeletedFillerWordIds(words), [words]);
  const silenceCuts = useMemo(() => findSilenceCuts(words, manualCuts), [words, manualCuts]);

  const renderSilenceTool = (
    tool: SilenceTool,
    ranges: typeof pauseRanges,
    preferences: SilencePreferences,
    updatePreferences: (update: (current: SilencePreferences) => SilencePreferences) => void,
    panelId: string
  ) => {
    const isQuiet = tool === "quiet";
    const bounds = isQuiet ? quietBounds : pauseBounds;
    const isOpen = openTool === tool;
    return (
      <Popover
        key={tool}
        open={isOpen}
        onOpenChange={(nextOpen) => setOpenTool(nextOpen ? tool : null)}
        placement="bottom-end"
        backdrop
      >
        <div className="relative z-30 shrink-0">
          <PopoverTrigger>
            <button
              type="button"
              aria-haspopup="dialog"
              aria-expanded={isOpen}
              aria-controls={panelId}
              disabled={isQuiet && !waveform}
              title={t(isQuiet ? "tools.removeQuietAudioTitle" : "tools.removePausesTitle", {
                min: seconds(bounds.minDuration),
                max: seconds(bounds.maxDuration),
              })}
              onClick={() => setOpenTool((current) => (current === tool ? null : tool))}
              className="flex h-7 cursor-pointer items-center gap-1.5 rounded-lg px-2 text-xs text-zinc-500 transition hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 disabled:cursor-not-allowed disabled:text-zinc-300 disabled:hover:bg-transparent dark:text-zinc-400 dark:hover:bg-zinc-800 dark:disabled:text-zinc-600"
            >
              {isQuiet ? <AudioWaveform size={14} /> : <Pause size={14} />}
              <span className="hidden min-[560px]:inline">
                {t(isQuiet ? "tools.removeQuietAudio" : "tools.removePauses")}
              </span>
              {ranges.length > 0 && (
                <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[9px] font-medium tabular-nums text-amber-700 dark:bg-amber-950/60 dark:text-amber-300">
                  {ranges.length}
                </span>
              )}
            </button>
          </PopoverTrigger>
          <SilenceSettingsPanel
            tool={tool}
            panelId={panelId}
            preferences={preferences}
            onPreferencesChange={updatePreferences}
            rangeCount={ranges.length}
            hasRestorableCuts={silenceCuts.length > 0}
            onRestore={restoreSilences}
            onRemove={() => {
              cutSilenceRanges(ranges);
              setOpenTool(null);
            }}
          />
        </div>
      </Popover>
    );
  };

  return (
    <div className="flex shrink-0 items-center gap-0.5">
      {deletedFillerIds.length > 0 ? (
        <button
          type="button"
          title={t("tools.restoreFillersTitle")}
          onClick={() => restoreWords(deletedFillerIds)}
          className="flex h-7 cursor-pointer items-center gap-1.5 rounded-lg px-2 text-xs text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
        >
          <Undo2 size={14} />
          <span className="hidden min-[560px]:inline">{t("tools.restoreFillers")}</span>
          <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[9px] font-medium tabular-nums text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
            {deletedFillerIds.length}
          </span>
        </button>
      ) : (
        <button
          type="button"
          disabled={fillerIds.length === 0}
          title={t("tools.removeFillersTitle")}
          onClick={() => deleteWords(fillerIds)}
          className="flex h-7 cursor-pointer items-center gap-1.5 rounded-lg px-2 text-xs text-zinc-500 transition hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 disabled:cursor-not-allowed disabled:text-zinc-300 disabled:hover:bg-transparent dark:text-zinc-400 dark:hover:bg-zinc-800 dark:disabled:text-zinc-600"
        >
          <WandSparkles size={14} />
          <span className="hidden min-[560px]:inline">{t("tools.removeFillers")}</span>
          {fillerIds.length > 0 && (
            <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[9px] font-medium tabular-nums text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
              {fillerIds.length}
            </span>
          )}
        </button>
      )}

      {renderSilenceTool(
        "pauses",
        pauseRanges,
        pausePreferences,
        updatePausePreferences,
        pausePanelId
      )}
      {renderSilenceTool(
        "quiet",
        quietRanges,
        quietPreferences,
        updateQuietPreferences,
        quietPanelId
      )}
    </div>
  );
}
