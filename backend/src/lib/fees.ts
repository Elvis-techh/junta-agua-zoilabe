/**
 * When a house's different monthly amount takes effect.
 *
 * The board decided on 2026-10-25: a different fee starts with the month
 * after the house's last payment. Months already paid keep the price they
 * were paid at (App Plan, Module 2: a new amount "never rewrites past
 * months"). A house with no payment recorded yet, such as one being
 * registered, starts with the month the fee is set in.
 */
import { sql } from "drizzle-orm";

import type { DbOrTx } from "../db/client.js";

/** "2026-03-17" → "2026-03-01". */
export function firstOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

/** "2026-03-17" → "2026-04-01"; December rolls into January. */
export function monthAfter(date: string): string {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  return month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;
}

/** The first month a different amount applies to: the month after the last one paid, or this month. */
export function differentFeeStart(lastPaidMonth: string | null, today: string): string {
  return lastPaidMonth ? monthAfter(lastPaidMonth) : firstOfMonth(today);
}

/**
 * The latest month a payment of this house covers, or null if none.
 *
 * A payment that was reversed does not count, nor does the reversal itself:
 * a correction must not move the start of a fee.
 */
export function lastPaidMonth(db: DbOrTx, householdId: string): string | null {
  // `months_covered` is a JSON list of "YYYY-MM-01" dates, which sort as text.
  const row = db.get<{ month: string | null }>(sql`
    SELECT max(covered.value) AS month
    FROM transactions t, json_each(t.months_covered) AS covered
    WHERE t.household_id = ${householdId}
      AND t.kind = 'income'
      AND t.reverses_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM transactions r WHERE r.reverses_id = t.id)
  `);
  return row?.month ?? null;
}
