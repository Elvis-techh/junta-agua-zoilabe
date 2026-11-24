/**
 * Lista del censo: the census list as a document, as it is printed and as it
 * is saved for a spreadsheet (App Plan, "Reports": "Census list, filtered by
 * sector and status — Screen, PDF, CSV").
 *
 * The server picks the houses, masks what its maker may not see, and gives
 * the document its number (backend/src/routes/censusList.ts). Here the
 * heading and the columns are written once, so the printout and the file
 * can never say different things.
 */
import type { InactiveReason, PhoneMissing, Relation, WaterConnection } from "./census.ts";
import { INACTIVE_REASONS, NO_ID_NUMBER, PHONE_MISSING, RELATIONS, WATER_CONNECTIONS, formatIdNumber } from "./census.ts";
import { formatPhone } from "./phone.ts";
import { BOARD_NAME } from "./statement.ts";
import { formatDate } from "./time.ts";

export type CensusListStatus = "active" | "inactive" | "all";
export type CensusListFormat = "print" | "csv";

/** One house on the list, as its maker may see it. */
export interface CensusListRow {
  code: string;
  ownerName: string;
  relation: Relation;
  idNumber: string | null;
  phone: string | null;
  phoneMissing: PhoneMissing | null;
  sectorName: string;
  references: string | null;
  waterConnection: WaterConnection;
  status: "active" | "inactive";
  inactiveReason: InactiveReason | null;
  paperFormNumber: string | null;
  lastVerifiedOn: string | null;
}

/** A list that was handed out: its number, who made it and when, what it was filtered by, and its houses. */
export interface CensusList {
  document: { number: number; madeAt: string; madeBy: string };
  filters: { sectorName: string | null; status: CensusListStatus };
  /** Whether ID numbers and phones are whole. */
  sensitive: boolean;
  households: CensusListRow[];
}

export const STATUS_CHOICES: Record<CensusListStatus, string> = {
  active: "Activas",
  inactive: "Inactivas",
  all: "Todas",
};

const STATUS_HEADING: Record<CensusListStatus, string> = {
  active: "Viviendas activas",
  inactive: "Viviendas inactivas",
  all: "Todas las viviendas",
};

/** "15 de noviembre de 2026, 2:05 p. m.", in Honduras time: a document says its year too. */
const dateAndTime = (iso: string) =>
  new Intl.DateTimeFormat("es-HN", {
    timeZone: "America/Tegucigalpa",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));

/** "3 de marzo de 2026" for a calendar date. */
const calendarDate = (date: string) => formatDate(`${date}T12:00:00Z`);

/** "23 viviendas" */
export function householdCount(count: number): string {
  return count === 1 ? "1 vivienda" : `${count} viviendas`;
}

/** The lines above the table, top to bottom. */
export function censusListHeading(list: CensusList): string[] {
  const { document, filters } = list;
  const lines = [
    BOARD_NAME,
    `Lista del censo nº ${document.number}`,
    `${STATUS_HEADING[filters.status]} · ${filters.sectorName ? `Sector ${filters.sectorName}` : "Todos los sectores"} · ${householdCount(list.households.length)}`,
    `Hecha por ${document.madeBy} el ${dateAndTime(document.madeAt)} · Documento nº ${document.number}`,
  ];
  if (!list.sensitive) {
    lines.push("Identidad y teléfono ocultos: quien hizo la lista no puede verlos completos.");
  }
  return lines;
}

/** A column of the list: its title and what it says for a house. */
export interface CensusListColumn {
  title: string;
  value: (row: CensusListRow) => string;
}

export const CENSUS_LIST_COLUMNS: readonly CensusListColumn[] = [
  { title: "Código", value: (row) => row.code },
  { title: "Nombre", value: (row) => row.ownerName },
  { title: "Relación", value: (row) => RELATIONS[row.relation] },
  { title: "Identidad", value: (row) => (row.idNumber === null ? NO_ID_NUMBER : formatIdNumber(row.idNumber)) },
  {
    // Without its "+": Excel would read "+504 …" as a sum (owner, 24 November 2026).
    title: "Teléfono",
    value: (row) =>
      row.phone === null
        ? row.phoneMissing
          ? PHONE_MISSING[row.phoneMissing]
          : ""
        : /^\+\d+$/.test(row.phone)
          ? formatPhone(row.phone).replace(/^\+/, "")
          : row.phone,
  },
  { title: "Sector", value: (row) => row.sectorName },
  { title: "Referencias", value: (row) => row.references ?? "" },
  { title: "Agua", value: (row) => WATER_CONNECTIONS[row.waterConnection] },
  {
    title: "Estado",
    value: (row) =>
      row.status === "active" ? "Activa" : `Inactiva${row.inactiveReason ? `: ${INACTIVE_REASONS[row.inactiveReason]}` : ""}`,
  },
  { title: "Hoja nº", value: (row) => row.paperFormNumber ?? "" },
  { title: "Verificada", value: (row) => (row.lastVerifiedOn ? calendarDate(row.lastVerifiedOn) : "") },
];

/**
 * One cell of the file. Every cell is quoted, so commas and line breaks stay
 * inside it. One that starts like a formula ("=…", "+…", "-…", "@…") gets an
 * apostrophe first, so a spreadsheet shows it as text and never runs it.
 */
function csvCell(text: string): string {
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

/**
 * The list as a file for Excel: the heading lines, an empty line, then one
 * row per house under the column titles. It starts with the mark that tells
 * Excel the accents are UTF-8, and ends its lines as Windows does.
 */
export function censusListCsv(list: CensusList): string {
  const rows = [
    ...censusListHeading(list).map((line) => [line]),
    [],
    CENSUS_LIST_COLUMNS.map((column) => column.title),
    ...list.households.map((row) => CENSUS_LIST_COLUMNS.map((column) => column.value(row))),
  ];
  return `﻿${rows.map((cells) => cells.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

/** "lista-del-censo-n12.csv" */
export function censusListFileName(list: CensusList): string {
  return `lista-del-censo-n${list.document.number}.csv`;
}
