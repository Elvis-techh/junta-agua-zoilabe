/**
 * Create the first administrator and print their invitation link.
 *
 * Every other account is created from the Usuarios tab, by someone already
 * signed in. This is the one way in that does not need that, so it refuses to
 * run once an administrator account exists.
 *
 *   npm run user:first-admin -- --name "Nombre Apellido" --phone 99998888
 */
import { parseArgs } from "node:util";
import { and, eq, inArray } from "drizzle-orm";
import { newId } from "../auth/session.js";
import { loadConfig } from "../config/env.js";
import { createDb, inTransaction } from "../db/client.js";
import { users } from "../db/schema.js";
import { SYSTEM_ACTOR, recordAudit } from "../lib/audit.js";
import { createInvitation } from "../lib/invitations.js";
const { values } = parseArgs({
    options: { name: { type: "string" }, phone: { type: "string" } },
});
const name = values.name?.trim() ?? "";
const phone = values.phone?.trim() ?? "";
if (name.length < 3 || !/^[0-9]{8}$/.test(phone)) {
    console.error('Usage: npm run user:first-admin -- --name "Nombre Apellido" --phone 99998888');
    process.exit(1);
}
const config = loadConfig();
const { db, sqlite } = createDb(config.databasePath);
try {
    const invitation = inTransaction(db, (tx) => {
        const existing = tx
            .select({ id: users.id })
            .from(users)
            .where(and(eq(users.roleCode, "administrador"), inArray(users.status, ["invited", "active"])))
            .all();
        if (existing.length > 0) {
            throw new Error("An administrator account already exists. Create other accounts from Usuarios.");
        }
        const user = { id: newId(), name, phone, roleCode: "administrador", status: "invited" };
        tx.insert(users).values(user).run();
        recordAudit(tx, SYSTEM_ACTOR, {
            area: "users",
            action: "user.created",
            summary: `Se creó la cuenta del primer administrador, ${name}`,
            entityType: "user",
            entityId: user.id,
            after: { name, phone, role: "administrador" },
        });
        return createInvitation(tx, user, null, config.appUrl);
    });
    console.log(`\nAdministrator "${name}" created. The link works once, until ${invitation.expiresAt.toISOString()}.\n`);
    console.log(`Invitation link:\n  ${invitation.url}\n`);
    console.log(`Send it by WhatsApp:\n  ${invitation.whatsappUrl}\n`);
}
catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}
finally {
    sqlite.close();
}
//# sourceMappingURL=first-admin.js.map