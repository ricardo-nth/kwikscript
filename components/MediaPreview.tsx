"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useEditorStore } from "@/lib/store";
import { cutRangeAt, PLAYHEAD_EPSILON_S } from "@/lib/edits";
import { useCutRanges } from "@/hooks/useCutRanges";
import { useI18n } from "./I18nProvider";

/**
 * Owns the <video>/<audio> element and the cut-skipping playback loop.
 * In video mode this is the visual preview; in audio mode it mounts a hidden
 * <audio> so playback still works when the preview panel is omitted.
 */
export default function MediaPreview() {
  const { t } = useI18n();
  const mediaUrl = useEditorStore((s) => s.mediaUrl);
  const mediaPath = useEditorStore((s) => s.mediaPath);
  const mediaKind = useEditorStore((s) => s.mediaKind);
  const status = useEditorStore((s) => s.status);
  const duration = useEditorStore((s) => s.duration);
  const setVideoEl = useEditorStore((s) => s.setVideoEl);
  const setDuration = useEditorStore((s) => s.setDuration);
  const setPlaying = useEditorStore((s) => s.setPlaying);
  const setCurrentTime = useEditorStore((s) => s.setCurrentTime);
  const cuts = useCutRanges();

  const mediaRef = useRef<HTMLMediaElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioPreviewRef = useRef<HTMLAudioElement | null>(null);
  const audioPreviewActiveRef = useRef(false);
  const resumeTimeRef = useRef(0);
  const isAudio = mediaKind === "audio";
  const cutsRef = useRef(cuts);
  const [playbackUrl, setPlaybackUrl] = useState(mediaUrl);
  const [audioPreviewUrl, setAudioPreviewUrl] = useState<string | null>(null);
  const [fallbackNeeded, setFallbackNeeded] = useState(false);
  const [previewState, setPreviewState] = useState<"idle" | "preparing" | "error">("idle");
  const [previewProgress, setPreviewProgress] = useState(0);
  const [previewAttempt, setPreviewAttempt] = useState(0);
  useEffect(() => {
    cutsRef.current = cuts;
  }, [cuts]);

  useEffect(() => {
    window.rescriptDesktop?.cancelVideoPreview();
    let stale = false;
    void Promise.resolve().then(() => {
      if (stale) return;
      audioPreviewActiveRef.current = false;
      audioPreviewRef.current?.pause();
      if (!isAudio) {
        const video = videoRef.current;
        if (video) video.muted = false;
        mediaRef.current = video;
        setVideoEl(video);
      }
      setPlaybackUrl(mediaUrl);
      setAudioPreviewUrl(null);
      setFallbackNeeded(false);
      setPreviewState("idle");
      setPreviewProgress(0);
    });
    return () => {
      stale = true;
    };
  }, [isAudio, mediaUrl, setVideoEl]);

  // Long-GOP video (especially HEVC) can block audio for a noticeable fraction
  // of a second whenever currentTime jumps over a cut. A tiny AAC copy becomes
  // the audible timing master; the original video stays muted and follows it.
  useEffect(() => {
    const desktop = window.rescriptDesktop;
    if (isAudio || status !== "ready" || !desktop || !mediaPath) return;

    let stale = false;
    void desktop
      .prepareAudioPreview(mediaPath)
      .then((result) => {
        if (!stale && result.available && result.url) {
          setAudioPreviewUrl(result.url);
        }
      })
      .catch(() => {
        // The source video remains a fully functional playback fallback.
      });
    return () => {
      stale = true;
    };
  }, [isAudio, mediaPath, status]);

  useEffect(() => {
    const desktop = window.rescriptDesktop;
    if (
      !fallbackNeeded ||
      status !== "ready" ||
      !desktop ||
      !mediaPath ||
      duration <= 0
    ) {
      return;
    }

    let stale = false;
    void (async () => {
      await Promise.resolve();
      if (stale) return;
      setPreviewState("preparing");
      setPreviewProgress(0);
      try {
        const result = await desktop.prepareVideoPreview(mediaPath, duration, (ratio) => {
          if (!stale) setPreviewProgress(ratio);
        });
        if (stale) return;
        if (!result.available || !result.url) {
          setPreviewState("error");
          return;
        }
        resumeTimeRef.current = useEditorStore.getState().currentTime;
        setPlaybackUrl(result.url);
        setFallbackNeeded(false);
        setPreviewState("idle");
      } catch {
        if (!stale) setPreviewState("error");
      }
    })();

    return () => {
      stale = true;
      desktop.cancelVideoPreview();
    };
  }, [duration, fallbackNeeded, mediaPath, previewAttempt, status]);

  const refCb = useCallback(
    (el: HTMLMediaElement | null) => {
      mediaRef.current = el;
      setVideoEl(el);
    },
    [setVideoEl]
  );

  const videoRefCb = useCallback(
    (el: HTMLVideoElement | null) => {
      videoRef.current = el;
      if (!audioPreviewActiveRef.current) {
        mediaRef.current = el;
        setVideoEl(el);
      }
    },
    [setVideoEl],
  );

  const audioPreviewRefCb = useCallback((el: HTMLAudioElement | null) => {
    audioPreviewRef.current = el;
  }, []);

  const activateAudioPreview = useCallback(
    (audio: HTMLAudioElement) => {
      if (audioPreviewActiveRef.current && mediaRef.current === audio) return;
      const video = videoRef.current;
      if (!video) return;
      audio.currentTime = Math.min(
        video.currentTime,
        Math.max(0, audio.duration - 0.05),
      );
      video.muted = true;
      audioPreviewActiveRef.current = true;
      mediaRef.current = audio;
      setVideoEl(audio);
      if (!video.paused) void audio.play();
    },
    [setVideoEl],
  );

  const disableAudioPreview = useCallback(() => {
    const video = videoRef.current;
    const audio = audioPreviewRef.current;
    const wasPlaying = useEditorStore.getState().playing;
    audioPreviewActiveRef.current = false;
    if (audio) audio.pause();
    mediaRef.current = video;
    if (video) {
      video.muted = false;
      setVideoEl(video);
      if (wasPlaying) void video.play();
    }
    setAudioPreviewUrl(null);
  }, [setVideoEl]);

  // Playback loop: mirror time into the store and skip over cut ranges.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const media = mediaRef.current;
      if (media) {
        let t = media.currentTime;
        if (!media.paused) {
          const cut = cutRangeAt(t, cutsRef.current);
          if (cut) {
            const target = cut.end + PLAYHEAD_EPSILON_S;
            if (target >= media.duration - 0.05) {
              media.pause();
              media.currentTime = cut.start;
              t = cut.start;
            } else {
              media.currentTime = target;
              const video = videoRef.current;
              if (audioPreviewActiveRef.current && video) {
                video.currentTime = target;
              }
              t = target;
            }
          }
        }
        const prev = useEditorStore.getState().currentTime;
        if (Math.abs(prev - t) > 0.005) setCurrentTime(t);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [setCurrentTime]);

  const togglePlay = useCallback(() => {
    useEditorStore.getState().togglePlayback();
  }, []);

  if (!mediaUrl) return null;

  if (isAudio) {
    return (
      <audio
        ref={refCb}
        src={mediaUrl}
        preload="metadata"
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        className="hidden"
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-zinc-50/70 p-3 sm:p-4 dark:bg-zinc-950/70">
      <div className="relative flex min-h-0 flex-1 items-center justify-center">
        <video
          ref={videoRefCb}
          src={playbackUrl ?? undefined}
          playsInline
          onClick={togglePlay}
          onLoadedMetadata={(e) => {
            // The original remains the timing authority. A compatibility proxy
            // can differ by a fraction of a frame after transcoding.
            if (playbackUrl === mediaUrl) setDuration(e.currentTarget.duration);
            if (resumeTimeRef.current > 0) {
              e.currentTarget.currentTime = Math.min(
                resumeTimeRef.current,
                Math.max(0, e.currentTarget.duration - 0.05)
              );
              resumeTimeRef.current = 0;
            }
          }}
          onLoadedData={(e) => {
            if (playbackUrl === mediaUrl && e.currentTarget.videoWidth === 0) {
              setFallbackNeeded(true);
            }
          }}
          onError={() => {
            if (playbackUrl === mediaUrl) setFallbackNeeded(true);
          }}
          onPlay={() => {
            if (!audioPreviewActiveRef.current) setPlaying(true);
          }}
          onPause={() => {
            if (!audioPreviewActiveRef.current) setPlaying(false);
          }}
          className="max-h-full max-w-full cursor-pointer rounded-sm bg-black shadow-lg shadow-zinc-900/10 dark:shadow-black/40"
        />
        {audioPreviewUrl && (
          <audio
            ref={audioPreviewRefCb}
            src={audioPreviewUrl}
            preload="auto"
            onCanPlay={(event) => activateAudioPreview(event.currentTarget)}
            onPlay={(event) => {
              if (!audioPreviewActiveRef.current) return;
              const video = videoRef.current;
              if (video) {
                if (
                  Math.abs(video.currentTime - event.currentTarget.currentTime) >
                  0.08
                ) {
                  video.currentTime = event.currentTarget.currentTime;
                }
                if (video.paused) void video.play();
              }
              setPlaying(true);
            }}
            onSeeking={(event) => {
              if (!audioPreviewActiveRef.current) return;
              const video = videoRef.current;
              if (video) video.currentTime = event.currentTarget.currentTime;
            }}
            onPause={(event) => {
              if (!audioPreviewActiveRef.current) return;
              const video = videoRef.current;
              if (video) {
                video.pause();
                video.currentTime = event.currentTarget.currentTime;
              }
              setPlaying(false);
            }}
            onError={disableAudioPreview}
            className="hidden"
          />
        )}
        {previewState === "preparing" && (
          <div
            role="status"
            aria-live="polite"
            className="absolute inset-0 flex items-center justify-center bg-zinc-50/82 backdrop-blur-[1px] dark:bg-zinc-950/82"
          >
            <div className="flex min-w-48 flex-col items-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 py-3 text-center shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
              <span
                aria-hidden="true"
                className="size-4 animate-spin rounded-full border-2 border-zinc-200 border-t-indigo-500 motion-reduce:animate-none dark:border-zinc-700 dark:border-t-indigo-400"
              />
              <span className="text-xs font-medium text-zinc-700 dark:text-zinc-200">
                {t("preview.preparing")}
              </span>
              <span className="text-[10px] tabular-nums text-zinc-400 dark:text-zinc-500">
                {Math.round(previewProgress * 100)}%
              </span>
            </div>
          </div>
        )}
        {previewState === "error" && (
          <div className="absolute inset-0 flex items-center justify-center bg-zinc-50/88 dark:bg-zinc-950/88">
            <div
              role="alert"
              className="flex max-w-64 flex-col items-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 py-3 text-center shadow-sm dark:border-zinc-700 dark:bg-zinc-900"
            >
              <span className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">
                {t("preview.error")}
              </span>
              <button
                type="button"
                onClick={() => setPreviewAttempt((value) => value + 1)}
                className="h-7 cursor-pointer rounded-md bg-zinc-900 px-3 text-[11px] font-medium text-white transition hover:bg-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
              >
                {t("common.retry")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
