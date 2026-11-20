/**
 * Resumen del mes (App Plan, "Screens and navigation" and Phase 3's monthly
 * statement; asked for by the owner on 19 November 2026): one month at a
 * glance, so the board can check who was charged, who paid, who still owes,
 * what came in and what the money was spent on.
 *
 * Nothing is counted differently here, so this screen and the others can
 * never disagree:
 *
 *  - The money at the start of the month, what came in, what went out and
 *    what is left are the month close's figures (`monthFigures`,
 *    src/lib/monthClose.ts).
 *  - The entries are the ones those figures count (`countedEntries`,
 *    src/lib/balance.ts): every entry dated in the month, and a reversal in
 *    the month where the entry it undoes counted. Each entry says what it
 *    adds to this month (`countsCentavos`), so each category's entries add
 *    up to that category's line in the figures.
 *  - Who was charged the month's fee, and what each house still owes for
 *    it, are the household file's "Lo que debe" and Quién debe's
 *    (src/lib/payments.ts, src/lib/lateFees.ts, src/lib/householdStatus.ts).
 *
 * Looking at it changes nothing and gives out no document number: it is not
 * a document until it can be sent or printed (CLAUDE.md, "documents").
 */
import { and, asc, eq, gte, inArray, isNotNull, isNull, lt } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import type { DbOrTx } from "../db/client.js";
import { categories, householdOwners, households, people, receiptFiles, sectors, transactions, users } from "../db/schema.js";
import { monthsWithService } from "./householdStatus.js";
import { lateFeesOf } from "./lateFees.js";
import { addMonths, monthStates, owesFrom } from "./payments.js";
import { deadline, isPastDeadline, lateFeesFrom, monthDeadline } from "./settings.js";

type PaymentMethod = (typeof transactions.$inferSelect)["paymentMethod"];

/** One line of what came in or went out in the month. */
export interface SummaryEntry {
  id: string;
  kind: "income" | "expense";
  category: string;
  occurredOn: string;
  /** As written: a reversal carries the opposite sign of the entry it undoes. */
  amountCentavos: number;
  /**
   * What this line adds to the month's money: its amount; 0 for an entry
   * undone in the same month (it and its reversal cancel out); and for a
   * reversal of an earlier month's entry, its (negative) amount.
   */
  countsCentavos: number;
  /** How it was paid; a reversal shows the entry it undoes. */
  paymentMethod: PaymentMethod;
  householdId: string | null;
  householdCode: string | null;
  /** Who the house is registered to now. */
  ownerName: string | null;
  payerName: string | null;
  supplier: string | null;
  /** The months a monthly fee pays, or the month a late fee is for. */
  monthsCovered: string[] | null;
  /** Income: the paper receipt's number. An expense: the supplier's invoice number, if it had one. */
  paperReceiptNumber: string | null;
  note: string | null;
  /** An expense: whether its receipt photo was kept, and why not when it was not. */
  hasPhoto: boolean;
  noPhotoReason: string | null;
  recordedBy: string;
  /** When this entry was undone ("Anulado"), in this month or a later one, and why. */
  reversedOn: string | null;
  reversalReason: string | null;
  /** On a reversal of an earlier month's entry: that entry's date. Its other details are that entry's. */
  undoesOn: string | null;
}

/** One house charged the month's fee. */
export interface FeeHouse {
  id: string;
  code: string;
  ownerName: string | null;
  sectorName: string | null;
  /** What the month costs this house. */
  priceCentavos: number;
  /** What has been paid towards the month, whenever it was paid: ahead, on time or late. */
  paidCentavos: number;
  /** The month's late fee, while it is owed (0 when none is). */
  lateFeeCentavos: number;
}

export interface FeeSummary {
  /** The day the month's fee is due, and the last day of its grace (Configuración → Plazo de pago). */
  dueOn: string;
  lateAfter: string;
  /** Whether the grace is over: until then, a house that has not paid is not late yet. */
  pastDeadline: boolean;
  /** The month the app adds late fees from (Configuración → Mora), or null while none is set. */
  lateFeesFrom: string | null;
  /** Every house charged the month's fee, by name. */
  houses: FeeHouse[];
  chargedCentavos: number;
  /** Paid towards the month, never more than each house's price. */
  paidCentavos: number;
  /** Still owed for the month. */
  owedCentavos: number;
  /** The month's late fees still owed. */
  lateFeesCentavos: number;
}

const owner = and(eq(householdOwners.householdId, transactions.householdId), isNull(householdOwners.endsOn));

/** The entries `where` picks, with everything a line shows, oldest first. Each entry once. */
function detailed(db: DbOrTx, where: SQL | undefined) {
  const reversal = alias(transactions, "reversal");
  const rows = db
    .select({
      id: transactions.id,
      kind: transactions.kind,
      category: categories.name,
      occurredOn: transactions.occurredOn,
      amountCentavos: transactions.amountCentavos,
      paymentMethod: transactions.paymentMethod,
      householdId: transactions.householdId,
      householdCode: households.code,
      ownerName: people.fullName,
      payerName: transactions.payerName,
      supplier: transactions.supplier,
      monthsCovered: transactions.monthsCovered,
      paperReceiptNumber: transactions.paperReceiptNumber,
      note: transactions.note,
      reason: transactions.reason,
      recordedBy: users.name,
      photoId: receiptFiles.id,
      reversedOn: reversal.occurredOn,
      reversalReason: reversal.reason,
    })
    .from(transactions)
    .innerJoin(categories, eq(categories.id, transactions.categoryId))
    .innerJoin(users, eq(users.id, transactions.createdBy))
    .leftJoin(households, eq(households.id, transactions.householdId))
    .leftJoin(householdOwners, owner)
    .leftJoin(people, eq(people.id, householdOwners.personId))
    .leftJoin(receiptFiles, eq(receiptFiles.transactionId, transactions.id))
    .leftJoin(reversal, eq(reversal.reversesId, transactions.id))
    .where(where)
    .orderBy(asc(transactions.occurredOn), asc(transactions.createdAt))
    .all();
  const once = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    if (!once.has(row.id)) once.set(row.id, row);
  }
  return [...once.values()];
}

/**
 * What came in and went out in `month`, as its money counts it: every entry
 * dated in it, each marked when it was undone, and each reversal dated in it
 * of an entry from an earlier month the money counts (not one from before
 * the opening balance's month). Oldest first, reversals after the entries.
 */
export function monthEntries(db: DbOrTx, openingMonth: string, month: string): SummaryEntry[] {
  const next = addMonths(month, 1);
  const inMonth = and(gte(transactions.occurredOn, month), lt(transactions.occurredOn, next));

  const entries = detailed(db, and(inMonth, isNull(transactions.reversesId))).map(({ photoId, reason, ...row }) => {
    const undoneInMonth = row.reversedOn !== null && row.reversedOn < next;
    return {
      ...row,
      countsCentavos: undoneInMonth ? 0 : row.amountCentavos,
      hasPhoto: photoId !== null,
      noPhotoReason: row.kind === "expense" && photoId === null ? reason : null,
      undoesOn: null,
    };
  });

  // A reversal of an entry dated in this month is already on that entry's line.
  const reversals = db
    .select({ id: transactions.id, undoes: transactions.reversesId, occurredOn: transactions.occurredOn, amountCentavos: transactions.amountCentavos, recordedBy: users.name })
    .from(transactions)
    .innerJoin(users, eq(users.id, transactions.createdBy))
    .where(and(inMonth, isNotNull(transactions.reversesId)))
    .orderBy(asc(transactions.occurredOn), asc(transactions.createdAt))
    .all();
  if (reversals.length === 0) {
    return entries;
  }
  const undone = new Map(
    detailed(
      db,
      and(
        inArray(
          transactions.id,
          reversals.map((reversal) => reversal.undoes!),
        ),
        gte(transactions.occurredOn, openingMonth),
        lt(transactions.occurredOn, month),
      ),
    ).map((row) => [row.id, row]),
  );
  const earlier = reversals.flatMap((reversal) => {
    const original = undone.get(reversal.undoes!);
    if (!original) return [];
    const { photoId, reason, ...row } = original;
    return [
      {
        ...row,
        id: reversal.id,
        occurredOn: reversal.occurredOn,
        amountCentavos: reversal.amountCentavos,
        countsCentavos: reversal.amountCentavos,
        hasPhoto: photoId !== null,
        noPhotoReason: row.kind === "expense" && photoId === null ? reason : null,
        recordedBy: reversal.recordedBy,
        reversedOn: null,
        undoesOn: original.occurredOn,
      },
    ];
  });
  return [...entries, ...earlier];
}

/**
 * Who was charged the fee of `month`, and how each stands on `today`: every
 * house that owes from that month or earlier (its first entered payment or
 * its registration), had service on the day its deadline ended, and has a
 * price above L 0 for it, the same houses "Lo que debe" counts. A house's
 * payments count whenever they were made.
 */
export function monthFee(db: DbOrTx, month: string, today: string, timeZone: string): FeeSummary {
  const rule = deadline(db, today);
  const { dueOn, lateAfter } = monthDeadline(month, rule);
  const pastDeadline = isPastDeadline(month, today, rule);
  const lateFrom = lateFeesFrom(db, today);
  const lateFeesCount = pastDeadline && lateFrom !== null && lateFrom <= month;

  const everyHouse = db
    .select({ id: households.id, code: households.code, ownerName: people.fullName, sectorName: sectors.name })
    .from(households)
    .leftJoin(householdOwners, and(eq(householdOwners.householdId, households.id), isNull(householdOwners.endsOn)))
    .leftJoin(people, eq(people.id, householdOwners.personId))
    .leftJoin(sectors, eq(sectors.id, households.sectorId))
    .orderBy(asc(households.code))
    .all();
  const seen = new Set<string>();

  const houses: FeeHouse[] = [];
  for (const house of everyHouse) {
    if (seen.has(house.id)) continue;
    seen.add(house.id);
    if (owesFrom(db, house.id, timeZone).month > month) continue;
    if (!monthsWithService(db, house.id, [month], rule).has(month)) continue;
    const [state] = monthStates(db, house.id, [month]);
    if (!state || state.priceCentavos === null || state.priceCentavos === 0) continue;
    const lateFeeCentavos = lateFeesCount
      ? (lateFeesOf(db, house.id, today, timeZone).months.find((fee) => fee.month === month)?.amountCentavos ?? 0)
      : 0;
    houses.push({ ...house, priceCentavos: state.priceCentavos, paidCentavos: state.paidCentavos, lateFeeCentavos });
  }
  houses.sort((a, b) => (a.ownerName ?? "").localeCompare(b.ownerName ?? "", "es") || a.code.localeCompare(b.code));

  const paid = (house: FeeHouse) => Math.min(house.paidCentavos, house.priceCentavos);
  const sum = (value: (house: FeeHouse) => number) => houses.reduce((total, house) => total + value(house), 0);
  return {
    dueOn,
    lateAfter,
    pastDeadline,
    lateFeesFrom: lateFrom,
    houses,
    chargedCentavos: sum((house) => house.priceCentavos),
    paidCentavos: sum(paid),
    owedCentavos: sum((house) => house.priceCentavos - paid(house)),
    lateFeesCentavos: sum((house) => house.lateFeeCentavos),
  };
}
