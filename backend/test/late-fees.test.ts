import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import { eq } from "drizzle-orm";

import { auditLog, feeRates, households } from "../src/db/schema.js";
import { firstOfMonth } from "../src/lib/fees.js";
import { lateFeesOf } from "../src/lib/lateFees.js";
import { addMonths } from "../src/lib/payments.js";
import { HONDURAS_TIME_ZONE, businessToday } from "../src/lib/time.js";
import type { TestApp } from "./helpers.js";
import { buildTestApp, signedInUser, takeAway } from "./helpers.js";

/**
 * Month-end late fees (owner, 14 November 2026) and Quién debe. Every month
 * used here is past its deadline whatever today is: with no Plazo de pago set,
 * a month is due on its last day with no grace, and these are all before
 * this month.
 */
describe("Month-end late fees and Quién debe", () => {
  let t: TestApp;
  let treasurer: { cookie: string };
  let president: { cookie: string };
  let secretary: { cookie: string };
  let vocal: { cookie: string };
  let idCounter = 801199300000;
  let receiptCounter = 9000;

  const today = businessToday(HONDURAS_TIME_ZONE);
  const thisMonth = firstOfMonth(today);
  const m = (by: number) => addMonths(thisMonth, -by);
  /** A day inside a month: "2026-05-01", 5 → "2026-05-05". */
  const dayOf = (month: string, day: number) => `${month.slice(0, 8)}${String(day).padStart(2, "0")}`;

  const call = (cookie: string, method: "GET" | "POST", url: string, payload?: object) =>
    t.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

  const register = async (name = "rosa martínez") => {
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
  const pay = async (householdId: string, month: string, occurredOn: string, amountCentavos = 7000) => {
    const response = await call(treasurer.cookie, "POST", "/api/finance/payments", {
      submissionId: randomUUID(),
      householdId,
      months: [month],
      amountCentavos,
      occurredOn,
      paymentMethod: "cash",
      paperReceiptNumber: String((receiptCounter += 1)),
    });
    assert.equal(response.statusCode, 201, response.body);
  };
  const lateFeeMonths = (householdId: string) =>
    lateFeesOf(t.db, householdId, today, HONDURAS_TIME_ZONE).months.map((fee) => fee.month);
  const setFrom = (month: string) => call(president.cookie, "POST", "/api/settings/late-fees", { month });

  let house: { id: string; code: string };

  before(async () => {
    t = await buildTestApp();
    treasurer = await signedInUser(t, "tesorero", "Tina Tesorera");
    president = await signedInUser(t, "presidente", "Pedro Presidente");
    secretary = await signedInUser(t, "secretario");
    vocal = await signedInUser(t, "primer_vocal");
    await t.db.insert(feeRates).values([
      { kind: "base_monthly", amountCentavos: 7000, startsOn: m(24) },
      { kind: "late_fee", amountCentavos: 5000, startsOn: m(24) },
    ]);

    // One family's history, typed in through Cobrar:
    house = await register();
    await pay(house.id, m(9), dayOf(m(9), 5)); // first entered payment: the family owes from here
    // m(8) and m(7): never paid, before automatic late fees start
    await pay(house.id, m(6), dayOf(m(6), 5)); // in time
    // m(5): never paid
    await pay(house.id, m(4), today); // paid in full, but after its deadline
    await pay(house.id, m(3), dayOf(m(3), 5), 3000); // only part of it in time
    await pay(house.id, m(2), dayOf(m(2), 15)); // in time while the deadline is the month's last day
    // m(1): never paid
  });
  after(async () => {
    await t.close();
  });

  it("adds no late fee by itself until Configuración says from which month", async () => {
    const owed = await call(treasurer.cookie, "GET", `/api/finance/households/${house.id}/owed`);
    assert.equal(owed.statusCode, 200, owed.body);
    assert.deepEqual(owed.json().lateFees, { from: null, none: "not_set", months: [], totalCentavos: 0 });

    const arrears = await call(treasurer.cookie, "GET", "/api/finance/arrears");
    assert.equal(arrears.json().lateFeesFrom, null);
    const row = arrears.json().households.find((h: { id: string }) => h.id === house.id);
    assert.equal(row.lateFeesCentavos, 0);
  });

  it("lets only those who may change settings say from which month, and logs it", async () => {
    takeAway(t, "primer_vocal", "settings:edit");
    const byVocal = await call(vocal.cookie, "POST", "/api/settings/late-fees", { month: m(6) });
    assert.equal(byVocal.statusCode, 403);
    const notAMonth = await setFrom(dayOf(m(6), 15));
    assert.equal(notAMonth.statusCode, 400);

    const saved = await setFrom(m(6));
    assert.equal(saved.statusCode, 200, saved.body);
    const read = await call(president.cookie, "GET", "/api/settings/late-fees");
    assert.equal(read.json().from, m(6));
    assert.equal(read.json().saved.savedBy, "Pedro Presidente");
    const [logged] = await t.db.select().from(auditLog).where(eq(auditLog.action, "late_fees_from.set"));
    assert.match(logged!.summary, /^Pedro Presidente \(Presidente\) fijó desde qué mes se cobra la mora: .+ \(antes no se cobraba sola\)$/);
  });

  it("owes a late fee for each month from then not paid in full by its deadline, even one paid in full later", async () => {
    // m(8) and m(7) are owed but come before the month in Configuración; m(6) and m(2) were paid in time.
    assert.deepEqual(lateFeeMonths(house.id), [m(5), m(4), m(3), m(1)]);
    const fees = lateFeesOf(t.db, house.id, today, HONDURAS_TIME_ZONE);
    assert.equal(fees.totalCentavos, 4 * 5000);
    assert.equal(fees.none, null);
  });

  it("shows them on the household's file, beside what it owes", async () => {
    const owed = await call(treasurer.cookie, "GET", `/api/finance/households/${house.id}/owed`);
    const body = owed.json();
    // m(4) was paid in full, late: no longer owed, but its late fee is.
    assert.deepEqual(body.months.map((state: { month: string }) => state.month), [m(8), m(7), m(5), m(3), m(1)]);
    assert.deepEqual(body.lateFees.months.map((fee: { month: string }) => fee.month), [m(5), m(4), m(3), m(1)]);
    assert.equal(body.lateFees.from, m(6));
  });

  it("is paid by a Mora entry for its month, and owed again if that entry is undone", async () => {
    const recorded = await call(treasurer.cookie, "POST", "/api/finance/income", {
      submissionId: randomUUID(),
      type: "late_fee",
      householdId: house.id,
      month: m(5),
      amountCentavos: 5000,
      occurredOn: today,
      paymentMethod: "cash",
      paperReceiptNumber: String((receiptCounter += 1)),
    });
    assert.equal(recorded.statusCode, 201, recorded.body);
    assert.deepEqual(lateFeeMonths(house.id), [m(4), m(3), m(1)]);

    const undone = await call(president.cookie, "POST", `/api/finance/income/${recorded.json().entry.id}/reverse`, { reason: "Era de otro mes" });
    assert.equal(undone.statusCode, 200, undone.body);
    assert.deepEqual(lateFeeMonths(house.id), [m(5), m(4), m(3), m(1)]);
  });

  it("follows Plazo de pago: with an earlier deadline, a month paid on the 15th was paid late", async () => {
    const set = await call(president.cookie, "POST", "/api/settings/deadline", { dueDay: 10, graceDays: 0 });
    assert.equal(set.statusCode, 200, set.body);
    try {
      // After the 10th, this month is past its deadline too, and unpaid.
      const thisMonthToo = Number(today.slice(8, 10)) > 10 ? [thisMonth] : [];
      assert.deepEqual(lateFeeMonths(house.id), [m(5), m(4), m(3), m(2), m(1), ...thisMonthToo]);
    } finally {
      const back = await call(president.cookie, "POST", "/api/settings/deadline", { dueDay: 31, graceDays: 0 });
      assert.equal(back.statusCode, 200, back.body);
    }
  });

  it("lists in Quién debe each month's fee left and its late fee, the most owed house first", async () => {
    const other = await register("ana gómez");
    await pay(other.id, m(2), dayOf(m(2), 5));
    // m(1) unpaid: owed L 70, and its late fee L 50.

    const response = await call(treasurer.cookie, "GET", "/api/finance/arrears");
    assert.equal(response.statusCode, 200, response.body);
    const body = response.json();
    assert.equal(body.lateFeesFrom, m(6));
    const ids = body.households.map((h: { id: string }) => h.id);
    assert.ok(ids.indexOf(house.id) < ids.indexOf(other.id), "the house that owes more comes first");

    const row = body.households.find((h: { id: string }) => h.id === house.id);
    assert.equal(row.code, house.code);
    assert.equal(row.ownerName, "Rosa Martínez");
    assert.deepEqual(row.months, [
      { month: m(8), owedCentavos: 7000, lateFeeCentavos: 0 },
      { month: m(7), owedCentavos: 7000, lateFeeCentavos: 0 },
      { month: m(5), owedCentavos: 7000, lateFeeCentavos: 5000 },
      { month: m(4), owedCentavos: 0, lateFeeCentavos: 5000 },
      { month: m(3), owedCentavos: 4000, lateFeeCentavos: 5000 },
      { month: m(1), owedCentavos: 7000, lateFeeCentavos: 5000 },
    ]);
    assert.equal(row.owedCentavos, 32000);
    assert.equal(row.lateFeesCentavos, 20000);
    assert.equal(row.totalCentavos, 52000);

    const second = body.households.find((h: { id: string }) => h.id === other.id);
    assert.deepEqual(second.months, [{ month: m(1), owedCentavos: 7000, lateFeeCentavos: 5000 }]);
    assert.equal(body.totalCentavos, body.households.reduce((sum: number, h: { totalCentavos: number }) => sum + h.totalCentavos, 0));
  });

  it("counts a month, and its late fee, only if the house was active with water when its deadline ended (status history)", async () => {
    const inactive = await register("luis pineda");
    const disconnected = await register("marta cruz");
    // Both paid m(3) in time; m(2) and m(1) are unpaid.
    for (const id of [inactive.id, disconnected.id]) {
      await pay(id, m(3), dayOf(m(3), 5));
    }
    const owedOf = async (id: string) => {
      const body = (await call(treasurer.cookie, "GET", `/api/finance/households/${id}/owed`)).json();
      return { months: body.months.map((s: { month: string }) => s.month), lateFees: body.lateFees.months.map((f: { month: string }) => f.month) };
    };

    // Inactive since the first day of m(1): m(1) is neither owed nor late; m(2) still is, both.
    const deactivated = await call(president.cookie, "POST", `/api/census/households/${inactive.id}/deactivate`, {
      reason: "moved_away",
      since: dayOf(m(1), 1),
    });
    assert.equal(deactivated.statusCode, 200, deactivated.body);
    assert.deepEqual(await owedOf(inactive.id), { months: [m(2)], lateFees: [m(2)] });

    // Without water since the first day of m(2), entered today: neither month is owed.
    const cut = await call(president.cookie, "PATCH", `/api/census/households/${disconnected.id}`, {
      waterConnection: "not_connected",
      connectionSince: dayOf(m(2), 1),
    });
    assert.equal(cut.statusCode, 200, cut.body);
    assert.deepEqual(await owedOf(disconnected.id), { months: [], lateFees: [] });

    // Quién debe lists only the houses active with water today.
    const ids = (await call(treasurer.cookie, "GET", "/api/finance/arrears")).json().households.map((h: { id: string }) => h.id);
    assert.ok(!ids.includes(inactive.id));
    assert.ok(!ids.includes(disconnected.id));

    // Active again since the 20th of m(1), entered later: m(1) had service when its deadline ended, so it is owed again.
    const back = await call(president.cookie, "POST", `/api/census/households/${inactive.id}/reactivate`, { since: dayOf(m(1), 20) });
    assert.equal(back.statusCode, 200, back.body);
    assert.deepEqual(await owedOf(inactive.id), { months: [m(2), m(1)], lateFees: [m(2), m(1)] });
    const [house] = await t.db.select().from(households).where(eq(households.id, inactive.id));
    assert.equal(house!.status, "active");
  });

  it("owes no late fee for a month whose late fee in Configuración is L 0", async () => {
    await t.db.insert(feeRates).values({ kind: "late_fee", amountCentavos: 0, startsOn: m(1) });
    assert.deepEqual(lateFeeMonths(house.id), [m(5), m(4), m(3)]);
  });

  it("is shown only to those who may see finances", async () => {
    takeAway(t, "secretario", "finance:view");
    const response = await call(secretary.cookie, "GET", "/api/finance/arrears");
    assert.equal(response.statusCode, 403);
  });
});
