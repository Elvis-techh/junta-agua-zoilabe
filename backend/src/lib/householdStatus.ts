/**
 * A household's status and water connection over time (owner, 14 November
 * 2026), kept in `household_status_changes`.
 *
 *  - Each entry says that from its date on, the house is active or inactive,
 *    with this connection. The state on a day is the newest entry whose date
 *    is not after it: an entry dated in the past takes over from that date,
 *    and nothing entered before it is changed. A wrong entry is put right by
 *    a newer one.
 *  - A house "has service" in a month when, on the day that month's payment
 *    deadline and grace days end (Plazo de pago), it was active and had water
 *    (connected or shared). Only then is the month owed, and only then can it
 *    owe a late fee (owner, 14 November 2026).
 *  - `households.status` and `households.water_connection` keep today's
 *    state; `recordStatus` writes both in the same transaction.
 */
import { asc, eq } from "drizzle-orm";

import type { DbOrTx, Tx } from "../db/client.js";
import { householdStatusChanges, households, users } from "../db/schema.js";
import type { Deadline } from "./settings.js";
import { monthDeadline } from "./settings.js";

type Status = (typeof households.$inferSelect)["status"];
type WaterConnection = (typeof households.$inferSelect)["waterConnection"];

export interface StatusEntry {
  id: number;
  status: Status;
  inactiveReason: string | null;
  waterConnection: WaterConnection;
  startsOn: string;
  createdAt: Date;
  createdBy: string | null;
}

/** Every entry of a house, in the order they were entered. */
export function statusEntries(db: DbOrTx, householdId: string): StatusEntry[] {
  return db
    .select({
      id: householdStatusChanges.id,
      status: householdStatusChanges.status,
      inactiveReason: householdStatusChanges.inactiveReason,
      waterConnection: householdStatusChanges.waterConnection,
      startsOn: householdStatusChanges.startsOn,
      createdAt: householdStatusChanges.createdAt,
      createdBy: users.name,
    })
    .from(householdStatusChanges)
    .leftJoin(users, eq(users.id, householdStatusChanges.createdBy))
    .where(eq(householdStatusChanges.householdId, householdId))
    .orderBy(asc(householdStatusChanges.id))
    .all();
}

/**
 * The entry in force on `day`: the newest one whose date is not after it.
 * Before every entry's date, the first one entered (the registration).
 */
export function entryOn(entries: readonly StatusEntry[], day: string): StatusEntry | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (entries[index]!.startsOn <= day) {
      return entries[index]!;
    }
  }
  return entries[0] ?? null;
}

/** Active, with water (connected or shared). */
export function hasService(entry: Pick<StatusEntry, "status" | "waterConnection"> | null): boolean {
  return entry !== null && entry.status === "active" && entry.waterConnection !== "not_connected";
}

/**
 * Of these months, those in which the house had service on the day each
 * one's deadline and grace days end. A house with no entries at all counts
 * as having service, as every house did before the history existed.
 */
export function monthsWithService(db: DbOrTx, householdId: string, months: readonly string[], rule: Deadline): Set<string> {
  const entries = statusEntries(db, householdId);
  if (entries.length === 0) {
    return new Set(months);
  }
  return new Set(months.filter((month) => hasService(entryOn(entries, monthDeadline(month, rule).lateAfter))));
}

/**
 * Enter a change of status or connection from `startsOn`, and make it the
 * house's state of today: the newest entry always covers today, since its
 * date is not after today.
 */
export function recordStatus(
  tx: Tx,
  entry: { householdId: string; status: Status; inactiveReason: string | null; waterConnection: WaterConnection; startsOn: string; createdBy: string | null },
): void {
  tx.insert(householdStatusChanges).values(entry).run();
  tx.update(households)
    .set({ status: entry.status, inactiveReason: entry.inactiveReason, waterConnection: entry.waterConnection })
    .where(eq(households.id, entry.householdId))
    .run();
}
