/**
 * A copy of the database file that can be trusted: made while the app keeps
 * running, and opened and checked before anyone relies on it.
 */
import { existsSync, rmSync } from "node:fs";

import Database from "better-sqlite3";

/** The tables a restore reports on, in the order it prints them. */
export const COUNTED_TABLES = ["users", "households", "people", "transactions", "audit_log", "settings"] as const;

function literal(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Why a database file cannot be trusted, or null if it can: it must open,
 * pass SQLite's `quick_check`, and hold the history log.
 */
export function databaseFileProblem(path: string): string | null {
  let file: Database.Database;
  try {
    file = new Database(path, { readonly: true, fileMustExist: true });
  } catch (error) {
    return `It does not open as a database: ${(error as Error).message}`;
  }
  try {
    const check = file.pragma("quick_check", { simple: true });
    if (check !== "ok") {
      return `quick_check: ${String(check)}`;
    }
    const hasLog = file.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'audit_log'").get();
    return hasLog ? null : "It does not contain the history log.";
  } catch (error) {
    return (error as Error).message;
  } finally {
    file.close();
  }
}

/**
 * Write a consistent copy of the live database to `target`, a path that must
 * not exist yet. `VACUUM INTO` copies everything committed at that instant,
 * history log included, without stopping the API. A copy that fails the check
 * is removed, so a broken one can never be encrypted and sent off.
 */
export function snapshotDatabase(source: string, target: string): void {
  if (!existsSync(source)) {
    throw new Error(`There is no database at ${source}.`);
  }
  if (existsSync(target)) {
    throw new Error(`${target} already exists.`);
  }

  const live = new Database(source, { readonly: true, fileMustExist: true });
  try {
    live.exec(`VACUUM INTO ${literal(target)}`);
  } finally {
    live.close();
  }

  const problem = databaseFileProblem(target);
  if (problem) {
    rmSync(target, { force: true });
    throw new Error(`The copy failed its check and was removed. ${problem}`);
  }
}

/** Row counts of the main tables, for the restore report. */
export function countRows(path: string): Array<{ table: string; rows: number }> {
  const file = new Database(path, { readonly: true, fileMustExist: true });
  try {
    return COUNTED_TABLES.map((table) => ({
      table,
      rows: (file.prepare(`SELECT count(*) AS rows FROM "${table}"`).get() as { rows: number }).rows,
    }));
  } finally {
    file.close();
  }
}
