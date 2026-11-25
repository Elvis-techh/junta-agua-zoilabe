import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import { eq } from "drizzle-orm";

import { auditLog, documents } from "../src/db/schema.js";
import { HONDURAS_TIME_ZONE, businessToday } from "../src/lib/time.js";
import type { TestApp } from "./helpers.js";
import { buildTestApp, madeUpPassword, nextPhone, signedInUser, takeAway } from "./helpers.js";

describe("Historial del año: the history log extract", () => {
  let t: TestApp;
  let fiscal: { id: string; cookie: string };
  let president: { cookie: string };
  let secretary: { cookie: string };

  const today = businessToday(HONDURAS_TIME_ZONE);
  const thisYear = Number(today.slice(0, 4));

  const call = (cookie: string, method: "GET" | "POST" | "PATCH", url: string, payload?: object) =>
    t.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

  const extract = (cookie: string, payload: object) => call(cookie, "POST", "/api/audit/extract", payload);

  const documentCount = () => t.db.select().from(documents).all().length;
  const logCount = () => t.db.select().from(auditLog).all().length;

  /** An entry written at a chosen moment, as an older year's would read. Its hashes do not matter here. */
  const entryAt = (instant: string, summary: string) => {
    t.db
      .insert(auditLog)
      .values({
        occurredAt: new Date(instant),
        actorName: "Ana Antes",
        actorRole: "Tesorero/a",
        area: "finances",
        action: "payment.recorded",
        summary,
        prevHash: "x",
        hash: "x",
      })
      .run();
  };

  before(async () => {
    t = await buildTestApp();
    fiscal = await signedInUser(t, "fiscal", "Fabio Fiscal");
    president = await signedInUser(t, "presidente", "Pedro Presidente");
    secretary = await signedInUser(t, "secretario", "Sara Secretaria");
  });

  after(async () => {
    await t.close();
  });

  it("carries when, who, their role, what happened and why, oldest first, and no ID number or phone", async () => {
    const admin = await signedInUser(t, "administrador", "Alba Admin");
    const sector = await call(admin.cookie, "POST", "/api/settings/sectors", { name: "El Centro" });
    assert.equal(sector.statusCode, 201, sector.body);

    // Entries whose "Ver detalle" holds ID numbers and phones: a registration, a corrected phone and a new account.
    const idNumber = "0801199054321";
    const registered = await call(secretary.cookie, "POST", "/api/census/households", {
      submissionId: randomUUID(),
      person: { fullName: "Ana López", idNumber, phone: "99887766" },
      household: { sectorId: sector.json().sector.id, references: "Cerca de la iglesia", waterConnection: "connected", relation: "owner" },
      fee: { kind: "base" },
    });
    assert.equal(registered.statusCode, 201, registered.body);
    const houseId = registered.json().household.id as string;
    const file = await call(secretary.cookie, "GET", `/api/census/households/${houseId}`);
    const personId = file.json().household.owner.personId as string;
    const edited = await call(secretary.cookie, "PATCH", `/api/census/people/${personId}`, { phone: "98765432", reason: "Cambió de número" });
    assert.equal(edited.statusCode, 200, edited.body);
    const accountPhone = nextPhone();
    const account = await call(admin.cookie, "POST", "/api/users", { name: "Vera Vocal", phone: accountPhone, roleCode: "primer_vocal", password: madeUpPassword() });
    assert.equal(account.statusCode, 201, account.body);

    const stored = JSON.stringify(t.db.select().from(auditLog).all());
    for (const secret of [idNumber, "99887766", "98765432", accountPhone.slice(1)]) {
      assert.ok(stored.includes(secret), `the log itself holds ${secret}`);
    }

    const response = await extract(fiscal.cookie, { year: thisYear, format: "print" });
    assert.equal(response.statusCode, 201, response.body);
    const handed = response.json();
    assert.equal(handed.year, thisYear);
    assert.equal(handed.madeOn, today);
    assert.equal(handed.document.madeBy, "Fabio Fiscal");
    assert.ok(!Number.isNaN(Date.parse(handed.document.madeAt)));

    for (const secret of [idNumber, "99887766", "98765432", accountPhone.slice(1)]) {
      assert.ok(!response.body.includes(secret), `the extract must not carry ${secret}`);
    }
    for (const row of handed.entries) {
      assert.deepEqual(Object.keys(row).sort(), ["actorName", "actorRole", "occurredAt", "reason", "summary"]);
    }

    // Every entry of the year, in the order they were made.
    assert.equal(handed.entries.length, logCount());
    assert.deepEqual(
      handed.entries.map((row: { summary: string }) => row.summary),
      t.db.select().from(auditLog).orderBy(auditLog.id).all().map((row) => row.summary),
    );
    const correction = handed.entries.find((row: { reason: string | null }) => row.reason === "Cambió de número");
    assert.equal(correction.actorName, "Sara Secretaria");
    assert.equal(correction.actorRole, "Secretario/a");
    assert.match(correction.summary, /corrigió los datos de Ana López/);
  });

  it("takes the next document number, keeps what it was made for, and writes nothing to Historial", async () => {
    const entriesBefore = logCount();
    const first = await extract(fiscal.cookie, { year: thisYear, format: "print" });
    const second = await extract(president.cookie, { year: thisYear, format: "csv" });
    assert.equal(second.statusCode, 201, second.body);
    assert.equal(second.json().document.number, first.json().document.number + 1);

    const [row] = t.db.select().from(documents).where(eq(documents.id, first.json().document.number)).all();
    assert.equal(row!.kind, "log_extract");
    assert.equal(row!.householdId, null);
    assert.equal(row!.createdBy, fiscal.id);
    assert.deepEqual(row!.details, { year: thisYear, format: "print", count: entriesBefore, madeOn: today });

    assert.equal(logCount(), entriesBefore);
  });

  it("cuts the year at midnight in Honduras, not in UTC, and offers only years with entries", async () => {
    // 11:59 p. m. on 31 December 2023 in Honduras is already 2024 in UTC.
    entryAt("2024-01-01T05:59:59.000Z", "último de 2023");
    entryAt("2024-01-01T06:00:00.000Z", "primero de 2024");

    const choices = await call(fiscal.cookie, "GET", "/api/audit/extract");
    assert.equal(choices.statusCode, 200, choices.body);
    assert.equal(choices.json().thisYear, thisYear);
    // 2025 has nothing, so it is not offered.
    assert.deepEqual(choices.json().years, [
      { year: thisYear, count: logCount() - 2 },
      { year: 2024, count: 1 },
      { year: 2023, count: 1 },
    ]);

    for (const [year, summary] of [[2023, "último de 2023"], [2024, "primero de 2024"]] as const) {
      const response = await extract(fiscal.cookie, { year, format: "print" });
      assert.equal(response.statusCode, 201, response.body);
      assert.deepEqual(
        response.json().entries.map((row: { summary: string }) => row.summary),
        [summary],
      );
    }
  });

  it("refuses a year with nothing in it, or a bad request, and takes no number", async () => {
    const numbers = documentCount();
    const empty = await extract(fiscal.cookie, { year: 2025, format: "print" });
    assert.equal(empty.statusCode, 400);
    assert.equal(empty.json().message, "No hay nada registrado en ese año.");
    assert.equal((await extract(fiscal.cookie, { year: "2026", format: "print" })).statusCode, 400);
    assert.equal((await extract(fiscal.cookie, { year: thisYear, format: "pdf" })).statusCode, 400);
    assert.equal((await extract(fiscal.cookie, { format: "print" })).statusCode, 400);
    assert.equal(documentCount(), numbers);
  });

  it("is refused without the permission to print the log, or to see it, and takes no number", async () => {
    const numbers = documentCount();
    const vocal = await signedInUser(t, "primer_vocal");
    takeAway(t, "primer_vocal", "export:log");
    const otherVocal = await signedInUser(t, "segundo_vocal");
    takeAway(t, "segundo_vocal", "log:view");
    for (const cookie of [vocal.cookie, otherVocal.cookie]) {
      assert.equal((await extract(cookie, { year: thisYear, format: "print" })).statusCode, 403);
      assert.equal((await call(cookie, "GET", "/api/audit/extract")).statusCode, 403);
    }
    assert.equal((await t.app.inject({ method: "POST", url: "/api/audit/extract", payload: { year: thisYear, format: "print" } })).statusCode, 401);
    assert.equal(documentCount(), numbers);
  });
});
