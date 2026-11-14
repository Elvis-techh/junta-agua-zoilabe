import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { routeOf } from "../src/home.ts";
import type { OwedEntry, OwedOption } from "../src/owed.ts";
import { lastOwedYear, optionChoosable, optionLine, owedSummary, owedTotals } from "../src/owed.ts";
import type { MonthState } from "../src/payments.ts";
import { choosable, owedFor, sharePayment, statusLine } from "../src/payments.ts";
import { MonthGrid } from "../src/screens/Collect.tsx";

const option = (overrides: Partial<OwedOption> = {}): OwedOption => ({
  month: "2024-03-01",
  priceCentavos: 7000,
  lateFeeCentavos: 2000,
  entered: false,
  enteredWithLateFee: false,
  paidCentavos: 0,
  ...overrides,
});

const entry = (overrides: Partial<OwedEntry> = {}): OwedEntry => ({
  id: "e1",
  month: "2024-03-01",
  priceCentavos: 7000,
  lateFeeCentavos: null,
  paidCentavos: 0,
  recordedBy: "Tina",
  createdAt: "2026-11-13T18:00:00.000Z",
  ...overrides,
});

describe("the grid where old months are tapped", () => {
  it("goes up to the last year with months before the start month", () => {
    assert.equal(lastOwedYear("2026-12-01"), 2026);
    assert.equal(lastOwedYear("2027-01-01"), 2026);
  });

  it("says what each month would cost, or why it cannot be tapped", () => {
    assert.equal(optionLine(option()), "L 70.00");
    assert.equal(optionLine(option({ entered: true })), "Ya anotado");
    assert.equal(optionLine(option({ paidCentavos: 3000 })), "Tiene pagos");
    assert.equal(optionLine(option({ priceCentavos: null })), "Sin cuota");
    assert.equal(optionLine(option({ priceCentavos: 0 })), "No se cobra");
  });

  it("lets only a month with a price, not entered and not paid, be tapped", () => {
    assert.equal(optionChoosable(option()), true);
    assert.equal(optionChoosable(option({ entered: true })), false);
    assert.equal(optionChoosable(option({ paidCentavos: 3000 })), false);
    assert.equal(optionChoosable(option({ priceCentavos: null })), false);
    assert.equal(optionChoosable(option({ priceCentavos: 0 })), false);
  });
});

describe("what a house still owes from before the start month", () => {
  it("adds the fees not yet paid, and the late fees apart", () => {
    const entries = [
      entry({ lateFeeCentavos: 2000 }),
      entry({ id: "e2", month: "2024-04-01", paidCentavos: 3000 }),
      entry({ id: "e3", month: "2024-05-01", paidCentavos: 7000 }),
    ];
    assert.deepEqual(owedTotals(entries), { feesCentavos: 11000, lateFeesCentavos: 2000 });
    assert.equal(owedSummary(entries), "Debe L 110.00 de cuotas anteriores, más L 20.00 de mora.");
  });

  it("says so when the old fees are paid", () => {
    assert.equal(owedSummary([entry({ paidCentavos: 7000 })]), "Las cuotas anteriores están pagadas.");
    assert.equal(
      owedSummary([entry({ paidCentavos: 7000, lateFeeCentavos: 2000 })]),
      "Las cuotas anteriores están pagadas. Queda L 20.00 de mora.",
    );
  });
});

describe("Cobrar with a start month (owner, 13 November 2026)", () => {
  const notOwed: MonthState = { month: "2026-10-01", priceCentavos: 8000, paidCentavos: 0, beforeStart: true, owed: null };
  const owed: MonthState = { month: "2024-03-01", priceCentavos: 7000, paidCentavos: 0, beforeStart: true, owed: { id: "e1", lateFeeCentavos: null } };

  it("offers a month before the start month only if it was entered as owed", () => {
    assert.equal(statusLine(notOwed), "No debe");
    assert.equal(choosable(notOwed), false);
    assert.equal(statusLine(owed), "L 70.00");
    assert.equal(choosable(owed), true);
    assert.equal(owedFor([owed]), 7000);
    assert.ok("problem" in sharePayment([notOwed], 8000));
  });

  it("does not offer one paid in part before the start month was set, unless it was entered", () => {
    const partly = { ...notOwed, paidCentavos: 3000 };
    assert.equal(statusLine(partly), "Faltan L 50.00");
    assert.equal(choosable(partly), false);
  });

  it("shows a month not owed as an answer, not as a button to press", () => {
    const html = renderToStaticMarkup(
      createElement(MonthGrid, { states: [notOwed, owed], selected: [], thisMonth: "2026-11-01", onToggle: () => undefined }),
    );
    assert.match(html, /disabled="" aria-label="octubre de 2026: No debe"/);
    assert.doesNotMatch(html, /disabled="" aria-label="marzo de 2024/);
  });
});

describe("the address of Anotar deuda anterior", () => {
  it("opens for a house, and not for anything else", () => {
    const id = "0b6c1f0e-5f7a-4f43-9d6e-2f1d3c4b5a69";
    assert.equal(routeOf(`/finanzas/deuda/${id}`), `/finanzas/deuda/${id}`);
    assert.equal(routeOf("/finanzas/deuda/otra-cosa"), "/");
  });
});
