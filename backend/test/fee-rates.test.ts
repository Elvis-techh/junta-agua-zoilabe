import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it, mock } from "node:test";

import { and, eq, isNotNull } from "drizzle-orm";

import { newId } from "../src/auth/session.js";
import { createDb } from "../src/db/client.js";
import { MIGRATIONS_FOLDER, runMigrations } from "../src/db/migrations.js";
import { auditLog, categories, feeRates, months, transactions } from "../src/db/schema.js";
import { firstOfMonth, monthAfter, paidMonthsAt } from "../src/lib/fees.js";
import { feeOn } from "../src/lib/settings.js";
import { HONDURAS_TIME_ZONE, businessToday } from "../src/lib/time.js";
import type { TestApp } from "./helpers.js";
import { buildTestApp, rejectsWithDbError, signedInUser, takeAway } from "./helpers.js";

describe("Configuración → Cuotas", () => {
  let t: TestApp;
  let president: { id: string; cookie: string };
  let treasurer: { cookie: string };
  let secretary: { cookie: string };
  const today = businessToday(HONDURAS_TIME_ZONE);
  const thisMonth = firstOfMonth(today);
  const nextMonth = monthAfter(today);
  const lastYear = `${Number(today.slice(0, 4)) - 1}-01-01`;

  before(async () => {
    t = await buildTestApp();
    president = await signedInUser(t, "presidente", "Ana Presidenta");
    treasurer = await signedInUser(t, "tesorero");
    secretary = await signedInUser(t, "secretario");
    // Every role holds every permission since 6 November 2026. These tests
    // prove the server refuses a role without settings:edit, so the
    // treasurer and the secretary lose it here, as the Permisos tab can.
    takeAway(t, "tesorero", "settings:edit");
    takeAway(t, "secretario", "settings:edit");
  });
  after(async () => {
    await t.close();
  });

  const call = (cookie: string, method: "GET" | "POST", payload?: object) =>
    t.app.inject({ method, url: "/api/settings/fees", headers: { cookie }, ...(payload ? { payload } : {}) });
  const correct = (cookie: string, id: number, payload: object) =>
    t.app.inject({ method: "PATCH", url: `/api/settings/fees/${id}`, headers: { cookie }, payload });
  const remove = (cookie: string, id: number, payload: object) =>
    t.app.inject({ method: "POST", url: `/api/settings/fees/${id}/remove`, headers: { cookie }, payload });
  const baseRates = async () => {
    const list = await call(president.cookie, "GET");
    return list.json().fees.find((fee: { kind: string }) => fee.kind === "base_monthly");
  };

  it("is kept to roles with settings:edit: the server refuses anyone else", async () => {
    for (const user of [treasurer, secretary]) {
      assert.equal((await call(user.cookie, "GET")).statusCode, 403);
      const sent = await call(user.cookie, "POST", { kind: "base_monthly", amountCentavos: 7000, startsOn: lastYear });
      assert.equal(sent.statusCode, 403);
    }
    assert.equal((await t.db.select().from(feeRates)).length, 0);
  });

  it("starts with no fee set", async () => {
    const list = await call(president.cookie, "GET");
    assert.equal(list.statusCode, 200);
    for (const fee of list.json().fees) {
      assert.deepEqual(fee.rates, []);
      assert.equal(fee.currentId, null);
    }
  });

  it("refuses amounts that are not whole centavos of zero or more, and starts that are not a month", async () => {
    const bad = [
      { kind: "base_monthly", amountCentavos: 70.5, startsOn: lastYear },
      { kind: "base_monthly", amountCentavos: -100, startsOn: lastYear },
      { kind: "base_monthly", amountCentavos: 7000, startsOn: `${today.slice(0, 7)}-15` },
      { kind: "base_monthly", amountCentavos: 7000, startsOn: "2026-13-01" },
      { kind: "water", amountCentavos: 7000, startsOn: lastYear },
    ];
    for (const payload of bad) {
      assert.equal((await call(president.cookie, "POST", payload)).statusCode, 400, JSON.stringify(payload));
    }
  });

  it("lets the first amount start in the past, so older debts can be counted, and logs it", async () => {
    const sent = await call(president.cookie, "POST", { kind: "base_monthly", amountCentavos: 7000, startsOn: lastYear });
    assert.equal(sent.statusCode, 201);
    assert.equal(feeOn(t.db, "base_monthly", today), 7000);

    const [entry] = await t.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, "fee_rate.created"), eq(auditLog.entityId, String(sent.json().rate.id))));
    assert.ok(entry);
    assert.equal(entry.area, "settings");
    assert.match(entry.summary, /^Ana Presidenta \(.+\) fijó la cuota mensual base en L 70\.00 desde enero de \d{4}$/);
    assert.deepEqual(entry.after, { kind: "base_monthly", amountCentavos: 7000, startsOn: lastYear });

    // The census now shows the base price's amount.
    const options = await t.app.inject({ method: "GET", url: "/api/census/options", headers: { cookie: secretary.cookie } });
    assert.equal(options.json().baseFeeCentavos, 7000);
  });

  it("lets another fee's first amount start in the past too, and be zero", async () => {
    const lateFee = await call(president.cookie, "POST", { kind: "late_fee", amountCentavos: 0, startsOn: lastYear });
    assert.equal(lateFee.statusCode, 201);
    assert.equal(feeOn(t.db, "late_fee", today), 0);
  });

  it("lets a change start this month", async () => {
    const sent = await call(president.cookie, "POST", { kind: "base_monthly", amountCentavos: 7500, startsOn: thisMonth });
    assert.equal(sent.statusCode, 201);
    assert.equal(feeOn(t.db, "base_monthly", today), 7500);
  });

  it("adds a later amount from its month on, keeping the old one for the months before", async () => {
    const sent = await call(president.cookie, "POST", { kind: "base_monthly", amountCentavos: 8000, startsOn: nextMonth });
    assert.equal(sent.statusCode, 201);
    assert.equal(feeOn(t.db, "base_monthly", today), 7500);
    assert.equal(feeOn(t.db, "base_monthly", nextMonth), 8000);

    const [entry] = await t.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, "fee_rate.created"), eq(auditLog.entityId, String(sent.json().rate.id))));
    assert.match(entry!.summary, /en L 80\.00 desde .+ \(antes L 75\.00\)$/);
    assert.deepEqual(entry!.before, { amountCentavos: 7500, startsOn: thisMonth });

    const again = await call(president.cookie, "POST", { kind: "base_monthly", amountCentavos: 9000, startsOn: nextMonth });
    assert.equal(again.statusCode, 409);
    assert.equal(again.json().error, "month_taken");

    const base = await baseRates();
    assert.deepEqual(
      base.rates.map((rate: { amountCentavos: number; startsOn: string }) => [rate.amountCentavos, rate.startsOn]),
      [[8000, nextMonth], [7500, thisMonth], [7000, lastYear]],
    );
    assert.equal(base.currentId, base.rates[1].id);
    assert.equal(base.rates[0].createdByName, "Ana Presidenta");
  });

  it("corrects an amount typed wrong, with a reason, and logs both", async () => {
    const first = (await baseRates()).rates[2];
    assert.equal(first.correctable, true);

    const noReason = await correct(president.cookie, first.id, { amountCentavos: 6000 });
    assert.equal(noReason.statusCode, 400);
    assert.equal((await correct(treasurer.cookie, first.id, { amountCentavos: 6000, reason: "Error al escribir" })).statusCode, 403);

    const sent = await correct(president.cookie, first.id, { amountCentavos: 6000, reason: "Error al escribir: era L 60" });
    assert.equal(sent.statusCode, 200);
    assert.equal(feeOn(t.db, "base_monthly", lastYear), 6000);

    const [entry] = await t.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, "fee_rate.corrected"), eq(auditLog.entityId, String(first.id))));
    assert.equal(entry!.reason, "Error al escribir: era L 60");
    assert.match(entry!.summary, /corrigió la cuota mensual base desde enero de \d{4}: L 70\.00 → L 60\.00$/);
    assert.deepEqual(entry!.before, { amountCentavos: 7000 });
  });

  it("does not correct an amount once a payment falls in its months; an older amount, whose months end before it, still can", async () => {
    const [month] = await t.db.insert(months).values({ month: thisMonth, status: "open" }).returning();
    const [category] = await t.db.select().from(categories).where(eq(categories.name, "Cuota mensual"));
    const paymentId = newId();
    await t.db.insert(transactions).values({
      id: paymentId,
      kind: "income",
      categoryId: category!.id,
      monthId: month!.id,
      occurredOn: today,
      amountCentavos: 7500,
      monthsCovered: [thisMonth],
      paymentMethod: "cash",
      createdBy: president.id,
    });
    assert.deepEqual(paidMonthsAt(t.db, "base_monthly", thisMonth), { first: thisMonth, last: thisMonth });
    assert.equal(paidMonthsAt(t.db, "base_monthly", nextMonth), null);
    // The first amount's months end where the current one starts.
    assert.equal(paidMonthsAt(t.db, "base_monthly", lastYear), null);
    // A monthly fee payment says nothing about the late fee.
    assert.equal(paidMonthsAt(t.db, "late_fee", lastYear), null);

    const base = await baseRates();
    const [upcoming, current, first] = base.rates;
    assert.deepEqual([upcoming.correctable, current.correctable, first.correctable], [true, false, true]);

    const sent = await correct(president.cookie, current.id, { amountCentavos: 7000, reason: "Error al escribir" });
    assert.equal(sent.statusCode, 409);
    assert.equal(sent.json().error, "already_paid");
    assert.equal(feeOn(t.db, "base_monthly", today), 7500);
  });

  it("removes an amount the board did not mean: it stops counting, and stays in the database with who and why", async () => {
    const [upcoming] = (await baseRates()).rates;
    assert.deepEqual([upcoming.amountCentavos, upcoming.startsOn], [8000, nextMonth]);

    assert.equal((await remove(president.cookie, upcoming.id, {})).statusCode, 400);
    assert.equal((await remove(president.cookie, upcoming.id, { reason: "no" })).statusCode, 400);
    assert.equal((await remove(treasurer.cookie, upcoming.id, { reason: "La junta no lo aprobó" })).statusCode, 403);
    assert.equal(feeOn(t.db, "base_monthly", nextMonth), 8000);

    const sent = await remove(president.cookie, upcoming.id, { reason: "La junta no aprobó este aumento" });
    assert.equal(sent.statusCode, 200);
    // Its month goes back to the amount before it, and Cuotas no longer lists it.
    assert.equal(feeOn(t.db, "base_monthly", nextMonth), 7500);
    const base = await baseRates();
    assert.deepEqual(base.rates.map((rate: { amountCentavos: number }) => rate.amountCentavos), [7500, 6000]);
    assert.equal(base.currentId, base.rates[0].id);

    const [row] = await t.db.select().from(feeRates).where(eq(feeRates.id, upcoming.id));
    assert.equal(row!.amountCentavos, 8000);
    assert.ok(row!.removedAt instanceof Date);
    assert.equal(row!.removedBy, president.id);
    assert.equal(row!.removedReason, "La junta no aprobó este aumento");

    const [entry] = await t.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, "fee_rate.removed"), eq(auditLog.entityId, String(upcoming.id))));
    assert.equal(entry!.area, "settings");
    assert.equal(entry!.reason, "La junta no aprobó este aumento");
    assert.match(
      entry!.summary,
      /^Ana Presidenta \(.+\) quitó la cuota mensual base de L 80\.00 desde .+ \(esos meses vuelven a L 75\.00\)$/,
    );
    assert.deepEqual(entry!.before, { kind: "base_monthly", amountCentavos: 8000, startsOn: nextMonth });
  });

  it("does not correct or remove an amount already removed", async () => {
    const [removed] = await t.db.select().from(feeRates).where(isNotNull(feeRates.removedAt));
    const corrected = await correct(president.cookie, removed!.id, { amountCentavos: 8500, reason: "Error al escribir" });
    assert.equal(corrected.statusCode, 404);
    assert.equal((await remove(president.cookie, removed!.id, { reason: "Otra vez" })).statusCode, 404);
    const [row] = await t.db.select().from(feeRates).where(eq(feeRates.id, removed!.id));
    assert.equal(row!.amountCentavos, 8000);
  });

  it("frees a removed amount's month for another amount", async () => {
    const sent = await call(president.cookie, "POST", { kind: "base_monthly", amountCentavos: 9000, startsOn: nextMonth });
    assert.equal(sent.statusCode, 201);
    assert.equal(feeOn(t.db, "base_monthly", nextMonth), 9000);
  });

  it("does not remove an amount once a payment covers its month", async () => {
    const [, current] = (await baseRates()).rates;
    assert.equal(current.amountCentavos, 7500);
    const sent = await remove(president.cookie, current.id, { reason: "Ya no se necesita" });
    assert.equal(sent.statusCode, 409);
    assert.equal(sent.json().error, "already_paid");
    assert.equal(feeOn(t.db, "base_monthly", today), 7500);
  });

  it("says when removing an amount leaves its months with none", async () => {
    const created = await call(president.cookie, "POST", { kind: "reconnection", amountCentavos: 50000, startsOn: nextMonth });
    assert.equal(created.statusCode, 201);
    const id = created.json().rate.id;
    assert.equal((await remove(president.cookie, id, { reason: "Se puso en la cuota equivocada" })).statusCode, 200);
    assert.equal(feeOn(t.db, "reconnection", nextMonth), null);

    const [entry] = await t.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, "fee_rate.removed"), eq(auditLog.entityId, String(id))));
    assert.match(entry!.summary, /quitó la cuota de reconexión de L 500\.00 desde .+ \(esos meses quedan sin monto\)$/);

    const list = await call(president.cookie, "GET");
    const reconnection = list.json().fees.find((fee: { kind: string }) => fee.kind === "reconnection");
    assert.deepEqual(reconnection.rates, []);
  });

  it("refuses a removed amount with no reason, even from outside the app", async () => {
    const [current] = await t.db.select().from(feeRates).where(eq(feeRates.amountCentavos, 7500));
    await rejectsWithDbError(
      t.db.update(feeRates).set({ removedAt: new Date() }).where(eq(feeRates.id, current!.id)),
      /fee_rates_removed_reason/,
    );
  });

  it("is never deleted, even from outside the app", async () => {
    await rejectsWithDbError(t.db.delete(feeRates), /nothing is deleted: fee_rates/);
  });
});

describe("a fee change that starts in a past month", () => {
  let t: TestApp;
  let president: { id: string; cookie: string };

  // 12 November 2026, midday in Honduras, the day the owner decided this.
  const now = new Date("2026-11-12T18:00:00.000Z");

  before(async () => {
    mock.timers.enable({ apis: ["Date"], now });
    t = await buildTestApp();
    president = await signedInUser(t, "presidente", "Ana Presidenta");
    for (const [kind, amountCentavos, startsOn] of [
      ["base_monthly", 7000, "2025-01-01"],
      ["reconnection", 30000, "2024-01-01"],
    ] as const) {
      assert.equal((await add({ kind, amountCentavos, startsOn })).statusCode, 201);
    }
  });
  after(async () => {
    await t.close();
    mock.timers.reset();
  });

  function add(payload: { kind: string; amountCentavos: number; startsOn: string }) {
    return t.app.inject({ method: "POST", url: "/api/settings/fees", headers: { cookie: president.cookie }, payload });
  }
  const rates = async (kind: string) => {
    const list = await t.app.inject({ method: "GET", url: "/api/settings/fees", headers: { cookie: president.cookie } });
    return list.json().fees.find((fee: { kind: string }) => fee.kind === kind).rates as Array<{
      id: number;
      amountCentavos: number;
      startsOn: string;
      correctable: boolean;
    }>;
  };

  /** A payment as Cobrar (or, later, "Other income") records it, under that fee's category. */
  async function pay(category: string, occurredOn: string, monthsCovered: string[] | null) {
    const accountingMonth = firstOfMonth(occurredOn);
    const [month] = await t.db.select().from(months).where(eq(months.month, accountingMonth));
    const monthId = month?.id ?? (await t.db.insert(months).values({ month: accountingMonth, status: "open" }).returning())[0]!.id;
    const [row] = await t.db.select().from(categories).where(eq(categories.name, category));
    const id = newId();
    await t.db.insert(transactions).values({
      id,
      kind: "income",
      categoryId: row!.id,
      monthId,
      occurredOn,
      amountCentavos: 7000,
      monthsCovered,
      paymentMethod: "cash",
      createdBy: president.id,
    });
    return id;
  }

  it("is accepted before the first amount, and between two amounts, while no payment falls in its months", async () => {
    const older = await add({ kind: "base_monthly", amountCentavos: 5000, startsOn: "2023-01-01" });
    assert.equal(older.statusCode, 201);
    const between = await add({ kind: "base_monthly", amountCentavos: 6000, startsOn: "2024-01-01" });
    assert.equal(between.statusCode, 201);
    assert.deepEqual(
      ["2022-12-01", "2023-06-01", "2024-01-01", "2024-12-01", "2025-01-01", "2026-11-01"].map((month) =>
        feeOn(t.db, "base_monthly", month),
      ),
      [null, 5000, 6000, 6000, 7000, 7000],
    );

    // The history log names the amount it replaces from its month on, if any.
    const summaries = await t.db
      .select({ summary: auditLog.summary, entityId: auditLog.entityId })
      .from(auditLog)
      .where(eq(auditLog.action, "fee_rate.created"));
    const summaryOf = (id: number) => summaries.find((entry) => entry.entityId === String(id))!.summary;
    assert.match(summaryOf(older.json().rate.id), /fijó la cuota mensual base en L 50\.00 desde enero de 2023$/);
    assert.match(summaryOf(between.json().rate.id), /en L 60\.00 desde enero de 2024 \(antes L 50\.00\)$/);
  });

  it("is refused once a payment falls in the months it would cover, and says the earliest month it could start", async () => {
    await pay("Cuota mensual", "2026-11-03", ["2024-03-01", "2024-04-01"]);
    const sent = await add({ kind: "base_monthly", amountCentavos: 6500, startsOn: "2024-02-01" });
    assert.equal(sent.statusCode, 409);
    assert.equal(sent.json().error, "months_paid");
    assert.equal(sent.json().firstPaidMonth, "2024-03-01");
    assert.equal(sent.json().earliestStart, "2024-05-01");
    assert.equal(
      sent.json().message,
      "Marzo de 2024 ya tiene pagos. Lo más pronto que puede empezar es mayo de 2024.",
    );
    assert.equal(feeOn(t.db, "base_monthly", "2024-02-01"), 6000);

    // That month is free: the change's months run from there to the next amount.
    assert.equal((await add({ kind: "base_monthly", amountCentavos: 6500, startsOn: "2024-05-01" })).statusCode, 201);
    assert.equal(feeOn(t.db, "base_monthly", "2024-04-01"), 6000);
    assert.equal(feeOn(t.db, "base_monthly", "2024-05-01"), 6500);
  });

  it("names no month when the paid months run up to the next amount", async () => {
    await pay("Cuota mensual", "2026-11-03", ["2024-12-01"]);
    const sent = await add({ kind: "base_monthly", amountCentavos: 6800, startsOn: "2024-09-01" });
    assert.equal(sent.statusCode, 409);
    assert.equal(sent.json().earliestStart, null);
    assert.equal(sent.json().message, "Diciembre de 2024 ya tiene pagos, así que este cambio no puede empezar en septiembre de 2024.");
  });

  it("does not count a reversed payment", async () => {
    const original = await pay("Cuota mensual", "2026-11-04", ["2023-06-01"]);
    const [month] = await t.db.select().from(months).where(eq(months.month, "2026-11-01"));
    const [category] = await t.db.select().from(categories).where(eq(categories.name, "Cuota mensual"));
    await t.db.insert(transactions).values({
      id: newId(),
      kind: "income",
      categoryId: category!.id,
      monthId: month!.id,
      occurredOn: "2026-11-05",
      amountCentavos: -7000,
      reversesId: original,
      reason: "Se anotó en la casa equivocada",
      createdBy: president.id,
    });
    assert.equal((await add({ kind: "base_monthly", amountCentavos: 5500, startsOn: "2023-06-01" })).statusCode, 201);
  });

  it("counts only payments of the same fee", async () => {
    // Monthly fee payments fill 2023 and 2024, and the late fee's first amount still starts in 2023.
    assert.equal((await add({ kind: "late_fee", amountCentavos: 1000, startsOn: "2023-01-01" })).statusCode, 201);

    // A late fee paid for March 2023 stops a late fee change that would cover it.
    await pay("Mora", "2026-11-06", ["2023-03-01"]);
    const lateFee = await add({ kind: "late_fee", amountCentavos: 1500, startsOn: "2023-02-01" });
    assert.equal(lateFee.statusCode, 409);
    assert.equal(lateFee.json().firstPaidMonth, "2023-03-01");

    // A reconnection is charged on the day it is paid.
    await pay("Reconexión", "2024-07-15", null);
    const reconnection = await add({ kind: "reconnection", amountCentavos: 35000, startsOn: "2024-06-01" });
    assert.equal(reconnection.statusCode, 409);
    assert.equal(reconnection.json().firstPaidMonth, "2024-07-01");
    assert.equal(reconnection.json().earliestStart, "2024-08-01");
  });

  it("is always accepted from this month on: a paid month keeps the price its first payment fixed", async () => {
    await pay("Cuota mensual", "2026-11-07", ["2026-11-01", "2026-12-01"]);
    assert.equal((await add({ kind: "base_monthly", amountCentavos: 8000, startsOn: "2026-11-01" })).statusCode, 201);
  });

  it("leaves an amount correctable while its own months hold no payment, even when later months do", async () => {
    const base = await rates("base_monthly");
    assert.deepEqual(
      base.map((rate) => [rate.startsOn, rate.amountCentavos, rate.correctable]),
      [
        ["2026-11-01", 8000, false], // November 2026 is paid
        ["2025-01-01", 7000, true],
        ["2024-05-01", 6500, false], // December 2024 is paid
        ["2024-01-01", 6000, false], // March and April 2024 are paid
        ["2023-06-01", 5500, true], // its only payment was reversed
        ["2023-01-01", 5000, true],
      ],
    );

    const oldest = base.at(-1)!;
    const corrected = await t.app.inject({
      method: "PATCH",
      url: `/api/settings/fees/${oldest.id}`,
      headers: { cookie: president.cookie },
      payload: { amountCentavos: 4500, reason: "El cuaderno dice L 45" },
    });
    assert.equal(corrected.statusCode, 200);
    assert.equal(feeOn(t.db, "base_monthly", "2023-02-01"), 4500);

    const paid = base.find((rate) => rate.startsOn === "2024-01-01")!;
    const refused = await t.app.inject({
      method: "POST",
      url: `/api/settings/fees/${paid.id}/remove`,
      headers: { cookie: president.cookie },
      payload: { reason: "No era ese monto" },
    });
    assert.equal(refused.statusCode, 409);
    assert.equal(refused.json().error, "already_paid");
  });
});

describe("a fee set for a later month", () => {
  let t: TestApp;
  let president: { cookie: string };
  let secretary: { cookie: string };

  // The last hour of 31 December 2026 in Honduras (UTC-6), a new year away from the amount.
  const lastHourOfTheYear = new Date("2027-01-01T05:00:00.000Z");

  before(async () => {
    mock.timers.enable({ apis: ["Date"], now: lastHourOfTheYear });
    t = await buildTestApp();
    president = await signedInUser(t, "presidente", "Ana Presidenta");
    secretary = await signedInUser(t, "secretario");

    for (const [amountCentavos, startsOn] of [[10000, "2026-11-01"], [7000, "2027-01-01"]] as const) {
      const sent = await t.app.inject({
        method: "POST",
        url: "/api/settings/fees",
        headers: { cookie: president.cookie },
        payload: { kind: "base_monthly", amountCentavos, startsOn },
      });
      assert.equal(sent.statusCode, 201);
    }
  });
  after(async () => {
    await t.close();
    mock.timers.reset();
  });

  /** What Cuotas and the census say right now. */
  const shown = async () => {
    const fees = await t.app.inject({ method: "GET", url: "/api/settings/fees", headers: { cookie: president.cookie } });
    const base = fees.json().fees.find((fee: { kind: string }) => fee.kind === "base_monthly");
    const current = base.rates.find((rate: { id: number }) => rate.id === base.currentId);
    const census = await t.app.inject({ method: "GET", url: "/api/census/options", headers: { cookie: secretary.cookie } });
    return { today: fees.json().today, inUse: current.amountCentavos, census: census.json().baseFeeCentavos };
  };

  it("is not in use, not on Cuotas and not in the census, before its month", async () => {
    assert.deepEqual(await shown(), { today: "2026-12-31", inUse: 10000, census: 10000 });
  });

  it("still is not in use in the last second of the month before, Honduras time", async () => {
    mock.timers.setTime(new Date("2027-01-01T05:59:59.000Z").getTime());
    assert.deepEqual(await shown(), { today: "2026-12-31", inUse: 10000, census: 10000 });
  });

  it("takes over by itself at midnight on its first day, Honduras time", async () => {
    mock.timers.setTime(new Date("2027-01-01T06:00:00.000Z").getTime());
    assert.deepEqual(await shown(), { today: "2027-01-01", inUse: 7000, census: 7000 });
  });

  it("leaves the months before it at the old amount", () => {
    assert.equal(feeOn(t.db, "base_monthly", "2026-12-31"), 10000);
    assert.equal(feeOn(t.db, "base_monthly", "2027-01-01"), 7000);
    assert.equal(feeOn(t.db, "base_monthly", "2027-06-15"), 7000);
  });
});

describe("the migration that lets a fee amount be removed", () => {
  it("keeps every amount saved before it in force, and frees only a removed amount's month", () => {
    // A database as it stood before the migration: everything up to Cobrar.
    const folder = mkdtempSync(join(tmpdir(), "zoilabe-migrations-"));
    cpSync(MIGRATIONS_FOLDER, folder, { recursive: true });
    const journalPath = join(folder, "meta", "_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: Array<{ tag: string }> };
    journal.entries = journal.entries.filter((entry) => entry.tag <= "0002");
    writeFileSync(journalPath, JSON.stringify(journal));
    const { db, sqlite } = createDb(":memory:");
    runMigrations(db, sqlite, folder);
    rmSync(folder, { recursive: true, force: true });

    sqlite.exec(`
      INSERT INTO fee_rates (kind, amount_centavos, starts_on) VALUES
        ('base_monthly', 10000, '2026-11-01'),
        ('base_monthly', 20000, '2027-01-01'),
        ('late_fee', 2000, '2026-11-01');
    `);

    runMigrations(db, sqlite);

    assert.deepEqual(
      sqlite.prepare("SELECT id, kind, amount_centavos, removed_at, removed_by, removed_reason FROM fee_rates ORDER BY id").all(),
      [
        { id: 1, kind: "base_monthly", amount_centavos: 10000, removed_at: null, removed_by: null, removed_reason: null },
        { id: 2, kind: "base_monthly", amount_centavos: 20000, removed_at: null, removed_by: null, removed_reason: null },
        { id: 3, kind: "late_fee", amount_centavos: 2000, removed_at: null, removed_by: null, removed_reason: null },
      ],
    );
    assert.equal(feeOn(db, "base_monthly", "2027-02-01"), 20000);

    // Two amounts in force may not share a month; once one is removed, they may.
    const again = "INSERT INTO fee_rates (kind, amount_centavos, starts_on) VALUES ('base_monthly', 15000, '2027-01-01')";
    assert.throws(() => sqlite.exec(again), /UNIQUE/);
    sqlite.exec("UPDATE fee_rates SET removed_at = '2026-11-06T12:00:00.000Z', removed_reason = 'No se aprobó' WHERE id = 2");
    sqlite.exec(again);
    assert.equal(feeOn(db, "base_monthly", "2027-02-01"), 15000);

    // The rebuilt table keeps its guard, and new ids carry on after the old ones.
    assert.throws(() => sqlite.exec("DELETE FROM fee_rates"), /nothing is deleted/);
    assert.equal((sqlite.prepare("SELECT max(id) AS id FROM fee_rates").get() as { id: number }).id, 4);
    sqlite.close();
  });
});
