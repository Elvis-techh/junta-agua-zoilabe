/**
 * The Usuarios tab: staff accounts, their invitations and their phones.
 *
 * Accounts are never deleted, because history entries point to them. Their
 * lifecycle is invited → active → suspended → deactivated, and every step is
 * written to the history log.
 */
import { and, asc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";

import { actorOf } from "../auth/plugin.js";
import { newId, revokeTokens } from "../auth/session.js";
import type { Tx } from "../db/client.js";
import { inTransaction } from "../db/client.js";
import { accessTokens, roles, users } from "../db/schema.js";
import { recordAudit } from "../lib/audit.js";
import { HttpError, parse } from "../lib/http.js";
import { createInvitation } from "../lib/invitations.js";
import { ROLE_CODES, roleName } from "../lib/permissions.js";

const nameSchema = z
  .string()
  .trim()
  .min(3, "Escriba el nombre completo.")
  .max(120, "El nombre es demasiado largo.");
const phoneSchema = z
  .string()
  .trim()
  .regex(/^[0-9]{8}$/, "El número de WhatsApp debe tener 8 números. Revise e intente de nuevo.");
const roleSchema = z.enum(ROLE_CODES as [string, ...string[]], { message: "Elija un cargo de la lista." });
const reasonSchema = z.string().trim().max(500).optional();

const createBody = z.object({ name: nameSchema, phone: phoneSchema, roleCode: roleSchema });
const roleBody = z.object({ roleCode: roleSchema });
const reasonBody = z.object({ reason: reasonSchema }).default({});

type Params = { Params: { id: string } };

const NOT_FOUND = new HttpError(404, "not_found", "No se encontró esa cuenta.");
const DEVICE_NOT_FOUND = new HttpError(404, "not_found", "Ese teléfono ya no está registrado.");

/** A malformed id can match nothing; answer 404 before asking the database. */
function requireUuid(id: string, error: HttpError): void {
  if (!z.uuid().safeParse(id).success) {
    throw error;
  }
}

export const userRoutes: FastifyPluginAsync<{ appUrl: string }> = async (app, options) => {
  const guard = { preHandler: app.requirePermission("users:manage") };

  /** The target account, locked for the rest of the transaction. */
  const lockUser = (tx: Tx, id: string) => {
    requireUuid(id, NOT_FOUND);
    const user = tx.select().from(users).where(eq(users.id, id)).get();
    if (!user) {
      throw NOT_FOUND;
    }
    return user;
  };

  const notSelf = (request: FastifyRequest, id: string, message: string) => {
    if (request.user!.id === id) {
      throw new HttpError(409, "not_allowed", message);
    }
  };

  // -------------------------------------------------------------------------

  app.get("/users", guard, async () => {
    const rows = await app.db
      .select({
        id: users.id,
        name: users.name,
        phone: users.phone,
        roleCode: users.roleCode,
        roleName: roles.name,
        status: users.status,
        locked: sql<boolean>`${users.lockedAt} IS NOT NULL`.mapWith(Boolean),
        lastLoginAt: users.lastLoginAt,
        createdAt: users.createdAt,
      })
      .from(users)
      .innerJoin(roles, eq(roles.code, users.roleCode))
      .orderBy(asc(roles.sortOrder), asc(users.name));

    const live = await app.db
      .select({ userId: accessTokens.userId, kind: accessTokens.kind, expiresAt: accessTokens.expiresAt })
      .from(accessTokens)
      .where(
        and(
          inArray(accessTokens.kind, ["device", "invitation"]),
          isNull(accessTokens.revokedAt),
          isNull(accessTokens.usedAt),
          gt(accessTokens.expiresAt, new Date()),
        ),
      );

    return {
      users: rows.map((row) => ({
        ...row,
        devices: live.filter((t) => t.userId === row.id && t.kind === "device").length,
        invitationExpiresAt:
          live.find((t) => t.userId === row.id && t.kind === "invitation")?.expiresAt ?? null,
      })),
    };
  });

  app.post("/users", guard, async (request, reply) => {
    const body = parse(createBody, request.body);
    const actor = actorOf(request);

    const user = inTransaction(app.db, (tx) => {
      const taken = tx.select({ id: users.id }).from(users).where(eq(users.phone, body.phone)).get();
      if (taken) {
        throw new HttpError(409, "phone_taken", "Ya hay una cuenta con ese número de WhatsApp.");
      }

      const created = {
        id: newId(),
        name: body.name,
        phone: body.phone,
        roleCode: body.roleCode,
        status: "invited" as const,
        createdBy: actor.userId,
      };
      tx.insert(users).values(created).run();

      recordAudit(tx, actor, {
        area: "users",
        action: "user.created",
        summary: `${actor.name} (${actor.role}) creó la cuenta de ${body.name} (${roleName(body.roleCode)})`,
        entityType: "user",
        entityId: created.id,
        after: { name: body.name, phone: body.phone, role: body.roleCode },
      });
      return created;
    });

    return reply.code(201).send({ user: { id: user.id, name: user.name, status: user.status } });
  });

  app.post<Params>("/users/:id/invitation", guard, async (request) => {
    const actor = actorOf(request);

    const invitation = inTransaction(app.db, (tx) => {
      const user = lockUser(tx, request.params.id);
      if (user.status === "suspended" || user.status === "deactivated") {
        throw new HttpError(409, "not_allowed", "Reactive la cuenta antes de enviar una invitación.");
      }

      const made = createInvitation(tx, user, actor.userId, options.appUrl);

      recordAudit(tx, actor, {
        area: "users",
        action: "user.invitation_sent",
        summary: `${actor.name} (${actor.role}) preparó una invitación para ${user.name}`,
        entityType: "user",
        entityId: user.id,
      });
      return made;
    });

    return invitation;
  });

  app.patch<Params>(
    "/users/:id/role",
    { preHandler: [app.requirePermission("users:manage"), app.requireRecentPin] },
    async (request) => {
      const { roleCode } = parse(roleBody, request.body);
      notSelf(request, request.params.id, "Nadie puede cambiar su propio cargo.");
      const actor = actorOf(request);

      inTransaction(app.db, (tx) => {
        const user = lockUser(tx, request.params.id);
        if (user.roleCode === roleCode) {
          return;
        }

        tx.update(users).set({ roleCode }).where(eq(users.id, user.id)).run();
        recordAudit(tx, actor, {
          area: "users",
          action: "user.role_changed",
          summary: `${actor.name} (${actor.role}) cambió el cargo de ${user.name} de ${roleName(user.roleCode)} a ${roleName(roleCode)}`,
          entityType: "user",
          entityId: user.id,
          before: { role: user.roleCode },
          after: { role: roleCode },
        });
      });

      return { ok: true };
    },
  );

  app.post<Params>("/users/:id/suspend", guard, async (request) => {
    const { reason } = parse(reasonBody, request.body ?? {});
    notSelf(request, request.params.id, "No puede suspender su propia cuenta.");
    const actor = actorOf(request);

    inTransaction(app.db, (tx) => {
      const user = lockUser(tx, request.params.id);
      if (user.status !== "active" && user.status !== "invited") {
        throw new HttpError(409, "not_allowed", "Esa cuenta no está activa.");
      }

      tx.update(users).set({ status: "suspended" }).where(eq(users.id, user.id)).run();
      // Signed out everywhere, at once.
      revokeTokens(tx, { userId: user.id }, actor.userId);
      recordAudit(tx, actor, {
        area: "users",
        action: "user.suspended",
        summary: `${actor.name} (${actor.role}) suspendió la cuenta de ${user.name}`,
        entityType: "user",
        entityId: user.id,
        before: { status: user.status },
        after: { status: "suspended" },
        reason: reason ?? null,
      });
    });

    return { ok: true };
  });

  app.post<Params>("/users/:id/reactivate", guard, async (request) => {
    const actor = actorOf(request);

    inTransaction(app.db, (tx) => {
      const user = lockUser(tx, request.params.id);
      if (user.status !== "suspended") {
        throw new HttpError(409, "not_allowed", "Solo se puede reactivar una cuenta suspendida.");
      }

      // Their phones were forgotten when it was suspended, so either way the
      // next step is a new invitation.
      const status = user.pinHash ? "active" : "invited";
      tx.update(users).set({ status }).where(eq(users.id, user.id)).run();
      recordAudit(tx, actor, {
        area: "users",
        action: "user.reactivated",
        summary: `${actor.name} (${actor.role}) reactivó la cuenta de ${user.name}`,
        entityType: "user",
        entityId: user.id,
        before: { status: user.status },
        after: { status },
      });
    });

    return { ok: true };
  });

  app.post<Params>("/users/:id/deactivate", guard, async (request) => {
    const { reason } = parse(reasonBody, request.body ?? {});
    notSelf(request, request.params.id, "No puede desactivar su propia cuenta.");
    const actor = actorOf(request);

    inTransaction(app.db, (tx) => {
      const user = lockUser(tx, request.params.id);
      if (user.status === "deactivated") {
        return;
      }

      tx.update(users).set({ status: "deactivated" }).where(eq(users.id, user.id)).run();
      revokeTokens(tx, { userId: user.id }, actor.userId);
      recordAudit(tx, actor, {
        area: "users",
        action: "user.deactivated",
        summary: `${actor.name} (${actor.role}) desactivó la cuenta de ${user.name}`,
        entityType: "user",
        entityId: user.id,
        before: { status: user.status },
        after: { status: "deactivated" },
        reason: reason ?? null,
      });
    });

    return { ok: true };
  });

  app.post<Params>("/users/:id/unlock", guard, async (request) => {
    const actor = actorOf(request);

    inTransaction(app.db, (tx) => {
      const user = lockUser(tx, request.params.id);
      if (!user.lockedAt) {
        return;
      }

      tx.update(users).set({ lockedAt: null, failedPinCount: 0 }).where(eq(users.id, user.id)).run();
      recordAudit(tx, actor, {
        area: "users",
        action: "user.unlocked",
        summary: `${actor.name} (${actor.role}) desbloqueó la cuenta de ${user.name}`,
        entityType: "user",
        entityId: user.id,
      });
    });

    return { ok: true };
  });

  app.get<Params>("/users/:id/devices", guard, async (request) => {
    requireUuid(request.params.id, NOT_FOUND);
    const devices = await app.db
      .select({
        id: accessTokens.id,
        label: accessTokens.label,
        createdAt: accessTokens.createdAt,
        lastUsedAt: accessTokens.lastUsedAt,
        expiresAt: accessTokens.expiresAt,
      })
      .from(accessTokens)
      .where(
        and(
          eq(accessTokens.userId, request.params.id),
          eq(accessTokens.kind, "device"),
          isNull(accessTokens.revokedAt),
          gt(accessTokens.expiresAt, new Date()),
        ),
      )
      .orderBy(asc(accessTokens.createdAt));

    return { devices };
  });

  app.post<{ Params: { id: string; deviceId: string } }>(
    "/users/:id/devices/:deviceId/remove",
    guard,
    async (request) => {
      const actor = actorOf(request);

      requireUuid(request.params.deviceId, DEVICE_NOT_FOUND);

      inTransaction(app.db, (tx) => {
        const user = lockUser(tx, request.params.id);
        const device = tx
          .select()
          .from(accessTokens)
          .where(
            and(
              eq(accessTokens.id, request.params.deviceId),
              eq(accessTokens.userId, user.id),
              eq(accessTokens.kind, "device"),
              isNull(accessTokens.revokedAt),
            ),
          )
          .get();
        if (!device) {
          throw DEVICE_NOT_FOUND;
        }

        revokeTokens(tx, { ids: [device.id] }, actor.userId);
        revokeTokens(tx, { deviceId: device.id }, actor.userId);
        recordAudit(tx, actor, {
          area: "users",
          action: "user.device_removed",
          summary: `${actor.name} (${actor.role}) quitó un teléfono de la cuenta de ${user.name}`,
          entityType: "user",
          entityId: user.id,
          before: { device: device.label },
        });
      });

      return { ok: true };
    },
  );
};
