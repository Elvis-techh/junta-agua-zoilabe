/**
 * Cobrar: monthly fee payments (App Plan, Module 2).
 *
 * A payment is one permanent entry in `transactions` plus its shares in
 * `payment_months`, one for each month it reaches; src/lib/payments.ts holds
 * how the money is shared. Nothing here changes or removes an entry.
 *
 * A mistake is fixed by "Anular pago": a reversal entry with the opposite
 * amount that points to the original and carries a written reason. The
 * board's answers of 7 November 2026: only a whole payment is reversed (a
 * wrong amount or month is reversed and recorded again); the reversal is
 * dated the day it is made and counts in that month, while the original
 * stays in its own; it can be made at any time, even after the original's
 * month is closed; and a reversal is final, never itself reversed. A
 * reversal has no shares, so the months go back to how they were before
 * the payment (src/lib/payments.ts, `monthStates`).
 */
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { actorOf } from "../auth/plugin.js";
import { newId } from "../auth/session.js";
import type { DbOrTx, Tx } from "../db/client.js";
import { inTransaction } from "../db/client.js";
import { categories, householdOwners, households, months, paymentMonths, people, transactions, users } from "../db/schema.js";
import { recordAudit } from "../lib/audit.js";
import { formatLempiras } from "../lib/census.js";
import { firstOfMonth, monthName } from "../lib/fees.js";
import { HttpError, parse } from "../lib/http.js";
import {
  MONTHS_AHEAD,
  addMonths,
  allocatePayment,
  monthList,
  monthStates,
  monthsBetween,
  owedMonths,
  owesFrom,
} from "../lib/payments.js";
import { deadline, isPastDeadline, monthDeadline } from "../lib/settings.js";
import { businessToday, formatCalendarDate } from "../lib/time.js";

/** The income category every monthly fee payment goes to (src/db/seeding.ts). */
const MONTHLY_FEE_CATEGORY = "Cuota mensual";

export const PAYMENT_METHODS = { cash: "efectivo", transfer: "transferencia", other: "otro medio" } as const;

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-01$/, "Elija el mes.");
const day = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "Elija la fecha del pago.");
const optionalText = (max: number, tooLong: string) =>
  z
    .string()
    .trim()
    .max(max, tooLong)
    .optional()
    .transform((value) => (value ? value : null));

const paymentBody = z.object({
  submissionId: z.uuid(),
  householdId: z.uuid({ message: "Elija la vivienda." }),
  months: z
    .array(month, { message: "Elija el mes o los meses que se pagan." })
    .min(1, "Elija el mes o los meses que se pagan.")
    .max(36, "Son demasiados meses para un solo pago."),
  amountCentavos: z
    .number({ message: "Escriba el monto que se pagó." })
    .int("Escriba el monto en lempiras, por ejemplo 70 o 70.50.")
    .min(1, "Escriba el monto que se pagó.")
    .max(99_999_999, "El monto es demasiado alto."),
  occurredOn: day,
  paymentMethod: z.enum(["cash", "transfer", "other"], { message: "Elija cómo se pagó." }),
  bankReference: optionalText(60, "La referencia es demasiado larga."),
  paperReceiptNumber: z
    .string({ message: "Escriba el número del recibo de papel." })
    .trim()
    .min(1, "Escriba el número del recibo de papel.")
    .max(30, "El número del recibo es demasiado largo."),
  payerName: optionalText(120, "El nombre es demasiado largo."),
  note: optionalText(300, "La nota es demasiado larga."),
  /** The treasurer saw that the receipt number was already used, and saves anyway. */
  confirmRepeatedReceipt: z.boolean().optional(),
});

const reverseBody = z.object({
  reason: z
    .string({ message: "Escriba por qué se anula." })
    .trim()
    .min(5, "Escriba por qué se anula.")
    .max(300, "El motivo es demasiado largo."),
});

const monthsQuery = z.object({ from: month.optional(), to: month.optional() });

type Params = { id: string };

const NO_HOUSEHOLD = new HttpError(404, "not_found", "No se encontró esa vivienda.");
const NO_PAYMENT = new HttpError(404, "not_found", "No se encontró ese pago.");

/** The household and the name of the person it is registered to now. */
function householdOf(tx: DbOrTx, id: string) {
  const row = tx
    .select({
      id: households.id,
      code: households.code,
      status: households.status,
      waterConnection: households.waterConnection,
      ownerName: people.fullName,
    })
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

/**
 * The payments of a house (or the one with this id), newest first, each with
 * how it was shared among months and whether its receipt number was used on
 * another entry too.
 */
function paymentsOf(tx: DbOrTx, where: { householdId: string } | { id: string }) {
  const rows = tx
    .select({
      id: transactions.id,
      householdId: transactions.householdId,
      occurredOn: transactions.occurredOn,
      amountCentavos: transactions.amountCentavos,
      paymentMethod: transactions.paymentMethod,
      bankReference: transactions.bankReference,
      paperReceiptNumber: transactions.paperReceiptNumber,
      payerName: transactions.payerName,
      note: transactions.note,
      recordedBy: users.name,
      createdAt: transactions.createdAt,
      reversed: sql<number>`EXISTS (SELECT 1 FROM transactions r WHERE r.reverses_id = ${transactions.id})`,
      repeatedReceipt: sql<number>`EXISTS (
        SELECT 1 FROM transactions o
        WHERE o.paper_receipt_number = ${transactions.paperReceiptNumber}
          AND o.id <> ${transactions.id}
          AND o.reverses_id IS NULL
          AND NOT EXISTS (SELECT 1 FROM transactions r WHERE r.reverses_id = o.id)
      )`,
    })
    .from(transactions)
    .innerJoin(paymentMonths, eq(paymentMonths.transactionId, transactions.id))
    .innerJoin(users, eq(users.id, transactions.createdBy))
    .where("id" in where ? eq(transactions.id, where.id) : eq(transactions.householdId, where.householdId))
    .groupBy(transactions.id)
    .orderBy(desc(transactions.occurredOn), desc(transactions.createdAt))
    .all();

  return rows.map((row) => ({
    ...row,
    reversed: Boolean(row.reversed),
    repeatedReceipt: Boolean(row.repeatedReceipt),
    shares: tx
      .select({ month: paymentMonths.month, amountCentavos: paymentMonths.amountCentavos, priceCentavos: paymentMonths.priceCentavos })
      .from(paymentMonths)
      .where(eq(paymentMonths.transactionId, row.id))
      .orderBy(paymentMonths.month)
      .all(),
    reversal: reversalOf(tx, row.id),
  }));
}

/** The entry that reversed this payment, if one did: when, by whom and why. */
function reversalOf(tx: DbOrTx, id: string) {
  return (
    tx
      .select({
        id: transactions.id,
        occurredOn: transactions.occurredOn,
        reason: transactions.reason,
        recordedBy: users.name,
        createdAt: transactions.createdAt,
      })
      .from(transactions)
      .innerJoin(users, eq(users.id, transactions.createdBy))
      .where(eq(transactions.reversesId, id))
      .get() ?? null
  );
}

/** The month row an entry dated `occurredOn` belongs to, made when its month has none yet. */
function openMonthFor(
  tx: Tx,
  occurredOn: string,
  closed = (first: string) =>
    `El mes de ${monthName(first)} ya está cerrado. Registre el pago con la fecha de hoy y escriba en la nota de qué fecha es.`,
): number {
  const first = firstOfMonth(occurredOn);
  const existing = tx.select().from(months).where(eq(months.month, first)).get();
  if (existing) {
    if (existing.status !== "open") {
      throw new HttpError(409, "month_closed", closed(first));
    }
    return existing.id;
  }
  return tx.insert(months).values({ month: first, status: "open" }).returning({ id: months.id }).get()!.id;
}

export const paymentRoutes: FastifyPluginAsync<{ timeZone: string }> = async (app, options) => {
  const view = { preHandler: app.requirePermission("finance:view") };
  const record = { preHandler: app.requirePermission("finance:record") };
  const reverse = { preHandler: app.requirePermission("finance:reverse") };
  const today = () => businessToday(options.timeZone);

  /** The months of a house, with each one's price and what has been paid towards it. */
  app.get<{ Params: Params }>("/finance/households/:id/months", view, async (request) => {
    const query = parse(monthsQuery, request.query);
    const day = today();
    const thisMonth = firstOfMonth(day);
    const latest = addMonths(thisMonth, MONTHS_AHEAD);
    const to = query.to && query.to < latest ? query.to : latest;
    // Most payments are for months near this one; older ones are a tap away.
    const from = query.from ?? addMonths(thisMonth, -3);
    if (from > to || monthsBetween(from, to).length > 60) {
      throw new HttpError(400, "invalid_request", "Elija menos meses a la vez.");
    }
    if (!z.uuid().safeParse(request.params.id).success) {
      throw NO_HOUSEHOLD;
    }

    const household = householdOf(app.db, request.params.id);
    const start = owesFrom(app.db, household.id, options.timeZone).month;
    const rule = deadline(app.db, day);
    return {
      today: day,
      thisMonth,
      latestMonth: latest,
      household,
      months: monthStates(app.db, household.id, monthsBetween(from, to)),
      // Owed months older than the list, shown first, so they need no searching.
      owedBefore: owedMonths(app.db, household.id, start, addMonths(from, -1)).filter((state) =>
        isPastDeadline(state.month, day, rule),
      ),
    };
  });

  /**
   * What a house owes (owner, 13 November 2026): every month not paid in
   * full from its first entered payment, or the month it was registered if
   * earlier, whose payment deadline and grace days are over.
   */
  app.get<{ Params: Params }>("/finance/households/:id/owed", view, async (request) => {
    if (!z.uuid().safeParse(request.params.id).success) {
      throw NO_HOUSEHOLD;
    }
    const household = householdOf(app.db, request.params.id);
    const day = today();
    const thisMonth = firstOfMonth(day);
    const from = owesFrom(app.db, household.id, options.timeZone);
    const rule = deadline(app.db, day);
    // A month counts as owed only once its deadline and grace days are over.
    const unpaid = owedMonths(app.db, household.id, from.month, thisMonth);
    const owed = unpaid.filter((state) => isPastDeadline(state.month, day, rule));
    const waiting = unpaid.filter((state) => !isPastDeadline(state.month, day, rule));
    return {
      today: day,
      thisMonth,
      owesFrom: from,
      deadline: rule,
      months: owed,
      // Unpaid months still within their deadline or grace days (this month, or last month during its grace).
      dueSoon: waiting.map((state) => ({ ...state, ...monthDeadline(state.month, rule) })),
      totalCentavos: owed.reduce((sum, state) => sum + state.priceCentavos! - state.paidCentavos, 0),
    };
  });

  /** A house's payments, newest first. */
  app.get<{ Params: Params }>("/finance/households/:id/payments", view, async (request) => {
    if (!z.uuid().safeParse(request.params.id).success) {
      throw NO_HOUSEHOLD;
    }
    const household = householdOf(app.db, request.params.id);
    return { payments: paymentsOf(app.db, { householdId: household.id }) };
  });

  /** Registrar un pago de cuota mensual. */
  app.post("/finance/payments", record, async (request, reply) => {
    const body = parse(paymentBody, request.body);
    const actor = actorOf(request);
    const day = today();

    if (body.paymentMethod === "transfer" && !body.bankReference) {
      throw new HttpError(400, "invalid_request", "Escriba el número de referencia de la transferencia.");
    }
    if (body.occurredOn > day) {
      throw new HttpError(400, "invalid_request", "La fecha del pago no puede ser después de hoy.");
    }
    const selected = [...new Set(body.months)].sort();
    const latest = addMonths(firstOfMonth(day), MONTHS_AHEAD);
    if (selected.at(-1)! > latest) {
      throw new HttpError(400, "invalid_request", `Se puede pagar por adelantado hasta ${monthName(latest)}.`);
    }

    const result = inTransaction(app.db, (tx) => {
      // A retry of a payment that already arrived gets that payment back, not a second one.
      const earlier = tx
        .select({ id: transactions.id, householdId: transactions.householdId })
        .from(transactions)
        .where(eq(transactions.submissionId, body.submissionId))
        .get();
      if (earlier) {
        if (earlier.householdId !== body.householdId) {
          throw new HttpError(409, "submission_reused", "No se pudo completar. Intente de nuevo.");
        }
        return { created: false, payment: paymentsOf(tx, { id: earlier.id })[0]! };
      }

      const household = householdOf(tx, body.householdId);
      const allocation = allocatePayment(monthStates(tx, household.id, selected), body.amountCentavos);
      if ("problem" in allocation) {
        throw new HttpError(409, allocation.code, allocation.problem);
      }

      const repeated = tx
        .select({ code: households.code, occurredOn: transactions.occurredOn, amountCentavos: transactions.amountCentavos })
        .from(transactions)
        .leftJoin(households, eq(households.id, transactions.householdId))
        .where(
          and(
            eq(transactions.paperReceiptNumber, body.paperReceiptNumber),
            isNull(transactions.reversesId),
            sql`NOT EXISTS (SELECT 1 FROM transactions r WHERE r.reverses_id = ${transactions.id})`,
          ),
        )
        .orderBy(desc(transactions.createdAt))
        .get();
      // Flagged, not blocked: receipt books can start their numbering again.
      if (repeated && !body.confirmRepeatedReceipt) {
        throw new HttpError(
          409,
          "receipt_repeated",
          `El recibo nº ${body.paperReceiptNumber} ya se registró el ${formatCalendarDate(repeated.occurredOn)}` +
            `${repeated.code ? ` para la vivienda ${repeated.code}` : ""} (${formatLempiras(repeated.amountCentavos)}).`,
        );
      }

      const category = tx
        .select({ id: categories.id })
        .from(categories)
        .where(and(eq(categories.kind, "income"), eq(categories.name, MONTHLY_FEE_CATEGORY)))
        .get();
      if (!category) {
        throw new Error(`The income category "${MONTHLY_FEE_CATEGORY}" is missing`);
      }

      const id = newId();
      const payerName = body.payerName ?? household.ownerName;
      const coveredMonths = allocation.shares.map((share) => share.month);
      tx.insert(transactions)
        .values({
          id,
          kind: "income",
          categoryId: category.id,
          householdId: household.id,
          monthId: openMonthFor(tx, body.occurredOn),
          occurredOn: body.occurredOn,
          amountCentavos: body.amountCentavos,
          monthsCovered: coveredMonths,
          paymentMethod: body.paymentMethod,
          bankReference: body.paymentMethod === "transfer" ? body.bankReference : null,
          paperReceiptNumber: body.paperReceiptNumber,
          payerName,
          note: body.note,
          submissionId: body.submissionId,
          createdBy: actor.userId!,
        })
        .run();
      tx.insert(paymentMonths)
        .values(
          allocation.shares.map((share) => ({
            id: newId(),
            transactionId: id,
            householdId: household.id,
            month: share.month,
            amountCentavos: share.amountCentavos,
            priceCentavos: share.priceCentavos,
            createdBy: actor.userId!,
          })),
        )
        .run();

      const last = allocation.shares.at(-1)!;
      recordAudit(tx, actor, {
        area: "finances",
        action: "payment.recorded",
        summary:
          `${actor.name} (${actor.role}) registró un pago de ${formatLempiras(body.amountCentavos)} de ${payerName}` +
          ` por ${monthList(coveredMonths)}` +
          (last.paidInFull ? "" : ` (${monthName(last.month)} queda pendiente en parte)`) +
          `, vivienda ${household.code}, recibo nº ${body.paperReceiptNumber}` +
          (repeated ? " (número de recibo repetido)" : ""),
        entityType: "transaction",
        entityId: id,
        after: {
          householdId: household.id,
          amountCentavos: body.amountCentavos,
          shares: allocation.shares,
          occurredOn: body.occurredOn,
          paymentMethod: body.paymentMethod,
          paperReceiptNumber: body.paperReceiptNumber,
          repeatedReceipt: Boolean(repeated),
        },
      });
      return { created: true, payment: paymentsOf(tx, { id })[0]! };
    });

    return reply.code(result.created ? 201 : 200).send({ payment: result.payment });
  });

  /** Anular pago: a reversal entry for the whole payment, with its reason. */
  app.post<{ Params: Params }>("/finance/payments/:id/reverse", reverse, async (request) => {
    if (!z.uuid().safeParse(request.params.id).success) {
      throw NO_PAYMENT;
    }
    const body = parse(reverseBody, request.body);
    const actor = actorOf(request);
    const day = today();

    return inTransaction(app.db, (tx) => {
      const original = tx.select().from(transactions).where(eq(transactions.id, request.params.id)).get();
      // Only a monthly fee payment, never a reversal: a reversal is final.
      const [payment] = original && !original.reversesId ? paymentsOf(tx, { id: original.id }) : [];
      if (!original || !payment) {
        throw NO_PAYMENT;
      }
      if (payment.reversal) {
        throw new HttpError(
          409,
          "already_reversed",
          `Este pago ya se anuló el ${formatCalendarDate(payment.reversal.occurredOn)} (${payment.reversal.recordedBy}).`,
        );
      }
      const household = householdOf(tx, original.householdId!);

      const id = newId();
      tx.insert(transactions)
        .values({
          id,
          kind: original.kind,
          categoryId: original.categoryId,
          householdId: original.householdId,
          monthId: openMonthFor(tx, day, (first) => `El mes de ${monthName(first)} ya está cerrado.`),
          occurredOn: day,
          amountCentavos: -original.amountCentavos,
          monthsCovered: original.monthsCovered,
          // Kept so the reversal can be found beside its receipt in the paper book.
          paperReceiptNumber: original.paperReceiptNumber,
          payerName: original.payerName,
          reversesId: original.id,
          reason: body.reason,
          createdBy: actor.userId!,
        })
        .run();

      const covered = payment.shares.map((share) => share.month);
      recordAudit(tx, actor, {
        area: "finances",
        action: "payment.reversed",
        summary:
          `${actor.name} (${actor.role}) anuló el pago de ${formatLempiras(original.amountCentavos)}` +
          `${original.payerName ? ` de ${original.payerName}` : ""} por ${monthList(covered)}` +
          ` del ${formatCalendarDate(original.occurredOn)}, vivienda ${household.code}, recibo nº ${original.paperReceiptNumber}`,
        entityType: "transaction",
        entityId: original.id,
        before: {
          amountCentavos: original.amountCentavos,
          shares: payment.shares,
          occurredOn: original.occurredOn,
          paperReceiptNumber: original.paperReceiptNumber,
        },
        after: { reversalId: id, amountCentavos: -original.amountCentavos, occurredOn: day },
        reason: body.reason,
      });

      return { payment: paymentsOf(tx, { id: original.id })[0]! };
    });
  });
};
