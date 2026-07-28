/** Desktop bridge exposed by electron/preload.ts when running inside Electron. */
export type SpeechAnalyzerCheckResult = {
  available: boolean;
  reason?: string;
  locale?: string;
  installedLocales?: string[];
  helperPath?: string | null;
};

export type SpeechAnalyzerProgress = {
  message: string;
  value: number | null;
};

export type SpeechAnalyzerTranscribeRequest = {
  path?: string;
  data?: ArrayBuffer;
  name?: string;
  locale?: string;
};

export type SpeechAnalyzerWord = {
  id: number;
  text: string;
  start: number;
  end: number;
  speaker: number;
  deleted: boolean;
};

export type SpeechAnalyzerTranscribeResult = {
  words: SpeechAnalyzerWord[];
  locale: string;
  duration: number;
  model: string;
};

export interface RescriptDesktop {
  platform: NodeJS.Platform;
  versions: {
    electron: string;
    chrome: string;
    node: string;
  };
  speechAnalyzer?: {
    check: () => Promise<SpeechAnalyzerCheckResult>;
    transcribe: (
      req: SpeechAnalyzerTranscribeRequest
    ) => Promise<SpeechAnalyzerTranscribeResult>;
    onProgress: (handler: (progress: SpeechAnalyzerProgress) => void) => () => void;
  };
}

declare global {
  interface Window {
    rescriptDesktop?: RescriptDesktop;
  }
}

export {};
