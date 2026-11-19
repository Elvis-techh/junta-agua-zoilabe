/**
 * The month close (App Plan, Module 2, "Monthly cycle"; owner, 19 November
 * 2026):
 *
 *  - A month is prepared ("Preparar cierre") once it is over, oldest first,
 *    starting with the opening balance's month. A month with no entries is
 *    closed too, so no month is skipped.
 *  - Only the cash is counted. A difference from the app's figure needs a
 *    written reason; it is the month's "Faltante" or "Sobrante de caja",
 *    and from that month on the cash counts from what was counted. The bank
 *    is checked against its statement by eye.
 *  - Someone other than whoever prepared it approves it ("Aprobar cierre"),
 *    or sends it back ("Devolver") with a reason, and it opens again.
 *  - Entries dated in a prepared or closed month are refused
 *    (`openMonthFor`, src/lib/entries.ts); a reversal is dated the day it is
 *    made, so it always falls in a month still open.
 */
import { and, eq, gte, lt } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import type { DbOrTx } from "../db/client.js";
import { months, users } from "../db/schema.js";
import type { CountedEntry, Money } from "./balance.js";
import { addEntries, cashDifferences, countedEntries, openingBalance } from "./balance.js";
import { addMonths } from "./payments.js";

export type MonthStatus = "open" | "prepared" | "closed";

/** One category's total in a month: "Cuota mensual L 2,100.00". Reversals are already taken off. */
export interface CategoryLine {
  category: string;
  amountCentavos: number;
}

/** What a month's close shows: where the money was at its start, what came in and went out, and what should be there now. */
export interface MonthFigures {
  month: string;
  opening: Money;
  income: Money;
  expense: Money;
  expected: Money;
  incomeLines: CategoryLine[];
  expenseLines: CategoryLine[];
}

function emptyMoney(): Money {
  return { cashCentavos: 0, bankCentavos: 0, otherCentavos: 0 };
}

/** Each category's total, the largest first; a category whose entries cancel out is left off. */
function categoryLines(entries: readonly CountedEntry[]): CategoryLine[] {
  const totals = new Map<string, number>();
  for (const entry of entries) {
    totals.set(entry.category, (totals.get(entry.category) ?? 0) + entry.amountCentavos);
  }
  return [...totals]
    .filter(([, amount]) => amount !== 0)
    .map(([category, amountCentavos]) => ({ category, amountCentavos }))
    .sort((a, b) => b.amountCentavos - a.amountCentavos || a.category.localeCompare(b.category, "es"));
}

/**
 * A month's figures, counted from the opening balance: the money at its
 * start (with the cash put right by each closed month before it), what came
 * in and went out in it, and what should be there at its end.
 */
export function monthFigures(db: DbOrTx, openingMonth: string, opening: Money, month: string): MonthFigures {
  const start: Money = { ...opening, cashCentavos: opening.cashCentavos + cashDifferences(db, openingMonth, month) };
  addEntries(start, countedEntries(db, openingMonth, openingMonth, month));

  const during = countedEntries(db, openingMonth, month, addMonths(month, 1));
  const incomes = during.filter((entry) => entry.kind === "income");
  const expenses = during.filter((entry) => entry.kind === "expense");
  const income = emptyMoney();
  addEntries(income, incomes);
  const spent = emptyMoney();
  addEntries(spent, expenses);
  // addEntries counts an expense as money out: turn it back into how much went out.
  const expense: Money = { cashCentavos: -spent.cashCentavos, bankCentavos: -spent.bankCentavos, otherCentavos: -spent.otherCentavos };

  const expected: Money = {
    cashCentavos: start.cashCentavos + income.cashCentavos - expense.cashCentavos,
    bankCentavos: start.bankCentavos + income.bankCentavos - expense.bankCentavos,
    otherCentavos: start.otherCentavos + income.otherCentavos - expense.otherCentavos,
  };
  return { month, opening: start, income, expense, expected, incomeLines: categoryLines(incomes), expenseLines: categoryLines(expenses) };
}

/** A month's row as the screens show it, with names instead of ids; an "open" one with no row yet has every detail null. */
export interface MonthRow {
  month: string;
  status: MonthStatus;
  cashCountedCentavos: number | null;
  expectedCashCentavos: number | null;
  cashDifferenceReason: string | null;
  preparedById: string | null;
  preparedBy: string | null;
  preparedAt: Date | null;
  approvedBy: string | null;
  approvedAt: Date | null;
  returnedBy: string | null;
  returnedAt: Date | null;
  returnedReason: string | null;
}

/** The rows of the months from `from` up to, not including, `to`, by month. */
export function monthRows(db: DbOrTx, from: string, to: string): Map<string, MonthRow> {
  const preparer = alias(users, "preparer");
  const approver = alias(users, "approver");
  const returner = alias(users, "returner");
  const rows = db
    .select({
      month: months.month,
      status: months.status,
      cashCountedCentavos: months.cashCountedCentavos,
      expectedCashCentavos: months.expectedCashCentavos,
      cashDifferenceReason: months.cashDifferenceReason,
      preparedById: months.preparedBy,
      preparedBy: preparer.name,
      preparedAt: months.preparedAt,
      approvedBy: approver.name,
      approvedAt: months.approvedAt,
      returnedBy: returner.name,
      returnedAt: months.returnedAt,
      returnedReason: months.returnedReason,
    })
    .from(months)
    .leftJoin(preparer, eq(preparer.id, months.preparedBy))
    .leftJoin(approver, eq(approver.id, months.approvedBy))
    .leftJoin(returner, eq(returner.id, months.returnedBy))
    .where(and(gte(months.month, from), lt(months.month, to)))
    .all();
  return new Map(rows.map((row) => [row.month, row as MonthRow]));
}

export function emptyRow(month: string): MonthRow {
  return {
    month,
    status: "open",
    cashCountedCentavos: null,
    expectedCashCentavos: null,
    cashDifferenceReason: null,
    preparedById: null,
    preparedBy: null,
    preparedAt: null,
    approvedBy: null,
    approvedAt: null,
    returnedBy: null,
    returnedAt: null,
    returnedReason: null,
  };
}

/**
 * Every month that can be closed so far, oldest first: from the opening
 * balance's month to the last month that is over (`thisMonth` is the month
 * in progress). Empty before an opening balance, or while its month is
 * still going.
 */
export function closableMonths(db: DbOrTx, thisMonth: string): MonthRow[] {
  const opening = openingBalance(db);
  if (!opening || opening.month >= thisMonth) {
    return [];
  }
  const rows = monthRows(db, opening.month, thisMonth);
  const list: MonthRow[] = [];
  for (let month = opening.month; month < thisMonth; month = addMonths(month, 1)) {
    list.push(rows.get(month) ?? emptyRow(month));
  }
  return list;
}
