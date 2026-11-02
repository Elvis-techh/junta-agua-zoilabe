import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { and, eq } from "drizzle-orm";

import { auditLog, feeRates } from "../src/db/schema.js";
import { earliestFeeStart, firstOfMonth, monthAfter } from "../src/lib/fees.js";
import { feeOn } from "../src/lib/settings.js";
import { HONDURAS_TIME_ZONE, businessToday } from "../src/lib/time.js";
import type { TestApp } from "./helpers.js";
import { buildTestApp, rejectsWithDbError, signedInUser } from "./helpers.js";

describe("the earliest month a fee may start", () => {
  it("is any month for the first amount, and next month after that", () => {
    assert.equal(earliestFeeStart(false, "2026-11-02"), null);
    assert.equal(earliestFeeStart(true, "2026-11-02"), "2026-12-01");
    assert.equal(earliestFeeStart(true, "2026-12-31"), "2027-01-01");
  });
});

describe("Configuración → Cuotas", () => {
  let t: TestApp;
  let president: { cookie: string };
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

  it("refuses amounts that are not whole centavos above zero, and starts that are not a month", async () => {
    const bad = [
      { kind: "base_monthly", amountCentavos: 70.5, startsOn: lastYear },
      { kind: "base_monthly", amountCentavos: 0, startsOn: lastYear },
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

  it("never rewrites a month that has started: a change starts next month at the earliest", async () => {
    for (const startsOn of [lastYear, thisMonth]) {
      const sent = await call(president.cookie, "POST", { kind: "base_monthly", amountCentavos: 8000, startsOn });
      assert.equal(sent.statusCode, 409);
      assert.equal(sent.json().error, "starts_too_early");
      assert.equal(sent.json().earliestStart, nextMonth);
    }
    assert.equal(feeOn(t.db, "base_monthly", today), 7000);
    // Another fee's first amount is still free to start in the past.
    const lateFee = await call(president.cookie, "POST", { kind: "late_fee", amountCentavos: 2000, startsOn: lastYear });
    assert.equal(lateFee.statusCode, 201);
  });

  it("adds a later amount from its month on, keeping the old one for the months before", async () => {
    const sent = await call(president.cookie, "POST", { kind: "base_monthly", amountCentavos: 8000, startsOn: nextMonth });
    assert.equal(sent.statusCode, 201);
    assert.equal(feeOn(t.db, "base_monthly", today), 7000);
    assert.equal(feeOn(t.db, "base_monthly", nextMonth), 8000);

    const [entry] = await t.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, "fee_rate.created"), eq(auditLog.entityId, String(sent.json().rate.id))));
    assert.match(entry!.summary, /en L 80\.00 desde .+ \(antes L 70\.00\)$/);
    assert.deepEqual(entry!.before, { amountCentavos: 7000, startsOn: lastYear });

    const again = await call(president.cookie, "POST", { kind: "base_monthly", amountCentavos: 9000, startsOn: nextMonth });
    assert.equal(again.statusCode, 409);
    assert.equal(again.json().error, "month_taken");

    const list = await call(president.cookie, "GET");
    const base = list.json().fees.find((fee: { kind: string }) => fee.kind === "base_monthly");
    assert.deepEqual(
      base.rates.map((rate: { amountCentavos: number; startsOn: string }) => [rate.amountCentavos, rate.startsOn]),
      [[8000, nextMonth], [7000, lastYear]],
    );
    assert.equal(base.currentId, base.rates[1].id);
    assert.equal(base.rates[0].createdByName, "Ana Presidenta");
    assert.equal(base.earliestStart, nextMonth);
  });

  it("is never deleted, even from outside the app", async () => {
    await rejectsWithDbError(t.db.delete(feeRates), /nothing is deleted: fee_rates/);
  });
});
