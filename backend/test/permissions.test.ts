import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { and, eq } from "drizzle-orm";

import { auditLog, rolePermissions } from "../src/db/schema.js";
import { verifyChain } from "../src/lib/audit.js";
import { DEFAULT_MATRIX, ROLE_CODES } from "../src/lib/permissions.js";
import type { TestApp } from "./helpers.js";
import { buildTestApp, signedInUser } from "./helpers.js";

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

  it("seeds the App Plan's matrix for all eight roles", async () => {
    for (const role of ROLE_CODES) {
      assert.deepEqual(await grantedFor(role), [...DEFAULT_MATRIX[role]].sort(), role);
    }
  });

  it("asks an anonymous request to sign in", async () => {
    assert.equal((await getMatrix()).statusCode, 401);
  });

  it("refuses a role without the permission, even when the API is called directly", async () => {
    const response = await getMatrix(secretary.cookie);
    assert.equal(response.statusCode, 403);
    assert.equal(response.json().error, "forbidden");
  });

  it("lets the president view the matrix but not edit it", async () => {
    assert.equal((await getMatrix(president.cookie)).statusCode, 200);
    assert.equal((await putMatrix(president.cookie, "fiscal", [])).statusCode, 403);
  });

  it("refuses a role that would both record money and approve the close", async () => {
    const response = await putMatrix(admin.cookie, "tesorero", [
      ...DEFAULT_MATRIX.tesorero,
      "month:approve",
    ]);
    assert.equal(response.statusCode, 409);
    assert.deepEqual(await grantedFor("tesorero"), [...DEFAULT_MATRIX.tesorero].sort());
  });

  it("keeps the administrator's way back in", async () => {
    const withoutEdit = [...DEFAULT_MATRIX.administrador].filter((p) => p !== "permissions:edit");
    assert.equal((await putMatrix(admin.cookie, "administrador", withoutEdit)).statusCode, 409);
  });

  it("applies an edit on the very next request, and logs it", async () => {
    assert.equal((await getMatrix(secretary.cookie)).statusCode, 403);

    const response = await putMatrix(admin.cookie, "secretario", [
      ...DEFAULT_MATRIX.secretario,
      "permissions:view",
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
