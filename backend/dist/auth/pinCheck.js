import { eq, sql } from "drizzle-orm";
import { inTransaction } from "../db/client.js";
import { users } from "../db/schema.js";
import { recordAudit } from "../lib/audit.js";
import { verifyPin } from "../lib/pin.js";
/** After this many wrong PINs in a row the account locks until an administrator unlocks it. */
export const MAX_WRONG_PINS = 5;
/**
 * Check a PIN for a user, counting wrong ones toward the lock.
 *
 * Used both at sign-in and when a sensitive action asks for the PIN again:
 * guessing through either door counts the same. Every wrong PIN and the lock
 * itself go to the history log.
 */
export async function checkPin(db, user, pin, actor) {
    if (user.lockedAt) {
        return { ok: false, locked: true };
    }
    if (user.pinHash && (await verifyPin(pin, user.pinHash))) {
        db.update(users)
            .set({ failedPinCount: 0 })
            .where(eq(users.id, user.id))
            .run();
        return { ok: true };
    }
    return inTransaction(db, (tx) => {
        // Counted in the database, not read-then-written, so two wrong PINs at
        // the same moment both count.
        const now = new Date().toISOString();
        const row = tx
            .update(users)
            .set({
            failedPinCount: sql `${users.failedPinCount} + 1`,
            lockedAt: sql `CASE WHEN ${users.failedPinCount} + 1 >= ${MAX_WRONG_PINS} THEN ${now} ELSE ${users.lockedAt} END`,
        })
            .where(eq(users.id, user.id))
            .returning({ failedPinCount: users.failedPinCount, lockedAt: users.lockedAt })
            .get();
        const failed = row?.failedPinCount ?? MAX_WRONG_PINS;
        recordAudit(tx, actor, {
            area: "security",
            action: "security.pin_failed",
            summary: `PIN equivocado para ${user.name} (intento ${failed} de ${MAX_WRONG_PINS})`,
            entityType: "user",
            entityId: user.id,
        });
        if (row?.lockedAt) {
            recordAudit(tx, actor, {
                area: "security",
                action: "security.account_locked",
                summary: `La cuenta de ${user.name} se bloqueó después de ${MAX_WRONG_PINS} PIN equivocados`,
                entityType: "user",
                entityId: user.id,
            });
            return { ok: false, locked: true };
        }
        return { ok: false, locked: false, attemptsLeft: MAX_WRONG_PINS - failed };
    });
}
//# sourceMappingURL=pinCheck.js.map