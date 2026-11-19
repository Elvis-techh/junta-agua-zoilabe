/**
 * Saldo de la junta (owner, 17 November 2026): the opening balance and the
 * money now, as backend/src/lib/balance.ts works them out. Cash is the box,
 * Transferencia the bank; anything paid "Otro" is a line of its own, shown
 * only when there is some.
 */
import { monthLabel } from "./calendar.ts";
import { formatLempiras, parseLempiras } from "./census.ts";

export interface OpeningBalance {
  id: string;
  month: string;
  cashCentavos: number;
  bankCentavos: number;
}

export interface OpeningEntry extends OpeningBalance {
  replacesId: string | null;
  reason: string | null;
  createdAt: string;
  createdBy: string | null;
}

export interface MoneyNow {
  cashCentavos: number;
  bankCentavos: number;
  otherCentavos: number;
  since: string;
  incomeCentavos: number;
  expenseCentavos: number;
}

export interface BalanceData {
  thisMonth: string;
  opening: OpeningBalance | null;
  entries: OpeningEntry[];
  money: MoneyNow | null;
  closedMonth: string | null;
}

/**
 * The lempira digits the cash and bank fields take: up to L 999,999,999.99.
 * Nobody knows how much the box or the account will one day hold (owner,
 * 19 November 2026); backend/src/routes/openingBalance.ts takes the same.
 */
export const BALANCE_WHOLE_DIGITS = 9;

export interface Figures {
  month: string;
  cash: string;
  bank: string;
}

/** The figures as the server takes them, or what is missing, in the order the screen asks. */
export function readFigures(
  figures: Figures,
  thisMonth: string,
): { month: string; cashCentavos: number; bankCentavos: number } | { problem: string } {
  if (!/^\d{4}-\d{2}$/.test(figures.month)) {
    return { problem: "Elija el mes en que empieza el dinero de la aplicación." };
  }
  const month = `${figures.month}-01`;
  if (month > thisMonth) {
    return { problem: "El saldo inicial no puede empezar en un mes que todavía no llega." };
  }
  const cashCentavos = parseLempiras(figures.cash, BALANCE_WHOLE_DIGITS);
  if (cashCentavos === null) {
    return { problem: "Escriba el efectivo que hay en caja, o 0 si no hay." };
  }
  const bankCentavos = parseLempiras(figures.bank, BALANCE_WHOLE_DIGITS);
  if (bankCentavos === null) {
    return { problem: "Escriba el dinero que hay en el banco, o 0 si no hay." };
  }
  return { month, cashCentavos, bankCentavos };
}

/** The lines of "Dinero ahora": Otro only when something was paid that way. */
export function moneyLines(money: MoneyNow): Array<{ label: string; amount: string }> {
  const lines = [
    { label: "En caja", amount: formatLempiras(money.cashCentavos) },
    { label: "En el banco", amount: formatLempiras(money.bankCentavos) },
  ];
  if (money.otherCentavos !== 0) {
    lines.push({ label: "Pagado con «Otro»", amount: formatLempiras(money.otherCentavos) });
  }
  return lines;
}

/** "Al empezar octubre de 2026: efectivo L 2,500.00, banco L 10,000.00". */
export function openingLine(opening: OpeningBalance): string {
  return (
    `Al empezar ${monthLabel(opening.month.slice(0, 7))}: efectivo ${formatLempiras(opening.cashCentavos)}, ` +
    `banco ${formatLempiras(opening.bankCentavos)}`
  );
}

/** What a centavos amount looks like typed back into an AmountInput: 250000 → "2,500". */
export function amountText(centavos: number): string {
  const whole = Math.floor(centavos / 100).toLocaleString("en-US");
  const cents = centavos % 100;
  return cents === 0 ? whole : `${whole}.${String(cents).padStart(2, "0")}`;
}
