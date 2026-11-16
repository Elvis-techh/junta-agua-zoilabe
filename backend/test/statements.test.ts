import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import { and, eq } from "drizzle-orm";

import { auditLog, documents, feeRates } from "../src/db/schema.js";
import { firstOfMonth, monthName } from "../src/lib/fees.js";
import { addMonths } from "../src/lib/payments.js";
import { HONDURAS_TIME_ZONE, businessToday } from "../src/lib/time.js";
import type { TestApp } from "./helpers.js";
import { buildTestApp, rejectsWithDbError, signedInUser, takeAway } from "./helpers.js";

describe("Estado de cuenta: a house's statement", () => {
  let t: TestApp;
  let treasurer: { id: string; cookie: string };
  let president: { cookie: string };
  let secretary: { cookie: string };
  let vocal: { cookie: string };
  let house: { id: string; code: string };
  let idCounter = 801199400000;
  let receiptCounter = 7000;

  const today = businessToday(HONDURAS_TIME_ZONE);
  const thisMonth = firstOfMonth(today);
  const m = (by: number) => addMonths(thisMonth, -by);
  /** A day inside a month: "2026-05-01", 5 → "2026-05-05". */
  const dayOf = (month: string, day: number) => `${month.slice(0, 8)}${String(day).padStart(2, "0")}`;

  const call = (cookie: string, method: "GET" | "POST", url: string, payload?: object) =>
    t.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

  const register = async (name: string) => {
    const admin = await signedInUser(t, "administrador");
    const sector = await call(admin.cookie, "POST", "/api/settings/sectors", { name: `Sector ${randomUUID().slice(0, 6)}` });
    const created = await call(secretary.cookie, "POST", "/api/census/households", {
      submissionId: randomUUID(),
      person: { fullName: name, idNumber: String((idCounter += 1)).padStart(13, "0"), phone: "99887766" },
      household: { sectorId: sector.json().sector.id, references: "Cerca de la escuela", waterConnection: "connected", relation: "owner" },
      fee: { kind: "base" },
    });
    assert.equal(created.statusCode, 201, created.body);
    return created.json().household as { id: string; code: string };
  };
  const pay = async (householdId: string, months: string[], occurredOn: string, amountCentavos: number) => {
    const response = await call(treasurer.cookie, "POST", "/api/finance/payments", {
      submissionId: randomUUID(),
      householdId,
      months,
      amountCentavos,
      occurredOn,
      paymentMethod: "cash",
      paperReceiptNumber: String((receiptCounter += 1)),
    });
    assert.equal(response.statusCode, 201, response.body);
    return response.json().payment as { id: string; paperReceiptNumber: string };
  };
  const lateFee = async (householdId: string, month: string) => {
    const response = await call(treasurer.cookie, "POST", "/api/finance/income", {
      submissionId: randomUUID(),
      type: "late_fee",
      householdId,
      month,
      amountCentavos: 5000,
      occurredOn: today,
      paymentMethod: "cash",
      paperReceiptNumber: String((receiptCounter += 1)),
    });
    assert.equal(response.statusCode, 201, response.body);
    return response.json().entry as { id: string };
  };
  const statement = async (id: string, from?: string) => {
    const response = await call(treasurer.cookie, "GET", `/api/finance/households/${id}/statement${from ? `?from=${from}` : ""}`);
    assert.equal(response.statusCode, 200, response.body);
    return response.json().statement;
  };

  before(async () => {
    t = await buildTestApp();
    treasurer = await signedInUser(t, "tesorero", "Tina Tesorera");
    president = await signedInUser(t, "presidente", "Pedro Presidente");
    secretary = await signedInUser(t, "secretario");
    vocal = await signedInUser(t, "primer_vocal");
    // L 70 a month and L 50 late fee from three years back; the app adds late fees from six months ago.
    await t.db.insert(feeRates).values([
      { kind: "base_monthly", amountCentavos: 7000, startsOn: m(36) },
      { kind: "late_fee", amountCentavos: 5000, startsOn: m(36) },
    ]);
    assert.equal((await call(president.cookie, "POST", "/api/settings/late-fees", { month: m(6) })).statusCode, 200);

    house = await register("rosa martínez");
    // Paid m(5) and m(4) in time on one receipt; m(3) half; m(2) and m(1) not at all.
    await pay(house.id, [m(5), m(4)], dayOf(m(5), 10), 14000);
    await pay(house.id, [m(3)], dayOf(m(3), 12), 3000);
  });
  after(async () => {
    await t.close();
  });

  it("says what the house paid and what it owes today, the same as Lo que debe", async () => {
    const paidLateFee = await lateFee(house.id, m(3));
    const s = await statement(house.id, m(8));
    assert.equal(s.today, today);
    assert.equal(s.from, m(8));
    assert.equal(s.household.code, house.code);
    assert.equal(s.household.ownerName, "Rosa Martínez");
    assert.match(s.household.sectorName, /^Sector /);

    assert.deepEqual(
      s.payments.map((p: { occurredOn: string; amountCentavos: number; months: string[] }) => [p.occurredOn, p.amountCentavos, p.months]),
      [
        [dayOf(m(5), 10), 14000, [m(5), m(4)]],
        [dayOf(m(3), 12), 3000, [m(3)]],
      ],
    );
    assert.deepEqual(
      s.otherIncome.map((e: { id: string; type: string; month: string; amountCentavos: number }) => [e.id, e.type, e.month, e.amountCentavos]),
      [[paidLateFee.id, "late_fee", m(3), 5000]],
    );
    assert.equal(s.paidCentavos, 22000);

    assert.deepEqual(s.owed.months, [
      { month: m(3), owedCentavos: 4000 },
      { month: m(2), owedCentavos: 7000 },
      { month: m(1), owedCentavos: 7000 },
    ]);
    // m(3)'s late fee is paid; m(2) and m(1) still owe theirs.
    assert.deepEqual(s.owed.lateFees, [
      { month: m(2), amountCentavos: 5000 },
      { month: m(1), amountCentavos: 5000 },
    ]);
    assert.equal(s.owed.monthsCentavos, 18000);
    assert.equal(s.owed.lateFeesCentavos, 10000);
    assert.equal(s.owed.totalCentavos, 28000);

    const owed = (await call(treasurer.cookie, "GET", `/api/finance/households/${house.id}/owed`)).json();
    assert.equal(s.owed.monthsCentavos, owed.totalCentavos);
    assert.equal(s.owed.lateFeesCentavos, owed.lateFees.totalCentavos);
    assert.deepEqual(s.owed.months.map((x: { month: string }) => x.month), owed.months.map((x: { month: string }) => x.month));
  });

  it("lists payments only from the month the treasurer chooses, and from January when none is chosen (owner, 15 November 2026)", async () => {
    const later = await statement(house.id, m(3));
    assert.deepEqual(later.payments.map((p: { occurredOn: string }) => p.occurredOn), [dayOf(m(3), 12)]);
    // What it owes does not depend on where the list starts.
    assert.equal(later.owed.totalCentavos, 28000);

    assert.equal((await statement(house.id)).from, `${today.slice(0, 4)}-01-01`);

    const future = await call(treasurer.cookie, "GET", `/api/finance/households/${house.id}/statement?from=${addMonths(thisMonth, 1)}`);
    assert.equal(future.statusCode, 400);
    assert.match(future.json().message, /^Elija este mes o uno anterior\.$/);
    assert.equal((await call(treasurer.cookie, "GET", `/api/finance/households/${house.id}/statement?from=1900-01-01`)).statusCode, 400);
    assert.equal((await call(treasurer.cookie, "GET", `/api/finance/households/${house.id}/statement?from=2026-13-01`)).statusCode, 400);
    assert.equal((await call(treasurer.cookie, "GET", `/api/finance/households/${randomUUID()}/statement`)).statusCode, 404);
  });

  it("leaves out a payment that was undone, and its reversal", async () => {
    const other = await register("ana gómez");
    const wrong = await pay(other.id, [m(2)], dayOf(m(2), 3), 7000);
    await pay(other.id, [m(1)], dayOf(m(1), 3), 7000);
    assert.equal((await statement(other.id, m(6))).payments.length, 2);

    const undone = await call(president.cookie, "POST", `/api/finance/payments/${wrong.id}/reverse`, { reason: "Era de otra vivienda" });
    assert.equal(undone.statusCode, 200, undone.body);
    const s = await statement(other.id, m(6));
    assert.deepEqual(s.payments.map((p: { months: string[] }) => p.months), [[m(1)]]);
    assert.equal(s.paidCentavos, 7000);
  });

  it("says nothing is owed for a house that is up to date", async () => {
    const paidUp = await register("luis pineda");
    await pay(paidUp.id, [thisMonth], today, 7000);
    const s = await statement(paidUp.id);
    assert.deepEqual(s.owed, { months: [], lateFees: [], monthsCentavos: 0, lateFeesCentavos: 0, totalCentavos: 0 });
  });

  it("hands one out with the next document number, who made it, and an entry in Historial", async () => {
    const noDocuments = (await t.db.select().from(documents)).length;
    // Looking changes nothing.
    await statement(house.id, m(8));
    assert.equal((await t.db.select().from(documents)).length, noDocuments);

    const first = await call(treasurer.cookie, "POST", `/api/finance/households/${house.id}/statement`, { from: m(8) });
    assert.equal(first.statusCode, 201, first.body);
    const second = await call(president.cookie, "POST", `/api/finance/households/${house.id}/statement`, { from: m(3) });
    assert.equal(second.statusCode, 201, second.body);

    const { statement: handed, document } = first.json();
    assert.deepEqual(handed, await statement(house.id, m(8)));
    assert.equal(document.madeBy, "Tina Tesorera");
    assert.ok(!Number.isNaN(Date.parse(document.madeAt)));
    assert.equal(second.json().document.number, document.number + 1);
    assert.equal(second.json().document.madeBy, "Pedro Presidente");

    const [row] = await t.db.select().from(documents).where(eq(documents.id, document.number));
    assert.equal(row!.kind, "household_statement");
    assert.equal(row!.householdId, house.id);
    assert.equal(row!.createdBy, treasurer.id);
    assert.deepEqual(row!.details, { from: m(8), madeOn: today, paidCentavos: handed.paidCentavos, owedCentavos: 28000 });

    const [logged] = await t.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityType, "document"), eq(auditLog.entityId, String(document.number))));
    assert.equal(logged!.area, "exports");
    assert.equal(logged!.action, "statement.issued");
    assert.equal(
      logged!.summary,
      `Tina Tesorera (Tesorero/a) hizo el estado de cuenta nº ${document.number} de la vivienda ${house.code} (Rosa Martínez), desde ${monthName(m(8))}`,
    );
  });

  it("lets only those who may see finances look, and only those who may export finances hand one out", async () => {
    takeAway(t, "primer_vocal", "export:finance");
    takeAway(t, "secretario", "finance:view");
    const count = (await t.db.select().from(documents)).length;
    assert.equal((await call(secretary.cookie, "GET", `/api/finance/households/${house.id}/statement`)).statusCode, 403);
    assert.equal((await call(vocal.cookie, "GET", `/api/finance/households/${house.id}/statement`)).statusCode, 200);
    assert.equal((await call(vocal.cookie, "POST", `/api/finance/households/${house.id}/statement`, { from: m(3) })).statusCode, 403);
    assert.equal((await t.app.inject({ method: "GET", url: `/api/finance/households/${house.id}/statement` })).statusCode, 401);
    assert.equal((await t.db.select().from(documents)).length, count);
  });

  it("keeps a document number for good: the database refuses to change or delete one", async () => {
    await rejectsWithDbError(t.db.update(documents).set({ kind: "household_statement", details: {} }), /history is never changed: documents/);
    await rejectsWithDbError(t.db.delete(documents), /nothing is deleted: documents/);
  });
});
