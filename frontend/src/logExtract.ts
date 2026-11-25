/**
 * Historial del año: a year of the history log as a document, as it is printed
 * and as it is saved for a spreadsheet (App Plan, "Reports": "History log
 * extract — Fiscal, president — PDF, CSV").
 *
 * The server picks the year's entries and gives the document its number
 * (backend/src/routes/logExtract.ts). It sends only what Historial's list
 * shows, never the values behind "Ver detalle", which hold ID numbers and
 * phones (owner, 25 November 2026). Here the heading and the columns are
 * written once, so the printout and the file can never say different things.
 */
import { csvFile } from "./csv.ts";
import { BOARD_NAME, calendarDate, dateAndTime } from "./statement.ts";

export type LogExtractFormat = "print" | "csv";

/** One entry of the log, as the extract carries it. */
export interface LogExtractEntry {
  occurredAt: string;
  actorName: string;
  actorRole: string;
  summary: string;
  reason: string | null;
}

/** An extract that was handed out: its number, who made it and when, its year and its entries, oldest first. */
export interface LogExtract {
  document: { number: number; madeAt: string; madeBy: string };
  year: number;
  /** The day it was made, in Honduras: in the year itself, the extract stops there. */
  madeOn: string;
  entries: LogExtractEntry[];
}

/** The years there are entries in, newest first, and the one in progress. */
export interface LogExtractChoices {
  thisYear: number;
  years: Array<{ year: number; count: number }>;
}

/** The year the screen starts on: the last one that is over, which is the one the board files away; else the newest. */
export function defaultYear({ thisYear, years }: LogExtractChoices): number | null {
  return (years.find((choice) => choice.year < thisYear) ?? years[0])?.year ?? null;
}

/** "245 anotaciones" */
export function entryCount(count: number): string {
  return count === 1 ? "1 anotación" : `${count} anotaciones`;
}

/** The lines above the table, top to bottom. */
export function logExtractHeading(extract: LogExtract): string[] {
  const { document, year, madeOn, entries } = extract;
  const start = `Del 1 de enero`;
  const period = madeOn.startsWith(`${year}-`)
    ? `${start} al ${calendarDate(madeOn)}, el año no ha terminado`
    : `${start} al ${calendarDate(`${year}-12-31`)}`;
  return [
    BOARD_NAME,
    `Historial del año ${year}`,
    `${period} · ${entryCount(entries.length)}, de la más antigua a la más nueva`,
    `Hecho por ${document.madeBy} el ${dateAndTime(document.madeAt)} · Documento nº ${document.number}`,
    "Lo que muestra «Ver detalle» no va en esta copia: queda en la aplicación.",
  ];
}

/** A column of the extract: its title and what it says for an entry. */
export interface LogExtractColumn {
  title: string;
  value: (entry: LogExtractEntry) => string;
  /** A column of sentences, which keeps a readable width on a phone. */
  sentence?: true;
}

export const LOG_EXTRACT_COLUMNS: readonly LogExtractColumn[] = [
  { title: "Fecha y hora", value: (entry) => dateAndTime(entry.occurredAt) },
  { title: "Quién", value: (entry) => entry.actorName },
  { title: "Cargo", value: (entry) => entry.actorRole },
  { title: "Qué pasó", value: (entry) => entry.summary, sentence: true },
  { title: "Motivo", value: (entry) => entry.reason ?? "" },
];

/** The extract as a file for Excel: the heading lines, an empty line, then one row per entry under the column titles. */
export function logExtractCsv(extract: LogExtract): string {
  return csvFile([
    ...logExtractHeading(extract).map((line) => [line]),
    [],
    LOG_EXTRACT_COLUMNS.map((column) => column.title),
    ...extract.entries.map((entry) => LOG_EXTRACT_COLUMNS.map((column) => column.value(entry))),
  ]);
}

/** "historial-2026-n15.csv" */
export function logExtractFileName(extract: LogExtract): string {
  return `historial-${extract.year}-n${extract.document.number}.csv`;
}
