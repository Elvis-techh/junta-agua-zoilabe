/**
 * What every money entry needs, whether a monthly fee payment (Cobrar) or
 * other income: the household it is for, the month row it belongs to, and
 * whether its paper receipt number was already used.
 */
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import type { DbOrTx, Tx } from "../db/client.js";
import { categories, householdOwners, households, months, people, transactions } from "../db/schema.js";
import { firstOfMonth, monthName } from "./fees.js";
import { HttpError } from "./http.js";

export const NO_HOUSEHOLD = new HttpError(404, "not_found", "No se encontró esa vivienda.");

/** The household and the name of the person it is registered to now. */
export function householdOf(tx: DbOrTx, id: string) {
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

/** The month row an entry dated `occurredOn` belongs to, made when its month has none yet. */
export function openMonthFor(
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

/** The id of an income category (src/db/seeding.ts); a missing one is a broken seed, not the user's mistake. */
export function incomeCategoryId(tx: DbOrTx, name: string): number {
  const category = tx
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.kind, "income"), eq(categories.name, name)))
    .get();
  if (!category) {
    throw new Error(`The income category "${name}" is missing`);
  }
  return category.id;
}

/**
 * When an entry `o` counts as using the same paper receipt as the entry the
 * columns describe: the same number, `o` not a reversal and not reversed,
 * and not the other line of one receipt. A house's monthly fee and its late
 * fee are often written on one receipt, the same day: entries of a
 * different category for the same house on the same day are not repeats.
 * Two entries of the same category still are, so a payment typed in twice
 * is still flagged.
 */
function usesSameReceipt(entry: { number: SQL | string; householdId: SQL | string | null; occurredOn: SQL | string; categoryId: SQL | number }): SQL {
  return sql`o.paper_receipt_number = ${entry.number}
    AND o.reverses_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM transactions r WHERE r.reverses_id = o.id)
    AND NOT (
      coalesce(o.household_id, '') = coalesce(${entry.householdId}, '')
      AND o.occurred_on = ${entry.occurredOn}
      AND o.category_id <> ${entry.categoryId}
    )`;
}

/** For a list of entries: whether another entry uses the same paper receipt (1 or 0). */
export const repeatedReceiptColumn = sql<number>`EXISTS (
  SELECT 1 FROM transactions o
  WHERE o.id <> ${transactions.id}
    AND ${usesSameReceipt({
      number: sql`${transactions.paperReceiptNumber}`,
      householdId: sql`${transactions.householdId}`,
      occurredOn: sql`${transactions.occurredOn}`,
      categoryId: sql`${transactions.categoryId}`,
    })}
)`;

/**
 * Before saving: the latest entry that already uses this paper receipt, or
 * null. Flagged, not blocked (App Plan, Data model): receipt books can start
 * their numbering again.
 */
export function earlierReceipt(
  tx: DbOrTx,
  entry: { number: string; householdId: string | null; occurredOn: string; categoryId: number },
): { code: string | null; occurredOn: string; amountCentavos: number } | null {
  const row = tx.get<{ id: string } | undefined>(sql`
    SELECT o.id AS id FROM transactions o
    WHERE ${usesSameReceipt(entry)}
    ORDER BY o.created_at DESC
    LIMIT 1
  `);
  if (!row) {
    return null;
  }
  return (
    tx
      .select({ code: households.code, occurredOn: transactions.occurredOn, amountCentavos: transactions.amountCentavos })
      .from(transactions)
      .leftJoin(households, eq(households.id, transactions.householdId))
      .where(eq(transactions.id, row.id))
      .orderBy(desc(transactions.createdAt))
      .get() ?? null
  );
}
