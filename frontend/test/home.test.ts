import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HOME_BUTTONS, homeButtons, homeSections, labelOf, navigation, otherButtons, routeOf, tabOf } from "../src/home.ts";
import { ROLES } from "../src/roles.ts";

describe("home buttons", () => {
  it("gives every role its buttons from the App Plan", () => {
    for (const role of ROLES) {
      assert.ok(HOME_BUTTONS[role.code]?.length, role.code);
    }
    assert.deepEqual(
      HOME_BUTTONS.tesorero?.map((b) => b.label),
      ["Cobrar", "Gasto", "Resumen del mes", "Preparar cierre"],
    );
  });

  it("lets every role, the administrator too, open every built screen from Inicio (owner, 14 November 2026)", () => {
    const everything = ["census:view", "census:edit", "finance:view", "finance:record", "log:view", "users:manage", "permissions:view", "settings:edit"];
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
    for (const route of ["/finanzas/cobrar", "/finanzas/gasto", "/censo/registrar", "/usuarios", "/permisos", "/historial", "/configuracion"]) {
      assert.ok(expected.has(route as never), route);
    }
    const forAdmin = otherButtons("administrador", everything).map((b) => b.label);
    for (const label of ["Registrar familia", "Censo", "Cobrar", "Gasto", "Historial", "Resumen del mes", "Reportes"]) {
      assert.ok(forAdmin.includes(label), label);
    }
    // Already among the administrator's own buttons, so not again; and never a screen not built yet.
    for (const label of ["Usuarios", "Permisos", "Configuración", "Buscar", "Lista", "Quién debe"]) {
      assert.ok(!forAdmin.includes(label), label);
    }
  });

  it("puts Usuarios, Permisos and Configuración last on Inicio, for every role (owner, 19 November 2026)", () => {
    const everything = ["census:view", "census:edit", "finance:view", "finance:record", "log:view", "users:manage", "permissions:view", "settings:edit"];
    const setup = ["Usuarios", "Permisos", "Configuración"];

    // The administrator's usual buttons are all setup ones, so the other tasks come first.
    const admin = homeSections("administrador", everything);
    assert.deepEqual(admin.own, []);
    assert.deepEqual(admin.setup.map((b) => b.label), setup);
    assert.ok(admin.others.length > 0);
    assert.equal(admin.others[0]?.label, "Registrar familia");

    // The treasurer's own work stays on top, unchanged.
    const treasurer = homeSections("tesorero", everything);
    assert.deepEqual(treasurer.own.map((b) => b.label), ["Cobrar", "Gasto", "Resumen del mes"]);
    assert.deepEqual(treasurer.setup.map((b) => b.label), setup);

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

  it("shows no button whose screen would not open (owner, 25 November 2026)", () => {
    // Cobrar and Otro ingreso find the family in the census; Gasto does not.
    const noCensus = ["finance:view", "finance:record"];
    const all = (permissions: string[]) => {
      const sections = homeSections("tesorero", permissions);
      return [...sections.own, ...sections.others, ...sections.setup].map((b) => b.label);
    };
    assert.ok(all(noCensus).includes("Gasto"));
    assert.ok(!all(noCensus).includes("Cobrar") && !all(noCensus).includes("Otro ingreso"));
    const withCensus = all([...noCensus, "census:view"]);
    assert.ok(withCensus.includes("Cobrar") && withCensus.includes("Otro ingreso"));
  });

  it("opens Permisos, and one cargo, from Inicio and from the bar", () => {
    assert.deepEqual(homeButtons("administrador", ["permissions:view"]).map((b) => [b.label, b.route]), [["Permisos", "/permisos"]]);
    assert.deepEqual(homeButtons("administrador", []), []);
    assert.deepEqual(navigation(["users:manage", "permissions:view"]).bar.map((t) => t.label), ["Inicio", "Usuarios", "Permisos"]);
    for (const path of ["/permisos", "/permisos/fiscal", "/permisos/segundo_vocal"]) {
      assert.equal(routeOf(path), path);
      assert.equal(tabOf(routeOf(path)), "/permisos");
    }
    for (const path of ["/permisos/tesorera", "/permisos/fiscal/x", "/permisos/"]) {
      assert.equal(routeOf(path), "/", path);
    }
    assert.equal(labelOf("/permisos"), "Permisos");
    assert.equal(labelOf("/permisos/fiscal"), "Permisos");
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
      ["/censo/registrar", "/censo"],
    );
    assert.equal(routeOf("/censo/vivienda/0b7e1a52-4c1e-4f7a-9a43-2f9d7e4c1b20"), "/censo/vivienda/0b7e1a52-4c1e-4f7a-9a43-2f9d7e4c1b20");
    assert.equal(routeOf("/censo/vivienda/../../usuarios"), "/");
    assert.equal(tabOf("/censo/registrar"), "/censo");
  });

  it("opens Resumen del mes for a month and each of its parts, and nothing else under it (owner, 19 November 2026)", () => {
    assert.equal(homeButtons("fiscal", ["finance:view"])[0]?.route, "/finanzas/resumen");
    assert.ok(!homeButtons("fiscal", []).some((b) => b.label === "Resumen del mes"));
    for (const path of ["/finanzas/resumen", "/finanzas/resumen/2026-10-01", "/finanzas/resumen/2026-10-01/entradas", "/finanzas/resumen/2026-10-01/gastos", "/finanzas/resumen/2026-10-01/cuota"]) {
      assert.equal(routeOf(path), path);
    }
    for (const path of ["/finanzas/resumen/2026-13-01", "/finanzas/resumen/2026-10-15", "/finanzas/resumen/2026-10-01/otra", "/finanzas/resumen/2026-10-01/cuota/x"]) {
      assert.equal(routeOf(path), "/", path);
    }
  });
});
