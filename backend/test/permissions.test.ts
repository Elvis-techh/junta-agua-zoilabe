import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { and, eq } from "drizzle-orm";

import { createDb } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrations.js";
import { auditLog, months, rolePermissions, roles, settings } from "../src/db/schema.js";
import { EVERY_PERMISSION_KEY, seedDatabase } from "../src/db/seeding.js";
import { verifyChain } from "../src/lib/audit.js";
import { DEFAULT_MATRIX, PERMISSION_CODES, ROLES, ROLE_CODES } from "../src/lib/permissions.js";
import { HONDURAS_TIME_ZONE } from "../src/lib/time.js";
import type { TestApp } from "./helpers.js";
import { buildTestApp, rejectsWithDbError, signedInUser, takeAway } from "./helpers.js";

describe("permissions", () => {
  let t: TestApp;
  let admin: { cookie: string; id: string };
  let president: { cookie: string };
  let secretary: { cookie: string };

  before(async () => {
    t = await buildTestApp();
    admin = await signedInUser(t, "administrador", "Ana Admin");
    president = await signedInUser(t, "presidente");
    secretary = await signedInUser(t, "secretario");
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

  it("seeds every permission for all eight roles (board decision, 6 November 2026)", async () => {
    for (const role of ROLE_CODES) {
      assert.deepEqual(await grantedFor(role), [...PERMISSION_CODES].sort(), role);
    }
  });

  it("asks an anonymous request to sign in", async () => {
    assert.equal((await getMatrix()).statusCode, 401);
  });

  it("refuses a role without the permission, even when the API is called directly", async () => {
    takeAway(t, "secretario", "permissions:view", "permissions:edit");
    const response = await getMatrix(secretary.cookie);
    assert.equal(response.statusCode, 403);
    assert.equal(response.json().error, "forbidden");
  });

  it("lets a role view the matrix but not edit it once permissions:edit is taken away", async () => {
    takeAway(t, "presidente", "permissions:edit");
    assert.equal((await getMatrix(president.cookie)).statusCode, 200);
    assert.equal((await putMatrix(president.cookie, "fiscal", [])).statusCode, 403);
  });

  it("lets one role both record money and approve the close; two different people still close a month", async () => {
    const response = await putMatrix(admin.cookie, "tesorero", [...PERMISSION_CODES]);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(await grantedFor("tesorero"), [...PERMISSION_CODES].sort());

    // The person who prepared a month can never approve it: the database refuses.
    const other = await signedInUser(t, "tesorero");
    await rejectsWithDbError(
      t.db.insert(months).values({
        month: "2026-09-01",
        status: "closed",
        preparedBy: admin.id,
        preparedAt: new Date(),
        approvedBy: admin.id,
        approvedAt: new Date(),
      }),
      /months_preparer_not_approver/,
    );
    await t.db.insert(months).values({
      month: "2026-09-01",
      status: "closed",
      preparedBy: admin.id,
      preparedAt: new Date(),
      approvedBy: other.id,
      approvedAt: new Date(),
    });
  });

  it("keeps the administrator's way back in", async () => {
    const withoutEdit = [...DEFAULT_MATRIX.administrador].filter((p) => p !== "permissions:edit");
    assert.equal((await putMatrix(admin.cookie, "administrador", withoutEdit)).statusCode, 409);
  });

  it("applies an edit on the very next request, and logs it", async () => {
    assert.equal((await getMatrix(secretary.cookie)).statusCode, 403);

    const response = await putMatrix(admin.cookie, "secretario", [
      ...[...DEFAULT_MATRIX.secretario].filter((p) => p !== "permissions:edit"),
    ]);
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().changed, true);

    assert.equal((await getMatrix(secretary.cookie)).statusCode, 200);

    const [entry] = await t.db.select().from(auditLog).where(eq(auditLog.action, "permissions.updated"));
    assert.ok(entry);
    assert.equal(entry.actorName, "Ana Admin");
    assert.equal(entry.actorRole, "Administrador");
    assert.match(entry.summary, /Ana Admin \(Administrador\) cambió los permisos del cargo Secretario\/a/);
    assert.deepEqual((entry.after as { granted: string[] }).granted.includes("permissions:view"), true);
    assert.equal((await verifyChain(t.db)).ok, true);
  });

  it("rejects an unknown role or permission code", async () => {
    assert.equal((await putMatrix(admin.cookie, "tesorera", [])).statusCode, 404);
    assert.equal((await putMatrix(admin.cookie, "fiscal", ["finance:steal"])).statusCode, 400);
  });
});

describe("every role gets every permission, once, on a database seeded before 6 November 2026", () => {
  it("grants what each role lacked, logs it per role, and never puts back what is taken away later", async () => {
    const { db, sqlite } = createDb(":memory:");
    try {
      runMigrations(db, sqlite);

      // The database as the old seed left it: the fiscal could only look.
      const fiscalBefore = ["census:view", "census:view_sensitive", "finance:view", "log:view"];
      await db.insert(roles).values(ROLES.map((role, index) => ({ code: role.code, name: role.name, sortOrder: index })));
      await db.insert(rolePermissions).values(
        ROLES.flatMap((role) =>
          PERMISSION_CODES.map((permission) => ({
            roleCode: role.code,
            permission,
            granted: role.code === "fiscal" ? fiscalBefore.includes(permission) : role.code !== "segundo_vocal",
          })),
        ),
      );

      seedDatabase(db, HONDURAS_TIME_ZONE);

      const granted = async (role: string) =>
        (
          await db
            .select({ permission: rolePermissions.permission })
            .from(rolePermissions)
            .where(and(eq(rolePermissions.roleCode, role), eq(rolePermissions.granted, true)))
        ).length;
      for (const role of ROLE_CODES) {
        assert.equal(await granted(role), PERMISSION_CODES.length, role);
      }

      // One entry for each role that gained something, and none for the others.
      const entries = await db.select().from(auditLog).where(eq(auditLog.action, "permissions.updated"));
      assert.deepEqual(entries.map((e) => e.entityId).sort(), ["fiscal", "segundo_vocal"]);
      const fiscal = entries.find((e) => e.entityId === "fiscal")!;
      assert.equal(fiscal.actorName, "Sistema");
      assert.equal(fiscal.summary, "Sistema dio todos los permisos al cargo Fiscal");
      assert.deepEqual((fiscal.before as { granted: string[] }).granted, [...fiscalBefore].sort());
      assert.match(fiscal.reason ?? "", /6 de noviembre de 2026/);
      assert.equal((await verifyChain(db)).ok, true);
      assert.equal((await db.select().from(settings).where(eq(settings.key, EVERY_PERMISSION_KEY))).length, 1);

      // Taken away later in Permisos, it stays taken away the next time the seed runs.
      await db
        .update(rolePermissions)
        .set({ granted: false })
        .where(and(eq(rolePermissions.roleCode, "fiscal"), eq(rolePermissions.permission, "users:manage")));
      seedDatabase(db, HONDURAS_TIME_ZONE);
      assert.equal(await granted("fiscal"), PERMISSION_CODES.length - 1);
      assert.equal((await db.select().from(auditLog).where(eq(auditLog.action, "permissions.updated"))).length, 2);
    } finally {
      sqlite.close();
    }
  });

  it("only leaves its marker on a new database, with no history entries", async () => {
    const { db, sqlite } = createDb(":memory:");
    try {
      runMigrations(db, sqlite);
      seedDatabase(db, HONDURAS_TIME_ZONE);
      assert.equal((await db.select().from(auditLog).where(eq(auditLog.action, "permissions.updated"))).length, 0);
      assert.equal((await db.select().from(settings).where(eq(settings.key, EVERY_PERMISSION_KEY))).length, 1);
    } finally {
      sqlite.close();
    }
  });
});
