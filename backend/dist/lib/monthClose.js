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
import { months, users } from "../db/schema.js";
import { addEntries, cashDifferences, countedEntries, openingBalance } from "./balance.js";
import { addMonths } from "./payments.js";
function emptyMoney() {
    return { cashCentavos: 0, bankCentavos: 0, otherCentavos: 0 };
}
/** Each category's total, the largest first; a category whose entries cancel out is left off. */
function categoryLines(entries) {
    const totals = new Map();
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
export function monthFigures(db, openingMonth, opening, month) {
    const start = { ...opening, cashCentavos: opening.cashCentavos + cashDifferences(db, openingMonth, month) };
    addEntries(start, countedEntries(db, openingMonth, openingMonth, month));
    const during = countedEntries(db, openingMonth, month, addMonths(month, 1));
    const incomes = during.filter((entry) => entry.kind === "income");
    const expenses = during.filter((entry) => entry.kind === "expense");
    const income = emptyMoney();
    addEntries(income, incomes);
    const spent = emptyMoney();
    addEntries(spent, expenses);
    // addEntries counts an expense as money out: turn it back into how much went out.
    const expense = { cashCentavos: -spent.cashCentavos, bankCentavos: -spent.bankCentavos, otherCentavos: -spent.otherCentavos };
    const expected = {
        cashCentavos: start.cashCentavos + income.cashCentavos - expense.cashCentavos,
        bankCentavos: start.bankCentavos + income.bankCentavos - expense.bankCentavos,
        otherCentavos: start.otherCentavos + income.otherCentavos - expense.otherCentavos,
    };
    return { month, opening: start, income, expense, expected, incomeLines: categoryLines(incomes), expenseLines: categoryLines(expenses) };
}
/** The rows of the months from `from` up to, not including, `to`, by month. */
export function monthRows(db, from, to) {
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
    return new Map(rows.map((row) => [row.month, row]));
}
export function emptyRow(month) {
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
export function closableMonths(db, thisMonth) {
    const opening = openingBalance(db);
    if (!opening || opening.month >= thisMonth) {
        return [];
    }
    const rows = monthRows(db, opening.month, thisMonth);
    const list = [];
    for (let month = opening.month; month < thisMonth; month = addMonths(month, 1)) {
        list.push(rows.get(month) ?? emptyRow(month));
    }
    return list;
}
//# sourceMappingURL=monthClose.js.map