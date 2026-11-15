import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";

import { and, eq } from "drizzle-orm";

import { auditLog, householdStatusChanges, households } from "../src/db/schema.js";
import type { StatusEntry } from "../src/lib/householdStatus.js";
import { entryOn, hasService, statusEntries } from "../src/lib/householdStatus.js";
import { HONDURAS_TIME_ZONE, businessToday } from "../src/lib/time.js";
import type { TestApp } from "./helpers.js";
import { buildTestApp, rejectsWithDbError, signedInUser } from "./helpers.js";

const entry = (id: number, startsOn: string, status: "active" | "inactive" = "active", waterConnection: StatusEntry["waterConnection"] = "connected"): StatusEntry => ({
  id,
  status,
  inactiveReason: status === "inactive" ? "moved_away" : null,
  waterConnection,
  startsOn,
  createdAt: new Date(),
  createdBy: null,
});

describe("a household's status on a day (owner, 14 November 2026)", () => {
  it("is the newest entry whose date is not after the day", () => {
    const entries = [entry(1, "2025-01-10"), entry(2, "2025-06-01", "inactive"), entry(3, "2025-09-15")];
    assert.equal(entryOn(entries, "2025-05-31")!.id, 1);
    assert.equal(entryOn(entries, "2025-06-01")!.id, 2);
    assert.equal(entryOn(entries, "2025-12-01")!.id, 3);
  });

  it("lets an entry dated in the past take over from its date, without changing what was entered before", () => {
    // Registered on 1 November; entered afterwards: without water since March.
    const entries = [entry(1, "2026-11-01"), entry(2, "2026-03-01", "active", "not_connected")];
    assert.equal(entryOn(entries, "2026-04-30")!.id, 2);
    assert.equal(entryOn(entries, "2026-11-14")!.id, 2, "the newer entry covers today too");
    assert.equal(entryOn(entries, "2026-02-28")!.id, 1, "before every date, the first entry");
  });

  it("has service only while active with water, connected or shared", () => {
    assert.equal(hasService(entry(1, "2026-01-01")), true);
    assert.equal(hasService(entry(1, "2026-01-01", "active", "shared")), true);
    assert.equal(hasService(entry(1, "2026-01-01", "active", "not_connected")), false);
    assert.equal(hasService(entry(1, "2026-01-01", "inactive")), false);
  });
});

describe("the status history in the census", () => {
  let t: TestApp;
  let secretary: { cookie: string };
  let president: { cookie: string };
  let sectorId: number;
  let idCounter = 801199400000;
  const today = businessToday(HONDURAS_TIME_ZONE);

  const call = (cookie: string, method: "GET" | "POST" | "PATCH", url: string, payload?: object) =>
    t.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
  const register = async (paper?: { date: string; formNumber: string }) => {
    const created = await call(secretary.cookie, "POST", "/api/census/households", {
      submissionId: randomUUID(),
      person: { fullName: "elena reyes", idNumber: String((idCounter += 1)).padStart(13, "0"), phone: "99887766" },
      household: { sectorId, references: "Al final de la calle", waterConnection: "connected", relation: "owner" },
      fee: { kind: "base" },
      ...(paper ? { paper } : {}),
    });
    assert.equal(created.statusCode, 201, created.body);
    return created.json().household as { id: string; code: string };
  };
  const historyOf = async (id: string) =>
    (await call(secretary.cookie, "GET", `/api/census/households/${id}`)).json().household.statusHistory as Array<{
      status: string;
      waterConnection: string;
      startsOn: string;
      createdBy: string | null;
    }>;

  before(async () => {
    t = await buildTestApp();
    secretary = await signedInUser(t, "secretario", "Sara Secretaria");
    president = await signedInUser(t, "presidente", "Pedro Presidente");
    const admin = await signedInUser(t, "administrador");
    sectorId = (await call(admin.cookie, "POST", "/api/settings/sectors", { name: "El Centro" })).json().sector.id;
  });
  after(async () => {
    await t.close();
  });

  it("starts with the registration: active, with its connection, since the paper form's date", async () => {
    const house = await register({ date: "2024-03-05", formNumber: "17" });
    assert.deepEqual(
      (await historyOf(house.id)).map(({ status, waterConnection, startsOn, createdBy }) => ({ status, waterConnection, startsOn, createdBy })),
      [{ status: "active", waterConnection: "connected", startsOn: "2024-03-05", createdBy: "Sara Secretaria" }],
    );
  });

  it("takes a date for a deactivation and a reactivation, today by default, never after today, and logs it", async () => {
    const house = await register();
    const future = new Date(`${today}T12:00:00Z`);
    future.setUTCDate(future.getUTCDate() + 1);
    const tooLate = await call(president.cookie, "POST", `/api/census/households/${house.id}/deactivate`, {
      reason: "moved_away",
      since: future.toISOString().slice(0, 10),
    });
    assert.equal(tooLate.statusCode, 400);
    assert.match(tooLate.json().message, /no puede ser después de hoy/);

    const off = await call(president.cookie, "POST", `/api/census/households/${house.id}/deactivate`, { reason: "moved_away", since: "2025-02-01" });
    assert.equal(off.statusCode, 200, off.body);
    const on = await call(president.cookie, "POST", `/api/census/households/${house.id}/reactivate`, {});
    assert.equal(on.statusCode, 200, on.body);

    const history = await historyOf(house.id);
    assert.deepEqual(
      history.map(({ status, startsOn }) => [status, startsOn]),
      [
        ["active", today],
        ["inactive", "2025-02-01"],
        ["active", today],
      ],
    );
    const [logged] = await t.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, "household.deactivated"), eq(auditLog.entityId, house.id)));
    assert.match(logged!.summary, /desactivó la vivienda .+ desde el 1 de febrero de 2025: Se mudó$/);
    assert.equal(statusEntries(t.db, house.id).length, 3);
  });

  it("is kept by the database: an entry cannot be changed or deleted", async () => {
    await rejectsWithDbError(t.db.update(householdStatusChanges).set({ status: "inactive" }), /history is never changed: household_status_changes/);
    await rejectsWithDbError(t.db.delete(householdStatusChanges), /nothing is deleted: household_status_changes/);
  });

  it("is made for households registered before it existed, by the migration", async () => {
    // Two houses as an older database had them: no history entries yet.
    const old = { sectorId, references: "Junto al río", waterConnection: "shared" as const, createdBy: null };
    const activeId = randomUUID();
    const inactiveId = randomUUID();
    await t.db.insert(households).values([
      { ...old, id: activeId, code: "Z-9001", status: "active", paperDate: "2023-07-01", submissionId: randomUUID() },
      { ...old, id: inactiveId, code: "Z-9002", status: "inactive", inactiveReason: "moved_away", submissionId: randomUUID() },
    ]);
    await t.db.insert(auditLog).values({
      occurredAt: new Date("2025-08-20T15:00:00Z"),
      actorName: "Alguien",
      actorRole: "Secretario/a",
      area: "census",
      action: "household.deactivated",
      summary: "desactivó la vivienda Z-9002",
      entityType: "household",
      entityId: inactiveId,
      prevHash: "0".repeat(64),
      hash: "1".repeat(64),
    });

    // The migration's own statements that fill the history, run as the migration runs them.
    const migration = readFileSync(new URL("../drizzle/0005_household_status_history.sql", import.meta.url), "utf8");
    for (const statement of migration.split("--> statement-breakpoint").filter((part) => part.includes("INSERT INTO"))) {
      t.sqlite.exec(statement);
    }

    const pick = (rows: StatusEntry[]) => rows.map(({ status, waterConnection, startsOn }) => [status, waterConnection, startsOn]);
    assert.deepEqual(pick(statusEntries(t.db, activeId)), [["active", "shared", "2023-07-01"]]);
    const registeredOn = (await t.db.select().from(households).where(eq(households.id, inactiveId)))[0]!.createdAt.toISOString().slice(0, 10);
    assert.deepEqual(pick(statusEntries(t.db, inactiveId)), [
      ["active", "shared", registeredOn],
      ["inactive", "shared", "2025-08-20"],
    ]);
  });
});
