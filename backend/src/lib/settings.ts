import { and, desc, eq, isNull, lte } from "drizzle-orm";

import type { DbOrTx } from "../db/client.js";
import { feeRates, settings } from "../db/schema.js";

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
 * The payment deadline (owner, 13 November 2026): each month's fee is paid
 * by `dueDay` of that month, and a month not paid in full counts as owed
 * once `graceDays` more have passed. Set in Configuración → Plazo de pago;
 * each change is a new row, and the newest applies to every month.
 */
export const DEADLINE_KEY = "payment_deadline";

export interface Deadline {
  /** 1 to 31; a month shorter than that is due on its last day. */
  dueDay: number;
  graceDays: number;
}

/** Until the board sets one: the last day of the month, with no grace (App Plan, Module 2). */
export const DEFAULT_DEADLINE: Deadline = { dueDay: 31, graceDays: 0 };

/** The deadline in force, as saved, or the default while none is. */
export function deadline(db: DbOrTx, day: string): Deadline {
  return currentSetting<Deadline>(db, DEADLINE_KEY, day) ?? DEFAULT_DEADLINE;
}

/** "2026-11-01" → the day its fee is due, and the last day of its grace: "2026-11-25", "2026-11-30". */
export function monthDeadline(month: string, rule: Deadline): { dueOn: string; lateAfter: string } {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7)) - 1;
  const lastDay = new Date(Date.UTC(year, index + 1, 0)).getUTCDate();
  const due = new Date(Date.UTC(year, index, Math.min(rule.dueDay, lastDay)));
  const late = new Date(due.getTime() + rule.graceDays * 86_400_000);
  return { dueOn: due.toISOString().slice(0, 10), lateAfter: late.toISOString().slice(0, 10) };
}

/** Whether a month not paid in full counts as owed on `today`: its grace days are over. */
export function isPastDeadline(month: string, today: string, rule: Deadline): boolean {
  return today > monthDeadline(month, rule).lateAfter;
}
