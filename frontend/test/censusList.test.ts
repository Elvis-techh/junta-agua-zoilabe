import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { CensusList } from "../src/censusList.ts";
import { CENSUS_LIST_COLUMNS, censusListCsv, censusListFileName, censusListHeading } from "../src/censusList.ts";
import { labelOf, routeOf } from "../src/home.ts";
import { CensusListDocument } from "../src/screens/CensusList.tsx";

const list: CensusList = {
  document: { number: 14, madeAt: "2026-11-24T21:05:00.000Z", madeBy: "Sara Secretaria" },
  filters: { sectorName: "El Centro", status: "all" },
  sensitive: true,
  households: [
    {
      code: "Z-0001",
      ownerName: "Ana López",
      relation: "owner",
      idNumber: "0801199012345",
      phone: "+50499887766",
      phoneMissing: null,
      sectorName: "El Centro",
      references: 'Casa azul, "frente a la escuela"',
      waterConnection: "connected",
      status: "active",
      inactiveReason: null,
      paperFormNumber: "112",
      lastVerifiedOn: "2026-03-03",
    },
    {
      code: "Z-0002",
      ownerName: "Beto Díaz",
      relation: "renter",
      idNumber: null,
      phone: null,
      phoneMissing: "declined",
      sectorName: "El Centro",
      references: null,
      waterConnection: "not_connected",
      status: "inactive",
      inactiveReason: "moved_away",
      paperFormNumber: null,
      lastVerifiedOn: null,
    },
  ],
};

describe("Lista del censo", () => {
  it("says what it is, what it was filtered by, who made it, when, and its number", () => {
    assert.deepEqual(censusListHeading(list), [
      "Junta de Agua de Zoilabe",
      "Lista del censo nº 14",
      "Todas las viviendas · Sector El Centro · 2 viviendas",
      // 21:05 UTC is 3:05 p. m. in Honduras.
      `Hecha por Sara Secretaria el ${new Intl.DateTimeFormat("es-HN", {
        timeZone: "America/Tegucigalpa",
        day: "numeric",
        month: "long",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date("2026-11-24T21:05:00.000Z"))} · Documento nº 14`,
    ]);
    assert.match(censusListHeading(list)[3]!, /24 de noviembre de 2026.*3:05/);
  });

  it("says when ID numbers and phones are hidden", () => {
    const masked = { ...list, sensitive: false, filters: { sectorName: null, status: "active" as const } };
    const heading = censusListHeading(masked);
    assert.equal(heading[2], "Viviendas activas · Todos los sectores · 2 viviendas");
    assert.equal(heading[4], "Identidad y teléfono ocultos: quien hizo la lista no puede verlos completos.");
  });

  it("writes each house in the village's words", () => {
    const [ana, beto] = list.households.map((row) => CENSUS_LIST_COLUMNS.map((column) => column.value(row)));
    assert.deepEqual(ana, [
      "Z-0001",
      "Ana López",
      "Dueño/a",
      "0801-1990-12345",
      "504 9988-7766",
      "El Centro",
      'Casa azul, "frente a la escuela"',
      "Conectada",
      "Activa",
      "112",
      "3 de marzo de 2026",
    ]);
    assert.deepEqual(beto, [
      "Z-0002",
      "Beto Díaz",
      "Inquilino/a",
      "No la dio",
      "Prefiere no darlo",
      "El Centro",
      "",
      "Sin conexión",
      "Inactiva: Se mudó",
      "",
      "",
    ]);
    // A masked phone is shown as the server sent it.
    assert.equal(CENSUS_LIST_COLUMNS[4]!.value({ ...list.households[0]!, phone: "••••••66" }), "••••••66");
  });

  it("saves a file Excel opens with its accents, the same heading and columns, and no formula run", () => {
    const csv = censusListCsv(list);
    assert.ok(csv.startsWith("﻿"));
    const lines = csv.slice(1).split("\r\n");
    assert.equal(lines[0], '"Junta de Agua de Zoilabe"');
    assert.equal(lines[1], '"Lista del censo nº 14"');
    assert.equal(lines[4], "");
    assert.equal(lines[5], CENSUS_LIST_COLUMNS.map((column) => `"${column.title}"`).join(","));
    // Quotes doubled; the phone has no "+", so Excel keeps it as text without help.
    assert.equal(
      lines[6],
      '"Z-0001","Ana López","Dueño/a","0801-1990-12345","504 9988-7766","El Centro","Casa azul, ""frente a la escuela""","Conectada","Activa","112","3 de marzo de 2026"',
    );
    assert.equal(lines.length, 9);
    assert.equal(lines[8], "");

    const sneaky = { ...list, households: [{ ...list.households[1]!, ownerName: "=HYPERLINK(\"x\")" }] };
    assert.match(censusListCsv(sneaky), /"'=HYPERLINK\(""x""\)"/);
    // No phone cell starts with a sign Excel would read as a formula.
    assert.ok(!csv.includes("+504"));
    assert.ok(!csv.includes("'504"));
    assert.equal(censusListFileName(list), "lista-del-censo-n14.csv");
  });

  it("prints the same heading and a row per house", () => {
    const html = renderToStaticMarkup(createElement(CensusListDocument, { list }));
    assert.match(html, /Lista del censo nº 14/);
    assert.match(html, /Documento nº 14/);
    assert.equal(html.match(/<tr>/g)?.length, 3);
    assert.match(html, /Inactiva: Se mudó/);
  });

  it("has its own address, named on the way back", () => {
    assert.equal(routeOf("/censo/lista"), "/censo/lista");
    assert.equal(labelOf("/censo/lista"), "Lista del censo");
  });
});
