/**
 * Configuración → Sectores: the list a household's sector is chosen from.
 *
 * A sector is never deleted, because households point to it. One that is no
 * longer used is made inactive: it leaves the registration list, and the
 * households already in it keep showing its name.
 */
import { asc, eq, sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { actorOf } from "../auth/plugin.js";
import { households, sectors } from "../db/schema.js";
import { recordAudit } from "../lib/audit.js";
import { HttpError, parse } from "../lib/http.js";

const name = z
  .string()
  .trim()
  .min(2, "Escriba el nombre del sector.")
  .max(80, "El nombre del sector es demasiado largo.");

const createBody = z.object({ name });
const patchBody = z.object({ name, active: z.boolean() }).partial();

const NOT_FOUND = new HttpError(404, "not_found", "No se encontró ese sector.");
const NAME_TAKEN = new HttpError(409, "name_taken", "Ya hay un sector con ese nombre.");

export const sectorRoutes: FastifyPluginAsync = async (app) => {
  const guard = { preHandler: app.requirePermission("settings:edit") };

  const nameTaken = async (wanted: string, exceptId?: number) => {
    const rows = await app.db
      .select({ id: sectors.id })
      .from(sectors)
      .where(sql`lower(${sectors.name}) = lower(${wanted})`);
    return rows.some((row) => row.id !== exceptId);
  };

  app.get("/settings/sectors", guard, async () => {
    const rows = await app.db
      .select({
        id: sectors.id,
        name: sectors.name,
        active: sectors.active,
        households: sql<number>`count(${households.id})::int`,
      })
      .from(sectors)
      .leftJoin(households, eq(households.sectorId, sectors.id))
      .groupBy(sectors.id)
      .orderBy(asc(sectors.name));
    return { sectors: rows };
  });

  app.post("/settings/sectors", guard, async (request, reply) => {
    const body = parse(createBody, request.body);
    const actor = actorOf(request);
    if (await nameTaken(body.name)) {
      throw NAME_TAKEN;
    }

    const sector = await app.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(sectors)
        .values({ name: body.name, createdBy: actor.userId })
        .returning({ id: sectors.id, name: sectors.name });
      await recordAudit(tx, actor, {
        area: "settings",
        action: "sector.created",
        summary: `${actor.name} (${actor.role}) agregó el sector ${body.name}`,
        entityType: "sector",
        entityId: String(created!.id),
        after: { name: body.name },
      });
      return created!;
    });

    return reply.code(201).send({ sector });
  });

  app.patch<{ Params: { id: string } }>("/settings/sectors/:id", guard, async (request) => {
    const body = parse(patchBody, request.body);
    const actor = actorOf(request);
    const id = Number(request.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) {
      throw NOT_FOUND;
    }
    if (body.name !== undefined && (await nameTaken(body.name, id))) {
      throw NAME_TAKEN;
    }

    await app.db.transaction(async (tx) => {
      const [sector] = await tx.select().from(sectors).where(eq(sectors.id, id)).for("update");
      if (!sector) {
        throw NOT_FOUND;
      }

      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      if (body.name !== undefined && body.name !== sector.name) {
        before.name = sector.name;
        after.name = body.name;
      }
      if (body.active !== undefined && body.active !== sector.active) {
        before.active = sector.active;
        after.active = body.active;
      }
      if (Object.keys(after).length === 0) {
        return;
      }

      await tx.update(sectors).set(after).where(eq(sectors.id, id));

      const what =
        after.active === false
          ? `quitó de la lista el sector ${sector.name}`
          : after.active === true
            ? `volvió a poner en la lista el sector ${sector.name}`
            : `cambió el nombre del sector ${sector.name} a ${body.name}`;
      await recordAudit(tx, actor, {
        area: "settings",
        action: "sector.updated",
        summary: `${actor.name} (${actor.role}) ${what}`,
        entityType: "sector",
        entityId: String(id),
        before,
        after,
      });
    });

    return { ok: true };
  });
};
