import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { and, asc, eq, isNull } from "drizzle-orm";
import type { LightMyRequestResponse } from "fastify";

import { DEVICE_COOKIE, SESSION_COOKIE } from "../src/auth/session.js";
import { accessTokens, auditLog, users } from "../src/db/schema.js";
import { verifyChain } from "../src/lib/audit.js";
import type { TestApp } from "./helpers.js";
import { TEST_PIN, buildTestApp, nextPhone, signedInUser } from "./helpers.js";

/** The cookie header a browser would send after this response. */
function cookiesFrom(response: LightMyRequestResponse, previous = ""): string {
  const jar = new Map(
    previous
      .split("; ")
      .filter(Boolean)
      .map((pair) => pair.split("=") as [string, string]),
  );
  for (const cookie of response.cookies as Array<{ name: string; value: string }>) {
    jar.set(cookie.name, cookie.value);
  }
  return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
}

function onlyDevice(cookie: string): string {
  return cookie.split("; ").filter((pair) => pair.startsWith(`${DEVICE_COOKIE}=`)).join("; ");
}

describe("invitation and PIN sign-in", () => {
  let t: TestApp;
  let admin: Awaited<ReturnType<typeof signedInUser>>;

  before(async () => {
    t = await buildTestApp({ pinAttemptsPerMinute: 1000 });
    admin = await signedInUser(t, "administrador", "Ana Admin");
  });
  after(async () => {
    await t.close();
  });

  const post = (url: string, payload: object, cookie?: string) =>
    t.app.inject({ method: "POST", url, payload, headers: cookie ? { cookie } : {} });
  const get = (url: string, cookie?: string) =>
    t.app.inject({ method: "GET", url, headers: cookie ? { cookie } : {} });

  /** Create a staff account through the API, invite it and accept on a new phone. */
  async function onboard(name: string, roleCode: string, pin = TEST_PIN) {
    const created = await post("/api/users", { name, phone: nextPhone(), roleCode }, admin.cookie);
    assert.equal(created.statusCode, 201, created.body);
    const userId = created.json().user.id as string;

    const invite = await post(`/api/users/${userId}/invitation`, {}, admin.cookie);
    assert.equal(invite.statusCode, 200, invite.body);
    const token = new URL(invite.json().url).hash.slice(1);

    const accepted = await post("/api/auth/invitation/accept", { token, pin });
    assert.equal(accepted.statusCode, 200, accepted.body);
    return { userId, token, cookie: cookiesFrom(accepted), invite: invite.json() };
  }

  it("takes a new director from invitation to signed in", async () => {
    const created = await post(
      "/api/users",
      { name: "Juan Pérez", phone: "98761234", roleCode: "tesorero" },
      admin.cookie,
    );
    assert.equal(created.statusCode, 201);
    const userId = created.json().user.id;

    const invite = await post(`/api/users/${userId}/invitation`, {}, admin.cookie);
    const { url, whatsappUrl, message } = invite.json();
    assert.match(url, /^https:\/\/agua\.example\.hn\/invitacion#[A-Za-z0-9_-]{43}$/);
    assert.match(whatsappUrl, /^https:\/\/wa\.me\/50498761234\?text=/);
    assert.match(message, /Hola Juan Pérez/);
    const token = new URL(url).hash.slice(1);

    const check = await post("/api/auth/invitation/check", { token });
    assert.deepEqual(check.json(), { name: "Juan Pérez", roleName: "Tesorero/a", replacesPin: false });

    const accepted = await post("/api/auth/invitation/accept", { token, pin: "135790" });
    assert.equal(accepted.statusCode, 200);
    const names = (accepted.cookies as Array<{ name: string; httpOnly?: boolean }>).map((c) => c.name).sort();
    assert.deepEqual(names, [DEVICE_COOKIE, SESSION_COOKIE].sort());
    assert.ok((accepted.cookies as Array<{ httpOnly?: boolean }>).every((c) => c.httpOnly));

    const me = await get("/api/auth/me", cookiesFrom(accepted));
    assert.equal(me.statusCode, 200);
    assert.equal(me.json().user.name, "Juan Pérez");
    assert.ok(me.json().user.permissions.includes("finance:record"));

    const [row] = await t.db.select().from(users).where(eq(users.id, userId));
    assert.equal(row?.status, "active");
    assert.notEqual(row?.pinHash, "135790");

    // Only the hash of each token is stored.
    const stored = await t.db.select({ hash: accessTokens.tokenHash }).from(accessTokens);
    assert.ok(stored.every((s) => s.hash !== token));

    const actions = (
      await t.db
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(eq(auditLog.entityId, userId))
        .orderBy(asc(auditLog.id))
    ).map((r) => r.action);
    assert.deepEqual(actions, ["user.created", "user.invitation_sent", "user.invitation_accepted"]);
  });

  it("uses an invitation link once", async () => {
    const { token } = await onboard("Rosa Díaz", "secretario");
    const again = await post("/api/auth/invitation/accept", { token, pin: "111222" });
    assert.equal(again.statusCode, 410);
  });

  it("refuses an invitation older than 48 hours", async () => {
    const created = await post("/api/users", { name: "Luis Mejía", phone: nextPhone(), roleCode: "fiscal" }, admin.cookie);
    const invite = await post(`/api/users/${created.json().user.id}/invitation`, {}, admin.cookie);
    const token = new URL(invite.json().url).hash.slice(1);

    await t.db
      .update(accessTokens)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(and(eq(accessTokens.kind, "invitation"), isNull(accessTokens.usedAt)));
    assert.equal((await post("/api/auth/invitation/check", { token })).statusCode, 410);
    assert.equal((await post("/api/auth/invitation/accept", { token, pin: "111222" })).statusCode, 410);
  });

  it("replaces an older unused invitation when a new one is made", async () => {
    const created = await post("/api/users", { name: "Marta Ríos", phone: nextPhone(), roleCode: "fiscal" }, admin.cookie);
    const id = created.json().user.id;
    const first = new URL((await post(`/api/users/${id}/invitation`, {}, admin.cookie)).json().url).hash.slice(1);
    await post(`/api/users/${id}/invitation`, {}, admin.cookie);
    assert.equal((await post("/api/auth/invitation/check", { token: first })).statusCode, 410);
  });

  it("signs in with the PIN on a remembered phone", async () => {
    const { cookie } = await onboard("Pedro Castro", "primer_vocal");
    const device = onlyDevice(cookie);

    const me = await get("/api/auth/me", device);
    assert.equal(me.statusCode, 401);
    assert.equal(me.json().error, "pin_needed");
    assert.equal(me.json().device.name, "Pedro Castro");

    const signedIn = await post("/api/auth/pin", { pin: TEST_PIN }, device);
    assert.equal(signedIn.statusCode, 200);
    assert.equal((await get("/api/auth/me", cookiesFrom(signedIn, device))).statusCode, 200);
  });

  it("does not sign in on a phone that was never invited", async () => {
    const response = await post("/api/auth/pin", { pin: TEST_PIN });
    assert.equal(response.statusCode, 401);
    assert.equal(response.json().error, "device_unknown");
  });

  it("locks the account after 5 wrong PINs, and an administrator unlocks it", async () => {
    const { userId, cookie } = await onboard("Carlos Lara", "segundo_vocal");
    const device = onlyDevice(cookie);

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const wrong = await post("/api/auth/pin", { pin: "000000" }, device);
      assert.equal(wrong.statusCode, 401);
      assert.equal(wrong.json().attemptsLeft, 5 - attempt);
    }
    const fifth = await post("/api/auth/pin", { pin: "000000" }, device);
    assert.equal(fifth.statusCode, 423);

    // Even the right PIN is refused now.
    const right = await post("/api/auth/pin", { pin: TEST_PIN }, device);
    assert.equal(right.statusCode, 423);
    // And the session opened by the invitation has ended.
    assert.equal((await get("/api/auth/me", cookie)).statusCode, 401);

    const log = await t.db.select({ action: auditLog.action }).from(auditLog).where(eq(auditLog.entityId, userId));
    assert.equal(log.filter((e) => e.action === "security.pin_failed").length, 5);
    assert.equal(log.filter((e) => e.action === "security.account_locked").length, 1);

    assert.equal((await post(`/api/users/${userId}/unlock`, {}, admin.cookie)).statusCode, 200);
    assert.equal((await post("/api/auth/pin", { pin: TEST_PIN }, device)).statusCode, 200);
  });

  it("keeps two roles apart: the server refuses what the role may not do", async () => {
    const secretary = await onboard("Sonia Secretaria", "secretario");
    const president = await onboard("Pablo Presidente", "presidente");

    const bySecretary = await get("/api/users", secretary.cookie);
    assert.equal(bySecretary.statusCode, 403);
    assert.equal((await get("/api/audit", secretary.cookie)).statusCode, 403);

    const byPresident = await get("/api/users", president.cookie);
    assert.equal(byPresident.statusCode, 200);
    assert.ok(byPresident.json().users.some((u: { name: string }) => u.name === "Sonia Secretaria"));
  });

  it("asks for the PIN again before changing a role, and never one's own", async () => {
    const target = await onboard("Elena Fiscal", "fiscal");

    const withoutPin = await t.app.inject({
      method: "PATCH",
      url: `/api/users/${target.userId}/role`,
      headers: { cookie: admin.cookie },
      payload: { roleCode: "primer_vocal" },
    });
    assert.equal(withoutPin.statusCode, 403);
    assert.equal(withoutPin.json().error, "pin_required");

    assert.equal((await post("/api/auth/confirm-pin", { pin: TEST_PIN }, admin.cookie)).statusCode, 200);

    const changed = await t.app.inject({
      method: "PATCH",
      url: `/api/users/${target.userId}/role`,
      headers: { cookie: admin.cookie },
      payload: { roleCode: "primer_vocal" },
    });
    assert.equal(changed.statusCode, 200);

    // The new role applies on the target's very next request.
    const me = await get("/api/auth/me", target.cookie);
    assert.equal(me.json().user.roleCode, "primer_vocal");

    const own = await t.app.inject({
      method: "PATCH",
      url: `/api/users/${admin.id}/role`,
      headers: { cookie: admin.cookie },
      payload: { roleCode: "presidente" },
    });
    assert.equal(own.statusCode, 409);
  });

  it("ends a lost phone's session when its device is removed", async () => {
    const lost = await onboard("Mario Teléfono", "fiscal");
    const devices = await get(`/api/users/${lost.userId}/devices`, admin.cookie);
    assert.equal(devices.json().devices.length, 1);
    const deviceId = devices.json().devices[0].id;

    const removed = await post(`/api/users/${lost.userId}/devices/${deviceId}/remove`, {}, admin.cookie);
    assert.equal(removed.statusCode, 200);

    const me = await get("/api/auth/me", lost.cookie);
    assert.equal(me.statusCode, 401);
    assert.equal(me.json().error, "device_unknown");
  });

  it("signs a suspended account out at once", async () => {
    const member = await onboard("Nora Suspendida", "primer_vocal");
    assert.equal((await post(`/api/users/${member.userId}/suspend`, { reason: "Pidió permiso" }, admin.cookie)).statusCode, 200);
    assert.equal((await get("/api/auth/me", member.cookie)).statusCode, 401);
    assert.equal((await post("/api/auth/pin", { pin: TEST_PIN }, onlyDevice(member.cookie))).statusCode, 401);
  });

  it("signs out, keeping the phone remembered", async () => {
    const member = await onboard("Oscar Salida", "fiscal");
    assert.equal((await post("/api/auth/logout", {}, member.cookie)).statusCode, 200);
    const me = await get("/api/auth/me", member.cookie);
    assert.equal(me.json().error, "pin_needed");
  });

  it("refuses bad input in plain Spanish", async () => {
    const response = await post("/api/users", { name: "Ana", phone: "1234", roleCode: "fiscal" }, admin.cookie);
    assert.equal(response.statusCode, 400);
    assert.match(response.json().message, /8 números/);

    const shortPin = await post("/api/auth/invitation/accept", { token: "x".repeat(43), pin: "12345" });
    assert.equal(shortPin.statusCode, 400);
    assert.match(shortPin.json().message, /6 números/);
  });

  it("shows the history log to those allowed, newest first, with detail", async () => {
    const fiscal = await onboard("Fabio Fiscal", "fiscal");
    const list = await get("/api/audit?area=users&limit=5", fiscal.cookie);
    assert.equal(list.statusCode, 200);
    const { entries, nextBefore } = list.json();
    assert.equal(entries.length, 5);
    assert.ok(entries[0].id > entries[1].id);
    assert.ok(nextBefore);

    const withDetail = entries.find((e: { hasDetail: boolean }) => e.hasDetail);
    const detail = await get(`/api/audit/${withDetail.id}`, fiscal.cookie);
    assert.equal(detail.statusCode, 200);
    assert.equal(detail.json().entry.hash, undefined);
  });

  it("leaves the history log chain intact through all of it", async () => {
    const check = await verifyChain(t.db);
    assert.equal(check.ok, true);
    assert.ok(check.checked > 40);
  });
});
