/**
 * The nightly backup (App Plan, "Backups"):
 *
 *  1. pg_dump the whole database, history log included, as the admin login.
 *  2. Prove the dump opens (pg_restore --list), or stop.
 *  3. Encrypt it (AES-256-GCM, BACKUP_ENCRYPTION_KEY).
 *  4. Upload it to this app's private Spaces bucket under daily/; on the first
 *     day of a month (Honduras time) also under monthly/. Keep 30 daily and
 *     12 monthly copies.
 *  5. File "last backup" for Configuración's system status.
 *
 * Without SPACES_* (local development) the encrypted file stays in
 * backend/backups with the same 30-copy rule, and the script says so: a backup
 * on the same disk as the database is not a backup.
 *
 * Run: `npm run db:backup` here; on the server `node dist/scripts/backup.js`
 * from the systemd timer (docs/deployment-shared-droplet.md).
 */
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { createDb } from "../db/client.js";
import { requireEnv } from "../db/env.js";
import { settings } from "../db/schema.js";
import { backupName, encryptFile, expiredBackups, parseBackupKey } from "../lib/backupFiles.js";
import { runPgTool } from "../lib/pgTools.js";
import { spacesFromEnv } from "../lib/spaces.js";
import { HONDURAS_TIME_ZONE, businessToday } from "../lib/time.js";

const KEEP_DAILY = 30;
const KEEP_MONTHLY = 12;
/** Recent copies kept on the droplet too, for a quick restore without downloading. */
const KEEP_LOCAL_WITH_SPACES = 2;

const adminUrl = requireEnv("DATABASE_ADMIN_URL");
const key = parseBackupKey(process.env.BACKUP_ENCRYPTION_KEY);
const spaces = spacesFromEnv();

const backupDir = process.env.BACKUP_PATH ?? fileURLToPath(new URL("../../backups", import.meta.url));
mkdirSync(backupDir, { recursive: true, mode: 0o700 });

const now = new Date();
const name = backupName(now);
const plainFile = join(backupDir, name.replace(/\.enc$/, ""));
const encryptedFile = join(backupDir, name);

try {
  await runPgTool("pg_dump", ["--format=custom", "--compress=9", `--file=${plainFile}`, `--dbname=${adminUrl}`]);
  // A backup nobody has opened is a hope: list its contents before trusting it.
  const contents = await runPgTool("pg_restore", ["--list", plainFile]);
  if (!contents.includes("TABLE DATA public audit_log")) {
    throw new Error("The dump does not contain the history log; stopping.");
  }
  await encryptFile(plainFile, encryptedFile, key);
} finally {
  // The unencrypted dump never outlives this run.
  rmSync(plainFile, { force: true });
}

let where: string;
if (spaces) {
  const dailyKey = `${spaces.prefix}/daily/${name}`;
  await spaces.upload(encryptedFile, dailyKey);

  const isFirstOfMonth = businessToday(HONDURAS_TIME_ZONE, now).endsWith("-01");
  const monthly = await spaces.list(`${spaces.prefix}/monthly/`);
  if (isFirstOfMonth || monthly.length === 0) {
    await spaces.copy(dailyKey, `${spaces.prefix}/monthly/${name}`);
  }

  for (const [folder, keep] of [["daily", KEEP_DAILY], ["monthly", KEEP_MONTHLY]] as const) {
    const keys = await spaces.list(`${spaces.prefix}/${folder}/`);
    for (const old of expiredBackups(keys, keep)) {
      await spaces.remove(old);
    }
  }
  where = `spaces://${spaces.bucket}/${dailyKey}`;
} else {
  where = encryptedFile;
  console.warn("SPACES_* are not set: this backup is only on this machine's disk.");
}

const local = readdirSync(backupDir).filter((file) => /^zoilabe-.*\.dump\.enc$/.test(file));
for (const old of expiredBackups(local, spaces ? KEEP_LOCAL_WITH_SPACES : KEEP_DAILY)) {
  rmSync(join(backupDir, old));
}

const { db, pool } = createDb(adminUrl, 1);
try {
  await db.insert(settings).values({
    key: "system.last_backup",
    value: { at: now.toISOString(), name, offsite: spaces !== null },
    effectiveFrom: businessToday(HONDURAS_TIME_ZONE, now),
  });
} finally {
  await pool.end();
}

console.log(`Backup ${name} -> ${where}`);
