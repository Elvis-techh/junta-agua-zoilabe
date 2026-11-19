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
 */
import { desc, eq, gte, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import type { DbOrTx } from "../db/client.js";
import { months, openingBalances, transactions, users } from "../db/schema.js";

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

/** Once a month is closed the opening balance cannot be corrected (owner, 17 November 2026). */
export function firstClosedMonth(db: DbOrTx): string | null {
  return db.select({ month: months.month }).from(months).where(eq(months.status, "closed")).orderBy(months.month).get()?.month ?? null;
}

/**
 * The money now: the opening balance plus every income and less every
 * expense from its month on, in each place. Null before an opening balance
 * is entered, because without it there is nothing to count from.
 */
export function moneyNow(db: DbOrTx): (Money & { since: string; incomeCentavos: number; expenseCentavos: number }) | null {
  const opening = openingBalance(db);
  if (!opening) {
    return null;
  }
  const original = alias(transactions, "original");
  const entries = db
    .select({
      kind: transactions.kind,
      amountCentavos: transactions.amountCentavos,
      paymentMethod: transactions.paymentMethod,
      reverses: original.id,
      originalMethod: original.paymentMethod,
      originalOn: original.occurredOn,
    })
    .from(transactions)
    .leftJoin(original, eq(original.id, transactions.reversesId))
    .where(gte(transactions.occurredOn, opening.month))
    .all();

  const money: Money = { cashCentavos: opening.cashCentavos, bankCentavos: opening.bankCentavos, otherCentavos: 0 };
  let incomeCentavos = 0;
  let expenseCentavos = 0;
  for (const entry of entries) {
    if (entry.reverses && entry.originalOn! < opening.month) {
      continue;
    }
    const signed = entry.kind === "income" ? entry.amountCentavos : -entry.amountCentavos;
    if (entry.kind === "income") {
      incomeCentavos += entry.amountCentavos;
    } else {
      expenseCentavos += entry.amountCentavos;
    }
    const place = placeOf(entry.reverses ? entry.originalMethod : entry.paymentMethod);
    if (place === "cash") {
      money.cashCentavos += signed;
    } else if (place === "bank") {
      money.bankCentavos += signed;
    } else {
      money.otherCentavos += signed;
    }
  }
  return { ...money, since: opening.month, incomeCentavos, expenseCentavos };
}
