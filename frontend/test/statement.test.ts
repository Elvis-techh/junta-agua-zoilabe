import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { routeOf } from "../src/home.ts";
import type { Statement, StatementDocument } from "../src/statement.ts";
import { statementFileName, statementLines, statementText, statementWhatsappLink } from "../src/statement.ts";
import { wrapText } from "../src/statementImage.ts";
import { StatementCard } from "../src/screens/Statement.tsx";

const statement: Statement = {
  today: "2026-11-15",
  from: "2026-01-01",
  household: { id: "5f0c2a5e-0000-4000-8000-000000000001", code: "Z-0012", ownerName: "Rosa Martínez", sectorName: "El Centro" },
  payments: [
    { id: "p1", occurredOn: "2026-06-10", amountCentavos: 14000, paperReceiptNumber: "7001", months: ["2026-06-01", "2026-07-01"] },
    { id: "p2", occurredOn: "2026-08-12", amountCentavos: 3000, paperReceiptNumber: "7002", months: ["2026-08-01"] },
  ],
  otherIncome: [
    { id: "i1", type: "late_fee", occurredOn: "2026-07-02", amountCentavos: 5000, paperReceiptNumber: "7003", month: "2026-05-01", note: null },
    { id: "i2", type: "other", occurredOn: "2026-09-01", amountCentavos: 2000, paperReceiptNumber: null, month: null, note: "Venta de tubo sobrante" },
  ],
  paidCentavos: 24000,
  owed: {
    months: [
      { month: "2026-08-01", owedCentavos: 4000 },
      { month: "2026-09-01", owedCentavos: 7000 },
    ],
    lateFees: [{ month: "2026-09-01", amountCentavos: 5000 }],
    monthsCentavos: 11000,
    lateFeesCentavos: 5000,
    totalCentavos: 16000,
  },
};
const document: StatementDocument = { number: 12, madeAt: "2026-11-15T20:05:00.000Z", madeBy: "Tina Tesorera" };
const upToDate: Statement = {
  ...statement,
  payments: [],
  otherIncome: [],
  paidCentavos: 0,
  owed: { months: [], lateFees: [], monthsCentavos: 0, lateFeesCentavos: 0, totalCentavos: 0 },
};

describe("a statement's lines", () => {
  it("say whose it is, what was paid oldest first whatever it was for, and what is owed", () => {
    const lines = statementLines(statement, null);
    assert.deepEqual(
      lines.map((line) => [line.kind, line.text, line.amount ?? "", line.sub ?? ""]),
      [
        ["title", "Junta de Agua de Zoilabe", "", ""],
        ["heading", "Estado de cuenta", "", ""],
        ["text", "Vivienda Z-0012 · El Centro", "", ""],
        ["text", "Rosa Martínez", "", ""],
        ["small", "Al 15 de noviembre de 2026", "", ""],
        ["heading", "Pagos desde enero de 2026", "", ""],
        ["row", "Cuota de junio y julio de 2026", "L 140.00", "10 de junio de 2026 · recibo nº 7001"],
        ["row", "Mora de mayo de 2026", "L 50.00", "2 de julio de 2026 · recibo nº 7003"],
        ["row", "Cuota de agosto de 2026", "L 30.00", "12 de agosto de 2026 · recibo nº 7002"],
        ["row", "Venta de tubo sobrante", "L 20.00", "1 de septiembre de 2026"],
        ["total", "Total pagado", "L 240.00", ""],
        ["heading", "Lo que debe hoy", "", ""],
        ["row", "Cuota de agosto de 2026", "L 40.00", ""],
        ["row", "Cuota de septiembre de 2026", "L 70.00", ""],
        ["row", "Mora de septiembre de 2026", "L 50.00", ""],
        ["total", "Total que debe", "L 160.00", ""],
      ],
    );
  });

  it("carry the document number, who made it and when, once it is handed out", () => {
    const lines = statementLines(statement, document);
    assert.equal(lines[1]!.text, "Estado de cuenta nº 12");
    assert.equal(lines.at(-1)!.kind, "small");
    assert.match(lines.at(-1)!.text, /^Hecho por Tina Tesorera el 15 de noviembre de 2026.{1,8}2:05\sp\.\sm\. · Documento nº 12$/);
  });

  it("say so plainly when nothing was paid in the period and nothing is owed", () => {
    const texts = statementLines(upToDate, null).map((line) => line.text);
    assert.ok(texts.includes("No hay pagos anotados desde enero de 2026."));
    assert.ok(texts.includes("Está al día: no debe nada."));
    assert.ok(!texts.includes("Total pagado"));
    assert.ok(!texts.includes("Total que debe"));
  });
});

describe("a statement as a WhatsApp text", () => {
  it("says the same as the picture, in plain lines", () => {
    const text = statementText(statement, document);
    assert.match(text, /^\*Junta de Agua de Zoilabe\*\n\n\*Estado de cuenta nº 12\*\nVivienda Z-0012 · El Centro\nRosa Martínez\nAl 15 de noviembre de 2026\n/);
    assert.match(text, /\n• Cuota de junio y julio de 2026: L 140\.00 \(10 de junio de 2026 · recibo nº 7001\)\n/);
    assert.match(text, /\n\*Total pagado: L 240\.00\*\n\n\*Lo que debe hoy\*\n• Cuota de agosto de 2026: L 40\.00\n/);
    assert.match(text, /\n\*Total que debe: L 160\.00\*\n\nHecho por Tina Tesorera el .+ · Documento nº 12$/);
  });

  it("goes to the family's chat, and to nobody when the number is hidden or missing", () => {
    assert.equal(statementWhatsappLink("+50499887766", "Hola: L 70"), "https://wa.me/50499887766?text=Hola%3A%20L%2070");
    assert.equal(statementWhatsappLink("••••••66", "Hola"), null);
    assert.equal(statementWhatsappLink(null, "Hola"), null);
  });

  it("names the picture after the house and the document", () => {
    assert.equal(statementFileName(statement, document), "estado-de-cuenta-Z-0012-n12.png");
  });
});

describe("the statement's picture", () => {
  it("breaks a long line between words, to the width it has", () => {
    const measure = (text: string) => text.length * 10;
    assert.deepEqual(wrapText("Cuota de junio y julio de 2026", 150, measure), ["Cuota de junio", "y julio de 2026"]);
    assert.deepEqual(wrapText("Corta", 150, measure), ["Corta"]);
    assert.deepEqual(wrapText("Supercalifragilístico y más", 100, measure), ["Supercalifragilístico", "y más"]);
    assert.deepEqual(wrapText("", 100, measure), [""]);
  });
});

describe("the statement on the screen", () => {
  it("shows every line, with amounts that do not break", () => {
    const html = renderToStaticMarkup(createElement(StatementCard, { lines: statementLines(statement, null) }));
    assert.match(html, /Pagos desde enero de 2026/);
    assert.match(html, /Cuota de junio y julio de 2026<\/span><span style="white-space:nowrap">L 140\.00/);
    assert.match(html, /10 de junio de 2026 · recibo nº 7001/);
    assert.match(html, /Total que debe<\/span><span style="white-space:nowrap">L 160\.00/);
  });

  it("has its own address for each house", () => {
    const route = "/finanzas/estado/5f0c2a5e-0000-4000-8000-000000000001";
    assert.equal(routeOf(route), route);
    assert.equal(routeOf("/finanzas/estado/nada"), "/");
  });
});
