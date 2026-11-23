import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { monthStatementFileName, monthStatementLines, monthStatementText } from "../src/monthStatement.ts";
import type { MonthSummary } from "../src/monthSummary.ts";
import { routeOf } from "../src/home.ts";
import { summaryRoute } from "../src/monthSummary.ts";

const money = (cashCentavos: number, bankCentavos: number, otherCentavos = 0) => ({ cashCentavos, bankCentavos, otherCentavos });

const october: MonthSummary = {
  month: "2026-10-01",
  today: "2026-11-19",
  thisMonth: "2026-11-01",
  openingMonth: "2026-08-01",
  status: "closed",
  figures: {
    month: "2026-10-01",
    opening: money(114000, 500000),
    income: money(10000, 20000),
    expense: money(5000, 0),
    expected: money(119000, 520000),
    incomeLines: [
      { category: "Donación", amountCentavos: 20000 },
      { category: "Cuota mensual", amountCentavos: 10000 },
    ],
    expenseLines: [{ category: "Cloro", amountCentavos: 5000 }],
  },
  entries: [
    entry("income", "Cuota mensual", 7000, 7000, { householdCode: "Z-0001", ownerName: "Ana López" }),
    entry("income", "Cuota mensual", 3000, 3000, { householdCode: "Z-0002", ownerName: "Bruno Díaz" }),
    entry("income", "Donación", 20000, 20000, { payerName: "Iglesia del pueblo" }),
    entry("income", "Donación", 2000, 0, { payerName: "Iglesia del pueblo" }),
    entry("expense", "Cloro", 5000, 5000, { supplier: "Ferretería El Puente", paperReceiptNumber: "F-77" }),
  ],
  fee: {
    dueOn: "2026-10-31",
    lateAfter: "2026-10-31",
    pastDeadline: true,
    lateFeesFrom: "2026-08-01",
    houses: [
      { id: "1", code: "Z-0001", ownerName: "Ana López", sectorName: null, priceCentavos: 7000, paidCentavos: 7000, lateFeeCentavos: 0 },
      { id: "2", code: "Z-0002", ownerName: "Bruno Díaz", sectorName: null, priceCentavos: 7000, paidCentavos: 3000, lateFeeCentavos: 5000 },
    ],
    chargedCentavos: 14000,
    paidCentavos: 10000,
    owedCentavos: 4000,
    lateFeesCentavos: 5000,
  },
};

function entry(kind: "income" | "expense", category: string, amountCentavos: number, countsCentavos: number, over: object): MonthSummary["entries"][number] {
  return {
    id: crypto.randomUUID(),
    kind,
    category,
    occurredOn: "2026-10-05",
    amountCentavos,
    countsCentavos,
    paymentMethod: "cash",
    householdId: null,
    householdCode: null,
    ownerName: null,
    payerName: null,
    supplier: null,
    monthsCovered: null,
    paperReceiptNumber: null,
    note: null,
    hasPhoto: false,
    noPhotoReason: null,
    recordedBy: "Tina Tesorera",
    reversedOn: null,
    reversalReason: null,
    undoesOn: null,
    ...over,
  };
}

const document = { number: 14, madeAt: "2026-11-19T20:05:00.000Z", madeBy: "Tina Tesorera" };

describe("Estado financiero del mes", () => {
  it("is Resumen del mes drawn as lines: the money, what came in, what was spent and the fee", () => {
    const lines = monthStatementLines(october, document);
    assert.deepEqual(
      lines.filter((line) => line.kind === "heading").map((line) => line.text),
      ["Estado financiero nº 14", "El dinero", "Lo que entró", "Lo que se gastó", "Cuota de octubre de 2026"],
    );
    const rows = lines.filter((line) => line.kind === "row" || line.kind === "total").map((line) => [line.text, line.amount]);
    assert.deepEqual(rows, [
      ["Al empezar el mes", "L 6,140.00"],
      ["Entró", "+ L 300.00"],
      ["Salió", "− L 50.00"],
      ["Al terminar el mes", "L 6,390.00"],
      ["Donación", "L 200.00"],
      ["Cuota mensual", "L 100.00"],
      ["Total que entró", "L 300.00"],
      ["Cloro: Ferretería El Puente", "L 50.00"],
      ["Total que se gastó", "L 50.00"],
    ]);
    // Where the money is, and how many entries make a category.
    assert.equal(lines.find((line) => line.text === "Al terminar el mes")?.sub, "Caja L 1,190.00 · Banco L 5,200.00");
    assert.equal(lines.find((line) => line.text === "Cuota mensual")?.sub, "2 anotaciones");
    assert.equal(lines.find((line) => line.text === "Donación")?.sub, "1 anotación");
    assert.equal(lines.find((line) => line.text === "Cloro: Ferretería El Puente")?.sub, "5 de octubre · factura nº F-77");
  });

  it("is numbered and signed once it was handed out, and not before", () => {
    const made = monthStatementLines(october, document);
    assert.equal(made.at(-1)?.kind, "small");
    assert.match(made.at(-1)!.text, /^Hecho por Tina Tesorera el 19 de noviembre de 2026(,| a las) 2:05 p\. m\. · Documento nº 14$/);
    const preview = monthStatementLines(october, null);
    assert.equal(preview.find((line) => line.kind === "heading")?.text, "Estado financiero del mes");
    assert.ok(!preview.some((line) => /Hecho por|Documento nº/.test(line.text)));
  });

  it("says whether the month may still change", () => {
    const says = (summary: MonthSummary) => monthStatementLines(summary, null).find((line) => line.kind === "small" && line.text.includes("cifras"))?.text;
    assert.equal(says(october), "Cerrado: las cifras ya no cambian.");
    assert.equal(says({ ...october, status: "open" }), "Sin cerrar: las cifras pueden cambiar.");
    assert.equal(says({ ...october, status: "prepared" }), "Cierre por aprobar: las cifras pueden cambiar.");
    assert.equal(says({ ...october, month: "2026-11-01", status: "open" }), "Mes en curso: las cifras son de hoy y pueden cambiar.");
  });

  it("gives totals of who owes, never their names or house codes: the board has not decided that", () => {
    const text = monthStatementText(october, document);
    assert.match(text, /Falta cobrar: L 40\.00 de cuota y L 50\.00 de mora/);
    assert.doesNotMatch(text, /Ana López|Bruno Díaz|Z-000/);
  });

  it("reads the same on the screen, in the picture and as WhatsApp text", () => {
    const text = monthStatementText(october, document);
    assert.match(text, /^\*Junta de Agua de Zoilabe\*\n\n\*Estado financiero nº 14\*\nOctubre de 2026/);
    assert.match(text, /\*Total que entró: L 300\.00\*/);
    assert.match(text, /• Cloro: Ferretería El Puente: L 50\.00 \(5 de octubre · factura nº F-77\)/);
  });

  it("names the picture after the month and its number", () => {
    assert.equal(monthStatementFileName(october, document), "estado-financiero-2026-10-n14.png");
  });

  it("has an address of its own, a part of the month's summary", () => {
    assert.equal(summaryRoute("2026-10-01", "documento"), "/finanzas/resumen/2026-10-01/documento");
    assert.equal(routeOf("/finanzas/resumen/2026-10-01/documento"), "/finanzas/resumen/2026-10-01/documento");
    assert.equal(routeOf("/finanzas/resumen/2026-10-01/otra"), "/");
  });
});
