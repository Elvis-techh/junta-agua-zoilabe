import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { FeeHouse, FeeSummary, MonthSummary, SummaryEntry } from "../src/monthSummary.ts";
import {
  dayName,
  entryDetails,
  entryGroups,
  entryWhat,
  entryWho,
  feeCardLines,
  feeGroups,
  feeHouseLine,
  feeLines,
  houseOwes,
  moneyLines,
  monthWords,
  placesLine,
  summaryMonths,
  summaryRoute,
  summaryStatus,
  undoneLine,
} from "../src/monthSummary.ts";

const money = (cashCentavos: number, bankCentavos: number, otherCentavos = 0) => ({ cashCentavos, bankCentavos, otherCentavos });

const entry = (over: Partial<SummaryEntry>): SummaryEntry => ({
  id: crypto.randomUUID(),
  kind: "income",
  category: "Cuota mensual",
  occurredOn: "2026-10-05",
  amountCentavos: 7000,
  countsCentavos: 7000,
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
});

const house = (ownerName: string, paidCentavos: number, lateFeeCentavos = 0): FeeHouse => ({
  id: crypto.randomUUID(),
  code: "Z-0001",
  ownerName,
  sectorName: "El Centro",
  priceCentavos: 7000,
  paidCentavos,
  lateFeeCentavos,
});

const fee = (houses: FeeHouse[], pastDeadline = true): FeeSummary => ({
  dueOn: "2026-10-31",
  lateAfter: "2026-10-31",
  pastDeadline,
  lateFeesFrom: "2026-08-01",
  houses,
  chargedCentavos: houses.reduce((sum, h) => sum + h.priceCentavos, 0),
  paidCentavos: houses.reduce((sum, h) => sum + Math.min(h.paidCentavos, h.priceCentavos), 0),
  owedCentavos: houses.reduce((sum, h) => sum + Math.max(h.priceCentavos - h.paidCentavos, 0), 0),
  lateFeesCentavos: houses.reduce((sum, h) => sum + h.lateFeeCentavos, 0),
});

const october: MonthSummary = {
  month: "2026-10-01",
  today: "2026-11-19",
  thisMonth: "2026-11-01",
  openingMonth: "2026-08-01",
  status: "open",
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
    entry({ householdCode: "Z-0001", ownerName: "Ana López", monthsCovered: ["2026-10-01"], paperReceiptNumber: "4001" }),
    entry({ amountCentavos: 3000, countsCentavos: 3000, householdCode: "Z-0002", ownerName: "Bruno Díaz", monthsCovered: ["2026-10-01"] }),
    entry({ category: "Donación", amountCentavos: 20000, countsCentavos: 20000, payerName: "Iglesia del pueblo", paymentMethod: "transfer" }),
    entry({ category: "Donación", amountCentavos: 2000, countsCentavos: 0, payerName: "Iglesia del pueblo", reversedOn: "2026-10-20", reversalReason: "Se anotó dos veces" }),
    entry({ kind: "expense", category: "Cloro", amountCentavos: 5000, countsCentavos: 5000, supplier: "Ferretería El Puente", noPhotoReason: "Sin factura" }),
  ],
  fee: fee([house("Ana López", 7000), house("Bruno Díaz", 3000, 5000), house("Carla Ruiz", 0, 5000), house("Gloria Mejía", 7000, 5000)]),
};

describe("Resumen del mes", () => {
  it("shows the month's money, the box, the bank and Otro together, and what is left", () => {
    assert.deepEqual(moneyLines(october), [
      { label: "Al empezar el mes", amount: "L 6,140.00" },
      { label: "Entró", amount: "+ L 300.00" },
      { label: "Salió", amount: "− L 50.00" },
      { label: "Al terminar el mes", amount: "L 6,390.00" },
    ]);
    assert.equal(moneyLines({ ...october, month: "2026-11-01" })[3]!.label, "Hay ahora");
    assert.equal(placesLine(october.figures.expected), "Caja L 1,190.00 · Banco L 5,200.00");
    assert.equal(placesLine(money(100, 200, -50)), "Caja L 1.00 · Banco L 2.00 · Otro -L 0.50");
  });

  it("says where the month's close stands, and does not call the month in progress unclosed", () => {
    assert.deepEqual(summaryStatus(october), { words: "Sin cerrar", tone: "warn" });
    assert.deepEqual(summaryStatus({ ...october, status: "prepared" }), { words: "Cierre por aprobar", tone: "warn" });
    assert.deepEqual(summaryStatus({ ...october, status: "closed" }), { words: "Cerrado", tone: "ok" });
    assert.deepEqual(summaryStatus({ ...october, month: "2026-11-01" }), { words: "Mes en curso", tone: "ok" });
  });

  it("offers every month from this one back to the opening balance's, and names a month briefly in titles", () => {
    assert.deepEqual(summaryMonths(october), ["2026-11-01", "2026-10-01", "2026-09-01", "2026-08-01"]);
    assert.deepEqual(summaryMonths({ openingMonth: "2026-12-01", thisMonth: "2027-01-01" }), ["2027-01-01", "2026-12-01"]);
    assert.deepEqual(summaryMonths({ openingMonth: "2026-11-01", thisMonth: "2026-11-01" }), ["2026-11-01"]);
    assert.equal(monthWords("2026-10-01", "2026-11-01"), "octubre");
    assert.equal(monthWords("2025-12-01", "2026-01-01"), "diciembre de 2025");
    assert.equal(summaryRoute("2026-10-01"), "/finanzas/resumen/2026-10-01");
    assert.equal(summaryRoute("2026-10-01", "cuota"), "/finanzas/resumen/2026-10-01/cuota");
  });

  it("puts a house that still owes the fee or its late fee among those who owe, and says how it stands", () => {
    const { owing, upToDate } = feeGroups(october.fee);
    assert.deepEqual(owing.map((h) => h.ownerName), ["Bruno Díaz", "Carla Ruiz", "Gloria Mejía"]);
    assert.deepEqual(upToDate.map((h) => h.ownerName), ["Ana López"]);
    assert.deepEqual(owing.map(houseOwes), [9000, 12000, 5000]);
    assert.deepEqual(
      [...upToDate, ...owing].map((h) => feeHouseLine(h, true)),
      [
        "Pagó L 70.00",
        "Pagó L 30.00 de L 70.00 y debe L 50.00 de mora",
        "No ha pagado la cuota de L 70.00 y debe L 50.00 de mora",
        "Pagó la cuota tarde: falta la mora, L 50.00",
      ],
    );
    assert.equal(feeHouseLine(house("Carla Ruiz", 0), false), "Todavía no paga la cuota de L 70.00");
  });

  it("sums the fee up in a few lines, and before its deadline says until when it is paid", () => {
    assert.deepEqual(feeLines(october.fee, october.month), [
      "Se cobró a 4 casas: L 280.00",
      "1 casa pagó todo",
      "3 casas deben",
      "Falta cobrar: L 110.00 de cuota y L 150.00 de mora",
    ]);
    const november = fee([house("Ana López", 7000), house("Carla Ruiz", 0)], false);
    assert.deepEqual(feeLines({ ...november, lateAfter: "2026-11-30" }, "2026-11-01"), [
      "Se cobró a 2 casas: L 140.00",
      "1 casa pagó todo",
      "1 casa todavía no paga todo",
      "Falta cobrar: L 70.00",
      "Se paga hasta el 30 de noviembre.",
    ]);
    assert.deepEqual(feeLines(fee([]), "2026-10-01"), ["No se cobró la cuota de octubre de 2026 a ninguna casa."]);
  });

  it("puts the fee on the summary in two short lines, before its deadline too", () => {
    assert.deepEqual(feeCardLines(october.fee), ["Pagaron todo: 1 de 4 casas", "Falta cobrar: L 260.00 con mora"]);
    assert.deepEqual(feeCardLines(fee([house("Ana López", 7000)])), ["Pagaron todo: 1 de 1 casa", "No falta nada por cobrar."]);
    assert.deepEqual(feeCardLines({ ...fee([house("Carla Ruiz", 0)], false), lateAfter: "2026-11-30" }), [
      "Pagaron todo: 0 de 1 casa",
      "Falta cobrar: L 70.00",
    ]);
    assert.deepEqual(feeCardLines(fee([])), ["No se cobró a ninguna casa."]);
  });

  it("groups the entries by category, the largest first, each adding up to its line of the figures", () => {
    const income = entryGroups(october, "income");
    assert.deepEqual(
      income.map((group) => [group.category, group.totalCentavos, group.entries.length]),
      [
        ["Donación", 20000, 2],
        ["Cuota mensual", 10000, 2],
      ],
    );
    for (const group of income) {
      assert.equal(group.totalCentavos, october.figures.incomeLines.find((line) => line.category === group.category)!.amountCentavos);
    }
    assert.deepEqual(entryGroups(october, "expense").map((group) => group.category), ["Cloro"]);
    // A category whose only entry was undone the same month goes last.
    const cancelled = entryGroups({ entries: [entry({ category: "Conexión", countsCentavos: 0 }), entry({ category: "Mora", amountCentavos: 50, countsCentavos: 50 })] }, "income");
    assert.deepEqual(cancelled.map((group) => group.category), ["Mora", "Conexión"]);
  });

  it("says who each entry is from or to, what it was for, and when, with its receipt and how it was paid", () => {
    const [ana, , church, , chlorine] = october.entries as [SummaryEntry, SummaryEntry, SummaryEntry, SummaryEntry, SummaryEntry];
    assert.equal(entryWho(ana), "Ana López");
    assert.equal(entryWho(church), "Iglesia del pueblo");
    assert.equal(entryWho(chlorine), "Ferretería El Puente");
    assert.equal(entryWhat(ana), "Cuota de octubre de 2026");
    assert.equal(entryWhat(entry({ monthsCovered: ["2026-09-01", "2026-10-01"] })), "Cuota de septiembre y octubre de 2026");
    assert.equal(entryWhat(entry({ category: "Mora", monthsCovered: ["2026-05-01"] })), "Mora de mayo de 2026");
    assert.equal(entryWhat(entry({ category: "Otro ingreso", note: "Venta de tubos" })), "Venta de tubos");
    assert.equal(entryDetails(ana, october.month), "Z-0001 · 5 de octubre · Recibo nº 4001 · Efectivo");
    assert.equal(entryDetails(church, october.month), "5 de octubre · Transferencia");
    assert.equal(entryDetails(entry({ kind: "expense", paperReceiptNumber: "F-88", paymentMethod: "transfer" }), october.month), "5 de octubre · Factura nº F-88 · Transferencia");
    assert.equal(dayName("2025-12-31", "2026"), "31 de diciembre de 2025");
  });

  it("explains an entry undone in the same month, one undone later, and a reversal of an earlier month's entry", () => {
    assert.equal(undoneLine(october.entries[0]!, october.month), null);
    assert.equal(undoneLine(october.entries[3]!, october.month), "Anulado el 20 de octubre: Se anotó dos veces. No cuenta.");
    assert.equal(
      undoneLine(entry({ reversedOn: "2026-11-03", reversalReason: "Era de otra casa" }), october.month),
      "Anulado el 3 de noviembre: Era de otra casa. Se descuenta en noviembre de 2026.",
    );
    assert.equal(
      undoneLine(entry({ amountCentavos: -1500, countsCentavos: -1500, undoesOn: "2026-09-08", reversalReason: "Se anotó dos veces" }), october.month),
      "Se anuló lo anotado el 8 de septiembre: Se anotó dos veces. Se descuenta este mes.",
    );
  });
});
