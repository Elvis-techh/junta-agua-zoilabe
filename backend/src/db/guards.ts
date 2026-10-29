/**
 * What the database itself refuses, so that "nothing is deleted" and "nobody
 * changes history" do not depend on the app's code being right.
 *
 *  - No row of any table can be deleted.
 *  - No row of `audit_log` or `transactions` can be changed either: they are
 *    only ever added to. A money mistake is a reversal entry, not an edit.
 *
 * SQLite has no logins to take permissions away from, so these are triggers
 * that abort the statement. A bug in the app cannot get past them: it would
 * have to drop a trigger on purpose, and no code here does. Someone who opens
 * the database file with other tools could; the history log's hash chain
 * (src/lib/audit.ts) is what catches that, every night.
 *
 * Applied after every migration, written as "every table there is", so a
 * table added by a later migration is guarded from its first deploy without
 * a line here, and a migration that rebuilds a table (SQLite's way of
 * changing a column, which drops the table's triggers) gets them back.
 */
import type Database from "better-sqlite3";

/** Tables whose rows are only ever added: no UPDATE, not even by mistake. */
export const APPEND_ONLY_TABLES = ["audit_log", "transactions"] as const;

/** The message a refused statement fails with. Tests match on these words. */
export const NO_DELETE = "nothing is deleted";
export const NO_UPDATE = "history is never changed";

/** Every table of the app: SQLite's own and Drizzle's bookkeeping left out. */
export function appTables(sqlite: Database.Database): string[] {
  const rows = sqlite
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%'
       ORDER BY name`,
    )
    .all() as Array<{ name: string }>;
  return rows.map((row) => row.name);
}

function quoted(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

export function applyGuards(sqlite: Database.Database): void {
  const tables = appTables(sqlite);
  const missing = APPEND_ONLY_TABLES.filter((table) => !tables.includes(table));
  if (missing.length > 0) {
    throw new Error(`Append-only tables are missing: ${missing.join(", ")}`);
  }

  sqlite.transaction(() => {
    for (const table of tables) {
      sqlite.exec(
        `CREATE TRIGGER IF NOT EXISTS ${quoted(`${table}_no_delete`)} BEFORE DELETE ON ${quoted(table)}
         BEGIN SELECT RAISE(ABORT, '${NO_DELETE}: ${table}'); END`,
      );
    }
    for (const table of APPEND_ONLY_TABLES) {
      sqlite.exec(
        `CREATE TRIGGER IF NOT EXISTS ${quoted(`${table}_no_update`)} BEFORE UPDATE ON ${quoted(table)}
         BEGIN SELECT RAISE(ABORT, '${NO_UPDATE}: ${table}'); END`,
      );
    }
  })();
}
