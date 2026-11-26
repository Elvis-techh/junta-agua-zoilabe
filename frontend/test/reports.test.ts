import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { HOME_BUTTONS, homeButtons, labelOf, otherButtons, routeOf } from "../src/home.ts";
import { REPORTS, reportsFor } from "../src/reports.ts";

const EVERYTHING = [...new Set(REPORTS.flatMap((report) => report.permissions))];

/** The Shell's source, one line at a time (Git for Windows may end them in "\r\n"). */
function shellLines(): string[] {
  const path = fileURLToPath(new URL("../src/components/Shell.tsx", import.meta.url));
  return readFileSync(path, "utf8").split(/\r?\n/);
}

describe("Reportes", () => {
  it("lists every report to whoever holds every permission", () => {
    assert.deepEqual(
      reportsFor(EVERYTHING).map((report) => report.title),
      ["Lista del censo", "Estado de cuenta de una familia", "Estado financiero del mes", "Quién debe", "Historial del año"],
    );
  });

  it("leaves out a report when one of its permissions is missing", () => {
    const withoutExports = EVERYTHING.filter((code) => !code.startsWith("export:"));
    assert.deepEqual(
      reportsFor(withoutExports).map((report) => report.title),
      ["Quién debe"],
    );
    assert.deepEqual(reportsFor(["census:view", "export:census"]).map((r) => r.title), ["Lista del censo"]);
    assert.deepEqual(reportsFor([]), []);
  });

  it("is a screen of its own, named Reportes on a way back", () => {
    assert.equal(routeOf("/reportes"), "/reportes");
    assert.equal(labelOf("/reportes"), "Reportes");
  });

  it("sends every report to a screen the app has", () => {
    for (const report of REPORTS) {
      assert.equal(routeOf(report.route), report.route, report.title);
    }
  });

  it("asks for at least what the Shell checks before opening each report's screen", () => {
    const lines = shellLines();
    for (const report of REPORTS) {
      const line = lines.find((text) => text.includes(`"${report.route}"`) && text.includes("can("));
      assert.ok(line, `${report.route} has no check in the Shell`);
      const checked = [...line.matchAll(/can\("([^"]+)"\)/g)].map((match) => match[1]);
      for (const code of checked) {
        assert.ok(report.permissions.includes(code!), `${report.title} must ask for ${code}`);
      }
    }
  });

  it("shows its home button only to someone who may make at least one report", () => {
    const has = (buttons: { label: string }[]) => buttons.some((button) => button.label === "Reportes");
    assert.ok(HOME_BUTTONS.fiscal?.some((button) => button.label === "Reportes"));
    assert.ok(has(homeButtons("fiscal", ["finance:view"])));
    assert.ok(!has(homeButtons("fiscal", ["census:view", "census:edit"])));
    assert.ok(has(otherButtons("tesorero", ["log:view", "export:log"])));
    assert.ok(!has(otherButtons("tesorero", ["log:view"])));
  });
});
