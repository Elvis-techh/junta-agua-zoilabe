import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

import * as schema from "./schema.js";

export type Db = ReturnType<typeof createDb>["db"];
/** A transaction handle; every helper that writes accepts either. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;

/** Lowercase without accents, so "perez" finds "Pérez". The census search uses it on both sides. */
export function searchText(value: string): string {
  return value.toLocaleLowerCase("es-HN").normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/**
 * Opens the database file (one file, `DATABASE_PATH`) and wraps it in Drizzle.
 *
 * The same settings as Lindero's, each one needed for a web app:
 *
 *  - WAL: someone reading the census does not block someone saving to it.
 *  - foreign_keys: SQLite ignores them unless asked. Without this a household
 *    could point at a sector that does not exist.
 *  - busy_timeout: a second process writing at the same moment (the nightly
 *    log check, `user:first-admin`) waits up to 5 s instead of failing.
 *  - synchronous NORMAL: flushes at each commit. Safe under WAL, and faster.
 *  - recursive_triggers: without it, `INSERT OR REPLACE` and `UPDATE OR
 *    REPLACE` delete the row in their way without firing its DELETE trigger,
 *    so they would get past the guards (src/db/guards.ts) and could rewrite a
 *    money entry. With it, the guard refuses them like any other delete.
 *
 * `search_text()` is the census search's rule (`searchText`), made available
 * to SQL. SQLite's own `lower()` only knows A to Z.
 */
export function createDb(databasePath: string) {
  if (databasePath !== ":memory:") {
    // better-sqlite3 does not create missing folders itself.
    mkdirSync(dirname(databasePath), { recursive: true });
  }

  const sqlite = new Database(databasePath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("recursive_triggers = ON");
  sqlite.function("search_text", { deterministic: true }, (value: unknown) =>
    typeof value === "string" ? searchText(value) : value,
  );

  const db = drizzle(sqlite, { schema });

  return { db, sqlite };
}

/**
 * Run `work` as one transaction, and the only kind there is here.
 *
 * It must be synchronous: better-sqlite3 refuses a transaction that returns a
 * promise, so inside `work` every query ends in `.get()`, `.all()` or
 * `.run()`. That is also what puts writes in single file without any lock of
 * our own: Node runs one piece of JavaScript at a time, so nothing else in
 * the API can happen between a transaction's first query and its commit.
 *
 * IMMEDIATE takes SQLite's write lock at the start rather than at the first
 * write, so another process (a script) cannot write between this
 * transaction's reads and its writes either.
 */
export function inTransaction<T>(db: DbOrTx, work: (tx: Tx) => T): T {
  return db.transaction(work, { behavior: "immediate" });
}
