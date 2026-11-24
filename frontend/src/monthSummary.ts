/**
 * Resumen del mes (owner, 19 November 2026): what the screens say about a
 * month, as backend/src/lib/monthSummary.ts works it out. The server counts
 * everything; this only turns its answer into the board's words, and groups
 * it for the screen.
 */
import { formatLempiras } from "./census.ts";
import type { Money, MonthFigures, MonthStatus } from "./monthClose.ts";
import type { PaymentMethod } from "./payments.ts";
import { PAYMENT_METHODS, monthList, monthName } from "./payments.ts";

export interface SummaryEntry {
  id: string;
  kind: "income" | "expense";
  category: string;
  occurredOn: string;
  /** As written: a reversal is negative. */
  amountCentavos: number;
  /** What the line adds to this month: 0 for an entry undone in the same month. */
  countsCentavos: number;
  paymentMethod: PaymentMethod | null;
  householdId: string | null;
  householdCode: string | null;
  ownerName: string | null;
  payerName: string | null;
  supplier: string | null;
  monthsCovered: string[] | null;
  paperReceiptNumber: string | null;
  note: string | null;
  hasPhoto: boolean;
  noPhotoReason: string | null;
  recordedBy: string;
  reversedOn: string | null;
  reversalReason: string | null;
  /** On a reversal of an earlier month's entry: that entry's date. */
  undoesOn: string | null;
}

export interface FeeHouse {
  id: string;
  code: string;
  ownerName: string | null;
  sectorName: string | null;
  priceCentavos: number;
  /** Paid towards the month, whenever: ahead, on time or late. */
  paidCentavos: number;
  /** The month's late fee still owed; 0 when none is. */
  lateFeeCentavos: number;
}

export interface FeeSummary {
  dueOn: string;
  lateAfter: string;
  pastDeadline: boolean;
  lateFeesFrom: string | null;
  /** Every house charged the month's fee, by name. */
  houses: FeeHouse[];
  chargedCentavos: number;
  paidCentavos: number;
  owedCentavos: number;
  lateFeesCentavos: number;
}

export interface MonthSummary {
  month: string;
  today: string;
  thisMonth: string;
  openingMonth: string;
  status: MonthStatus;
  figures: MonthFigures;
  entries: SummaryEntry[];
  fee: FeeSummary;
}

/** The screens a summary opens: what came in, what was spent, the month's fee, and its document. */
export type SummaryPart = "entradas" | "gastos" | "cuota" | "documento";

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** "2026-11-05" → "5 de noviembre"; with the year when it is not `year`'s: "8 de octubre de 2025". */
export function dayName(date: string, year?: string): string {
  const words = `${Number(date.slice(8, 10))} de ${MONTHS[Number(date.slice(5, 7)) - 1]}`;
  return year && date.slice(0, 4) === year ? words : `${words} de ${date.slice(0, 4)}`;
}

function total(money: Money): number {
  return money.cashCentavos + money.bankCentavos + money.otherCentavos;
}

function houses(count: number): string {
  return count === 1 ? "1 casa" : `${count} casas`;
}

/** The close's status, beside the way back: a month in progress is not "sin cerrar" yet. */
export function summaryStatus(summary: Pick<MonthSummary, "status" | "month" | "thisMonth">): { words: string; tone: "ok" | "warn" } {
  if (summary.status === "closed") return { words: "Cerrado", tone: "ok" };
  if (summary.status === "prepared") return { words: "Cierre por aprobar", tone: "warn" };
  return summary.month === summary.thisMonth ? { words: "Mes en curso", tone: "ok" } : { words: "Sin cerrar", tone: "warn" };
}

/**
 * The money card: at the start, what came in, what went out, and what is
 * left, the box, the bank and "Otro" together. The month in progress says
 * what there is now; Caja and Banco apart are on the line under it.
 */
export function moneyLines(summary: Pick<MonthSummary, "figures" | "month" | "thisMonth">): Array<{ label: string; amount: string }> {
  const { figures } = summary;
  return [
    { label: "Al empezar el mes", amount: formatLempiras(total(figures.opening)) },
    { label: "Entró", amount: `+ ${formatLempiras(total(figures.income))}` },
    { label: "Salió", amount: `− ${formatLempiras(total(figures.expense))}` },
    { label: summary.month === summary.thisMonth ? "Hay ahora" : "Al terminar el mes", amount: formatLempiras(total(figures.expected)) },
  ];
}

/** "Caja L 1,190.00 · Banco L 5,200.00", and "Otro" only when something was paid that way. */
export function placesLine(money: Money): string {
  const parts = [`Caja ${formatLempiras(money.cashCentavos)}`, `Banco ${formatLempiras(money.bankCentavos)}`];
  if (money.otherCentavos !== 0) parts.push(`Otro ${formatLempiras(money.otherCentavos)}`);
  return parts.join(" · ");
}

/** What a house still owes of the month: what is left of its fee, and its late fee. */
export function houseOwes(house: FeeHouse): number {
  return Math.max(house.priceCentavos - house.paidCentavos, 0) + house.lateFeeCentavos;
}

/** Those who still owe something of the month (its fee or its late fee), and those who owe nothing of it. */
export function feeGroups(fee: Pick<FeeSummary, "houses">): { owing: FeeHouse[]; upToDate: FeeHouse[] } {
  return {
    owing: fee.houses.filter((house) => houseOwes(house) > 0),
    upToDate: fee.houses.filter((house) => houseOwes(house) === 0),
  };
}

/**
 * The fee card, in a few lines: how many houses were charged and how much,
 * how many owe nothing of it, how many still owe, and what is left to
 * collect. Before the deadline nobody is late: it says until when.
 */
export function feeLines(fee: FeeSummary, month: string): string[] {
  const { owing, upToDate } = feeGroups(fee);
  if (fee.houses.length === 0) return [`No se cobró la cuota de ${monthName(month)} a ninguna casa.`];
  const lines = [
    `Se cobró a ${houses(fee.houses.length)}: ${formatLempiras(fee.chargedCentavos)}`,
    upToDate.length === 1 ? "1 casa pagó todo" : `${upToDate.length} casas pagaron todo`,
    fee.pastDeadline
      ? owing.length === 1
        ? "1 casa debe"
        : `${owing.length} casas deben`
      : owing.length === 1
        ? "1 casa todavía no paga todo"
        : `${owing.length} casas todavía no pagan todo`,
  ];
  if (fee.owedCentavos > 0 || fee.lateFeesCentavos > 0) {
    lines.push(
      fee.lateFeesCentavos > 0
        ? `Falta cobrar: ${formatLempiras(fee.owedCentavos)} de cuota y ${formatLempiras(fee.lateFeesCentavos)} de mora`
        : `Falta cobrar: ${formatLempiras(fee.owedCentavos)}`,
    );
  }
  if (!fee.pastDeadline) lines.push(`Se paga hasta el ${dayName(fee.lateAfter, month.slice(0, 4))}.`);
  return lines;
}

/** Under a house's name: how it stands with the month's fee and its late fee. */
export function feeHouseLine(house: FeeHouse, pastDeadline: boolean): string {
  const price = formatLempiras(house.priceCentavos);
  const lateFee = house.lateFeeCentavos > 0 ? ` y debe ${formatLempiras(house.lateFeeCentavos)} de mora` : "";
  if (house.paidCentavos >= house.priceCentavos) {
    return house.lateFeeCentavos > 0
      ? `Pagó la cuota tarde: falta la mora, ${formatLempiras(house.lateFeeCentavos)}`
      : `Pagó ${price}`;
  }
  if (house.paidCentavos > 0) return `Pagó ${formatLempiras(house.paidCentavos)} de ${price}${lateFee}`;
  return pastDeadline ? `No ha pagado la cuota de ${price}${lateFee}` : `Todavía no paga la cuota de ${price}`;
}

export interface EntryGroup {
  category: string;
  /** What the group adds to the month: the figures' line for its category. */
  totalCentavos: number;
  entries: SummaryEntry[];
}

/**
 * What came in, or what was spent, by category: the largest first, as the
 * month close lists them, then any whose entries cancel out (an entry
 * undone in the same month).
 */
export function entryGroups(summary: Pick<MonthSummary, "entries">, kind: SummaryEntry["kind"]): EntryGroup[] {
  const groups = new Map<string, EntryGroup>();
  for (const entry of summary.entries.filter((e) => e.kind === kind)) {
    const group = groups.get(entry.category) ?? { category: entry.category, totalCentavos: 0, entries: [] };
    group.totalCentavos += entry.countsCentavos;
    group.entries.push(entry);
    groups.set(entry.category, group);
  }
  return [...groups.values()].sort(
    (a, b) => Number(a.totalCentavos === 0) - Number(b.totalCentavos === 0) || b.totalCentavos - a.totalCentavos || a.category.localeCompare(b.category, "es"),
  );
}

/** Who the money came from or went to: "Ana López" (the house's code is on the line under it), "Iglesia del pueblo", "Ferretería El Puente". */
export function entryWho(entry: SummaryEntry): string {
  if (entry.kind === "expense") return entry.supplier ?? "Sin nombre";
  if (entry.householdCode) return entry.ownerName ?? "Sin nombre";
  return entry.payerName ?? "Sin nombre";
}

/** What it was for: "Cuota de octubre y noviembre de 2026", "Mora de mayo de 2026", or its note. */
export function entryWhat(entry: SummaryEntry): string | null {
  if (entry.category === "Cuota mensual" && entry.monthsCovered?.length) return `Cuota de ${monthList(entry.monthsCovered)}`;
  if (entry.category === "Mora" && entry.monthsCovered?.length) return `Mora de ${monthName(entry.monthsCovered[0]!)}`;
  return entry.note;
}

/** The small line: "Z-0001 · 5 de noviembre · Recibo nº 4001 · Efectivo", or the supplier's invoice for an expense. */
export function entryDetails(entry: SummaryEntry, month: string): string {
  const parts = [dayName(entry.occurredOn, month.slice(0, 4))];
  if (entry.householdCode) parts.unshift(entry.householdCode);
  if (entry.paperReceiptNumber) parts.push(`${entry.kind === "expense" ? "Factura" : "Recibo"} nº ${entry.paperReceiptNumber}`);
  if (entry.paymentMethod) parts.push(PAYMENT_METHODS[entry.paymentMethod]);
  return parts.join(" · ");
}

/**
 * Why a line counts differently, or null when it simply counts: an entry
 * undone ("Anulado") this month or later, or the reversal of an earlier
 * month's entry, which takes it off this month.
 */
export function undoneLine(entry: SummaryEntry, month: string): string | null {
  const year = month.slice(0, 4);
  const why = entry.reversalReason ? `: ${entry.reversalReason}` : "";
  if (entry.undoesOn) return `Se anuló lo anotado el ${dayName(entry.undoesOn, year)}${why}. Se descuenta este mes.`;
  if (!entry.reversedOn) return null;
  return entry.countsCentavos === 0
    ? `Anulado el ${dayName(entry.reversedOn, year)}${why}. No cuenta.`
    : `Anulado el ${dayName(entry.reversedOn, year)}${why}. Se descuenta en ${monthName(`${entry.reversedOn.slice(0, 7)}-01`)}.`;
}

/**
 * The fee on the summary, in two short lines, so the whole month fits on a
 * phone: how many houses paid it all, and what is left to collect, late
 * fees included. The fee's own screen says how much of it is late fees,
 * and until when the month in progress is paid.
 */
export function feeCardLines(fee: FeeSummary): string[] {
  if (fee.houses.length === 0) return ["No se cobró a ninguna casa."];
  const { upToDate } = feeGroups(fee);
  const left = fee.owedCentavos + fee.lateFeesCentavos;
  return [
    `Pagaron todo: ${upToDate.length} de ${houses(fee.houses.length)}`,
    left === 0 ? "No falta nada por cobrar." : `Falta cobrar: ${formatLempiras(left)}${fee.lateFeesCentavos > 0 ? " con mora" : ""}`,
  ];
}

/** "octubre", or "octubre de 2025" when it is not this year's: short enough for a title on a phone. */
export function monthWords(month: string, thisMonth: string): string {
  const name = monthName(month);
  return month.slice(0, 4) === thisMonth.slice(0, 4) ? name.replace(/ de \d{4}$/, "") : name;
}

/** Every month there is a summary for, newest first: from this month back to the opening balance's. */
export function summaryMonths(summary: Pick<MonthSummary, "openingMonth" | "thisMonth">): string[] {
  const list: string[] = [];
  let index = Number(summary.thisMonth.slice(0, 4)) * 12 + Number(summary.thisMonth.slice(5, 7)) - 1;
  for (;;) {
    const month = `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}-01`;
    if (month < summary.openingMonth) return list;
    list.push(month);
    index -= 1;
  }
}

/** Said in the month picker when there is no other month yet: why the choice is only this one. */
export function onlyMonthLine(summary: Pick<MonthSummary, "openingMonth" | "thisMonth">): string {
  const opening = monthName(summary.openingMonth);
  return summary.openingMonth === summary.thisMonth
    ? `Por ahora solo hay este mes: el saldo de la junta empezó en ${opening}. Cuando empiece el próximo mes, lo podrá escoger aquí.`
    : "";
}

/** The total of the box, the bank and "Otro": what the money card and the parts' headings show. */
export function moneyTotal(money: Money): number {
  return total(money);
}

/** The screen's address for a month, and for one of its parts. */
export function summaryRoute(month: string, part?: SummaryPart): `/finanzas/resumen/${string}` {
  return part ? `/finanzas/resumen/${month}/${part}` : `/finanzas/resumen/${month}`;
}
