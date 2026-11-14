/**
 * Quién debe: the arrears list (App Plan, Module 2, "Arrears"): the active,
 * connected households with unpaid months, and the late fee owed for each.
 *
 * Each house shows, month by month, what the month still owes (not paid in
 * full, from when the house owes, once its deadline is over: src/lib/
 * lateFees.ts, `owedNow`) and its late fee, if one is owed. A month paid in
 * full after its deadline can still owe its late fee, so it appears with
 * nothing left of the fee. Nothing is written: it is worked out each time.
 *
 * "Connected" is a house with water, connected or shared: one marked "Sin
 * conexión" is not listed, nor is an inactive one (owner, 14 November 2026).
 */
import { and, asc, eq, isNull, ne } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";

import { householdOwners, households, people, sectors } from "../db/schema.js";
import { lateFeesOf, owedNow } from "../lib/lateFees.js";
import { lateFeesFrom } from "../lib/settings.js";
import { businessToday } from "../lib/time.js";

/** One month on the list: what is left of its fee, and its late fee (0 when none is owed). */
interface ArrearsMonth {
  month: string;
  owedCentavos: number;
  lateFeeCentavos: number;
}

export const arrearsRoutes: FastifyPluginAsync<{ timeZone: string }> = async (app, options) => {
  const view = { preHandler: app.requirePermission("finance:view") };

  app.get("/finance/arrears", view, async () => {
    const day = businessToday(options.timeZone);
    const houses = app.db
      .select({
        id: households.id,
        code: households.code,
        ownerName: people.fullName,
        sectorName: sectors.name,
      })
      .from(households)
      .innerJoin(householdOwners, and(eq(householdOwners.householdId, households.id), isNull(householdOwners.endsOn)))
      .innerJoin(people, eq(people.id, householdOwners.personId))
      .innerJoin(sectors, eq(sectors.id, households.sectorId))
      .where(and(eq(households.status, "active"), ne(households.waterConnection, "not_connected")))
      .orderBy(asc(households.code))
      .all();

    const rows = houses.flatMap((house) => {
      const byMonth = new Map<string, ArrearsMonth>();
      const at = (month: string) => {
        const existing = byMonth.get(month) ?? { month, owedCentavos: 0, lateFeeCentavos: 0 };
        byMonth.set(month, existing);
        return existing;
      };
      for (const state of owedNow(app.db, house.id, day, options.timeZone)) {
        at(state.month).owedCentavos = state.priceCentavos! - state.paidCentavos;
      }
      for (const fee of lateFeesOf(app.db, house.id, day, options.timeZone).months) {
        at(fee.month).lateFeeCentavos = fee.amountCentavos;
      }
      if (byMonth.size === 0) {
        return [];
      }
      const months = [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
      const owedCentavos = months.reduce((sum, month) => sum + month.owedCentavos, 0);
      const lateFeesCentavos = months.reduce((sum, month) => sum + month.lateFeeCentavos, 0);
      return [{ ...house, months, owedCentavos, lateFeesCentavos, totalCentavos: owedCentavos + lateFeesCentavos }];
    });

    // The most owed first: the houses the treasurer visits first.
    rows.sort((a, b) => b.totalCentavos - a.totalCentavos || a.code.localeCompare(b.code));
    return {
      today: day,
      lateFeesFrom: lateFeesFrom(app.db, day),
      households: rows,
      owedCentavos: rows.reduce((sum, row) => sum + row.owedCentavos, 0),
      lateFeesCentavos: rows.reduce((sum, row) => sum + row.lateFeesCentavos, 0),
      totalCentavos: rows.reduce((sum, row) => sum + row.totalCentavos, 0),
    };
  });
};
