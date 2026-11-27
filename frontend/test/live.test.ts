import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { fileURLToPath } from "node:url";

import type { LogEntry } from "../src/api.ts";
import { withNewest } from "../src/history.ts";
import type { LiveLine, LivePage, PressTarget } from "../src/live.ts";
import { AFTER_PRESS_MS, GAP_MS, LiveChanges, SILENCE_MS, connectLive, holdWhilePressed, newestOnly } from "../src/live.ts";
import { figuresMoved } from "../src/monthClose.ts";
import type { MonthState } from "../src/payments.ts";
import { stillPayable } from "../src/payments.ts";

beforeEach(() => mock.timers.enable({ apis: ["setTimeout"] }));
afterEach(() => mock.timers.reset());

describe("when the screens read again", () => {
  it("is at once after a change", () => {
    const changes = new LiveChanges();
    changes.changed();
    assert.equal(changes.version(), 1);
  });

  it("is once more, a moment later, for many changes arriving together", () => {
    const changes = new LiveChanges();
    for (let i = 0; i < 10; i += 1) changes.changed();
    assert.equal(changes.version(), 1);
    mock.timers.tick(GAP_MS);
    assert.equal(changes.version(), 2);
    mock.timers.tick(GAP_MS);
    assert.equal(changes.version(), 2);
  });

  it("waits while a screen holds the changes, and loses none", () => {
    const changes = new LiveChanges();
    const letGo = changes.hold();
    changes.changed();
    assert.equal(changes.version(), 0);
    letGo();
    assert.equal(changes.version(), 1);
  });

  it("waits for the last of two holds, and one let go twice does not let go of the other", () => {
    const changes = new LiveChanges();
    const first = changes.hold();
    const second = changes.hold();
    changes.changed();
    first();
    first();
    assert.equal(changes.version(), 0);
    second();
    assert.equal(changes.version(), 1);
  });

  it("does not read for a hold with no change behind it", () => {
    const changes = new LiveChanges();
    changes.hold()();
    assert.equal(changes.version(), 0);
  });
});

/** A browser with no server behind it: the test says what each line hears. */
function fakePage() {
  const lines: Array<{ closed: boolean; say: (type: string, data?: string) => void }> = [];
  const listeners = new Map<string, () => void>();
  let hidden = false;
  const page: LivePage = {
    open: () => {
      const heard = new Map<string, (event: { data?: unknown }) => void>();
      const line = { closed: false, say: (type: string, data?: string) => heard.get(type)?.({ data }) };
      lines.push(line);
      const browserLine: LiveLine = {
        addEventListener: (type, listener) => void heard.set(type, listener),
        close: () => void (line.closed = true),
      };
      return browserLine;
    },
    hidden: () => hidden,
    on: (type, listener) => {
      listeners.set(type, listener);
      return () => listeners.delete(type);
    },
  };
  return {
    page,
    lines,
    listeners,
    last: () => lines.at(-1)!,
    show: (visible: boolean) => {
      hidden = !visible;
      listeners.get("visibilitychange")?.();
    },
    signalBack: () => listeners.get("online")?.(),
  };
}

describe("the line to the server", () => {
  const connect = () => {
    const browser = fakePage();
    let reads = 0;
    const disconnect = connectLive(browser.page, () => (reads += 1));
    return { browser, reads: () => reads, disconnect };
  };

  it("reads again when the number changes, and not when it is said twice", () => {
    const { browser, reads } = connect();
    browser.last().say("message", "7");
    assert.equal(reads(), 1);
    browser.last().say("message", "7");
    assert.equal(reads(), 1);
    browser.last().say("message", "8");
    assert.equal(reads(), 2);
  });

  it("is opened again after a failure, waiting longer each time, and then reads again even with the same number", () => {
    const { browser, reads } = connect();
    browser.last().say("message", "7");

    browser.last().say("error");
    assert.equal(browser.last().closed, true);
    mock.timers.tick(1999);
    assert.equal(browser.lines.length, 1);
    mock.timers.tick(1);
    assert.equal(browser.lines.length, 2);

    browser.last().say("error");
    mock.timers.tick(3999);
    assert.equal(browser.lines.length, 2);
    mock.timers.tick(1);
    assert.equal(browser.lines.length, 3);

    browser.last().say("message", "7");
    assert.equal(reads(), 2);
  });

  it("is closed while the app is out of sight, and catches up on coming back", () => {
    const { browser, reads } = connect();
    browser.last().say("message", "7");

    browser.show(false);
    assert.equal(browser.last().closed, true);
    mock.timers.tick(SILENCE_MS * 2);
    assert.equal(browser.lines.length, 1);

    browser.show(true);
    assert.equal(browser.lines.length, 2);
    browser.last().say("message", "7");
    assert.equal(reads(), 2);
  });

  it("is opened afresh when the signal comes back", () => {
    const { browser } = connect();
    browser.signalBack();
    assert.equal(browser.lines.length, 2);
    assert.equal(browser.lines[0]!.closed, true);
  });

  it("is taken for dead after silence, which a ping breaks", () => {
    const { browser } = connect();
    browser.last().say("message", "7");
    mock.timers.tick(SILENCE_MS - 1);
    browser.last().say("ping");
    mock.timers.tick(SILENCE_MS - 1);
    assert.equal(browser.lines.length, 1);
    mock.timers.tick(1);
    assert.equal(browser.lines.length, 2);
  });

  it("reads again when told the session ended, which is what shows Entrar", () => {
    const { browser, reads } = connect();
    browser.last().say("message", "7");
    browser.last().say("signed-out");
    assert.equal(reads(), 2);
  });

  it("is not heard once given up on", () => {
    const { browser, reads } = connect();
    const old = browser.last();
    browser.signalBack();
    old.say("message", "9");
    assert.equal(reads(), 0);
  });

  it("is closed for good when the app closes it", () => {
    const { browser, disconnect } = connect();
    disconnect();
    assert.equal(browser.last().closed, true);
    assert.equal(browser.listeners.size, 0);
    mock.timers.tick(SILENCE_MS * 2);
    assert.equal(browser.lines.length, 1);
  });
});

describe("a finger on the screen", () => {
  const screen = () => {
    const listeners = new Map<string, () => void>();
    const target: PressTarget = {
      addEventListener: (type, listener) => void listeners.set(type, listener),
      removeEventListener: (type) => void listeners.delete(type),
    };
    const changes = new LiveChanges();
    const stop = holdWhilePressed(target, changes);
    return { changes, stop, listeners, touch: (type: string) => listeners.get(type)?.() };
  };

  it("keeps the list still until just after it lifts", () => {
    const { changes, touch } = screen();
    touch("pointerdown");
    changes.changed();
    assert.equal(changes.version(), 0);
    touch("pointerup");
    mock.timers.tick(AFTER_PRESS_MS - 1);
    assert.equal(changes.version(), 0);
    mock.timers.tick(1);
    assert.equal(changes.version(), 1);
  });

  it("does not stop the updates for good if the browser never says it lifted", () => {
    const { changes, touch } = screen();
    touch("pointerdown");
    changes.changed();
    mock.timers.tick(10_000);
    assert.equal(changes.version(), 1);
  });

  it("lets go when the app stops listening", () => {
    const { changes, stop, touch, listeners } = screen();
    touch("pointerdown");
    changes.changed();
    stop();
    assert.equal(changes.version(), 1);
    assert.equal(listeners.size, 0);
  });
});

describe("Historial after a live change", () => {
  const entry = (id: number) => ({ id }) as LogEntry;
  const ids = (page: { entries: LogEntry[] }) => page.entries.map((e) => e.id);

  it("puts the new entries on top and keeps what Ver más had opened", () => {
    const shown = { entries: [9, 8, 7, 6].map(entry), nextBefore: 6 };
    const page = withNewest(shown, { entries: [11, 10, 9, 8].map(entry), nextBefore: 8 });
    assert.deepEqual(ids(page), [11, 10, 9, 8, 7, 6]);
    assert.equal(page.nextBefore, 6);
  });

  it("starts over when more came than one page holds, so none is skipped", () => {
    const shown = { entries: [3, 2].map(entry), nextBefore: 2 };
    const newest = { entries: [9, 8].map(entry), nextBefore: 8 };
    assert.deepEqual(withNewest(shown, newest), newest);
  });

  it("shows the first entry of a list that was empty", () => {
    const newest = { entries: [entry(1)], nextBefore: null };
    assert.deepEqual(withNewest({ entries: [], nextBefore: null }, newest), newest);
  });
});

describe("what someone else saved while this person was working", () => {
  const month = (name: string, priceCentavos: number, paidCentavos: number) =>
    ({ month: name, priceCentavos, paidCentavos, paidOn: null }) as unknown as MonthState;

  it("takes out a chosen month that is now paid, and keeps one not on the list", () => {
    const states = [month("2026-09-01", 7000, 7000), month("2026-10-01", 7000, 0)];
    assert.deepEqual(stillPayable(["2025-01-01", "2026-09-01", "2026-10-01"], states), ["2025-01-01", "2026-10-01"]);
  });

  it("is said about the cash count in the server's own words", () => {
    assert.equal(
      figuresMoved("octubre de 2026", 125_000),
      "Las cifras de octubre de 2026 cambiaron mientras tanto: ahora en caja debe haber L 1,250.00. Revise y vuelva a contar.",
    );
  });
});

describe("two readings on their way at once", () => {
  /** A reading the test answers when it likes. */
  const reading = () => {
    let answer!: (value: string) => void;
    let fail!: (error: Error) => void;
    const promise = new Promise<string>((resolve, reject) => {
      answer = resolve;
      fail = reject;
    });
    return { promise, answer, fail };
  };
  const screen = () => {
    const newest = newestOnly();
    const shown: string[] = [];
    const read = (from: ReturnType<typeof reading>) =>
      newest(
        from.promise,
        (value) => void shown.push(value),
        (error) => void shown.push(`error: ${error.message}`),
      );
    return { shown, read };
  };

  it("drops the older answer when it arrives last", async () => {
    const { shown, read } = screen();
    const [older, newer] = [reading(), reading()];
    const both = [read(older), read(newer)];
    newer.answer("nuevo");
    older.answer("viejo");
    await Promise.all(both);
    assert.deepEqual(shown, ["nuevo"]);
  });

  it("drops it when it arrives first too, since a newer one is already on its way", async () => {
    const { shown, read } = screen();
    const [older, newer] = [reading(), reading()];
    const both = [read(older), read(newer)];
    older.answer("viejo");
    await both[0];
    assert.deepEqual(shown, []);
    newer.answer("nuevo");
    await both[1];
    assert.deepEqual(shown, ["nuevo"]);
  });

  it("says nothing about an older one that failed, and does say when the newest fails", async () => {
    const { shown, read } = screen();
    const [older, newer] = [reading(), reading()];
    const both = [read(older), read(newer)];
    older.fail(new Error("vieja"));
    newer.fail(new Error("sin señal"));
    await Promise.all(both);
    assert.deepEqual(shown, ["error: sin señal"]);
  });

  it("keeps two different things apart", async () => {
    const [first, second] = [screen(), screen()];
    const [one, other] = [reading(), reading()];
    const both = [first.read(one), second.read(other)];
    one.answer("la lista");
    other.answer("los sectores");
    await Promise.all(both);
    assert.deepEqual([...first.shown, ...second.shown], ["la lista", "los sectores"]);
  });
});

describe("every screen shows what others save", () => {
  /** Readings that need no `useLive`, and why. */
  const ONCE = new Map([["ReceiptDialog", "a Dialog holds the changes while it is open, and a receipt's payment does not change"]]);

  /** Readings a person asks for with a tap, which no live change repeats: how many each screen has. */
  const TAPS = new Map([
    ["HistoryScreen", 1], // "Ver detalle"
    ["RegisterScreen", 2], // the names alike, and the ID already registered
  ]);

  /** One piece per function written at the left edge: a screen, or a part of one that does its own reading. */
  const readingPieces = () => {
    const folder = fileURLToPath(new URL("../src/screens/", import.meta.url));
    return readdirSync(folder)
      .filter((name) => name.endsWith(".tsx"))
      .flatMap((file) =>
        readFileSync(`${folder}${file}`, "utf8")
          .split(/\r?\n(?=(?:export )?(?:async )?function )/)
          .map((source) => ({ file, source, name: /^(?:export )?(?:async )?function (\w+)/.exec(source)?.[1] ?? file })),
      )
      .filter(({ source, name }) => source.includes('"GET"') && !ONCE.has(name));
  };

  it("reads again after a live change wherever it reads", () => {
    const missing = readingPieces()
      .filter(({ source }) => !source.includes("useLive()"))
      .map(({ file, name }) => `${file}: ${name}`);
    assert.deepEqual(missing, [], "Add `const live = useLive()` to what the reading depends on (src/live.ts).");
  });

  // A count, not a proof: as many guards as readings in each piece.
  it("drops an older answer wherever it reads", () => {
    const missing = readingPieces()
      .filter(({ source, name }) => {
        const readings = source.split('"GET"').length - 1 - (TAPS.get(name) ?? 0);
        const guards = source.match(/\bnewest\w*\(\s*(?:api\b|read\()|\blet current = true\b/g)?.length ?? 0;
        return guards < readings;
      })
      .map(({ file, name }) => `${file}: ${name}`);
    assert.deepEqual(missing, [], "Give the reading to `useNewest()` (src/live.ts).");
  });
});
