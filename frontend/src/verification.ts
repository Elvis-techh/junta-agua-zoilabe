/**
 * Verificación del censo (App Plan, Module 1, "Yearly verification"): each
 * year someone goes over every house's details with its family, and in
 * December the board finishes the houses still left before the year's census
 * is frozen. The server works out the list (GET /census/verification); this
 * file only says it in the village's words.
 */
import { formatDate } from "./time.ts";

/** An active house nobody has checked with its family this year. */
export interface UnverifiedHouse {
  id: string;
  code: string;
  ownerName: string;
  sectorName: string;
  references: string | null;
  lastVerifiedOn: string | null;
}

export interface Verification {
  today: string;
  year: number;
  activeCount: number;
  verifiedCount: number;
  /** By sector, then by code. */
  unverified: UnverifiedHouse[];
}

/** "3 de marzo de 2026" for a calendar date. */
const calendarDate = (date: string) => formatDate(`${date}T12:00:00Z`);

/** The line at the top: how many of the active houses are left to check this year. */
export function verificationSummary(list: Verification): string {
  const left = list.unverified.length;
  if (list.activeCount === 0) return "Todavía no hay viviendas activas en el censo.";
  if (left === 0) {
    return list.activeCount === 1
      ? `La vivienda activa ya está verificada en ${list.year}.`
      : `Las ${list.activeCount} viviendas activas ya están verificadas en ${list.year}.`;
  }
  const houses = left === 1 ? "Falta 1 vivienda" : `Faltan ${left} viviendas`;
  return `${houses} de ${list.activeCount} por verificar en ${list.year}.`;
}

/** Under a house on the list: when it was last checked, or that it never was. */
export function lastVerifiedLine(house: Pick<UnverifiedHouse, "lastVerifiedOn">): string {
  return house.lastVerifiedOn ? `Verificada por última vez el ${calendarDate(house.lastVerifiedOn)}` : "Nunca verificada";
}

/** The houses grouped under their sector, in the order the server sent them. */
export function bySector(houses: UnverifiedHouse[]): Array<{ sectorName: string; houses: UnverifiedHouse[] }> {
  const groups: Array<{ sectorName: string; houses: UnverifiedHouse[] }> = [];
  for (const house of houses) {
    const last = groups[groups.length - 1];
    if (last && last.sectorName === house.sectorName) {
      last.houses.push(house);
    } else {
      groups.push({ sectorName: house.sectorName, houses: [house] });
    }
  }
  return groups;
}
