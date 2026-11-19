import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { COLLECT_KINDS, byOwnerName, collectTarget } from "../src/collect.ts";
import { otherButtons, routeOf } from "../src/home.ts";
import { INCOME_TYPES, incomeSteps, stepCount } from "../src/income.ts";

const HOUSE = "0b7e1a52-4c1e-4f7a-9a43-2f9d7e4c1b20";

describe("Cobrar: what is being paid (owner, 19 November 2026)", () => {
  it("offers the monthly fee first, then every kind of other income", () => {
    assert.equal(COLLECT_KINDS[0]?.kind, "fee");
    assert.deepEqual(
      COLLECT_KINDS.slice(1).map((choice) => choice.label),
      Object.values(INCOME_TYPES),
    );
  });

  it("sends the monthly fee to the months screen, and anything else to Otro ingreso already answered", () => {
    assert.deepEqual(collectTarget("fee", HOUSE), { route: `/finanzas/cobrar/${HOUSE}` });
    assert.deepEqual(collectTarget("reconnection", HOUSE), {
      route: `/finanzas/ingreso/${HOUSE}`,
      preset: { incomeType: "reconnection", fromCollect: true },
    });
    for (const { kind } of COLLECT_KINDS) {
      const { route } = collectTarget(kind, HOUSE);
      assert.equal(routeOf(route), route, kind);
    }
  });

  it("lists the census by name, the way Spanish sorts", () => {
    const rows = [
      { ownerName: "Óscar Mejía", code: "Z-0003" },
      { ownerName: "ana López", code: "Z-0002" },
      { ownerName: "Ángel Cruz", code: "Z-0001" },
      { ownerName: "Ana López", code: "Z-0004" },
      { ownerName: "Ñeco Paz", code: "Z-0005" },
      { ownerName: "Nora Díaz", code: "Z-0006" },
    ];
    assert.deepEqual(
      byOwnerName(rows).map((row) => row.code),
      ["Z-0002", "Z-0004", "Z-0001", "Z-0006", "Z-0005", "Z-0003"],
    );
  });

  it("does not ask again what Cobrar already asked", () => {
    assert.deepEqual(incomeSteps({ askType: false, houseChosen: true, type: "late_fee" }), ["month", "amount", "receipt", "payer", "review"]);
    assert.deepEqual(incomeSteps({ askType: false, houseChosen: true, type: "donation" }), ["amount", "receipt", "payer", "review"]);
    // From Inicio, as before: what it is, then the house.
    assert.deepEqual(incomeSteps({ askType: true, houseChosen: false, type: "connection" }), [
      "type",
      "house",
      "amount",
      "receipt",
      "payer",
      "review",
    ]);
  });

  it("counts the steps the same with or without the question of what it is", () => {
    const fromCollect = incomeSteps({ askType: false, houseChosen: true, type: "late_fee" });
    assert.deepEqual(stepCount(fromCollect, "month"), { at: 1, of: 4 });
    assert.deepEqual(stepCount(fromCollect, "payer"), { at: 4, of: 4 });
    assert.equal(stepCount(fromCollect, "review"), null);
    const fromHome = incomeSteps({ askType: true, houseChosen: false, type: "other" });
    assert.equal(stepCount(fromHome, "type"), null);
    assert.deepEqual(stepCount(fromHome, "house"), { at: 1, of: 4 });
  });

  it("keeps Otro ingreso on Inicio, for money from outside the census", () => {
    const others = otherButtons("tesorero", ["finance:record", "finance:view", "census:view"]);
    assert.equal(others.find((button) => button.label === "Otro ingreso")?.route, "/finanzas/ingreso");
  });
});
