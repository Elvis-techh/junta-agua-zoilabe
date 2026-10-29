import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { asc, eq, sql } from "drizzle-orm";

import { inTransaction } from "../src/db/client.js";
import { auditLog } from "../src/db/schema.js";
import {
  GENESIS_HASH,
  SYSTEM_ACTOR,
  canonicalJson,
  recordAudit,
  recordAuditAlone,
  verifyChain,
} from "../src/lib/audit.js";
import type { TestDatabase } from "./helpers.js";
import { createTestDatabase, rejectsWithDbError } from "./helpers.js";

const entry = (n: number) => ({
  area: "settings" as const,
  action: "test.entry",
  summary: `Entrada de prueba ${n}`,
  entityType: "test",
  entityId: String(n),
  before: { amount: n, nested: { b: 2, a: 1 } },
  after: { amount: n + 1, list: [3, 1, 2] },
});

describe("history log", () => {
  let t: TestDatabase;
  before(async () => {
    t = await createTestDatabase();
  });
  after(async () => {
    await t.close();
  });

  it("chains each entry to the one before it", async () => {
    await recordAuditAlone(t.db, SYSTEM_ACTOR, entry(1));
    await recordAuditAlone(t.db, SYSTEM_ACTOR, entry(2));
    await recordAuditAlone(t.db, SYSTEM_ACTOR, entry(3));

    const rows = await t.db.select().from(auditLog).orderBy(asc(auditLog.id));
    assert.equal(rows.length, 3);
    assert.equal(rows[0]?.prevHash, GENESIS_HASH);
    assert.equal(rows[1]?.prevHash, rows[0]?.hash);
    assert.equal(rows[2]?.prevHash, rows[1]?.hash);

    assert.deepEqual(await verifyChain(t.db), { ok: true, checked: 3, brokenAtId: null });
  });

  it("keeps the chain straight when entries are written at the same time", async () => {
    await Promise.all(
      Array.from({ length: 10 }, (_, i) => recordAuditAlone(t.db, SYSTEM_ACTOR, entry(100 + i))),
    );

    const check = await verifyChain(t.db);
    assert.equal(check.ok, true);
    assert.equal(check.checked, 13);
  });

  it("drops the entry when the change it describes rolls back", async () => {
    assert.throws(() =>
      inTransaction(t.db, (tx) => {
        recordAudit(tx, SYSTEM_ACTOR, entry(999));
        throw new Error("the change failed");
      }),
    );

    const [row] = await t.db.select().from(auditLog).where(eq(auditLog.entityId, "999"));
    assert.equal(row, undefined);
    assert.equal((await verifyChain(t.db)).ok, true);
  });

  it("refuses any change or removal of an entry", async () => {
    await rejectsWithDbError(t.db.update(auditLog).set({ summary: "cambiado" }), /history is never changed: audit_log/);
    await rejectsWithDbError(t.db.delete(auditLog), /nothing is deleted: audit_log/);
  });

  it("reports the first altered entry when someone edits one with other tools", async () => {
    const rows = await t.db.select({ id: auditLog.id }).from(auditLog).orderBy(asc(auditLog.id));
    const target = rows[1]!.id;

    // What the app never does: take the guard away first.
    t.sqlite.exec("DROP TRIGGER audit_log_no_update");
    t.db.run(sql`UPDATE audit_log SET summary = 'Nadie hizo nada' WHERE id = ${target}`);

    assert.deepEqual(await verifyChain(t.db), { ok: false, checked: 1, brokenAtId: target });
  });

  it("reports a removed entry", async () => {
    const t2 = await createTestDatabase();
    try {
      for (let i = 0; i < 4; i += 1) {
        await recordAuditAlone(t2.db, SYSTEM_ACTOR, entry(i));
      }
      const rows = await t2.db.select({ id: auditLog.id }).from(auditLog).orderBy(asc(auditLog.id));
      t2.sqlite.exec("DROP TRIGGER audit_log_no_delete");
      t2.db.run(sql`DELETE FROM audit_log WHERE id = ${rows[2]!.id}`);

      assert.deepEqual(await verifyChain(t2.db), { ok: false, checked: 2, brokenAtId: rows[3]!.id });
    } finally {
      await t2.close();
    }
  });
});

describe("canonicalJson", () => {
  it("does not depend on key order", () => {
    assert.equal(canonicalJson({ b: 1, a: { d: 2, c: 3 } }), canonicalJson({ a: { c: 3, d: 2 }, b: 1 }));
    assert.equal(canonicalJson({ b: 1, a: [2, 1] }), '{"a":[2,1],"b":1}');
  });
});
