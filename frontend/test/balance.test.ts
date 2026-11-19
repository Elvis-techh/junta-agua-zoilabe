import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { MoneyNow } from "../src/balance.ts";
import { BALANCE_WHOLE_DIGITS, amountText, moneyLines, openingLine, readFigures } from "../src/balance.ts";
import { formatAmountTyping, parseLempiras } from "../src/census.ts";
import { homeButtons, otherButtons, routeOf } from "../src/home.ts";

const money: MoneyNow = {
  cashCentavos: 255500,
  bankCentavos: 999000,
  otherCentavos: 0,
  since: "2026-11-01",
  incomeCentavos: 13000,
  expenseCentavos: 5500,
};

describe("Saldo de la junta", () => {
  it("reads the month and both amounts, 0 included, and says what is missing first", () => {
    assert.deepEqual(readFigures({ month: "2026-10", cash: "2,500", bank: "0" }, "2026-11-01"), {
      month: "2026-10-01",
      cashCentavos: 250000,
      bankCentavos: 0,
    });
    assert.match((readFigures({ month: "", cash: "1", bank: "1" }, "2026-11-01") as { problem: string }).problem, /Elija el mes/);
    assert.match((readFigures({ month: "2026-12", cash: "1", bank: "1" }, "2026-11-01") as { problem: string }).problem, /todavía no llega/);
    assert.match((readFigures({ month: "2026-11", cash: "", bank: "1" }, "2026-11-01") as { problem: string }).problem, /efectivo/);
    assert.match((readFigures({ month: "2026-11", cash: "1", bank: "" }, "2026-11-01") as { problem: string }).problem, /banco/);
  });

  it("takes cash and bank bigger than any fee or payment, up to L 999,999,999.99", () => {
    assert.deepEqual(readFigures({ month: "2026-10", cash: "1,250,000.50", bank: "999,999,999.99" }, "2026-11-01"), {
      month: "2026-10-01",
      cashCentavos: 125000050,
      bankCentavos: 99999999999,
    });
    assert.equal(formatAmountTyping("1250000", BALANCE_WHOLE_DIGITS), "1,250,000");
    assert.equal(formatAmountTyping("12345678901", BALANCE_WHOLE_DIGITS), "123,456,789");
    assert.equal(amountText(250_000_000), "2,500,000");
    // The other amount fields still stop at L 99,999.99.
    assert.equal(formatAmountTyping("1250000"), "12,500");
    assert.equal(parseLempiras("1,250,000"), null);
  });

  it("shows cash and bank, and the Otro line only when something was paid that way", () => {
    assert.deepEqual(moneyLines(money), [
      { label: "En caja", amount: "L 2,555.00" },
      { label: "En el banco", amount: "L 9,990.00" },
    ]);
    assert.deepEqual(moneyLines({ ...money, otherCentavos: 3000 }).at(-1), { label: "Pagado con «Otro»", amount: "L 30.00" });
    assert.equal(moneyLines({ ...money, cashCentavos: -500 })[0]!.amount, "-L 5.00");
  });

  it("says the opening balance in the village's words", () => {
    assert.equal(
      openingLine({ id: "x", month: "2026-10-01", cashCentavos: 250000, bankCentavos: 1000000 }),
      "Al empezar octubre de 2026: efectivo L 2,500.00, banco L 10,000.00",
    );
  });

  it("puts a saved amount back into the field so it reads the same", () => {
    for (const centavos of [0, 5, 250000, 1234567, 99]) {
      assert.equal(parseLempiras(amountText(centavos)), centavos);
    }
    assert.equal(amountText(250000), "2,500");
    assert.equal(amountText(250050), "2,500.50");
  });

  it("opens from Inicio for whoever may see finances", () => {
    assert.equal(routeOf("/finanzas/saldo"), "/finanzas/saldo");
    const labels = (permissions: string[]) =>
      [...homeButtons("tesorero", permissions), ...otherButtons("tesorero", permissions)].map((b) => b.label);
    assert.ok(labels(["finance:view"]).includes("Saldo de la junta"));
    assert.ok(!labels([]).includes("Saldo de la junta"));
  });
});
