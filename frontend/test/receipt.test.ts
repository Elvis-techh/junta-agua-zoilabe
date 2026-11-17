import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { Receipt } from "../src/receipt.ts";
import { conceptTitle, receiptFileName, receiptLines, receiptText } from "../src/receipt.ts";
import type { StatementDocument } from "../src/statement.ts";
import { StatementCard } from "../src/screens/Statement.tsx";

const base: Receipt = {
  today: "2026-11-16",
  transactionId: "5f0c2a5e-0000-4000-8000-000000000001",
  household: { code: "Z-0012", ownerName: "Rosa Martínez", sectorName: "El Centro" },
  payerName: "Rosa Martínez",
  occurredOn: "2026-10-10",
  amountCentavos: 14000,
  paymentMethod: "cash",
  bankReference: null,
  paperReceiptNumber: "7001",
  concept: { kind: "monthly", months: ["2026-09-01", "2026-10-01"] },
};
const document: StatementDocument = { number: 13, madeAt: "2026-11-16T20:05:00.000Z", madeBy: "Tina Tesorera" };

describe("a receipt's concept line", () => {
  it("names a monthly fee by its months, and other income by its kind, note or month", () => {
    assert.equal(conceptTitle({ kind: "monthly", months: ["2026-10-01"] }), "Cuota de octubre de 2026");
    assert.equal(conceptTitle({ kind: "monthly", months: ["2026-09-01", "2026-10-01"] }), "Cuota de septiembre y octubre de 2026");
    assert.equal(conceptTitle({ kind: "other", type: "late_fee", month: "2026-05-01", note: null }), "Mora de mayo de 2026");
    assert.equal(conceptTitle({ kind: "other", type: "reconnection", month: null, note: null }), "Reconexión");
    assert.equal(conceptTitle({ kind: "other", type: "other", month: null, note: "Venta de tubo sobrante" }), "Venta de tubo sobrante");
  });
});

describe("a receipt's lines", () => {
  it("say the board, the house, who paid, the concept with its amount, date, method and paper receipt", () => {
    assert.deepEqual(
      receiptLines(base, null).map((line) => [line.kind, line.text, line.amount ?? "", line.sub ?? ""]),
      [
        ["title", "Junta de Agua de Zoilabe", "", ""],
        ["heading", "Recibo", "", ""],
        ["text", "Vivienda Z-0012 · El Centro", "", ""],
        ["text", "Recibí de Rosa Martínez", "", ""],
        ["total", "Cuota de septiembre y octubre de 2026", "L 140.00", "10 de octubre de 2026 · Efectivo · recibo de papel nº 7001"],
      ],
    );
  });

  it("carry the number and who made it once handed out, and show a transfer's reference", () => {
    const transfer: Receipt = { ...base, paymentMethod: "transfer", bankReference: "TRX-9", household: null, payerName: "Junta vecina" };
    const lines = receiptLines(transfer, document);
    assert.equal(lines[1]!.text, "Recibo nº 13");
    // No house line when there is no household.
    assert.ok(!lines.some((line) => line.text.startsWith("Vivienda")));
    assert.equal(lines.find((line) => line.kind === "text" && line.text.startsWith("Recibí"))!.text, "Recibí de Junta vecina");
    assert.match(lines.find((line) => line.kind === "total")!.sub!, /· Transferencia, referencia TRX-9 · recibo de papel nº 7001$/);
    assert.equal(lines.at(-1)!.text, "Hecho por Tina Tesorera · Documento nº 13");
  });
});

describe("a receipt as a WhatsApp text and a file name", () => {
  it("writes the lines as plain text, headings and totals in bold", () => {
    const text = receiptText(base, document);
    assert.match(text, /^\*Junta de Agua de Zoilabe\*\n\n\*Recibo nº 13\*\nVivienda Z-0012 · El Centro\nRecibí de Rosa Martínez\n\*Cuota de septiembre y octubre de 2026: L 140\.00\*/);
    assert.match(text, /\n\nHecho por Tina Tesorera · Documento nº 13$/);
  });

  it("names the picture after the house and the document, or 'ingreso' with no house", () => {
    assert.equal(receiptFileName(base, document), "recibo-Z-0012-n13.png");
    assert.equal(receiptFileName({ ...base, household: null }, document), "recibo-ingreso-n13.png");
  });
});

describe("a receipt on the screen", () => {
  it("shows the concept and its amount", () => {
    const html = renderToStaticMarkup(createElement(StatementCard, { lines: receiptLines(base, null) }));
    assert.match(html, /Recibí de Rosa Martínez/);
    assert.match(html, /Cuota de septiembre y octubre de 2026<\/span><span style="white-space:nowrap">L 140\.00/);
    assert.match(html, /10 de octubre de 2026 · Efectivo · recibo de papel nº 7001/);
  });
});
