import type { LogEntry } from "./api.ts";

/** Entries of the history log, newest first, and where "Ver más" goes on from. */
export interface LogPage {
  entries: LogEntry[];
  nextBefore: number | null;
}

/**
 * Historial after a live change: the new entries go on top, and what was opened
 * with "Ver más" stays. `newest` is the first page, read again. When it does
 * not reach the entry on top, more came than one page holds, and the list
 * starts over from that page, so no entry is skipped.
 */
export function withNewest(shown: LogPage, newest: LogPage): LogPage {
  const top = shown.entries[0]?.id;
  if (top === undefined || !newest.entries.some((entry) => entry.id === top)) {
    return newest;
  }
  return {
    entries: [...newest.entries.filter((entry) => entry.id > top), ...shown.entries],
    nextBefore: shown.nextBefore,
  };
}
