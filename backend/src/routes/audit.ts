/**
 * The Historial tab: the history log, newest first, filtered by date range,
 * person, area and record. Reading it is not itself logged (App Plan: page
 * views are not logged; exports are, and arrive with the reports).
 */
import { and, desc, eq, gte, lt } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { auditLog } from "../db/schema.js";
import { maskDigits } from "../lib/census.js";
import { HttpError, parse } from "../lib/http.js";

const AREAS = ["census", "finances", "users", "settings", "security", "exports"] as const;
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida.");

const listQuery = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  userId: z.uuid().optional(),
  area: z.enum(AREAS).optional(),
  entityId: z.string().max(100).optional(),
  /** Entries older than this id: the "Ver más" button. */
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/**
 * The first instant of a calendar day in Honduras (UTC−6 all year). Filters
 * are by the board's calendar, not by UTC's, or an entry made at 7 pm would
 * be listed under the next day.
 */
function hondurasStartOfDay(date: string): Date {
  return new Date(`${date}T00:00:00-06:00`);
}

function nextDay(date: string): string {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

const SENSITIVE_KEYS = new Set(["idNumber", "phone"]);

/** The same value with every `idNumber` and `phone` inside it masked to its last digits. */
function maskSensitive(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(maskSensitive);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        SENSITIVE_KEYS.has(key) && typeof item === "string" ? maskDigits(item, key === "phone" ? 2 : 4) : maskSensitive(item),
      ]),
    );
  }
  return value;
}

export const auditRoutes: FastifyPluginAsync = async (app) => {
  const guard = { preHandler: app.requirePermission("log:view") };

  app.get("/audit", guard, async (request) => {
    const query = parse(listQuery, request.query);

    const conditions: SQL[] = [];
    if (query.from) conditions.push(gte(auditLog.occurredAt, hondurasStartOfDay(query.from)));
    if (query.to) conditions.push(lt(auditLog.occurredAt, hondurasStartOfDay(nextDay(query.to))));
    if (query.userId) conditions.push(eq(auditLog.actorUserId, query.userId));
    if (query.area) conditions.push(eq(auditLog.area, query.area));
    if (query.entityId) conditions.push(eq(auditLog.entityId, query.entityId));
    if (query.before) conditions.push(lt(auditLog.id, query.before));

    const rows = await app.db
      .select({
        id: auditLog.id,
        occurredAt: auditLog.occurredAt,
        actorName: auditLog.actorName,
        actorRole: auditLog.actorRole,
        area: auditLog.area,
        action: auditLog.action,
        summary: auditLog.summary,
        reason: auditLog.reason,
        before: auditLog.before,
        after: auditLog.after,
      })
      .from(auditLog)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(auditLog.id))
      .limit(query.limit + 1);

    const page = rows.slice(0, query.limit);
    return {
      entries: page.map(({ before, after, ...entry }) => ({
        ...entry,
        hasDetail: before !== null || after !== null,
      })),
      nextBefore: rows.length > query.limit ? page[page.length - 1]?.id ?? null : null,
    };
  });

  /** "Ver detalle": the values before and after, and the device used. */
  app.get<{ Params: { id: string } }>("/audit/:id", guard, async (request) => {
    const id = Number(request.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) {
      throw new HttpError(404, "not_found", "No se encontró esa entrada.");
    }

    const [entry] = await app.db.select().from(auditLog).where(eq(auditLog.id, id));
    if (!entry) {
      throw new HttpError(404, "not_found", "No se encontró esa entrada.");
    }

    const { prevHash: _prev, hash: _hash, ...visible } = entry;
    // A census entry carries ID numbers and phones; they stay masked for
    // someone who may read the log but not see them (App Plan, Security).
    if (visible.area === "census" && !request.user!.permissions.has("census:view_sensitive")) {
      visible.before = maskSensitive(visible.before);
      visible.after = maskSensitive(visible.after);
    }
    return { entry: visible };
  });
};
