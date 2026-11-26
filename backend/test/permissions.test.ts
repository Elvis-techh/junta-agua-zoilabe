import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { and, eq } from "drizzle-orm";

import { createDb } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrations.js";
import { auditLog, months, rolePermissions, roles, settings } from "../src/db/schema.js";
import { EVERY_PERMISSION_KEY, seedDatabase } from "../src/db/seeding.js";
import { verifyChain } from "../src/lib/audit.js";
import type { Permission } from "../src/lib/permissions.js";
import { DEFAULT_MATRIX, PERMISSION_CODES, ROLES, ROLE_CODES } from "../src/lib/permissions.js";
import { HONDURAS_TIME_ZONE, businessToday } from "../src/lib/time.js";
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
    // Asked by another cargo: nobody changes their own.
    const vice = await signedInUser(t, "vicepresidente");
    const withoutEdit = [...DEFAULT_MATRIX.administrador].filter((p) => p !== "permissions:edit");
    const response = await putMatrix(vice.cookie, "administrador", withoutEdit);
    assert.equal(response.statusCode, 409);
    assert.match(response.json().message, /El Administrador siempre conserva/);
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

describe("a permission turns off with the one it needs (owner, 25 November 2026)", () => {
  let t: TestApp;
  let admin: { cookie: string };
  let fiscal: { cookie: string };

  before(async () => {
    t = await buildTestApp();
    admin = await signedInUser(t, "administrador", "Ana Admin");
    fiscal = await signedInUser(t, "fiscal");
  });
  after(async () => {
    await t.close();
  });

  const put = (role: string, payload: { granted: string[]; expected?: string[] }) =>
    t.app.inject({ method: "PUT", url: `/api/permissions/${role}`, headers: { cookie: admin.cookie }, payload });

  const allBut = (...codes: Permission[]) => PERMISSION_CODES.filter((code) => !codes.includes(code));

  const grantedFor = (role: string) =>
    t.db
      .select({ permission: rolePermissions.permission })
      .from(rolePermissions)
      .where(and(eq(rolePermissions.roleCode, role), eq(rolePermissions.granted, true)))
      .all()
      .map((row) => row.permission)
      .sort();

  const FINANCE_NEEDS_VIEW: Permission[] = ["finance:record", "finance:reverse", "month:prepare", "month:approve", "export:finance"];

  it("will not print finances for a cargo that may not see them, even if the switch to print was left on", async () => {
    const month = `${businessToday(HONDURAS_TIME_ZONE).slice(0, 7)}-01`;
    const opening = await t.app.inject({
      method: "POST",
      url: "/api/finance/opening-balance",
      headers: { cookie: admin.cookie },
      payload: { month, cashCentavos: 123_400, bankCentavos: 500_000 },
    });
    assert.equal(opening.statusCode, 200, opening.body);

    // Only "Ver finanzas" is taken away, behind the Permisos route's back: the rest is still stored as given.
    takeAway(t, "fiscal", "finance:view");

    const someId = "0b9f6d2e-3c1a-4a55-9d0e-6f1a2b3c4d5e";
    for (const url of [
      `/api/finance/summary/${month}/statement`,
      `/api/finance/households/${someId}/statement`,
      `/api/finance/receipts/${someId}`,
    ]) {
      const response = await t.app.inject({ method: "POST", url, headers: { cookie: fiscal.cookie }, payload: {} });
      assert.equal(response.statusCode, 403, `${url} ${response.body}`);
    }

    // The app is told the same, so it shows no button the server would refuse.
    const me = await t.app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie: fiscal.cookie } });
    const permissions = me.json().user.permissions as string[];
    for (const code of ["finance:view", ...FINANCE_NEEDS_VIEW]) {
      assert.ok(!permissions.includes(code), code);
    }
    assert.ok(permissions.includes("census:view"));
  });

  it("follows the chain all the way: without seeing the census, nothing that registers in it", async () => {
    takeAway(t, "secretario", "census:view");
    const secretary = await signedInUser(t, "secretario");
    const me = await t.app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie: secretary.cookie } });
    const permissions = me.json().user.permissions as string[];
    for (const code of ["census:view_sensitive", "census:edit", "census:deactivate", "household_fee:set", "household_fee:set_at_registration", "export:census"]) {
      assert.ok(!permissions.includes(code), code);
    }
  });

  it("refuses to save a cargo with a permission and without the one it needs", async () => {
    const before = grantedFor("tesorero");
    const response = await put("tesorero", { granted: allBut("finance:view") });
    assert.equal(response.statusCode, 409);
    assert.match(response.json().message, /necesita «Ver finanzas»/);
    assert.deepEqual(grantedFor("tesorero"), before);

    const saved = await put("tesorero", { granted: allBut("finance:view", ...FINANCE_NEEDS_VIEW) });
    assert.equal(saved.statusCode, 200, saved.body);
    assert.deepEqual(grantedFor("tesorero"), allBut("finance:view", ...FINANCE_NEEDS_VIEW).sort());
  });

  it("says in the history log what was taken away and what was given, in words", async () => {
    await put("segundo_vocal", { granted: allBut("log:view", "export:log") });
    await put("segundo_vocal", { granted: allBut("export:log", "users:manage") });
    const entries = await t.db.select().from(auditLog).where(eq(auditLog.entityId, "segundo_vocal")).orderBy(auditLog.id);
    assert.equal(
      entries[0]?.summary,
      "Ana Admin (Administrador) cambió los permisos del cargo Segundo vocal: quitó «Ver el historial», «Imprimir y exportar el historial»",
    );
    assert.equal(
      entries[1]?.summary,
      "Ana Admin (Administrador) cambió los permisos del cargo Segundo vocal: quitó «Administrar usuarios»; dio «Ver el historial»",
    );
  });

  it("does not undo a change someone else saved meanwhile", async () => {
    // Two phones open the same cargo. The first saves; the second still holds what it read before.
    const read = grantedFor("primer_vocal");
    assert.equal((await put("primer_vocal", { granted: allBut("settings:edit"), expected: read })).statusCode, 200);

    const stale = await put("primer_vocal", { granted: allBut("users:manage"), expected: read });
    assert.equal(stale.statusCode, 409);
    assert.equal(stale.json().error, "stale");
    assert.deepEqual(grantedFor("primer_vocal"), allBut("settings:edit").sort());

    // Asking for what is already so is no conflict.
    const same = await put("primer_vocal", { granted: allBut("settings:edit"), expected: read });
    assert.equal(same.statusCode, 200);
    assert.equal(same.json().changed, false);
  });

  it("keeps the administrator's three ways back in, and tells the screen which they are", async () => {
    const president = await signedInUser(t, "presidente");
    const withoutView = await t.app.inject({
      method: "PUT",
      url: "/api/permissions/administrador",
      headers: { cookie: president.cookie },
      payload: { granted: allBut("permissions:view", "permissions:edit") },
    });
    assert.equal(withoutView.statusCode, 409);
    assert.match(withoutView.json().message, /El Administrador siempre conserva/);

    const matrix = (await t.app.inject({ method: "GET", url: "/api/permissions", headers: { cookie: admin.cookie } })).json();
    const role = (code: string) => matrix.roles.find((r: { code: string }) => r.code === code);
    assert.deepEqual([...role("administrador").locked].sort(), ["permissions:edit", "permissions:view", "users:manage"]);
    assert.deepEqual(role("fiscal").locked, []);
    const needs = (code: string) => matrix.permissions.find((p: { code: string }) => p.code === code).requires;
    assert.equal(needs("export:finance"), "finance:view");
    assert.equal(needs("finance:view"), null);
  });
});

describe("nobody changes the permissions of their own cargo (owner, 25 November 2026)", () => {
  let t: TestApp;
  let admin: { cookie: string };
  let president: { cookie: string };

  before(async () => {
    t = await buildTestApp();
    admin = await signedInUser(t, "administrador", "Ana Admin");
    president = await signedInUser(t, "presidente", "Pedro Presidente");
  });
  after(async () => {
    await t.close();
  });

  const put = (who: { cookie: string }, role: string, granted: Permission[]) =>
    t.app.inject({ method: "PUT", url: `/api/permissions/${role}`, headers: { cookie: who.cookie }, payload: { granted } });

  const allBut = (...codes: Permission[]) => PERMISSION_CODES.filter((code) => !codes.includes(code));

  const holds = (role: string, permission: Permission) =>
    t.db
      .select({ granted: rolePermissions.granted })
      .from(rolePermissions)
      .where(and(eq(rolePermissions.roleCode, role), eq(rolePermissions.permission, permission)))
      .get()?.granted;

  const entries = () => t.db.select().from(auditLog).where(eq(auditLog.action, "permissions.updated")).all().length;

  it("refuses it even with «Editar los permisos», the administrator too, and saves and logs nothing", async () => {
    for (const [who, role] of [
      [admin, "administrador"],
      [president, "presidente"],
    ] as const) {
      const response = await put(who, role, allBut("settings:edit"));
      assert.equal(response.statusCode, 409, role);
      assert.equal(response.json().error, "not_allowed");
      assert.equal(response.json().message, "Nadie puede cambiar los permisos de su propio cargo.");
      assert.equal(holds(role, "settings:edit"), true, role);
    }
    assert.equal(entries(), 0);
  });

  it("so a cargo cannot give itself back what another took away", async () => {
    assert.equal((await put(admin, "presidente", allBut("log:view", "export:log"))).statusCode, 200);

    assert.equal((await put(president, "presidente", allBut())).statusCode, 409);
    assert.equal(holds("presidente", "log:view"), false);

    // Someone of another cargo still can, in both directions.
    assert.equal((await put(president, "administrador", allBut("settings:edit"))).statusCode, 200);
    assert.equal((await put(admin, "presidente", allBut())).statusCode, 200);
    assert.equal(holds("presidente", "log:view"), true);
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
