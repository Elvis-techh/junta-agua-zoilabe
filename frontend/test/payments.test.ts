import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { homeButtons, routeOf } from "../src/home.ts";
import type { MonthState } from "../src/payments.ts";
import { choosable, monthList, owedFor, sharePayment, statusLine } from "../src/payments.ts";
import { MonthGrid } from "../src/screens/Collect.tsx";

const month = (m: string, price: number | null = 7000, paid = 0): MonthState => ({ month: m, priceCentavos: price, paidCentavos: paid });

describe("Cobrar's months", () => {
  it("say what each one still owes, in words", () => {
    assert.equal(statusLine(month("2026-10-01")), "L 70.00");
    assert.equal(statusLine(month("2026-10-01", 7000, 3000)), "Faltan L 40.00");
    assert.equal(statusLine(month("2026-10-01", 7000, 7000)), "Pagado");
    assert.equal(statusLine(month("2026-10-01", 0)), "No se cobra");
    assert.equal(statusLine(month("2026-10-01", null)), "Sin cuota");
  });

  it("can be chosen only while something is left to pay", () => {
    assert.equal(choosable(month("2026-10-01")), true);
    assert.equal(choosable(month("2026-10-01", 7000, 3000)), true);
    assert.equal(choosable(month("2026-10-01", 7000, 7000)), false);
    assert.equal(choosable(month("2026-10-01", 0)), false);
    assert.equal(choosable(month("2026-10-01", null)), false);
    assert.equal(owedFor([month("2026-10-01", 7000, 3000), month("2026-11-01")]), 11000);
  });

  it("show paid months as an answer, not as a button to press", () => {
    const html = renderToStaticMarkup(
      createElement(MonthGrid, {
        states: [month("2026-12-01", 7000, 7000), month("2027-01-01")],
        selected: ["2027-01-01"],
        thisMonth: "2026-12-01",
        onToggle: () => undefined,
      }),
    );
    assert.match(html, /<h2[^>]*>2026<\/h2>.*<h2[^>]*>2027<\/h2>/s);
    assert.match(html, /disabled=""[^>]*aria-label="diciembre de 2026: Pagado"/);
    assert.match(html, /aria-pressed="true"[^>]*aria-label="enero de 2027: L 70.00"/);
    assert.match(html, /Diciembre \(este mes\)/);
  });
});

describe("sharing a payment on the phone, before it is sent", () => {
  it("fills the oldest chosen month first, as the server will", () => {
    assert.deepEqual(sharePayment([month("2026-11-01"), month("2026-10-01")], 10000), {
      shares: [
        { month: "2026-10-01", amountCentavos: 7000, leftCentavos: 0 },
        { month: "2026-11-01", amountCentavos: 3000, leftCentavos: 4000 },
      ],
    });
  });

  it("says what to change when the amount does not fit", () => {
    const over = sharePayment([month("2026-10-01")], 10000);
    assert.equal("problem" in over && over.problem, "Ese mes debe L 70.00, y el pago es de L 100.00. Elija más meses o revise el monto.");
    const short = sharePayment([month("2026-10-01"), month("2026-11-01")], 5000);
    assert.equal("problem" in short && short.problem, "Con L 50.00 se alcanza solo hasta octubre de 2026. Quite noviembre de 2026 o revise el monto.");
    const none = sharePayment([month("2026-10-01")], null);
    assert.match("problem" in none ? none.problem : "", /Escriba el monto/);
  });

  it("names months the way a person says them", () => {
    assert.equal(monthList(["2026-12-01", "2027-01-01", "2027-02-01"]), "diciembre de 2026, enero y febrero de 2027");
  });
});

describe("Cobrar's place in the app", () => {
  it("opens from the treasurer's Cobrar button, and its addresses are known", () => {
    const cobrar = homeButtons("tesorero", ["finance:record"]).find((b) => b.label === "Cobrar");
    assert.equal(cobrar?.route, "/finanzas/cobrar");
    assert.equal(homeButtons("tesorero", []).some((b) => b.label === "Cobrar"), false);
    assert.equal(routeOf("/finanzas/cobrar"), "/finanzas/cobrar");
    const house = "/finanzas/cobrar/0b7e1a52-4c1e-4f7a-9a43-2f9d7e4c1b20";
    assert.equal(routeOf(house), house);
    assert.equal(routeOf("/finanzas/cobrar/../usuarios"), "/");
  });
});

describe("a payment's card on the household's file", () => {
  it("says how much went to each month, so a payment that finishes a month never reads as partial", async () => {
    const { PaymentCard } = await import("../src/screens/Household.tsx");
    const html = renderToStaticMarkup(
      createElement(PaymentCard, {
        payment: {
          id: "p1",
          occurredOn: "2026-11-05",
          amountCentavos: 4000,
          paymentMethod: "cash",
          bankReference: null,
          paperReceiptNumber: "1235",
          payerName: "María López",
          note: null,
          recordedBy: "Tina Tesorera",
          createdAt: "2026-11-05T20:00:00.000Z",
          reversed: false,
          reversal: null,
          repeatedReceipt: false,
          shares: [{ month: "2026-12-01", amountCentavos: 4000, priceCentavos: 7000 }],
        },
      }),
    );
    assert.match(html, /Diciembre 2026: L 40\.00/);
    assert.doesNotMatch(html, /en parte|repetido/);
  });

  const paid = {
    id: "p2",
    occurredOn: "2026-11-05",
    amountCentavos: 7000,
    paymentMethod: "cash" as const,
    bankReference: null,
    paperReceiptNumber: "1236",
    payerName: "María López",
    note: null,
    recordedBy: "Tina Tesorera",
    createdAt: "2026-11-05T20:00:00.000Z",
    reversed: false,
    reversal: null,
    repeatedReceipt: true,
    shares: [{ month: "2026-11-01", amountCentavos: 7000, priceCentavos: 7000 }],
  };

  it("offers Anular pago only to a role that may reverse, and only on a payment not yet reversed", async () => {
    const { PaymentCard } = await import("../src/screens/Household.tsx");
    const withButton = renderToStaticMarkup(createElement(PaymentCard, { payment: paid, onReverse: () => undefined }));
    assert.match(withButton, /Anular pago/);
    const withoutPermission = renderToStaticMarkup(createElement(PaymentCard, { payment: paid }));
    assert.doesNotMatch(withoutPermission, /Anular pago/);
  });

  it("shows a reversed payment as Anulado, with when, who and why, and no repeated-receipt warning", async () => {
    const { PaymentCard } = await import("../src/screens/Household.tsx");
    const html = renderToStaticMarkup(
      createElement(PaymentCard, {
        payment: {
          ...paid,
          reversed: true,
          reversal: {
            id: "r1",
            occurredOn: "2026-11-07",
            reason: "Se registró en la vivienda equivocada",
            recordedBy: "Pablo Presidente",
            createdAt: "2026-11-07T16:00:00.000Z",
          },
        },
        onReverse: () => undefined,
      }),
    );
    assert.match(html, /Anulado el 7 de noviembre de 2026 por Pablo Presidente: Se registró en la vivienda equivocada/);
    assert.doesNotMatch(html, /Anular pago|repetido/);
  });
});
