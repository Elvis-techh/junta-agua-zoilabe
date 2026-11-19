import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { homeButtons, otherButtons, routeOf } from "../src/home.ts";
import type { MonthFigures } from "../src/monthClose.ts";
import { categoryLines, columnAmount, differenceLine, figureRows, monthShort, monthTitle, readCount, statusWords } from "../src/monthClose.ts";

const money = (cashCentavos: number, bankCentavos: number, otherCentavos = 0) => ({ cashCentavos, bankCentavos, otherCentavos });

const figures: MonthFigures = {
  month: "2026-08-01",
  opening: money(100000, 500000),
  income: money(20000, 30000),
  expense: money(5000, 0),
  expected: money(115000, 530000),
  incomeLines: [
    { category: "Donación", amountCentavos: 30000 },
    { category: "Cuota mensual", amountCentavos: 20000 },
  ],
  expenseLines: [{ category: "Cloro", amountCentavos: 5000 }],
};

describe("Cierre del mes", () => {
  it("shows Caja and Banco side by side, and Otro only when something was paid that way", () => {
    const { rows, showOther } = figureRows(figures);
    assert.equal(showOther, false);
    assert.deepEqual(
      rows.map((row) => [row.label, row.cash, row.bank]),
      [
        ["Al empezar", "1,000.00", "5,000.00"],
        ["Entró", "200.00", "300.00"],
        ["Salió", "50.00", "0.00"],
        ["Debe haber", "1,150.00", "5,300.00"],
      ],
    );
    assert.equal(figureRows({ ...figures, income: money(20000, 30000, 1500) }).showOther, true);
    // The columns are headed "(L)", so the amounts leave it out; a negative one keeps its sign.
    assert.equal(columnAmount(15000000), "150,000.00");
    assert.equal(columnAmount(-5000), "-50.00");
  });

  it("says what each category added up to, what came in first", () => {
    assert.deepEqual(categoryLines(figures), ["Entró: Donación L 300.00", "Entró: Cuota mensual L 200.00", "Salió: Cloro L 50.00"]);
  });

  it("says whether the cash counted matches, in the board's words", () => {
    assert.equal(differenceLine(115000, 115000), "Cuadra con lo que la aplicación espera.");
    assert.equal(differenceLine(110000, 115000), "Faltante de caja: L 50.00");
    assert.equal(differenceLine(117000, 115000), "Sobrante de caja: L 20.00");
  });

  it("asks for a reason only when the count does not match", () => {
    assert.deepEqual(readCount("1,150", "", 115000), { cashCountedCentavos: 115000, expectedCashCentavos: 115000 });
    assert.deepEqual(readCount("", "", 115000), { problem: "Escriba el efectivo que se contó en caja, o 0 si no hay." });
    assert.deepEqual(readCount("1,100", "  ", 115000), { problem: "No cuadra con lo que la aplicación espera. Escriba por qué." });
    assert.deepEqual(readCount("1,100", " Faltó un billete ", 115000), {
      cashCountedCentavos: 110000,
      expectedCashCentavos: 115000,
      reason: "Faltó un billete",
    });
  });

  it("names a month and its status", () => {
    assert.equal(monthTitle("2026-08-01"), "Agosto de 2026");
    assert.equal(monthShort("2026-08-01"), "Agosto 2026");
    assert.equal(statusWords("open"), "Cierre abierto");
    assert.equal(statusWords("prepared"), "Cierre por aprobar");
    assert.equal(statusWords("closed"), "Cerrado");
  });

  it("has its own address, and a closed month has one too", () => {
    assert.equal(routeOf("/finanzas/cierre"), "/finanzas/cierre");
    assert.equal(routeOf("/finanzas/cierre/2026-08-01"), "/finanzas/cierre/2026-08-01");
    assert.equal(routeOf("/finanzas/cierre/2026-13-01"), "/");
    assert.equal(routeOf("/finanzas/cierre/2026-08-15"), "/");
  });

  it("is Preparar cierre for the treasurer, Aprobar cierre for the president, and Cierre del mes for everyone else, once", () => {
    const all = ["finance:view", "finance:record", "month:prepare", "month:approve"];
    const treasurer = homeButtons("tesorero", all).find((button) => button.route === "/finanzas/cierre");
    assert.equal(treasurer?.label, "Preparar cierre");
    const president = homeButtons("presidente", all).find((button) => button.route === "/finanzas/cierre");
    assert.equal(president?.label, "Aprobar cierre");
    assert.equal(otherButtons("tesorero", all).filter((button) => button.route === "/finanzas/cierre").length, 0);
    const secretary = otherButtons("secretario", all).filter((button) => button.route === "/finanzas/cierre");
    assert.deepEqual(
      secretary.map((button) => button.label),
      ["Cierre del mes"],
    );
    assert.equal(otherButtons("secretario", ["census:view"]).some((button) => button.route === "/finanzas/cierre"), false);
  });
});
