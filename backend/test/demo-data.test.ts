import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { fillWithMadeUpData } from "../src/lib/demoData.js";
import { firstOfMonth } from "../src/lib/fees.js";
import { addMonths } from "../src/lib/payments.js";
import { HONDURAS_TIME_ZONE, businessToday } from "../src/lib/time.js";
import type { TestApp } from "./helpers.js";
import { buildTestApp, signedInUser } from "./helpers.js";

/** The made-up data of the test copy: it must go in through the rules, and every month must add up. */
describe("Made-up data for the test copy", () => {
  let t: TestApp;
  let cookie: string;
  const today = businessToday(HONDURAS_TIME_ZONE);
  const thisMonth = firstOfMonth(today);

  const get = async (url: string) => {
    const response = await t.app.inject({ method: "GET", url: `/api${url}`, headers: { cookie } });
    assert.equal(response.statusCode, 200, response.body);
    return response.json();
  };

  before(async () => {
    t = await buildTestApp();
    cookie = (await signedInUser(t, "administrador")).cookie;
  });
  after(async () => {
    await t.close();
  });

  it("fills three months back and this one, and every month's entries add up to its figures", async () => {
    const result = await fillWithMadeUpData(t.app, cookie, today);
    assert.equal(result.households, 11);
    assert.deepEqual(result.months, [-3, -2, -1, 0].map((by) => addMonths(thisMonth, by)));

    const current = await get("/finance/summary");
    assert.equal(current.openingMonth, addMonths(thisMonth, -3));
    for (const by of [3, 2, 1, 0]) {
      const month = addMonths(thisMonth, -by);
      const data = await get(`/finance/summary/${month}`);
      assert.ok(data.entries.length > 0, month);
      for (const kind of ["income", "expense"] as const) {
        const sums = new Map<string, number>();
        for (const entry of data.entries.filter((e: { kind: string }) => e.kind === kind)) {
          sums.set(entry.category, (sums.get(entry.category) ?? 0) + entry.countsCentavos);
        }
        const lines = data.figures[`${kind}Lines`] as Array<{ category: string; amountCentavos: number }>;
        assert.deepEqual(
          [...sums].filter(([, amount]) => amount !== 0).sort(),
          lines.map((line) => [line.category, line.amountCentavos]).sort(),
          `${month} ${kind}`,
        );
      }
    }
  });

  it("leaves families that owe, and two mistakes undone: one in its own month, one from an earlier month", async () => {
    const arrears = await get("/finance/arrears");
    assert.ok(arrears.households.length >= 4);
    const entries = (await get(`/finance/summary/${thisMonth}`)).entries as Array<{ undoesOn: string | null; reversedOn: string | null }>;
    assert.equal(entries.filter((entry) => entry.reversedOn).length, 1);
    assert.equal(entries.filter((entry) => entry.undoesOn).length, 1);
  });

  it("leaves one house for Verificación del censo, from last year's paper form, that owes nothing from before the fee was set", async () => {
    const list = await get("/census/verification");
    const names = list.unverified.map((house: { ownerName: string }) => house.ownerName);
    // From January to March the others' paper forms, three months back, are from last year too.
    assert.ok(names.includes("Marta Reyes"), names.join(", "));
    assert.ok(thisMonth.slice(5, 7) <= "03" || names.length === 1, names.join(", "));
    const arrears = await get("/finance/arrears");
    assert.ok(!arrears.households.some((house: { ownerName: string }) => house.ownerName === "Marta Reyes"));
  });
});
