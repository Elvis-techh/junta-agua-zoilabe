import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import { eq } from "drizzle-orm";

import { auditLog, feeRates, householdFees, months, paymentMonths, transactions } from "../src/db/schema.js";
import { firstOfMonth } from "../src/lib/fees.js";
import { addMonths, allocatePayment, monthList, monthsBetween } from "../src/lib/payments.js";
import { HONDURAS_TIME_ZONE, businessToday } from "../src/lib/time.js";
import type { TestApp } from "./helpers.js";
import { buildTestApp, rejectsWithDbError, signedInUser, withdraw } from "./helpers.js";

describe("months", () => {
  it("move across the end of a year in both directions", () => {
    assert.equal(addMonths("2026-11-01", 3), "2027-02-01");
    assert.equal(addMonths("2026-01-01", -1), "2025-12-01");
    assert.equal(addMonths("2026-05-01", -17), "2024-12-01");
    assert.deepEqual(monthsBetween("2026-11-01", "2027-01-01"), ["2026-11-01", "2026-12-01", "2027-01-01"]);
  });

  it("are named the way a person would say them", () => {
    assert.equal(monthList(["2026-10-01"]), "octubre de 2026");
    assert.equal(monthList(["2026-10-01", "2026-11-01"]), "octubre y noviembre de 2026");
    assert.equal(monthList(["2026-11-01", "2026-12-01", "2027-01-01"]), "noviembre, diciembre de 2026 y enero de 2027");
  });
});

describe("sharing a payment among months (owner, 6 November 2026)", () => {
  const unpaid = (month: string, price: number | null = 7000, paid = 0) => ({ month, priceCentavos: price, paidCentavos: paid });

  it("fills the oldest month first and leaves only the last one partly paid", () => {
    const result = allocatePayment([unpaid("2026-11-01"), unpaid("2026-10-01")], 10000);
    assert.deepEqual(result, {
      shares: [
        { month: "2026-10-01", amountCentavos: 7000, priceCentavos: 7000, paidInFull: true },
        { month: "2026-11-01", amountCentavos: 3000, priceCentavos: 7000, paidInFull: false },
      ],
    });
  });

  it("counts what a month already has, at the price it was fixed at", () => {
    const result = allocatePayment([unpaid("2026-10-01", 7000, 3000), unpaid("2026-11-01", 8000)], 12000);
    assert.deepEqual(result, {
      shares: [
        { month: "2026-10-01", amountCentavos: 4000, priceCentavos: 7000, paidInFull: true },
        { month: "2026-11-01", amountCentavos: 8000, priceCentavos: 8000, paidInFull: true },
      ],
    });
  });

  it("refuses more than the months owe, so no money sits unassigned", () => {
    const result = allocatePayment([unpaid("2026-10-01")], 10000);
    assert.equal("code" in result && result.code, "more_than_owed");
    assert.match("problem" in result ? result.problem : "", /Ese mes debe L 70\.00, y el pago es de L 100\.00/);
  });

  it("refuses a month the money does not reach", () => {
    const result = allocatePayment([unpaid("2026-10-01"), unpaid("2026-11-01"), unpaid("2026-12-01")], 7000);
    assert.equal("code" in result && result.code, "does_not_reach");
    assert.match("problem" in result ? result.problem : "", /solo hasta octubre de 2026\. Quite noviembre y diciembre de 2026/);
  });

  it("refuses a month already paid, one not charged, and one with no fee", () => {
    const paid = allocatePayment([unpaid("2026-10-01", 7000, 7000)], 100);
    assert.equal("code" in paid && paid.code, "already_paid");
    const free = allocatePayment([unpaid("2026-10-01", 0)], 100);
    assert.match("problem" in free ? free.problem : "", /no se cobra/);
    const none = allocatePayment([unpaid("2026-10-01", null)], 100);
    assert.equal("code" in none && none.code, "no_fee");
  });
});

describe("Cobrar: recording monthly fee payments", () => {
  let t: TestApp;
  let treasurer: { id: string; cookie: string };
  let vocal: { cookie: string };
  let secretary: { cookie: string };
  let householdId: string;
  let householdCode: string;
  let idCounter = 801199100000;

  const today = businessToday(HONDURAS_TIME_ZONE);
  const thisMonth = firstOfMonth(today);
  const lastMonth = addMonths(thisMonth, -1);
  const ahead = (by: number) => addMonths(thisMonth, by);

  const call = (cookie: string, method: "GET" | "POST", url: string, payload?: object) =>
    t.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

  let receiptCounter = 1000;
  const payment = (overrides: Record<string, unknown> = {}) => ({
    submissionId: randomUUID(),
    householdId,
    months: [lastMonth],
    amountCentavos: 7000,
    occurredOn: today,
    paymentMethod: "cash",
    paperReceiptNumber: String((receiptCounter += 1)),
    ...overrides,
  });
  const pay = (overrides: Record<string, unknown> = {}) => call(treasurer.cookie, "POST", "/api/finance/payments", payment(overrides));
  const monthsOf = async (id = householdId, from = addMonths(thisMonth, -3)) => {
    const response = await call(treasurer.cookie, "GET", `/api/finance/households/${id}/months?from=${from}`);
    assert.equal(response.statusCode, 200, response.body);
    const body = response.json() as { months: Array<{ month: string; priceCentavos: number | null; paidCentavos: number }> };
    return new Map(body.months.map((state) => [state.month, state]));
  };

  const register = async () => {
    const admin = await signedInUser(t, "administrador");
    const sector = await call(admin.cookie, "POST", "/api/settings/sectors", { name: `Sector ${randomUUID().slice(0, 6)}` });
    const created = await call(secretary.cookie, "POST", "/api/census/households", {
      submissionId: randomUUID(),
      person: { fullName: "juan pérez", idNumber: String((idCounter += 1)).padStart(13, "0"), phone: "99887766" },
      household: { sectorId: sector.json().sector.id, references: "Frente a la iglesia", waterConnection: "connected", relation: "owner" },
      fee: { kind: "base" },
    });
    assert.equal(created.statusCode, 201, created.body);
    return created.json().household as { id: string; code: string };
  };

  before(async () => {
    t = await buildTestApp();
    treasurer = await signedInUser(t, "tesorero", "Tina Tesorera");
    vocal = await signedInUser(t, "primer_vocal");
    secretary = await signedInUser(t, "secretario");
    // L 70 from two years back, so every month in these tests has a price.
    await t.db.insert(feeRates).values({ kind: "base_monthly", amountCentavos: 7000, startsOn: addMonths(thisMonth, -24) });
    ({ id: householdId, code: householdCode } = await register());
  });
  after(async () => {
    await t.close();
  });

  it("lets only those who may see finances read a house's months, and only those who may record, record", async () => {
    // Every role may do both (owner, 6 November 2026); two are narrowed here, as the Permisos tab can.
    await withdraw(t, "primer_vocal", ["finance:record"]);
    await withdraw(t, "secretario", ["finance:view"]);
    const asVocal = await call(vocal.cookie, "GET", `/api/finance/households/${householdId}/months`);
    assert.equal(asVocal.statusCode, 200);
    const asSecretary = await call(secretary.cookie, "GET", `/api/finance/households/${householdId}/months`);
    assert.equal(asSecretary.statusCode, 403);

    const byVocal = await call(vocal.cookie, "POST", "/api/finance/payments", payment());
    assert.equal(byVocal.statusCode, 403);
    assert.equal((await t.db.select().from(transactions)).length, 0);
  });

  it("shares a payment oldest month first, keeps it, and logs it in Finanzas", async () => {
    const before = await monthsOf();
    assert.equal(before.get(lastMonth)!.priceCentavos, 7000);
    assert.equal(before.get(lastMonth)!.paidCentavos, 0);

    const response = await pay({ months: [thisMonth, lastMonth], amountCentavos: 10000, paperReceiptNumber: "501" });
    assert.equal(response.statusCode, 201, response.body);
    const saved = response.json().payment;
    assert.equal(saved.amountCentavos, 10000);
    assert.equal(saved.payerName, "Juan Pérez");
    assert.deepEqual(saved.shares, [
      { month: lastMonth, amountCentavos: 7000, priceCentavos: 7000 },
      { month: thisMonth, amountCentavos: 3000, priceCentavos: 7000 },
    ]);

    const [entry] = await t.db.select().from(transactions).where(eq(transactions.id, saved.id));
    assert.deepEqual(entry!.monthsCovered, [lastMonth, thisMonth]);
    assert.equal(entry!.kind, "income");
    const [month] = await t.db.select().from(months).where(eq(months.id, entry!.monthId));
    assert.equal(month!.month, thisMonth);

    const after = await monthsOf();
    assert.equal(after.get(lastMonth)!.paidCentavos, 7000);
    assert.equal(after.get(thisMonth)!.paidCentavos, 3000);

    const [logged] = await t.db.select().from(auditLog).where(eq(auditLog.entityId, saved.id));
    assert.equal(logged!.area, "finances");
    assert.equal(logged!.action, "payment.recorded");
    assert.match(logged!.summary, /^Tina Tesorera \(Tesorero\/a\) registró un pago de L 100\.00 de Juan Pérez por /);
    assert.match(logged!.summary, new RegExp(`queda pendiente en parte\\), vivienda ${householdCode}, recibo nº 501$`));
  });

  it("keeps a month at the price its first money arrived at, after the fee goes up", async () => {
    const first = await pay({ months: [ahead(3)], amountCentavos: 3500 });
    assert.equal(first.statusCode, 201, first.body);
    // The board raises the fee from that month on, after the house paid half of it.
    await t.db.insert(feeRates).values({ kind: "base_monthly", amountCentavos: 8000, startsOn: ahead(3) });

    const states = await monthsOf(householdId, ahead(3));
    assert.equal(states.get(ahead(3))!.priceCentavos, 7000);
    assert.equal(states.get(ahead(4))!.priceCentavos, 8000);

    const tooMuch = await pay({ months: [ahead(3)], amountCentavos: 4500 });
    assert.equal(tooMuch.statusCode, 409);
    assert.equal(tooMuch.json().error, "more_than_owed");
    const rest = await pay({ months: [ahead(3), ahead(4)], amountCentavos: 3500 + 8000 });
    assert.equal(rest.statusCode, 201, rest.body);
    assert.deepEqual(
      rest.json().payment.shares.map((share: { priceCentavos: number }) => share.priceCentavos),
      [7000, 8000],
    );
  });

  it("refuses a payment that does not fit the months chosen, and saves nothing", async () => {
    const count = (await t.db.select().from(transactions)).length;
    const paid = await pay({ months: [lastMonth] });
    assert.equal(paid.json().error, "already_paid");
    const short = await pay({ months: [ahead(1), ahead(2)], amountCentavos: 5000 });
    assert.equal(short.json().error, "does_not_reach");
    const noMonths = await pay({ months: [] });
    assert.equal(noMonths.statusCode, 400);
    assert.equal((await t.db.select().from(transactions)).length, count);
  });

  it("asks for a transfer's reference, and refuses a date after today or a month too far ahead", async () => {
    const transfer = await pay({ months: [ahead(1)], paymentMethod: "transfer" });
    assert.equal(transfer.statusCode, 400);
    assert.match(transfer.json().message, /referencia/);
    const withReference = await pay({ months: [ahead(1)], paymentMethod: "transfer", bankReference: "BAC-778812" });
    assert.equal(withReference.statusCode, 201, withReference.body);
    assert.equal(withReference.json().payment.bankReference, "BAC-778812");

    const tomorrow = new Date(`${today}T12:00:00Z`);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const future = await pay({ months: [ahead(2)], occurredOn: tomorrow.toISOString().slice(0, 10) });
    assert.equal(future.statusCode, 400);
    const tooFar = await pay({ months: [ahead(13)] });
    assert.equal(tooFar.statusCode, 400);
  });

  it("gives a retry on weak signal the payment it already saved, not a second one", async () => {
    const body = payment({ months: [ahead(5)] });
    const first = await call(treasurer.cookie, "POST", "/api/finance/payments", body);
    assert.equal(first.statusCode, 201, first.body);
    const again = await call(treasurer.cookie, "POST", "/api/finance/payments", body);
    assert.equal(again.statusCode, 200, again.body);
    assert.equal(again.json().payment.id, first.json().payment.id);
    const saved = await t.db.select().from(transactions).where(eq(transactions.submissionId, body.submissionId));
    assert.equal(saved.length, 1);
  });

  it("flags a repeated receipt number, and saves it when the treasurer says so", async () => {
    const other = await register();
    const repeated = await pay({ householdId: other.id, months: [lastMonth], paperReceiptNumber: "501" });
    assert.equal(repeated.statusCode, 409);
    assert.equal(repeated.json().error, "receipt_repeated");
    assert.match(repeated.json().message, new RegExp(`El recibo nº 501 ya se registró el .+ para la vivienda ${householdCode} \\(L 100\\.00\\)\\.`));

    const saved = await pay({ householdId: other.id, months: [lastMonth], paperReceiptNumber: "501", confirmRepeatedReceipt: true });
    assert.equal(saved.statusCode, 201, saved.body);
    assert.equal(saved.json().payment.repeatedReceipt, true);
    const [logged] = await t.db.select().from(auditLog).where(eq(auditLog.entityId, saved.json().payment.id));
    assert.match(logged!.summary, /\(número de recibo repetido\)$/);

    const list = await call(treasurer.cookie, "GET", `/api/finance/households/${householdId}/payments`);
    const first = list.json().payments.find((p: { paperReceiptNumber: string }) => p.paperReceiptNumber === "501");
    assert.equal(first.repeatedReceipt, true);
  });

  it("charges a house's different amount for the months it covers", async () => {
    const house = await register();
    await t.db.insert(householdFees).values({
      id: randomUUID(),
      householdId: house.id,
      monthlyAmountCentavos: 3500,
      reason: "Adulto mayor",
      startsOn: thisMonth,
    });
    const states = await monthsOf(house.id, lastMonth);
    assert.equal(states.get(lastMonth)!.priceCentavos, 7000);
    assert.equal(states.get(thisMonth)!.priceCentavos, 3500);
    const paid = await pay({ householdId: house.id, months: [thisMonth], amountCentavos: 3500 });
    assert.equal(paid.statusCode, 201, paid.body);
  });

  it("refuses a payment dated in a month that is already closed", async () => {
    const closed = addMonths(thisMonth, -2);
    await t.db.insert(months).values({ month: closed, status: "closed" });
    const response = await pay({ months: [closed], occurredOn: `${closed.slice(0, 8)}15` });
    assert.equal(response.statusCode, 409);
    assert.equal(response.json().error, "month_closed");
  });

  it("is kept by the database: a share of a payment cannot be changed or deleted", async () => {
    await rejectsWithDbError(t.db.update(paymentMonths).set({ amountCentavos: 1 }), /history is never changed: payment_months/);
    await rejectsWithDbError(t.db.delete(paymentMonths), /nothing is deleted: payment_months/);
  });
});
