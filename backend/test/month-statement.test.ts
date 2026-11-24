import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import { eq } from "drizzle-orm";

import { auditLog, categories, documents, feeRates } from "../src/db/schema.js";
import { firstOfMonth } from "../src/lib/fees.js";
import { addMonths } from "../src/lib/payments.js";
import { HONDURAS_TIME_ZONE, businessToday } from "../src/lib/time.js";
import type { TestApp } from "./helpers.js";
import { buildTestApp, signedInUser, takeAway } from "./helpers.js";

/**
 * Estado financiero del mes (owner, 23 November 2026): Resumen del mes as a
 * numbered document. It must say what the summary says, take the same
 * document count as statements and receipts, and leave nothing in Historial
 * (owner, 24 November 2026: printing is not logged).
 */
describe("Estado financiero del mes: a month's summary as a numbered document", () => {
  let t: TestApp;
  let treasurer: { id: string; cookie: string };
  let president: { cookie: string };
  let secretary: { cookie: string };
  let vocal: { cookie: string };
  let idCounter = 801199500000;
  let receiptCounter = 9000;

  const today = businessToday(HONDURAS_TIME_ZONE);
  const thisMonth = firstOfMonth(today);
  const m = (by: number) => addMonths(thisMonth, -by);
  const month = m(1);
  const dayOf = (first: string, day: number) => `${first.slice(0, 8)}${String(day).padStart(2, "0")}`;

  const call = (cookie: string, method: "GET" | "POST", url: string, payload?: object) =>
    t.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

  before(async () => {
    t = await buildTestApp();
    treasurer = await signedInUser(t, "tesorero", "Tina Tesorera");
    president = await signedInUser(t, "presidente", "Pedro Presidente");
    secretary = await signedInUser(t, "secretario");
    vocal = await signedInUser(t, "primer_vocal");
    const admin = await signedInUser(t, "administrador");
    await t.db.insert(feeRates).values([{ kind: "base_monthly", amountCentavos: 7000, startsOn: m(24) }]);

    const sector = await call(admin.cookie, "POST", "/api/settings/sectors", { name: "El Centro" });
    const created = await call(secretary.cookie, "POST", "/api/census/households", {
      submissionId: randomUUID(),
      person: { fullName: "ana lópez", idNumber: String((idCounter += 1)).padStart(13, "0"), phone: "99887766" },
      household: { sectorId: sector.json().sector.id, references: "Cerca del tanque", waterConnection: "connected", relation: "owner" },
      fee: { kind: "base" },
      paper: { date: dayOf(m(3), 1), formNumber: String(idCounter) },
    });
    assert.equal(created.statusCode, 201, created.body);
    const house = created.json().household as { id: string };

    assert.equal((await call(treasurer.cookie, "POST", "/api/finance/opening-balance", { month: m(2), cashCentavos: 100000, bankCentavos: 500000 })).statusCode, 200);
    const paid = await call(treasurer.cookie, "POST", "/api/finance/payments", {
      submissionId: randomUUID(),
      householdId: house.id,
      months: [month],
      amountCentavos: 7000,
      occurredOn: dayOf(month, 5),
      paymentMethod: "cash",
      paperReceiptNumber: String((receiptCounter += 1)),
    });
    assert.equal(paid.statusCode, 201, paid.body);
    const chlorine = t.db.select().from(categories).where(eq(categories.name, "Cloro")).get()!.id;
    const spent = await call(treasurer.cookie, "POST", "/api/finance/expenses", {
      submissionId: randomUUID(),
      categoryId: chlorine,
      supplier: "Ferretería El Puente",
      amountCentavos: 2000,
      occurredOn: dayOf(month, 14),
      paymentMethod: "cash",
      noPhotoReason: "Pagado a mano, sin factura",
    });
    assert.equal(spent.statusCode, 201, spent.body);
  });
  after(async () => {
    await t.close();
  });

  it("hands one out with the next document number, the summary it was made from, and nothing in Historial", async () => {
    const before = (await t.db.select().from(documents)).length;
    // Looking at the summary changes nothing.
    const looked = await call(treasurer.cookie, "GET", `/api/finance/summary/${month}`);
    assert.equal(looked.statusCode, 200, looked.body);
    assert.equal((await t.db.select().from(documents)).length, before);

    const first = await call(treasurer.cookie, "POST", `/api/finance/summary/${month}/statement`);
    assert.equal(first.statusCode, 201, first.body);
    const second = await call(president.cookie, "POST", `/api/finance/summary/${month}/statement`);
    assert.equal(second.statusCode, 201, second.body);

    const { summary, document } = first.json();
    assert.deepEqual(summary, looked.json());
    assert.equal(document.madeBy, "Tina Tesorera");
    assert.ok(!Number.isNaN(Date.parse(document.madeAt)));
    assert.equal(second.json().document.number, document.number + 1);
    assert.equal(second.json().document.madeBy, "Pedro Presidente");

    const [row] = await t.db.select().from(documents).where(eq(documents.id, document.number));
    assert.equal(row!.kind, "month_statement");
    assert.equal(row!.householdId, null);
    assert.equal(row!.createdBy, treasurer.id);
    assert.deepEqual(row!.details, {
      month,
      madeOn: today,
      status: "open",
      incomeCentavos: 7000,
      expenseCentavos: 2000,
      expectedCentavos: 600000 + 7000 - 2000,
    });

    assert.equal((await t.db.select().from(auditLog).where(eq(auditLog.entityType, "document"))).length, 0);
    assert.equal((await t.db.select().from(auditLog).where(eq(auditLog.area, "exports"))).length, 0);
  });

  it("shares one running count with every other document", async () => {
    const last = (await t.db.select().from(documents)).map((row) => row.id).sort((a, b) => a - b).at(-1)!;
    const next = await call(treasurer.cookie, "POST", `/api/finance/summary/${month}/statement`);
    assert.equal(next.json().document.number, last + 1);
  });

  it("makes no document, and uses no number, for a month the summary refuses", async () => {
    const count = (await t.db.select().from(documents)).length;
    for (const refused of [m(3), addMonths(thisMonth, 1), "2026-13-01", dayOf(month, 15)]) {
      const response = await call(treasurer.cookie, "POST", `/api/finance/summary/${refused}/statement`);
      assert.equal(response.statusCode, 400, refused);
    }
    assert.equal((await t.db.select().from(documents)).length, count);
  });

  it("lets only those who may see finances look, and only those who may export finances hand one out", async () => {
    takeAway(t, "primer_vocal", "export:finance");
    takeAway(t, "secretario", "finance:view", "export:finance");
    const count = (await t.db.select().from(documents)).length;
    assert.equal((await call(secretary.cookie, "POST", `/api/finance/summary/${month}/statement`)).statusCode, 403);
    assert.equal((await call(vocal.cookie, "GET", `/api/finance/summary/${month}`)).statusCode, 200);
    assert.equal((await call(vocal.cookie, "POST", `/api/finance/summary/${month}/statement`)).statusCode, 403);
    assert.equal((await t.app.inject({ method: "POST", url: `/api/finance/summary/${month}/statement` })).statusCode, 401);
    assert.equal((await t.db.select().from(documents)).length, count);
  });
});
