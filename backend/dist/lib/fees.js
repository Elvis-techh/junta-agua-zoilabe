/**
 * When a house's different monthly amount takes effect.
 *
 * The board decided on 2026-10-25: a different fee starts with the month
 * after the house's last payment. Months already paid keep the price they
 * were paid at (App Plan, Module 2: a new amount "never rewrites past
 * months"). A house with no payment recorded yet, such as one being
 * registered, starts with the month the fee is set in.
 */
import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";
import { feeRates } from "../db/schema.js";
const MONTH_NAMES = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];
/** "2027-01-01" → "enero de 2027". */
export function monthName(firstDay) {
    return `${MONTH_NAMES[Number(firstDay.slice(5, 7)) - 1]} de ${firstDay.slice(0, 4)}`;
}
/** "2026-03-17" → "2026-03-01". */
export function firstOfMonth(date) {
    return `${date.slice(0, 7)}-01`;
}
/** "2026-03-17" → "2026-04-01"; December rolls into January. */
export function monthAfter(date) {
    const year = Number(date.slice(0, 4));
    const month = Number(date.slice(5, 7));
    return month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;
}
/** The first month a different amount applies to: the month after the last one paid, or this month. */
export function differentFeeStart(lastPaidMonth, today) {
    return lastPaidMonth ? monthAfter(lastPaidMonth) : firstOfMonth(today);
}
/**
 * The latest month a payment of this house covers, or null if none.
 *
 * A payment that was reversed does not count, nor does the reversal itself:
 * a correction must not move the start of a fee.
 */
export function lastPaidMonth(db, householdId) {
    // `months_covered` is a JSON list of "YYYY-MM-01" dates, which sort as text.
    const row = db.get(sql `
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
const FEE_CATEGORIES = {
    base_monthly: "Cuota mensual",
    late_fee: "Mora",
    reconnection: "Reconexión",
};
/**
 * Which months a payment of this fee covers among those an amount starting in
 * `startsOn` would cover: from that month up to the start of the next amount
 * of the same fee, or with no end when none follows. Null when none.
 *
 * The owner decided on 2026-11-02 that an amount may be corrected, and on
 * 2026-11-06 removed, only while no payment has been made at it, and on
 * 2026-11-12 that an amount starting in a past month is refused once a
 * payment falls in the months it would cover. All three ask about exactly
 * those months, and only about payments of that fee: a monthly fee payment
 * says nothing about the late fee's amount.
 *
 * A monthly fee or a late fee pays for months (`months_covered`, as Cobrar
 * records it); a reconnection fee is charged on the day it is paid. Nothing
 * records late fees or reconnections yet: "Other income" must record them
 * under their categories, a late fee with its month in `months_covered`, for
 * this to see them. A reversed payment and the reversal itself do not count.
 */
export function paidMonthsAt(db, kind, startsOn) {
    const until = nextFeeStart(db, kind, startsOn);
    const category = FEE_CATEGORIES[kind];
    // `months_covered` is a JSON list of "YYYY-MM-01" dates, which sort as text.
    const row = kind === "reconnection"
        ? db.get(sql `
          SELECT min(substr(t.occurred_on, 1, 7) || '-01') AS first, max(substr(t.occurred_on, 1, 7) || '-01') AS last
          FROM transactions t, categories c
          WHERE c.id = t.category_id AND c.kind = 'income' AND c.name = ${category}
            AND t.occurred_on >= ${startsOn} AND (${until} IS NULL OR t.occurred_on < ${until})
            AND t.reverses_id IS NULL
            AND NOT EXISTS (SELECT 1 FROM transactions r WHERE r.reverses_id = t.id)
        `)
        : db.get(sql `
          SELECT min(covered.value) AS first, max(covered.value) AS last
          FROM transactions t, categories c, json_each(t.months_covered) AS covered
          WHERE c.id = t.category_id AND c.kind = 'income' AND c.name = ${category}
            AND covered.value >= ${startsOn} AND (${until} IS NULL OR covered.value < ${until})
            AND t.reverses_id IS NULL
            AND NOT EXISTS (SELECT 1 FROM transactions r WHERE r.reverses_id = t.id)
        `);
    return row?.first && row.last ? { first: row.first, last: row.last } : null;
}
/** The month the first amount of this fee after `startsOn` begins, or null when none follows. */
export function nextFeeStart(db, kind, startsOn) {
    const row = db
        .select({ startsOn: feeRates.startsOn })
        .from(feeRates)
        .where(and(eq(feeRates.kind, kind), isNull(feeRates.removedAt), gt(feeRates.startsOn, startsOn)))
        .orderBy(asc(feeRates.startsOn))
        .limit(1)
        .get();
    return row?.startsOn ?? null;
}
//# sourceMappingURL=fees.js.map