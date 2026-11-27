import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { eq } from "drizzle-orm";

import type { AppConfig } from "../src/config/env.js";
import { users } from "../src/db/schema.js";
import { SYSTEM_ACTOR, newestEntryId, recordAuditAlone } from "../src/lib/audit.js";
import type { TestApp } from "./helpers.js";
import { buildTestApp, signedInUser } from "./helpers.js";

/** One open live line, read one message at a time. A real connection: the answer never ends by itself. */
async function openLine(address: string, cookie: string) {
  const abort = new AbortController();
  const response = await fetch(`${address}/api/live`, { headers: { cookie }, signal: abort.signal });
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  let reading: ReturnType<typeof reader.read> | null = null;

  /** The next message's text, "ended" when the server closed the line, or "silence" if nothing came in time. */
  const next = async (waitMs = 2000): Promise<string> => {
    for (;;) {
      const end = buffered.indexOf("\n\n");
      if (end >= 0) {
        const message = buffered.slice(0, end);
        buffered = buffered.slice(end + 2);
        return message;
      }
      reading ??= reader.read();
      let timer: NodeJS.Timeout | undefined;
      const silence = new Promise<"silence">((resolve) => (timer = setTimeout(() => resolve("silence"), waitMs)));
      const result = await Promise.race([reading, silence]);
      clearTimeout(timer);
      if (result === "silence") return "silence";
      reading = null;
      if (result.done) return "ended";
      buffered += decoder.decode(result.value, { stream: true });
    }
  };

  return { response, next, close: () => abort.abort() };
}

describe("live changes", () => {
  let t: TestApp;
  const open: Array<{ close: () => void }> = [];

  const start = async (overrides: Partial<AppConfig> = {}) => {
    // No heartbeat unless a test asks, so a message can only come from the change itself.
    t = await buildTestApp({ liveHeartbeatMs: 60_000, ...overrides });
    return t.app.listen({ host: "127.0.0.1", port: 0 });
  };

  const line = async (address: string, cookie: string) => {
    const opened = await openLine(address, cookie);
    open.push(opened);
    return opened;
  };

  const addSector = (address: string, cookie: string, name: string) =>
    fetch(`${address}/api/settings/sectors`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });

  afterEach(async () => {
    open.splice(0).forEach((opened) => opened.close());
    await t.close();
  });

  it("is only for someone signed in", async () => {
    const address = await start();
    const response = await fetch(`${address}/api/live`);
    assert.equal(response.status, 401);
    await response.body?.cancel();
  });

  it("opens with the newest number, in a form Nginx passes straight on", async () => {
    const address = await start();
    const ana = await signedInUser(t, "presidente");
    const opened = await line(address, ana.cookie);

    assert.match(opened.response.headers.get("content-type")!, /^text\/event-stream/);
    assert.equal(opened.response.headers.get("x-accel-buffering"), "no");
    assert.equal(await opened.next(), `data: ${newestEntryId(t.db)}`);
  });

  it("tells every open app as soon as someone saves, with a number and nothing else", async () => {
    const address = await start();
    const ana = await signedInUser(t, "presidente", "Ana");
    const luis = await signedInUser(t, "secretario", "Luis");
    const anas = await line(address, ana.cookie);
    const luiss = await line(address, luis.cookie);
    await anas.next();
    await luiss.next();

    assert.equal((await addSector(address, ana.cookie, "La Loma")).status, 201);

    const newest = `data: ${newestEntryId(t.db)}`;
    assert.equal(await luiss.next(), newest);
    assert.equal(await anas.next(), newest);
  });

  it("says nothing when a request is refused and nothing was saved", async () => {
    const address = await start();
    const ana = await signedInUser(t, "presidente");
    const opened = await line(address, ana.cookie);
    await opened.next();

    assert.equal((await addSector(address, ana.cookie, "")).status, 400);

    assert.equal(await opened.next(300), "silence");
  });

  it("tells an app that connected after the change to the others, without keeping it from them", async () => {
    const address = await start();
    const ana = await signedInUser(t, "presidente");
    const first = await line(address, ana.cookie);
    await first.next();

    // Saved outside the API, as a script does: no request tells anyone.
    recordAuditAlone(t.db, SYSTEM_ACTOR, { area: "users", action: "test.outside", summary: "Desde un script" });
    const newest = `data: ${newestEntryId(t.db)}`;
    const second = await line(address, ana.cookie);

    assert.equal(await first.next(), newest);
    assert.equal(await second.next(), newest);
  });

  it("finds at the heartbeat what was saved outside the API, and keeps a quiet line awake", async () => {
    const address = await start({ liveHeartbeatMs: 40 });
    const ana = await signedInUser(t, "presidente");
    const opened = await line(address, ana.cookie);
    await opened.next();
    assert.equal(await opened.next(), "event: ping\ndata: 1");

    recordAuditAlone(t.db, SYSTEM_ACTOR, { area: "users", action: "test.outside", summary: "Desde un script" });

    let message = await opened.next();
    while (message === "event: ping\ndata: 1") message = await opened.next();
    assert.equal(message, `data: ${newestEntryId(t.db)}`);
  });

  it("ends the line of a session that has ended, saying so", async () => {
    const address = await start({ liveHeartbeatMs: 40 });
    const ana = await signedInUser(t, "presidente");
    const opened = await line(address, ana.cookie);
    await opened.next();

    t.db.update(users).set({ status: "suspended" }).where(eq(users.id, ana.id)).run();

    let message = await opened.next();
    while (message === "event: ping\ndata: 1") message = await opened.next();
    assert.equal(message, "event: signed-out\ndata: 1");
    assert.equal(await opened.next(), "ended");
  });

  it("does not hold up a restart of the API", async () => {
    const address = await start();
    const ana = await signedInUser(t, "presidente");
    const opened = await line(address, ana.cookie);
    await opened.next();

    const began = Date.now();
    await t.app.close();

    assert.ok(Date.now() - began < 2000, `closing took ${Date.now() - began} ms`);
    assert.equal(await opened.next(), "ended");
  });
});
