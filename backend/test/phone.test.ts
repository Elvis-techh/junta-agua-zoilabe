import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { and, eq } from "drizzle-orm";

import { newId } from "../src/auth/session.js";
import { createDb } from "../src/db/client.js";
import { MIGRATIONS_FOLDER, runMigrations } from "../src/db/migrations.js";
import { rolePermissions } from "../src/db/schema.js";
import { maskPhone, PHONE_COUNTRIES, phoneSearchPatterns, readPhone } from "../src/lib/phone.js";
import type { TestApp } from "./helpers.js";
import { buildTestApp, signedInUser } from "./helpers.js";

describe("reading a phone number", () => {
  it("keeps each country's number with its code", () => {
    assert.deepEqual(readPhone("+50499998888"), { phone: "+50499998888" });
    assert.deepEqual(readPhone("+12025550123"), { phone: "+12025550123" });
    assert.deepEqual(readPhone("+34612345678"), { phone: "+34612345678" });
    assert.deepEqual(readPhone("+525512345678"), { phone: "+525512345678" });
    assert.deepEqual(readPhone("+50212345678"), { phone: "+50212345678" });
    assert.deepEqual(readPhone("+50312345678"), { phone: "+50312345678" });
    assert.deepEqual(readPhone("+50512345678"), { phone: "+50512345678" });
    assert.deepEqual(readPhone("+50612345678"), { phone: "+50612345678" });
    assert.deepEqual(readPhone("+50761234567"), { phone: "+50761234567" });
    assert.deepEqual(readPhone("+5072123456"), { phone: "+5072123456" });
  });

  it("has the owner's nine countries, Honduras first, and no code that starts another", () => {
    assert.deepEqual(
      PHONE_COUNTRIES.map((country) => country.code),
      ["504", "1", "34", "52", "502", "503", "505", "506", "507"],
    );
    for (const a of PHONE_COUNTRIES) {
      for (const b of PHONE_COUNTRIES) {
        assert.ok(a === b || !a.code.startsWith(b.code), `${a.code} starts with ${b.code}`);
      }
    }
  });

  it("reads digits alone as Honduran, as an entry saved before country codes arrives", () => {
    assert.deepEqual(readPhone("99998888"), { phone: "+50499998888" });
  });

  it("says how long a number of that country is, in plain words", () => {
    assert.deepEqual(readPhone("+1999888"), { problem: "Un teléfono de Estados Unidos y Canadá tiene 10 números. Revise e intente de nuevo." });
    assert.deepEqual(readPhone("1234"), { problem: "Un teléfono de Honduras tiene 8 números. Revise e intente de nuevo." });
    assert.deepEqual(readPhone("+504"), { problem: "Un teléfono de Honduras tiene 8 números. Revise e intente de nuevo." });
    assert.deepEqual(readPhone("+507123"), { problem: "Un teléfono de Panamá tiene 7 u 8 números. Revise e intente de nuevo." });
  });

  it("refuses a country that is not on the list, and anything that is not a number", () => {
    assert.ok("problem" in readPhone("+4915112345678"));
    assert.ok("problem" in readPhone("+504abcdefgh"));
    assert.ok("problem" in readPhone(""));
  });
});

describe("masking a phone number", () => {
  it("shows the last two digits and hides how long the number is, which would tell the country", () => {
    assert.equal(maskPhone("+50499998866"), "••••••66");
    assert.equal(maskPhone("+12025550166"), "••••••66");
    assert.equal(maskPhone("+525512345666"), "••••••66");
    // In the history log, entries from before country codes keep looking the same.
    assert.equal(maskPhone("99998866"), "••••••66");
    assert.equal(maskPhone(null), null);
  });
});

describe("searching for a phone number", () => {
  it("looks after the country code, unless the whole number is typed", () => {
    assert.ok(phoneSearchPatterns("8877").includes("+504%8877%"));
    assert.ok(!phoneSearchPatterns("5049").includes("+5049%"));
    assert.ok(phoneSearchPatterns("50499887766").includes("+50499887766%"));
  });
});

describe("phones on the census and on accounts", () => {
  let t: TestApp;
  let admin: Awaited<ReturnType<typeof signedInUser>>;
  let vocal: Awaited<ReturnType<typeof signedInUser>>;
  let sectorId: number;
  let idCounter = 7_000_000_000_000;

  const call = (cookie: string, method: "GET" | "POST" | "PATCH", url: string, payload?: object) =>
    t.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

  const register = (phone: string, fullName = "pedro gómez") =>
    call(admin.cookie, "POST", "/api/census/households", {
      submissionId: randomUUID(),
      person: { fullName, idNumber: String((idCounter += 1)), phone },
      household: { sectorId, references: "Junto a la escuela", waterConnection: "connected", relation: "owner" },
      fee: { kind: "base" },
    });

  before(async () => {
    t = await buildTestApp();
    admin = await signedInUser(t, "administrador", "Ana Admin");
    vocal = await signedInUser(t, "primer_vocal");
    const created = await call(admin.cookie, "POST", "/api/settings/sectors", { name: "La Loma" });
    sectorId = created.json().sector.id;
  });
  after(async () => {
    await t.close();
  });

  it("registers a number from abroad, and refuses one of the wrong length for its country", async () => {
    const saved = await register("+12025550123");
    assert.equal(saved.statusCode, 201);
    assert.equal(saved.json().person.phone, "+12025550123");

    const short = await register("+1202555");
    assert.equal(short.statusCode, 400);
    assert.match(short.json().message, /Estados Unidos y Canadá tiene 10 números/);
  });

  it("still takes 8 digits from an entry that waited on a phone since before the update", async () => {
    const saved = await register("99112233");
    assert.equal(saved.statusCode, 201);
    assert.equal(saved.json().person.phone, "+50499112233");
  });

  it("keeps the masked phone the same shape for a role that may not see it", async () => {
    const saved = await register("+525512345678");
    await t.db
      .update(rolePermissions)
      .set({ granted: false })
      .where(and(eq(rolePermissions.roleCode, "primer_vocal"), eq(rolePermissions.permission, "census:view_sensitive")));
    const file = await call(vocal.cookie, "GET", `/api/census/households/${saved.json().household.id}`);
    assert.equal(file.json().household.owner.phone, "••••••78");
  });

  it("finds a number by its digits without every Honduran number matching the code", async () => {
    const found = await register("91234567", "lucía ponce");
    const other = await register("97654321", "marta ríos");
    const codes = async (q: string) =>
      (await call(admin.cookie, "GET", `/api/census/households?q=${q}`)).json().households.map((h: { code: string }) => h.code);

    assert.ok((await codes("1234")).includes(found.json().household.code));
    assert.ok(!(await codes("5049")).includes(other.json().household.code));
    assert.deepEqual(await codes("50491234567"), [found.json().household.code]);
  });

  it("corrects a number to another country", async () => {
    const saved = await register("92223333");
    const file = await call(admin.cookie, "GET", `/api/census/households/${saved.json().household.id}`);
    const url = `/api/census/people/${file.json().household.owner.personId}`;
    assert.equal((await call(admin.cookie, "PATCH", url, { phone: "+34612345678" })).statusCode, 200);
    const after = await call(admin.cookie, "GET", `/api/census/households/${saved.json().household.id}`);
    assert.equal(after.json().household.owner.phone, "+34612345678");
    assert.equal((await call(admin.cookie, "PATCH", url, { phone: "+3461234" })).statusCode, 400);
  });

  it("signs in an account with another country's number", async () => {
    const created = await call(admin.cookie, "POST", "/api/users", {
      name: "Carla Mejía",
      phone: "+12025550188",
      roleCode: "fiscal",
      password: "carla2026",
    });
    assert.equal(created.statusCode, 201);
    const signedIn = await t.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { phone: "+12025550188", password: "carla2026" },
    });
    assert.equal(signedIn.statusCode, 200);

    // The same number again is still the same account.
    const again = await call(admin.cookie, "POST", "/api/users", {
      name: "Otra Persona",
      phone: "+12025550188",
      roleCode: "fiscal",
      password: "otra2026",
    });
    assert.equal(again.statusCode, 409);
  });
});

describe("the migration that gives phones their country code", () => {
  /** A database as it stood before the migration, with real-looking rows in it. */
  function databaseBefore() {
    const folder = mkdtempSync(join(tmpdir(), "zoilabe-migrations-"));
    cpSync(MIGRATIONS_FOLDER, folder, { recursive: true });
    const journalPath = join(folder, "meta", "_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: Array<{ tag: string }> };
    journal.entries = journal.entries.filter((entry) => entry.tag === "0000_init");
    writeFileSync(journalPath, JSON.stringify(journal));

    const { db, sqlite } = createDb(":memory:");
    runMigrations(db, sqlite, folder);
    rmSync(folder, { recursive: true, force: true });

    const userId = newId();
    sqlite.exec(`
      INSERT INTO roles (code, name, sort_order) VALUES ('secretario', 'Secretaría', 1);
      INSERT INTO users (id, name, phone, role_code, status) VALUES ('${userId}', 'Sara', '99998888', 'secretario', 'active');
      INSERT INTO people (id, full_name, id_number, phone, phone_missing, created_by)
        VALUES ('p1', 'Juan', '0801199012345', '91112222', NULL, '${userId}'),
               ('p2', 'Rosa', '0801199012346', NULL, 'no_phone', '${userId}');
      INSERT INTO sectors (name) VALUES ('El Centro');
      INSERT INTO households (id, code, sector_id, "references", water_connection, status, submission_id, created_by)
        VALUES ('h1', 'Z-0001', 1, 'Frente a la iglesia', 'connected', 'active', '${randomUUID()}', '${userId}');
      INSERT INTO household_owners (id, household_id, person_id, relation, starts_on, created_by)
        VALUES ('o1', 'h1', 'p1', 'owner', '2026-11-01', '${userId}');
    `);
    return { db, sqlite, userId };
  }

  it("makes every number +504 and leaves everything else as it was", () => {
    const { db, sqlite, userId } = databaseBefore();
    runMigrations(db, sqlite);

    const people = sqlite.prepare("SELECT id, phone, phone_missing, created_by FROM people ORDER BY id").all();
    assert.deepEqual(people, [
      { id: "p1", phone: "+50491112222", phone_missing: null, created_by: userId },
      { id: "p2", phone: null, phone_missing: "no_phone", created_by: userId },
    ]);
    assert.deepEqual(sqlite.prepare("SELECT id, phone, status FROM users").all(), [{ id: userId, phone: "+50499998888", status: "active" }]);

    // What pointed at those rows still does.
    assert.deepEqual(sqlite.pragma("foreign_key_check"), []);
    assert.equal((sqlite.prepare("SELECT person_id FROM household_owners").get() as { person_id: string }).person_id, "p1");
    sqlite.close();
  });

  it("puts the guards back on the rebuilt tables, and the new check refuses the old form", () => {
    const { db, sqlite } = databaseBefore();
    runMigrations(db, sqlite);

    assert.throws(() => sqlite.exec("DELETE FROM people WHERE id = 'p2'"), /nothing is deleted/);
    assert.throws(() => sqlite.exec("DELETE FROM users"), /nothing is deleted/);
    assert.throws(() => sqlite.exec("UPDATE users SET phone = '99998888'"), /users_phone_digits/);
    assert.throws(() => sqlite.exec("UPDATE people SET phone = '91112222' WHERE id = 'p1'"), /people_phone_digits/);
    assert.throws(() => sqlite.exec("UPDATE people SET phone = '+504abc' WHERE id = 'p1'"), /people_phone_digits/);
    // Foreign keys are enforced again afterwards.
    assert.throws(() => sqlite.exec("UPDATE people SET created_by = 'nobody' WHERE id = 'p1'"), /FOREIGN KEY/);
    sqlite.close();
  });
});
