import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { Fee, Rate } from "../src/screens/SettingsFees.tsx";
import { FeeCard, feeFormProblem, removalEffect } from "../src/screens/SettingsFees.tsx";

const rate = (id: number, amountCentavos: number, startsOn: string, correctable = true): Rate => ({
  id,
  amountCentavos,
  startsOn,
  createdAt: "2026-11-03T12:00:00.000Z",
  createdByName: "Ana",
  correctable,
});

const fee: Fee = {
  kind: "base_monthly",
  currentId: 1,
  earliestStart: "2026-11-01",
  rates: [rate(2, 7000, "2027-01-01"), rate(1, 10000, "2026-11-01")],
};

const card = (shown: Fee) =>
  renderToStaticMarkup(
    createElement(FeeCard, { fee: shown, today: "2026-11-03", onEdit: () => undefined, onRemove: () => undefined }),
  );

describe("a fee's card", () => {
  it("calls the change of the whole fee «Cambiar detalles», once it has an amount", () => {
    assert.match(card(fee), /Cambiar detalles/);
    assert.doesNotMatch(card(fee), /Cambiar monto/);
    assert.match(card({ ...fee, rates: [], currentId: null }), /Poner monto/);
  });

  it("boxes each saved amount with its own «Corregir» and «Quitar», and keeps the fee's button outside the boxes", () => {
    const html = card(fee);
    const boxes = html.split('class="rate-box"').slice(1);
    assert.equal(boxes.length, 2);
    for (const box of boxes) {
      assert.match(box, /Corregir/);
      assert.match(box, /Quitar/);
    }
    assert.ok(html.indexOf("Cambiar detalles") > html.lastIndexOf("Quitar"));
  });

  it("says which amount is in use and which has not started, in words", () => {
    const [upcoming, inUse] = card(fee).split('class="rate-box"').slice(1);
    assert.match(upcoming!, /L 70\.00/);
    assert.match(upcoming!, /Todavía no empieza/);
    assert.match(inUse!, /L 100\.00/);
    assert.match(inUse!, /En uso/);
  });

  it("offers no «Corregir» or «Quitar» once a payment has been made at an amount", () => {
    const paid = { ...fee, rates: [rate(1, 10000, "2026-11-01", false)] };
    assert.doesNotMatch(card(paid), /Corregir/);
    assert.doesNotMatch(card(paid), /Quitar/);
  });
});

describe("removing an amount", () => {
  it("says its months go back to the amount before it", () => {
    assert.equal(
      removalEffect(fee, fee.rates[0]!),
      "Desde enero de 2027 vuelve a cobrarse L 100.00, el monto anterior.",
    );
  });

  it("says when its months are left with no amount, and until when", () => {
    assert.equal(removalEffect(fee, fee.rates[1]!), "Desde noviembre de 2026 no habrá monto, hasta que empiece el de enero de 2027.");
    const alone: Fee = { ...fee, rates: [rate(1, 10000, "2026-11-01")] };
    assert.equal(removalEffect(alone, alone.rates[0]!), "Desde noviembre de 2026 no habrá monto.");
  });

  it("names the amount after it, when there is one", () => {
    const three: Fee = { ...fee, rates: [rate(3, 9000, "2027-03-01"), rate(2, 7000, "2027-01-01"), rate(1, 10000, "2026-11-01")] };
    assert.equal(
      removalEffect(three, three.rates[1]!),
      "Desde enero de 2027 vuelve a cobrarse L 100.00, el monto anterior, hasta que empiece el de marzo de 2027.",
    );
  });
});

describe("the fee form, before the PIN is asked for", () => {
  const good = { amountCentavos: 8000, startsOn: "2026-12-01", reason: "" };

  it("accepts a new amount from this month or a later one", () => {
    assert.equal(feeFormProblem({ fee, rate: null }, good), null);
  });

  it("refuses a past month, and a month that already has an amount", () => {
    assert.match(feeFormProblem({ fee, rate: null }, { ...good, startsOn: "2026-10-01" })!, /noviembre de 2026 o después/);
    assert.match(feeFormProblem({ fee, rate: null }, { ...good, startsOn: "2027-01-01" })!, /Ya hay un monto que empieza en enero de 2027/);
  });

  it("lets the first amount start in any month", () => {
    const first: Fee = { ...fee, earliestStart: null, rates: [], currentId: null };
    assert.equal(feeFormProblem({ fee: first, rate: null }, { ...good, startsOn: "2020-01-01" }), null);
  });

  it("asks for a reason when correcting, and not for a free month", () => {
    const editing = { fee, rate: fee.rates[0]! };
    assert.match(feeFormProblem(editing, { ...good, startsOn: "2027-01-01" })!, /por qué se corrige/);
    assert.equal(feeFormProblem(editing, { ...good, startsOn: "2027-01-01", reason: "Se escribió mal" }), null);
  });

  it("asks for an amount first", () => {
    assert.match(feeFormProblem({ fee, rate: null }, { ...good, amountCentavos: null })!, /Escriba el monto/);
  });
});
