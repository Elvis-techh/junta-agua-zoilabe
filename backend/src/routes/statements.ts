/**
 * Estado de cuenta: a house's statement (App Plan, Module 5, "Household
 * statement"), for the treasurer to send to the family by WhatsApp or hand
 * over on paper.
 *
 * It says what the house paid from a month the treasurer chooses (owner,
 * 15 November 2026) and what it owes today, in full: the same months and
 * late fees as "Lo que debe" in its file (src/lib/payments.ts,
 * src/lib/lateFees.ts). Nothing is worked out differently here, so the
 * statement and the screens can never disagree.
 *
 * A payment that was undone ("Anulado") is not on it, nor is its reversal:
 * the family sees what stands.
 *
 * Looking at a statement changes nothing. Handing one out does: it takes
 * the next document number, and is in Historial under Exportaciones (App
 * Plan: "every printout carries … a document number. Every export is
 * logged").
 */
import { and, asc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { actorOf } from "../auth/plugin.js";
import type { DbOrTx } from "../db/client.js";
import { inTransaction } from "../db/client.js";
import { categories, documents, paymentMonths, sectors, households, transactions } from "../db/schema.js";
import { recordAudit } from "../lib/audit.js";
import { NO_HOUSEHOLD, householdOf } from "../lib/entries.js";
import { firstOfMonth, monthName } from "../lib/fees.js";
import { HttpError, parse } from "../lib/http.js";
import { lateFeesOf, owedNow } from "../lib/lateFees.js";
import { addMonths } from "../lib/payments.js";
import { businessToday } from "../lib/time.js";
import { INCOME_TYPES } from "./income.js";
import type { IncomeType } from "./income.js";

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-01$/, "Elija desde qué mes.");
const statementQuery = z.object({ from: month.optional() });
const issueBody = z.object({ from: month });

type Params = { id: string };

/** How far back a statement may start: the paper book's years can be typed in, but not a mistyped century. */
const OLDEST_YEARS = 30;

const TYPE_OF_CATEGORY = new Map(Object.entries(INCOME_TYPES).map(([type, name]) => [name as string, type as IncomeType]));

/** Not reversed, and not a reversal: an entry that stands. */
const stands = and(
  isNull(transactions.reversesId),
  sql`NOT EXISTS (SELECT 1 FROM transactions r WHERE r.reverses_id = ${transactions.id})`,
);

/** A house's statement on `day`: what it paid from the month `from`, and what it owes. */
export function statementOf(db: DbOrTx, householdId: string, from: string, day: string, timeZone: string) {
  const household = householdOf(db, householdId);
  const sector = db
    .select({ name: sectors.name })
    .from(households)
    .innerJoin(sectors, eq(sectors.id, households.sectorId))
    .where(eq(households.id, household.id))
    .get();

  // Monthly fee payments: the entries shared among months.
  const payments = db
    .select({
      id: transactions.id,
      occurredOn: transactions.occurredOn,
      amountCentavos: transactions.amountCentavos,
      paperReceiptNumber: transactions.paperReceiptNumber,
    })
    .from(transactions)
    .innerJoin(paymentMonths, eq(paymentMonths.transactionId, transactions.id))
    .where(and(eq(transactions.householdId, household.id), gte(transactions.occurredOn, from), stands))
    .groupBy(transactions.id)
    .orderBy(asc(transactions.occurredOn), asc(transactions.createdAt))
    .all()
    .map((payment) => ({
      ...payment,
      months: db
        .select({ month: paymentMonths.month })
        .from(paymentMonths)
        .where(eq(paymentMonths.transactionId, payment.id))
        .orderBy(paymentMonths.month)
        .all()
        .map((share) => share.month),
    }));

  // Late fees, reconnections and whatever else this house paid.
  const otherIncome = db
    .select({
      id: transactions.id,
      category: categories.name,
      occurredOn: transactions.occurredOn,
      amountCentavos: transactions.amountCentavos,
      paperReceiptNumber: transactions.paperReceiptNumber,
      monthsCovered: transactions.monthsCovered,
      note: transactions.note,
    })
    .from(transactions)
    .innerJoin(categories, eq(categories.id, transactions.categoryId))
    .where(
      and(
        eq(transactions.householdId, household.id),
        eq(categories.kind, "income"),
        inArray(categories.name, Object.values(INCOME_TYPES)),
        gte(transactions.occurredOn, from),
        stands,
      ),
    )
    .orderBy(asc(transactions.occurredOn), asc(transactions.createdAt))
    .all()
    .map(({ category, monthsCovered, ...entry }) => ({
      ...entry,
      type: TYPE_OF_CATEGORY.get(category)!,
      /** The month a late fee covers. */
      month: monthsCovered?.[0] ?? null,
    }));

  const owedMonths = owedNow(db, household.id, day, timeZone).map((state) => ({
    month: state.month,
    owedCentavos: state.priceCentavos! - state.paidCentavos,
  }));
  const lateFees = lateFeesOf(db, household.id, day, timeZone).months;
  const monthsTotal = owedMonths.reduce((sum, state) => sum + state.owedCentavos, 0);
  const lateFeesTotal = lateFees.reduce((sum, fee) => sum + fee.amountCentavos, 0);

  return {
    today: day,
    from,
    household: { id: household.id, code: household.code, ownerName: household.ownerName, sectorName: sector?.name ?? null },
    payments,
    otherIncome,
    paidCentavos:
      payments.reduce((sum, payment) => sum + payment.amountCentavos, 0) +
      otherIncome.reduce((sum, entry) => sum + entry.amountCentavos, 0),
    owed: {
      months: owedMonths,
      lateFees,
      monthsCentavos: monthsTotal,
      lateFeesCentavos: lateFeesTotal,
      totalCentavos: monthsTotal + lateFeesTotal,
    },
  };
}

export const statementRoutes: FastifyPluginAsync<{ timeZone: string }> = async (app, options) => {
  const view = { preHandler: app.requirePermission("finance:view") };
  const hand = { preHandler: app.requirePermission("export:finance") };
  const today = () => businessToday(options.timeZone);

  /** The month a statement starts in, checked: not after this month, and not absurdly old. */
  const startOf = (from: string | undefined, day: string): string => {
    const thisMonth = firstOfMonth(day);
    const start = from ?? `${day.slice(0, 4)}-01-01`;
    if (start > thisMonth) {
      throw new HttpError(400, "invalid_request", "Elija este mes o uno anterior.");
    }
    if (start < addMonths(thisMonth, -12 * OLDEST_YEARS)) {
      throw new HttpError(400, "invalid_request", "Elija un mes más reciente.");
    }
    return start;
  };

  /** A house's statement, to look at. From January of this year unless `from` says otherwise. */
  app.get<{ Params: Params }>("/finance/households/:id/statement", view, async (request) => {
    if (!z.uuid().safeParse(request.params.id).success) {
      throw NO_HOUSEHOLD;
    }
    const query = parse(statementQuery, request.query);
    const day = today();
    return { statement: statementOf(app.db, request.params.id, startOf(query.from, day), day, options.timeZone) };
  });

  /**
   * Hand out a house's statement: it takes the next document number and is
   * logged, and comes back with who made it and when, to be drawn and sent.
   */
  app.post<{ Params: Params }>("/finance/households/:id/statement", hand, async (request, reply) => {
    if (!z.uuid().safeParse(request.params.id).success) {
      throw NO_HOUSEHOLD;
    }
    const body = parse(issueBody, request.body);
    const actor = actorOf(request);
    const day = today();
    const from = startOf(body.from, day);

    const result = inTransaction(app.db, (tx) => {
      const statement = statementOf(tx, request.params.id, from, day, options.timeZone);
      const document = tx
        .insert(documents)
        .values({
          kind: "household_statement",
          householdId: statement.household.id,
          details: { from, madeOn: day, paidCentavos: statement.paidCentavos, owedCentavos: statement.owed.totalCentavos },
          createdBy: actor.userId!,
        })
        .returning({ id: documents.id, createdAt: documents.createdAt })
        .get()!;

      recordAudit(tx, actor, {
        area: "exports",
        action: "statement.issued",
        summary:
          `${actor.name} (${actor.role}) hizo el estado de cuenta nº ${document.id} de la vivienda ${statement.household.code}` +
          ` (${statement.household.ownerName}), desde ${monthName(from)}`,
        entityType: "document",
        entityId: String(document.id),
        after: {
          kind: "household_statement",
          householdId: statement.household.id,
          from,
          madeOn: day,
          paidCentavos: statement.paidCentavos,
          owedCentavos: statement.owed.totalCentavos,
        },
      });

      return { statement, document: { number: document.id, madeAt: document.createdAt, madeBy: actor.name } };
    });

    return reply.code(201).send(result);
  });
};
