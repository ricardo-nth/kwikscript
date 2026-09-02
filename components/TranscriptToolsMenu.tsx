"use client";

import { useCallback, useId, useMemo, useState } from "react";
import { Undo2, VolumeX, WandSparkles, Zap, type LucideIcon } from "lucide-react";
import { useEditorStore } from "@/lib/store";
import { findDeletedFillerWordIds, findFillerWordIds } from "@/lib/fillers";
import { findSilenceCuts, findSilenceRanges } from "@/lib/silences";
import {
  DEFAULT_SILENCE_PREFERENCES,
  LONG_PAUSE_MAX,
  LONG_PAUSE_MIN,
  LONG_PAUSE_STEP,
  PUNCHY_SILENCE_PREFERENCES,
  SILENCE_DURATION_MAX,
  SILENCE_DURATION_MIN,
  SILENCE_DURATION_STEP,
  SILENCE_PAD_MAX,
  SILENCE_PAD_MIN,
  SILENCE_PAD_STEP,
  loadSilencePreferences,
  normalizeSilencePreferences,
  saveSilencePreferences,
  type SilencePreferences,
} from "@/lib/silencePreferences";
import Popover, { PopoverContent, PopoverTrigger } from "./Popover";
import { useI18n } from "./I18nProvider";
import type { MessageKey } from "@/lib/i18n";

type ToolContext = {
  fillerIds: number[];
  deletedFillerIds: number[];
  silenceCuts: ReturnType<typeof findSilenceCuts>;
  deleteWords: (ids: number[]) => void;
  restoreWords: (ids: number[]) => void;
  restoreSilences: () => void;
};

type ToolDef = {
  key: string;
  labelKey: MessageKey;
  titleKey: MessageKey;
  Icon: LucideIcon;
  count: (ctx: ToolContext) => number;
  run: (ctx: ToolContext) => void;
};

/** One-click transcript actions that do not need configuration. */
const INSTANT_TOOLS: ToolDef[] = [
  {
    key: "remove-fillers",
    labelKey: "tools.removeFillers",
    titleKey: "tools.removeFillersTitle",
    Icon: WandSparkles,
    count: (ctx) => ctx.fillerIds.length,
    run: (ctx) => ctx.deleteWords(ctx.fillerIds),
  },
  {
    key: "restore-fillers",
    labelKey: "tools.restoreFillers",
    titleKey: "tools.restoreFillersTitle",
    Icon: Undo2,
    count: (ctx) => ctx.deletedFillerIds.length,
    run: (ctx) => ctx.restoreWords(ctx.deletedFillerIds),
  },
  {
    key: "restore-silences",
    labelKey: "tools.restoreSilences",
    titleKey: "tools.restoreSilencesTitle",
    Icon: Undo2,
    count: (ctx) => ctx.silenceCuts.length,
    run: (ctx) => ctx.restoreSilences(),
  },
];

function seconds(value: number): string {
  return value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function sameCoreSettings(
  left: SilencePreferences,
  right: SilencePreferences
): boolean {
  return (
    left.minDuration === right.minDuration &&
    left.padStart === right.padStart &&
    left.padEnd === right.padEnd &&
    left.protectLongPauses === right.protectLongPauses &&
    left.maxDuration === right.maxDuration
  );
}

function SettingSlider({
  id,
  label,
  value,
  min,
  max,
  step,
  disabled = false,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  const valueText = `${seconds(value)}s`;
  return (
    <div className={disabled ? "opacity-50" : undefined}>
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <label
          htmlFor={id}
          className="text-[11px] font-medium text-zinc-600 dark:text-zinc-300"
        >
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
            disabled={disabled}
            aria-label={`${label}, ${valueText}`}
            onChange={(event) => {
              const next = Number(event.target.value);
              if (Number.isFinite(next)) onChange(next);
            }}
            className="h-6 w-14 rounded-md border border-zinc-200 bg-white px-1.5 text-right text-[11px] tabular-nums text-zinc-700 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/15 disabled:cursor-not-allowed dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:focus:border-indigo-500"
          />
          <span aria-hidden="true">s</span>
        </label>
      </div>
      <input
        id={id}
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        aria-valuetext={valueText}
        onChange={(event) => onChange(Number(event.target.value))}
        className="block h-4 w-full cursor-pointer accent-indigo-500 disabled:cursor-not-allowed"
      />
    </div>
  );
}

/** Bulk transcript cleanups, including configurable silence removal. */
export default function TranscriptToolsMenu() {
  const { t } = useI18n();
  const words = useEditorStore((state) => state.words);
  const duration = useEditorStore((state) => state.duration);
  const manualCuts = useEditorStore((state) => state.manualCuts);
  const deleteWords = useEditorStore((state) => state.deleteWords);
  const restoreWords = useEditorStore((state) => state.restoreWords);
  const cutSilenceRanges = useEditorStore((state) => state.cutSilenceRanges);
  const restoreSilences = useEditorStore((state) => state.restoreSilences);

  const [open, setOpen] = useState(false);
  const [preferences, setPreferences] = useState<SilencePreferences>(
    loadSilencePreferences
  );
  const panelId = useId();
  const minDurationId = useId();
  const leftPadId = useId();
  const rightPadId = useId();
  const maxDurationId = useId();

  const updatePreferences = useCallback(
    (update: (current: SilencePreferences) => SilencePreferences) => {
      setPreferences((current) => {
        const next = normalizeSilencePreferences(update(current));
        saveSilencePreferences(next);
        return next;
      });
    },
    []
  );

  const applyPreset = useCallback((preset: SilencePreferences) => {
    const next = normalizeSilencePreferences(preset);
    setPreferences(next);
    saveSilencePreferences(next);
  }, []);

  const silenceRanges = useMemo(
    () =>
      findSilenceRanges(
        words,
        duration,
        manualCuts,
        preferences.minDuration,
        preferences.padStart,
        preferences.padEnd,
        preferences.protectLongPauses
          ? preferences.maxDuration
          : Number.POSITIVE_INFINITY
      ),
    [words, duration, manualCuts, preferences]
  );

  const ctx = useMemo<ToolContext>(
    () => ({
      fillerIds: findFillerWordIds(words),
      deletedFillerIds: findDeletedFillerWordIds(words),
      silenceCuts: findSilenceCuts(words, manualCuts),
      deleteWords,
      restoreWords,
      restoreSilences,
    }),
    [words, manualCuts, deleteWords, restoreWords, restoreSilences]
  );

  const availableInstantTools = useMemo(
    () =>
      INSTANT_TOOLS.map((tool) => ({ tool, count: tool.count(ctx) })).filter(
        (item) => item.count > 0
      ),
    [ctx]
  );
  const availableCount =
    availableInstantTools.length + (silenceRanges.length > 0 ? 1 : 0);
  const punchySelected = sameCoreSettings(
    preferences,
    PUNCHY_SILENCE_PREFERENCES
  );
  const defaultSelected = sameCoreSettings(
    preferences,
    DEFAULT_SILENCE_PREFERENCES
  );

  return (
    <Popover open={open} onOpenChange={setOpen} placement="bottom-end" backdrop>
      <div className="relative z-30 shrink-0">
        <PopoverTrigger>
          <button
            type="button"
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-controls={panelId}
            title={t("tools.bulk")}
            onClick={() => setOpen((value) => !value)}
            className="flex h-7 cursor-pointer items-center gap-1.5 rounded-lg px-2 text-xs text-zinc-500 transition hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            <Zap size={14} />
            <span className="hidden sm:inline">{t("common.tools")}</span>
            {availableCount > 0 && (
              <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[9px] font-medium tabular-nums text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
                {availableCount}
              </span>
            )}
          </button>
        </PopoverTrigger>

        <PopoverContent
          id={panelId}
          role="dialog"
          aria-label={t("common.tools")}
          className="z-40 w-[19rem] max-w-[calc(100vw-1rem)] overflow-hidden"
        >
          {availableInstantTools.length > 0 && (
            <section className="border-b border-zinc-100 p-1.5 dark:border-zinc-800">
              {availableInstantTools.map(({ tool, count }) => (
                <button
                  key={tool.key}
                  type="button"
                  title={t(tool.titleKey)}
                  onClick={() => {
                    tool.run(ctx);
                    setOpen(false);
                  }}
                  className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-zinc-700 transition hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/35 dark:text-zinc-300 dark:hover:bg-zinc-800/80"
                >
                  <span className="shrink-0 text-zinc-400 dark:text-zinc-500">
                    <tool.Icon size={14} />
                  </span>
                  <span className="flex-1">{t(tool.labelKey)}</span>
                  <span className="shrink-0 text-[11px] tabular-nums text-zinc-400 dark:text-zinc-500">
                    {count}
                  </span>
                </button>
              ))}
            </section>
          )}

          <section className="px-3 py-3">
            <div className="mb-2.5 flex items-start gap-2.5">
              <span className="mt-0.5 shrink-0 text-indigo-500 dark:text-indigo-400">
                <VolumeX size={15} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-[13px] font-medium text-zinc-800 dark:text-zinc-100">
                    {t("tools.silenceCleanup")}
                  </h2>
                  <span className="rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-300">
                    {silenceRanges.length}
                  </span>
                </div>
                <p className="mt-0.5 text-[10px] leading-relaxed text-zinc-400 dark:text-zinc-500">
                  {t("tools.silenceCleanupHelp")}
                </p>
              </div>
            </div>

            <div
              role="group"
              aria-label={t("tools.silencePresets")}
              className="mb-3 grid grid-cols-2 gap-0.5 rounded-lg bg-zinc-100 p-0.5 dark:bg-zinc-800"
            >
              <button
                type="button"
                aria-pressed={punchySelected}
                onClick={() => applyPreset(PUNCHY_SILENCE_PREFERENCES)}
                className={`cursor-pointer rounded-md px-2 py-1 text-[11px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/35 ${
                  punchySelected
                    ? "bg-white text-indigo-600 shadow-sm dark:bg-zinc-700 dark:text-indigo-300"
                    : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
                }`}
              >
                {t("tools.punchyPreset")}
              </button>
              <button
                type="button"
                aria-pressed={defaultSelected}
                onClick={() => applyPreset(DEFAULT_SILENCE_PREFERENCES)}
                className={`cursor-pointer rounded-md px-2 py-1 text-[11px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/35 ${
                  defaultSelected
                    ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-50"
                    : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
                }`}
              >
                {t("tools.defaultPreset")}
              </button>
            </div>

            <div className="space-y-3.5">
              <SettingSlider
                id={minDurationId}
                label={t("tools.minimumPause")}
                value={preferences.minDuration}
                min={SILENCE_DURATION_MIN}
                max={SILENCE_DURATION_MAX}
                step={SILENCE_DURATION_STEP}
                onChange={(minDuration) =>
                  updatePreferences((current) => ({ ...current, minDuration }))
                }
              />

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
                      updatePreferences((current) => ({ ...current, padStart }))
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
                      updatePreferences((current) => ({ ...current, padEnd }))
                    }
                  />
                </div>
              </div>

              <div className="rounded-lg border border-zinc-100 bg-zinc-50/70 p-2.5 dark:border-zinc-800 dark:bg-zinc-950/40">
                <label className="flex cursor-pointer items-start gap-2.5">
                  <input
                    type="checkbox"
                    checked={preferences.protectLongPauses}
                    onChange={(event) =>
                      updatePreferences((current) => ({
                        ...current,
                        protectLongPauses: event.target.checked,
                      }))
                    }
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 cursor-pointer accent-indigo-500"
                  />
                  <span>
                    <span className="block text-[11px] font-medium text-zinc-700 dark:text-zinc-200">
                      {t("tools.protectLongPauses")}
                    </span>
                    <span className="mt-0.5 block text-[10px] leading-relaxed text-zinc-400 dark:text-zinc-500">
                      {t("tools.protectLongPausesHelp")}
                    </span>
                  </span>
                </label>
                <div className="mt-2.5">
                  <SettingSlider
                    id={maxDurationId}
                    label={t("tools.longestPauseToRemove")}
                    value={preferences.maxDuration}
                    min={Math.max(LONG_PAUSE_MIN, preferences.minDuration)}
                    max={LONG_PAUSE_MAX}
                    step={LONG_PAUSE_STEP}
                    disabled={!preferences.protectLongPauses}
                    onChange={(maxDuration) =>
                      updatePreferences((current) => ({ ...current, maxDuration }))
                    }
                  />
                </div>
              </div>
            </div>

            <button
              type="button"
              disabled={silenceRanges.length === 0}
              onClick={() => {
                cutSilenceRanges(silenceRanges);
                setOpen(false);
              }}
              className="mt-3 flex h-8 w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-indigo-600 px-3 text-[12px] font-medium text-white transition hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/45 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-400 dark:focus-visible:ring-offset-zinc-900 dark:disabled:bg-zinc-800 dark:disabled:text-zinc-600"
            >
              <VolumeX size={14} />
              {silenceRanges.length > 0
                ? t("tools.removeDetectedSilences", {
                    count: silenceRanges.length,
                  })
                : t("tools.noMatchingSilences")}
            </button>
          </section>
        </PopoverContent>
      </div>
    </Popover>
  );
}
