/**
 * Cierre del mes (owner, 19 November 2026): what the screen shows of a
 * month's close, as backend/src/lib/monthClose.ts works it out. Only the
 * cash is counted; a difference needs a reason and is the month's "Faltante"
 * or "Sobrante de caja"; someone else approves it or sends it back.
 */
import { formatLempiras, parseLempiras } from "./census.ts";
import { monthName, shortMonth } from "./payments.ts";

export interface Money {
  cashCentavos: number;
  bankCentavos: number;
  otherCentavos: number;
}

export interface CategoryLine {
  category: string;
  amountCentavos: number;
}

export interface MonthFigures {
  month: string;
  opening: Money;
  income: Money;
  expense: Money;
  expected: Money;
  incomeLines: CategoryLine[];
  expenseLines: CategoryLine[];
}

export type MonthStatus = "open" | "prepared" | "closed";

export interface MonthRow {
  month: string;
  status: MonthStatus;
  cashCountedCentavos: number | null;
  expectedCashCentavos: number | null;
  cashDifferenceReason: string | null;
  preparedById: string | null;
  preparedBy: string | null;
  preparedAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  returnedBy: string | null;
  returnedAt: string | null;
  returnedReason: string | null;
}

export interface MonthDetail {
  row: MonthRow;
  figures: MonthFigures;
}

export interface MonthsData {
  thisMonth: string;
  openingMonth: string | null;
  /** Newest first. */
  months: MonthRow[];
  /** The oldest month not yet closed, with its figures; null when every month that is over is closed. */
  next: MonthDetail | null;
}

/** "Agosto de 2026", for headings. */
export function monthTitle(month: string): string {
  const name = monthName(month);
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** "Agosto 2026", where room is short: the corner of the figures. */
export function monthShort(month: string): string {
  return `${shortMonth(month)} ${month.slice(0, 4)}`;
}

/** One row of the figures: its label, and the cash, the bank and (only when there is some) "Otro". */
export interface FigureRow {
  label: string;
  cash: string;
  bank: string;
  other: string;
}

/** An amount in a column headed "(L)": "3,750.00", "-50.00". Half a phone's width holds "150,000.00" twice. */
export function columnAmount(centavos: number): string {
  return formatLempiras(centavos).replace("L ", "");
}

/**
 * The four rows of a month's figures, Caja and Banco side by side: at its
 * start, what came in, what went out, and what should be there now. The
 * "Otro" column is shown only when something was paid that way.
 */
export function figureRows(figures: MonthFigures): { rows: FigureRow[]; showOther: boolean } {
  const row = (label: string, money: Money): FigureRow => ({
    label,
    cash: columnAmount(money.cashCentavos),
    bank: columnAmount(money.bankCentavos),
    other: columnAmount(money.otherCentavos),
  });
  const showOther = [figures.opening, figures.income, figures.expense, figures.expected].some((money) => money.otherCentavos !== 0);
  return {
    rows: [
      row("Al empezar", figures.opening),
      row("Entró", figures.income),
      row("Salió", figures.expense),
      row("Debe haber", figures.expected),
    ],
    showOther,
  };
}

/** "Entró: Cuota mensual L 2,100.00", one line per category, what came in first. */
export function categoryLines(figures: MonthFigures): string[] {
  return [
    ...figures.incomeLines.map((line) => `Entró: ${line.category} ${formatLempiras(line.amountCentavos)}`),
    ...figures.expenseLines.map((line) => `Salió: ${line.category} ${formatLempiras(line.amountCentavos)}`),
  ];
}

/** What the count says against the app, in the board's words (19 November 2026): "Faltante de caja: L 50.00". */
export function differenceLine(countedCentavos: number, expectedCentavos: number): string {
  const difference = countedCentavos - expectedCentavos;
  if (difference === 0) return "Cuadra con lo que la aplicación espera.";
  return difference < 0 ? `Faltante de caja: ${formatLempiras(-difference)}` : `Sobrante de caja: ${formatLempiras(difference)}`;
}

/** The typed count read as centavos, or why it cannot be sent: the server asks for a reason when it does not match. */
export function readCount(
  counted: string,
  reason: string,
  expectedCentavos: number,
): { cashCountedCentavos: number; expectedCashCentavos: number; reason?: string } | { problem: string } {
  const cashCountedCentavos = parseLempiras(counted);
  if (cashCountedCentavos === null) {
    return { problem: "Escriba el efectivo que se contó en caja, o 0 si no hay." };
  }
  if (cashCountedCentavos === expectedCentavos) {
    return { cashCountedCentavos, expectedCashCentavos: expectedCentavos };
  }
  if (reason.trim().length < 5) {
    return { problem: "No cuadra con lo que la aplicación espera. Escriba por qué." };
  }
  return { cashCountedCentavos, expectedCashCentavos: expectedCentavos, reason: reason.trim() };
}

/** The close's status in a few words, beside the way back: "Cierre abierto", "Cierre por aprobar", "Cerrado". */
export function statusWords(status: MonthStatus): string {
  return status === "closed" ? "Cerrado" : status === "prepared" ? "Cierre por aprobar" : "Cierre abierto";
}
