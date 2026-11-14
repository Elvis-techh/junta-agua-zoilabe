/**
 * Start the local database over: delete the file, create it, migrate and
 * seed. Development only — it refuses to run with NODE_ENV=production.
 */
import { rmSync } from "node:fs";
import { loadConfig } from "../config/env.js";
import { createDb } from "./client.js";
import { runMigrations } from "./migrations.js";
import { seedDatabase } from "./seeding.js";
const config = loadConfig();
if (config.nodeEnv === "production") {
    throw new Error("db:reset never runs in production.");
}
// The file and, under WAL, its two companions.
for (const suffix of ["", "-wal", "-shm"]) {
    rmSync(`${config.databasePath}${suffix}`, { force: true });
}
const { db, sqlite } = createDb(config.databasePath);
try {
    runMigrations(db, sqlite);
    seedDatabase(db, config.timeZone);
}
finally {
    sqlite.close();
}
console.log(`Local database reset: empty, migrated and seeded (${config.databasePath}).`);
//# sourceMappingURL=reset.js.map