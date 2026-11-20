import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import { eq } from "drizzle-orm";

import { categories, feeRates } from "../src/db/schema.js";
import { firstOfMonth } from "../src/lib/fees.js";
import { addMonths } from "../src/lib/payments.js";
import { HONDURAS_TIME_ZONE, businessToday } from "../src/lib/time.js";
import type { TestApp } from "./helpers.js";
import { buildTestApp, signedInUser, takeAway } from "./helpers.js";

interface Entry {
  id: string;
  kind: "income" | "expense";
  category: string;
  occurredOn: string;
  amountCentavos: number;
  countsCentavos: number;
  paymentMethod: string | null;
  householdCode: string | null;
  ownerName: string | null;
  payerName: string | null;
  supplier: string | null;
  monthsCovered: string[] | null;
  hasPhoto: boolean;
  noPhotoReason: string | null;
  reversedOn: string | null;
  reversalReason: string | null;
  undoesOn: string | null;
}

interface FeeHouse {
  code: string;
  ownerName: string;
  priceCentavos: number;
  paidCentavos: number;
  lateFeeCentavos: number;
}

interface Summary {
  month: string;
  thisMonth: string;
  openingMonth: string;
  status: string;
  figures: {
    opening: { cashCentavos: number; bankCentavos: number; otherCentavos: number };
    income: { cashCentavos: number; bankCentavos: number; otherCentavos: number };
    expense: { cashCentavos: number; bankCentavos: number; otherCentavos: number };
    expected: { cashCentavos: number; bankCentavos: number; otherCentavos: number };
    incomeLines: Array<{ category: string; amountCentavos: number }>;
    expenseLines: Array<{ category: string; amountCentavos: number }>;
  };
  entries: Entry[];
  fee: {
    pastDeadline: boolean;
    lateFeesFrom: string | null;
    houses: FeeHouse[];
    chargedCentavos: number;
    paidCentavos: number;
    owedCentavos: number;
    lateFeesCentavos: number;
  };
}

/**
 * Resumen del mes (owner, 19 November 2026). The month looked at most is
 * two months ago (`month`): it is over, past its deadline whatever today is
 * (no Plazo de pago set: the last day, no grace), and the opening balance
 * starts the month before it.
 */
describe("Resumen del mes: a month's money, entries and fee, counted as everywhere else", () => {
  let t: TestApp;
  let treasurer: { cookie: string };
  let president: { cookie: string };
  let secretary: { cookie: string };
  let chlorine: number;
  let idCounter = 801199400000;
  let receiptCounter = 4000;

  const today = businessToday(HONDURAS_TIME_ZONE);
  const thisMonth = firstOfMonth(today);
  const m = (by: number) => addMonths(thisMonth, -by);
  const month = m(2);
  const dayOf = (first: string, day: number) => `${first.slice(0, 8)}${String(day).padStart(2, "0")}`;

  const call = (cookie: string, method: "GET" | "POST", url: string, payload?: object) =>
    t.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
  const summary = async (of: string | null = month) => {
    const response = await call(treasurer.cookie, "GET", of ? `/api/finance/summary/${of}` : "/api/finance/summary");
    assert.equal(response.statusCode, 200, response.body);
    return response.json() as Summary;
  };

  let sectorId: number;
  /** A family typed in from a paper form dated six months ago, so it owes from then; `paper: false` registers it today. */
  const register = async (name: string, paper = true) => {
    const created = await call(secretary.cookie, "POST", "/api/census/households", {
      submissionId: randomUUID(),
      person: { fullName: name, idNumber: String((idCounter += 1)).padStart(13, "0"), phone: "99887766" },
      household: { sectorId, references: "Cerca del tanque", waterConnection: "connected", relation: "owner" },
      fee: { kind: "base" },
      ...(paper ? { paper: { date: dayOf(m(6), 1), formNumber: String(idCounter) } } : {}),
    });
    assert.equal(created.statusCode, 201, created.body);
    return created.json().household as { id: string; code: string };
  };
  const pay = async (householdId: string, months: string[], occurredOn: string, amountCentavos: number) => {
    const response = await call(treasurer.cookie, "POST", "/api/finance/payments", {
      submissionId: randomUUID(),
      householdId,
      months,
      amountCentavos,
      occurredOn,
      paymentMethod: "cash",
      paperReceiptNumber: String((receiptCounter += 1)),
    });
    assert.equal(response.statusCode, 201, response.body);
  };
  const donation = async (amountCentavos: number, paymentMethod: "cash" | "transfer", occurredOn: string) => {
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
    return response.json().entry.id as string;
  };
  const undo = async (id: string) => {
    const response = await call(treasurer.cookie, "POST", `/api/finance/income/${id}/reverse`, { reason: "Se anotó dos veces" });
    assert.equal(response.statusCode, 200, response.body);
  };

  /** Each category's entries add up to its line in the figures: the screen's lists and totals cannot disagree. */
  const assertAddsUp = (data: Summary) => {
    const totals = (kind: Entry["kind"]) => {
      const sums = new Map<string, number>();
      for (const entry of data.entries.filter((e) => e.kind === kind)) {
        sums.set(entry.category, (sums.get(entry.category) ?? 0) + entry.countsCentavos);
      }
      return [...sums].filter(([, amount]) => amount !== 0).sort(([a], [b]) => a.localeCompare(b));
    };
    const lines = (list: Array<{ category: string; amountCentavos: number }>) =>
      list.map((line) => [line.category, line.amountCentavos]).sort(([a], [b]) => String(a).localeCompare(String(b)));
    assert.deepEqual(totals("income"), lines(data.figures.incomeLines), data.month);
    assert.deepEqual(totals("expense"), lines(data.figures.expenseLines), data.month);
  };

  let reversedLater: string;

  before(async () => {
    t = await buildTestApp();
    treasurer = await signedInUser(t, "tesorero", "Tina Tesorera");
    president = await signedInUser(t, "presidente", "Pedro Presidente");
    secretary = await signedInUser(t, "secretario", "Sara Secretaria");
    const admin = await signedInUser(t, "administrador");
    sectorId = (await call(admin.cookie, "POST", "/api/settings/sectors", { name: "El Centro" })).json().sector.id;
    chlorine = t.db.select().from(categories).where(eq(categories.name, "Cloro")).get()!.id;
    await t.db.insert(feeRates).values([
      { kind: "base_monthly", amountCentavos: 7000, startsOn: m(24) },
      { kind: "late_fee", amountCentavos: 5000, startsOn: m(24) },
    ]);
  });
  after(async () => {
    await t.close();
  });

  it("checks finance:view on the server", async () => {
    takeAway(t, "secretario", "finance:view");
    assert.equal((await call(secretary.cookie, "GET", "/api/finance/summary")).statusCode, 403);
    assert.equal((await call(secretary.cookie, "GET", `/api/finance/summary/${month}`)).statusCode, 403);
  });

  it("asks for the opening balance first, then takes only its month up to this one", async () => {
    const none = await call(treasurer.cookie, "GET", "/api/finance/summary");
    assert.equal(none.statusCode, 409);
    assert.match(none.json().message, /Saldo de la junta/);

    const opened = await call(treasurer.cookie, "POST", "/api/finance/opening-balance", { month: m(3), cashCentavos: 100000, bankCentavos: 500000 });
    assert.equal(opened.statusCode, 200, opened.body);
    assert.equal((await call(president.cookie, "POST", "/api/settings/late-fees", { month: m(3) })).statusCode, 200);

    assert.equal((await call(treasurer.cookie, "GET", `/api/finance/summary/${m(4)}`)).statusCode, 400);
    assert.equal((await call(treasurer.cookie, "GET", `/api/finance/summary/${addMonths(thisMonth, 1)}`)).statusCode, 400);
    assert.equal((await call(treasurer.cookie, "GET", "/api/finance/summary/2026-13-01")).statusCode, 400);
    assert.equal((await call(treasurer.cookie, "GET", `/api/finance/summary/${dayOf(month, 15)}`)).statusCode, 400);

    const current = await summary(null);
    assert.equal(current.month, thisMonth);
    assert.equal(current.openingMonth, m(3));
    assert.equal(current.status, "open");
  });

  it("lists who was charged the month's fee, who paid it, in full or in part, and who still owes it with its late fee", async () => {
    const ana = await register("ana lópez");
    const bruno = await register("bruno díaz");
    const carla = await register("carla ruiz");
    const diego = await register("diego paz");
    const gloria = await register("gloria mejía");
    const fabio = await register("fabio sol");
    await register("elena gil", false);

    await pay(ana.id, [month], dayOf(month, 5), 7000); // on time
    await pay(bruno.id, [month], dayOf(month, 10), 3000); // part of it
    // carla: nothing
    await pay(diego.id, [m(3), month], dayOf(m(3), 20), 14000); // ahead, the month before
    await pay(gloria.id, [month], dayOf(m(1), 5), 7000); // in full, after its deadline
    const off = await call(president.cookie, "POST", `/api/census/households/${fabio.id}/deactivate`, { reason: "moved_away", since: dayOf(month, 1) });
    assert.equal(off.statusCode, 200, off.body);

    const { fee } = await summary();
    assert.equal(fee.pastDeadline, true);
    assert.equal(fee.lateFeesFrom, m(3));
    // By name. Fabio had no water service on the deadline, and Elena owes only from this month: neither was charged.
    assert.deepEqual(
      fee.houses.map((house) => [house.ownerName, house.priceCentavos, house.paidCentavos, house.lateFeeCentavos]),
      [
        ["Ana López", 7000, 7000, 0],
        ["Bruno Díaz", 7000, 3000, 5000],
        ["Carla Ruiz", 7000, 0, 5000],
        ["Diego Paz", 7000, 7000, 0],
        ["Gloria Mejía", 7000, 7000, 5000],
      ],
    );
    assert.equal(fee.chargedCentavos, 35000);
    assert.equal(fee.paidCentavos, 24000);
    assert.equal(fee.owedCentavos, 11000);
    assert.equal(fee.lateFeesCentavos, 15000);

    // The same as Quién debe says of the same houses.
    const arrears = (await call(treasurer.cookie, "GET", "/api/finance/arrears")).json() as {
      households: Array<{ code: string; months: Array<{ month: string; owedCentavos: number; lateFeeCentavos: number }> }>;
    };
    for (const house of fee.houses) {
      const listed = arrears.households.find((row) => row.code === house.code)?.months.find((row) => row.month === month);
      assert.equal(listed?.owedCentavos ?? 0, house.priceCentavos - house.paidCentavos, house.ownerName);
      assert.equal(listed?.lateFeeCentavos ?? 0, house.lateFeeCentavos, house.ownerName);
    }
  });

  it("lists every entry dated in the month, from whom or to whom, and adds up to the month close's figures", async () => {
    await donation(20000, "transfer", dayOf(month, 12));
    const spent = await call(treasurer.cookie, "POST", "/api/finance/expenses", {
      submissionId: randomUUID(),
      categoryId: chlorine,
      supplier: "Ferretería El Puente",
      amountCentavos: 5000,
      occurredOn: dayOf(month, 14),
      paymentMethod: "cash",
      noPhotoReason: "Pagado a mano, sin factura",
    });
    assert.equal(spent.statusCode, 201, spent.body);

    const data = await summary();
    assert.deepEqual(
      data.entries.map((entry) => [entry.occurredOn, entry.kind, entry.category, entry.amountCentavos, entry.ownerName ?? entry.payerName ?? entry.supplier]),
      [
        [dayOf(month, 5), "income", "Cuota mensual", 7000, "Ana López"],
        [dayOf(month, 10), "income", "Cuota mensual", 3000, "Bruno Díaz"],
        [dayOf(month, 12), "income", "Donación", 20000, "Iglesia del pueblo"],
        [dayOf(month, 14), "expense", "Cloro", 5000, "Ferretería El Puente"],
      ],
    );
    const expense = data.entries.at(-1)!;
    assert.equal(expense.hasPhoto, false);
    assert.equal(expense.noPhotoReason, "Pagado a mano, sin factura");
    assert.deepEqual(data.entries[0]!.monthsCovered, [month]);

    // Diego's payment ahead counts in the month it was paid, not in this one.
    assert.deepEqual(data.figures.opening, { cashCentavos: 114000, bankCentavos: 500000, otherCentavos: 0 });
    assert.deepEqual(data.figures.income, { cashCentavos: 10000, bankCentavos: 20000, otherCentavos: 0 });
    assert.deepEqual(data.figures.expense, { cashCentavos: 5000, bankCentavos: 0, otherCentavos: 0 });
    assert.deepEqual(data.figures.expected, { cashCentavos: 119000, bankCentavos: 520000, otherCentavos: 0 });
    assertAddsUp(data);
    assertAddsUp(await summary(m(3)));

    // Names and amounts only: never an ID number or a phone.
    const raw = (await call(treasurer.cookie, "GET", `/api/finance/summary/${month}`)).body;
    assert.doesNotMatch(raw, /99887766|8011994/);
  });

  it("marks an entry undone later, and shows its reversal in the month it was made, so each month still adds up", async () => {
    reversedLater = await donation(1500, "cash", dayOf(m(1), 8));
    await undo(reversedLater);
    const sameMonth = await donation(2000, "cash", today);
    await undo(sameMonth);

    // Last month: the donation counted then, and says when it was undone.
    const last = await summary(m(1));
    const undone = last.entries.find((entry) => entry.id === reversedLater)!;
    assert.equal(undone.reversedOn, today);
    assert.equal(undone.reversalReason, "Se anotó dos veces");
    assert.equal(undone.countsCentavos, 1500);
    assertAddsUp(last);

    // This month: the reversal of last month's donation takes it off; today's donation and its reversal cancel out.
    const current = await summary(thisMonth);
    const reversal = current.entries.find((entry) => entry.undoesOn === dayOf(m(1), 8))!;
    assert.equal(reversal.amountCentavos, -1500);
    assert.equal(reversal.countsCentavos, -1500);
    assert.equal(reversal.payerName, "Iglesia del pueblo");
    assert.equal(reversal.paymentMethod, "cash");
    const cancelled = current.entries.find((entry) => entry.id === sameMonth)!;
    assert.equal(cancelled.countsCentavos, 0);
    assert.equal(current.entries.filter((entry) => entry.kind === "income").length, 2);
    assertAddsUp(current);
    assert.equal(current.figures.income.cashCentavos, -1500);

    // Before its deadline nobody is late yet: no late fee for the month in progress.
    assert.equal(current.fee.pastDeadline, false);
    assert.equal(current.fee.lateFeesCentavos, 0);
    assert.ok(current.fee.houses.some((house) => house.ownerName === "Elena Gil"));
    assert.ok(!current.fee.houses.some((house) => house.ownerName === "Fabio Sol"));
  });
});
