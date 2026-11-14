/**
 * "Deuda anterior": what the screens show about the months a house already
 * owed when the app took over, copied from the paper receipt book.
 *
 * The server decides (backend/src/routes/owed.ts): it prices each month, and
 * refuses what cannot be entered or removed. This copy only lets the
 * treasurer see on the screen what each month costs and what is still owed.
 */
import { formatLempiras } from "./census.ts";

/** A month entered as owed, as the household file lists it. */
export interface OwedEntry {
  id: string;
  month: string;
  priceCentavos: number;
  lateFeeCentavos: number | null;
  paidCentavos: number;
  recordedBy: string;
  createdAt: string;
}

export interface HouseOwed {
  startMonth: string | null;
  household: { id: string; code: string; ownerName: string };
  entries: OwedEntry[];
}

/** A month of the grid where old months are tapped: what it would cost, and whether it can be chosen. */
export interface OwedOption {
  month: string;
  priceCentavos: number | null;
  lateFeeCentavos: number | null;
  entered: boolean;
  enteredWithLateFee: boolean;
  paidCentavos: number;
}

/** The oldest year the grid goes back to, as the server allows. */
export const FIRST_YEAR = 2000;

/** The newest year with months before the start month: the start month's own year, unless it is January. */
export function lastOwedYear(startMonth: string): number {
  const year = Number(startMonth.slice(0, 4));
  return startMonth.slice(5, 7) === "01" ? year - 1 : year;
}

const ABBREVIATIONS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

/** "2024-09-01" → "Sep": short enough for three months side by side on a phone, as on a calendar. */
export function monthAbbr(firstDay: string): string {
  return ABBREVIATIONS[Number(firstDay.slice(5, 7)) - 1]!;
}

/** The line under a month's name in the grid. */
export function optionLine(option: OwedOption): string {
  if (option.entered) return "Ya anotado";
  if (option.paidCentavos > 0) return "Tiene pagos";
  if (option.priceCentavos === null) return "Sin cuota";
  if (option.priceCentavos === 0) return "No se cobra";
  return formatLempiras(option.priceCentavos);
}

/** Whether a month can be tapped: it has a price, and is neither entered already nor paid in the app. */
export function optionChoosable(option: OwedOption): boolean {
  return !option.entered && option.paidCentavos === 0 && option.priceCentavos !== null && option.priceCentavos > 0;
}

/**
 * What the entries still owe: the monthly fees not yet paid, and their late
 * fees. A late fee cannot be paid in the app yet ("Other income" comes
 * later), so every one counts; that piece must take its payments off here.
 */
export function owedTotals(entries: readonly OwedEntry[]): { feesCentavos: number; lateFeesCentavos: number } {
  return entries.reduce(
    (totals, entry) => ({
      feesCentavos: totals.feesCentavos + Math.max(entry.priceCentavos - entry.paidCentavos, 0),
      lateFeesCentavos: totals.lateFeesCentavos + (entry.lateFeeCentavos ?? 0),
    }),
    { feesCentavos: 0, lateFeesCentavos: 0 },
  );
}

/** "Debe L 140.00 de cuotas anteriores, más L 20.00 de mora.", or that it owes none. */
export function owedSummary(entries: readonly OwedEntry[]): string {
  const { feesCentavos, lateFeesCentavos } = owedTotals(entries);
  const mora = lateFeesCentavos > 0 ? `${formatLempiras(lateFeesCentavos)} de mora` : "";
  if (feesCentavos === 0) {
    return mora ? `Las cuotas anteriores están pagadas. Queda ${mora}.` : "Las cuotas anteriores están pagadas.";
  }
  return `Debe ${formatLempiras(feesCentavos)} de cuotas anteriores${mora ? `, más ${mora}` : ""}.`;
}
