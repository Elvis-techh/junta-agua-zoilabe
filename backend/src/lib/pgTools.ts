import { execFile } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * Where pg_dump and pg_restore live. Ubuntu keeps the server's tools outside
 * PATH (/usr/lib/postgresql/<version>/bin); the newest version there is used,
 * because a pg_dump older than the server refuses to dump it. PG_BIN
 * overrides.
 */
export function pgBin(tool: "pg_dump" | "pg_restore"): string {
  if (process.env.PG_BIN) {
    return join(process.env.PG_BIN, tool);
  }

  const root = "/usr/lib/postgresql";
  if (existsSync(root)) {
    const newest = readdirSync(root)
      .filter((version) => existsSync(join(root, version, "bin", tool)))
      .sort((a, b) => Number(b) - Number(a))[0];
    if (newest) {
      return join(root, newest, "bin", tool);
    }
  }
  return tool;
}

/** Run a PostgreSQL tool; its stderr becomes the error message when it fails. */
export async function runPgTool(tool: "pg_dump" | "pg_restore", args: string[]): Promise<string> {
  try {
    const { stdout } = await run(pgBin(tool), args, { maxBuffer: 64 * 1024 * 1024 });
    return stdout;
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr?.trim();
    throw new Error(`${tool} failed: ${stderr || (error as Error).message}`);
  }
}
