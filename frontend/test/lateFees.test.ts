import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { homeButtons, routeOf } from "../src/home.ts";
import type { HouseLateFees } from "../src/payments.ts";
import { lateFeesLine } from "../src/payments.ts";
import type { Arrears } from "../src/screens/Arrears.tsx";
import { arrearsMonthLine, arrearsSummary } from "../src/screens/Arrears.tsx";

const fees = (months: string[], none: HouseLateFees["none"] = null): HouseLateFees => ({
  from: "2026-01-01",
  none,
  months: months.map((month) => ({ month, amountCentavos: 5000 })),
  totalCentavos: months.length * 5000,
});

describe("month-end late fees on the household's file (owner, 14 November 2026)", () => {
  it("say which months' late fees are owed, and how much", () => {
    assert.equal(lateFeesLine(fees(["2026-09-01"])), "Debe la mora de septiembre de 2026: L 50.00.");
    assert.equal(lateFeesLine(fees(["2026-09-01", "2026-10-01"])), "Debe la mora de septiembre y octubre de 2026: L 100.00.");
    assert.equal(
      lateFeesLine(fees(["2026-05-01", "2026-06-01", "2026-07-01", "2026-08-01", "2026-09-01"])),
      "Debe la mora de 5 meses: L 250.00. La más antigua es de mayo de 2026.",
    );
  });

  it("say why an inactive or unconnected house is not charged, and nothing while none is owed or none is set", () => {
    assert.match(lateFeesLine(fees([], "inactive")) ?? "", /inactiva/);
    assert.match(lateFeesLine(fees([], "not_connected")) ?? "", /no tiene conexión/);
    assert.equal(lateFeesLine(fees([])), null);
    assert.equal(lateFeesLine({ from: null, none: "not_set", months: [], totalCentavos: 0 }), null);
  });
});

describe("Quién debe", () => {
  it("says each month's fee left and its late fee in words", () => {
    assert.equal(arrearsMonthLine({ month: "2026-10-01", owedCentavos: 7000, lateFeeCentavos: 5000 }), "Octubre 2026: L 70.00 de cuota y L 50.00 de mora");
    assert.equal(arrearsMonthLine({ month: "2026-03-01", owedCentavos: 7000, lateFeeCentavos: 0 }), "Marzo 2026: L 70.00 de cuota");
    assert.equal(
      arrearsMonthLine({ month: "2026-07-01", owedCentavos: 0, lateFeeCentavos: 5000 }),
      "Julio 2026: solo la mora, L 50.00 (la cuota se pagó tarde)",
    );
  });

  it("sums up how many houses owe and how much", () => {
    const list = (count: number, lateFees: number): Arrears => ({
      today: "2026-11-14",
      lateFeesFrom: "2026-01-01",
      households: Array.from({ length: count }, () => ({}) as Arrears["households"][number]),
      owedCentavos: 21000,
      lateFeesCentavos: lateFees,
      totalCentavos: 21000 + lateFees,
    });
    assert.equal(arrearsSummary(list(0, 0)), "Ninguna vivienda debe.");
    assert.equal(arrearsSummary(list(3, 10000)), "3 viviendas deben L 310.00: L 210.00 de cuotas y L 100.00 de mora.");
    assert.equal(arrearsSummary(list(1, 0)), "1 vivienda debe L 210.00 de cuotas.");
  });

  it("has its own address, and the treasurer's home button opens it", () => {
    assert.equal(routeOf("/finanzas/quien-debe"), "/finanzas/quien-debe");
    const button = homeButtons("tesorero", ["finance:view", "finance:record"]).find((b) => b.label === "Quién debe");
    assert.equal(button?.route, "/finanzas/quien-debe");
    const withoutFinances = homeButtons("tesorero", ["finance:record"]).find((b) => b.label === "Quién debe");
    assert.equal(withoutFinances, undefined);
  });
});
