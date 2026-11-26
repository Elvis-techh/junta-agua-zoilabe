import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// The server's own rules, so the screen is checked against them and not against a copy.
import type { Permission, RoleCode } from "../../backend/src/lib/permissions.ts";
import {
  DEFAULT_MATRIX,
  LOCKED_FOR_ADMIN,
  PERMISSIONS,
  PERMISSION_CODES,
  REQUIRES,
  ROLE_CODES,
  matrixProblem,
} from "../../backend/src/lib/permissions.ts";
import type { PermissionInfo } from "../src/permissions.ts";
import { HIDDEN, cannotLine, changes, groupLine, isOn, readOnlyReason, rowNotes, saveWarnings, switchGroups, toggle, working } from "../src/permissions.ts";
import { CargoSwitches } from "../src/screens/Permissions.tsx";

/** What GET /permissions sends. */
const infos: PermissionInfo[] = PERMISSION_CODES.map((code) => ({ code, label: PERMISSIONS[code], requires: REQUIRES[code] ?? null }));
const groups = switchGroups(infos);
const switches = groups.flatMap((group) => group.switches);
const everything = new Set<string>(PERMISSION_CODES);
const named = (code: string) => switches.find((sw) => sw.codes.includes(code))!;
const problem = (role: RoleCode, granted: Set<string>) => matrixProblem(role, granted as Set<Permission>);

describe("the switches on a cargo's screen", () => {
  it("shows every permission the server has, once, in a named group", () => {
    assert.deepEqual(groups.map((group) => group.title), ["Censo", "Finanzas", "Historial", "Administración"]);
    const shown = switches.flatMap((sw) => sw.codes);
    assert.equal(new Set(shown).size, shown.length);
    assert.deepEqual([...shown, ...HIDDEN].sort(), [...PERMISSION_CODES].sort());
  });

  it("still shows a permission added to the server that no group has yet", () => {
    const more = switchGroups([...infos, { code: "reports:view", label: "Ver los reportes", requires: null }]);
    assert.equal(more.at(-1)?.title, "Otros");
    assert.deepEqual(more.at(-1)?.switches, [{ codes: ["reports:view"], label: "Ver los reportes" }]);
  });

  it("has one switch for a different fee, since the app only sets one while registering", () => {
    assert.deepEqual([...named("household_fee:set").codes].sort(), ["household_fee:set", "household_fee:set_at_registration"]);
    const off = toggle(everything, named("household_fee:set"), infos);
    assert.ok(!off.has("household_fee:set") && !off.has("household_fee:set_at_registration"));
    // Either one lets a fee be set (the server accepts both), so either one shows it on.
    assert.ok(isOn(named("household_fee:set"), new Set(["household_fee:set"])));
  });

  it("turns off with «Ver finanzas» everything that needs it, and nothing else", () => {
    const off = toggle(everything, named("finance:view"), infos);
    assert.deepEqual(changes(groups, everything, off), {
      removed: [
        "Ver finanzas",
        "Registrar pagos y gastos",
        "Corregir un registro de dinero",
        "Preparar el cierre del mes",
        "Aprobar el cierre del mes",
        "Imprimir y exportar finanzas",
      ],
      added: [],
    });
    // The switch that is not shown is left as it was.
    assert.ok(off.has("guests:manage"));
  });

  it("follows the chain: without the census, no different fee either", () => {
    const off = toggle(everything, named("census:view"), infos);
    assert.ok(!off.has("census:edit") && !off.has("household_fee:set") && !off.has("household_fee:set_at_registration"));
  });

  it("turns on what a switch needs along with it", () => {
    const none = new Set<string>();
    const on = toggle(none, named("household_fee:set"), infos);
    assert.deepEqual(changes(groups, none, on).added, [
      "Ver el censo y las fichas de vivienda",
      "Registrar y editar el censo",
      "Fijar una tarifa diferente al registrar",
    ]);
  });

  it("never builds a set the server would refuse, whatever is tapped", () => {
    for (const role of ROLE_CODES) {
      const locked = new Set<string>(role === "administrador" ? LOCKED_FOR_ADMIN : []);
      const tappable = switches.filter((sw) => !sw.codes.some((code) => locked.has(code)));
      let granted = new Set<string>(DEFAULT_MATRIX[role]);
      // Every switch off, one after another, then every one on again.
      for (const sw of [...tappable, ...tappable.slice().reverse()]) {
        granted = toggle(granted, sw, infos);
        assert.equal(problem(role, granted), null, `${role}: ${sw.label}`);
      }
      // And each by itself, from everything.
      for (const sw of tappable) {
        assert.equal(problem(role, toggle(DEFAULT_MATRIX[role], sw, infos)), null, `${role}: ${sw.label}`);
      }
    }
  });

  it("shows as off a permission stored without the one it needs", () => {
    const stored = [...everything].filter((code) => code !== "finance:view");
    const shown = working(stored, infos);
    assert.ok(!shown.has("export:finance") && !shown.has("finance:record"));
    assert.equal(problem("fiscal", shown), null);
  });

  it("says once at the top of a group what goes with its first switch", () => {
    const [census, finance, history, admin] = groups;
    assert.equal(groupLine(census!, infos), "Si quita «Ver el censo y las fichas de vivienda», se quita también lo demás de Censo.");
    assert.equal(groupLine(finance!, infos), "Si quita «Ver finanzas», se quita también lo demás de Finanzas.");
    assert.equal(groupLine(history!, infos), "Si quita «Ver el historial», se quita también lo demás de Historial.");
    assert.equal(groupLine(admin!, infos), null);
  });

  it("notes under a switch only what the top of its group does not say", () => {
    const [census, finance, , admin] = groups;
    assert.deepEqual(rowNotes(census!, named("census:edit"), infos), []);
    assert.deepEqual(rowNotes(census!, named("household_fee:set"), infos), ["Necesita «Registrar y editar el censo»."]);
    assert.deepEqual(rowNotes(finance!, named("finance:view"), infos), ["Muestra también los nombres de quienes deben."]);
    assert.deepEqual(rowNotes(finance!, named("finance:record"), infos), ["Para cobrar también necesita ver el censo."]);
    assert.deepEqual(rowNotes(admin!, named("permissions:edit"), infos), ["Necesita «Ver los permisos».", "Sirve para cambiar los otros cargos, no el propio."]);
  });

  it("sums up a cargo in a few words", () => {
    assert.equal(cannotLine(groups, everything), "Puede todo");
    assert.equal(cannotLine(groups, toggle(everything, named("users:manage"), infos)), "No puede 1 cosa");
    assert.equal(cannotLine(groups, toggle(everything, named("log:view"), infos)), "No puede 2 cosas");
  });
});

describe("who may change a cargo", () => {
  it("nobody changes their own, even with «Editar los permisos» (owner, 25 November 2026)", () => {
    assert.match(readOnlyReason(true, "administrador", "administrador")!, /Nadie puede cambiar los permisos de su propio cargo/);
    assert.match(readOnlyReason(true, "fiscal", "fiscal")!, /su propio cargo/);
    assert.equal(readOnlyReason(true, "administrador", "fiscal"), null);
  });

  it("says so too to someone who may only look", () => {
    assert.match(readOnlyReason(false, "secretario", "fiscal")!, /pero no cambiarlos/);
    assert.match(readOnlyReason(false, "secretario", "secretario")!, /pero no cambiarlos/);
  });
});

describe("what «¿Está correcto?» warns about", () => {
  const without = (...codes: string[]) => new Set([...everything].filter((code) => !codes.includes(code)));

  it("says when a cargo that loses something can still make accounts of another cargo", () => {
    assert.deepEqual(saveWarnings(everything, without("finance:reverse")), [
      "Este cargo conserva «Administrar usuarios»: puede crear una cuenta de otro cargo.",
    ]);
    assert.deepEqual(saveWarnings(everything, without("finance:reverse", "users:manage")), []);
    // Only giving takes nothing away.
    assert.deepEqual(saveWarnings(without("log:view"), everything), []);
  });
});

describe("the switches as they are drawn", () => {
  const draw = (props: { shown?: Set<string>; locked?: string[]; canEdit?: boolean }) =>
    renderToStaticMarkup(
      createElement(CargoSwitches, {
        groups,
        permissions: infos,
        saved: everything,
        shown: props.shown ?? everything,
        locked: props.locked ?? [],
        onToggle: props.canEdit === false ? undefined : () => undefined,
      }),
    );
  const count = (html: string, text: string) => html.split(text).length - 1;

  it("are buttons with a word and an icon, and say what is not saved yet", () => {
    const html = draw({ shown: toggle(everything, named("log:view"), infos) });
    assert.equal(count(html, 'role="switch"'), switches.length);
    assert.equal(count(html, 'aria-checked="false"'), 2);
    assert.equal(count(html, "sin guardar"), 2);
    assert.match(html, /<\/svg> No<\/span>/);
    assert.match(html, /<\/svg> Sí<\/span>/);
  });

  it("cannot be tapped where the administrator always keeps the permission", () => {
    const html = draw({ locked: [...LOCKED_FOR_ADMIN] });
    assert.equal(count(html, 'role="switch"'), switches.length - 3);
    assert.equal(count(html, "</svg> Siempre"), 3);
  });

  it("are only read by someone who may not change them", () => {
    const html = draw({ canEdit: false });
    assert.equal(count(html, "<button"), 0);
    assert.doesNotMatch(html, /Si quita/);
  });
});
