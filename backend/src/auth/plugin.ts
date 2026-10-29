import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";

import type { Db } from "../db/client.js";
import type { Actor } from "../lib/audit.js";
import type { Permission } from "../lib/permissions.js";
import type { SessionUser } from "./session.js";
import { PIN_CONFIRMATION_WINDOW_MS, SESSION_COOKIE, getSessionUser } from "./session.js";

declare module "fastify" {
  interface FastifyRequest {
    /** The signed-in user, or `null` for an anonymous request. */
    user: SessionUser | null;
  }

  interface FastifyInstance {
    db: Db;
    /** Route guard: 401 unless someone is signed in. */
    requireUser: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** Route guard factory: 401 if anonymous, 403 without the permission. */
    requirePermission: (
      permission: Permission,
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** Route guard: 403 unless the PIN was typed again in the last few minutes. */
    requireRecentPin: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

const UNAUTHENTICATED = { error: "unauthenticated", message: "Escriba su PIN para entrar." };

/** The history log's "who", for the signed-in user of this request. */
export function actorOf(request: FastifyRequest): Actor {
  const user = request.user;
  if (!user) {
    throw new Error("actorOf called on an anonymous request");
  }
  return {
    userId: user.id,
    name: user.name,
    role: user.roleName,
    device: deviceOf(request),
  };
}

export function deviceOf(request: FastifyRequest): string | null {
  const agent = request.headers["user-agent"];
  return typeof agent === "string" && agent !== "" ? agent : null;
}

const authPlugin: FastifyPluginAsync<{ db: Db }> = async (app, options) => {
  app.decorate("db", options.db);
  app.decorateRequest("user", null);

  // Resolve the session on every request, before any route handler runs. The
  // user and their permissions are read from the database, never the cookie.
  app.addHook("onRequest", async (request) => {
    const token = request.cookies[SESSION_COOKIE];
    request.user = token ? getSessionUser(options.db, token) : null;
  });

  app.decorate("requireUser", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user) {
      await reply.code(401).send(UNAUTHENTICATED);
    }
  });

  app.decorate("requirePermission", (permission: Permission) => {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      if (!request.user) {
        await reply.code(401).send(UNAUTHENTICATED);
        return;
      }

      // The server decides. A hidden button is a convenience; this is the rule.
      if (!request.user.permissions.has(permission)) {
        request.log.warn(
          { userId: request.user.id, role: request.user.roleCode, permission },
          "Permission denied",
        );
        await reply.code(403).send({
          error: "forbidden",
          message: "Su cargo no tiene permiso para esto.",
        });
      }
    };
  });

  app.decorate("requireRecentPin", async (request: FastifyRequest, reply: FastifyReply) => {
    const confirmedAt = request.user?.pinConfirmedAt;
    if (!confirmedAt || Date.now() - confirmedAt.getTime() > PIN_CONFIRMATION_WINDOW_MS) {
      await reply.code(403).send({
        error: "pin_required",
        message: "Escriba su PIN otra vez para confirmar.",
      });
    }
  });
};

// `fastify-plugin` keeps these decorations visible to every route.
export default fp(authPlugin, { name: "zoilabe-auth" });
