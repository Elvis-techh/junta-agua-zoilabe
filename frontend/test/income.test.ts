import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { routeOf } from "../src/home.ts";
import type { IncomeEntry, IncomeSetup } from "../src/income.ts";
import { amountProblem, configuredAmount, describeIncome, incomeTitle, needsHouse, rateOn } from "../src/income.ts";
import { IncomeCard } from "../src/screens/Income.tsx";

const setup: IncomeSetup = {
  today: "2026-11-14",
  lateFee: [
    { startsOn: "2026-01-01", amountCentavos: 6000 },
    { startsOn: "2024-01-01", amountCentavos: 5000 },
  ],
  reconnection: [{ startsOn: "2026-11-01", amountCentavos: 25000 }],
  connection: [{ startsOn: "2026-06-01", amountCentavos: 150000 }],
};

describe("Otro ingreso's amounts from Configuración", () => {
  it("take the amount in force for the late fee's month, and for the reconnection's day", () => {
    assert.equal(rateOn(setup.lateFee, "2025-12-01"), 5000);
    assert.equal(rateOn(setup.lateFee, "2026-01-01"), 6000);
    assert.equal(rateOn(setup.lateFee, "2023-12-01"), null);
    assert.equal(configuredAmount(setup, "late_fee", "2025-06-01", "2026-11-14"), 5000);
    assert.equal(configuredAmount(setup, "reconnection", "", "2026-11-14"), 25000);
    assert.equal(configuredAmount(setup, "reconnection", "", "2026-10-31"), null);
  });

  it("take the connection fee of the day it is paid (owner, 14 November 2026)", () => {
    assert.equal(configuredAmount(setup, "connection", "", "2026-11-14"), 150000);
    assert.equal(configuredAmount(setup, "connection", "", "2026-05-31"), null);
  });

  it("have nothing to say about a donation or other income", () => {
    assert.equal(configuredAmount(setup, "donation", "", "2026-11-14"), undefined);
    assert.equal(configuredAmount(setup, "other", "", "2026-11-14"), undefined);
    assert.equal(needsHouse("late_fee"), true);
    assert.equal(needsHouse("reconnection"), true);
    assert.equal(needsHouse("donation"), false);
  });
});

describe("Otro ingreso's amount screen", () => {
  const answers = {
    type: "late_fee" as const,
    amountCentavos: 5000,
    occurredOn: "2026-11-14",
    today: "2026-11-14",
    configured: 5000 as number | null | undefined,
    amountReason: "",
    note: "",
    what: "la mora de octubre de 2025",
  };

  it("goes on at Configuración's amount", () => {
    assert.equal(amountProblem(answers), null);
  });

  it("asks why for another amount, as the server does", () => {
    assert.equal(
      amountProblem({ ...answers, amountCentavos: 3000 }),
      "La mora de octubre de 2025 es de L 50.00 en Configuración. Si se cobró otro monto, escriba por qué.",
    );
    assert.equal(amountProblem({ ...answers, amountCentavos: 3000, amountReason: "El cuaderno dice L 30" }), null);
  });

  it("says when Configuración has no amount, or does not charge it", () => {
    assert.match(amountProblem({ ...answers, configured: null }) ?? "", /Configuración → Cuotas/);
    assert.match(amountProblem({ ...answers, configured: 0 }) ?? "", /no se cobra/);
  });

  it("asks what other income is for, and refuses a date after today", () => {
    const other = { ...answers, type: "other" as const, configured: undefined, what: "el ingreso" };
    assert.equal(amountProblem(other), "Escriba de qué es el ingreso.");
    assert.equal(amountProblem({ ...other, note: "Venta de tubo" }), null);
    assert.equal(amountProblem({ ...other, note: "Venta de tubo", occurredOn: "2026-11-15" }), "La fecha del pago no puede ser después de hoy.");
  });
});

describe("Otro ingreso's entries", () => {
  it("are named the way the treasurer says them", () => {
    assert.equal(describeIncome("late_fee", "2026-10-01"), "la mora de octubre de 2026");
    assert.equal(incomeTitle("late_fee", "2026-10-01"), "Mora de octubre de 2026");
    assert.equal(incomeTitle("reconnection", null), "Reconexión");
    assert.equal(incomeTitle("other", null), "Otro ingreso");
  });

  const entry: IncomeEntry = {
    id: "e1",
    type: "late_fee",
    householdId: "h1",
    householdCode: "Z-0012",
    occurredOn: "2026-11-10",
    amountCentavos: 3000,
    month: "2026-09-01",
    paymentMethod: "cash",
    bankReference: null,
    paperReceiptNumber: "880",
    payerName: "María López",
    note: null,
    amountReason: "El cuaderno dice L 30",
    recordedBy: "Tina Tesorera",
    createdAt: "2026-11-10T15:00:00.000Z",
    repeatedReceipt: false,
    reversed: true,
    reversal: { id: "r1", occurredOn: "2026-11-12", reason: "Era de otra vivienda", recordedBy: "Pedro", createdAt: "2026-11-12T15:00:00.000Z" },
  };

  it("show a reversed entry with the word, not only a line through it, and offer no second Anular", () => {
    const html = renderToStaticMarkup(createElement(IncomeCard, { entry, showHouse: true, onReverse: () => undefined }));
    assert.match(html, /Mora de septiembre de 2026/);
    assert.match(html, /vivienda Z-0012/);
    assert.match(html, /Anulado el .+ por Pedro: Era de otra vivienda/);
    assert.match(html, /Otro monto que el de Configuración: El cuaderno dice L 30/);
    assert.doesNotMatch(html, /<button/);
  });

  it("have their own addresses, with or without a house", () => {
    assert.equal(routeOf("/finanzas/ingreso"), "/finanzas/ingreso");
    const id = "4b0e1a52-8f3c-4a8e-9d0e-2a7c1f6b9e11";
    assert.equal(routeOf(`/finanzas/ingreso/${id}`), `/finanzas/ingreso/${id}`);
    assert.equal(routeOf("/finanzas/ingreso/otra-cosa"), "/");
  });
});
