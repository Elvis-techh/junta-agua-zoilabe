import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { StatusEntry } from "../src/census.ts";
import { entryOn, noServiceLine, statusEntryLine } from "../src/census.ts";
import { homeButtons, routeOf } from "../src/home.ts";
import type { HouseLateFees } from "../src/payments.ts";
import { lateFeesLine } from "../src/payments.ts";
import type { Arrears } from "../src/screens/Arrears.tsx";
import { arrearsMark, arrearsMonthLine, arrearsSummary } from "../src/screens/Arrears.tsx";

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

  it("say nothing while none is owed or Configuración → Mora has no month", () => {
    assert.equal(lateFeesLine(fees([])), null);
    assert.equal(lateFeesLine({ from: null, none: "not_set", months: [], totalCentavos: 0 }), null);
  });
});

describe("a house's status history on its file (owner, 14 November 2026)", () => {
  const entry = (id: number, startsOn: string, status: StatusEntry["status"] = "active", waterConnection: StatusEntry["waterConnection"] = "connected"): StatusEntry => ({
    id,
    status,
    inactiveReason: status === "inactive" ? "moved_away" : null,
    waterConnection,
    startsOn,
    createdAt: "2026-11-14T15:00:00.000Z",
    createdBy: "Pedro",
  });

  it("takes the newest entry whose date is not after the day, as the server does", () => {
    // Newest entry first: registered 1 November, then entered: without water since March.
    const history = [entry(2, "2026-03-01", "active", "not_connected"), entry(1, "2026-11-01")];
    assert.equal(entryOn(history, "2026-11-14")!.id, 2);
    assert.equal(entryOn(history, "2026-02-01")!.id, 1);
  });

  it("says under Lo que debe since when a house without service is not charged", () => {
    assert.equal(
      noServiceLine([entry(2, "2025-02-01", "inactive"), entry(1, "2024-01-10")], "2026-11-14"),
      "Está inactiva desde el 1 de febrero de 2025: no se cobran sus meses desde entonces, ni su mora.",
    );
    assert.match(noServiceLine([entry(1, "2026-03-01", "active", "not_connected")], "2026-11-14") ?? "", /^No tiene conexión desde el 1 de marzo de 2026/);
    assert.equal(noServiceLine([entry(1, "2024-01-10", "active", "shared")], "2026-11-14"), null);
  });

  it("says each entry in the village's words", () => {
    assert.equal(statusEntryLine(entry(1, "2025-02-01", "inactive")), "Inactiva (Se mudó), conectada");
    assert.equal(statusEntryLine(entry(1, "2025-02-01", "active", "not_connected")), "Activa, sin conexión");
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

  it("marks a house that owes but has no service today (owner, 19 November 2026)", () => {
    assert.equal(arrearsMark({ status: "active", waterConnection: "connected" }), null);
    assert.equal(arrearsMark({ status: "active", waterConnection: "shared" }), null);
    assert.equal(arrearsMark({ status: "active", waterConnection: "not_connected" }), "Sin conexión");
    assert.equal(arrearsMark({ status: "inactive", waterConnection: "connected" }), "Inactiva");
    assert.equal(arrearsMark({ status: "inactive", waterConnection: "not_connected" }), "Inactiva, sin conexión");
  });

  it("has its own address, and the treasurer's home button opens it", () => {
    assert.equal(routeOf("/finanzas/quien-debe"), "/finanzas/quien-debe");
    const button = homeButtons("tesorero", ["finance:view", "finance:record"]).find((b) => b.label === "Quién debe");
    assert.equal(button?.route, "/finanzas/quien-debe");
    const withoutFinances = homeButtons("tesorero", ["finance:record"]).find((b) => b.label === "Quién debe");
    assert.equal(withoutFinances, undefined);
  });
});
