/**
 * Month-end late fees (mora) and what each house owes with them.
 *
 * The rules (App Plan, Module 2, and the owner's answers of 14 November 2026):
 *
 *  - A month counts as paid only when its full fee arrived by its deadline:
 *    the day in Configuración → Plazo de pago plus its grace days. Each month
 *    not paid in full by then owes its own late fee, even if it is paid in
 *    full later.
 *  - The late fee of a month is Configuración's late fee for that month. A
 *    month with no late fee set, or a late fee of L 0, owes none, and so does
 *    a month the house does not owe at all (no fee, L 0, or before the house
 *    owes from).
 *  - The app adds late fees by itself only from the month set in
 *    Configuración → Mora. Earlier months have only the late fees typed in
 *    from the paper book through Otro ingreso (owner, 13 November 2026).
 *    Until that month is set, the app adds none.
 *  - A month owes a late fee only if the house had service in it: active and
 *    with water (connected or shared) on the day its deadline ended, by its
 *    status history (src/lib/householdStatus.ts). A month without service is
 *    not owed at all, so it owes no late fee either.
 *  - A late fee is paid by a "Mora" entry for its month (Otro ingreso), once:
 *    after that the month owes no late fee. A reversed entry does not count.
 *  - Nothing is written: late fees are worked out each time from the
 *    payments, so an old payment typed in later corrects them by itself.
 */
import { and, eq, isNull, sql } from "drizzle-orm";

import type { DbOrTx } from "../db/client.js";
import { categories, paymentMonths, transactions } from "../db/schema.js";
import { FEE_CATEGORIES, firstOfMonth } from "./fees.js";
import { monthsWithService } from "./householdStatus.js";
import type { MonthState } from "./payments.js";
import { monthStates, monthsBetween, owedMonths, owesFrom } from "./payments.js";
import { deadline, feeOn, isPastDeadline, lateFeesFrom, monthDeadline } from "./settings.js";

/** One month's late fee that a house still owes. */
export interface LateFee {
  month: string;
  amountCentavos: number;
}

export interface HouseLateFees {
  /** The first month the app adds late fees from (Configuración → Mora), or null while none is set. */
  from: string | null;
  /** "not_set" while Configuración → Mora has no month, so no late fee is added; otherwise null. */
  none: "not_set" | null;
  months: LateFee[];
  totalCentavos: number;
}

/** How much of each month arrived by that month's deadline, from payments that were not reversed. */
function paidInTime(db: DbOrTx, householdId: string, months: readonly string[], lateAfter: (month: string) => string): Map<string, number> {
  const paid = new Map<string, number>();
  if (months.length === 0) {
    return paid;
  }
  const rows = db
    .select({ month: paymentMonths.month, amountCentavos: paymentMonths.amountCentavos, occurredOn: transactions.occurredOn })
    .from(paymentMonths)
    .innerJoin(transactions, eq(transactions.id, paymentMonths.transactionId))
    .where(
      and(
        eq(paymentMonths.householdId, householdId),
        sql`${paymentMonths.month} >= ${months[0]} AND ${paymentMonths.month} <= ${months.at(-1)}`,
        sql`NOT EXISTS (SELECT 1 FROM transactions r WHERE r.reverses_id = ${transactions.id})`,
      ),
    )
    .all();
  for (const row of rows) {
    if (row.occurredOn <= lateAfter(row.month)) {
      paid.set(row.month, (paid.get(row.month) ?? 0) + row.amountCentavos);
    }
  }
  return paid;
}

/** The months whose late fee this house has paid: a "Mora" entry for the month, not reversed. */
export function lateFeesPaid(db: DbOrTx, householdId: string): Set<string> {
  const rows = db
    .select({ monthsCovered: transactions.monthsCovered })
    .from(transactions)
    .innerJoin(categories, eq(categories.id, transactions.categoryId))
    .where(
      and(
        eq(transactions.householdId, householdId),
        eq(categories.kind, "income"),
        eq(categories.name, FEE_CATEGORIES.late_fee),
        isNull(transactions.reversesId),
        sql`NOT EXISTS (SELECT 1 FROM transactions r WHERE r.reverses_id = ${transactions.id})`,
      ),
    )
    .all();
  return new Set(rows.flatMap((row) => row.monthsCovered ?? []));
}

/** The late fees a house owes on `today`, oldest month first. */
export function lateFeesOf(db: DbOrTx, householdId: string, today: string, timeZone: string): HouseLateFees {
  const from = lateFeesFrom(db, today);
  if (from === null) {
    return { from, none: "not_set", months: [], totalCentavos: 0 };
  }

  const owesSince = owesFrom(db, householdId, timeZone).month;
  const start = from > owesSince ? from : owesSince;
  const rule = deadline(db, today);
  const lateAfter = (month: string) => monthDeadline(month, rule).lateAfter;
  const pastDeadline = monthsBetween(start, firstOfMonth(today)).filter((month) => isPastDeadline(month, today, rule));
  const served = monthsWithService(db, householdId, pastDeadline, rule);
  const months = pastDeadline.filter((month) => served.has(month));
  const states = monthStates(db, householdId, months);
  const inTime = paidInTime(db, householdId, months, lateAfter);
  const paid = lateFeesPaid(db, householdId);

  const owed: LateFee[] = [];
  for (const state of states) {
    if (state.priceCentavos === null || state.priceCentavos === 0) continue;
    if ((inTime.get(state.month) ?? 0) >= state.priceCentavos) continue;
    if (paid.has(state.month)) continue;
    const amount = feeOn(db, "late_fee", state.month);
    if (!amount) continue;
    owed.push({ month: state.month, amountCentavos: amount });
  }
  return { from, none: null, months: owed, totalCentavos: owed.reduce((sum, fee) => sum + fee.amountCentavos, 0) };
}

/** The months a house owes on `today`, oldest first: not paid in full, from when it owes, once their deadline is over. */
export function owedNow(db: DbOrTx, householdId: string, today: string, timeZone: string): MonthState[] {
  const rule = deadline(db, today);
  return owedMonths(db, householdId, owesFrom(db, householdId, timeZone).month, firstOfMonth(today), rule).filter((state) =>
    isPastDeadline(state.month, today, rule),
  );
}
