/**
 * Monthly fee payments: what each month of a house costs, what has been paid
 * towards it, and how a new payment is shared among the months it covers.
 *
 * The rules (App Plan, Module 2, and the decisions they rest on):
 *
 *  - A payment goes to the months the treasurer selects, as written on the
 *    paper receipt (29 October 2026). The app never moves money to another
 *    month by itself.
 *  - Within those months the money fills the oldest first, so only the last
 *    one can be left partly paid (owner, 6 November 2026).
 *  - A payment larger than what the selected months still owe is refused:
 *    no money sits unassigned (owner, 6 November 2026).
 *  - A month keeps the price it had when its first money arrived, so a later
 *    change of fee does not change what is still owed for it (owner,
 *    6 November 2026). Until then a month costs the house's different amount
 *    in force for it, or else the base monthly fee in force for it.
 *  - A house owes every month not paid in full from its first entered
 *    payment, or from the month it was registered if that is earlier, up to
 *    the current month; a skipped month stays owed after a later one is paid
 *    (owner, 13 November 2026). There is no start month: each family's
 *    history is typed in through Cobrar, from whatever date it begins.
 *
 * A payment that has been reversed does not count, and a reversal carries no
 * shares of its own, so undoing a payment gives its months back as they were.
 */
import { and, desc, eq, isNull, lte, min, or, gte, sql } from "drizzle-orm";

import type { DbOrTx } from "../db/client.js";
import { householdFees, households, paymentMonths } from "../db/schema.js";
import { formatLempiras } from "./census.js";
import { firstOfMonth, monthName } from "./fees.js";
import { feeOn } from "./settings.js";
import { businessToday } from "./time.js";

/** "2026-11-01" moved by `by` months: "2026-11-01", 3 → "2027-02-01". */
export function addMonths(month: string, by: number): string {
  const index = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + by;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}-01`;
}

/** Every month from `from` to `to`, both included, as first days. */
export function monthsBetween(from: string, to: string): string[] {
  const list: string[] = [];
  for (let month = from; month <= to; month = addMonths(month, 1)) {
    list.push(month);
  }
  return list;
}

/** How far ahead a house may pay: this month and the twelve after it, a whole year and more. */
export const MONTHS_AHEAD = 12;

/** "octubre y noviembre de 2026", "diciembre de 2026 y enero de 2027". */
export function monthList(months: readonly string[]): string {
  const names = months.map((month, index) => {
    const sameYearAsNext = index < months.length - 1 && months[index + 1]!.slice(0, 4) === month.slice(0, 4);
    return sameYearAsNext ? monthName(month).replace(/ de \d{4}$/, "") : monthName(month);
  });
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} y ${names.at(-1)}`;
}

/** One month of one house: its price (null while no fee covers it) and what has been paid towards it. */
export interface MonthState {
  month: string;
  priceCentavos: number | null;
  paidCentavos: number;
}

export interface Share {
  month: string;
  amountCentavos: number;
  priceCentavos: number;
  /** Whether this share completes the month. */
  paidInFull: boolean;
}

export type Allocation = { shares: Share[] } | { code: string; problem: string };

/**
 * Share `amountCentavos` among the selected months, oldest first.
 *
 * Refused, with the sentence to show, when a month has no price or nothing
 * left to pay, when the amount is more than the months still owe, or when it
 * does not reach every month selected.
 */
export function allocatePayment(selected: readonly MonthState[], amountCentavos: number): Allocation {
  const months = [...selected].sort((a, b) => a.month.localeCompare(b.month));
  if (months.length === 0) {
    return { code: "no_months", problem: "Elija el mes o los meses que se pagan." };
  }
  if (!(Number.isSafeInteger(amountCentavos) && amountCentavos > 0)) {
    return { code: "invalid_amount", problem: "Escriba el monto que se pagó." };
  }

  for (const state of months) {
    if (state.priceCentavos === null) {
      return {
        code: "no_fee",
        problem: `No hay cuota para ${monthName(state.month)}. Pida que la pongan en Configuración → Cuotas.`,
      };
    }
    if (state.paidCentavos >= state.priceCentavos) {
      return {
        code: "already_paid",
        problem:
          state.priceCentavos === 0
            ? `${capitalize(monthName(state.month))} no se cobra. Quítelo de la lista.`
            : `${capitalize(monthName(state.month))} ya está pagado. Quítelo de la lista.`,
      };
    }
  }

  const owed = months.reduce((sum, state) => sum + state.priceCentavos! - state.paidCentavos, 0);
  if (amountCentavos > owed) {
    return {
      code: "more_than_owed",
      problem:
        `${months.length === 1 ? "Ese mes debe" : "Esos meses deben"} ${formatLempiras(owed)}, ` +
        `y el pago es de ${formatLempiras(amountCentavos)}. Elija más meses o revise el monto.`,
    };
  }

  const shares: Share[] = [];
  let left = amountCentavos;
  for (const state of months) {
    const due = state.priceCentavos! - state.paidCentavos;
    const amount = Math.min(due, left);
    if (amount === 0) {
      break;
    }
    shares.push({ month: state.month, amountCentavos: amount, priceCentavos: state.priceCentavos!, paidInFull: amount === due });
    left -= amount;
  }

  if (shares.length < months.length) {
    const reached = shares.at(-1)!.month;
    const unreached = months.slice(shares.length).map((state) => state.month);
    return {
      code: "does_not_reach",
      problem:
        `Con ${formatLempiras(amountCentavos)} se alcanza solo hasta ${monthName(reached)}. ` +
        `Quite ${monthList(unreached)} o revise el monto.`,
    };
  }
  return { shares };
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * The price of `month` for this house before any money has reached it: its
 * different amount in force for that month, or the base monthly fee in force
 * for it. Null while neither exists.
 */
export function listPrice(db: DbOrTx, householdId: string, month: string): number | null {
  const different = db
    .select({ amount: householdFees.monthlyAmountCentavos })
    .from(householdFees)
    .where(
      and(
        eq(householdFees.householdId, householdId),
        lte(householdFees.startsOn, month),
        or(isNull(householdFees.endsOn), gte(householdFees.endsOn, month)),
      ),
    )
    .orderBy(desc(householdFees.startsOn))
    .limit(1)
    .get();
  return different ? different.amount : feeOn(db, "base_monthly", month);
}

/**
 * Each month's state for this house: the price it was fixed at by its first
 * payment (or its list price while nothing has been paid), and how much has
 * been paid towards it. Reversed payments are left out.
 */
export function monthStates(db: DbOrTx, householdId: string, months: readonly string[]): MonthState[] {
  if (months.length === 0) {
    return [];
  }
  const rows = db.all<{ month: string; paid: number; price: number }>(sql`
    SELECT pm.month AS month, sum(pm.amount_centavos) AS paid, min(pm.price_centavos) AS price
    FROM payment_months pm
    WHERE pm.household_id = ${householdId}
      AND pm.month >= ${months[0]} AND pm.month <= ${months.at(-1)}
      AND NOT EXISTS (SELECT 1 FROM transactions r WHERE r.reverses_id = pm.transaction_id)
    GROUP BY pm.month
  `);
  const paid = new Map(rows.map((row) => [row.month, row]));
  return months.map((month) => {
    const row = paid.get(month);
    return row
      ? { month, priceCentavos: row.price, paidCentavos: row.paid }
      : { month, priceCentavos: listPrice(db, householdId, month), paidCentavos: 0 };
  });
}

/** The earliest month a payment of this house covers, or null while none is entered. A reversed payment does not count. */
export function firstPaidMonth(db: DbOrTx, householdId: string): string | null {
  const row = db
    .select({ month: min(paymentMonths.month) })
    .from(paymentMonths)
    .where(
      and(
        eq(paymentMonths.householdId, householdId),
        sql`NOT EXISTS (SELECT 1 FROM transactions r WHERE r.reverses_id = ${paymentMonths.transactionId})`,
      ),
    )
    .get();
  return row?.month ?? null;
}

/** Where what a house owes is counted from, and why: its first entered payment, or the month it was registered. */
export interface OwesFrom {
  month: string;
  because: "first_payment" | "registered";
}

/**
 * The first month a house owes (owner, 13 November 2026): the first month its
 * entered payments cover, or the month it was registered in the census if
 * that is earlier or nothing is entered yet. The month it was registered is
 * the paper form's date when it was typed in from paper, otherwise the day
 * it was saved, in Honduras time.
 */
export function owesFrom(db: DbOrTx, householdId: string, timeZone: string): OwesFrom {
  const household = db
    .select({ paperDate: households.paperDate, createdAt: households.createdAt })
    .from(households)
    .where(eq(households.id, householdId))
    .get();
  if (!household) {
    throw new Error(`No household ${householdId}`);
  }
  const registered = firstOfMonth(household.paperDate ?? businessToday(timeZone, household.createdAt));
  const firstPaid = firstPaidMonth(db, householdId);
  return firstPaid !== null && firstPaid < registered
    ? { month: firstPaid, because: "first_payment" }
    : { month: registered, because: "registered" };
}

/**
 * The months this house owes, oldest first: every month from `from` to
 * `through` that has a price and is not paid in full. A month with no fee
 * set, or one the board does not charge (L 0), is not owed.
 */
export function owedMonths(db: DbOrTx, householdId: string, from: string, through: string): MonthState[] {
  if (from > through) {
    return [];
  }
  return monthStates(db, householdId, monthsBetween(from, through)).filter(
    (state) => state.priceCentavos !== null && state.paidCentavos < state.priceCentavos,
  );
}
