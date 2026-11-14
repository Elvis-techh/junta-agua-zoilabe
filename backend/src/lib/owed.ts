/**
 * "Deuda anterior": what an old month from the paper book costs when it is
 * entered as owed.
 *
 * The board decided on 7 November 2026 that each month entered costs the fee
 * in Configuración for that month, or the house's different amount, and that
 * its late fee is the late fee in Configuración for that month, charged only
 * where the paper book shows one. On 12 November: a house with a different
 * amount owes that amount for its old months too, even for months before the
 * amount was entered in the app.
 */
import { and, asc, desc, eq, gte, isNull, lte, or } from "drizzle-orm";

import type { DbOrTx } from "../db/client.js";
import { householdFees } from "../db/schema.js";
import { feeOn } from "./settings.js";

/**
 * What an old month costs this house: its different amount in force for that
 * month; for a month before its first different amount, that first amount;
 * otherwise the base monthly fee in force for it. Null while none applies.
 */
export function oldMonthPrice(db: DbOrTx, householdId: string, month: string): number | null {
  const inForce = db
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
  if (inForce) {
    return inForce.amount;
  }
  const first = db
    .select({ amount: householdFees.monthlyAmountCentavos, startsOn: householdFees.startsOn })
    .from(householdFees)
    .where(eq(householdFees.householdId, householdId))
    .orderBy(asc(householdFees.startsOn))
    .limit(1)
    .get();
  if (first && month < first.startsOn) {
    return first.amount;
  }
  return feeOn(db, "base_monthly", month);
}

/** The late fee for an old month: the one in Configuración for that month, or null while none is set. */
export function oldMonthLateFee(db: DbOrTx, month: string): number | null {
  return feeOn(db, "late_fee", month);
}
