/**
 * Otro ingreso: money in that is not a monthly fee (App Plan, Module 2,
 * "Income: other"): a late fee (mora) and the month it covers, a
 * reconnection fee, a connection fee, a donation, or other income. Each is
 * one permanent entry in `transactions`, under its income category, with
 * who paid, the amount and the paper receipt's number, like a monthly fee
 * payment but with no months to share it among.
 *
 * The rules:
 *
 *  - A late fee is recorded under "Mora" with the month it covers in
 *    `months_covered`, and a reconnection under "Reconexión" on the day it is
 *    paid: the fee checks in Configuración look for them there
 *    (src/lib/fees.ts, `paidMonthsAt`).
 *  - Their amount is the one in Configuración, the late fee for the month it
 *    covers and the reconnection fee for the day it is paid; another amount
 *    needs a written reason (Module 2). A late fee is charged only where the
 *    paper book shows one (owner, 13 November 2026): the treasurer records
 *    it, the app does not charge it by itself.
 *  - A house's late fee for a month is recorded once. A second one is
 *    refused, so the same receipt line cannot be typed in twice.
 *  - A late fee and a reconnection are for a house; a connection fee, a
 *    donation or other income may be for a house or for nobody in the census,
 *    and then says who paid. Other income says what it is.
 *  - A mistake is fixed as a payment is ("Anular"): a reversal entry with the
 *    opposite amount, dated today, pointing to the original, with a reason.
 *    Only the whole entry, at any time, and a reversal is final (owner,
 *    7 November 2026).
 */
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { actorOf } from "../auth/plugin.js";
import { newId } from "../auth/session.js";
import type { DbOrTx } from "../db/client.js";
import { inTransaction } from "../db/client.js";
import { categories, feeRates, households, transactions, users } from "../db/schema.js";
import { recordAudit } from "../lib/audit.js";
import { formatLempiras } from "../lib/census.js";
import { earlierReceipt, householdOf, incomeCategoryId, openMonthFor, repeatedReceiptColumn } from "../lib/entries.js";
import { firstOfMonth, monthName } from "../lib/fees.js";
import { HttpError, parse } from "../lib/http.js";
import { feeOn } from "../lib/settings.js";
import { businessToday, formatCalendarDate } from "../lib/time.js";

/** Each kind of other income, and the income category it is recorded under (src/db/seeding.ts). */
export const INCOME_TYPES = {
  late_fee: "Mora",
  reconnection: "Reconexión",
  connection: "Conexión",
  donation: "Donación",
  other: "Otro ingreso",
} as const;

export type IncomeType = keyof typeof INCOME_TYPES;

const TYPE_OF_CATEGORY = new Map(Object.entries(INCOME_TYPES).map(([type, name]) => [name as string, type as IncomeType]));

/** How each kind is named in a sentence: "la mora de octubre de 2026", "la reconexión". */
const IN_A_SENTENCE: Record<IncomeType, string> = {
  late_fee: "la mora",
  reconnection: "la reconexión",
  connection: "la conexión",
  donation: "la donación",
  other: "el ingreso",
};

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-01$/, "Elija el mes de la mora.");
const day = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "Elija la fecha del pago.");
const optionalText = (max: number, tooLong: string) =>
  z
    .string()
    .trim()
    .max(max, tooLong)
    .optional()
    .transform((value) => (value ? value : null));

const incomeBody = z.object({
  submissionId: z.uuid(),
  type: z.enum(Object.keys(INCOME_TYPES) as [IncomeType, ...IncomeType[]], { message: "Elija qué ingreso es." }),
  householdId: z.uuid({ message: "Elija la vivienda." }).optional(),
  /** The month a late fee covers. */
  month: month.optional(),
  amountCentavos: z
    .number({ message: "Escriba el monto que se pagó." })
    .int("Escriba el monto en lempiras, por ejemplo 50 o 50.50.")
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
  /** Why a late fee or reconnection is not the amount in Configuración. */
  amountReason: optionalText(300, "El motivo es demasiado largo."),
  confirmRepeatedReceipt: z.boolean().optional(),
});

const reverseBody = z.object({
  reason: z
    .string({ message: "Escriba por qué se anula." })
    .trim()
    .min(5, "Escriba por qué se anula.")
    .max(300, "El motivo es demasiado largo."),
});

const listQuery = z.object({ householdId: z.uuid({ message: "No se encontró esa vivienda." }).optional() });

type Params = { id: string };

const NO_ENTRY = new HttpError(404, "not_found", "No se encontró ese ingreso.");

/** How many entries a list shows: a house's, or the latest of everyone's. */
const LIST_LIMIT = 30;

/** The ids of the income categories other income uses. */
function otherIncomeCategoryIds(tx: DbOrTx): Map<number, IncomeType> {
  const rows = tx
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .where(and(eq(categories.kind, "income"), inArray(categories.name, Object.values(INCOME_TYPES))))
    .all();
  return new Map(rows.map((row) => [row.id, TYPE_OF_CATEGORY.get(row.name)!]));
}

/** Other income entries, newest first: a house's, one by id, or the latest of everyone's. Reversals are not listed. */
function entriesOf(tx: DbOrTx, where: { householdId: string } | { id: string } | { latest: true }) {
  const types = otherIncomeCategoryIds(tx);
  const rows = tx
    .select({
      id: transactions.id,
      categoryId: transactions.categoryId,
      householdId: transactions.householdId,
      householdCode: households.code,
      occurredOn: transactions.occurredOn,
      amountCentavos: transactions.amountCentavos,
      monthsCovered: transactions.monthsCovered,
      paymentMethod: transactions.paymentMethod,
      bankReference: transactions.bankReference,
      paperReceiptNumber: transactions.paperReceiptNumber,
      payerName: transactions.payerName,
      note: transactions.note,
      amountReason: transactions.reason,
      recordedBy: users.name,
      createdAt: transactions.createdAt,
      repeatedReceipt: repeatedReceiptColumn,
    })
    .from(transactions)
    .innerJoin(users, eq(users.id, transactions.createdBy))
    .leftJoin(households, eq(households.id, transactions.householdId))
    .where(
      and(
        inArray(transactions.categoryId, [...types.keys()]),
        isNull(transactions.reversesId),
        "id" in where
          ? eq(transactions.id, where.id)
          : "householdId" in where
            ? eq(transactions.householdId, where.householdId)
            : undefined,
      ),
    )
    .orderBy(desc(transactions.occurredOn), desc(transactions.createdAt))
    .limit("id" in where ? 1 : LIST_LIMIT)
    .all();

  return rows.map(({ categoryId, monthsCovered, ...row }) => {
    const reversal = reversalOf(tx, row.id);
    return {
      ...row,
      type: types.get(categoryId)!,
      /** The month a late fee covers. */
      month: monthsCovered?.[0] ?? null,
      repeatedReceipt: Boolean(row.repeatedReceipt),
      reversed: reversal !== null,
      reversal,
    };
  });
}

/** The entry that reversed this one, if one did: when, by whom and why. */
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

/** "la mora de octubre de 2026", "la reconexión": what an entry is, for a sentence. */
function described(type: IncomeType, coveredMonth: string | null): string {
  return type === "late_fee" && coveredMonth ? `${IN_A_SENTENCE[type]} de ${monthName(coveredMonth)}` : IN_A_SENTENCE[type];
}

export const incomeRoutes: FastifyPluginAsync<{ timeZone: string }> = async (app, options) => {
  const view = { preHandler: app.requirePermission("finance:view") };
  const record = { preHandler: app.requirePermission("finance:record") };
  const reverse = { preHandler: app.requirePermission("finance:reverse") };
  const today = () => businessToday(options.timeZone);

  /**
   * What the screen needs before it asks anything: today, and the late fee
   * and reconnection fee amounts with the month each starts, so it can fill
   * in the amount for the month or day chosen. The server checks it again.
   */
  app.get("/finance/income/setup", record, async () => {
    const rates = app.db
      .select({ kind: feeRates.kind, startsOn: feeRates.startsOn, amountCentavos: feeRates.amountCentavos })
      .from(feeRates)
      .where(and(inArray(feeRates.kind, ["late_fee", "reconnection"]), isNull(feeRates.removedAt)))
      .orderBy(feeRates.startsOn)
      .all();
    const of = (kind: "late_fee" | "reconnection") =>
      rates.filter((rate) => rate.kind === kind).map(({ startsOn, amountCentavos }) => ({ startsOn, amountCentavos }));
    return { today: today(), lateFee: of("late_fee"), reconnection: of("reconnection") };
  });

  /** Other income, newest first: a house's, or the latest of everyone's. */
  app.get("/finance/income", view, async (request) => {
    const query = parse(listQuery, request.query);
    if (query.householdId) {
      householdOf(app.db, query.householdId);
      return { entries: entriesOf(app.db, { householdId: query.householdId }) };
    }
    return { entries: entriesOf(app.db, { latest: true }) };
  });

  /** Registrar otro ingreso. */
  app.post("/finance/income", record, async (request, reply) => {
    const body = parse(incomeBody, request.body);
    const actor = actorOf(request);
    const day = today();
    const forAHouse = body.type === "late_fee" || body.type === "reconnection";

    if (body.paymentMethod === "transfer" && !body.bankReference) {
      throw new HttpError(400, "invalid_request", "Escriba el número de referencia de la transferencia.");
    }
    if (body.occurredOn > day) {
      throw new HttpError(400, "invalid_request", "La fecha del pago no puede ser después de hoy.");
    }
    if (forAHouse && !body.householdId) {
      throw new HttpError(400, "invalid_request", "Elija la vivienda.");
    }
    if (!body.householdId && !body.payerName) {
      throw new HttpError(400, "invalid_request", "Escriba el nombre de quien pagó.");
    }
    if (body.type === "other" && !body.note) {
      throw new HttpError(400, "invalid_request", "Escriba de qué es el ingreso.");
    }
    const coveredMonth = body.type === "late_fee" ? (body.month ?? null) : null;
    if (body.type === "late_fee") {
      if (!coveredMonth) {
        throw new HttpError(400, "invalid_request", "Elija el mes de la mora.");
      }
      if (coveredMonth > firstOfMonth(body.occurredOn)) {
        throw new HttpError(400, "invalid_request", "La mora es de un mes que ya llegó: elija ese mes o uno anterior a la fecha del pago.");
      }
    }

    /**
     * A late fee or reconnection costs what Configuración says, unless the
     * treasurer says why not. Returns the reason kept, or null. Read inside
     * the transaction, so a fee change cannot slip in between.
     */
    const amountReasonFor = (tx: DbOrTx): string | null => {
      const kind = body.type === "late_fee" ? "late_fee" : body.type === "reconnection" ? "reconnection" : null;
      if (!kind) {
        return null;
      }
      const what = described(body.type, coveredMonth);
      const set = feeOn(tx, kind, kind === "late_fee" ? coveredMonth! : body.occurredOn);
      if (set === null) {
        throw new HttpError(409, "no_fee", `No hay monto para ${what} en Configuración → Cuotas. Pida que lo pongan.`);
      }
      if (set === 0) {
        throw new HttpError(409, "not_charged", `${capitalize(what)} es de L 0.00 en Configuración: no se cobra.`);
      }
      if (body.amountCentavos === set) {
        return null;
      }
      if (!body.amountReason || body.amountReason.length < 5) {
        throw new HttpError(
          400,
          "amount_reason",
          `${capitalize(what)} es de ${formatLempiras(set)} en Configuración. Si se cobró otro monto, escriba por qué.`,
        );
      }
      return body.amountReason;
    };

    const result = inTransaction(app.db, (tx) => {
      // A retry of an entry that already arrived gets that entry back, not a second one.
      const earlier = tx
        .select({ id: transactions.id, householdId: transactions.householdId })
        .from(transactions)
        .where(eq(transactions.submissionId, body.submissionId))
        .get();
      if (earlier) {
        const [entry] = entriesOf(tx, { id: earlier.id });
        if (!entry || (earlier.householdId ?? null) !== (body.householdId ?? null)) {
          throw new HttpError(409, "submission_reused", "No se pudo completar. Intente de nuevo.");
        }
        return { created: false, entry };
      }

      const household = body.householdId ? householdOf(tx, body.householdId) : null;
      const categoryId = incomeCategoryId(tx, INCOME_TYPES[body.type]);
      const amountReason = amountReasonFor(tx);

      if (coveredMonth && household) {
        const already = tx
          .select({ occurredOn: transactions.occurredOn, paperReceiptNumber: transactions.paperReceiptNumber, monthsCovered: transactions.monthsCovered })
          .from(transactions)
          .where(
            and(
              eq(transactions.householdId, household.id),
              eq(transactions.categoryId, categoryId),
              isNull(transactions.reversesId),
              sql`NOT EXISTS (SELECT 1 FROM transactions r WHERE r.reverses_id = ${transactions.id})`,
            ),
          )
          .all()
          .find((entry) => entry.monthsCovered?.includes(coveredMonth));
        if (already) {
          throw new HttpError(
            409,
            "late_fee_repeated",
            `La mora de ${monthName(coveredMonth)} de la vivienda ${household.code} ya se registró el ` +
              `${formatCalendarDate(already.occurredOn)} (recibo nº ${already.paperReceiptNumber}).`,
          );
        }
      }

      const repeated = earlierReceipt(tx, {
        number: body.paperReceiptNumber,
        householdId: household?.id ?? null,
        occurredOn: body.occurredOn,
        categoryId,
      });
      // Flagged, not blocked: receipt books can start their numbering again.
      if (repeated && !body.confirmRepeatedReceipt) {
        throw new HttpError(
          409,
          "receipt_repeated",
          `El recibo nº ${body.paperReceiptNumber} ya se registró el ${formatCalendarDate(repeated.occurredOn)}` +
            `${repeated.code ? ` para la vivienda ${repeated.code}` : ""} (${formatLempiras(repeated.amountCentavos)}).`,
        );
      }

      const id = newId();
      const payerName = body.payerName ?? household!.ownerName;
      tx.insert(transactions)
        .values({
          id,
          kind: "income",
          categoryId,
          householdId: household?.id ?? null,
          monthId: openMonthFor(tx, body.occurredOn),
          occurredOn: body.occurredOn,
          amountCentavos: body.amountCentavos,
          monthsCovered: coveredMonth ? [coveredMonth] : null,
          paymentMethod: body.paymentMethod,
          bankReference: body.paymentMethod === "transfer" ? body.bankReference : null,
          paperReceiptNumber: body.paperReceiptNumber,
          payerName,
          note: body.note,
          reason: amountReason,
          submissionId: body.submissionId,
          createdBy: actor.userId!,
        })
        .run();

      recordAudit(tx, actor, {
        area: "finances",
        action: "income.recorded",
        summary:
          `${actor.name} (${actor.role}) registró ${described(body.type, coveredMonth)}: ${formatLempiras(body.amountCentavos)} de ${payerName}` +
          (household ? `, vivienda ${household.code}` : "") +
          `, recibo nº ${body.paperReceiptNumber}` +
          (amountReason ? " (otro monto que el de Configuración)" : "") +
          (repeated ? " (número de recibo repetido)" : ""),
        entityType: "transaction",
        entityId: id,
        after: {
          type: body.type,
          householdId: household?.id ?? null,
          month: coveredMonth,
          amountCentavos: body.amountCentavos,
          occurredOn: body.occurredOn,
          paymentMethod: body.paymentMethod,
          paperReceiptNumber: body.paperReceiptNumber,
          payerName,
          repeatedReceipt: Boolean(repeated),
        },
        reason: amountReason,
      });
      return { created: true, entry: entriesOf(tx, { id })[0]! };
    });

    return reply.code(result.created ? 201 : 200).send({ entry: result.entry });
  });

  /** Anular: a reversal entry for the whole entry, with its reason. */
  app.post<{ Params: Params }>("/finance/income/:id/reverse", reverse, async (request) => {
    if (!z.uuid().safeParse(request.params.id).success) {
      throw NO_ENTRY;
    }
    const body = parse(reverseBody, request.body);
    const actor = actorOf(request);
    const day = today();

    return inTransaction(app.db, (tx) => {
      // Only other income, never a reversal: a reversal is final.
      const [entry] = entriesOf(tx, { id: request.params.id });
      if (!entry) {
        throw NO_ENTRY;
      }
      if (entry.reversal) {
        throw new HttpError(
          409,
          "already_reversed",
          `Este ingreso ya se anuló el ${formatCalendarDate(entry.reversal.occurredOn)} (${entry.reversal.recordedBy}).`,
        );
      }
      const original = tx.select().from(transactions).where(eq(transactions.id, entry.id)).get()!;

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

      recordAudit(tx, actor, {
        area: "finances",
        action: "income.reversed",
        summary:
          `${actor.name} (${actor.role}) anuló ${described(entry.type, entry.month)}: ${formatLempiras(original.amountCentavos)}` +
          `${original.payerName ? ` de ${original.payerName}` : ""} del ${formatCalendarDate(original.occurredOn)}` +
          (entry.householdCode ? `, vivienda ${entry.householdCode}` : "") +
          `, recibo nº ${original.paperReceiptNumber}`,
        entityType: "transaction",
        entityId: original.id,
        before: {
          type: entry.type,
          month: entry.month,
          amountCentavos: original.amountCentavos,
          occurredOn: original.occurredOn,
          paperReceiptNumber: original.paperReceiptNumber,
        },
        after: { reversalId: id, amountCentavos: -original.amountCentavos, occurredOn: day },
        reason: body.reason,
      });

      return { entry: entriesOf(tx, { id: original.id })[0]! };
    });
  });
};

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
