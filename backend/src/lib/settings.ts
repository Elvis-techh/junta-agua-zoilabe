import { and, desc, eq, lte } from "drizzle-orm";

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

/** The base monthly fee in force on `day`, or null while the board has not set one. */
export function baseMonthlyFee(db: DbOrTx, day: string): number | null {
  const row = db
    .select({ amount: feeRates.amountCentavos })
    .from(feeRates)
    .where(and(eq(feeRates.kind, "base_monthly"), lte(feeRates.startsOn, day)))
    .orderBy(desc(feeRates.startsOn))
    .limit(1)
    .get();
  return row?.amount ?? null;
}
