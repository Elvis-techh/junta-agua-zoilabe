import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import { and, eq } from "drizzle-orm";

import { auditLog, feeRates, months, transactions } from "../src/db/schema.js";
import { verifyChain } from "../src/lib/audit.js";
import { firstOfMonth } from "../src/lib/fees.js";
import { addMonths } from "../src/lib/payments.js";
import { HONDURAS_TIME_ZONE, businessToday } from "../src/lib/time.js";
import type { TestApp } from "./helpers.js";
import { TEST_PIN, buildTestApp, signedInUser, takeAway } from "./helpers.js";

/*
 * Anular pago: the board's answers of 7 November 2026. Only a whole payment
 * is reversed; the reversal is dated the day it is made; it can be made at
 * any time; and a reversal is final.
 */
describe("Anular pago: reversing a monthly fee payment", () => {
  let t: TestApp;
  let treasurer: { id: string; cookie: string };
  let president: { id: string; cookie: string };
  let householdId: string;
  let householdCode: string;

  const today = businessToday(HONDURAS_TIME_ZONE);
  const thisMonth = firstOfMonth(today);
  const lastMonth = addMonths(thisMonth, -1);

  const call = (cookie: string, method: "GET" | "POST", url: string, payload?: object) =>
    t.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

  let receiptCounter = 5000;
  const pay = async (overrides: Record<string, unknown> = {}) => {
    const response = await call(treasurer.cookie, "POST", "/api/finance/payments", {
      submissionId: randomUUID(),
      householdId,
      months: [lastMonth],
      amountCentavos: 7000,
      occurredOn: today,
      paymentMethod: "cash",
      paperReceiptNumber: String((receiptCounter += 1)),
      ...overrides,
    });
    assert.equal(response.statusCode, 201, response.body);
    return response.json().payment as { id: string; paperReceiptNumber: string };
  };
  const reverse = (cookie: string, id: string, reason: unknown = "Se registró en la vivienda equivocada") =>
    call(cookie, "POST", `/api/finance/payments/${id}/reverse`, { reason });
  const confirmPin = async (cookie: string) =>
    assert.equal((await call(cookie, "POST", "/api/auth/confirm-pin", { pin: TEST_PIN })).statusCode, 200);
  const monthsOf = async () => {
    const response = await call(treasurer.cookie, "GET", `/api/finance/households/${householdId}/months?from=${lastMonth}`);
    const body = response.json() as { months: Array<{ month: string; priceCentavos: number | null; paidCentavos: number }> };
    return new Map(body.months.map((state) => [state.month, state]));
  };
  const paymentsOf = async () =>
    (await call(treasurer.cookie, "GET", `/api/finance/households/${householdId}/payments`)).json().payments as Array<{
      id: string;
      reversed: boolean;
      reversal: { occurredOn: string; reason: string; recordedBy: string } | null;
    }>;

  before(async () => {
    t = await buildTestApp();
    treasurer = await signedInUser(t, "tesorero", "Tina Tesorera");
    president = await signedInUser(t, "presidente", "Pablo Presidente");
    const admin = await signedInUser(t, "administrador");
    await t.db.insert(feeRates).values({ kind: "base_monthly", amountCentavos: 7000, startsOn: addMonths(thisMonth, -24) });
    const sector = await call(admin.cookie, "POST", "/api/settings/sectors", { name: "El Centro" });
    const created = await call(admin.cookie, "POST", "/api/census/households", {
      submissionId: randomUUID(),
      person: { fullName: "María López", idNumber: "0801199912345", phone: "99887766" },
      household: { sectorId: sector.json().sector.id, references: "Frente a la iglesia", waterConnection: "connected", relation: "owner" },
      fee: { kind: "base" },
    });
    assert.equal(created.statusCode, 201, created.body);
    ({ id: householdId, code: householdCode } = created.json().household);
  });
  after(async () => {
    await t.close();
  });

  it("asks for the permission, the PIN and a reason, and saves nothing without them", async () => {
    const payment = await pay();

    takeAway(t, "presidente", "finance:reverse");
    await confirmPin(president.cookie);
    assert.equal((await reverse(president.cookie, payment.id)).statusCode, 403);

    const withoutPin = await reverse(treasurer.cookie, payment.id);
    assert.equal(withoutPin.statusCode, 403);
    assert.equal(withoutPin.json().error, "pin_required");

    await confirmPin(treasurer.cookie);
    const noReason = await reverse(treasurer.cookie, payment.id, "  ");
    assert.equal(noReason.statusCode, 400);
    assert.match(noReason.json().message, /Escriba por qué se anula/);

    assert.equal((await t.db.select().from(transactions).where(eq(transactions.reversesId, payment.id))).length, 0);
    // Reversed here, so the next test starts from months with nothing paid.
    assert.equal((await reverse(treasurer.cookie, payment.id)).statusCode, 200);
  });

  it("reverses the whole payment today, keeps the original, gives the months back, and logs it", async () => {
    const before = await monthsOf();
    assert.equal(before.get(lastMonth)!.paidCentavos, 0);

    const payment = await pay({ months: [lastMonth, thisMonth], amountCentavos: 10000, payerName: "Juan Pérez" });
    assert.equal((await monthsOf()).get(thisMonth)!.paidCentavos, 3000);

    await confirmPin(treasurer.cookie);
    const response = await reverse(treasurer.cookie, payment.id, "El recibo era de otra vivienda");
    assert.equal(response.statusCode, 200, response.body);
    const shown = response.json().payment;
    assert.equal(shown.reversed, true);
    assert.equal(shown.reversal.reason, "El recibo era de otra vivienda");
    assert.equal(shown.reversal.recordedBy, "Tina Tesorera");
    assert.equal(shown.reversal.occurredOn, today);

    // The original is untouched; the reversal carries the opposite amount and points to it.
    const [original] = await t.db.select().from(transactions).where(eq(transactions.id, payment.id));
    assert.equal(original!.amountCentavos, 10000);
    const [reversal] = await t.db.select().from(transactions).where(eq(transactions.reversesId, payment.id));
    assert.equal(reversal!.amountCentavos, -10000);
    assert.equal(reversal!.occurredOn, today);
    assert.equal(reversal!.householdId, householdId);
    assert.equal(reversal!.paperReceiptNumber, payment.paperReceiptNumber);
    const [month] = await t.db.select().from(months).where(eq(months.id, reversal!.monthId));
    assert.equal(month!.month, thisMonth);

    const after = await monthsOf();
    assert.equal(after.get(lastMonth)!.paidCentavos, 0);
    assert.equal(after.get(thisMonth)!.paidCentavos, 0);

    const [entry] = await t.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, "payment.reversed"), eq(auditLog.entityId, payment.id)));
    assert.ok(entry);
    assert.equal(entry.area, "finances");
    assert.equal(entry.reason, "El recibo era de otra vivienda");
    assert.match(
      entry.summary,
      new RegExp(`^Tina Tesorera \\(Tesorero/a\\) anuló el pago de L 100\\.00 de Juan Pérez por .+, vivienda ${householdCode}, recibo nº ${payment.paperReceiptNumber}$`),
    );
    assert.equal((await verifyChain(t.db)).ok, true);

    // Both stay visible in the house's payments.
    const listed = (await paymentsOf()).find((p) => p.id === payment.id);
    assert.equal(listed?.reversed, true);
    assert.equal(listed?.reversal?.reason, "El recibo era de otra vivienda");
  });

  it("is final: a payment is reversed once, and a reversal is never reversed", async () => {
    const payment = await pay();
    await confirmPin(treasurer.cookie);
    assert.equal((await reverse(treasurer.cookie, payment.id)).statusCode, 200);

    const again = await reverse(president.cookie, payment.id);
    // The president lost finance:reverse above; the treasurer tries instead.
    assert.equal(again.statusCode, 403);
    const twice = await reverse(treasurer.cookie, payment.id);
    assert.equal(twice.statusCode, 409);
    assert.equal(twice.json().error, "already_reversed");

    const [reversal] = await t.db.select().from(transactions).where(eq(transactions.reversesId, payment.id));
    assert.equal((await reverse(treasurer.cookie, reversal!.id)).statusCode, 404);
    assert.equal((await reverse(treasurer.cookie, randomUUID())).statusCode, 404);
  });

  it("lets the payment be recorded again: same receipt, no repeated flag, at today's price", async () => {
    const payment = await pay({ months: [thisMonth] });
    // The fee goes up for this month after the payment fixed its price at L 70.
    await t.db.insert(feeRates).values({ kind: "base_monthly", amountCentavos: 8000, startsOn: thisMonth });
    assert.equal((await monthsOf()).get(thisMonth)!.priceCentavos, 7000);

    await confirmPin(treasurer.cookie);
    assert.equal((await reverse(treasurer.cookie, payment.id, "Monto equivocado")).statusCode, 200);

    // With its only money reversed, the month costs what a month with no payment costs.
    assert.equal((await monthsOf()).get(thisMonth)!.priceCentavos, 8000);
    const again = await call(treasurer.cookie, "POST", "/api/finance/payments", {
      submissionId: randomUUID(),
      householdId,
      months: [thisMonth],
      amountCentavos: 8000,
      occurredOn: today,
      paymentMethod: "cash",
      paperReceiptNumber: payment.paperReceiptNumber,
    });
    assert.equal(again.statusCode, 201, again.body);
    assert.equal(again.json().payment.repeatedReceipt, false);
  });

  it("can be made after the original's month is closed: the reversal lands in this month", async () => {
    const closed = addMonths(thisMonth, -3);
    const payment = await pay({ months: [closed], occurredOn: `${closed.slice(0, 8)}10` });
    await t.db.update(months).set({ status: "closed" }).where(eq(months.month, closed));

    await confirmPin(treasurer.cookie);
    assert.equal((await reverse(treasurer.cookie, payment.id)).statusCode, 200);
    const [reversal] = await t.db.select().from(transactions).where(eq(transactions.reversesId, payment.id));
    const [month] = await t.db.select().from(months).where(eq(months.id, reversal!.monthId));
    assert.equal(month!.month, thisMonth);
  });
});
