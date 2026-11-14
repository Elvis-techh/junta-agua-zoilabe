import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import { eq } from "drizzle-orm";

import { auditLog, categories, feeRates, transactions } from "../src/db/schema.js";
import { firstOfMonth, lastPaidMonth, paidMonthsAt } from "../src/lib/fees.js";
import { addMonths } from "../src/lib/payments.js";
import { HONDURAS_TIME_ZONE, businessToday } from "../src/lib/time.js";
import type { TestApp } from "./helpers.js";
import { buildTestApp, rejectsWithDbError, signedInUser, takeAway } from "./helpers.js";

describe("Otro ingreso: late fees, reconnections, connections, donations and other income", () => {
  let t: TestApp;
  let treasurer: { id: string; cookie: string };
  let president: { cookie: string };
  let vocal: { cookie: string };
  let secretary: { cookie: string };
  let householdId: string;
  let householdCode: string;
  let idCounter = 801199200000;

  const today = businessToday(HONDURAS_TIME_ZONE);
  const thisMonth = firstOfMonth(today);
  const monthsAgo = (by: number) => addMonths(thisMonth, -by);

  const call = (cookie: string, method: "GET" | "POST", url: string, payload?: object) =>
    t.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

  let receiptCounter = 5000;
  const nextReceipt = () => String((receiptCounter += 1));
  const income = (overrides: Record<string, unknown> = {}) => ({
    submissionId: randomUUID(),
    type: "late_fee",
    householdId,
    month: monthsAgo(2),
    amountCentavos: 5000,
    occurredOn: today,
    paymentMethod: "cash",
    paperReceiptNumber: nextReceipt(),
    ...overrides,
  });
  const record = (overrides: Record<string, unknown> = {}) => call(treasurer.cookie, "POST", "/api/finance/income", income(overrides));
  const pay = (overrides: Record<string, unknown> = {}) =>
    call(treasurer.cookie, "POST", "/api/finance/payments", {
      submissionId: randomUUID(),
      householdId,
      months: [monthsAgo(2)],
      amountCentavos: 7000,
      occurredOn: today,
      paymentMethod: "cash",
      paperReceiptNumber: nextReceipt(),
      ...overrides,
    });
  const entriesOf = async (id = householdId) => {
    const response = await call(treasurer.cookie, "GET", `/api/finance/income?householdId=${id}`);
    assert.equal(response.statusCode, 200, response.body);
    return response.json().entries as Array<Record<string, unknown> & { id: string; reversed: boolean }>;
  };

  const register = async () => {
    const admin = await signedInUser(t, "administrador");
    const sector = await call(admin.cookie, "POST", "/api/settings/sectors", { name: `Sector ${randomUUID().slice(0, 6)}` });
    const created = await call(secretary.cookie, "POST", "/api/census/households", {
      submissionId: randomUUID(),
      person: { fullName: "maría lópez", idNumber: String((idCounter += 1)).padStart(13, "0"), phone: "99887766" },
      household: { sectorId: sector.json().sector.id, references: "Junto al puente", waterConnection: "connected", relation: "owner" },
      fee: { kind: "base" },
    });
    assert.equal(created.statusCode, 201, created.body);
    return created.json().household as { id: string; code: string };
  };

  before(async () => {
    t = await buildTestApp();
    treasurer = await signedInUser(t, "tesorero", "Tina Tesorera");
    president = await signedInUser(t, "presidente");
    vocal = await signedInUser(t, "primer_vocal");
    secretary = await signedInUser(t, "secretario");
    // Fees from two years back, so every month in these tests has one:
    // L 70 a month, L 50 late fee, L 200 reconnection, L 1,500 connection.
    await t.db.insert(feeRates).values([
      { kind: "base_monthly", amountCentavos: 7000, startsOn: monthsAgo(24) },
      { kind: "late_fee", amountCentavos: 5000, startsOn: monthsAgo(24) },
      { kind: "reconnection", amountCentavos: 20000, startsOn: monthsAgo(24) },
      { kind: "connection", amountCentavos: 150000, startsOn: monthsAgo(24) },
    ]);
    ({ id: householdId, code: householdCode } = await register());
  });
  after(async () => {
    await t.close();
  });

  it("lets only those who may record add income, and only those who may reverse undo it", async () => {
    takeAway(t, "primer_vocal", "finance:record", "finance:reverse");
    takeAway(t, "secretario", "finance:view");
    const byVocal = await call(vocal.cookie, "POST", "/api/finance/income", income());
    assert.equal(byVocal.statusCode, 403);
    const setup = await call(vocal.cookie, "GET", "/api/finance/income/setup");
    assert.equal(setup.statusCode, 403);
    const list = await call(secretary.cookie, "GET", "/api/finance/income");
    assert.equal(list.statusCode, 403);
    assert.equal((await t.db.select().from(transactions)).length, 0);
  });

  it("gives the screen the late fee, reconnection and connection amounts it fills in", async () => {
    const response = await call(treasurer.cookie, "GET", "/api/finance/income/setup");
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json(), {
      today,
      lateFee: [{ startsOn: monthsAgo(24), amountCentavos: 5000 }],
      reconnection: [{ startsOn: monthsAgo(24), amountCentavos: 20000 }],
      connection: [{ startsOn: monthsAgo(24), amountCentavos: 150000 }],
    });
  });

  it("charges a connection at the connection fee of the day it is paid, and asks why for another amount (owner, 14 November 2026)", async () => {
    const house = await register();
    const connection = (overrides: Record<string, unknown>) => record({ type: "connection", householdId: house.id, month: undefined, ...overrides });
    const other = await connection({ amountCentavos: 120000 });
    assert.equal(other.statusCode, 400);
    assert.equal(other.json().error, "amount_reason");
    assert.match(other.json().message, /^La conexión es de L 1,500\.00 en Configuración\. Si se cobró otro monto, escriba por qué\.$/);

    const withReason = await connection({ amountCentavos: 120000, amountReason: "Acuerdo de la junta" });
    assert.equal(withReason.statusCode, 201, withReason.body);
    assert.equal(withReason.json().entry.amountReason, "Acuerdo de la junta");
    const [entry] = await t.db.select().from(transactions).where(eq(transactions.id, withReason.json().entry.id));
    const [category] = await t.db.select().from(categories).where(eq(categories.id, entry!.categoryId));
    assert.equal(category!.name, "Conexión");
    assert.equal(entry!.monthsCovered, null);

    // Before any connection fee was set, there is no amount to charge.
    const tooOld = await connection({ amountCentavos: 150000, occurredOn: `${monthsAgo(30).slice(0, 8)}10` });
    assert.equal(tooOld.statusCode, 409);
    assert.equal(tooOld.json().error, "no_fee");
    assert.match(tooOld.json().message, /^No hay monto para la conexión en Configuración → Cuotas/);
  });

  it("records a late fee under Mora with the month it covers, and logs it in Finanzas", async () => {
    const response = await record({ month: monthsAgo(3), paperReceiptNumber: "701" });
    assert.equal(response.statusCode, 201, response.body);
    const saved = response.json().entry;
    assert.equal(saved.type, "late_fee");
    assert.equal(saved.month, monthsAgo(3));
    assert.equal(saved.payerName, "María López");
    assert.equal(saved.householdCode, householdCode);
    assert.equal(saved.amountReason, null);

    const [entry] = await t.db.select().from(transactions).where(eq(transactions.id, saved.id));
    const [category] = await t.db.select().from(categories).where(eq(categories.id, entry!.categoryId));
    assert.equal(category!.name, "Mora");
    assert.deepEqual(entry!.monthsCovered, [monthsAgo(3)]);
    assert.equal(entry!.kind, "income");

    const [logged] = await t.db.select().from(auditLog).where(eq(auditLog.entityId, saved.id));
    assert.equal(logged!.area, "finances");
    assert.equal(logged!.action, "income.recorded");
    assert.match(logged!.summary, /^Tina Tesorera \(Tesorero\/a\) registró la mora de .+: L 50\.00 de María López, vivienda .+, recibo nº 701$/);

    assert.deepEqual((await entriesOf()).map((listed) => listed.id), [saved.id]);
  });

  it("asks why when a late fee or reconnection is not the amount in Configuración, and keeps the reason", async () => {
    const without = await record({ month: monthsAgo(4), amountCentavos: 3000 });
    assert.equal(without.statusCode, 400);
    assert.equal(without.json().error, "amount_reason");
    assert.match(without.json().message, /^La mora de .+ es de L 50\.00 en Configuración\. Si se cobró otro monto, escriba por qué\.$/);

    const withReason = await record({ month: monthsAgo(4), amountCentavos: 3000, amountReason: "El cuaderno dice L 30" });
    assert.equal(withReason.statusCode, 201, withReason.body);
    assert.equal(withReason.json().entry.amountReason, "El cuaderno dice L 30");
    const [logged] = await t.db.select().from(auditLog).where(eq(auditLog.entityId, withReason.json().entry.id));
    assert.equal(logged!.reason, "El cuaderno dice L 30");
    assert.match(logged!.summary, /\(otro monto que el de Configuración\)$/);
  });

  it("records a house's late fee for a month once", async () => {
    const first = await record({ month: monthsAgo(5) });
    assert.equal(first.statusCode, 201, first.body);
    const second = await record({ month: monthsAgo(5) });
    assert.equal(second.statusCode, 409);
    assert.equal(second.json().error, "late_fee_repeated");
    assert.match(second.json().message, new RegExp(`^La mora de .+ de la vivienda ${householdCode} ya se registró el `));
  });

  it("refuses a late fee with no house, no month, or a month after its payment", async () => {
    const count = (await t.db.select().from(transactions)).length;
    const noHouse = await record({ householdId: undefined, payerName: "Alguien" });
    assert.equal(noHouse.statusCode, 400);
    assert.match(noHouse.json().message, /Elija la vivienda/);
    const noMonth = await record({ month: undefined });
    assert.equal(noMonth.statusCode, 400);
    assert.match(noMonth.json().message, /Elija el mes de la mora/);
    const ahead = await record({ month: addMonths(thisMonth, 1) });
    assert.equal(ahead.statusCode, 400);
    const before = await record({ month: thisMonth, occurredOn: `${monthsAgo(1).slice(0, 8)}15` });
    assert.equal(before.statusCode, 400);
    assert.equal((await t.db.select().from(transactions)).length, count);
  });

  it("refuses a late fee for a month Configuración has no late fee for, or does not charge", async () => {
    const tooOld = await record({ month: monthsAgo(30) });
    assert.equal(tooOld.statusCode, 409);
    assert.equal(tooOld.json().error, "no_fee");
    assert.match(tooOld.json().message, /Configuración → Cuotas/);

    await t.db.insert(feeRates).values({ kind: "late_fee", amountCentavos: 0, startsOn: monthsAgo(28) });
    await t.db.insert(feeRates).values({ kind: "late_fee", amountCentavos: 5000, startsOn: monthsAgo(27) });
    const free = await record({ month: monthsAgo(28) });
    assert.equal(free.statusCode, 409);
    assert.equal(free.json().error, "not_charged");
  });

  it("charges a reconnection at the reconnection fee of the day it is paid", async () => {
    await t.db.insert(feeRates).values({ kind: "reconnection", amountCentavos: 25000, startsOn: monthsAgo(1) });
    const old = await record({ type: "reconnection", month: undefined, amountCentavos: 20000, occurredOn: `${monthsAgo(2).slice(0, 8)}10` });
    assert.equal(old.statusCode, 201, old.body);
    assert.equal(old.json().entry.month, null);
    const now = await record({ type: "reconnection", month: undefined, amountCentavos: 20000 });
    assert.equal(now.statusCode, 400);
    assert.match(now.json().message, /^La reconexión es de L 250\.00 en Configuración/);
    const right = await record({ type: "reconnection", month: undefined, amountCentavos: 25000 });
    assert.equal(right.statusCode, 201, right.body);
  });

  it("takes a connection fee, a donation or other income from someone outside the census, with their name", async () => {
    const noName = await record({ type: "donation", householdId: undefined, month: undefined, amountCentavos: 100000 });
    assert.equal(noName.statusCode, 400);
    assert.match(noName.json().message, /nombre de quien pagó/);
    const donation = await record({ type: "donation", householdId: undefined, month: undefined, amountCentavos: 100000, payerName: "Iglesia de la aldea" });
    assert.equal(donation.statusCode, 201, donation.body);
    assert.equal(donation.json().entry.householdId, null);
    assert.equal(donation.json().entry.payerName, "Iglesia de la aldea");
    // Any amount: a donation has no amount in Configuración.
    assert.equal(donation.json().entry.amountCentavos, 100000);

    const connection = await record({ type: "connection", month: undefined, amountCentavos: 150000 });
    assert.equal(connection.statusCode, 201, connection.body);
    assert.equal(connection.json().entry.month, null);

    const latest = await call(treasurer.cookie, "GET", "/api/finance/income");
    const ids = latest.json().entries.map((entry: { id: string }) => entry.id);
    assert.ok(ids.includes(donation.json().entry.id), "a donation with no house is listed among the latest");
  });

  it("asks what other income is for", async () => {
    const vague = await record({ type: "other", month: undefined, amountCentavos: 2000 });
    assert.equal(vague.statusCode, 400);
    assert.match(vague.json().message, /de qué es el ingreso/);
    const said = await record({ type: "other", month: undefined, amountCentavos: 2000, note: "Venta de tubo sobrante" });
    assert.equal(said.statusCode, 201, said.body);
  });

  it("does not flag the monthly fee and its late fee written on one receipt, but flags the same entry typed twice", async () => {
    const house = await register();
    const fee = await pay({ householdId: house.id, paperReceiptNumber: "880" });
    assert.equal(fee.statusCode, 201, fee.body);
    const lateFee = await record({ householdId: house.id, month: monthsAgo(2), paperReceiptNumber: "880" });
    assert.equal(lateFee.statusCode, 201, lateFee.body);
    assert.equal(lateFee.json().entry.repeatedReceipt, false);

    const payments = await call(treasurer.cookie, "GET", `/api/finance/households/${house.id}/payments`);
    assert.equal(payments.json().payments[0].repeatedReceipt, false);

    // Another late fee on the same receipt is a second line of the same kind: flagged.
    const again = await record({ householdId: house.id, month: monthsAgo(3), paperReceiptNumber: "880" });
    assert.equal(again.statusCode, 409);
    assert.equal(again.json().error, "receipt_repeated");
    // The same number on another house's entry is flagged too.
    const elsewhere = await record({ month: monthsAgo(6), paperReceiptNumber: "880" });
    assert.equal(elsewhere.json().error, "receipt_repeated");
    const saved = await record({ month: monthsAgo(6), paperReceiptNumber: "880", confirmRepeatedReceipt: true });
    assert.equal(saved.statusCode, 201, saved.body);
    assert.equal(saved.json().entry.repeatedReceipt, true);
  });

  it("gives a retry on weak signal the entry it already saved, not a second one", async () => {
    const body = income({ month: monthsAgo(7) });
    const first = await call(treasurer.cookie, "POST", "/api/finance/income", body);
    assert.equal(first.statusCode, 201, first.body);
    const again = await call(treasurer.cookie, "POST", "/api/finance/income", body);
    assert.equal(again.statusCode, 200, again.body);
    assert.equal(again.json().entry.id, first.json().entry.id);
  });

  it("is undone with a reason as a whole entry, once, and the month's late fee can then be recorded again", async () => {
    const saved = (await record({ month: monthsAgo(8) })).json().entry;
    const noReason = await call(president.cookie, "POST", `/api/finance/income/${saved.id}/reverse`, { reason: "" });
    assert.equal(noReason.statusCode, 400);

    const reversed = await call(president.cookie, "POST", `/api/finance/income/${saved.id}/reverse`, { reason: "Era de otra vivienda" });
    assert.equal(reversed.statusCode, 200, reversed.body);
    assert.equal(reversed.json().entry.reversed, true);
    assert.equal(reversed.json().entry.reversal.reason, "Era de otra vivienda");

    const [reversal] = await t.db.select().from(transactions).where(eq(transactions.reversesId, saved.id));
    assert.equal(reversal!.amountCentavos, -5000);
    assert.equal(reversal!.occurredOn, today);
    const [logged] = await t.db.select().from(auditLog).where(eq(auditLog.action, "income.reversed"));
    assert.match(logged!.summary, /anuló la mora de .+: L 50\.00 de María López del /);
    assert.equal(logged!.reason, "Era de otra vivienda");

    const twice = await call(president.cookie, "POST", `/api/finance/income/${saved.id}/reverse`, { reason: "Otra vez" });
    assert.equal(twice.statusCode, 409);
    assert.equal(twice.json().error, "already_reversed");
    // A reversal is final: it is not an entry that can itself be undone.
    const ofReversal = await call(president.cookie, "POST", `/api/finance/income/${reversal!.id}/reverse`, { reason: "Deshacer" });
    assert.equal(ofReversal.statusCode, 404);

    const recordedAgain = await record({ month: monthsAgo(8) });
    assert.equal(recordedAgain.statusCode, 201, recordedAgain.body);
    const listed = (await entriesOf()).filter((entry) => entry.month === monthsAgo(8));
    assert.deepEqual(listed.map((entry) => entry.reversed).sort(), [false, true]);
  });

  it("does not undo a monthly fee payment: that is Anular pago's", async () => {
    const fee = await pay({ months: [monthsAgo(9)] });
    const refused = await call(president.cookie, "POST", `/api/finance/income/${fee.json().payment.id}/reverse`, { reason: "No era" });
    assert.equal(refused.statusCode, 404);
  });

  it("does not move where a different amount starts: a late fee does not pay its month", async () => {
    const house = await register();
    await pay({ householdId: house.id, months: [monthsAgo(6)] });
    const lateFee = await record({ householdId: house.id, month: monthsAgo(2) });
    assert.equal(lateFee.statusCode, 201, lateFee.body);
    assert.equal(lastPaidMonth(t.db, house.id), monthsAgo(6));
  });

  it("is seen by Configuración: a late fee amount with a late fee paid in its months can no longer be removed", async () => {
    const rate = (await t.db.select().from(feeRates)).find((row) => row.kind === "late_fee" && row.startsOn === monthsAgo(24))!;
    assert.ok(paidMonthsAt(t.db, "late_fee", rate.startsOn), "the late fees recorded above fall in its months");
    const refused = await call(president.cookie, "POST", `/api/settings/fees/${rate.id}/remove`, { reason: "No era ese monto" });
    assert.equal(refused.statusCode, 409);
    assert.equal(refused.json().error, "already_paid");
  });

  it("puts the connection fee in Configuración → Cuotas, where a paid amount can no longer be removed", async () => {
    const list = await call(president.cookie, "GET", "/api/settings/fees");
    assert.equal(list.statusCode, 200, list.body);
    const fees = list.json().fees as Array<{ kind: string; rates: Array<{ id: number; startsOn: string; correctable: boolean }> }>;
    assert.deepEqual(fees.map((fee) => fee.kind), ["base_monthly", "late_fee", "reconnection", "connection"]);
    // The connections recorded above were paid at the amount from two years back.
    const paid = fees.find((fee) => fee.kind === "connection")!.rates.find((rate) => rate.startsOn === monthsAgo(24))!;
    assert.equal(paid.correctable, false);
    const refused = await call(president.cookie, "POST", `/api/settings/fees/${paid.id}/remove`, { reason: "No era ese monto" });
    assert.equal(refused.statusCode, 409);
    assert.equal(refused.json().error, "already_paid");

    const added = await call(president.cookie, "POST", "/api/settings/fees", {
      kind: "connection",
      amountCentavos: 180000,
      startsOn: addMonths(thisMonth, 1),
    });
    assert.equal(added.statusCode, 201, added.body);
    const [logged] = await t.db.select().from(auditLog).where(eq(auditLog.action, "fee_rate.created"));
    assert.match(logged?.summary ?? "", /la cuota de conexión/);
  });

  it("is kept by the database: an entry cannot be changed or deleted", async () => {
    await rejectsWithDbError(t.db.update(transactions).set({ amountCentavos: 1 }), /history is never changed: transactions/);
    await rejectsWithDbError(t.db.delete(transactions), /nothing is deleted: transactions/);
  });
});
