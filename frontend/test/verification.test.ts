import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { labelOf, routeOf } from "../src/home.ts";
import type { UnverifiedHouse, Verification } from "../src/verification.ts";
import { bySector, lastVerifiedLine, verificationSummary } from "../src/verification.ts";

const house = (code: string, sectorName: string, lastVerifiedOn: string | null): UnverifiedHouse => ({
  id: `0b7e1a52-4c1e-4f7a-9a43-2f9d7e4c${code.slice(2)}`,
  code,
  ownerName: "Ana López",
  sectorName,
  references: null,
  lastVerifiedOn,
});

const list = (activeCount: number, unverified: UnverifiedHouse[]): Verification => ({
  today: "2026-12-02",
  year: 2026,
  activeCount,
  verifiedCount: activeCount - unverified.length,
  unverified,
});

describe("Verificación del censo", () => {
  it("says how many active houses are left to check this year", () => {
    assert.equal(verificationSummary(list(40, [house("Z-0001", "Ánimas", null), house("Z-0002", "Ánimas", null)])), "Faltan 2 viviendas de 40 por verificar en 2026.");
    assert.equal(verificationSummary(list(40, [house("Z-0001", "Ánimas", null)])), "Falta 1 vivienda de 40 por verificar en 2026.");
    assert.equal(verificationSummary(list(40, [])), "Las 40 viviendas activas ya están verificadas en 2026.");
    assert.equal(verificationSummary(list(1, [])), "La vivienda activa ya está verificada en 2026.");
    assert.equal(verificationSummary(list(0, [])), "Todavía no hay viviendas activas en el censo.");
  });

  it("says when each house was last checked, or that it never was", () => {
    assert.equal(lastVerifiedLine({ lastVerifiedOn: "2025-11-20" }), "Verificada por última vez el 20 de noviembre de 2025");
    assert.equal(lastVerifiedLine({ lastVerifiedOn: null }), "Nunca verificada");
  });

  it("groups the houses under their sector, in the order the server sent them", () => {
    const groups = bySector([house("Z-0003", "Ánimas", null), house("Z-0007", "Ánimas", null), house("Z-0001", "La Loma", null)]);
    assert.deepEqual(
      groups.map((group) => [group.sectorName, group.houses.map((h) => h.code)]),
      [
        ["Ánimas", ["Z-0003", "Z-0007"]],
        ["La Loma", ["Z-0001"]],
      ],
    );
    assert.deepEqual(bySector([]), []);
  });

  it("has its own address, and a name for the way back to it", () => {
    assert.equal(routeOf("/censo/verificar"), "/censo/verificar");
    assert.equal(labelOf("/censo/verificar"), "Verificación");
  });
});
