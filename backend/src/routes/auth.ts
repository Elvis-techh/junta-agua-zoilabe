/**
 * Signing in (Module 3, "How a director signs in").
 *
 *  1. The invitation link is opened on the person's own phone; they choose a
 *     6-digit PIN. The phone is remembered (device cookie, 90 days from last
 *     use) and a session opens.
 *  2. From then on: open the app, type the PIN. 5 wrong PINs lock the account.
 *  3. Sensitive actions ask for the PIN again (`/auth/confirm-pin`).
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { actorOf, deviceOf } from "../auth/plugin.js";
import { checkPin } from "../auth/pinCheck.js";
import type { SessionUser } from "../auth/session.js";
import {
  DEVICE_COOKIE,
  DEVICE_IDLE_LIMIT_MS,
  SESSION_COOKIE,
  SESSION_LIFETIME_MS,
  findLiveToken,
  issueToken,
  revokeTokens,
  tokenHash,
} from "../auth/session.js";
import type { Tx } from "../db/client.js";
import { accessTokens, roles, users } from "../db/schema.js";
import type { Actor } from "../lib/audit.js";
import { recordAudit } from "../lib/audit.js";
import { HttpError, parse } from "../lib/http.js";
import { hashPin, isWellFormedPin } from "../lib/pin.js";

interface AuthOptions {
  appUrl: string;
  secureCookies: boolean;
  pinAttemptsPerMinute: number;
}

const pinSchema = z.string().refine(isWellFormedPin, "El PIN debe tener 6 números.");

const tokenBody = z.object({ token: z.string().min(20).max(100) });
const acceptBody = z.object({ token: z.string().min(20).max(100), pin: pinSchema });
const pinBody = z.object({ pin: pinSchema });

const INVITATION_INVALID = new HttpError(
  410,
  "invitation_invalid",
  "Este enlace ya no sirve. Pida una invitación nueva al administrador.",
);

/** A few words about the phone, for the list of remembered devices. */
function deviceLabel(request: FastifyRequest): string {
  const agent = deviceOf(request) ?? "";
  const model = /\(([^)]+)\)/.exec(agent)?.[1]?.split(";").slice(-1)[0]?.trim();
  const browser = /(Firefox|Edg|Chrome|Safari)\//.exec(agent)?.[1];
  return [model, browser].filter(Boolean).join(" · ").slice(0, 80) || "Teléfono";
}

export function publicUser(user: SessionUser) {
  return {
    id: user.id,
    name: user.name,
    roleCode: user.roleCode,
    roleName: user.roleName,
    permissions: [...user.permissions].sort(),
  };
}

export const authRoutes: FastifyPluginAsync<AuthOptions> = async (app, options) => {
  const cookieBase = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: options.secureCookies,
    path: "/",
  };

  const strictLimit = {
    rateLimit: { max: options.pinAttemptsPerMinute, timeWindow: "1 minute" },
  };

  const setCookies = (reply: FastifyReply, deviceToken: string | null, sessionToken: string) => {
    if (deviceToken) {
      reply.setCookie(DEVICE_COOKIE, deviceToken, {
        ...cookieBase,
        maxAge: Math.floor(DEVICE_IDLE_LIMIT_MS / 1000),
      });
    }
    reply.setCookie(SESSION_COOKIE, sessionToken, {
      ...cookieBase,
      maxAge: Math.floor(SESSION_LIFETIME_MS / 1000),
    });
  };

  const loadUser = async (userId: string) => {
    const [row] = await app.db
      .select({
        id: users.id,
        name: users.name,
        status: users.status,
        pinHash: users.pinHash,
        lockedAt: users.lockedAt,
        roleName: roles.name,
      })
      .from(users)
      .innerJoin(roles, eq(roles.code, users.roleCode))
      .where(eq(users.id, userId));
    return row ?? null;
  };

  const actorFor = (
    request: FastifyRequest,
    user: { id: string; name: string; roleName: string },
  ): Actor => ({ userId: user.id, name: user.name, role: user.roleName, device: deviceOf(request) });

  /** Open a session on a device, inside the caller's transaction. */
  const openSession = (tx: Tx, userId: string, deviceId: string) =>
    issueToken(tx, { userId, kind: "session", lifetimeMs: SESSION_LIFETIME_MS, deviceId });

  // -------------------------------------------------------------------------

  app.post("/auth/invitation/check", { config: strictLimit }, async (request) => {
    const { token } = parse(tokenBody, request.body);
    const invitation = await findLiveToken(app.db, token, "invitation");
    if (!invitation || invitation.usedAt) {
      throw INVITATION_INVALID;
    }

    const user = await loadUser(invitation.userId);
    if (!user || user.status === "suspended" || user.status === "deactivated") {
      throw INVITATION_INVALID;
    }

    return { name: user.name, roleName: user.roleName, replacesPin: user.pinHash !== null };
  });

  app.post("/auth/invitation/accept", { config: strictLimit }, async (request, reply) => {
    const { token, pin } = parse(acceptBody, request.body);
    const pinHash = await hashPin(pin);

    const result = await app.db.transaction(async (tx) => {
      // Locked for the rest of the transaction, so the same link opened twice
      // at once is used once.
      const [invitation] = await tx
        .select()
        .from(accessTokens)
        .where(
          and(
            eq(accessTokens.tokenHash, tokenHash(token)),
            eq(accessTokens.kind, "invitation"),
            isNull(accessTokens.usedAt),
            isNull(accessTokens.revokedAt),
            sql`${accessTokens.expiresAt} > now()`,
          ),
        )
        .for("update");
      if (!invitation) {
        throw INVITATION_INVALID;
      }

      const user = await loadUser(invitation.userId);
      if (!user || user.status === "suspended" || user.status === "deactivated") {
        throw INVITATION_INVALID;
      }

      const replacesPin = user.pinHash !== null;

      await tx.update(accessTokens).set({ usedAt: new Date() }).where(eq(accessTokens.id, invitation.id));
      // A new invitation is also how a forgotten PIN or a lock is undone; an
      // administrator sends one only after confirming the person by phone.
      await tx
        .update(users)
        .set({ pinHash, status: "active", failedPinCount: 0, lockedAt: null, lastLoginAt: new Date() })
        .where(eq(users.id, user.id));

      const device = await issueToken(tx, {
        userId: user.id,
        kind: "device",
        lifetimeMs: DEVICE_IDLE_LIMIT_MS,
        label: deviceLabel(request),
      });
      const session = await openSession(tx, user.id, device.id);

      await recordAudit(tx, actorFor(request, user), {
        area: "users",
        action: replacesPin ? "user.pin_reset" : "user.invitation_accepted",
        summary: replacesPin
          ? `${user.name} (${user.roleName}) usó una invitación nueva y cambió su PIN`
          : `${user.name} (${user.roleName}) aceptó su invitación y creó su PIN`,
        entityType: "user",
        entityId: user.id,
      });

      return { device: device.token, session: session.token };
    });

    setCookies(reply, result.device, result.session);
    return { ok: true };
  });

  app.post("/auth/pin", { config: strictLimit }, async (request, reply) => {
    const { pin } = parse(pinBody, request.body);

    const deviceToken = request.cookies[DEVICE_COOKIE];
    const device = deviceToken ? await findLiveToken(app.db, deviceToken, "device") : null;
    if (!device || !deviceToken) {
      throw new HttpError(
        401,
        "device_unknown",
        "Este teléfono no está registrado. Abra el enlace de invitación que le enviaron.",
      );
    }

    const user = await loadUser(device.userId);
    if (!user || user.status !== "active") {
      throw new HttpError(403, "account_inactive", "Su cuenta no está activa. Hable con el administrador.");
    }

    const actor = actorFor(request, user);
    const check = await checkPin(app.db, user, pin, actor);

    if (!check.ok && check.locked) {
      throw new HttpError(
        423,
        "account_locked",
        "Su cuenta está bloqueada por seguridad. Llame al administrador para desbloquearla.",
      );
    }
    if (!check.ok) {
      return reply.code(401).send({
        error: "wrong_pin",
        message:
          check.attemptsLeft === 1
            ? "PIN equivocado. Le queda 1 intento."
            : `PIN equivocado. Le quedan ${check.attemptsLeft} intentos.`,
        attemptsLeft: check.attemptsLeft,
      });
    }

    const session = await app.db.transaction(async (tx) => {
      const now = new Date();
      await tx.update(users).set({ lastLoginAt: now }).where(eq(users.id, user.id));
      // Using the phone keeps it remembered for another 90 days.
      await tx
        .update(accessTokens)
        .set({ lastUsedAt: now, expiresAt: new Date(now.getTime() + DEVICE_IDLE_LIMIT_MS) })
        .where(eq(accessTokens.id, device.id));
      const opened = await openSession(tx, user.id, device.id);

      await recordAudit(tx, actor, {
        area: "security",
        action: "security.login",
        summary: `${user.name} (${user.roleName}) entró a la app`,
        entityType: "user",
        entityId: user.id,
      });
      return opened;
    });

    setCookies(reply, deviceToken, session.token);
    return { ok: true };
  });

  app.get("/auth/me", async (request, reply) => {
    if (request.user) {
      return { user: publicUser(request.user) };
    }

    // Not signed in: say whether this phone is remembered, so the app knows
    // to show the PIN pad (with the person's name) or the "open your
    // invitation" screen.
    const deviceToken = request.cookies[DEVICE_COOKIE];
    const device = deviceToken ? await findLiveToken(app.db, deviceToken, "device") : null;
    const user = device ? await loadUser(device.userId) : null;

    if (user && user.status === "active") {
      return reply.code(401).send({
        error: "pin_needed",
        message: "Escriba su PIN para entrar.",
        device: { name: user.name, locked: user.lockedAt !== null },
      });
    }
    return reply.code(401).send({
      error: "device_unknown",
      message: "Este teléfono no está registrado. Abra el enlace de invitación que le enviaron.",
    });
  });

  app.post("/auth/logout", { preHandler: app.requireUser }, async (request, reply) => {
    await revokeTokens(app.db, { ids: [request.user!.sessionId] }, request.user!.id);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  app.post(
    "/auth/confirm-pin",
    { preHandler: app.requireUser, config: strictLimit },
    async (request, reply) => {
      const { pin } = parse(pinBody, request.body);
      const actor = actorOf(request);
      const user = await loadUser(request.user!.id);
      if (!user) {
        throw new HttpError(401, "unauthenticated", "Escriba su PIN para entrar.");
      }

      const check = await checkPin(app.db, user, pin, actor);
      if (!check.ok && check.locked) {
        throw new HttpError(
          423,
          "account_locked",
          "Su cuenta está bloqueada por seguridad. Llame al administrador para desbloquearla.",
        );
      }
      if (!check.ok) {
        return reply.code(401).send({
          error: "wrong_pin",
          message: "PIN equivocado.",
          attemptsLeft: check.attemptsLeft,
        });
      }

      await app.db
        .update(accessTokens)
        .set({ pinConfirmedAt: new Date() })
        .where(eq(accessTokens.id, request.user!.sessionId));
      return { ok: true };
    },
  );
};
