/**
 * Live changes: what one person saves shows on everyone else's open app at once.
 *
 * `GET /api/live` is one long answer (server-sent events) that stays open for
 * each open app. The server writes a number on it whenever something has been
 * saved: the newest history log entry's, which every change adds in its own
 * transaction. So a new feature is live without a line here.
 *
 * **Only that number travels this way, never data.** Each app then reads its
 * screen again through the usual routes, which check permissions and mask ID
 * numbers and phones as they always do.
 *
 * It looks for a new entry right after every request that can write, and again
 * at each heartbeat, which catches what was written outside the API (the
 * scripts, such as `user:password`). The heartbeat also keeps Nginx from
 * closing a quiet line, and ends the line of a session that has ended.
 *
 * `X-Accel-Buffering: no` tells Nginx to pass each line on as it comes instead
 * of collecting them, so the droplet's Nginx site needs no change.
 */
import { PassThrough } from "node:stream";

import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";

import { SESSION_COOKIE, getSessionUser } from "../auth/session.js";
import { newestEntryId } from "../lib/audit.js";

const plugin: FastifyPluginAsync<{ heartbeatMs: number }> = async (app, options) => {
  /** Each open line, and the session token it was opened with. */
  const lines = new Map<PassThrough, string>();
  /** The newest number the open lines have been told. */
  let told = newestEntryId(app.db);

  /** Tell every open line, if something was saved since they were last told. */
  const tell = () => {
    if (lines.size === 0) return;
    const newest = newestEntryId(app.db);
    if (newest === told) return;
    told = newest;
    for (const line of lines.keys()) {
      line.write(`data: ${newest}\n\n`);
    }
  };

  // After the writer has their answer. A refused request saved nothing, so the number is the same.
  app.addHook("onResponse", async (request) => {
    if (request.method !== "GET" && request.method !== "HEAD") tell();
  });

  const heartbeat = setInterval(() => {
    try {
      // First, so a suspended account hears of it and asks who it is, and is told to sign in.
      tell();
      for (const [line, token] of lines) {
        if (getSessionUser(app.db, token)) {
          line.write("event: ping\ndata: 1\n\n");
        } else {
          lines.delete(line);
          line.end("event: signed-out\ndata: 1\n\n");
        }
      }
    } catch (error) {
      // A busy or broken database must not stop the API from here.
      app.log.error({ err: error }, "Live heartbeat failed");
    }
  }, options.heartbeatMs);
  heartbeat.unref();

  // Before the server waits for its connections to finish: an open line never would.
  app.addHook("preClose", async () => {
    clearInterval(heartbeat);
    for (const line of lines.keys()) {
      line.end();
    }
    lines.clear();
  });

  app.get("/live", { preHandler: app.requireUser }, async (request, reply) => {
    // The others first, so that `told` holds for every line when this one joins.
    tell();
    told = newestEntryId(app.db);

    const line = new PassThrough();
    lines.set(line, request.cookies[SESSION_COOKIE]!);
    reply.raw.on("close", () => {
      lines.delete(line);
      line.end();
    });
    line.write(`data: ${told}\n\n`);

    return reply
      .header("content-type", "text/event-stream; charset=utf-8")
      .header("cache-control", "no-cache, no-transform")
      .header("x-accel-buffering", "no")
      .send(line);
  });
};

// `fastify-plugin` lets the hook above see the other routes' requests.
export const liveRoutes = fp(plugin, { name: "zoilabe-live" });
