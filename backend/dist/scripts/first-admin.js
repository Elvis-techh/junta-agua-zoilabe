/**
 * Create the first administrator and print their password.
 *
 * Every other account is created from the Usuarios tab, by someone already
 * signed in. This is the one way in that does not need that, so it refuses to
 * run once an administrator account exists.
 *
 *   npm run user:first-admin -- --name "Nombre Apellido" --phone 99998888
 *
 * Digits alone are a Honduran number. Another country's starts with its code:
 * --phone +15551234567.
 */
import { parseArgs } from "node:util";
import { and, eq, inArray } from "drizzle-orm";
import { newId } from "../auth/session.js";
import { loadConfig } from "../config/env.js";
import { createDb, inTransaction } from "../db/client.js";
import { users } from "../db/schema.js";
import { SYSTEM_ACTOR, recordAudit } from "../lib/audit.js";
import { hashPassword, suggestPassword } from "../lib/password.js";
import { readPhone } from "../lib/phone.js";
const { values } = parseArgs({
    options: { name: { type: "string" }, phone: { type: "string" } },
});
const name = values.name?.trim() ?? "";
const read = readPhone(values.phone?.trim() ?? "");
if (name.length < 3 || "problem" in read) {
    console.error('Usage: npm run user:first-admin -- --name "Nombre Apellido" --phone 99998888');
    process.exit(1);
}
const { phone } = read;
const config = loadConfig();
const { db, sqlite } = createDb(config.databasePath);
// Printed once and never stored: only its hash is kept.
const password = suggestPassword();
const passwordHash = await hashPassword(password);
try {
    inTransaction(db, (tx) => {
        const existing = tx
            .select({ id: users.id })
            .from(users)
            .where(and(eq(users.roleCode, "administrador"), inArray(users.status, ["invited", "active"])))
            .all();
        if (existing.length > 0) {
            throw new Error("An administrator account already exists. Create other accounts from Usuarios.");
        }
        const user = { id: newId(), name, phone, roleCode: "administrador", status: "active", passwordHash };
        tx.insert(users).values(user).run();
        recordAudit(tx, SYSTEM_ACTOR, {
            area: "users",
            action: "user.created",
            summary: `Se creó la cuenta del primer administrador, ${name}`,
            entityType: "user",
            entityId: user.id,
            after: { name, phone, role: "administrador" },
        });
    });
    console.log(`\nAdministrator "${name}" created. Open ${config.appUrl} and sign in with:\n`);
    console.log(`  Número:      ${phone}`);
    console.log(`  Contraseña:  ${password}\n`);
    console.log("Change it in Usuarios if you like. This is the only time it is shown.\n");
}
catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}
finally {
    sqlite.close();
}
//# sourceMappingURL=first-admin.js.map