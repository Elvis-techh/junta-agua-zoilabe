/**
 * Restore a backup into a NEW database, check it, and report what it holds.
 *
 *   npm run db:restore -- --file backups/zoilabe-….dump.enc --into zoilabe_restored
 *   npm run db:restore -- --from-spaces latest --into zoilabe_restored
 *
 * It never writes into the live database: `--into` must name a database that
 * does not exist yet. Switching the app over to the restored copy is a
 * separate, deliberate step in docs/restore.md. Used for the restore test
 * before launch and every three months, and for a real recovery.
 *
 * Needs DATABASE_SUPERUSER_URL (to create the database), DATABASE_ADMIN_URL,
 * DATABASE_URL and BACKUP_ENCRYPTION_KEY.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { sql } from "drizzle-orm";
import pg from "pg";

import { createDb } from "../db/client.js";
import { requireEnv } from "../db/env.js";
import { applyGrants, ensureDatabase, parseLogin } from "../db/roles.js";
import { verifyChain } from "../lib/audit.js";
import { decryptFile, parseBackupKey } from "../lib/backupFiles.js";
import { runPgTool } from "../lib/pgTools.js";
import { spacesFromEnv } from "../lib/spaces.js";

const { values } = parseArgs({
  options: {
    file: { type: "string" },
    "from-spaces": { type: "string" },
    into: { type: "string" },
  },
});

function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

const into = values.into ?? "";
if (!/^[a-z_][a-z0-9_]{0,62}$/.test(into)) {
  console.error("Name the new database with --into, e.g. --into zoilabe_restored");
  process.exit(1);
}

const superuserUrl = requireEnv("DATABASE_SUPERUSER_URL");
const adminUrl = requireEnv("DATABASE_ADMIN_URL");
const appUrl = requireEnv("DATABASE_URL");
const key = parseBackupKey(process.env.BACKUP_ENCRYPTION_KEY);

if (into === parseLogin(adminUrl).database) {
  console.error(`"${into}" is the live database. Restore into a new name, then follow docs/restore.md.`);
  process.exit(1);
}

const check = new pg.Client({ connectionString: superuserUrl });
await check.connect();
const exists = await check.query("SELECT 1 FROM pg_database WHERE datname = $1", [into]);
await check.end();
if (exists.rowCount) {
  console.error(`A database called "${into}" already exists. Choose another name.`);
  process.exit(1);
}

const work = mkdtempSync(join(tmpdir(), "zoilabe-restore-"));
const encrypted = join(work, "backup.dump.enc");
const plain = join(work, "backup.dump");

try {
  let source: string;
  if (values["from-spaces"]) {
    const spaces = spacesFromEnv();
    if (!spaces) throw new Error("SPACES_* are not set.");
    let objectKey = values["from-spaces"];
    if (objectKey === "latest") {
      const daily = await spaces.list(`${spaces.prefix}/daily/`);
      objectKey = [...daily].sort().reverse()[0] ?? "";
      if (!objectKey) throw new Error("There are no backups in the bucket.");
    }
    await spaces.download(objectKey, encrypted);
    source = encrypted;
    console.log(`Downloaded ${objectKey}`);
  } else if (values.file) {
    source = values.file;
  } else {
    throw new Error("Say which backup: --file <path> or --from-spaces latest|<key>");
  }

  await decryptFile(source, plain, key);

  const targetAdmin = withDatabase(adminUrl, into);
  const targetApp = withDatabase(appUrl, into);
  await ensureDatabase(superuserUrl, targetAdmin, targetApp);
  await runPgTool("pg_restore", ["--no-owner", "--exit-on-error", `--dbname=${targetAdmin}`, plain]);

  const { db, pool } = createDb(targetAdmin, 1);
  try {
    const client = await pool.connect();
    try {
      await applyGrants(client, parseLogin(appUrl).user);
    } finally {
      client.release();
    }

    const counts = await db.execute<{ table: string; rows: string }>(sql`
      SELECT 'users' AS table, count(*)::text AS rows FROM users
      UNION ALL SELECT 'households', count(*)::text FROM households
      UNION ALL SELECT 'people', count(*)::text FROM people
      UNION ALL SELECT 'transactions', count(*)::text FROM transactions
      UNION ALL SELECT 'audit_log', count(*)::text FROM audit_log
      UNION ALL SELECT 'settings', count(*)::text FROM settings`);
    const chain = await verifyChain(db);

    console.log(`\nRestored into "${into}".`);
    for (const row of counts.rows) console.log(`  ${row.table.padEnd(13)} ${row.rows}`);
    console.log(
      chain.ok
        ? `  History log chain intact (${chain.checked} entries).`
        : `  History log chain BROKEN at entry ${chain.brokenAtId}.`,
    );
    if (!chain.ok) process.exitCode = 1;
  } finally {
    await pool.end();
  }
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
} finally {
  rmSync(work, { recursive: true, force: true });
}
