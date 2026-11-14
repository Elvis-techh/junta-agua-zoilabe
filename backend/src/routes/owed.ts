/**
 * The start month, and "Deuda anterior": what each house already owed when
 * the app took over (App Plan, Module 2; board, 6 and 7 November 2026).
 *
 * The start month is the month the app takes over from the paper book, the
 * same for every house, saved once in Configuración and never changed
 * (owner, 13 November 2026). From it on, every month counts as owed until
 * it is paid. Before it, a house owes only the months the treasurer enters
 * here from the paper receipt book, each at the fee in Configuración for
 * that month (or the house's different amount), with a late fee only where
 * the book shows one. Both prices are fixed when the month is entered.
 *
 * A month entered by mistake is removed ("Quitar") with a written reason,
 * until a payment covers it (owner, 13 November 2026). Nothing is deleted:
 * the row stays, marked removed, and the history says who and why.
 */
import { and, asc, eq, isNull } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { actorOf } from "../auth/plugin.js";
import { newId } from "../auth/session.js";
import type { DbOrTx } from "../db/client.js";
import { inTransaction } from "../db/client.js";
import { householdOwners, households, owedMonths, people, settings, users } from "../db/schema.js";
import { recordAudit } from "../lib/audit.js";
import { formatLempiras } from "../lib/census.js";
import { monthName } from "../lib/fees.js";
import { HttpError, parse } from "../lib/http.js";
import { oldMonthLateFee, oldMonthPrice } from "../lib/owed.js";
import { monthList, monthStates, monthsBetween } from "../lib/payments.js";
import { START_MONTH_KEY, startMonth } from "../lib/settings.js";
import { businessToday } from "../lib/time.js";

/** A month as its first day, from 2000 on: older than any paper book the board keeps. */
const month = z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])-01$/, "Elija el mes.");

const startMonthBody = z.object({ month });

const enterBody = z.object({
  months: z
    .array(
      z.object({
        month,
        /** The paper book shows a late fee (mora) for this month. */
        lateFee: z.boolean(),
      }),
      { message: "Elija los meses que debía." },
    )
    .min(1, "Elija los meses que debía.")
    .max(120, "Son demasiados meses de una vez. Anótelos por años."),
});

const removeBody = z.object({
  reason: z
    .string({ message: "Escriba por qué se quita." })
    .trim()
    .min(5, "Escriba por qué se quita.")
    .max(300, "El motivo es demasiado largo."),
});

const yearQuery = z.object({ year: z.string().regex(/^20\d{2}$/, "Elija el año.") });

type Params = { id: string };

const NO_HOUSEHOLD = new HttpError(404, "not_found", "No se encontró esa vivienda.");
const NO_ENTRY = new HttpError(404, "not_found", "No se encontró ese mes anotado.");
const NO_START = new HttpError(
  409,
  "no_start_month",
  "Todavía no hay mes de inicio. Primero hay que ponerlo en Configuración.",
);

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The household and the name of the person it is registered to now. */
function householdOf(db: DbOrTx, id: string) {
  if (!z.uuid().safeParse(id).success) {
    throw NO_HOUSEHOLD;
  }
  const row = db
    .select({ id: households.id, code: households.code, ownerName: people.fullName })
    .from(households)
    .innerJoin(householdOwners, and(eq(householdOwners.householdId, households.id), isNull(householdOwners.endsOn)))
    .innerJoin(people, eq(people.id, householdOwners.personId))
    .where(eq(households.id, id))
    .get();
  if (!row) {
    throw NO_HOUSEHOLD;
  }
  return row;
}

/** The months of a house entered as owed and not removed, oldest first, with what has been paid towards each. */
function entriesOf(db: DbOrTx, householdId: string) {
  const rows = db
    .select({
      id: owedMonths.id,
      month: owedMonths.month,
      priceCentavos: owedMonths.priceCentavos,
      lateFeeCentavos: owedMonths.lateFeeCentavos,
      recordedBy: users.name,
      createdAt: owedMonths.createdAt,
    })
    .from(owedMonths)
    .innerJoin(users, eq(users.id, owedMonths.createdBy))
    .where(and(eq(owedMonths.householdId, householdId), isNull(owedMonths.removedAt)))
    .orderBy(asc(owedMonths.month))
    .all();
  const paid = new Map(monthStates(db, householdId, rows.map((row) => row.month)).map((state) => [state.month, state.paidCentavos]));
  return rows.map((row) => ({ ...row, paidCentavos: paid.get(row.month) ?? 0 }));
}

/** "L 70.00", or "L 70.00, con mora de L 20.00". */
function priceLine(entry: { priceCentavos: number; lateFeeCentavos: number | null }): string {
  return (
    formatLempiras(entry.priceCentavos) +
    (entry.lateFeeCentavos === null ? "" : `, con mora de ${formatLempiras(entry.lateFeeCentavos)}`)
  );
}

export const owedRoutes: FastifyPluginAsync<{ timeZone: string }> = async (app, options) => {
  const editSettings = { preHandler: app.requirePermission("settings:edit") };
  const view = { preHandler: app.requirePermission("finance:view") };
  const record = { preHandler: app.requirePermission("finance:record") };
  const reverse = { preHandler: app.requirePermission("finance:reverse") };
  const today = () => businessToday(options.timeZone);

  /** Configuración → Mes de inicio. */
  app.get("/settings/start-month", editSettings, async () => ({ today: today(), startMonth: startMonth(app.db) }));

  /** Saves the start month, once: it cannot be changed afterwards. */
  app.post("/settings/start-month", editSettings, async (request, reply) => {
    const body = parse(startMonthBody, request.body);
    const actor = actorOf(request);
    const day = today();

    const saved = inTransaction(app.db, (tx) => {
      const existing = startMonth(tx);
      if (existing) {
        throw new HttpError(
          409,
          "start_month_saved",
          `El mes de inicio ya se guardó: ${monthName(existing.month)}. No se puede cambiar.`,
        );
      }
      tx.insert(settings)
        .values({ key: START_MONTH_KEY, value: body.month, effectiveFrom: day, createdBy: actor.userId })
        .run();
      recordAudit(tx, actor, {
        area: "settings",
        action: "start_month.set",
        summary: `${actor.name} (${actor.role}) fijó el mes de inicio en ${monthName(body.month)}`,
        entityType: "setting",
        entityId: START_MONTH_KEY,
        after: { month: body.month },
      });
      return startMonth(tx)!;
    });

    return reply.code(201).send({ startMonth: saved });
  });

  /** The months a house already owed when the app took over, as entered. */
  app.get<{ Params: Params }>("/finance/households/:id/owed", view, async (request) => {
    const household = householdOf(app.db, request.params.id);
    return { startMonth: startMonth(app.db)?.month ?? null, household, entries: entriesOf(app.db, household.id) };
  });

  /**
   * One year's months before the start month, for the grid where the
   * treasurer taps the ones the paper book shows unpaid: what each would cost,
   * its late fee, and whether it is already entered or has money paid.
   */
  app.get<{ Params: Params }>("/finance/households/:id/owed/options", view, async (request) => {
    const { year } = parse(yearQuery, request.query);
    const household = householdOf(app.db, request.params.id);
    const start = startMonth(app.db)?.month ?? null;
    if (!start) {
      throw NO_START;
    }
    const first = `${year}-01-01`;
    const last = `${year}-12-01`;
    const states = first < start ? monthStates(app.db, household.id, monthsBetween(first, last).filter((m) => m < start)) : [];
    return {
      startMonth: start,
      year: Number(year),
      months: states.map((state) => ({
        month: state.month,
        priceCentavos: state.owed ? state.priceCentavos : oldMonthPrice(app.db, household.id, state.month),
        lateFeeCentavos: state.owed ? state.owed.lateFeeCentavos : oldMonthLateFee(app.db, state.month),
        entered: Boolean(state.owed),
        enteredWithLateFee: state.owed ? state.owed.lateFeeCentavos !== null : false,
        paidCentavos: state.paidCentavos,
      })),
    };
  });

  /** Anotar deuda anterior: the months the paper book shows unpaid, each with or without its late fee. */
  app.post<{ Params: Params }>("/finance/households/:id/owed", record, async (request, reply) => {
    const body = parse(enterBody, request.body);
    const actor = actorOf(request);

    const wanted = new Map<string, boolean>();
    for (const item of body.months) {
      if (wanted.has(item.month) && wanted.get(item.month) !== item.lateFee) {
        throw new HttpError(400, "invalid_request", `${capitalize(monthName(item.month))} viene dos veces, con y sin mora.`);
      }
      wanted.set(item.month, item.lateFee);
    }
    const chosen = [...wanted.keys()].sort();

    const result = inTransaction(app.db, (tx) => {
      const household = householdOf(tx, request.params.id);
      const start = startMonth(tx)?.month ?? null;
      if (!start) {
        throw NO_START;
      }
      const late = chosen.find((m) => m >= start);
      if (late) {
        throw new HttpError(
          409,
          "not_before_start",
          `Solo se anotan meses de antes de ${monthName(start)}, el mes de inicio. ${capitalize(monthName(late))} se cobra en Cobrar.`,
        );
      }

      const states = new Map(monthStates(tx, household.id, chosen).map((state) => [state.month, state]));
      const entries: Array<{ month: string; priceCentavos: number; lateFeeCentavos: number | null }> = [];
      for (const m of chosen) {
        const state = states.get(m)!;
        const lateFee = wanted.get(m)!;
        const name = capitalize(monthName(m));
        if (state.owed) {
          // Entered already, the same way: a retry or a second tap, not an error.
          if ((state.owed.lateFeeCentavos !== null) === lateFee) {
            continue;
          }
          throw new HttpError(
            409,
            "already_entered",
            `${name} ya está anotado ${state.owed.lateFeeCentavos === null ? "sin" : "con"} mora. Para cambiarlo, quítelo y anótelo de nuevo.`,
          );
        }
        if (state.paidCentavos > 0) {
          throw new HttpError(409, "already_paid", `${name} ya tiene pagos en la aplicación, así que no se anota como deuda anterior.`);
        }
        const price = oldMonthPrice(tx, household.id, m);
        if (price === null) {
          throw new HttpError(
            409,
            "no_fee",
            `No hay cuota para ${monthName(m)}. Pida que la pongan en Configuración → Cuotas, desde un mes pasado.`,
          );
        }
        if (price === 0) {
          throw new HttpError(409, "free", `${name} no se cobra, así que no se anota. Quítelo de la lista.`);
        }
        const lateFeeCentavos = lateFee ? oldMonthLateFee(tx, m) : null;
        if (lateFee && lateFeeCentavos === null) {
          throw new HttpError(
            409,
            "no_late_fee",
            `No hay mora para ${monthName(m)}. Pida que la pongan en Configuración → Cuotas, desde un mes pasado.`,
          );
        }
        entries.push({ month: m, priceCentavos: price, lateFeeCentavos });
      }

      if (entries.length > 0) {
        tx.insert(owedMonths)
          .values(entries.map((entry) => ({ id: newId(), householdId: household.id, ...entry, createdBy: actor.userId! })))
          .run();
        const total = entries.reduce((sum, entry) => sum + entry.priceCentavos, 0);
        const withLateFee = entries.filter((entry) => entry.lateFeeCentavos !== null);
        const lateTotal = withLateFee.reduce((sum, entry) => sum + entry.lateFeeCentavos!, 0);
        recordAudit(tx, actor, {
          area: "finances",
          action: "owed_months.entered",
          summary:
            `${actor.name} (${actor.role}) anotó deuda anterior de la vivienda ${household.code}: ` +
            `${monthList(entries.map((entry) => entry.month))} (${formatLempiras(total)})` +
            (withLateFee.length > 0
              ? `, con mora en ${monthList(withLateFee.map((entry) => entry.month))} (${formatLempiras(lateTotal)})`
              : ""),
          entityType: "household",
          entityId: household.id,
          after: { entries },
        });
      }
      return { created: entries.length, entries: entriesOf(tx, household.id) };
    });

    return reply.code(result.created > 0 ? 201 : 200).send(result);
  });

  /** "Quitar": a month entered by mistake, with its reason, until a payment covers it. */
  app.post<{ Params: Params }>("/finance/owed/:id/remove", reverse, async (request) => {
    if (!z.uuid().safeParse(request.params.id).success) {
      throw NO_ENTRY;
    }
    const body = parse(removeBody, request.body);
    const actor = actorOf(request);

    inTransaction(app.db, (tx) => {
      const entry = tx.select().from(owedMonths).where(eq(owedMonths.id, request.params.id)).get();
      if (!entry || entry.removedAt) {
        throw NO_ENTRY;
      }
      const household = householdOf(tx, entry.householdId);
      const [state] = monthStates(tx, household.id, [entry.month]);
      if (state!.paidCentavos > 0) {
        throw new HttpError(
          409,
          "already_paid",
          `Ya hay pagos de ${monthName(entry.month)}, así que no se quita. Si el pago estaba mal, anúlelo primero.`,
        );
      }

      tx.update(owedMonths)
        .set({ removedAt: new Date(), removedBy: actor.userId, removedReason: body.reason })
        .where(eq(owedMonths.id, entry.id))
        .run();
      recordAudit(tx, actor, {
        area: "finances",
        action: "owed_month.removed",
        summary:
          `${actor.name} (${actor.role}) quitó la deuda anterior de ${monthName(entry.month)} (${priceLine(entry)})` +
          ` de la vivienda ${household.code}`,
        entityType: "owed_month",
        entityId: entry.id,
        before: { month: entry.month, priceCentavos: entry.priceCentavos, lateFeeCentavos: entry.lateFeeCentavos },
        reason: body.reason,
      });
    });

    return { ok: true };
  });
};
