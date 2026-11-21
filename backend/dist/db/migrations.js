import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { applyGuards } from "./guards.js";
/** drizzle/ sits beside src/ and dist/, so the same path works from either. */
export const MIGRATIONS_FOLDER = fileURLToPath(new URL("../../drizzle", import.meta.url));
/**
 * Bring the schema up to date, then put the guards back (src/db/guards.ts).
 * Drizzle skips migrations already applied, so this is safe on every start:
 * the server runs it before it listens (src/server.ts).
 *
 * Foreign keys are off while it runs, as SQLite's own instructions for
 * changing a table say (Lindero's `runMigrations` explains it in full): a
 * changed column means building a new table and dropping the old one, which
 * enforcement would refuse the moment any row pointed at it. It has to be
 * set out here, because inside the transaction Drizzle wraps the migrations
 * in, the PRAGMA does nothing. `foreign_key_check` afterwards stops the start
 * if a migration left a broken reference behind.
 */
export function runMigrations(db, sqlite, migrationsFolder = MIGRATIONS_FOLDER) {
    sqlite.pragma("foreign_keys = OFF");
    try {
        migrate(db, { migrationsFolder });
        const broken = sqlite.pragma("foreign_key_check");
        if (broken.length > 0) {
            const sample = broken
                .slice(0, 5)
                .map((row) => `${row.table} row ${row.rowid} → ${row.parent}`)
                .join(", ");
            throw new Error(`The migrations left ${broken.length} broken reference(s): ${sample}. Not starting.`);
        }
        applyGuards(sqlite);
    }
    finally {
        sqlite.pragma("foreign_keys = ON");
    }
}
//# sourceMappingURL=migrations.js.map