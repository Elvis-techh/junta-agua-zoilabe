import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { and, eq } from "drizzle-orm";

import { createDb } from "../src/db/client.js";
import { MIGRATIONS_FOLDER, runMigrations } from "../src/db/migrations.js";
import { auditLog, months, rolePermissions } from "../src/db/schema.js";
import { verifyChain } from "../src/lib/audit.js";
import { PERMISSION_CODES, ROLE_CODES } from "../src/lib/permissions.js";
import type { TestApp } from "./helpers.js";
import { buildTestApp, rejectsWithDbError, signedInUser, withdraw } from "./helpers.js";

describe("permissions", () => {
  let t: TestApp;
  let admin: { cookie: string; id: string };
  let president: { cookie: string; id: string };
  let secretary: { cookie: string };
  let fiscal: { cookie: string };

  before(async () => {
    t = await buildTestApp();
    admin = await signedInUser(t, "administrador", "Ana Admin");
    president = await signedInUser(t, "presidente", "Pablo Presidente");
    secretary = await signedInUser(t, "secretario");
    fiscal = await signedInUser(t, "fiscal");
  });
  after(async () => {
    await t.close();
  });

  const getMatrix = (cookie?: string) =>
    t.app.inject({ method: "GET", url: "/api/permissions", headers: cookie ? { cookie } : {} });

  const putMatrix = (cookie: string, role: string, granted: string[]) =>
    t.app.inject({ method: "PUT", url: `/api/permissions/${role}`, headers: { cookie }, payload: { granted } });

  const grantedFor = async (role: string) =>
    (
      await t.db
        .select({ permission: rolePermissions.permission })
        .from(rolePermissions)
        .where(and(eq(rolePermissions.roleCode, role), eq(rolePermissions.granted, true)))
    )
      .map((row) => row.permission)
      .sort();

  it("gives every role every permission, as the owner decided on 6 November 2026", async () => {
    for (const role of ROLE_CODES) {
      assert.deepEqual(await grantedFor(role), [...PERMISSION_CODES].sort(), role);
    }
  });

  it("asks an anonymous request to sign in", async () => {
    assert.equal((await getMatrix()).statusCode, 401);
  });

  it("refuses a role the Permisos tab narrowed, even when the API is called directly", async () => {
    await withdraw(t, "fiscal", ["permissions:view", "permissions:edit"]);
    const response = await getMatrix(fiscal.cookie);
    assert.equal(response.statusCode, 403);
    assert.equal(response.json().error, "forbidden");
  });

  it("lets one role record money and approve a close, while the database keeps the two people apart", async () => {
    const treasurer = await grantedFor("tesorero");
    assert.ok(treasurer.includes("finance:record") && treasurer.includes("month:approve"));
    const response = await putMatrix(admin.cookie, "tesorero", [...PERMISSION_CODES]);
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().changed, false);

    // A month close still takes two people: whoever prepared it cannot approve it.
    const [month] = await t.db
      .insert(months)
      .values({ month: "2026-10-01", status: "prepared", preparedBy: admin.id, preparedAt: new Date() })
      .returning();
    await rejectsWithDbError(
      t.db.update(months).set({ status: "closed", approvedBy: admin.id, approvedAt: new Date() }).where(eq(months.id, month!.id)),
      /months_preparer_not_approver/,
    );
    await t.db.update(months).set({ status: "closed", approvedBy: president.id, approvedAt: new Date() }).where(eq(months.id, month!.id));
  });

  it("keeps the administrator's way back in", async () => {
    const withoutEdit = PERMISSION_CODES.filter((p) => p !== "permissions:edit");
    assert.equal((await putMatrix(admin.cookie, "administrador", withoutEdit)).statusCode, 409);
  });

  it("applies an edit on the very next request, and logs it", async () => {
    assert.equal((await getMatrix(secretary.cookie)).statusCode, 200);

    // Any role may narrow another; here the president does it.
    const narrowed = PERMISSION_CODES.filter((p) => p !== "permissions:view" && p !== "permissions:edit");
    const response = await putMatrix(president.cookie, "secretario", narrowed);
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().changed, true);

    assert.equal((await getMatrix(secretary.cookie)).statusCode, 403);

    const [entry] = await t.db.select().from(auditLog).where(eq(auditLog.action, "permissions.updated"));
    assert.ok(entry);
    assert.equal(entry.actorName, "Pablo Presidente");
    assert.equal(entry.actorRole, "Presidente");
    assert.match(entry.summary, /Pablo Presidente \(Presidente\) cambió los permisos del cargo Secretario\/a/);
    assert.equal((entry.after as { granted: string[] }).granted.includes("permissions:view"), false);
    assert.equal((await verifyChain(t.db)).ok, true);

    // And the administrator gives them back.
    assert.equal((await putMatrix(admin.cookie, "secretario", [...PERMISSION_CODES])).statusCode, 200);
    assert.equal((await getMatrix(secretary.cookie)).statusCode, 200);
  });

  it("rejects an unknown role or permission code", async () => {
    assert.equal((await putMatrix(admin.cookie, "tesorera", [])).statusCode, 404);
    assert.equal((await putMatrix(admin.cookie, "fiscal", ["finance:steal"])).statusCode, 400);
  });
});

describe("the migration that gives every role every permission", () => {
  it("grants what the old matrix held back, and leaves nothing else changed", () => {
    // A database as it stood before the migration, with part of the old matrix.
    const folder = mkdtempSync(join(tmpdir(), "zoilabe-migrations-"));
    cpSync(MIGRATIONS_FOLDER, folder, { recursive: true });
    const journalPath = join(folder, "meta", "_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: Array<{ tag: string }> };
    journal.entries = journal.entries.filter((entry) => entry.tag <= "0003");
    writeFileSync(journalPath, JSON.stringify(journal));
    const { db, sqlite } = createDb(":memory:");
    runMigrations(db, sqlite, folder);
    rmSync(folder, { recursive: true, force: true });

    sqlite.exec(`
      INSERT INTO roles (code, name, sort_order) VALUES ('secretario', 'Secretario/a', 3), ('tesorero', 'Tesorero/a', 4);
      INSERT INTO role_permissions (role_code, permission, granted, updated_at) VALUES
        ('secretario', 'census:edit', 1, '2026-10-24T12:00:00.000Z'),
        ('secretario', 'finance:record', 0, '2026-10-24T12:00:00.000Z'),
        ('tesorero', 'finance:record', 1, '2026-10-24T12:00:00.000Z'),
        ('tesorero', 'month:approve', 0, '2026-10-24T12:00:00.000Z');
    `);

    runMigrations(db, sqlite);

    const rows = sqlite
      .prepare("SELECT role_code, permission, granted, updated_at FROM role_permissions ORDER BY role_code, permission")
      .all() as Array<{ role_code: string; permission: string; granted: number; updated_at: string }>;
    assert.deepEqual(
      rows.map((row) => [row.role_code, row.permission, row.granted]),
      [
        ["secretario", "census:edit", 1],
        ["secretario", "finance:record", 1],
        ["tesorero", "finance:record", 1],
        ["tesorero", "month:approve", 1],
      ],
    );
    // Only the rows it changed say they changed.
    assert.equal(rows[0]!.updated_at, "2026-10-24T12:00:00.000Z");
    assert.notEqual(rows[1]!.updated_at, "2026-10-24T12:00:00.000Z");
    sqlite.close();
  });
});
