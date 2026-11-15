import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { ExpenseEntry } from "../src/expenses.ts";
import { amountProblem, paidProblem, photoAddress, photoProblem } from "../src/expenses.ts";
import { homeButtons, routeOf } from "../src/home.ts";
import { PHOTO_ATTEMPTS, PHOTO_TARGET_BYTES, fitWithin } from "../src/photo.ts";
import { ExpenseCard } from "../src/screens/Expense.tsx";

const entry: ExpenseEntry = {
  id: "5f0c2a5e-0000-4000-8000-000000000001",
  categoryId: 9,
  category: "Cloro",
  supplier: "Ferretería El Puente",
  occurredOn: "2026-11-15",
  amountCentavos: 45000,
  paymentMethod: "cash",
  bankReference: null,
  invoiceNumber: "000-123",
  note: null,
  noPhotoReason: null,
  hasPhoto: true,
  recordedBy: "Tina Tesorera",
  createdAt: "2026-11-15T18:00:00.000Z",
  repeatedInvoice: false,
  reversed: false,
  reversal: null,
};

const card = (overrides: Partial<ExpenseEntry>, handlers: { onPhoto?: () => void; onReverse?: () => void } = {}) =>
  renderToStaticMarkup(createElement(ExpenseCard, { entry: { ...entry, ...overrides }, ...handlers }));

describe("Gasto's checks before anything is sent", () => {
  const answers = { supplier: "ENEE", amountCentavos: 25000, occurredOn: "2026-11-15", today: "2026-11-15", saysWhat: false, note: "" };

  it("ask who was paid, how much and when, and what another expense is", () => {
    assert.equal(amountProblem(answers), null);
    assert.equal(amountProblem({ ...answers, supplier: " " }), "Escriba a quién se le pagó.");
    assert.match(amountProblem({ ...answers, amountCentavos: null })!, /^Escriba el monto que se pagó/);
    assert.match(amountProblem({ ...answers, amountCentavos: 0 })!, /^Escriba el monto que se pagó/);
    assert.equal(amountProblem({ ...answers, occurredOn: "2026-11-16" }), "La fecha del gasto no puede ser después de hoy.");
    assert.equal(amountProblem({ ...answers, saysWhat: true }), "Escriba de qué es el gasto.");
    assert.equal(amountProblem({ ...answers, saysWhat: true, note: "Papelería" }), null);
  });

  it("ask how it was paid, and a transfer's reference", () => {
    assert.equal(paidProblem({ method: null, bankReference: "" }), "Elija cómo se pagó.");
    assert.equal(paidProblem({ method: "transfer", bankReference: " " }), "Escriba el número de referencia de la transferencia.");
    assert.equal(paidProblem({ method: "transfer", bankReference: "TRX-9" }), null);
    assert.equal(paidProblem({ method: "cash", bankReference: "" }), null);
  });

  it("ask for the photo, or for why there is no receipt (owner, 15 November 2026)", () => {
    assert.match(photoProblem({ hasPhoto: false, noReceipt: false, noPhotoReason: "" })!, /^Tome la foto del recibo o la factura/);
    assert.equal(photoProblem({ hasPhoto: false, noReceipt: true, noPhotoReason: "no" }), "Escriba por qué no hay recibo.");
    assert.equal(photoProblem({ hasPhoto: false, noReceipt: true, noPhotoReason: "Jornal pagado a mano" }), null);
    assert.equal(photoProblem({ hasPhoto: true, noReceipt: false, noPhotoReason: "" }), null);
  });
});

describe("a receipt's photo before it is sent", () => {
  it("is brought within a size, never enlarged, with the same shape", () => {
    assert.deepEqual(fitWithin(4000, 3000, 1600), { width: 1600, height: 1200 });
    assert.deepEqual(fitWithin(3000, 4000, 1600), { width: 1200, height: 1600 });
    assert.deepEqual(fitWithin(800, 600, 1600), { width: 800, height: 600 });
    assert.deepEqual(fitWithin(5000, 1, 1000), { width: 1000, height: 1 });
  });

  it("is tried smaller each time, and aims under what the server keeps and Nginx lets through", () => {
    for (let at = 1; at < PHOTO_ATTEMPTS.length; at += 1) {
      assert.ok(PHOTO_ATTEMPTS[at]!.side < PHOTO_ATTEMPTS[at - 1]!.side);
      assert.ok(PHOTO_ATTEMPTS[at]!.quality < PHOTO_ATTEMPTS[at - 1]!.quality);
    }
    // 700,000 bytes is the server's limit (backend/src/lib/receiptPhotos.ts); as base64 with the rest of the answers, under 1 MB.
    assert.ok(PHOTO_TARGET_BYTES < 700_000);
    assert.ok((PHOTO_TARGET_BYTES * 4) / 3 + 5000 < 1024 * 1024);
  });
});

describe("an expense's card", () => {
  it("shows what it was, who was paid, the invoice and who recorded it", () => {
    const html = card({}, { onPhoto: () => undefined, onReverse: () => undefined });
    assert.match(html, /Cloro: <span[^>]*>L 450\.00<\/span>/);
    assert.match(html, /Se le pagó a Ferretería El Puente/);
    assert.match(html, /Factura nº 000-123 · Efectivo · Registró Tina Tesorera/);
    assert.match(html, /Ver la foto/);
    assert.match(html, /Anular/);
    assert.doesNotMatch(html, /Sin foto/);
  });

  it("marks one without a photo, with why, and offers no photo to open", () => {
    const html = card({ hasPhoto: false, noPhotoReason: "Jornal pagado a mano", invoiceNumber: null }, { onPhoto: () => undefined });
    assert.match(html, /Sin foto: Jornal pagado a mano/);
    assert.doesNotMatch(html, /Ver la foto/);
    assert.doesNotMatch(html, /Factura nº/);
  });

  it("marks a repeated invoice number, and a reversed expense with who undid it and why, with no Anular", () => {
    assert.match(card({ repeatedInvoice: true }), /Número de factura repetido: revisar/);
    const html = card(
      {
        reversed: true,
        repeatedInvoice: true,
        reversal: { id: "r", occurredOn: "2026-11-15", reason: "Se registró dos veces", recordedBy: "Pedro", createdAt: "2026-11-15T19:00:00.000Z" },
      },
      { onReverse: () => undefined },
    );
    assert.match(html, /Anulado el 15 de noviembre de 2026 por Pedro: Se registró dos veces/);
    assert.doesNotMatch(html, /repetido/);
    assert.doesNotMatch(html, /<button[^>]*>.*Anular<\/button>/);
  });
});

describe("where Gasto is", () => {
  it("has its own address, on the treasurer's Inicio for those who may record", () => {
    assert.equal(routeOf("/finanzas/gasto"), "/finanzas/gasto");
    assert.equal(homeButtons("tesorero", ["finance:record"]).find((button) => button.label === "Gasto")?.route, "/finanzas/gasto");
    assert.ok(!homeButtons("tesorero", []).some((button) => button.label === "Gasto"));
    assert.equal(photoAddress("abc"), "/api/finance/expenses/abc/photo");
  });
});
