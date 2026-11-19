import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import { and, eq } from "drizzle-orm";

import { auditLog, categories, months } from "../src/db/schema.js";
import { firstOfMonth } from "../src/lib/fees.js";
import { addMonths } from "../src/lib/payments.js";
import { HONDURAS_TIME_ZONE, businessToday } from "../src/lib/time.js";
import type { TestApp } from "./helpers.js";
import { buildTestApp, rejectsWithDbError, signedInUser, takeAway } from "./helpers.js";

interface Money {
  cashCentavos: number;
  bankCentavos: number;
  otherCentavos: number;
}

interface Detail {
  row: {
    month: string;
    status: "open" | "prepared" | "closed";
    cashCountedCentavos: number | null;
    expectedCashCentavos: number | null;
    cashDifferenceReason: string | null;
    preparedBy: string | null;
    approvedBy: string | null;
    returnedBy: string | null;
    returnedReason: string | null;
  };
  figures: {
    month: string;
    opening: Money;
    income: Money;
    expense: Money;
    expected: Money;
    incomeLines: Array<{ category: string; amountCentavos: number }>;
    expenseLines: Array<{ category: string; amountCentavos: number }>;
  };
}

describe("Cierre del mes: preparing, approving and sending back a month's close", () => {
  let t: TestApp;
  let treasurer: { id: string; cookie: string };
  let president: { id: string; cookie: string };
  let vocal: { cookie: string };
  let secretary: { cookie: string };
  let chlorine: number;
  let receiptCounter = 7000;
  let firstDonation: string;

  const today = businessToday(HONDURAS_TIME_ZONE);
  const thisMonth = firstOfMonth(today);
  // The opening balance starts three months ago: three months can be closed.
  const m1 = addMonths(thisMonth, -3);
  const m2 = addMonths(thisMonth, -2);
  const m3 = addMonths(thisMonth, -1);
  const dayOf = (month: string, day: number) => `${month.slice(0, 8)}${String(day).padStart(2, "0")}`;

  const call = (cookie: string, method: "GET" | "POST", url: string, payload?: object) =>
    t.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
  const list = async () => {
    const response = await call(treasurer.cookie, "GET", "/api/finance/months");
    assert.equal(response.statusCode, 200, response.body);
    return response.json() as { thisMonth: string; openingMonth: string | null; months: Detail["row"][]; next: Detail | null };
  };
  const prepare = (month: string, payload: object, cookie = treasurer.cookie) =>
    call(cookie, "POST", `/api/finance/months/${month}/prepare`, payload);
  const approve = (month: string, cookie = president.cookie) => call(cookie, "POST", `/api/finance/months/${month}/approve`, {});
  const sendBack = (month: string, reason: string, cookie = president.cookie) =>
    call(cookie, "POST", `/api/finance/months/${month}/return`, { reason });

  const donation = (amountCentavos: number, paymentMethod: string, occurredOn: string) =>
    call(treasurer.cookie, "POST", "/api/finance/income", {
      submissionId: randomUUID(),
      type: "donation",
      payerName: "Iglesia del pueblo",
      amountCentavos,
      occurredOn,
      paymentMethod,
      ...(paymentMethod === "transfer" ? { bankReference: "BAC-1234" } : {}),
      paperReceiptNumber: String((receiptCounter += 1)),
    });
  const expense = (amountCentavos: number, occurredOn: string) =>
    call(treasurer.cookie, "POST", "/api/finance/expenses", {
      submissionId: randomUUID(),
      categoryId: chlorine,
      supplier: "Ferretería El Puente",
      amountCentavos,
      occurredOn,
      paymentMethod: "cash",
      noPhotoReason: "Pagado a mano, sin factura",
    });
  const logged = async (action: string, month: string) =>
    t.db.select().from(auditLog).where(and(eq(auditLog.action, action), eq(auditLog.entityId, month)));

  before(async () => {
    t = await buildTestApp();
    treasurer = await signedInUser(t, "tesorero", "Tina Tesorera");
    president = await signedInUser(t, "presidente", "Pedro Presidente");
    vocal = await signedInUser(t, "primer_vocal");
    secretary = await signedInUser(t, "secretario");
    const all = await t.db.select().from(categories).where(eq(categories.kind, "expense"));
    chlorine = all.find((category) => category.name === "Cloro")!.id;
  });
  after(async () => {
    await t.close();
  });

  it("checks each permission on the server", async () => {
    takeAway(t, "primer_vocal", "month:prepare", "month:approve");
    takeAway(t, "secretario", "finance:view");
    const counted = { cashCountedCentavos: 0, expectedCashCentavos: 0 };
    assert.equal((await prepare(m1, counted, vocal.cookie)).statusCode, 403);
    assert.equal((await approve(m1, vocal.cookie)).statusCode, 403);
    assert.equal((await sendBack(m1, "Está mal contado", vocal.cookie)).statusCode, 403);
    assert.equal((await call(secretary.cookie, "GET", "/api/finance/months")).statusCode, 403);
    assert.equal((await call(secretary.cookie, "GET", `/api/finance/months/${m1}`)).statusCode, 403);
  });

  it("has nothing to close before the opening balance", async () => {
    const data = await list();
    assert.equal(data.openingMonth, null);
    assert.deepEqual(data.months, []);
    assert.equal(data.next, null);
    const response = await prepare(m1, { cashCountedCentavos: 0, expectedCashCentavos: 0 });
    assert.equal(response.statusCode, 409);
    assert.match(response.json().message, /Saldo de la junta/);
  });

  it("lists every month from the opening balance's to last month, and shows the oldest one's figures", async () => {
    const entered = await call(treasurer.cookie, "POST", "/api/finance/opening-balance", { month: m1, cashCentavos: 100000, bankCentavos: 500000 });
    assert.equal(entered.statusCode, 200, entered.body);
    const first = await donation(20000, "cash", dayOf(m1, 10));
    assert.equal(first.statusCode, 201, first.body);
    firstDonation = first.json().entry.id;
    assert.equal((await expense(5000, dayOf(m1, 12))).statusCode, 201);
    assert.equal((await donation(30000, "transfer", dayOf(m2, 3))).statusCode, 201);

    const data = await list();
    assert.equal(data.openingMonth, m1);
    assert.deepEqual(
      data.months.map((row) => [row.month, row.status]),
      [
        [m3, "open"],
        [m2, "open"],
        [m1, "open"],
      ],
    );
    const figures = data.next!.figures;
    assert.equal(figures.month, m1);
    assert.deepEqual(figures.opening, { cashCentavos: 100000, bankCentavos: 500000, otherCentavos: 0 });
    assert.deepEqual(figures.income, { cashCentavos: 20000, bankCentavos: 0, otherCentavos: 0 });
    assert.deepEqual(figures.expense, { cashCentavos: 5000, bankCentavos: 0, otherCentavos: 0 });
    assert.deepEqual(figures.expected, { cashCentavos: 115000, bankCentavos: 500000, otherCentavos: 0 });
    assert.deepEqual(figures.incomeLines, [{ category: "Donación", amountCentavos: 20000 }]);
    assert.deepEqual(figures.expenseLines, [{ category: "Cloro", amountCentavos: 5000 }]);
  });

  it("prepares only a month that is over, in order, from the opening balance's month", async () => {
    const counted = { cashCountedCentavos: 0, expectedCashCentavos: 0 };
    const later = await prepare(m2, counted);
    assert.equal(later.statusCode, 409);
    assert.match(later.json().message, /^Primero se cierra el mes de .+: los meses se cierran en orden\.$/);
    const current = await prepare(thisMonth, counted);
    assert.equal(current.statusCode, 409);
    assert.match(current.json().message, /todavía no termina/);
    const earlier = await prepare(addMonths(m1, -1), counted);
    assert.equal(earlier.statusCode, 400);
    assert.equal((await prepare("2026-13-01", counted)).statusCode, 400);
  });

  it("refuses a count made against figures that changed since, and asks why when the cash does not match", async () => {
    const stale = await prepare(m1, { cashCountedCentavos: 115000, expectedCashCentavos: 100000 });
    assert.equal(stale.statusCode, 409);
    assert.match(stale.json().message, /cambiaron mientras tanto: ahora en caja debe haber L 1,150\.00/);

    const noReason = await prepare(m1, { cashCountedCentavos: 110000, expectedCashCentavos: 115000 });
    assert.equal(noReason.statusCode, 400);
    assert.match(noReason.json().message, /faltan L 50\.00\)\. Escriba por qué\.$/);

    const prepared = await prepare(m1, { cashCountedCentavos: 110000, expectedCashCentavos: 115000, reason: "Faltó un billete de 50" });
    assert.equal(prepared.statusCode, 200, prepared.body);
    const { row } = prepared.json() as Detail;
    assert.equal(row.status, "prepared");
    assert.equal(row.cashCountedCentavos, 110000);
    assert.equal(row.expectedCashCentavos, 115000);
    assert.equal(row.cashDifferenceReason, "Faltó un billete de 50");
    assert.equal(row.preparedBy, "Tina Tesorera");

    const [entry] = await logged("month.prepared", m1);
    assert.ok(entry);
    assert.equal(entry.area, "finances");
    assert.match(entry.summary, /^Tina Tesorera \(Tesorero\/a\) preparó el cierre de .+: efectivo contado L 1,100\.00, la aplicación esperaba L 1,150\.00 \(faltan L 50\.00\)$/);
    assert.equal(entry.reason, "Faltó un billete de 50");

    const again = await prepare(m1, { cashCountedCentavos: 110000, expectedCashCentavos: 115000, reason: "Otra vez" });
    assert.equal(again.statusCode, 409);
    assert.match(again.json().message, /ya está preparado/);
  });

  it("takes no entries dated in a prepared month, and locks the opening balance", async () => {
    const late = await donation(1000, "cash", dayOf(m1, 20));
    assert.equal(late.statusCode, 409);
    assert.match(late.json().message, /está esperando que aprueben su cierre\. Registre el pago con la fecha de hoy/);
    const lateExpense = await expense(1000, dayOf(m1, 20));
    assert.equal(lateExpense.statusCode, 409);
    assert.match(lateExpense.json().message, /está esperando que aprueben su cierre\. Registre el gasto/);

    const balance = (await call(treasurer.cookie, "GET", "/api/finance/opening-balance")).json();
    assert.deepEqual(balance.lockedMonth, { month: m1, status: "prepared" });
    const correction = await call(president.cookie, "POST", `/api/finance/opening-balance/${balance.opening.id}/correct`, {
      month: m1,
      cashCentavos: 1,
      bankCentavos: 1,
      reason: "Contamos de nuevo",
    });
    assert.equal(correction.statusCode, 409);
    assert.match(correction.json().message, /está preparado: para corregir el saldo inicial, primero lo tienen que devolver/);
  });

  it("is not approved by whoever prepared it, on the server and in the database", async () => {
    const own = await approve(m1, treasurer.cookie);
    assert.equal(own.statusCode, 409);
    assert.match(own.json().message, /lo debe aprobar otra persona/);
    await rejectsWithDbError(
      t.db.update(months).set({ approvedBy: treasurer.id }).where(eq(months.month, m1)),
      /months_preparer_not_approver/,
    );
  });

  it("is sent back with a reason, and opens again", async () => {
    assert.equal((await sendBack(m1, "")).statusCode, 400);
    const back = await sendBack(m1, "Revisen el gasto del cloro");
    assert.equal(back.statusCode, 200, back.body);
    const { row } = back.json() as Detail;
    assert.equal(row.status, "open");
    assert.equal(row.cashCountedCentavos, null);
    assert.equal(row.returnedBy, "Pedro Presidente");
    assert.equal(row.returnedReason, "Revisen el gasto del cloro");

    const [entry] = await logged("month.returned", m1);
    assert.ok(entry);
    assert.match(entry.summary, /^Pedro Presidente \(Presidente\) devolvió el cierre de .+, que preparó Tina Tesorera\. El mes queda abierto\.$/);
    assert.equal(entry.reason, "Revisen el gasto del cloro");
    assert.deepEqual(entry.before, {
      status: "prepared",
      cashCountedCentavos: 110000,
      expectedCashCentavos: 115000,
      cashDifferenceReason: "Faltó un billete de 50",
    });

    const nothing = await sendBack(m1, "Otra vez");
    assert.equal(nothing.statusCode, 409);
    assert.equal((await approve(m1)).statusCode, 409);
  });

  it("is approved by someone else, and the month closes", async () => {
    const prepared = await prepare(m1, { cashCountedCentavos: 110000, expectedCashCentavos: 115000, reason: "Faltó un billete de 50" });
    assert.equal(prepared.statusCode, 200, prepared.body);
    const approved = await approve(m1);
    assert.equal(approved.statusCode, 200, approved.body);
    const { row } = approved.json() as Detail;
    assert.equal(row.status, "closed");
    assert.equal(row.approvedBy, "Pedro Presidente");

    const [entry] = await logged("month.closed", m1);
    assert.ok(entry);
    assert.match(entry.summary, /^Pedro Presidente \(Presidente\) aprobó el cierre de .+, que preparó Tina Tesorera\. El mes queda cerrado\.$/);

    const late = await donation(1000, "cash", dayOf(m1, 25));
    assert.equal(late.statusCode, 409);
    assert.match(late.json().message, /ya está cerrado/);
    assert.equal((await sendBack(m1, "Muy tarde")).statusCode, 409);
  });

  it("starts the next month from the cash counted: the shortfall stays in the month it was found", async () => {
    const data = await list();
    assert.equal(data.next!.row.month, m2);
    const figures = data.next!.figures;
    assert.deepEqual(figures.opening, { cashCentavos: 110000, bankCentavos: 500000, otherCentavos: 0 });
    assert.deepEqual(figures.income, { cashCentavos: 0, bankCentavos: 30000, otherCentavos: 0 });
    assert.deepEqual(figures.expected, { cashCentavos: 110000, bankCentavos: 530000, otherCentavos: 0 });

    // The closed month's own figures keep what was expected; its row keeps what was counted.
    const closed = (await call(treasurer.cookie, "GET", `/api/finance/months/${m1}`)).json() as Detail;
    assert.equal(closed.figures.expected.cashCentavos, 115000);
    assert.equal(closed.row.cashCountedCentavos, 110000);

    // Saldo de la junta's money now counts from the cash counted too.
    const money = (await call(treasurer.cookie, "GET", "/api/finance/opening-balance")).json().money;
    assert.equal(money.cashCentavos, 110000);
    assert.equal(money.bankCentavos, 530000);
  });

  it("closes a month that matches without a reason, and a month with no entries", async () => {
    assert.equal((await prepare(m2, { cashCountedCentavos: 110000, expectedCashCentavos: 110000 })).statusCode, 200);
    assert.equal((await approve(m2)).statusCode, 200);
    const [entry] = await logged("month.prepared", m2);
    assert.match(entry!.summary, /efectivo contado L 1,100\.00, el que la aplicación esperaba$/);
    assert.equal(entry!.reason, null);

    const empty = (await list()).next!;
    assert.equal(empty.row.month, m3);
    assert.deepEqual(empty.figures.incomeLines, []);
    assert.equal((await prepare(m3, { cashCountedCentavos: 110000, expectedCashCentavos: 110000 })).statusCode, 200);
    assert.equal((await approve(m3)).statusCode, 200);
    assert.equal((await list()).next, null);
  });

  it("still lets an entry of a closed month be undone: the reversal is dated today, in the month still open", async () => {
    const undone = await call(treasurer.cookie, "POST", `/api/finance/income/${firstDonation}/reverse`, { reason: "Se anotó por error" });
    assert.equal(undone.statusCode, 200, undone.body);
    const money = (await call(treasurer.cookie, "GET", "/api/finance/opening-balance")).json().money;
    assert.equal(money.cashCentavos, 110000 - 20000);
    // The closed month's figures do not move.
    const closed = (await call(treasurer.cookie, "GET", `/api/finance/months/${m1}`)).json() as Detail;
    assert.equal(closed.figures.expected.cashCentavos, 115000);
  });
});
