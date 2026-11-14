/**
 * When a house's different monthly amount takes effect.
 *
 * The board decided on 2026-10-25: a different fee starts with the month
 * after the house's last payment. Months already paid keep the price they
 * were paid at (App Plan, Module 2: a new amount "never rewrites past
 * months"). A house with no payment recorded yet, such as one being
 * registered, starts with the month the fee is set in.
 */
import { and, asc, eq, gt, gte, isNotNull, isNull, lt, max, min, sql } from "drizzle-orm";

import type { DbOrTx } from "../db/client.js";
import { feeRates, owedMonths } from "../db/schema.js";
import type { FeeKind } from "./settings.js";

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
 * The income category each fee's payments are recorded under
 * (src/db/seeding.ts).
 */
const FEE_CATEGORIES: Record<FeeKind, string> = {
  base_monthly: "Cuota mensual",
  late_fee: "Mora",
  reconnection: "Reconexión",
};

/**
 * The first and last month already counted at a fee among an amount's months,
 * and what holds the first of them: a payment, or a month entered as owed
 * from the paper book ("Deuda anterior").
 */
export interface PaidMonths {
  first: string;
  last: string;
  firstHolds: "payment" | "owed";
}

/**
 * Which months already counted at this fee fall among those an amount
 * starting in `startsOn` would cover: from that month up to the start of the
 * next amount of the same fee, or with no end when none follows. Null when
 * none. A month counts once a payment of that fee covers it, or once it is
 * entered as owed: for the monthly fee, any month entered; for the late fee,
 * one entered with its late fee.
 *
 * The owner decided on 2026-11-02 that an amount may be corrected, and on
 * 2026-11-06 removed, only while no payment has been made at it, and on
 * 2026-11-12 that an amount starting in a past month is refused once a
 * payment or an entered old month falls in the months it would cover. All
 * three ask about exactly those months, and only about that fee: a monthly
 * fee payment says nothing about the late fee's amount.
 *
 * A monthly fee or a late fee pays for months (`months_covered`, as Cobrar
 * records it); a reconnection fee is charged on the day it is paid. Nothing
 * records late fees or reconnections yet: "Other income" must record them
 * under their categories, a late fee with its month in `months_covered`, for
 * this to see them. A reversed payment and the reversal itself do not count,
 * nor does a month entered as owed and then removed.
 */
export function paidMonthsAt(db: DbOrTx, kind: FeeKind, startsOn: string): PaidMonths | null {
  const until = nextFeeStart(db, kind, startsOn);
  const paid = paymentsAt(db, kind, startsOn, until);
  const owed = owedAt(db, kind, startsOn, until);
  if (!paid || !owed) {
    return paid ? { ...paid, firstHolds: "payment" } : owed ? { ...owed, firstHolds: "owed" } : null;
  }
  return {
    first: owed.first < paid.first ? owed.first : paid.first,
    last: owed.last > paid.last ? owed.last : paid.last,
    firstHolds: owed.first < paid.first ? "owed" : "payment",
  };
}

/** The first and last month a payment of this fee covers in [startsOn, until), or null. */
function paymentsAt(db: DbOrTx, kind: FeeKind, startsOn: string, until: string | null): { first: string; last: string } | null {
  const category = FEE_CATEGORIES[kind];
  // `months_covered` is a JSON list of "YYYY-MM-01" dates, which sort as text.
  const row =
    kind === "reconnection"
      ? db.get<{ first: string | null; last: string | null }>(sql`
          SELECT min(substr(t.occurred_on, 1, 7) || '-01') AS first, max(substr(t.occurred_on, 1, 7) || '-01') AS last
          FROM transactions t, categories c
          WHERE c.id = t.category_id AND c.kind = 'income' AND c.name = ${category}
            AND t.occurred_on >= ${startsOn} AND (${until} IS NULL OR t.occurred_on < ${until})
            AND t.reverses_id IS NULL
            AND NOT EXISTS (SELECT 1 FROM transactions r WHERE r.reverses_id = t.id)
        `)
      : db.get<{ first: string | null; last: string | null }>(sql`
          SELECT min(covered.value) AS first, max(covered.value) AS last
          FROM transactions t, categories c, json_each(t.months_covered) AS covered
          WHERE c.id = t.category_id AND c.kind = 'income' AND c.name = ${category}
            AND covered.value >= ${startsOn} AND (${until} IS NULL OR covered.value < ${until})
            AND t.reverses_id IS NULL
            AND NOT EXISTS (SELECT 1 FROM transactions r WHERE r.reverses_id = t.id)
        `);
  return row?.first && row.last ? { first: row.first, last: row.last } : null;
}

/**
 * The first and last month entered as owed in [startsOn, until) that this fee
 * prices, or null: any such month for the monthly fee, one with its late fee
 * for the late fee, none for reconnection.
 */
function owedAt(db: DbOrTx, kind: FeeKind, startsOn: string, until: string | null): { first: string; last: string } | null {
  if (kind === "reconnection") {
    return null;
  }
  const row = db
    .select({ first: min(owedMonths.month), last: max(owedMonths.month) })
    .from(owedMonths)
    .where(
      and(
        isNull(owedMonths.removedAt),
        gte(owedMonths.month, startsOn),
        until === null ? undefined : lt(owedMonths.month, until),
        kind === "late_fee" ? isNotNull(owedMonths.lateFeeCentavos) : undefined,
      ),
    )
    .get();
  return row?.first && row.last ? { first: row.first, last: row.last } : null;
}

/** The month the first amount of this fee after `startsOn` begins, or null when none follows. */
export function nextFeeStart(db: DbOrTx, kind: FeeKind, startsOn: string): string | null {
  const row = db
    .select({ startsOn: feeRates.startsOn })
    .from(feeRates)
    .where(and(eq(feeRates.kind, kind), isNull(feeRates.removedAt), gt(feeRates.startsOn, startsOn)))
    .orderBy(asc(feeRates.startsOn))
    .limit(1)
    .get();
  return row?.startsOn ?? null;
}
