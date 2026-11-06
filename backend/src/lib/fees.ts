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

const MONTH_NAMES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

/** "2027-01-01" → "enero de 2027". */
export function monthName(firstDay: string): string {
  return `${MONTH_NAMES[Number(firstDay.slice(5, 7)) - 1]} de ${firstDay.slice(0, 4)}`;
}

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

/**
 * The earliest month a new rate of a fee may start, or null when any month may.
 *
 * The owner decided on 2026-11-02 that a change may start in the current
 * month. Months before it keep the price they were charged at (App Plan, 29
 * October 2026: a change "never rewrites months already charged or paid").
 * The very first amount of each fee is the exception: until it exists, no
 * month has been charged with it, and it may start in the past so that what
 * houses already owe from the paper book can be counted.
 */
export function earliestFeeStart(hasRate: boolean, today: string): string | null {
  return hasRate ? firstOfMonth(today) : null;
}

/**
 * Whether a payment recorded in the app covers `month` or a later one.
 *
 * A fee amount may be corrected (owner, 2026-11-02) only while no payment has
 * been made at it: once one has, correcting it would rewrite a month already
 * paid. A reversed payment and the reversal itself do not count. This is
 * stricter than it must be (any payment from that month on, at any price),
 * which errs on the side of never rewriting a paid month.
 */
export function paidFrom(db: DbOrTx, month: string): boolean {
  const row = db.get<{ found: number }>(sql`
    SELECT 1 AS found
    FROM transactions t, json_each(t.months_covered) AS covered
    WHERE covered.value >= ${month}
      AND t.kind = 'income'
      AND t.reverses_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM transactions r WHERE r.reverses_id = t.id)
    LIMIT 1
  `);
  return row !== undefined;
}
