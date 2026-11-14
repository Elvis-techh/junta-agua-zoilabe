import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it, mock } from "node:test";

import type { TestApp } from "./helpers.js";
import { eq } from "drizzle-orm";

import { auditLog } from "../src/db/schema.js";
import { isPastDeadline, monthDeadline } from "../src/lib/settings.js";
import { buildTestApp, signedInUser, takeAway } from "./helpers.js";

// 13 November 2026, midday in Honduras, the day the owner decided this.
const now = new Date("2026-11-13T18:00:00.000Z");

describe("what a house owes (owner, 13 November 2026)", () => {
  let t: TestApp;
  let treasurer: { cookie: string };
  let secretary: { cookie: string };
  let sectorId: number;
  let idCounter = 801199300000;
  let receipt = 9000;

  const call = (cookie: string, method: "GET" | "POST", url: string, payload?: object) =>
    t.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

  const register = async (paper?: { date: string }) => {
    const created = await call(secretary.cookie, "POST", "/api/census/households", {
      submissionId: randomUUID(),
      person: { fullName: "rosa martínez", idNumber: String((idCounter += 1)).padStart(13, "0"), phone: "99887766" },
      household: { sectorId, references: "Por la escuela", waterConnection: "connected", relation: "owner" },
      fee: { kind: "base" },
      ...(paper ? { paper } : {}),
    });
    assert.equal(created.statusCode, 201, created.body);
    return created.json().household.id as string;
  };

  /** A payment typed in from the paper book: its own months, dated on the 10th of the first one (today, for months ahead). */
  const pay = async (householdId: string, months: string[], amountCentavos = 7000 * months.length) => {
    const response = await call(treasurer.cookie, "POST", "/api/finance/payments", {
      submissionId: randomUUID(),
      householdId,
      months,
      amountCentavos,
      occurredOn: `${months[0]!.slice(0, 8)}10` < "2026-11-13" ? `${months[0]!.slice(0, 8)}10` : "2026-11-13",
      paymentMethod: "cash",
      paperReceiptNumber: String((receipt += 1)),
    });
    assert.equal(response.statusCode, 201, response.body);
    return response.json().payment.id as string;
  };

  const owed = async (householdId: string) => {
    const response = await call(treasurer.cookie, "GET", `/api/finance/households/${householdId}/owed`);
    assert.equal(response.statusCode, 200, response.body);
    return response.json() as {
      owesFrom: { month: string; because: string };
      months: Array<{ month: string; priceCentavos: number; paidCentavos: number }>;
      dueSoon: Array<{ month: string; dueOn: string; lateAfter: string }>;
      totalCentavos: number;
    };
  };

  before(async () => {
    mock.timers.enable({ apis: ["Date"], now });
    t = await buildTestApp();
    const president = await signedInUser(t, "presidente");
    treasurer = await signedInUser(t, "tesorero");
    secretary = await signedInUser(t, "secretario");
    // L 70 from January 2025: months before it have no fee.
    const fee = await call(president.cookie, "POST", "/api/settings/fees", { kind: "base_monthly", amountCentavos: 7000, startsOn: "2025-01-01" });
    assert.equal(fee.statusCode, 201, fee.body);
    const sector = await call(president.cookie, "POST", "/api/settings/sectors", { name: "La Loma" });
    sectorId = sector.json().sector.id;
  });
  after(async () => {
    await t.close();
    mock.timers.reset();
  });

  it("counts from the month it was registered while nothing is entered, and not this month before its deadline", async () => {
    const house = await register();
    const result = await owed(house);
    assert.deepEqual(result.owesFrom, { month: "2026-11-01", because: "registered" });
    assert.deepEqual(result.months, []);
    assert.equal(result.totalCentavos, 0);
    // With no deadline set, November is due on its last day.
    assert.deepEqual(
      result.dueSoon.map(({ month, dueOn, lateAfter }) => ({ month, dueOn, lateAfter })),
      [{ month: "2026-11-01", dueOn: "2026-11-30", lateAfter: "2026-11-30" }],
    );
  });

  it("counts from the paper form's month for a family typed in from paper", async () => {
    const house = await register({ date: "2026-08-20" });
    const result = await owed(house);
    assert.deepEqual(result.owesFrom, { month: "2026-08-01", because: "registered" });
    assert.deepEqual(result.months.map((m) => m.month), ["2026-08-01", "2026-09-01", "2026-10-01"]);
    assert.equal(result.totalCentavos, 21000);
  });

  it("counts from its first entered payment when that is earlier, and a skipped month stays owed", async () => {
    const house = await register();
    await pay(house, ["2025-03-01"]);
    await pay(house, ["2025-05-01"]);
    const result = await owed(house);
    assert.deepEqual(result.owesFrom, { month: "2025-03-01", because: "first_payment" });
    const months = result.months.map((m) => m.month);
    assert.equal(months[0], "2025-04-01", "April was skipped: still owed after May was paid");
    assert.ok(!months.includes("2025-03-01") && !months.includes("2025-05-01"));
    assert.equal(months.at(-1), "2026-10-01");
    // April 2025, and June 2025 to October 2026.
    assert.equal(months.length, 1 + 17);
    assert.equal(result.totalCentavos, 18 * 7000);
  });

  it("owes what is left of a month paid in part, and nothing for months paid ahead", async () => {
    const house = await register();
    await pay(house, ["2026-09-01"]);
    await pay(house, ["2026-10-01"], 3000);
    await pay(house, ["2026-11-01", "2026-12-01"]);
    const result = await owed(house);
    assert.deepEqual(result.owesFrom, { month: "2026-09-01", because: "first_payment" });
    assert.deepEqual(result.months, [{ month: "2026-10-01", priceCentavos: 7000, paidCentavos: 3000 }]);
    assert.deepEqual(result.dueSoon, []);
    assert.equal(result.totalCentavos, 4000);
  });

  it("does not count a reversed payment, neither as paid nor as the first entry", async () => {
    const house = await register();
    const march = await pay(house, ["2025-03-01"]);
    await pay(house, ["2025-05-01"]);
    const reversed = await call(treasurer.cookie, "POST", `/api/finance/payments/${march}/reverse`, {
      reason: "Se registró en la vivienda equivocada",
    });
    assert.equal(reversed.statusCode, 200, reversed.body);
    const result = await owed(house);
    assert.deepEqual(result.owesFrom, { month: "2025-05-01", because: "first_payment" });
    assert.equal(result.months[0]!.month, "2025-06-01");
  });

  it("does not count a month with no fee set", async () => {
    const house = await register({ date: "2024-10-05" });
    const result = await owed(house);
    assert.deepEqual(result.owesFrom, { month: "2024-10-01", because: "registered" });
    assert.equal(result.months[0]!.month, "2025-01-01");
  });

  it("lists in Cobrar the owed months older than the list first, so they need no searching", async () => {
    const house = await register();
    await pay(house, ["2026-01-01"]);
    const response = await call(treasurer.cookie, "GET", `/api/finance/households/${house}/months`);
    assert.equal(response.statusCode, 200, response.body);
    const body = response.json() as { owedBefore: Array<{ month: string }>; months: Array<{ month: string }> };
    assert.deepEqual(
      body.owedBefore.map((m) => m.month),
      ["2026-02-01", "2026-03-01", "2026-04-01", "2026-05-01", "2026-06-01", "2026-07-01"],
    );
    assert.equal(body.months[0]!.month, "2026-08-01");

    const older = await call(treasurer.cookie, "GET", `/api/finance/households/${house}/months?from=2026-01-01`);
    assert.deepEqual(older.json().owedBefore, []);
  });

  it("is kept to roles with finance:view", async () => {
    const house = await register();
    takeAway(t, "secretario", "finance:view");
    const refused = await call(secretary.cookie, "GET", `/api/finance/households/${house}/owed`);
    assert.equal(refused.statusCode, 403);
    const unknown = await call(treasurer.cookie, "GET", `/api/finance/households/${randomUUID()}/owed`);
    assert.equal(unknown.statusCode, 404);
  });
});

describe("a month's payment deadline", () => {
  it("is its due day, or its last day when the month is shorter, plus the grace days", () => {
    assert.deepEqual(monthDeadline("2026-11-01", { dueDay: 25, graceDays: 5 }), { dueOn: "2026-11-25", lateAfter: "2026-11-30" });
    assert.deepEqual(monthDeadline("2026-11-01", { dueDay: 25, graceDays: 10 }), { dueOn: "2026-11-25", lateAfter: "2026-12-05" });
    assert.deepEqual(monthDeadline("2026-02-01", { dueDay: 31, graceDays: 0 }), { dueOn: "2026-02-28", lateAfter: "2026-02-28" });
    assert.deepEqual(monthDeadline("2028-02-01", { dueDay: 30, graceDays: 1 }), { dueOn: "2028-02-29", lateAfter: "2028-03-01" });
  });

  it("makes a month owed only from the day after its grace ends", () => {
    const rule = { dueDay: 25, graceDays: 5 };
    assert.equal(isPastDeadline("2026-11-01", "2026-11-30", rule), false);
    assert.equal(isPastDeadline("2026-11-01", "2026-12-01", rule), true);
  });
});

describe("Configuración → Plazo de pago (owner, 13 November 2026)", () => {
  let t: TestApp;
  let president: { cookie: string };
  let treasurer: { cookie: string };
  let house: string;

  const call = (cookie: string, method: "GET" | "POST", url: string, payload?: object) =>
    t.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

  before(async () => {
    mock.timers.enable({ apis: ["Date"], now });
    t = await buildTestApp();
    president = await signedInUser(t, "presidente", "Ana Presidenta");
    treasurer = await signedInUser(t, "tesorero");
    const secretary = await signedInUser(t, "secretario");
    await call(president.cookie, "POST", "/api/settings/fees", { kind: "base_monthly", amountCentavos: 7000, startsOn: "2025-01-01" });
    const sector = await call(president.cookie, "POST", "/api/settings/sectors", { name: "El Puente" });
    const created = await call(secretary.cookie, "POST", "/api/census/households", {
      submissionId: randomUUID(),
      person: { fullName: "luis gómez", idNumber: "0801199555555", phone: "99887766" },
      household: { sectorId: sector.json().sector.id, references: "Frente al puente", waterConnection: "connected", relation: "owner" },
      fee: { kind: "base" },
    });
    house = created.json().household.id;
  });
  after(async () => {
    await t.close();
    mock.timers.reset();
  });

  it("starts at the last day of the month, with no grace", async () => {
    const shown = await call(president.cookie, "GET", "/api/settings/deadline");
    assert.equal(shown.statusCode, 200, shown.body);
    assert.deepEqual(shown.json().deadline, { dueDay: 31, graceDays: 0 });
    assert.equal(shown.json().saved, null);
  });

  it("refuses a day outside 1 to 31, and negative grace", async () => {
    for (const payload of [{ dueDay: 0, graceDays: 0 }, { dueDay: 32, graceDays: 0 }, { dueDay: 25, graceDays: -1 }, { dueDay: 2.5, graceDays: 0 }]) {
      assert.equal((await call(president.cookie, "POST", "/api/settings/deadline", payload)).statusCode, 400, JSON.stringify(payload));
    }
  });

  it("is kept to roles with settings:edit", async () => {
    takeAway(t, "tesorero", "settings:edit");
    assert.equal((await call(treasurer.cookie, "POST", "/api/settings/deadline", { dueDay: 25, graceDays: 5 })).statusCode, 403);
  });

  it("is saved and logged, and decides when a month counts as owed", async () => {
    const saved = await call(president.cookie, "POST", "/api/settings/deadline", { dueDay: 10, graceDays: 2 });
    assert.equal(saved.statusCode, 200, saved.body);
    const [logged] = await t.db.select().from(auditLog).where(eq(auditLog.action, "deadline.set"));
    assert.equal(
      logged!.summary,
      "Ana Presidenta (Presidente) fijó el plazo de pago: el día 10, con 2 días de gracia (antes el último día del mes, sin días de gracia)",
    );

    // On 13 November, November (due the 10th, grace to the 12th) is now owed.
    const owed = await call(treasurer.cookie, "GET", `/api/finance/households/${house}/owed`);
    assert.deepEqual(owed.json().months.map((m: { month: string }) => m.month), ["2026-11-01"]);
    assert.deepEqual(owed.json().dueSoon, []);

    // With five more grace days it is not yet.
    await call(president.cookie, "POST", "/api/settings/deadline", { dueDay: 10, graceDays: 7 });
    const later = await call(treasurer.cookie, "GET", `/api/finance/households/${house}/owed`);
    assert.deepEqual(later.json().months, []);
    assert.equal(later.json().dueSoon[0].lateAfter, "2026-11-17");
  });
});
