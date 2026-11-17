import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import { and, eq } from "drizzle-orm";

import { auditLog, documents, feeRates } from "../src/db/schema.js";
import { firstOfMonth } from "../src/lib/fees.js";
import { addMonths } from "../src/lib/payments.js";
import { HONDURAS_TIME_ZONE, businessToday } from "../src/lib/time.js";
import type { TestApp } from "./helpers.js";
import { buildTestApp, rejectsWithDbError, signedInUser, takeAway } from "./helpers.js";

describe("Recibo digital: a receipt for a money-in entry", () => {
  let t: TestApp;
  let treasurer: { id: string; cookie: string };
  let president: { cookie: string };
  let vocal: { cookie: string };
  let secretary: { cookie: string };
  let house: { id: string; code: string };
  let idCounter = 801199500000;
  let receiptCounter = 8000;

  const today = businessToday(HONDURAS_TIME_ZONE);
  const thisMonth = firstOfMonth(today);
  const m = (by: number) => addMonths(thisMonth, -by);

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
  const pay = async (months: string[], amountCentavos: number) => {
    const response = await call(treasurer.cookie, "POST", "/api/finance/payments", {
      submissionId: randomUUID(),
      householdId: house.id,
      months,
      amountCentavos,
      occurredOn: today,
      paymentMethod: "cash",
      paperReceiptNumber: String((receiptCounter += 1)),
    });
    assert.equal(response.statusCode, 201, response.body);
    return response.json().payment as { id: string; paperReceiptNumber: string };
  };
  const income = async (overrides: Record<string, unknown>) => {
    const response = await call(treasurer.cookie, "POST", "/api/finance/income", {
      submissionId: randomUUID(),
      amountCentavos: 5000,
      occurredOn: today,
      paymentMethod: "cash",
      paperReceiptNumber: String((receiptCounter += 1)),
      ...overrides,
    });
    assert.equal(response.statusCode, 201, response.body);
    return response.json().entry as { id: string };
  };
  const receipt = async (id: string, cookie = treasurer.cookie) => call(cookie, "GET", `/api/finance/receipts/${id}`);
  const handOut = async (id: string, cookie = treasurer.cookie) => call(cookie, "POST", `/api/finance/receipts/${id}`);

  before(async () => {
    t = await buildTestApp();
    treasurer = await signedInUser(t, "tesorero", "Tina Tesorera");
    president = await signedInUser(t, "presidente", "Pedro Presidente");
    secretary = await signedInUser(t, "secretario");
    vocal = await signedInUser(t, "primer_vocal");
    await t.db.insert(feeRates).values([
      { kind: "base_monthly", amountCentavos: 7000, startsOn: m(24) },
      { kind: "late_fee", amountCentavos: 5000, startsOn: m(24) },
      { kind: "connection", amountCentavos: 150000, startsOn: m(24) },
    ]);
    house = await register("rosa martínez");
  });
  after(async () => {
    await t.close();
  });

  it("makes a receipt for a monthly fee payment: its months, the house, who paid and the paper receipt", async () => {
    const payment = await pay([m(2), m(1)], 14000);
    const response = await receipt(payment.id);
    assert.equal(response.statusCode, 200, response.body);
    const r = response.json().receipt;
    assert.equal(r.today, today);
    assert.deepEqual(r.concept, { kind: "monthly", months: [m(2), m(1)] });
    assert.equal(r.household.code, house.code);
    assert.equal(r.household.ownerName, "Rosa Martínez");
    assert.match(r.household.sectorName, /^Sector /);
    assert.equal(r.payerName, "Rosa Martínez");
    assert.equal(r.amountCentavos, 14000);
    assert.equal(r.paymentMethod, "cash");
    assert.equal(r.paperReceiptNumber, payment.paperReceiptNumber);
  });

  it("makes a receipt for other income: a late fee with its month", async () => {
    const entry = await income({ type: "late_fee", householdId: house.id, month: m(2), amountCentavos: 5000 });
    const r = (await receipt(entry.id)).json().receipt;
    assert.deepEqual(r.concept, { kind: "other", type: "late_fee", month: m(2), note: null });
    assert.equal(r.household.code, house.code);
    assert.equal(r.amountCentavos, 5000);
  });

  it("makes a receipt for other income from outside the census, with no house but a payer and a note", async () => {
    const entry = await income({ type: "other", amountCentavos: 2000, payerName: "Junta vecina", note: "Venta de tubo sobrante" });
    const r = (await receipt(entry.id)).json().receipt;
    assert.deepEqual(r.concept, { kind: "other", type: "other", month: null, note: "Venta de tubo sobrante" });
    assert.equal(r.household, null);
    assert.equal(r.payerName, "Junta vecina");
  });

  it("has no receipt for an expense, a reversal, a reversed payment, or a missing entry", async () => {
    // An expense.
    const expense = await call(treasurer.cookie, "POST", "/api/finance/expenses", {
      submissionId: randomUUID(),
      categoryId: (await t.db.query.categories.findFirst({ where: (c, { and: a, eq: e }) => a(e(c.kind, "expense"), e(c.name, "Cloro")) }))!.id,
      supplier: "Ferretería El Puente",
      amountCentavos: 45000,
      occurredOn: today,
      paymentMethod: "cash",
      noPhotoReason: "Sin recibo de la tienda",
    });
    assert.equal(expense.statusCode, 201, expense.body);
    assert.equal((await receipt(expense.json().entry.id)).statusCode, 404);

    // A payment, then undone: no receipt for it, and none for the reversal.
    const payment = await pay([m(3)], 7000);
    assert.equal((await receipt(payment.id)).statusCode, 200);
    const undone = await call(president.cookie, "POST", `/api/finance/payments/${payment.id}/reverse`, { reason: "Era de otra vivienda" });
    assert.equal(undone.statusCode, 200, undone.body);
    const reversedTry = await receipt(payment.id);
    assert.equal(reversedTry.statusCode, 409);
    assert.equal(reversedTry.json().error, "reversed");
    assert.equal((await receipt(randomUUID())).statusCode, 404);
    assert.equal((await handOut(randomUUID())).statusCode, 404);
  });

  it("hands one out with the next document number, shared with statements, and logs it under Impresiones", async () => {
    const payment = await pay([thisMonth], 7000);
    const before = (await t.db.select().from(documents)).length;
    // Looking changes nothing.
    await receipt(payment.id);
    assert.equal((await t.db.select().from(documents)).length, before);

    // A statement first, so the receipt takes the number after it: one running count.
    const statement = await call(treasurer.cookie, "POST", `/api/finance/households/${house.id}/statement`, { from: thisMonth });
    assert.equal(statement.statusCode, 201, statement.body);
    const handed = await handOut(payment.id);
    assert.equal(handed.statusCode, 201, handed.body);
    const { receipt: made, document } = handed.json();
    assert.equal(document.number, statement.json().document.number + 1);
    assert.equal(document.madeBy, "Tina Tesorera");
    assert.ok(!Number.isNaN(Date.parse(document.madeAt)));
    assert.equal(made.paperReceiptNumber, payment.paperReceiptNumber);

    const [row] = await t.db.select().from(documents).where(eq(documents.id, document.number));
    assert.equal(row!.kind, "receipt");
    assert.equal(row!.householdId, house.id);
    assert.deepEqual(row!.details, { transactionId: payment.id, amountCentavos: 7000, paperReceiptNumber: payment.paperReceiptNumber });

    const [logged] = await t.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityType, "document"), eq(auditLog.entityId, String(document.number))));
    assert.equal(logged!.area, "exports");
    assert.equal(logged!.action, "receipt.issued");
    assert.match(logged!.summary, new RegExp(`^Tina Tesorera \\(Tesorero/a\\) hizo el recibo nº ${document.number} de una cuota mensual: Rosa Martínez, vivienda ${house.code}, recibo de papel nº ${payment.paperReceiptNumber}$`));
  });

  it("lets only those who may see finances look, and only those who may export finances hand one out", async () => {
    const payment = await pay([m(4)], 7000);
    takeAway(t, "primer_vocal", "export:finance");
    takeAway(t, "secretario", "finance:view");
    const count = (await t.db.select().from(documents)).length;
    assert.equal((await receipt(payment.id, secretary.cookie)).statusCode, 403);
    assert.equal((await receipt(payment.id, vocal.cookie)).statusCode, 200);
    assert.equal((await handOut(payment.id, vocal.cookie)).statusCode, 403);
    assert.equal((await t.app.inject({ method: "GET", url: `/api/finance/receipts/${payment.id}` })).statusCode, 401);
    assert.equal((await t.db.select().from(documents)).length, count);
  });

  it("keeps a document number for good: the database refuses to change or delete one", async () => {
    const payment = await pay([m(5)], 7000);
    await handOut(payment.id);
    await rejectsWithDbError(t.db.update(documents).set({ kind: "receipt" }), /history is never changed: documents/);
    await rejectsWithDbError(t.db.delete(documents), /nothing is deleted: documents/);
  });
});
