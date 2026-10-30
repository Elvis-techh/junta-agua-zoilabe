/**
 * Restore a backup into a NEW database file, check it, and report what it holds.
 *
 *   npm run db:restore -- --file backups/zoilabe-….db.enc --into data/restored.db
 *   npm run db:restore -- --from-spaces latest --into data/restored.db
 *
 * It never writes over the live database: `--into` must name a file that
 * does not exist yet. Putting the restored copy in the live one's place is a
 * separate, deliberate step in docs/restore.md. Used for the restore test
 * before launch and every three months, and for a real recovery.
 *
 * Needs BACKUP_ENCRYPTION_KEY, and SPACES_* for --from-spaces.
 */
import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

import { loadConfig } from "../config/env.js";
import { createDb } from "../db/client.js";
import { verifyChain } from "../lib/audit.js";
import { decryptFile, parseBackupKey } from "../lib/backupFiles.js";
import { countRows, databaseFileProblem } from "../lib/snapshot.js";
import { spacesFromEnv } from "../lib/spaces.js";

const { values } = parseArgs({
  options: {
    file: { type: "string" },
    "from-spaces": { type: "string" },
    into: { type: "string" },
  },
});

if (!values.into) {
  console.error("Name the new database file with --into, e.g. --into data/restored.db");
  process.exit(1);
}

const into = resolve(values.into);
const key = parseBackupKey(process.env.BACKUP_ENCRYPTION_KEY);

if (into === loadConfig().databasePath) {
  console.error(`${into} is the live database. Restore into a new file, then follow docs/restore.md.`);
  process.exit(1);
}
if (existsSync(into)) {
  console.error(`${into} already exists. Choose another name.`);
  process.exit(1);
}

const work = mkdtempSync(join(tmpdir(), "zoilabe-restore-"));
const encrypted = join(work, "backup.db.enc");
const plain = join(work, "backup.db");

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
  const problem = databaseFileProblem(plain);
  if (problem) {
    throw new Error(`The backup opened but cannot be trusted. ${problem}`);
  }
  copyFileSync(plain, into);

  const { db, sqlite } = createDb(into);
  let chain;
  try {
    chain = verifyChain(db);
  } finally {
    sqlite.close();
  }

  console.log(`\nRestored into ${into}.`);
  for (const row of countRows(into)) console.log(`  ${row.table.padEnd(13)} ${row.rows}`);
  console.log(
    chain.ok
      ? `  History log chain intact (${chain.checked} entries).`
      : `  History log chain BROKEN at entry ${chain.brokenAtId}.`,
  );
  if (!chain.ok) process.exitCode = 1;
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
} finally {
  rmSync(work, { recursive: true, force: true });
}
