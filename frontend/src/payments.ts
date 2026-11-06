/**
 * Cobrar: what the payment screens show and check before anything is sent.
 *
 * The server decides (backend/src/lib/payments.ts): it shares the money
 * among the months again and refuses what does not fit. This copy only lets
 * the treasurer see the problem on the screen where it can be fixed, and
 * shows on "¿Está correcto?" how the money will be shared.
 */
import { monthLabel } from "./calendar.ts";
import { formatLempiras } from "./census.ts";

export type PaymentMethod = "cash" | "transfer" | "other";

export const PAYMENT_METHODS: Record<PaymentMethod, string> = {
  cash: "Efectivo",
  transfer: "Transferencia",
  other: "Otro",
};

/** One month of one house, as the server reports it. */
export interface MonthState {
  month: string;
  priceCentavos: number | null;
  paidCentavos: number;
}

export interface HouseMonths {
  today: string;
  thisMonth: string;
  latestMonth: string;
  household: { id: string; code: string; status: "active" | "inactive"; waterConnection: string; ownerName: string };
  months: MonthState[];
}

export interface Payment {
  id: string;
  occurredOn: string;
  amountCentavos: number;
  paymentMethod: PaymentMethod;
  bankReference: string | null;
  paperReceiptNumber: string;
  payerName: string | null;
  note: string | null;
  recordedBy: string;
  createdAt: string;
  reversed: boolean;
  repeatedReceipt: boolean;
  shares: Array<{ month: string; amountCentavos: number; priceCentavos: number }>;
}

/** "2026-11-01" → "noviembre de 2026". */
export function monthName(firstDay: string): string {
  return monthLabel(firstDay.slice(0, 7));
}

/** "2026-11-01" → "Noviembre". */
export function shortMonth(firstDay: string): string {
  const name = monthName(firstDay).replace(/ de \d{4}$/, "");
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** "octubre y noviembre de 2026", "diciembre de 2026 y enero de 2027". */
export function monthList(months: readonly string[]): string {
  const names = months.map((month, index) =>
    index < months.length - 1 && months[index + 1]!.slice(0, 4) === month.slice(0, 4)
      ? monthName(month).replace(/ de \d{4}$/, "")
      : monthName(month),
  );
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} y ${names.at(-1)}`;
}

export type MonthStatus =
  | { kind: "no_fee" }
  | { kind: "free" }
  | { kind: "paid" }
  | { kind: "partial"; owedCentavos: number }
  | { kind: "unpaid"; owedCentavos: number };

export function monthStatus(state: MonthState): MonthStatus {
  if (state.priceCentavos === null) return { kind: "no_fee" };
  if (state.priceCentavos === 0) return { kind: "free" };
  const owed = state.priceCentavos - state.paidCentavos;
  if (owed <= 0) return { kind: "paid" };
  return state.paidCentavos > 0 ? { kind: "partial", owedCentavos: owed } : { kind: "unpaid", owedCentavos: owed };
}

/** The line under a month's name in the list. */
export function statusLine(state: MonthState): string {
  const status = monthStatus(state);
  switch (status.kind) {
    case "no_fee":
      return "Sin cuota";
    case "free":
      return "No se cobra";
    case "paid":
      return "Pagado";
    case "partial":
      return `Faltan ${formatLempiras(status.owedCentavos)}`;
    case "unpaid":
      return formatLempiras(status.owedCentavos);
  }
}

/** Whether a month can be chosen: it has a price and something left to pay. */
export function choosable(state: MonthState): boolean {
  const kind = monthStatus(state).kind;
  return kind === "partial" || kind === "unpaid";
}

/** What the chosen months still owe together. */
export function owedFor(states: readonly MonthState[]): number {
  return states.reduce((sum, state) => {
    const status = monthStatus(state);
    return status.kind === "partial" || status.kind === "unpaid" ? sum + status.owedCentavos : sum;
  }, 0);
}

export interface Share {
  month: string;
  amountCentavos: number;
  /** What the month still lacks after this payment. */
  leftCentavos: number;
}

/**
 * The money shared among the chosen months, oldest first, or the sentence
 * that says why it does not fit (the same rules as the server's).
 */
export function sharePayment(selected: readonly MonthState[], amountCentavos: number | null): { shares: Share[] } | { problem: string } {
  const months = [...selected].filter(choosable).sort((a, b) => a.month.localeCompare(b.month));
  if (months.length === 0) {
    return { problem: "Elija el mes o los meses que se pagan." };
  }
  if (amountCentavos === null || amountCentavos <= 0) {
    return { problem: "Escriba el monto que se pagó, por ejemplo 70 o 70.50." };
  }
  const owed = owedFor(months);
  if (amountCentavos > owed) {
    return {
      problem:
        `${months.length === 1 ? "Ese mes debe" : "Esos meses deben"} ${formatLempiras(owed)}, ` +
        `y el pago es de ${formatLempiras(amountCentavos)}. Elija más meses o revise el monto.`,
    };
  }
  const shares: Share[] = [];
  let left = amountCentavos;
  for (const state of months) {
    const due = state.priceCentavos! - state.paidCentavos;
    const amount = Math.min(due, left);
    if (amount === 0) break;
    shares.push({ month: state.month, amountCentavos: amount, leftCentavos: due - amount });
    left -= amount;
  }
  if (shares.length < months.length) {
    const unreached = months.slice(shares.length).map((state) => state.month);
    return {
      problem:
        `Con ${formatLempiras(amountCentavos)} se alcanza solo hasta ${monthName(shares.at(-1)!.month)}. ` +
        `Quite ${monthList(unreached)} o revise el monto.`,
    };
  }
  return { shares };
}
