import { eq, sql } from "drizzle-orm";

import type { Db } from "../db/client.js";
import { users } from "../db/schema.js";
import type { Actor } from "../lib/audit.js";
import { recordAudit } from "../lib/audit.js";
import { verifyPin } from "../lib/pin.js";

/** After this many wrong PINs in a row the account locks until an administrator unlocks it. */
export const MAX_WRONG_PINS = 5;

export type PinCheck =
  | { ok: true }
  | { ok: false; locked: false; attemptsLeft: number }
  | { ok: false; locked: true };

/**
 * Check a PIN for a user, counting wrong ones toward the lock.
 *
 * Used both at sign-in and when a sensitive action asks for the PIN again:
 * guessing through either door counts the same. Every wrong PIN and the lock
 * itself go to the history log.
 */
export async function checkPin(
  db: Db,
  user: { id: string; name: string; pinHash: string | null; lockedAt: Date | null },
  pin: string,
  actor: Actor,
): Promise<PinCheck> {
  if (user.lockedAt) {
    return { ok: false, locked: true };
  }

  if (user.pinHash && (await verifyPin(pin, user.pinHash))) {
    await db
      .update(users)
      .set({ failedPinCount: 0 })
      .where(eq(users.id, user.id));
    return { ok: true };
  }

  return db.transaction(async (tx) => {
    // Counted in the database, not read-then-written, so two wrong PINs at
    // the same moment both count.
    const [row] = await tx
      .update(users)
      .set({
        failedPinCount: sql`${users.failedPinCount} + 1`,
        lockedAt: sql`CASE WHEN ${users.failedPinCount} + 1 >= ${MAX_WRONG_PINS} THEN now() ELSE ${users.lockedAt} END`,
      })
      .where(eq(users.id, user.id))
      .returning({ failedPinCount: users.failedPinCount, lockedAt: users.lockedAt });

    const failed = row?.failedPinCount ?? MAX_WRONG_PINS;

    await recordAudit(tx, actor, {
      area: "security",
      action: "security.pin_failed",
      summary: `PIN equivocado para ${user.name} (intento ${failed} de ${MAX_WRONG_PINS})`,
      entityType: "user",
      entityId: user.id,
    });

    if (row?.lockedAt) {
      await recordAudit(tx, actor, {
        area: "security",
        action: "security.account_locked",
        summary: `La cuenta de ${user.name} se bloqueó después de ${MAX_WRONG_PINS} PIN equivocados`,
        entityType: "user",
        entityId: user.id,
      });
      return { ok: false, locked: true } as const;
    }

    return { ok: false, locked: false, attemptsLeft: MAX_WRONG_PINS - failed } as const;
  });
}
