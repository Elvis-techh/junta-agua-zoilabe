import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { labelOf, routeOf, tabOf } from "../src/home.ts";
import type { LogExtract } from "../src/logExtract.ts";
import { LOG_EXTRACT_COLUMNS, defaultYear, logExtractCsv, logExtractFileName, logExtractHeading } from "../src/logExtract.ts";
import { dateAndTime } from "../src/statement.ts";
import { HistoryScreen } from "../src/screens/History.tsx";
import { LogExtractDocument } from "../src/screens/LogExtract.tsx";

const extract: LogExtract = {
  document: { number: 15, madeAt: "2027-01-05T21:05:00.000Z", madeBy: "Fabio Fiscal" },
  year: 2026,
  madeOn: "2027-01-05",
  entries: [
    {
      occurredAt: "2026-03-03T15:00:00.000Z",
      actorName: "Sara Secretaria",
      actorRole: "Secretario/a",
      summary: "Sara Secretaria (Secretario/a) registró la vivienda Z-0001 de Ana López",
      reason: null,
    },
    {
      occurredAt: "2027-01-01T05:30:00.000Z",
      actorName: "Tina Tesorera",
      actorRole: "Tesorero/a",
      summary: "Tina Tesorera (Tesorero/a) anuló el pago de L 70.00 de Ana López",
      reason: '=HYPERLINK("x")',
    },
  ],
};

describe("Historial del año", () => {
  it("says what it is, what it covers, who made it, when, and its number", () => {
    assert.deepEqual(logExtractHeading(extract), [
      "Junta de Agua de Zoilabe",
      "Historial del año 2026",
      "Del 1 de enero al 31 de diciembre de 2026 · 2 anotaciones, de la más antigua a la más nueva",
      `Hecho por Fabio Fiscal el ${dateAndTime(extract.document.madeAt)} · Documento nº 15`,
      "Lo que muestra «Ver detalle» no va en esta copia: queda en la aplicación.",
    ]);
  });

  it("says the year is not over when it was made during it", () => {
    const early = { ...extract, madeOn: "2026-11-25", entries: [extract.entries[0]!] };
    assert.equal(
      logExtractHeading(early)[2],
      "Del 1 de enero al 25 de noviembre de 2026, el año no ha terminado · 1 anotación, de la más antigua a la más nueva",
    );
  });

  it("writes each entry in Honduras time: when, who, their role, what happened and why", () => {
    assert.deepEqual(
      LOG_EXTRACT_COLUMNS.map((column) => column.title),
      ["Fecha y hora", "Quién", "Cargo", "Qué pasó", "Motivo"],
    );
    const [first, second] = extract.entries.map((entry) => LOG_EXTRACT_COLUMNS.map((column) => column.value(entry)));
    assert.match(first![0]!, /3 de marzo de 2026.*9:00/);
    assert.deepEqual(first!.slice(1), ["Sara Secretaria", "Secretario/a", extract.entries[0]!.summary, ""]);
    // 05:30 UTC on 1 January is still New Year's Eve in the village.
    assert.match(second![0]!, /31 de diciembre de 2026.*11:30/);
  });

  it("saves a file with the same heading and columns, and runs no formula typed as a reason", () => {
    const csv = logExtractCsv(extract);
    assert.ok(csv.startsWith("﻿"));
    const lines = csv.slice(1).split("\r\n");
    assert.equal(lines[1], '"Historial del año 2026"');
    assert.equal(lines[5], "");
    assert.equal(lines[6], '"Fecha y hora","Quién","Cargo","Qué pasó","Motivo"');
    assert.ok(lines[8]!.endsWith(`"'=HYPERLINK(""x"")"`), lines[8]);
    assert.equal(lines.length, 10);
    assert.equal(logExtractFileName(extract), "historial-2026-n15.csv");
  });

  it("prints the same heading and a row per entry", () => {
    const html = renderToStaticMarkup(createElement(LogExtractDocument, { extract }));
    assert.match(html, /Historial del año 2026/);
    assert.match(html, /Documento nº 15/);
    assert.equal(html.match(/<tr>/g)?.length, 3);
    assert.match(html, /anuló el pago de L 70\.00/);
    assert.match(html, /print-document print-table/);
  });

  it("starts on the last year that is over, or the newest when none is", () => {
    const years = [
      { year: 2027, count: 3 },
      { year: 2026, count: 245 },
      { year: 2025, count: 9 },
    ];
    assert.equal(defaultYear({ thisYear: 2027, years }), 2026);
    assert.equal(defaultYear({ thisYear: 2026, years: [{ year: 2026, count: 245 }] }), 2026);
    assert.equal(defaultYear({ thisYear: 2026, years: [] }), null);
  });

  it("opens from Historial, for whoever may print it, and has its own address, named on the way back", () => {
    const history = (canHandOut: boolean) => renderToStaticMarkup(createElement(HistoryScreen, { canHandOut, onOpen: () => undefined }));
    assert.match(history(true), /Imprimir o guardar un año/);
    assert.doesNotMatch(history(false), /Imprimir o guardar un año/);
    assert.equal(routeOf("/historial/ano"), "/historial/ano");
    assert.equal(labelOf("/historial/ano"), "Historial del año");
    assert.equal(tabOf("/historial/ano"), "/historial");
  });
});
