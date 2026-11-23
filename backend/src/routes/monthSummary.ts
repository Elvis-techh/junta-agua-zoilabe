/**
 * Resumen del mes (owner, 19 November 2026): a month's money, what came in
 * and from whom, what was spent and on what, and who was charged its fee,
 * who paid and who still owes. How each part is counted is in
 * src/lib/monthSummary.ts.
 *
 * Any month from the opening balance's to the month in progress can be
 * looked at, closed or not: the board checks a month before closing it too.
 * Like Quién debe, it is for whoever holds `finance:view`; it shows names
 * and amounts, never an ID number or a phone.
 *
 * Looking at it changes nothing. Handing it out as a document ("Estado
 * financiero del mes", owner, 23 November 2026) takes the next document
 * number and is in Historial under Impresiones, as a house's statement is:
 * the same figures, read and numbered in one transaction.
 */
import { eq } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { actorOf } from "../auth/plugin.js";
import type { DbOrTx } from "../db/client.js";
import { inTransaction } from "../db/client.js";
import { documents, months } from "../db/schema.js";
import { recordAudit } from "../lib/audit.js";
import { openingBalance } from "../lib/balance.js";
import { firstOfMonth, monthName } from "../lib/fees.js";
import { HttpError, parse } from "../lib/http.js";
import { monthFigures } from "../lib/monthClose.js";
import { monthEntries, monthFee } from "../lib/monthSummary.js";
import { businessToday } from "../lib/time.js";

const monthParam = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-01$/, "Ese no es un mes."),
});

export const monthSummaryRoutes: FastifyPluginAsync<{ timeZone: string }> = async (app, options) => {
  const view = { preHandler: app.requirePermission("finance:view") };
  const hand = { preHandler: app.requirePermission("export:finance") };

  const summaryOf = (db: DbOrTx, month: string | null) => {
    const today = businessToday(options.timeZone);
    const thisMonth = firstOfMonth(today);
    const opening = openingBalance(db);
    if (!opening) {
      throw new HttpError(409, "no_opening_balance", "Primero anote el Saldo de la junta: el resumen cuenta el dinero desde ahí.");
    }
    const chosen = month ?? thisMonth;
    if (chosen < opening.month) {
      throw new HttpError(400, "before_opening", `El dinero de la aplicación empieza en ${monthName(opening.month)}.`);
    }
    if (chosen > thisMonth) {
      throw new HttpError(400, "month_not_started", `El mes de ${monthName(chosen)} todavía no empieza.`);
    }
    const row = db.select({ status: months.status }).from(months).where(eq(months.month, chosen)).get();
    return {
      month: chosen,
      today,
      thisMonth,
      openingMonth: opening.month,
      /** The month close's status; "open" while nobody has prepared it. */
      status: row?.status ?? "open",
      figures: monthFigures(db, opening.month, { cashCentavos: opening.cashCentavos, bankCentavos: opening.bankCentavos, otherCentavos: 0 }, chosen),
      entries: monthEntries(db, opening.month, chosen),
      fee: monthFee(db, chosen, today, options.timeZone),
    };
  };

  /** The month in progress. */
  app.get("/finance/summary", view, async () => summaryOf(app.db, null));

  app.get<{ Params: { month: string } }>("/finance/summary/:month", view, async (request) => {
    const { month } = parse(monthParam, request.params);
    return summaryOf(app.db, month);
  });

  /**
   * Hand out a month's summary as a document: it takes the next document
   * number and is logged, and comes back with who made it and when, to be
   * drawn and sent. Any month the summary can be looked at, closed or not;
   * the document says which it was.
   */
  app.post<{ Params: { month: string } }>("/finance/summary/:month/statement", hand, async (request, reply) => {
    const { month } = parse(monthParam, request.params);
    const actor = actorOf(request);

    const result = inTransaction(app.db, (tx) => {
      const summary = summaryOf(tx, month);
      const total = (money: { cashCentavos: number; bankCentavos: number; otherCentavos: number }) =>
        money.cashCentavos + money.bankCentavos + money.otherCentavos;
      const made = {
        month,
        madeOn: summary.today,
        status: summary.status,
        incomeCentavos: total(summary.figures.income),
        expenseCentavos: total(summary.figures.expense),
        expectedCentavos: total(summary.figures.expected),
      };
      const document = tx
        .insert(documents)
        .values({ kind: "month_statement", householdId: null, details: made, createdBy: actor.userId! })
        .returning({ id: documents.id, createdAt: documents.createdAt })
        .get()!;

      recordAudit(tx, actor, {
        area: "exports",
        action: "month_statement.issued",
        summary: `${actor.name} (${actor.role}) hizo el estado financiero nº ${document.id} de ${monthName(month)}`,
        entityType: "document",
        entityId: String(document.id),
        after: { kind: "month_statement", ...made },
      });

      return { summary, document: { number: document.id, madeAt: document.createdAt, madeBy: actor.name } };
    });

    return reply.code(201).send(result);
  });
};
