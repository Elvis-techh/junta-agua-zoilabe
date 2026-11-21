import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { BackButton, PreviousScreen } from "../src/components/BackButton.tsx";
import type { Route } from "../src/home.ts";
import { labelOf, markFrom, previousOf } from "../src/home.ts";

const house = "/censo/vivienda/0b9f6d2e-3c1a-4a55-9d0e-6f1a2b3c4d5e" as const;

describe("the screen before this one", () => {
  it("is read back from what a history entry was given", () => {
    assert.equal(previousOf(markFrom("/finanzas/quien-debe")), "/finanzas/quien-debe");
    assert.equal(previousOf(markFrom(house)), house);
    assert.equal(previousOf(markFrom("/")), "/");
  });

  it("is none for an entry the app did not write, or one it cannot trust", () => {
    assert.equal(previousOf(null), null);
    assert.equal(previousOf(undefined), null);
    assert.equal(previousOf("/censo"), null);
    assert.equal(previousOf({}), null);
    assert.equal(previousOf({ from: 42 }), null);
    assert.equal(previousOf({ from: "/censo/vivienda/no-es-una-vivienda" }), null);
    assert.equal(previousOf({ from: "/finanzas/otra-cosa" }), null);
  });

  it("is named in the village's words", () => {
    const names: Array<[Route, string]> = [
      ["/", "Inicio"],
      ["/finanzas/quien-debe", "Quién debe"],
      ["/finanzas/cobrar", "Cobrar"],
      ["/finanzas/resumen", "Resumen del mes"],
      ["/censo", "Censo"],
      ["/censo/buscar", "Buscar"],
      ["/censo/registrar", "Registrar familia"],
      [house, "Vivienda"],
      ["/finanzas/resumen/2026-10-01/gastos", "Resumen"],
      ["/finanzas/cierre/2026-10-01", "Cierre del mes"],
      ["/finanzas/estado/0b9f6d2e-3c1a-4a55-9d0e-6f1a2b3c4d5e", "Estado de cuenta"],
    ];
    for (const [route, name] of names) {
      assert.equal(labelOf(route), name, route);
    }
  });
});

describe("the way back goes to where the person was", () => {
  const button = () => createElement(BackButton, { label: "Censo", onClick: () => undefined });

  it("names the screen the person came from, not the one the screen usually goes to", () => {
    // A house opened from Quién debe: "‹ Quién debe", never "‹ Censo".
    const html = renderToStaticMarkup(
      createElement(PreviousScreen.Provider, { value: { label: labelOf("/finanzas/quien-debe"), back: () => undefined } }, button()),
    );
    assert.match(html, /Quién debe<\/button>/);
    assert.doesNotMatch(html, /Censo/);
  });

  it("keeps its usual name and place when the app was opened on this screen", () => {
    assert.match(renderToStaticMarkup(button()), /Censo<\/button>/);
    assert.match(renderToStaticMarkup(createElement(BackButton, { onClick: () => undefined })), /Inicio<\/button>/);
  });
});
