import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { asc, eq } from "drizzle-orm";
import type { LightMyRequestResponse } from "fastify";

import { SESSION_COOKIE, SESSION_IDLE_LIMIT_MS, newId } from "../src/auth/session.js";
import { createDb } from "../src/db/client.js";
import { MIGRATIONS_FOLDER, runMigrations } from "../src/db/migrations.js";
import { accessTokens, auditLog, users } from "../src/db/schema.js";
import { verifyChain } from "../src/lib/audit.js";
import type { TestApp } from "./helpers.js";
import { TEST_PASSWORD, buildTestApp, nextPhone, signedInUser, takeAway } from "./helpers.js";

/** The cookie header a browser would send after this response. */
function cookieFrom(response: LightMyRequestResponse): string {
  const session = (response.cookies as Array<{ name: string; value: string }>).find((c) => c.name === SESSION_COOKIE);
  assert.ok(session, "the response set the session cookie");
  return `${SESSION_COOKIE}=${session.value}`;
}

describe("signing in with phone number and password", () => {
  let t: TestApp;
  let admin: Awaited<ReturnType<typeof signedInUser>>;

  before(async () => {
    t = await buildTestApp({ loginAttemptsPerMinute: 1000 });
    admin = await signedInUser(t, "administrador", "Ana Admin");
  });
  after(async () => {
    await t.close();
  });

  const send = (method: "GET" | "POST" | "PATCH", url: string, payload?: object, cookie?: string) =>
    t.app.inject({ method, url, headers: cookie ? { cookie } : {}, ...(payload ? { payload } : {}) });
  const post = (url: string, payload: object, cookie?: string) => send("POST", url, payload, cookie);
  const get = (url: string, cookie?: string) => send("GET", url, undefined, cookie);
  const login = (phone: string, password: string) => post("/api/auth/login", { phone, password });

  /** Create an account through the API, and sign in with it on a new phone. */
  async function onboard(name: string, roleCode: string, password = TEST_PASSWORD) {
    const phone = nextPhone();
    const created = await post("/api/users", { name, phone, roleCode, password }, admin.cookie);
    assert.equal(created.statusCode, 201, created.body);
    const signedIn = await login(phone, password);
    assert.equal(signedIn.statusCode, 200, signedIn.body);
    return { userId: created.json().user.id as string, phone, cookie: cookieFrom(signedIn) };
  }

  it("takes a new board member from a new account to signed in, with no link and no PIN", async () => {
    const created = await post(
      "/api/users",
      { name: "Juan Pérez", phone: "98761234", roleCode: "tesorero", password: "pino2468" },
      admin.cookie,
    );
    assert.equal(created.statusCode, 201, created.body);
    assert.equal(created.json().user.status, "active");
    const userId = created.json().user.id;

    // The Honduran digits alone, as an older entry would send them, find the same account.
    const signedIn = await login("98761234", "pino2468");
    assert.equal(signedIn.statusCode, 200, signedIn.body);
    const [cookie] = signedIn.cookies as Array<{ name: string; httpOnly?: boolean; maxAge?: number }>;
    assert.equal(cookie?.name, SESSION_COOKIE);
    assert.equal(cookie?.httpOnly, true);
    assert.equal(cookie?.maxAge, SESSION_IDLE_LIMIT_MS / 1000);

    const me = await get("/api/auth/me", cookieFrom(signedIn));
    assert.equal(me.statusCode, 200);
    assert.equal(me.json().user.name, "Juan Pérez");
    assert.ok(me.json().user.permissions.includes("finance:record"));

    // Only fingerprints are stored: of the password, and of the session token.
    const [row] = await t.db.select().from(users).where(eq(users.id, userId));
    assert.match(row!.passwordHash!, /^scrypt\$/);
    assert.ok(!row!.passwordHash!.includes("pino2468"));
    const token = cookieFrom(signedIn).split("=")[1];
    const stored = await t.db.select({ hash: accessTokens.tokenHash }).from(accessTokens);
    assert.ok(stored.every((s) => s.hash !== token));

    const actions = (
      await t.db.select({ action: auditLog.action }).from(auditLog).where(eq(auditLog.entityId, userId)).orderBy(asc(auditLog.id))
    ).map((r) => r.action);
    assert.deepEqual(actions, ["user.created", "security.login"]);
  });

  it("answers a wrong password and an unknown number with the same words, and never locks", async () => {
    const { userId, phone } = await onboard("Carlos Lara", "segundo_vocal");

    const wrong = await login(phone, "equivocada");
    const unknown = await login(nextPhone(), TEST_PASSWORD);
    assert.equal(wrong.statusCode, 401);
    assert.equal(unknown.statusCode, 401);
    assert.equal(wrong.json().message, unknown.json().message);
    assert.match(wrong.json().message, /no coinciden/);

    for (let attempt = 0; attempt < 7; attempt += 1) {
      assert.equal((await login(phone, "equivocada")).statusCode, 401);
    }
    // Nobody has to call the administrator: the right password still opens it.
    assert.equal((await login(phone, TEST_PASSWORD)).statusCode, 200);

    const log = await t.db.select({ action: auditLog.action }).from(auditLog).where(eq(auditLog.entityId, userId));
    assert.equal(log.filter((e) => e.action === "security.login_failed").length, 8);
  });

  it("holds back guessing with a per-minute limit on signing in", async () => {
    const strict = await buildTestApp({ loginAttemptsPerMinute: 3 });
    try {
      const statuses: number[] = [];
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const response = await strict.app.inject({
          method: "POST",
          url: "/api/auth/login",
          payload: { phone: nextPhone(), password: "adivinanza" },
        });
        statuses.push(response.statusCode);
      }
      assert.deepEqual(statuses, [401, 401, 401, 429]);
    } finally {
      await strict.close();
    }
  });

  it("refuses a short password and a bad number in plain Spanish", async () => {
    const short = await post("/api/users", { name: "Ana López", phone: nextPhone(), roleCode: "fiscal", password: "abc" }, admin.cookie);
    assert.equal(short.statusCode, 400);
    assert.match(short.json().message, /al menos 6 letras o números/);

    const badPhone = await post("/api/users", { name: "Ana López", phone: "1234", roleCode: "fiscal", password: TEST_PASSWORD }, admin.cookie);
    assert.equal(badPhone.statusCode, 400);
    assert.match(badPhone.json().message, /8 números/);
  });

  it("keeps a phone signed in while it is used, and signs it out after 90 days without use", async () => {
    const member = await onboard("Pedro Castro", "primer_vocal");
    const [session] = await t.db
      .select()
      .from(accessTokens)
      .where(eq(accessTokens.userId, member.userId));

    // Last used two days ago, and an hour from running out.
    await t.db
      .update(accessTokens)
      .set({ lastUsedAt: new Date(Date.now() - 2 * 86_400_000), expiresAt: new Date(Date.now() + 3_600_000) })
      .where(eq(accessTokens.id, session!.id));

    const used = await get("/api/auth/me", member.cookie);
    assert.equal(used.statusCode, 200);
    assert.ok((used.cookies as Array<{ name: string }>).some((c) => c.name === SESSION_COOKIE), "the cookie is renewed too");
    const [renewed] = await t.db.select().from(accessTokens).where(eq(accessTokens.id, session!.id));
    assert.ok(renewed!.expiresAt.getTime() > Date.now() + SESSION_IDLE_LIMIT_MS - 60_000);

    // Used again the same day: nothing to write.
    const again = await get("/api/auth/me", member.cookie);
    assert.equal((again.cookies as unknown[]).length, 0);

    await t.db.update(accessTokens).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(accessTokens.id, session!.id));
    assert.equal((await get("/api/auth/me", member.cookie)).statusCode, 401);
  });

  it("asks for no PIN anywhere: the PIN and invitation routes are gone", async () => {
    const member = await onboard("Lidia Ruta", "fiscal");
    for (const [method, url] of [
      ["POST", "/api/auth/pin"],
      ["POST", "/api/auth/confirm-pin"],
      ["POST", "/api/auth/invitation/check"],
      ["POST", "/api/auth/invitation/accept"],
      ["POST", `/api/users/${member.userId}/invitation`],
      ["POST", `/api/users/${member.userId}/unlock`],
      ["GET", `/api/users/${member.userId}/devices`],
    ] as const) {
      assert.equal((await send(method, url, method === "POST" ? {} : undefined, admin.cookie)).statusCode, 404, url);
    }
  });

  it("keeps two roles apart: the server refuses what the role may not do", async () => {
    takeAway(t, "secretario", "users:manage", "log:view");
    const secretary = await onboard("Sonia Secretaria", "secretario");
    const president = await onboard("Pablo Presidente", "presidente");

    assert.equal((await get("/api/users", secretary.cookie)).statusCode, 403);
    assert.equal((await get("/api/audit", secretary.cookie)).statusCode, 403);

    const byPresident = await get("/api/users", president.cookie);
    assert.equal(byPresident.statusCode, 200);
    assert.ok(byPresident.json().users.some((u: { name: string }) => u.name === "Sonia Secretaria"));
  });

  it("changes a role straight away, with no PIN, but never one's own", async () => {
    const target = await onboard("Elena Fiscal", "fiscal");

    const changed = await send("PATCH", `/api/users/${target.userId}/role`, { roleCode: "primer_vocal" }, admin.cookie);
    assert.equal(changed.statusCode, 200);
    // The new role applies on the target's very next request.
    assert.equal((await get("/api/auth/me", target.cookie)).json().user.roleCode, "primer_vocal");

    const own = await send("PATCH", `/api/users/${admin.id}/role`, { roleCode: "presidente" }, admin.cookie);
    assert.equal(own.statusCode, 409);
  });

  it("signs every phone out when an administrator changes someone's password, and the new one works", async () => {
    const member = await onboard("Mario Teléfono", "fiscal");
    const secondPhone = cookieFrom(await login(member.phone, TEST_PASSWORD));

    const changed = await post(`/api/users/${member.userId}/password`, { password: "nuevo5555" }, admin.cookie);
    assert.equal(changed.statusCode, 200, changed.body);

    assert.equal((await get("/api/auth/me", member.cookie)).statusCode, 401);
    assert.equal((await get("/api/auth/me", secondPhone)).statusCode, 401);
    assert.equal((await login(member.phone, TEST_PASSWORD)).statusCode, 401);
    assert.equal((await login(member.phone, "nuevo5555")).statusCode, 200);

    const [entry] = await t.db
      .select({ summary: auditLog.summary })
      .from(auditLog)
      .where(eq(auditLog.action, "user.password_changed"));
    assert.equal(entry?.summary, "Ana Admin (Administrador) cambió la contraseña de Mario Teléfono");

    assert.equal((await post(`/api/users/${member.userId}/password`, { password: "abc" }, admin.cookie)).statusCode, 400);
  });

  it("keeps you signed in on the phone where you change your own password", async () => {
    const own = await onboard("Olga Propia", "presidente");
    const otherPhone = cookieFrom(await login(own.phone, TEST_PASSWORD));

    assert.equal((await post(`/api/users/${own.userId}/password`, { password: "propia7777" }, own.cookie)).statusCode, 200);
    assert.equal((await get("/api/auth/me", own.cookie)).statusCode, 200);
    assert.equal((await get("/api/auth/me", otherPhone)).statusCode, 401);
  });

  it("gives a password to an account from before passwords, which then becomes active", async () => {
    // As the migration leaves an account that never accepted its invitation link.
    const id = newId();
    const phone = nextPhone();
    await t.db.insert(users).values({ id, name: "Vieja Cuenta", phone, roleCode: "fiscal", status: "invited" });

    const listed = (await get("/api/users", admin.cookie)).json().users.find((u: { id: string }) => u.id === id);
    assert.equal(listed.hasPassword, false);
    assert.equal((await login(phone, TEST_PASSWORD)).statusCode, 401);

    assert.equal((await post(`/api/users/${id}/password`, { password: TEST_PASSWORD }, admin.cookie)).statusCode, 200);
    const [row] = await t.db.select({ status: users.status }).from(users).where(eq(users.id, id));
    assert.equal(row?.status, "active");
    assert.equal((await login(phone, TEST_PASSWORD)).statusCode, 200);
  });

  it("signs a suspended account out at once; it signs in again with the same password once reactivated", async () => {
    const member = await onboard("Nora Suspendida", "primer_vocal");
    assert.equal((await post(`/api/users/${member.userId}/suspend`, { reason: "Pidió permiso" }, admin.cookie)).statusCode, 200);
    assert.equal((await get("/api/auth/me", member.cookie)).statusCode, 401);

    const refused = await login(member.phone, TEST_PASSWORD);
    assert.equal(refused.statusCode, 403);
    assert.match(refused.json().message, /no está activa/);
    // A wrong password is not told the account is suspended.
    assert.equal((await login(member.phone, "equivocada")).statusCode, 401);

    assert.equal((await post(`/api/users/${member.userId}/reactivate`, {}, admin.cookie)).statusCode, 200);
    assert.equal((await login(member.phone, TEST_PASSWORD)).statusCode, 200);
  });

  it("signs out with Salir", async () => {
    const member = await onboard("Oscar Salida", "fiscal");
    assert.equal((await post("/api/auth/logout", {}, member.cookie)).statusCode, 200);
    const me = await get("/api/auth/me", member.cookie);
    assert.equal(me.statusCode, 401);
    assert.equal(me.json().error, "unauthenticated");
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

describe("the migration that replaces the PIN with a password", () => {
  /** A database as it stood with PINs (migrations up to 0003), with a PIN account, a locked one, and their tokens. */
  function databaseBefore() {
    const folder = mkdtempSync(join(tmpdir(), "zoilabe-migrations-"));
    cpSync(MIGRATIONS_FOLDER, folder, { recursive: true });
    const journalPath = join(folder, "meta", "_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: Array<{ tag: string }> };
    journal.entries = journal.entries.filter((entry) => entry.tag < "0004");
    writeFileSync(journalPath, JSON.stringify(journal));

    const { db, sqlite } = createDb(":memory:");
    runMigrations(db, sqlite, folder);
    rmSync(folder, { recursive: true, force: true });

    sqlite.exec(`
      INSERT INTO roles (code, name, sort_order) VALUES ('secretario', 'Secretaría', 1);
      INSERT INTO users (id, name, phone, role_code, status, pin_hash, failed_pin_count, locked_at)
        VALUES ('u1', 'Sara', '+50499998888', 'secretario', 'active', 'scrypt$aa$bb', 0, NULL),
               ('u2', 'Luis', '+50499997777', 'secretario', 'active', 'scrypt$cc$dd', 5, '2026-11-08T12:00:00.000Z');
      INSERT INTO access_tokens (id, user_id, kind, token_hash, expires_at, used_at)
        VALUES ('t1', 'u1', 'invitation', 'h1', '2026-11-03T00:00:00.000Z', '2026-11-02T00:00:00.000Z'),
               ('t2', 'u1', 'device', 'h2', '2027-02-01T00:00:00.000Z', NULL);
    `);
    return { db, sqlite };
  }

  it("keeps every account and token, with no password yet, and removes the PIN and the lock", () => {
    const { db, sqlite } = databaseBefore();
    runMigrations(db, sqlite);

    assert.deepEqual(sqlite.prepare("SELECT id, status, password_hash FROM users ORDER BY id").all(), [
      { id: "u1", status: "active", password_hash: null },
      { id: "u2", status: "active", password_hash: null },
    ]);
    const columns = (sqlite.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>).map((c) => c.name);
    for (const gone of ["pin_hash", "failed_pin_count", "locked_at"]) {
      assert.ok(!columns.includes(gone), gone);
    }
    assert.equal((sqlite.prepare("SELECT count(*) AS n FROM access_tokens").get() as { n: number }).n, 2);
    assert.deepEqual(sqlite.pragma("foreign_key_check"), []);
    // Still guarded: nothing is deleted.
    assert.throws(() => sqlite.exec("DELETE FROM users"), /nothing is deleted/);
    sqlite.close();
  });
});
