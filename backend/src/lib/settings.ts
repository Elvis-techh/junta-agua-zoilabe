import { and, desc, eq, isNull, lte } from "drizzle-orm";

import type { DbOrTx } from "../db/client.js";
import { feeRates, settings, users } from "../db/schema.js";

/**
 * The value of a configuration key in force on `day`: the newest row whose
 * `effective_from` is not after it (see the `settings` table).
 */
export function currentSetting<T>(db: DbOrTx, key: string, day: string): T | null {
  const row = db
    .select({ value: settings.value })
    .from(settings)
    .where(and(eq(settings.key, key), lte(settings.effectiveFrom, day)))
    .orderBy(desc(settings.effectiveFrom), desc(settings.id))
    .limit(1)
    .get();
  return row ? (row.value as T) : null;
}

export type FeeKind = (typeof feeRates.$inferSelect)["kind"];

export const FEE_KINDS = ["base_monthly", "late_fee", "reconnection"] as const satisfies readonly FeeKind[];

/**
 * The amount of a fee in force on `day`, in centavos, or null while the board
 * has not set one. A removed amount does not count: the one before it applies.
 */
export function feeOn(db: DbOrTx, kind: FeeKind, day: string): number | null {
  const row = db
    .select({ amount: feeRates.amountCentavos })
    .from(feeRates)
    .where(and(eq(feeRates.kind, kind), lte(feeRates.startsOn, day), isNull(feeRates.removedAt)))
    .orderBy(desc(feeRates.startsOn))
    .limit(1)
    .get();
  return row?.amount ?? null;
}

/** The base monthly fee in force on `day`, or null while the board has not set one. */
export function baseMonthlyFee(db: DbOrTx, day: string): number | null {
  return feeOn(db, "base_monthly", day);
}

/**
 * The settings key of the start month: the month the app takes over from the
 * paper book, the same for every house (board, 7 November 2026). From it on,
 * every month counts as owed until it is paid; before it, a house owes only
 * the months entered as "Deuda anterior".
 */
export const START_MONTH_KEY = "start_month";

/** The start month as it was saved, or null while it has not been. */
export interface StartMonth {
  /** Its first day, "2027-01-01". */
  month: string;
  savedAt: Date;
  savedBy: string | null;
}

/**
 * The start month, or null while nobody has saved it. It is saved once and
 * never changed (owner, 13 November 2026; the database refuses a second row),
 * so it applies from the day it is saved and to every month, past or future.
 */
export function startMonth(db: DbOrTx): StartMonth | null {
  const row = db
    .select({ value: settings.value, savedAt: settings.createdAt, savedBy: users.name })
    .from(settings)
    .leftJoin(users, eq(users.id, settings.createdBy))
    .where(eq(settings.key, START_MONTH_KEY))
    .get();
  return row ? { month: row.value as string, savedAt: row.savedAt, savedBy: row.savedBy } : null;
}
