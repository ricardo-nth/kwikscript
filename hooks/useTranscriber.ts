"use client";

import { useCallback, useEffect } from "react";
import { en } from "@/lib/i18n/messages/en";
import { reportError } from "@/lib/sentry";
import { useEditorStore } from "@/lib/store";
import { trackEvent } from "@/lib/telemetry";

let activeRun = 0;

/** Stop an in-flight ASR job (e.g. after importing a transcript). */
export function cancelTranscription() {
  activeRun += 1;
  window.rescriptDesktop?.cancelCoreMLTranscription();
}

/** Runs the Apple-Silicon Core ML transcriber and pipes its result into the store. */
export function useTranscriber() {
  useEffect(() => {
    return () => cancelTranscription();
  }, []);

  const transcribe = useCallback(() => {
    const store = useEditorStore.getState();
    const desktop = window.rescriptDesktop;
    const mediaPath = store.mediaPath;
    if (!desktop?.nativeTranscriptionAvailable || !mediaPath) {
      store.setError(
        "Core ML transcription is unavailable. This build requires an Apple-Silicon Mac and the bundled native speech engine."
      );
      return;
    }

    cancelTranscription();
    const run = activeRun;
    store.setStatus("transcribing");
    store.setProgress({ message: en["progress.loadingSpeechModel"], value: null });

    void desktop
      .transcribeCoreML(mediaPath, ({ stage, fraction }) => {
        if (run !== activeRun) return;
        const s = useEditorStore.getState();
        const message =
          stage === "extracting-audio"
            ? en["progress.extractingAudio"]
            : stage === "transcribing"
              ? en["progress.transcribing"]
              : en["progress.loadingSpeechModel"];
        s.setProgress({
          message,
          value: fraction > 0 && fraction < 1 ? fraction : null,
        });
      })
      .then((result) => {
        if (run !== activeRun) return;
        const s = useEditorStore.getState();
        if (s.skipTranscription) return;
        if (!result.available || !result.words) {
          throw new Error(
            "The bundled Core ML speech engine is missing from this installation."
          );
        }
        s.setWords(result.words);
        s.setStatus("ready");
        s.setPartialText("");
        trackEvent("transcription_completed", {
          model: result.model ?? "parakeet-coreml",
          language: "en",
        });
      })
      .catch((err: unknown) => {
        if (run !== activeRun) return;
        const message =
          err instanceof Error ? err.message : "Core ML transcription failed.";
        const s = useEditorStore.getState();
        s.setError(message);
        reportError(err instanceof Error ? err : new Error(message), "coreml-transcription");
      });
  }, []);

  return { transcribe, cancel: cancelTranscription };
}
