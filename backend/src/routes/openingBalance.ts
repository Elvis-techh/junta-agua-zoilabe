/**
 * Saldo de la junta (owner, 17 November 2026): the opening balance, entered
 * once, and the money now, in cash, in the bank and, when there is any,
 * paid "Otro" (src/lib/balance.ts).
 *
 *  - The treasurer enters the cash in the box and the money in the bank on
 *    the first day of a month: the month the app's money begins.
 *  - A wrong figure is corrected, never edited: a new entry that points to
 *    the one it replaces, with a written reason. Once any month is closed it
 *    is locked.
 *  - No approval of its own: the first month close shows it, and that close
 *    already takes a second person.
 */
import { eq } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { actorOf } from "../auth/plugin.js";
import { newId } from "../auth/session.js";
import { inTransaction } from "../db/client.js";
import { openingBalances } from "../db/schema.js";
import { recordAudit } from "../lib/audit.js";
import { firstClosedMonth, moneyNow, openingBalance, openingEntries } from "../lib/balance.js";
import { formatLempiras } from "../lib/census.js";
import { firstOfMonth, monthName } from "../lib/fees.js";
import { HttpError, parse } from "../lib/http.js";
import { MAX_AMOUNT_CENTAVOS } from "../lib/money.js";
import { businessToday } from "../lib/time.js";

const amount = (what: string) =>
  z
    .number({ message: `Escriba ${what}, o 0 si no hay.` })
    .int("Escriba el monto en lempiras, por ejemplo 2500 o 2500.50.")
    .min(0, "El monto no puede ser negativo.")
    .max(MAX_AMOUNT_CENTAVOS, "El monto es demasiado alto.");

const balanceBody = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-01$/, "Elija el mes en que empieza el dinero de la aplicación."),
  cashCentavos: amount("el efectivo en caja"),
  bankCentavos: amount("el dinero en el banco"),
});

const correctBody = balanceBody.extend({
  reason: z
    .string({ message: "Escriba por qué se corrige." })
    .trim()
    .min(5, "Escriba por qué se corrige.")
    .max(300, "El motivo es demasiado largo."),
});

interface Params {
  id: string;
}

type Figures = z.infer<typeof balanceBody>;

/** "Efectivo L 2,500.00 y banco L 10,000.00 al empezar octubre de 2026" — how the history log says it. */
function figuresWords(figures: Figures): string {
  return (
    `efectivo ${formatLempiras(figures.cashCentavos)} y banco ${formatLempiras(figures.bankCentavos)}` +
    ` al empezar ${monthName(figures.month)}`
  );
}

export const openingBalanceRoutes: FastifyPluginAsync<{ timeZone: string }> = async (app, options) => {
  const view = { preHandler: app.requirePermission("finance:view") };
  const record = { preHandler: app.requirePermission("finance:record") };
  const correct = { preHandler: app.requirePermission("finance:reverse") };
  const thisMonth = () => firstOfMonth(businessToday(options.timeZone));

  const notLater = (month: string) => {
    if (month > thisMonth()) {
      throw new HttpError(400, "future_month", "El saldo inicial no puede empezar en un mes que todavía no llega.");
    }
  };

  app.get("/finance/opening-balance", view, async () => ({
    thisMonth: thisMonth(),
    opening: openingBalance(app.db),
    entries: openingEntries(app.db),
    money: moneyNow(app.db),
    closedMonth: firstClosedMonth(app.db),
  }));

  app.post("/finance/opening-balance", record, async (request) => {
    const body = parse(balanceBody, request.body);
    const actor = actorOf(request);
    notLater(body.month);

    return inTransaction(app.db, (tx) => {
      if (openingBalance(tx)) {
        throw new HttpError(409, "already_entered", "El saldo inicial ya se anotó. Si está mal, use Corregir.");
      }
      const id = newId();
      tx.insert(openingBalances).values({ id, ...body, createdBy: actor.userId! }).run();
      recordAudit(tx, actor, {
        area: "finances",
        action: "opening_balance.entered",
        summary: `${actor.name} (${actor.role}) anotó el saldo inicial: ${figuresWords(body)}`,
        entityType: "opening_balance",
        entityId: id,
        after: body,
      });
      return { opening: openingBalance(tx), money: moneyNow(tx) };
    });
  });

  app.post<{ Params: Params }>("/finance/opening-balance/:id/correct", correct, async (request) => {
    const body = parse(correctBody, request.body);
    const actor = actorOf(request);
    notLater(body.month);

    return inTransaction(app.db, (tx) => {
      const closed = firstClosedMonth(tx);
      if (closed) {
        throw new HttpError(
          409,
          "month_closed",
          `El mes de ${monthName(closed)} ya está cerrado, así que el saldo inicial ya no se puede corregir.`,
        );
      }
      const current = openingBalance(tx);
      if (!current) {
        throw new HttpError(404, "not_found", "Todavía no hay saldo inicial que corregir.");
      }
      if (current.id !== request.params.id) {
        const known = tx.select({ id: openingBalances.id }).from(openingBalances).where(eq(openingBalances.id, request.params.id)).get();
        throw known
          ? new HttpError(409, "already_corrected", "Ese saldo inicial ya se corrigió. Vuelva a abrir la pantalla para ver el de ahora.")
          : new HttpError(404, "not_found", "No se encontró ese saldo inicial.");
      }
      const { reason, ...figures } = body;
      if (current.month === figures.month && current.cashCentavos === figures.cashCentavos && current.bankCentavos === figures.bankCentavos) {
        throw new HttpError(400, "unchanged", "Los montos y el mes son los mismos de ahora. Cambie lo que está mal.");
      }

      const id = newId();
      tx.insert(openingBalances).values({ id, ...figures, replacesId: current.id, reason, createdBy: actor.userId! }).run();
      const before = { month: current.month, cashCentavos: current.cashCentavos, bankCentavos: current.bankCentavos };
      recordAudit(tx, actor, {
        area: "finances",
        action: "opening_balance.corrected",
        summary: `${actor.name} (${actor.role}) corrigió el saldo inicial: ${figuresWords(figures)} (antes ${figuresWords(before)})`,
        entityType: "opening_balance",
        entityId: id,
        before: { id: current.id, ...before },
        after: { id, ...figures },
        reason,
      });
      return { opening: openingBalance(tx), money: moneyNow(tx) };
    });
  });
};
