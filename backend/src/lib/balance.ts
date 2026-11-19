/**
 * The board's money (owner, 17 November 2026): the opening balance, and
 * what every entry since its month added or took away.
 *
 *  - Two places: the cash in the box (Efectivo) and the bank
 *    (Transferencia). An entry paid "Otro" counts on a line of its own, so
 *    it is never mixed into the cash that is counted at month close.
 *  - Only entries dated in the opening balance's month or later count.
 *    Earlier ones were typed in from the paper book: that money is already
 *    inside the opening balance, and they count only for what each house
 *    owes.
 *  - A reversal counts where the entry it undoes counted: by that entry's
 *    way of paying (a reversal does not repeat it), and not at all when
 *    that entry was from before the opening balance.
 *  - Each closed month puts the cash right: from then on it counts from the
 *    cash counted, not from the app's figure (owner, 19 November 2026).
 */
import { and, desc, eq, gte, inArray, isNull, lt } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import type { DbOrTx } from "../db/client.js";
import { categories, months, openingBalances, transactions, users } from "../db/schema.js";

export type MoneyPlace = "cash" | "bank" | "other";

export interface Money {
  cashCentavos: number;
  bankCentavos: number;
  otherCentavos: number;
}

/** Where an entry's money is, from how it was paid. */
export function placeOf(paymentMethod: string | null): MoneyPlace {
  return paymentMethod === "cash" ? "cash" : paymentMethod === "transfer" ? "bank" : "other";
}

/** Every opening balance entry, newest first, with who entered it. */
export function openingEntries(db: DbOrTx) {
  return db
    .select({
      id: openingBalances.id,
      month: openingBalances.month,
      cashCentavos: openingBalances.cashCentavos,
      bankCentavos: openingBalances.bankCentavos,
      replacesId: openingBalances.replacesId,
      reason: openingBalances.reason,
      createdAt: openingBalances.createdAt,
      createdBy: users.name,
    })
    .from(openingBalances)
    .leftJoin(users, eq(users.id, openingBalances.createdBy))
    .orderBy(desc(openingBalances.createdAt))
    .all();
}

/** The opening balance in force: the entry no later one replaces, or null before it is entered. */
export function openingBalance(db: DbOrTx) {
  const replacer = alias(openingBalances, "replacer");
  return (
    db
      .select({
        id: openingBalances.id,
        month: openingBalances.month,
        cashCentavos: openingBalances.cashCentavos,
        bankCentavos: openingBalances.bankCentavos,
      })
      .from(openingBalances)
      .leftJoin(replacer, eq(replacer.replacesId, openingBalances.id))
      .where(isNull(replacer.id))
      .get() ?? null
  );
}

/** The first closed month, or null while none is. */
export function firstClosedMonth(db: DbOrTx): string | null {
  return db.select({ month: months.month }).from(months).where(eq(months.status, "closed")).orderBy(months.month).get()?.month ?? null;
}

/**
 * The first month whose close has begun, prepared or closed. From then on
 * the opening balance cannot be corrected (owner, 17 November 2026): every
 * close counts from it, and a prepared month's figures must not change
 * under the person who approves them.
 */
export function firstLockedMonth(db: DbOrTx): { month: string; status: "prepared" | "closed" } | null {
  const row = db
    .select({ month: months.month, status: months.status })
    .from(months)
    .where(inArray(months.status, ["prepared", "closed"]))
    .orderBy(months.month)
    .get();
  return row ? { month: row.month, status: row.status as "prepared" | "closed" } : null;
}

/** One money entry as the totals count it. */
export interface CountedEntry {
  kind: "income" | "expense";
  /** As stored: a reversal carries the opposite sign of the entry it undoes. */
  amountCentavos: number;
  place: MoneyPlace;
  category: string;
}

/**
 * The entries dated from `from` up to, not including, `to` (no end when
 * null), as the money counts them: none from before `openingMonth`, and a
 * reversal where the entry it undoes counted.
 */
export function countedEntries(db: DbOrTx, openingMonth: string, from: string, to: string | null): CountedEntry[] {
  const original = alias(transactions, "original");
  const dated = to ? and(gte(transactions.occurredOn, from), lt(transactions.occurredOn, to)) : gte(transactions.occurredOn, from);
  const rows = db
    .select({
      kind: transactions.kind,
      amountCentavos: transactions.amountCentavos,
      paymentMethod: transactions.paymentMethod,
      category: categories.name,
      reverses: original.id,
      originalMethod: original.paymentMethod,
      originalOn: original.occurredOn,
    })
    .from(transactions)
    .innerJoin(categories, eq(categories.id, transactions.categoryId))
    .leftJoin(original, eq(original.id, transactions.reversesId))
    .where(and(dated, gte(transactions.occurredOn, openingMonth)))
    .all();
  return rows
    .filter((row) => !(row.reverses && row.originalOn! < openingMonth))
    .map((row) => ({
      kind: row.kind,
      amountCentavos: row.amountCentavos,
      place: placeOf(row.reverses ? row.originalMethod : row.paymentMethod),
      category: row.category,
    }));
}

/**
 * What the closed months found in the box beyond what the app expected:
 * the cash counted less the cash expected, added up ("Sobrante" when more,
 * "Faltante" when less). From a closed month on, the cash counts from what
 * was counted (owner, 19 November 2026). Only months before `before`, when
 * given.
 */
export function cashDifferences(db: DbOrTx, openingMonth: string, before: string | null = null): number {
  const closed = db
    .select({ counted: months.cashCountedCentavos, expected: months.expectedCashCentavos })
    .from(months)
    .where(
      and(
        eq(months.status, "closed"),
        gte(months.month, openingMonth),
        before ? lt(months.month, before) : undefined,
      ),
    )
    .all();
  return closed.reduce((sum, row) => sum + (row.counted ?? 0) - (row.expected ?? 0), 0);
}

/** Adds each entry to the place its money is in: income in, expenses out. */
export function addEntries(money: Money, entries: readonly CountedEntry[]): void {
  for (const entry of entries) {
    const signed = entry.kind === "income" ? entry.amountCentavos : -entry.amountCentavos;
    if (entry.place === "cash") {
      money.cashCentavos += signed;
    } else if (entry.place === "bank") {
      money.bankCentavos += signed;
    } else {
      money.otherCentavos += signed;
    }
  }
}

/**
 * The money now: the opening balance, plus every income and less every
 * expense from its month on, in each place, with the cash put right by each
 * closed month's count. Null before an opening balance is entered, because
 * without it there is nothing to count from.
 */
export function moneyNow(db: DbOrTx): (Money & { since: string; incomeCentavos: number; expenseCentavos: number }) | null {
  const opening = openingBalance(db);
  if (!opening) {
    return null;
  }
  const entries = countedEntries(db, opening.month, opening.month, null);
  const money: Money = {
    cashCentavos: opening.cashCentavos + cashDifferences(db, opening.month),
    bankCentavos: opening.bankCentavos,
    otherCentavos: 0,
  };
  addEntries(money, entries);
  const total = (kind: CountedEntry["kind"]) =>
    entries.filter((entry) => entry.kind === kind).reduce((sum, entry) => sum + entry.amountCentavos, 0);
  return { ...money, since: opening.month, incomeCentavos: total("income"), expenseCentavos: total("expense") };
}
