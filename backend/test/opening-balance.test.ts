import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import { eq } from "drizzle-orm";

import { auditLog, categories, months, openingBalances } from "../src/db/schema.js";
import { placeOf } from "../src/lib/balance.js";
import { firstOfMonth } from "../src/lib/fees.js";
import { addMonths } from "../src/lib/payments.js";
import { HONDURAS_TIME_ZONE, businessToday } from "../src/lib/time.js";
import type { TestApp } from "./helpers.js";
import { buildTestApp, rejectsWithDbError, signedInUser, takeAway } from "./helpers.js";

describe("Saldo de la junta: the opening balance and the money now", () => {
  let t: TestApp;
  let treasurer: { id: string; cookie: string };
  let president: { cookie: string };
  let vocal: { cookie: string };
  let secretary: { cookie: string };
  let chlorine: number;
  let receiptCounter = 9000;

  const today = businessToday(HONDURAS_TIME_ZONE);
  const thisMonth = firstOfMonth(today);
  const lastMonth = addMonths(thisMonth, -1);

  const call = (cookie: string, method: "GET" | "POST", url: string, payload?: object) =>
    t.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

  const read = async () => {
    const response = await call(treasurer.cookie, "GET", "/api/finance/opening-balance");
    assert.equal(response.statusCode, 200, response.body);
    return response.json() as {
      thisMonth: string;
      opening: { id: string; month: string; cashCentavos: number; bankCentavos: number } | null;
      entries: Array<{ id: string; replacesId: string | null; reason: string | null; createdBy: string }>;
      money: { cashCentavos: number; bankCentavos: number; otherCentavos: number; since: string } | null;
      closedMonth: string | null;
    };
  };
  const enter = (payload: object, cookie = treasurer.cookie) => call(cookie, "POST", "/api/finance/opening-balance", payload);
  const correct = (id: string, payload: object, cookie = president.cookie) =>
    call(cookie, "POST", `/api/finance/opening-balance/${id}/correct`, payload);

  /** A donation from nobody in the census: money in, with no house needed. */
  const donation = async (amountCentavos: number, paymentMethod: string, occurredOn = today) => {
    const response = await call(treasurer.cookie, "POST", "/api/finance/income", {
      submissionId: randomUUID(),
      type: "donation",
      payerName: "Iglesia del pueblo",
      amountCentavos,
      occurredOn,
      paymentMethod,
      ...(paymentMethod === "transfer" ? { bankReference: "BAC-1234" } : {}),
      paperReceiptNumber: String((receiptCounter += 1)),
    });
    assert.equal(response.statusCode, 201, response.body);
    return response.json().entry as { id: string };
  };
  const expense = async (amountCentavos: number, paymentMethod: string) => {
    const response = await call(treasurer.cookie, "POST", "/api/finance/expenses", {
      submissionId: randomUUID(),
      categoryId: chlorine,
      supplier: "Ferretería El Puente",
      amountCentavos,
      occurredOn: today,
      paymentMethod,
      ...(paymentMethod === "transfer" ? { bankReference: "BAC-5678" } : {}),
      noPhotoReason: "Pagado a mano, sin factura",
    });
    assert.equal(response.statusCode, 201, response.body);
  };
  const undo = async (id: string) => {
    const response = await call(treasurer.cookie, "POST", `/api/finance/income/${id}/reverse`, { reason: "Se anotó por error" });
    assert.equal(response.statusCode, 200, response.body);
  };

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
    takeAway(t, "primer_vocal", "finance:record", "finance:reverse");
    takeAway(t, "secretario", "finance:view");
    const figures = { month: thisMonth, cashCentavos: 100, bankCentavos: 0 };
    assert.equal((await enter(figures, vocal.cookie)).statusCode, 403);
    assert.equal((await correct(randomUUID(), { ...figures, reason: "Estaba mal" }, vocal.cookie)).statusCode, 403);
    assert.equal((await call(secretary.cookie, "GET", "/api/finance/opening-balance")).statusCode, 403);
    assert.equal((await t.db.select().from(openingBalances)).length, 0);
  });

  it("has nothing to count from before the opening balance is entered", async () => {
    const data = await read();
    assert.equal(data.opening, null);
    assert.equal(data.money, null);
    assert.equal(data.thisMonth, thisMonth);
  });

  it("refuses a month that has not come yet, or a negative amount", async () => {
    const future = await enter({ month: addMonths(thisMonth, 1), cashCentavos: 100, bankCentavos: 0 });
    assert.equal(future.statusCode, 400);
    assert.match(future.json().message, /todavía no llega/);
    assert.equal((await enter({ month: thisMonth, cashCentavos: -1, bankCentavos: 0 })).statusCode, 400);
    assert.equal((await enter({ month: `${today.slice(0, 7)}-15`, cashCentavos: 1, bankCentavos: 0 })).statusCode, 400);
  });

  it("enters it once, logs it, and refuses a second one", async () => {
    const response = await enter({ month: thisMonth, cashCentavos: 250000, bankCentavos: 1000000 });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().opening.cashCentavos, 250000);
    assert.deepEqual(
      { cash: response.json().money.cashCentavos, bank: response.json().money.bankCentavos, other: response.json().money.otherCentavos },
      { cash: 250000, bank: 1000000, other: 0 },
    );

    const [logged] = await t.db.select().from(auditLog).where(eq(auditLog.action, "opening_balance.entered"));
    assert.ok(logged);
    assert.match(logged.summary, /Tina Tesorera .* anotó el saldo inicial: efectivo L 2,500\.00 y banco L 10,000\.00/);

    const again = await enter({ month: thisMonth, cashCentavos: 1, bankCentavos: 1 });
    assert.equal(again.statusCode, 409);
    assert.match(again.json().message, /Corregir/);
  });

  it("counts entries from its month on in cash, bank or Otro; earlier ones and their reversals stay out", async () => {
    const old = await donation(5000, "cash", `${lastMonth.slice(0, 8)}15`);
    await donation(10000, "cash");
    const wrong = await donation(20000, "transfer");
    await donation(3000, "other");
    await expense(4500, "cash");
    await expense(1000, "transfer");
    // A reversal has no way of paying of its own: it counts where its entry did.
    await undo(wrong.id);
    // Undone today, but the entry is from before the opening balance: it never counted.
    await undo(old.id);

    const { money } = await read();
    assert.deepEqual(
      { cash: money!.cashCentavos, bank: money!.bankCentavos, other: money!.otherCentavos, since: money!.since },
      { cash: 250000 + 10000 - 4500, bank: 1000000 - 1000, other: 3000, since: thisMonth },
    );
  });

  it("corrects it with a reason, pointing to the entry it replaces, and counts again from the new month", async () => {
    const { opening } = await read();
    const figures = { month: lastMonth, cashCentavos: 240000, bankCentavos: 1000000 };

    assert.equal((await correct(randomUUID(), { ...figures, reason: "Contamos de nuevo" })).statusCode, 404);
    assert.equal((await correct(opening!.id, { ...figures, reason: "" })).statusCode, 400);
    const same = await correct(opening!.id, { month: opening!.month, cashCentavos: 250000, bankCentavos: 1000000, reason: "Contamos de nuevo" });
    assert.equal(same.statusCode, 400);
    assert.match(same.json().message, /los mismos/);

    const response = await correct(opening!.id, { ...figures, reason: "Contamos de nuevo la caja" });
    assert.equal(response.statusCode, 200, response.body);
    const data = await read();
    assert.equal(data.opening!.month, lastMonth);
    assert.equal(data.entries.length, 2);
    assert.equal(data.entries[0]!.replacesId, opening!.id);
    assert.equal(data.entries[0]!.reason, "Contamos de nuevo la caja");
    assert.equal(data.entries[0]!.createdBy, "Pedro Presidente");
    // Last month's donation counts now, and so does its reversal: together nothing.
    assert.equal(data.money!.cashCentavos, 240000 + 5000 - 5000 + 10000 - 4500);

    const [logged] = await t.db.select().from(auditLog).where(eq(auditLog.action, "opening_balance.corrected"));
    assert.ok(logged);
    assert.equal(logged.reason, "Contamos de nuevo la caja");
    assert.match(logged.summary, /corrigió el saldo inicial: efectivo L 2,400\.00 .* \(antes efectivo L 2,500\.00/);

    const stale = await correct(opening!.id, { ...figures, cashCentavos: 1, reason: "Otra vez" });
    assert.equal(stale.statusCode, 409);
    assert.match(stale.json().message, /ya se corrigió/);
  });

  it("is locked once a month is closed", async () => {
    await t.db.insert(months).values({ month: addMonths(thisMonth, -6), status: "closed" }).onConflictDoNothing();
    const { opening, closedMonth } = await read();
    assert.equal(closedMonth, addMonths(thisMonth, -6));
    const response = await correct(opening!.id, { month: thisMonth, cashCentavos: 1, bankCentavos: 1, reason: "Muy tarde" });
    assert.equal(response.statusCode, 409);
    assert.match(response.json().message, /ya está cerrado/);
  });

  it("is kept by the database itself: never changed, never deleted, one chain, a correction always says why", async () => {
    const [first] = await t.db.select().from(openingBalances).where(eq(openingBalances.cashCentavos, 250000));
    await rejectsWithDbError(t.db.update(openingBalances).set({ cashCentavos: 1 }), /history is never changed/);
    await rejectsWithDbError(t.db.delete(openingBalances), /nothing is deleted/);
    await rejectsWithDbError(
      t.db.insert(openingBalances).values({ id: randomUUID(), month: thisMonth, cashCentavos: 1, bankCentavos: 1, createdBy: treasurer.id }),
      /UNIQUE/,
    );
    await rejectsWithDbError(
      t.db.insert(openingBalances).values({ id: randomUUID(), month: thisMonth, cashCentavos: 1, bankCentavos: 1, replacesId: first!.id, reason: "Otra", createdBy: treasurer.id }),
      /UNIQUE/,
    );
    await rejectsWithDbError(
      t.db.insert(openingBalances).values({ id: randomUUID(), month: thisMonth, cashCentavos: 1, bankCentavos: 1, replacesId: randomUUID(), createdBy: treasurer.id }),
      /CHECK/,
    );
  });

  it("puts Efectivo in the box, Transferencia in the bank, and anything else on its own line", () => {
    assert.equal(placeOf("cash"), "cash");
    assert.equal(placeOf("transfer"), "bank");
    assert.equal(placeOf("other"), "other");
    assert.equal(placeOf(null), "other");
  });
});
