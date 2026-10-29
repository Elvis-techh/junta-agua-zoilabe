import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { createDb } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrations.js";
import { seedDatabase } from "../src/db/seeding.js";
import { SYSTEM_ACTOR, recordAuditAlone, verifyChain } from "../src/lib/audit.js";
import { backupName, decryptFile, encryptFile, expiredBackups, parseBackupKey } from "../src/lib/backupFiles.js";
import { countRows, databaseFileProblem, snapshotDatabase } from "../src/lib/snapshot.js";
import { HONDURAS_TIME_ZONE } from "../src/lib/time.js";

describe("backup files", () => {
  const dir = mkdtempSync(join(tmpdir(), "zoilabe-backup-test-"));
  after(() => rmSync(dir, { recursive: true, force: true }));

  const key = randomBytes(32);
  const original = randomBytes(200_000);
  const plain = join(dir, "plain");
  const encrypted = join(dir, "encrypted");
  writeFileSync(plain, original);

  it("encrypts and decrypts back to the same bytes", async () => {
    await encryptFile(plain, encrypted, key);
    const sealed = readFileSync(encrypted);
    assert.equal(sealed.subarray(0, 8).toString(), "ZOILABE1");
    assert.equal(sealed.includes(original.subarray(0, 64)), false);

    const restored = join(dir, "restored");
    await decryptFile(encrypted, restored, key);
    assert.deepEqual(readFileSync(restored), original);
  });

  it("refuses the wrong key", async () => {
    await assert.rejects(decryptFile(encrypted, join(dir, "wrong"), randomBytes(32)));
  });

  it("refuses a file with a single byte changed", async () => {
    const tampered = join(dir, "tampered");
    const bytes = readFileSync(encrypted);
    bytes[1000] = bytes[1000]! ^ 0xff;
    writeFileSync(tampered, bytes);
    await assert.rejects(decryptFile(tampered, join(dir, "out"), key));
  });

  it("insists on a 32-byte key", () => {
    assert.throws(() => parseBackupKey(undefined), /32 bytes/);
    assert.throws(() => parseBackupKey(randomBytes(16).toString("base64")), /32 bytes/);
    assert.equal(parseBackupKey(key.toString("base64")).length, 32);
  });
});

describe("backup retention", () => {
  it("keeps the newest copies and lets the rest go", () => {
    const names = Array.from({ length: 35 }, (_, day) =>
      backupName(new Date(Date.UTC(2026, 0, 1 + day, 8, 15))),
    );
    const expired = expiredBackups(names, 30);
    assert.equal(expired.length, 5);
    assert.deepEqual([...expired].sort(), names.slice(0, 5));
  });

  it("names files so they sort by time", () => {
    assert.equal(backupName(new Date("2026-10-23T08:15:00.123Z")), "zoilabe-2026-10-23T08-15-00Z.db.enc");
  });
});

describe("database snapshot", () => {
  const dir = mkdtempSync(join(tmpdir(), "zoilabe-snapshot-test-"));
  const livePath = join(dir, "live.db");
  const live = createDb(livePath);
  runMigrations(live.db, live.sqlite);
  seedDatabase(live.db, HONDURAS_TIME_ZONE);
  recordAuditAlone(live.db, SYSTEM_ACTOR, { area: "settings", action: "test.entry", summary: "Antes de la copia" });

  after(() => {
    live.sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("copies the live database while it is open, history log included", () => {
    const copy = join(dir, "copy.db");
    snapshotDatabase(livePath, copy);

    assert.equal(databaseFileProblem(copy), null);
    const counts = Object.fromEntries(countRows(copy).map((row) => [row.table, row.rows]));
    assert.equal(counts.audit_log, 1);
    assert.ok(counts.settings! >= 2);

    const opened = createDb(copy);
    try {
      assert.deepEqual(verifyChain(opened.db), { ok: true, checked: 1, brokenAtId: null });
    } finally {
      opened.sqlite.close();
    }
  });

  it("never writes over a file that is already there", () => {
    const taken = join(dir, "taken.db");
    writeFileSync(taken, "do not touch");
    assert.throws(() => snapshotDatabase(livePath, taken), /already exists/);
    assert.equal(readFileSync(taken, "utf8"), "do not touch");
  });

  it("does not trust a file that is not a sound database", () => {
    const junk = join(dir, "junk.db");
    writeFileSync(junk, randomBytes(4096));
    assert.notEqual(databaseFileProblem(junk), null);
  });
});
