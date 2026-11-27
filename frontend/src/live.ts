/**
 * Live changes (backend/src/routes/live.ts): when anyone saves something,
 * every open app reads what is on its screen again, with the usual requests.
 *
 * A screen takes part by adding `useLive()` to what its reading depends on:
 *
 *     const live = useLive();
 *     useEffect(() => { …read from the API… }, [id, live]);
 *
 * Two readings can be on their way at once, and on weak signal the older one
 * can arrive last. Each reading goes through `useNewest`, so that it is dropped:
 *
 *     const newest = useNewest();
 *     useEffect(() => void newest(api(…), setRows, (err) => setError(err.message)), [id, live, newest]);
 *
 * Reading again must not take away what someone is doing: it never clears what
 * they typed, and the screen holds the changes back (`useLiveHold`) while that
 * work depends on what was on the screen when it began. A `Dialog` holds them
 * by itself, and so does a finger on the screen. Held changes are not lost:
 * the screen reads again as soon as nothing holds it.
 */
import { useEffect, useState, useSyncExternalStore } from "react";

/** The least time between two readings, so many saves at once (a phone sending its waiting entries) are one or two. */
export const GAP_MS = 2000;

/** After this long with nothing, not even the server's ping (every 20 s), the line is taken for dead. */
export const SILENCE_MS = 50_000;

const FIRST_RETRY_MS = 2000;
const LONGEST_RETRY_MS = 30_000;

/** A tap lands just after the finger lifts: nothing may move before it does. */
export const AFTER_PRESS_MS = 400;
/** A lifted finger the browser never reported must not stop the updates for good. */
const LONGEST_PRESS_MS = 10_000;

/** When the screens should read again. */
export class LiveChanges {
  private count = 0;
  private waiting = false;
  private holds = 0;
  private resting = false;
  private listeners = new Set<() => void>();

  /** Goes up by one each time the screens should read again. */
  version = (): number => this.count;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Something was saved. */
  changed(): void {
    this.waiting = true;
    this.show();
  }

  /** Keep the screens as they are until the returned function is called. */
  hold(): () => void {
    this.holds += 1;
    let held = true;
    return () => {
      if (!held) return;
      held = false;
      this.holds -= 1;
      this.show();
    };
  }

  private show(): void {
    if (!this.waiting || this.holds > 0 || this.resting) return;
    this.waiting = false;
    this.resting = true;
    setTimeout(() => {
      this.resting = false;
      this.show();
    }, GAP_MS);
    this.count += 1;
    this.listeners.forEach((listener) => listener());
  }
}

/** The one the app uses. */
export const liveChanges = new LiveChanges();

/** A number that changes when the screen should read again. */
export function useLive(): number {
  // The third is for the tests, which draw screens with no browser.
  return useSyncExternalStore(liveChanges.subscribe, liveChanges.version, liveChanges.version);
}

/**
 * For one thing that is read again and again: gives `take` or `fail` the
 * outcome of a reading only if nothing newer was asked for in the meantime. The
 * promise it returns finishes either way. Each thing read needs its own: one
 * shared by two would drop the first.
 */
export function newestOnly() {
  let asked = 0;
  return <T>(reading: Promise<T>, take: (answer: T) => void, fail?: (error: Error) => void): Promise<void> => {
    const mine = ++asked;
    return reading.then(
      (answer) => {
        if (mine === asked) take(answer);
      },
      (error: Error) => {
        if (mine === asked) fail?.(error);
      },
    );
  };
}

/** `newestOnly` that stays the same for as long as the screen is open. */
export function useNewest(): ReturnType<typeof newestOnly> {
  const [newest] = useState(newestOnly);
  return newest;
}

/** While `holding`, the screens stay as they are. */
export function useLiveHold(holding: boolean): void {
  useEffect(() => (holding ? liveChanges.hold() : undefined), [holding]);
}

/** The browser's `EventSource`, as far as it is used here. */
export interface LiveLine {
  addEventListener(type: string, listener: (event: { data?: unknown }) => void): void;
  close(): void;
}

/** What a live line needs from the browser; tests give their own. */
export interface LivePage {
  open(): LiveLine;
  hidden(): boolean;
  /** "visibilitychange" or "online"; returns how to stop listening. */
  on(type: "visibilitychange" | "online", listener: () => void): () => void;
}

export function browserPage(): LivePage {
  return {
    open: () => new EventSource("/api/live"),
    hidden: () => document.visibilityState === "hidden",
    on: (type, listener) => {
      const target: EventTarget = type === "online" ? window : document;
      target.addEventListener(type, listener);
      return () => target.removeEventListener(type, listener);
    },
  };
}

/**
 * Keep a line to the server while the app is on the screen, and call
 * `onChange` when it says something was saved. Returns how to close it.
 *
 * It calls `onChange` on every new connection too: what was saved while there
 * was none, and any reading that failed with it, are caught up that way. The
 * line is closed while the app is out of sight, because phones cut it there
 * without saying so. It is also opened again after a failure (the browser's
 * own retry gives up on some, such as the API restarting) and after silence.
 */
export function connectLive(page: LivePage, onChange: () => void): () => void {
  let line: LiveLine | null = null;
  /** Waiting for silence while a line is open, or to try again while none is. */
  let timer: ReturnType<typeof setTimeout> | undefined;
  let told: unknown = null;
  /** A line was lost since the last number: read again even if the number is the same. */
  let missed = false;
  let retryMs = FIRST_RETRY_MS;

  const drop = () => {
    clearTimeout(timer);
    if (line) {
      line.close();
      line = null;
      missed = true;
    }
  };

  const retry = () => {
    drop();
    timer = setTimeout(open, retryMs);
    retryMs = Math.min(retryMs * 2, LONGEST_RETRY_MS);
  };

  const heard = () => {
    clearTimeout(timer);
    timer = setTimeout(open, SILENCE_MS);
  };

  function open(): void {
    drop();
    if (page.hidden()) return;
    const opened = page.open();
    line = opened;
    const on = (type: string, listener: (data: unknown) => void) =>
      opened.addEventListener(type, (event) => {
        // A line already given up on has nothing more to say.
        if (line === opened) listener(event.data);
      });
    on("message", (data) => {
      retryMs = FIRST_RETRY_MS;
      heard();
      if (data !== told || missed) {
        told = data;
        missed = false;
        onChange();
      }
    });
    on("ping", heard);
    // The session ended: reading again is what shows "Entrar".
    on("signed-out", () => {
      onChange();
      retry();
    });
    on("error", retry);
    heard();
  }

  const now = () => {
    retryMs = FIRST_RETRY_MS;
    open();
  };
  const stops = [page.on("visibilitychange", () => (page.hidden() ? drop() : now())), page.on("online", now)];
  open();

  return () => {
    stops.forEach((stop) => stop());
    drop();
  };
}

/** Where the presses are heard: the window. */
export interface PressTarget {
  addEventListener(type: string, listener: () => void, capture: boolean): void;
  removeEventListener(type: string, listener: () => void, capture: boolean): void;
}

/**
 * Hold the changes while a finger or the mouse is down: a list that moved
 * under it would give the tap to another row. Returns how to stop.
 */
export function holdWhilePressed(target: PressTarget, changes: LiveChanges): () => void {
  let release: (() => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const letGo = () => {
    clearTimeout(timer);
    release?.();
    release = null;
  };
  const letGoAfter = (ms: number) => {
    clearTimeout(timer);
    timer = setTimeout(letGo, ms);
  };
  const down = () => {
    release ??= changes.hold();
    letGoAfter(LONGEST_PRESS_MS);
  };
  const up = () => {
    if (release) letGoAfter(AFTER_PRESS_MS);
  };

  const listeners: Array<[string, () => void]> = [
    ["pointerdown", down],
    ["pointerup", up],
    ["pointercancel", up],
  ];
  listeners.forEach(([type, listener]) => target.addEventListener(type, listener, true));
  return () => {
    listeners.forEach(([type, listener]) => target.removeEventListener(type, listener, true));
    letGo();
  };
}
