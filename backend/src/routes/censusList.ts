/**
 * The census list as a document (App Plan, "Reports": "Census list, filtered
 * by sector and status — Screen, PDF, CSV"), for the secretary and, later,
 * for a guest with census access.
 *
 * Looking at the list on Censo changes nothing. Printing it or saving it for
 * a spreadsheet takes the next document number, and nothing else: the owner
 * decided on 24 November 2026 that printing is not written to Historial (the
 * board will not audit who printed what). The `documents` row still says who
 * made the list and for which filters. The rows come back in the same
 * answer, so what is printed is exactly what was numbered.
 *
 * ID numbers and phones are masked here, as on every census screen, unless
 * the person holds `census:view_sensitive`: a printout cannot show more than
 * its maker may see.
 */
import { and, asc, eq, isNull } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { actorOf } from "../auth/plugin.js";
import type { DbOrTx } from "../db/client.js";
import { inTransaction } from "../db/client.js";
import { documents, householdOwners, households, people, sectors } from "../db/schema.js";
import { maskDigits } from "../lib/census.js";
import { HttpError, parse } from "../lib/http.js";
import { maskPhone } from "../lib/phone.js";
import { businessToday } from "../lib/time.js";

const listBody = z.object({
  sectorId: z.number().int().positive().optional(),
  status: z.enum(["active", "inactive", "all"], { message: "Elija qué viviendas." }),
  format: z.enum(["print", "csv"], { message: "Elija imprimir o guardar." }),
});

export type CensusListFilters = { sectorId?: number | undefined; status: "active" | "inactive" | "all" };

/** One house on the list, as its maker may see it. */
export interface CensusListRow {
  code: string;
  ownerName: string;
  relation: string;
  idNumber: string | null;
  phone: string | null;
  phoneMissing: string | null;
  sectorName: string;
  references: string | null;
  waterConnection: string;
  status: string;
  inactiveReason: string | null;
  paperFormNumber: string | null;
  lastVerifiedOn: string | null;
}

/** The houses on the list, by code, each with the person registered for it now. */
export function censusListOf(db: DbOrTx, filters: CensusListFilters, sensitive: boolean): CensusListRow[] {
  const conditions: SQL[] = [];
  if (filters.sectorId) conditions.push(eq(households.sectorId, filters.sectorId));
  if (filters.status !== "all") conditions.push(eq(households.status, filters.status));

  return db
    .select({
      code: households.code,
      ownerName: people.fullName,
      relation: householdOwners.relation,
      idNumber: people.idNumber,
      phone: people.phone,
      phoneMissing: people.phoneMissing,
      sectorName: sectors.name,
      references: households.references,
      waterConnection: households.waterConnection,
      status: households.status,
      inactiveReason: households.inactiveReason,
      paperFormNumber: households.paperFormNumber,
      lastVerifiedOn: households.lastVerifiedOn,
    })
    .from(households)
    .innerJoin(sectors, eq(sectors.id, households.sectorId))
    .innerJoin(householdOwners, and(eq(householdOwners.householdId, households.id), isNull(householdOwners.endsOn)))
    .innerJoin(people, eq(people.id, householdOwners.personId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(households.code))
    .all()
    .map((row) => ({
      ...row,
      idNumber: sensitive ? row.idNumber : maskDigits(row.idNumber, 4),
      phone: sensitive ? row.phone : maskPhone(row.phone),
    }));
}

export const censusListRoutes: FastifyPluginAsync<{ timeZone: string }> = async (app, options) => {
  const hand = { preHandler: app.requirePermission("export:census") };

  /**
   * Print the census list or save it for a spreadsheet: it takes the next
   * document number, and comes back with its rows, who made it and when, to
   * be drawn.
   */
  app.post("/census/list", hand, async (request, reply) => {
    // Seeing the census and printing it are two permissions; the list needs both.
    if (!request.user!.permissions.has("census:view")) {
      throw new HttpError(403, "forbidden", "Su cargo no tiene permiso para esto.");
    }
    const body = parse(listBody, request.body);
    const actor = actorOf(request);
    const sensitive = request.user!.permissions.has("census:view_sensitive");
    const day = businessToday(options.timeZone);

    const result = inTransaction(app.db, (tx) => {
      const sector = body.sectorId
        ? tx.select({ id: sectors.id, name: sectors.name }).from(sectors).where(eq(sectors.id, body.sectorId)).get()
        : null;
      if (body.sectorId && !sector) {
        throw new HttpError(400, "invalid_request", "Ese sector no existe.");
      }
      const rows = censusListOf(tx, { sectorId: body.sectorId, status: body.status }, sensitive);
      const details = {
        sectorId: sector?.id ?? null,
        sectorName: sector?.name ?? null,
        status: body.status,
        format: body.format,
        count: rows.length,
        sensitive,
        madeOn: day,
      };
      const document = tx
        .insert(documents)
        .values({ kind: "census_list", details, createdBy: actor.userId! })
        .returning({ id: documents.id, createdAt: documents.createdAt })
        .get()!;

      return {
        document: { number: document.id, madeAt: document.createdAt, madeBy: actor.name },
        filters: { sectorName: details.sectorName, status: body.status },
        sensitive,
        households: rows,
      };
    });

    return reply.code(201).send(result);
  });
};
