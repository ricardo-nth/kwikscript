"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  AudioWaveform,
  CircleHelp,
  Lock,
  LockOpen,
  Pause,
  Plus,
  RotateCcw,
  WandSparkles,
  X,
  type LucideIcon,
} from "lucide-react";
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
import { normalizeCustomFiller } from "@/lib/fillerPreferences";
import { useCustomFillers } from "@/hooks/useCustomFillers";
import { useI18n } from "./I18nProvider";
import Popover, { PopoverContent, PopoverTrigger } from "./Popover";

type CleanupTool = "quiet" | "fillers" | "pauses";

const TOOLS: Array<{
  id: CleanupTool;
  labelKey:
    | "tools.removeQuietAudio"
    | "tools.removeFillers"
    | "tools.removePauses";
  shortLabelKey:
    | "tools.quietAudioCleanup"
    | "tools.fillerCleanup"
    | "tools.pauseCleanup";
  icon: LucideIcon;
}> = [
  {
    id: "quiet",
    labelKey: "tools.removeQuietAudio",
    shortLabelKey: "tools.quietAudioCleanup",
    icon: AudioWaveform,
  },
  {
    id: "fillers",
    labelKey: "tools.removeFillers",
    shortLabelKey: "tools.fillerCleanup",
    icon: WandSparkles,
  },
  {
    id: "pauses",
    labelKey: "tools.removePauses",
    shortLabelKey: "tools.pauseCleanup",
    icon: Pause,
  },
];

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
  info,
  compact = false,
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
  info?: string;
  compact?: boolean;
  onChange: (value: number) => void;
}) {
  const { t } = useI18n();
  const valueText = `${formatValue(value)}${suffix}`;
  return (
    <div>
      <div
        className={`mb-1.5 flex items-center justify-between ${compact ? "gap-1" : "gap-3"}`}
      >
        <div className="flex items-center gap-1">
          <label
            htmlFor={id}
            className="text-[11px] font-medium text-zinc-600 dark:text-zinc-300"
          >
            {label}
          </label>
          {info && (
            <InlineInfo label={t("tools.moreInfo", { topic: label })}>
              <p>{info}</p>
            </InlineInfo>
          )}
        </div>
        <div
          className={`flex h-7 shrink-0 items-stretch overflow-hidden rounded-md border border-zinc-200 bg-white transition focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-500/15 dark:border-zinc-700 dark:bg-zinc-950 dark:focus-within:border-indigo-500 ${compact ? "w-[5rem]" : "w-[5.5rem]"}`}
        >
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
            className="min-w-0 flex-1 border-0 bg-transparent py-0 pl-2 pr-0 text-left text-[11px] tabular-nums text-zinc-700 outline-none dark:text-zinc-200"
          />
          {suffix && (
            <span
              aria-hidden="true"
              className="pointer-events-none flex w-5 shrink-0 items-center justify-center pr-1 text-[10px] text-zinc-400 dark:text-zinc-500"
            >
              {suffix}
            </span>
          )}
        </div>
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

function InlineInfo({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      placement="right-start"
      offsetMain={6}
    >
      <PopoverTrigger>
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          title={label}
          aria-label={label}
          aria-expanded={open}
          className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-zinc-400 transition hover:bg-zinc-200/70 hover:text-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/35 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
        >
          <CircleHelp size={13} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        role="note"
        className="z-50 w-56 px-3 py-2 text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-300"
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}

function SectionLabel({
  children,
  info,
}: {
  children: React.ReactNode;
  info?: React.ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div className="mb-2 flex min-h-6 items-center gap-1">
      <h3 className="text-[11px] font-medium text-zinc-700 dark:text-zinc-300">
        {children}
      </h3>
      {info && (
        <InlineInfo label={t("tools.moreInfo", { topic: String(children) })}>
          {typeof info === "string" ? <p>{info}</p> : info}
        </InlineInfo>
      )}
    </div>
  );
}

function PaddingLinkButton({
  locked,
  onClick,
}: {
  locked: boolean;
  onClick: () => void;
}) {
  const { t } = useI18n();
  const label = t(locked ? "tools.unlinkPadding" : "tools.linkPadding");
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={locked}
      className={`flex h-6 cursor-pointer items-center gap-1 rounded-md px-1.5 text-[10px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/35 ${
        locked
          ? "bg-indigo-50 text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-950/60 dark:text-indigo-300 dark:hover:bg-indigo-900/60"
          : "text-zinc-400 hover:bg-zinc-200/70 hover:text-zinc-700 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
      }`}
    >
      {locked ? <Lock size={12} /> : <LockOpen size={12} />}
      <span>{t(locked ? "tools.paddingLinked" : "tools.paddingIndependent")}</span>
    </button>
  );
}

function SilenceControls({
  tool,
  preferences,
  onPreferencesChange,
}: {
  tool: "quiet" | "pauses";
  preferences: SilencePreferences;
  onPreferencesChange: (
    update: (current: SilencePreferences) => SilencePreferences,
  ) => void;
}) {
  const { t } = useI18n();
  const thresholdId = useId();
  const minDurationId = useId();
  const maxDurationId = useId();
  const leftPadId = useId();
  const rightPadId = useId();
  const linkedPadId = useId();
  const isQuiet = tool === "quiet";

  return (
    <div className="space-y-3.5">
      {isQuiet && (
        <div>
          <SettingSlider
            id={thresholdId}
            label={t("tools.loudnessThreshold")}
            info={t("tools.loudnessThresholdHelp")}
            value={preferences.threshold}
            min={SILENCE_THRESHOLD_MIN}
            max={SILENCE_THRESHOLD_MAX}
            step={SILENCE_THRESHOLD_STEP}
            suffix=""
            formatValue={(value) =>
              value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")
            }
            onChange={(threshold) =>
              onPreferencesChange((current) => ({ ...current, threshold }))
            }
          />
        </div>
      )}

      <div>
        <SectionLabel
          info={`${t(
            isQuiet
              ? "tools.quietAudioCleanupHelp"
              : "tools.pauseCleanupHelp",
          )} ${t("tools.durationBeforePaddingHelp")}`}
        >
          {t(isQuiet ? "tools.quietDurationRange" : "tools.pauseDurationRange")}
        </SectionLabel>
        <div
          role="radiogroup"
          aria-label={t(
            isQuiet ? "tools.quietDurationRange" : "tools.pauseDurationRange",
          )}
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
                  onPreferencesChange((current) => ({
                    ...current,
                    durationMode,
                  }))
                }
                className={`flex h-7 cursor-pointer items-center justify-center rounded-md px-2 text-[11px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/35 ${
                  selected
                    ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-50"
                    : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
                }`}
              >
                {t(
                  durationMode === "upTo"
                    ? "tools.durationUpTo"
                    : "tools.durationBetween",
                )}
              </button>
            );
          })}
        </div>
        <div className="space-y-2.5">
          {preferences.durationMode === "between" && (
            <SettingSlider
              id={minDurationId}
              label={t("tools.minimumDuration")}
              value={preferences.minDuration}
              min={SILENCE_DURATION_MIN}
              max={SILENCE_DURATION_MAX}
              step={SILENCE_DURATION_STEP}
              onChange={(minDuration) =>
                onPreferencesChange((current) => ({
                  ...current,
                  minDuration,
                }))
              }
            />
          )}
          <SettingSlider
            id={maxDurationId}
            label={
              preferences.durationMode === "upTo"
                ? t("tools.longestPauseToRemove")
                : t("tools.maximumDuration")
            }
            value={preferences.maxDuration}
            min={
              preferences.durationMode === "between"
                ? preferences.minDuration
                : SILENCE_DURATION_MIN
            }
            max={SILENCE_MAX_DURATION_MAX}
            step={SILENCE_MAX_DURATION_STEP}
            onChange={(maxDuration) =>
              onPreferencesChange((current) => ({
                ...current,
                maxDuration,
              }))
            }
          />
        </div>
      </div>

      <div>
        <div className="mb-2 flex min-h-6 items-center justify-between gap-2">
          <h3 className="text-[11px] font-medium text-zinc-700 dark:text-zinc-300">
            {t("tools.padding")}
          </h3>
          <PaddingLinkButton
            locked={preferences.paddingLocked}
            onClick={() =>
              onPreferencesChange((current) => {
                if (!current.paddingLocked) {
                  const linkedPadding = Math.max(
                    current.padStart,
                    current.padEnd,
                  );
                  return {
                    ...current,
                    paddingLocked: true,
                    padStart: linkedPadding,
                    padEnd: linkedPadding,
                  };
                }
                return { ...current, paddingLocked: false };
              })
            }
          />
        </div>
        <div className={preferences.paddingLocked ? "" : "grid grid-cols-2 gap-3"}>
          {preferences.paddingLocked ? (
            <SettingSlider
              id={linkedPadId}
              label={t("tools.bothPadding")}
              value={preferences.padStart}
              min={SILENCE_PAD_MIN}
              max={SILENCE_PAD_MAX}
              step={SILENCE_PAD_STEP}
              onChange={(padding) =>
                onPreferencesChange((current) => ({
                  ...current,
                  padStart: padding,
                  padEnd: padding,
                }))
              }
            />
          ) : (
            <>
              <SettingSlider
                id={leftPadId}
                label={t("tools.leftPadding")}
                compact
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
                compact
                value={preferences.padEnd}
                min={SILENCE_PAD_MIN}
                max={SILENCE_PAD_MAX}
                step={SILENCE_PAD_STEP}
                onChange={(padEnd) =>
                  onPreferencesChange((current) => ({ ...current, padEnd }))
                }
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ActionFooter({
  restoreLabel,
  removeLabel,
  canRestore,
  canRemove,
  onRestore,
  onRemove,
}: {
  restoreLabel: string;
  removeLabel: string;
  canRestore: boolean;
  canRemove: boolean;
  onRestore: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-1.5 border-t border-zinc-200 bg-zinc-50/90 p-2.5 dark:border-zinc-800 dark:bg-zinc-900/90">
      <button
        type="button"
        disabled={!canRestore}
        onClick={onRestore}
        className="flex h-9 min-w-0 cursor-pointer items-center justify-center gap-1 rounded-lg border border-zinc-200 bg-white px-1.5 text-[10px] font-medium text-zinc-600 transition hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/35 disabled:cursor-not-allowed disabled:text-zinc-300 disabled:hover:bg-white dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:disabled:text-zinc-700 dark:disabled:hover:bg-zinc-950"
      >
        <RotateCcw size={13} />
        <span>{restoreLabel}</span>
      </button>
      <button
        type="button"
        disabled={!canRemove}
        onClick={onRemove}
        className="flex h-9 min-w-0 cursor-pointer items-center justify-center rounded-lg bg-indigo-600 px-1.5 text-center text-[10px] font-medium leading-tight text-white transition hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/45 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-400 dark:focus-visible:ring-offset-zinc-900 dark:disabled:bg-zinc-800 dark:disabled:text-zinc-600"
      >
        <span>{removeLabel}</span>
      </button>
    </div>
  );
}

export default function CleanupSidebar() {
  const { t } = useI18n();
  const words = useEditorStore((state) => state.words);
  const duration = useEditorStore((state) => state.duration);
  const manualCuts = useEditorStore((state) => state.manualCuts);
  const waveform = useEditorStore((state) => state.waveform);
  const status = useEditorStore((state) => state.status);
  const deleteWords = useEditorStore((state) => state.deleteWords);
  const restoreWords = useEditorStore((state) => state.restoreWords);
  const cutSilenceRanges = useEditorStore((state) => state.cutSilenceRanges);
  const restoreSilences = useEditorStore((state) => state.restoreSilences);
  const setSilencePreviewRanges = useEditorStore(
    (state) => state.setSilencePreviewRanges,
  );
  const setQuietAudioPreviewRanges = useEditorStore(
    (state) => state.setQuietAudioPreviewRanges,
  );
  const { fillers: customFillers, addFiller, removeFiller } =
    useCustomFillers();
  const [activeTool, setActiveTool] = useState<CleanupTool>("quiet");
  const [newFiller, setNewFiller] = useState("");
  const [pausePreferences, setPausePreferences] =
    useState<SilencePreferences>(loadPausePreferences);
  const [quietPreferences, setQuietPreferences] =
    useState<SilencePreferences>(loadQuietAudioPreferences);
  const tabRefs = useRef<Record<CleanupTool, HTMLButtonElement | null>>({
    quiet: null,
    fillers: null,
    pauses: null,
  });
  const panelId = useId();

  const updatePausePreferences = useCallback(
    (update: (current: SilencePreferences) => SilencePreferences) => {
      setPausePreferences((current) => {
        const next = normalizeSilencePreferences(update(current));
        savePausePreferences(next);
        return next;
      });
    },
    [],
  );

  const updateQuietPreferences = useCallback(
    (update: (current: SilencePreferences) => SilencePreferences) => {
      setQuietPreferences((current) => {
        const next = normalizeSilencePreferences(update(current));
        saveQuietAudioPreferences(next);
        return next;
      });
    },
    [],
  );

  const pauseBounds = useMemo(
    () => silenceDurationBounds(pausePreferences),
    [pausePreferences],
  );
  const quietBounds = useMemo(
    () => silenceDurationBounds(quietPreferences),
    [quietPreferences],
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
        pauseBounds.maxDuration,
      ),
    [duration, manualCuts, pauseBounds, pausePreferences, words],
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
            quietBounds.maxDuration,
          )
        : [],
    [duration, manualCuts, quietBounds, quietPreferences, waveform, words],
  );
  const fillerIds = useMemo(
    () => findFillerWordIds(words, customFillers),
    [customFillers, words],
  );
  const deletedFillerIds = useMemo(
    () => findDeletedFillerWordIds(words, customFillers),
    [customFillers, words],
  );
  const silenceCuts = useMemo(
    () => findSilenceCuts(words, manualCuts),
    [manualCuts, words],
  );

  useEffect(() => {
    if (status !== "ready") {
      setSilencePreviewRanges([]);
      setQuietAudioPreviewRanges([]);
      return;
    }
    setSilencePreviewRanges(activeTool === "pauses" ? pauseRanges : []);
    setQuietAudioPreviewRanges(activeTool === "quiet" ? quietRanges : []);
  }, [
    activeTool,
    pauseRanges,
    quietRanges,
    setQuietAudioPreviewRanges,
    setSilencePreviewRanges,
    status,
  ]);

  useEffect(
    () => () => {
      setSilencePreviewRanges([]);
      setQuietAudioPreviewRanges([]);
    },
    [setQuietAudioPreviewRanges, setSilencePreviewRanges],
  );

  const counts: Record<CleanupTool, number> = {
    quiet: quietRanges.length,
    fillers: fillerIds.length,
    pauses: pauseRanges.length,
  };

  const selectTool = (tool: CleanupTool) => {
    setActiveTool(tool);
  };

  const onTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    tool: CleanupTool,
  ) => {
    const index = TOOLS.findIndex((candidate) => candidate.id === tool);
    let nextIndex = index;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % TOOLS.length;
    else if (event.key === "ArrowLeft")
      nextIndex = (index - 1 + TOOLS.length) % TOOLS.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = TOOLS.length - 1;
    else return;
    event.preventDefault();
    const next = TOOLS[nextIndex].id;
    selectTool(next);
    tabRefs.current[next]?.focus();
  };

  const addNewFiller = () => {
    const normalized = normalizeCustomFiller(newFiller);
    if (!normalized) return;
    addFiller(normalized);
    setNewFiller("");
  };

  const activeRanges = activeTool === "quiet" ? quietRanges : pauseRanges;
  const activePreferences =
    activeTool === "quiet" ? quietPreferences : pausePreferences;
  const updateActivePreferences =
    activeTool === "quiet"
      ? updateQuietPreferences
      : updatePausePreferences;

  return (
    <aside
      aria-label={t("tools.cleanupSidebar")}
      className="flex w-[17rem] shrink-0 flex-col border-r border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 max-[820px]:w-[14rem]"
    >
      <div className="border-b border-zinc-200 p-2 dark:border-zinc-800">
        <div
          role="tablist"
          aria-label={t("tools.cleanupSidebar")}
          className="grid grid-cols-3 gap-1"
        >
          {TOOLS.map(({ id, labelKey, shortLabelKey, icon: Icon }) => {
            const selected = activeTool === id;
            return (
              <button
                key={id}
                ref={(node) => {
                  tabRefs.current[id] = node;
                }}
                type="button"
                role="tab"
                id={`cleanup-tab-${id}`}
                aria-selected={selected}
                aria-controls={panelId}
                tabIndex={selected ? 0 : -1}
                title={t(labelKey)}
                onClick={() => selectTool(id)}
                onKeyDown={(event) => onTabKeyDown(event, id)}
                className={`flex min-w-0 cursor-pointer flex-col items-center gap-1 rounded-lg px-1 py-2 text-[10px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 ${
                  selected
                    ? id === "quiet"
                      ? "bg-slate-200/70 text-slate-800 dark:bg-slate-800 dark:text-slate-100"
                      : id === "fillers"
                        ? "bg-red-50 text-red-700 dark:bg-red-950/55 dark:text-red-300"
                        : "bg-amber-100/80 text-amber-800 dark:bg-amber-950/60 dark:text-amber-200"
                    : "text-zinc-500 hover:bg-white hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-200"
                }`}
              >
                <span className="relative">
                  <Icon size={15} />
                  {counts[id] > 0 && (
                    <span className="absolute -right-3 -top-2 min-w-4 rounded-full bg-white px-1 text-center text-[8px] tabular-nums text-zinc-600 shadow-sm dark:bg-zinc-700 dark:text-zinc-200">
                      {counts[id]}
                    </span>
                  )}
                </span>
                <span className="w-full truncate">{t(shortLabelKey)}</span>
              </button>
            );
          })}
        </div>
      </div>

      <section
        id={panelId}
        role="tabpanel"
        aria-labelledby={`cleanup-tab-${activeTool}`}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {activeTool === "fillers" ? (
            <div className="space-y-3">
              <div>
                <SectionLabel
                  info={
                    <div className="space-y-2.5">
                      <p>
                        {t("tools.fillerCleanupHelp")} {t("tools.customFillersHelp")}
                      </p>
                      <div className="border-t border-zinc-200 pt-2 dark:border-zinc-700">
                        <p className="font-semibold text-zinc-800 dark:text-zinc-100">
                          {t("tools.builtInFillersTitle")}
                        </p>
                        <p className="mt-0.5">{t("tools.builtInFillersHelp")}</p>
                      </div>
                    </div>
                  }
                >
                  {t("tools.customFillers")}
                </SectionLabel>
                <form
                  noValidate
                  className="flex gap-1.5"
                  onSubmit={(event) => {
                    event.preventDefault();
                    addNewFiller();
                  }}
                >
                  <input
                    value={newFiller}
                    onChange={(event) => setNewFiller(event.target.value)}
                    onKeyDown={(event) => {
                      if (
                        event.key === "Enter" &&
                        event.nativeEvent.isComposing
                      ) {
                        event.preventDefault();
                      }
                    }}
                    placeholder={t("tools.customFillerPlaceholder")}
                    aria-label={t("tools.customFillerPlaceholder")}
                    className="h-8 min-w-0 flex-1 rounded-lg border border-zinc-200 bg-white px-2.5 text-[12px] text-zinc-800 outline-none transition placeholder:text-zinc-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/15 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-600"
                  />
                  <button
                    type="submit"
                    disabled={!normalizeCustomFiller(newFiller)}
                    title={t("tools.addCustomFiller")}
                    aria-label={t("tools.addCustomFiller")}
                    className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg bg-zinc-900 text-white transition hover:bg-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-400 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200 dark:disabled:bg-zinc-800 dark:disabled:text-zinc-600"
                  >
                    <Plus size={14} />
                  </button>
                </form>
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {customFillers.length > 0 ? (
                    customFillers.map((filler) => (
                      <span
                        key={filler}
                        className="inline-flex min-w-0 items-center gap-1 rounded-md border border-amber-200 bg-amber-50 py-1 pl-2 pr-1 text-[11px] text-amber-800 dark:border-amber-900/70 dark:bg-amber-950/45 dark:text-amber-300"
                      >
                        <span className="max-w-36 truncate">{filler}</span>
                        <button
                          type="button"
                          onClick={() => removeFiller(filler)}
                          title={t("tools.removeCustomFiller", {
                            filler,
                          })}
                          aria-label={t("tools.removeCustomFiller", {
                            filler,
                          })}
                          className="flex h-5 w-5 cursor-pointer items-center justify-center rounded text-amber-600 transition hover:bg-amber-100 hover:text-amber-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40 dark:text-amber-400 dark:hover:bg-amber-900/50 dark:hover:text-amber-100"
                        >
                          <X size={11} />
                        </button>
                      </span>
                    ))
                  ) : (
                    <p className="rounded-lg border border-dashed border-zinc-200 px-3 py-3 text-[10px] leading-relaxed text-zinc-400 dark:border-zinc-800 dark:text-zinc-500">
                      {t("tools.noCustomFillers")}
                    </p>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div>
              <SilenceControls
                tool={activeTool}
                preferences={activePreferences}
                onPreferencesChange={updateActivePreferences}
              />
            </div>
          )}
        </div>

        {activeTool === "fillers" ? (
          <ActionFooter
            restoreLabel={t("tools.restoreFillers")}
            removeLabel={t("tools.removeFillers")}
            canRestore={deletedFillerIds.length > 0}
            canRemove={fillerIds.length > 0}
            onRestore={() => restoreWords(deletedFillerIds)}
            onRemove={() => deleteWords(fillerIds)}
          />
        ) : (
          <ActionFooter
            restoreLabel={t("tools.restoreSilences")}
            removeLabel={t(
              activeTool === "quiet"
                ? "tools.removeDetectedQuietAudio"
                : "tools.removeDetectedPauses",
              { count: activeRanges.length },
            )}
            canRestore={silenceCuts.length > 0}
            canRemove={activeRanges.length > 0}
            onRestore={restoreSilences}
            onRemove={() => cutSilenceRanges(activeRanges)}
          />
        )}
      </section>
    </aside>
  );
}
