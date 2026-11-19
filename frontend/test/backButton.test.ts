import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import type { ReactElement } from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { Me } from "../src/api.ts";
import { ArrearsScreen } from "../src/screens/Arrears.tsx";
import { CollectScreen } from "../src/screens/Collect.tsx";
import { HistoryScreen } from "../src/screens/History.tsx";
import { OpeningBalanceScreen } from "../src/screens/OpeningBalance.tsx";
import { RegisterScreen } from "../src/screens/Register.tsx";
import { SettingsScreen } from "../src/screens/Settings.tsx";
import { UsersScreen } from "../src/screens/Users.tsx";

const me: Me = { id: "u1", name: "Tina Tesorera", roleCode: "tesorero", roleName: "Tesorero", permissions: [] };
const onOpen = () => undefined;

/**
 * Each screen as it first opens, before anything has loaded: the button must
 * be there already. Censo is read from its source below: its list of entries
 * waiting on the phone cannot be drawn outside a browser.
 */
const screens: Array<[string, ReactElement]> = [
  ["Registrar familia", createElement(RegisterScreen, { me, preset: null, onOpen })],
  ["Cobrar", createElement(CollectScreen, { onOpen, canSeeOwed: true })],
  ["Quién debe", createElement(ArrearsScreen, { onOpen })],
  ["Saldo de la junta", createElement(OpeningBalanceScreen, { canRecord: true, canCorrect: true, onOpen })],
  ["Usuarios", createElement(UsersScreen, { me, onOpen })],
  ["Historial", createElement(HistoryScreen, { onOpen })],
  ["Configuración", createElement(SettingsScreen, { onOpen })],
];

describe("the way back", () => {
  for (const [name, screen] of screens) {
    it(`${name} has a button back to Inicio at the top, before its title`, () => {
      const html = renderToStaticMarkup(screen);
      const back = html.indexOf("Inicio</button>");
      assert.ok(back !== -1, html);
      assert.ok(back < html.indexOf("<h1"), "the button comes before the title");
    });
  }

  it("Censo has a button back to Inicio at the top, before its title", () => {
    const source = readFileSync(fileURLToPath(new URL("../src/screens/Census.tsx", import.meta.url)), "utf8");
    const back = source.indexOf('<BackButton onClick={() => onOpen("/")} />');
    assert.ok(back !== -1);
    assert.ok(back < source.indexOf("<h1>Censo</h1>"), "the button comes before the title");
  });
});
