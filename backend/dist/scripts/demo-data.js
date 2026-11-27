/**
 * Fill the test copy with made-up data: three months back and this one
 * (src/lib/demoData.ts), so a change can be tried on a phone with something
 * to look at.
 *
 *   ALLOW_MADE_UP_DATA=yes node --env-file=/opt/zoilabe-test/env dist/scripts/demo-data.js
 *
 * It only ever fills a database that has no households and no money entered,
 * and only when ALLOW_MADE_UP_DATA=yes is typed, so it cannot be run on the
 * real app's database by accident once that has real data. It needs the
 * administrator to exist already (first-admin), and acts as that account.
 */
import { and, eq, inArray } from "drizzle-orm";
import { buildApp } from "../app.js";
import { SESSION_COOKIE, endSessions, openSession } from "../auth/session.js";
import { loadConfig } from "../config/env.js";
import { createDb } from "../db/client.js";
import { households, openingBalances, transactions, users } from "../db/schema.js";
import { fillWithMadeUpData } from "../lib/demoData.js";
import { businessToday } from "../lib/time.js";
if (process.env.ALLOW_MADE_UP_DATA !== "yes") {
    console.error("This puts MADE-UP data in the database. To go on, run it again starting with ALLOW_MADE_UP_DATA=yes");
    process.exit(1);
}
const config = loadConfig();
const { db, sqlite } = createDb(config.databasePath);
try {
    const used = db.select({ id: households.id }).from(households).limit(1).get() ??
        db.select({ id: openingBalances.id }).from(openingBalances).limit(1).get() ??
        db.select({ id: transactions.id }).from(transactions).limit(1).get();
    if (used) {
        console.error("This database already has data, so nothing was added. Made-up data only goes into an empty one:\n" +
            "see \"Starting over with an empty test copy\" in docs/test-copy.md.");
        process.exit(1);
    }
    const admin = db
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(and(eq(users.roleCode, "administrador"), inArray(users.status, ["invited", "active"])))
        .limit(1)
        .get();
    if (!admin) {
        console.error("There is no administrator yet. Make one first (first-admin.js in docs/test-copy.md, step 6).");
        process.exit(1);
    }
    // "test" only keeps the server's request log out of this output; the ceiling is lifted for the few hundred requests.
    const app = await buildApp({ ...config, nodeEnv: "test", requestsPerMinute: 100000 }, db);
    const session = openSession(db, admin.id);
    try {
        const today = businessToday(config.timeZone);
        const result = await fillWithMadeUpData(app, `${SESSION_COOKIE}=${session.token}`, today);
        console.log(`\nMade-up data added, acting as ${admin.name}, from ${result.months[0]} to ${today}:`);
        console.log(`  ${result.households} families, ${result.payments} fee payments, ${result.income} other income,` +
            ` ${result.expenses} expenses, ${result.undone} entries undone.\n`);
    }
    finally {
        endSessions(db, { ids: [session.id] }, admin.id);
        await app.close();
    }
}
finally {
    sqlite.close();
}
//# sourceMappingURL=demo-data.js.map