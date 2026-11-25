/**
 * The history log extract (App Plan, Module 4: "A PDF and CSV of the year's
 * log is saved for the board's records"; "Reports": for the fiscal and the
 * president): one calendar year of Historial, in Honduras time, oldest first,
 * to print or to save for a spreadsheet.
 *
 * Each entry carries what Historial's list shows (when, who and their role,
 * what happened and why) and nothing of "Ver detalle": the values before and
 * after hold families' ID numbers and phones, and the file can be sent on to
 * anyone (owner, 25 November 2026). So they are not read at all, and the
 * extract is the same whoever makes it.
 *
 * Making one takes the next document number and, like every printout, writes
 * nothing to Historial (owner, 24 November 2026). The rows come back in the
 * same answer, so what is printed is exactly what was numbered.
 */
import { and, asc, count, desc, gte, lt } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";

import { actorOf } from "../auth/plugin.js";
import type { DbOrTx } from "../db/client.js";
import { inTransaction } from "../db/client.js";
import { auditLog, documents } from "../db/schema.js";
import { HttpError, parse } from "../lib/http.js";
import { businessToday, hondurasStartOfDay } from "../lib/time.js";

const extractBody = z.object({
  year: z.number({ message: "Elija el año." }).int("Elija el año.").min(2000, "Elija el año.").max(9999, "Elija el año."),
  format: z.enum(["print", "csv"], { message: "Elija imprimir o guardar." }),
});

/** The entries of one calendar year, by the board's calendar. */
function inYear(year: number): SQL {
  return and(
    gte(auditLog.occurredAt, hondurasStartOfDay(`${year}-01-01`)),
    lt(auditLog.occurredAt, hondurasStartOfDay(`${year + 1}-01-01`)),
  )!;
}

/** The years Historial has entries in, newest first, each with how many. */
export function logYears(db: DbOrTx, timeZone: string): Array<{ year: number; count: number }> {
  const edge = (order: typeof asc) =>
    db.select({ occurredAt: auditLog.occurredAt }).from(auditLog).orderBy(order(auditLog.occurredAt)).limit(1).get();
  const first = edge(asc);
  const last = edge(desc);
  if (!first || !last) {
    return [];
  }
  const yearOf = (instant: Date) => Number(businessToday(timeZone, instant).slice(0, 4));

  const years: Array<{ year: number; count: number }> = [];
  for (let year = yearOf(last.occurredAt); year >= yearOf(first.occurredAt); year -= 1) {
    const entries = db.select({ count: count() }).from(auditLog).where(inYear(year)).get()!.count;
    if (entries > 0) {
      years.push({ year, count: entries });
    }
  }
  return years;
}

/** A year's entries as the extract carries them, oldest first. */
export function logExtractOf(db: DbOrTx, year: number) {
  return db
    .select({
      occurredAt: auditLog.occurredAt,
      actorName: auditLog.actorName,
      actorRole: auditLog.actorRole,
      summary: auditLog.summary,
      reason: auditLog.reason,
    })
    .from(auditLog)
    .where(inYear(year))
    .orderBy(asc(auditLog.occurredAt), asc(auditLog.id))
    .all();
}

export const logExtractRoutes: FastifyPluginAsync<{ timeZone: string }> = async (app, options) => {
  const hand = { preHandler: app.requirePermission("export:log") };

  // Seeing the log and printing it are two permissions; the extract needs both.
  const mustSeeLog = (request: FastifyRequest) => {
    if (!request.user!.permissions.has("log:view")) {
      throw new HttpError(403, "forbidden", "Su cargo no tiene permiso para esto.");
    }
  };

  /** What there is to choose from. Looking changes nothing. */
  app.get("/audit/extract", hand, async (request) => {
    mustSeeLog(request);
    return {
      thisYear: Number(businessToday(options.timeZone).slice(0, 4)),
      years: logYears(app.db, options.timeZone),
    };
  });

  /**
   * Print a year of Historial or save it for a spreadsheet: it takes the
   * next document number, and comes back with its entries, who made it and
   * when, to be drawn.
   */
  app.post("/audit/extract", hand, async (request, reply) => {
    mustSeeLog(request);
    const { year, format } = parse(extractBody, request.body);
    const actor = actorOf(request);
    const day = businessToday(options.timeZone);

    const result = inTransaction(app.db, (tx) => {
      const entries = logExtractOf(tx, year);
      if (entries.length === 0) {
        throw new HttpError(400, "invalid_request", "No hay nada registrado en ese año.");
      }
      const document = tx
        .insert(documents)
        .values({ kind: "log_extract", details: { year, format, count: entries.length, madeOn: day }, createdBy: actor.userId! })
        .returning({ id: documents.id, createdAt: documents.createdAt })
        .get()!;

      return {
        document: { number: document.id, madeAt: document.createdAt, madeBy: actor.name },
        year,
        madeOn: day,
        entries,
      };
    });

    return reply.code(201).send(result);
  });
};
