/** Tables whose rows are only ever added: no UPDATE, not even by mistake. */
export const APPEND_ONLY_TABLES = ["audit_log", "transactions"];
/** The message a refused statement fails with. Tests match on these words. */
export const NO_DELETE = "nothing is deleted";
export const NO_UPDATE = "history is never changed";
/** Every table of the app: SQLite's own and Drizzle's bookkeeping left out. */
export function appTables(sqlite) {
    const rows = sqlite
        .prepare(`SELECT name FROM sqlite_master
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%'
       ORDER BY name`)
        .all();
    return rows.map((row) => row.name);
}
function quoted(identifier) {
    return `"${identifier.replace(/"/g, '""')}"`;
}
export function applyGuards(sqlite) {
    const tables = appTables(sqlite);
    const missing = APPEND_ONLY_TABLES.filter((table) => !tables.includes(table));
    if (missing.length > 0) {
        throw new Error(`Append-only tables are missing: ${missing.join(", ")}`);
    }
    sqlite.transaction(() => {
        for (const table of tables) {
            sqlite.exec(`CREATE TRIGGER IF NOT EXISTS ${quoted(`${table}_no_delete`)} BEFORE DELETE ON ${quoted(table)}
         BEGIN SELECT RAISE(ABORT, '${NO_DELETE}: ${table}'); END`);
        }
        for (const table of APPEND_ONLY_TABLES) {
            sqlite.exec(`CREATE TRIGGER IF NOT EXISTS ${quoted(`${table}_no_update`)} BEFORE UPDATE ON ${quoted(table)}
         BEGIN SELECT RAISE(ABORT, '${NO_UPDATE}: ${table}'); END`);
        }
    })();
}
//# sourceMappingURL=guards.js.map