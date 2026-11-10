/**
 * Give an account a new password from the server's console, and print it.
 *
 * Usuarios is the usual place to change a password. This is for when nobody
 * who can sign in is able to: the only administrator forgot theirs, or the
 * accounts made before 9 November 2026 (when a PIN was the way in) have no
 * password yet. Every phone signed in to that account signs out.
 *
 *   npm run user:password -- --phone 99998888
 *
 * Digits alone are a Honduran number. Another country's starts with its code:
 * --phone +15551234567.
 */
import { parseArgs } from "node:util";

import { eq } from "drizzle-orm";

import { endSessions } from "../auth/session.js";
import { loadConfig } from "../config/env.js";
import { createDb, inTransaction } from "../db/client.js";
import { users } from "../db/schema.js";
import { SYSTEM_ACTOR, recordAudit } from "../lib/audit.js";
import { hashPassword, suggestPassword } from "../lib/password.js";
import { readPhone } from "../lib/phone.js";

const { values } = parseArgs({ options: { phone: { type: "string" } } });
const read = readPhone(values.phone?.trim() ?? "");

if ("problem" in read) {
  console.error("Usage: npm run user:password -- --phone 99998888");
  process.exit(1);
}
const { phone } = read;

const config = loadConfig();
const { db, sqlite } = createDb(config.databasePath);
// Printed once and never stored: only its hash is kept.
const password = suggestPassword();
const passwordHash = await hashPassword(password);

try {
  const name = inTransaction(db, (tx) => {
    const user = tx.select().from(users).where(eq(users.phone, phone)).get();
    if (!user) {
      throw new Error(`No account has the number ${phone}.`);
    }
    if (user.status === "suspended" || user.status === "deactivated") {
      throw new Error(`${user.name}'s account is ${user.status}. Reactivate it from Usuarios first.`);
    }

    const status = user.status === "invited" ? "active" : user.status;
    tx.update(users).set({ passwordHash, status }).where(eq(users.id, user.id)).run();
    endSessions(tx, { userId: user.id }, null);
    recordAudit(tx, SYSTEM_ACTOR, {
      area: "users",
      action: "user.password_changed",
      summary: `Se puso una contraseña nueva a la cuenta de ${user.name} desde el servidor`,
      entityType: "user",
      entityId: user.id,
      ...(status !== user.status ? { before: { status: user.status }, after: { status } } : {}),
    });
    return user.name;
  });

  console.log(`\nNew password for ${name}. Open ${config.appUrl} and sign in with:\n`);
  console.log(`  Número:      ${phone}`);
  console.log(`  Contraseña:  ${password}\n`);
  console.log("Change it in Usuarios if you like. This is the only time it is shown.\n");
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
} finally {
  sqlite.close();
}
