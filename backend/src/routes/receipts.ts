/**
 * Recibo digital: a receipt for one money-in entry (App Plan, Module 2:
 * "creates digital receipts on request"). The paper receipt the payer was
 * handed stays; this is the same payment as a picture to send by WhatsApp,
 * made only when someone asks for one.
 *
 * A receipt is for a monthly fee payment (Cobrar) or any other income
 * (a late fee, a reconnection, a connection, a donation, other) — money the
 * family handed over (owner, 16 November 2026). An expense has no resident
 * receipt. A payment that was undone has none either: its "Anulado" stands,
 * and a reversal is not a receipt of its own.
 *
 * Like a statement (src/routes/statements.ts), looking at it changes nothing;
 * handing it out takes the next document number, is logged under exports, and
 * is drawn and sent on the phone. The number is the one running count every
 * document shares.
 */
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { actorOf } from "../auth/plugin.js";
import type { DbOrTx } from "../db/client.js";
import { inTransaction } from "../db/client.js";
import { categories, documents, householdOwners, households, paymentMonths, people, sectors, transactions, users } from "../db/schema.js";
import { recordAudit } from "../lib/audit.js";
import { HttpError, parse } from "../lib/http.js";
import { businessToday } from "../lib/time.js";
import { INCOME_TYPES } from "./income.js";
import type { IncomeType } from "./income.js";

/** The income category a monthly fee payment is recorded under (src/db/seeding.ts). */
const MONTHLY_FEE_CATEGORY = "Cuota mensual";

/** Category name → the kind of other income it is, for the ones Otro ingreso uses. */
const TYPE_OF_CATEGORY = new Map(Object.entries(INCOME_TYPES).map(([type, name]) => [name as string, type as IncomeType]));

type Params = { id: string };

const NO_RECEIPT = new HttpError(404, "not_found", "No se encontró ese pago.");

/** What a receipt is for: a monthly fee and its months, or another income and its month. */
export type Concept = { kind: "monthly"; months: string[] } | { kind: "other"; type: IncomeType; month: string | null; note: string | null };

/** A money-in entry as a receipt, or throws when there is none to make. */
export function receiptOf(db: DbOrTx, transactionId: string, today: string) {
  const row = db
    .select({
      id: transactions.id,
      kind: transactions.kind,
      categoryName: categories.name,
      householdId: transactions.householdId,
      occurredOn: transactions.occurredOn,
      amountCentavos: transactions.amountCentavos,
      monthsCovered: transactions.monthsCovered,
      paymentMethod: transactions.paymentMethod,
      bankReference: transactions.bankReference,
      paperReceiptNumber: transactions.paperReceiptNumber,
      payerName: transactions.payerName,
      note: transactions.note,
      reversesId: transactions.reversesId,
      recordedBy: users.name,
      reversed: sql<number>`EXISTS (SELECT 1 FROM transactions r WHERE r.reverses_id = ${transactions.id})`,
    })
    .from(transactions)
    .innerJoin(categories, eq(categories.id, transactions.categoryId))
    .innerJoin(users, eq(users.id, transactions.createdBy))
    .where(eq(transactions.id, transactionId))
    .get();

  // An expense, a reversal, or nothing: there is no resident receipt to make.
  if (!row || row.kind !== "income" || row.reversesId !== null) {
    throw NO_RECEIPT;
  }
  if (row.reversed) {
    throw new HttpError(409, "reversed", "Ese pago se anuló: no se puede hacer un recibo de un pago anulado.");
  }

  const concept: Concept =
    row.categoryName === MONTHLY_FEE_CATEGORY
      ? {
          kind: "monthly",
          months: db
            .select({ month: paymentMonths.month })
            .from(paymentMonths)
            .where(eq(paymentMonths.transactionId, row.id))
            .orderBy(asc(paymentMonths.month))
            .all()
            .map((share) => share.month),
        }
      : { kind: "other", type: TYPE_OF_CATEGORY.get(row.categoryName) ?? "other", month: row.monthsCovered?.[0] ?? null, note: row.note };

  const household = row.householdId
    ? (db
        .select({ code: households.code, ownerName: people.fullName, sectorName: sectors.name })
        .from(households)
        .innerJoin(householdOwners, and(eq(householdOwners.householdId, households.id), isNull(householdOwners.endsOn)))
        .innerJoin(people, eq(people.id, householdOwners.personId))
        .innerJoin(sectors, eq(sectors.id, households.sectorId))
        .where(eq(households.id, row.householdId))
        .get() ?? null)
    : null;

  return {
    today,
    transactionId: row.id,
    householdId: row.householdId,
    household,
    payerName: row.payerName,
    occurredOn: row.occurredOn,
    amountCentavos: row.amountCentavos,
    paymentMethod: row.paymentMethod,
    bankReference: row.bankReference,
    paperReceiptNumber: row.paperReceiptNumber,
    concept,
  };
}

/** The receipt's one-line "what for", for the history entry. */
function conceptSummary(concept: Concept): string {
  if (concept.kind === "monthly") {
    return "una cuota mensual";
  }
  return concept.type === "other" && concept.note ? concept.note : "otro ingreso";
}

export const receiptRoutes: FastifyPluginAsync<{ timeZone: string }> = async (app, options) => {
  const view = { preHandler: app.requirePermission("finance:view") };
  const hand = { preHandler: app.requirePermission("export:finance") };
  const today = () => businessToday(options.timeZone);

  /** A money-in entry as a receipt, to look at. */
  app.get<{ Params: Params }>("/finance/receipts/:id", view, async (request) => {
    if (!z.uuid().safeParse(request.params.id).success) {
      throw NO_RECEIPT;
    }
    return { receipt: receiptOf(app.db, request.params.id, today()) };
  });

  /** Hand out a receipt: it takes the next document number and is logged. */
  app.post<{ Params: Params }>("/finance/receipts/:id", hand, async (request, reply) => {
    if (!z.uuid().safeParse(request.params.id).success) {
      throw NO_RECEIPT;
    }
    const actor = actorOf(request);
    const day = today();

    const result = inTransaction(app.db, (tx) => {
      const receipt = receiptOf(tx, request.params.id, day);
      const document = tx
        .insert(documents)
        .values({
          kind: "receipt",
          householdId: receipt.householdId,
          details: { transactionId: receipt.transactionId, amountCentavos: receipt.amountCentavos, paperReceiptNumber: receipt.paperReceiptNumber },
          createdBy: actor.userId!,
        })
        .returning({ id: documents.id, createdAt: documents.createdAt })
        .get()!;

      recordAudit(tx, actor, {
        area: "exports",
        action: "receipt.issued",
        summary:
          `${actor.name} (${actor.role}) hizo el recibo nº ${document.id} de ${conceptSummary(receipt.concept)}: ` +
          `${receipt.payerName ?? ""}${receipt.household ? `, vivienda ${receipt.household.code}` : ""}, recibo de papel nº ${receipt.paperReceiptNumber}`,
        entityType: "document",
        entityId: String(document.id),
        after: {
          kind: "receipt",
          transactionId: receipt.transactionId,
          householdCode: receipt.household?.code ?? null,
          amountCentavos: receipt.amountCentavos,
          paperReceiptNumber: receipt.paperReceiptNumber,
        },
      });

      return { receipt, document: { number: document.id, madeAt: document.createdAt, madeBy: actor.name } };
    });

    return reply.code(201).send(result);
  });
};
