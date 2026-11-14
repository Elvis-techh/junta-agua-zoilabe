import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { HouseOwed, MonthState } from "../src/payments.ts";
import { owedSince, owedSummary } from "../src/payments.ts";

const month = (m: string, paid = 0): MonthState => ({ month: m, priceCentavos: 7000, paidCentavos: paid });

const owed = (months: MonthState[], because: "first_payment" | "registered" = "first_payment", from = "2025-03-01"): HouseOwed => ({
  today: "2026-11-13",
  thisMonth: "2026-11-01",
  owesFrom: { month: from, because },
  months,
  totalCentavos: months.reduce((sum, state) => sum + state.priceCentavos! - state.paidCentavos, 0),
});

describe("what a house owes, in words (owner, 13 November 2026)", () => {
  it("says when it owes nothing", () => {
    assert.equal(owedSummary(owed([])), "Al día: no debe ningún mes.");
  });

  it("names up to four months, with what is left of them", () => {
    assert.equal(
      owedSummary(owed([month("2026-10-01"), month("2026-11-01", 3000)])),
      "Debe L 110.00: octubre y noviembre de 2026.",
    );
  });

  it("counts more than four months, and names the oldest", () => {
    const many = ["2025-04-01", "2026-07-01", "2026-08-01", "2026-09-01", "2026-10-01"].map((m) => month(m));
    assert.equal(owedSummary(owed(many)), "Debe L 350.00 de 5 meses. El más antiguo es abril de 2025.");
  });

  it("says where the count starts, and how to move it back", () => {
    assert.equal(owedSince(owed([])), "Se cuenta desde marzo de 2025, su primer pago anotado.");
    assert.equal(
      owedSince(owed([], "registered", "2026-11-01")),
      "Se cuenta desde noviembre de 2026, cuando se registró. Si tiene pagos de antes, anótelos en Cobrar con su fecha.",
    );
  });
});
