/**
 * A 12 GiB boundary separates 8 GiB Macs from 16 GiB-and-up machines while
 * leaving room for OS reporting variance. The browser Device Memory API caps
 * its answer at 8 GiB, so the desktop host supplies the real physical total.
 */
export const MEMORY_SAVING_ASR_MAX_BYTES = 12 * 1024 ** 3;

export function shouldPreferMemorySavingAsr(
  systemMemoryBytes: number | undefined
): boolean {
  return (
    typeof systemMemoryBytes === "number" &&
    Number.isFinite(systemMemoryBytes) &&
    systemMemoryBytes > 0 &&
    systemMemoryBytes <= MEMORY_SAVING_ASR_MAX_BYTES
  );
}
