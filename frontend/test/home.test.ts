import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HOME_BUTTONS, homeButtons, homeSections, navigation, otherButtons, routeOf, tabOf } from "../src/home.ts";
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

  it("lets every role, the administrator too, open every built screen from Inicio (owner, 14 November 2026)", () => {
    const everything = ["census:view", "census:edit", "finance:view", "finance:record", "log:view", "users:manage", "settings:edit"];
    const built = (role: string) =>
      new Set([...homeButtons(role, everything), ...otherButtons(role, everything)].flatMap((b) => (b.route ? [b.route] : [])));
    const expected = built("tesorero");
    for (const role of ROLES) {
      assert.deepEqual([...built(role.code)].sort(), [...expected].sort(), role.code);
      // Its own buttons first, and nothing twice.
      const others = otherButtons(role.code, everything).map((b) => b.route);
      assert.equal(new Set(others).size, others.length, role.code);
      assert.ok(!others.some((route) => homeButtons(role.code, everything).some((b) => b.route === route)), role.code);
    }
    for (const route of ["/finanzas/cobrar", "/finanzas/gasto", "/censo/registrar", "/usuarios", "/historial", "/configuracion"]) {
      assert.ok(expected.has(route as never), route);
    }
    const forAdmin = otherButtons("administrador", everything).map((b) => b.label);
    for (const label of ["Registrar familia", "Buscar", "Lista", "Cobrar", "Gasto", "Historial"]) {
      assert.ok(forAdmin.includes(label), label);
    }
    // Already among the administrator's own buttons, so not again; and never a screen not built yet.
    for (const label of ["Usuarios", "Configuración", "Censo", "Resumen del mes"]) {
      assert.ok(!forAdmin.includes(label), label);
    }
  });

  it("puts Usuarios, Permisos and Configuración last on Inicio, for every role (owner, 19 November 2026)", () => {
    const everything = ["census:view", "census:edit", "finance:view", "finance:record", "log:view", "users:manage", "settings:edit"];
    const setup = ["Usuarios", "Permisos", "Configuración"];

    // The administrator's usual buttons are all setup ones, so the other tasks come first.
    const admin = homeSections("administrador", everything);
    assert.deepEqual(admin.own, []);
    assert.deepEqual(admin.setup.map((b) => b.label), setup);
    assert.ok(admin.others.length > 0);
    assert.equal(admin.others[0]?.label, "Registrar familia");

    // The treasurer's own work stays on top, unchanged.
    const treasurer = homeSections("tesorero", everything);
    assert.deepEqual(treasurer.own.map((b) => b.label), ["Cobrar", "Gasto", "Resumen del mes", "Quién debe"]);
    assert.deepEqual(treasurer.setup.map((b) => b.label), ["Usuarios", "Configuración"]);

    for (const role of ROLES) {
      const sections = homeSections(role.code, everything);
      assert.ok(![...sections.own, ...sections.others].some((b) => setup.includes(b.label)), role.code);
      // Nothing lost on the way: every button the role could open before is still there, once.
      const before = [...homeButtons(role.code, everything), ...otherButtons(role.code, everything)].map((b) => b.label);
      const after = [...sections.own, ...sections.others, ...sections.setup].map((b) => b.label);
      assert.deepEqual([...after].sort(), [...before].sort(), role.code);
    }

    // Without the permission, no setup button and no empty section.
    assert.deepEqual(homeSections("tesorero", ["finance:record"]).setup, []);
  });

  it("hides a button whose permission the role no longer has", () => {
    const withLog = homeButtons("fiscal", ["log:view"]).map((b) => b.label);
    const withoutLog = homeButtons("fiscal", []).map((b) => b.label);
    assert.ok(withLog.includes("Historial"));
    assert.ok(!withoutLog.includes("Historial"));
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
