import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { HouseOwed, MonthState } from "../src/payments.ts";
import { dueSoonLine, owedSince, owedSummary } from "../src/payments.ts";
import { deadlineExample } from "../src/screens/SettingsDeadline.tsx";

const month = (m: string, paid = 0): MonthState => ({ month: m, priceCentavos: 7000, paidCentavos: paid });

const owed = (months: MonthState[], because: "first_payment" | "registered" = "first_payment", from = "2025-03-01"): HouseOwed => ({
  today: "2026-11-13",
  thisMonth: "2026-11-01",
  owesFrom: { month: from, because },
  deadline: { dueDay: 31, graceDays: 0 },
  months,
  dueSoon: [],
  totalCentavos: months.reduce((sum, state) => sum + state.priceCentavos! - state.paidCentavos, 0),
});

describe("what a house owes, in words (owner, 13 November 2026)", () => {
  it("says when it owes nothing", () => {
    assert.equal(owedSummary(owed([])), "Al día: no debe ningún mes.");
  });

  it("says the month, or up to four months, in the village's words, with what is left of them", () => {
    assert.equal(owedSummary(owed([month("2026-10-01")])), "Debe el mes de octubre de 2026 (L 70.00).");
    assert.equal(
      owedSummary(owed([month("2026-09-01"), month("2026-10-01", 3000)])),
      "Debe los meses de septiembre y octubre de 2026 (L 110.00).",
    );
  });

  it("counts more than four months, and names the oldest", () => {
    const many = ["2025-04-01", "2026-06-01", "2026-07-01", "2026-08-01", "2026-09-01"].map((m) => month(m));
    assert.equal(owedSummary(owed(many)), "Debe 5 meses (L 350.00). El más antiguo es abril de 2025.");
  });

  it("says until when a month still within its deadline can be paid", () => {
    assert.equal(
      dueSoonLine({ month: "2026-11-01", dueOn: "2026-11-25", lateAfter: "2026-11-30" }),
      "Noviembre de 2026 se paga hasta el 25 de noviembre; si no, cuenta como debido desde el 1 de diciembre.",
    );
    assert.equal(
      deadlineExample("2026-11-13", { dueDay: 31, graceDays: 0 }),
      "Noviembre de 2026 se paga hasta el 30 de noviembre; si no, cuenta como debido desde el 1 de diciembre.",
    );
    assert.equal(
      deadlineExample("2026-12-02", { dueDay: 25, graceDays: 10 }),
      "Diciembre de 2026 se paga hasta el 25 de diciembre; si no, cuenta como debido desde el 5 de enero.",
    );
  });

  it("says where the count starts, and how to move it back", () => {
    assert.equal(owedSince(owed([])), "Se cuenta desde marzo de 2025, su primer pago anotado.");
    assert.equal(
      owedSince(owed([], "registered", "2026-11-01")),
      "Se cuenta desde noviembre de 2026, cuando se registró. Si tiene pagos de antes, anótelos en Cobrar con su fecha.",
    );
  });
});
