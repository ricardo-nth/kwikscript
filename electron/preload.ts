import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import {
  IPC,
  type SpeechAnalyzerCheckResult,
  type SpeechAnalyzerProgress,
  type SpeechAnalyzerTranscribeRequest,
  type SpeechAnalyzerTranscribeResult,
} from "./ipc/channels";

/**
 * Bridge for the renderer. Exposes host metadata plus SpeechAnalyzer IPC
 * (macOS 26+ helper). The UI stays a normal web surface otherwise.
 */
contextBridge.exposeInMainWorld("rescriptDesktop", {
  platform: process.platform as NodeJS.Platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },

  speechAnalyzer: {
    check(): Promise<SpeechAnalyzerCheckResult> {
      return ipcRenderer.invoke(IPC.speechAnalyzerCheck);
    },
    transcribe(
      req: SpeechAnalyzerTranscribeRequest
    ): Promise<SpeechAnalyzerTranscribeResult> {
      return ipcRenderer.invoke(IPC.speechAnalyzerTranscribe, req);
    },
    onProgress(handler: (progress: SpeechAnalyzerProgress) => void): () => void {
      const listener = (_event: IpcRendererEvent, progress: SpeechAnalyzerProgress) => {
        handler(progress);
      };
      ipcRenderer.on(IPC.speechAnalyzerProgress, listener);
      return () => {
        ipcRenderer.removeListener(IPC.speechAnalyzerProgress, listener);
      };
    },
  },
});
