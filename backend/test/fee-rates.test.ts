import assert from "node:assert/strict";
import { after, before, describe, it, mock } from "node:test";

import { and, eq } from "drizzle-orm";

import { newId } from "../src/auth/session.js";
import { auditLog, categories, feeRates, months, transactions } from "../src/db/schema.js";
import { earliestFeeStart, firstOfMonth, monthAfter, paidFrom } from "../src/lib/fees.js";
import { feeOn } from "../src/lib/settings.js";
import { HONDURAS_TIME_ZONE, businessToday } from "../src/lib/time.js";
import type { TestApp } from "./helpers.js";
import { TEST_PIN, buildTestApp, rejectsWithDbError, signedInUser } from "./helpers.js";

describe("the earliest month a fee may start", () => {
  it("is any month for the first amount, and this month after that", () => {
    assert.equal(earliestFeeStart(false, "2026-11-02"), null);
    assert.equal(earliestFeeStart(true, "2026-11-02"), "2026-11-01");
    assert.equal(earliestFeeStart(true, "2026-12-31"), "2026-12-01");
  });
});

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
  });
  after(async () => {
    await t.close();
  });

  const call = (cookie: string, method: "GET" | "POST", payload?: object) =>
    t.app.inject({ method, url: "/api/settings/fees", headers: { cookie }, ...(payload ? { payload } : {}) });
  const correct = (cookie: string, id: number, payload: object) =>
    t.app.inject({ method: "PATCH", url: `/api/settings/fees/${id}`, headers: { cookie }, payload });
  const confirmPin = async (cookie: string) => {
    const confirmed = await t.app.inject({
      method: "POST",
      url: "/api/auth/confirm-pin",
      headers: { cookie },
      payload: { pin: TEST_PIN },
    });
    assert.equal(confirmed.statusCode, 200);
  };
  const baseRates = async () => {
    const list = await call(president.cookie, "GET");
    return list.json().fees.find((fee: { kind: string }) => fee.kind === "base_monthly");
  };

  it("is kept to Configuración's roles: the server refuses anyone else", async () => {
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
      assert.equal(fee.earliestStart, null);
    }
  });

  it("asks for the PIN again before saving", async () => {
    const sent = await call(president.cookie, "POST", { kind: "base_monthly", amountCentavos: 7000, startsOn: lastYear });
    assert.equal(sent.statusCode, 403);
    assert.equal(sent.json().error, "pin_required");
    assert.equal((await t.db.select().from(feeRates)).length, 0);
    await confirmPin(president.cookie);
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

  it("never rewrites a past month: a change starts this month at the earliest", async () => {
    const sent = await call(president.cookie, "POST", { kind: "base_monthly", amountCentavos: 8000, startsOn: lastYear });
    assert.equal(sent.statusCode, 409);
    assert.equal(sent.json().error, "starts_too_early");
    assert.equal(sent.json().earliestStart, thisMonth);
    assert.equal(feeOn(t.db, "base_monthly", today), 7000);
    // Another fee's first amount is still free to start in the past, and may be zero.
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
    assert.equal(base.earliestStart, thisMonth);
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

  it("does not correct an amount once a payment has been made at it", async () => {
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
    assert.equal(paidFrom(t.db, thisMonth), true);
    assert.equal(paidFrom(t.db, nextMonth), false);

    const base = await baseRates();
    const [upcoming, current, first] = base.rates;
    assert.deepEqual([upcoming.correctable, current.correctable, first.correctable], [true, false, false]);

    const sent = await correct(president.cookie, current.id, { amountCentavos: 7000, reason: "Error al escribir" });
    assert.equal(sent.statusCode, 409);
    assert.equal(sent.json().error, "already_paid");
    assert.equal(feeOn(t.db, "base_monthly", today), 7500);
  });

  it("is never deleted, even from outside the app", async () => {
    await rejectsWithDbError(t.db.delete(feeRates), /nothing is deleted: fee_rates/);
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

    const confirmed = await t.app.inject({
      method: "POST",
      url: "/api/auth/confirm-pin",
      headers: { cookie: president.cookie },
      payload: { pin: TEST_PIN },
    });
    assert.equal(confirmed.statusCode, 200);
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
