import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HOME_BUTTONS, homeButtons, tabs } from "../src/home.ts";
import { ROLES } from "../src/roles.ts";

describe("home buttons", () => {
  it("gives every role its buttons from the App Plan", () => {
    for (const role of ROLES) {
      assert.ok(HOME_BUTTONS[role.code]?.length, role.code);
    }
    assert.deepEqual(
      HOME_BUTTONS.tesorero?.map((b) => b.label),
      ["Cobrar", "Gasto", "Resumen del mes", "Quién debe"],
    );
  });

  it("hides a button whose permission the role no longer has", () => {
    const withLog = homeButtons("fiscal", ["log:view"]).map((b) => b.label);
    const withoutLog = homeButtons("fiscal", []).map((b) => b.label);
    assert.ok(withLog.includes("Historial"));
    assert.ok(!withoutLog.includes("Historial"));
  });

  it("never shows more than four tabs", () => {
    assert.ok(tabs(["users:manage", "log:view"]).length <= 4);
    assert.deepEqual(tabs([]).map((t) => t.label), ["Inicio"]);
  });
});
