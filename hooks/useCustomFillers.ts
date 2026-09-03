"use client";

import { useSyncExternalStore } from "react";
import {
  addCustomFiller,
  loadCustomFillers,
  removeCustomFiller,
  subscribeCustomFillers,
} from "@/lib/fillerPreferences";

const EMPTY_FILLERS: string[] = [];

/** Device-wide filler vocabulary shared by the sidebar, transcript, and timeline. */
export function useCustomFillers() {
  const fillers = useSyncExternalStore(
    subscribeCustomFillers,
    loadCustomFillers,
    () => EMPTY_FILLERS,
  );

  return {
    fillers,
    addFiller: addCustomFiller,
    removeFiller: removeCustomFiller,
  };
}
