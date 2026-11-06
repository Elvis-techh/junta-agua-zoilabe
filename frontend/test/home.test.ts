import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HOME_BUTTONS, homeButtons, navigation, otherTasks, routeOf, tabOf } from "../src/home.ts";
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

  it("offers the other tasks below a role's own buttons, now that every role may do everything", () => {
    const everything = ["census:view", "census:edit", "finance:view", "finance:record", "log:view", "users:manage", "settings:edit"];
    const labels = (role: string, permissions = everything) => otherTasks(role, permissions).map((b) => b.label);
    assert.deepEqual(labels("secretario"), ["Cobrar"]);
    assert.deepEqual(labels("tesorero"), ["Registrar familia", "Buscar"]);
    assert.deepEqual(labels("administrador"), ["Registrar familia", "Buscar", "Cobrar"]);
    // Only what the role may still do, if the Permisos tab narrowed it.
    assert.deepEqual(labels("secretario", ["census:view", "census:edit"]), []);
    // Places are in the bottom bar, never repeated as tasks.
    for (const role of ROLES) {
      for (const task of otherTasks(role.code, everything)) {
        assert.ok(!["/censo", "/usuarios", "/historial", "/configuracion"].includes(task.route!), task.label);
      }
    }
  });

  it("never shows more than four items in the bar, the rest under Más", () => {
    const president = navigation(["census:view", "users:manage", "log:view", "settings:edit"]);
    assert.deepEqual(president.bar.map((t) => t.label), ["Inicio", "Censo", "Usuarios"]);
    assert.deepEqual(president.more.map((t) => t.label), ["Historial", "Configuración"]);

    const secretary = navigation(["census:view"]);
    assert.deepEqual(secretary.bar.map((t) => t.label), ["Inicio", "Censo"]);
    assert.deepEqual(secretary.more, []);
    assert.deepEqual(navigation([]).bar.map((t) => t.label), ["Inicio"]);
  });

  it("opens the census from the secretary's buttons, and only known addresses", () => {
    assert.deepEqual(
      homeButtons("secretario", ["census:view", "census:edit"]).map((b) => b.route),
      ["/censo/registrar", "/censo/buscar", "/censo"],
    );
    assert.equal(routeOf("/censo/vivienda/0b7e1a52-4c1e-4f7a-9a43-2f9d7e4c1b20"), "/censo/vivienda/0b7e1a52-4c1e-4f7a-9a43-2f9d7e4c1b20");
    assert.equal(routeOf("/censo/vivienda/../../usuarios"), "/");
    assert.equal(tabOf("/censo/registrar"), "/censo");
  });
});
