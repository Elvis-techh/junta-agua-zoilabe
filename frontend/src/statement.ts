/**
 * Estado de cuenta: a house's statement, as the screen shows it, as the
 * picture draws it and as the WhatsApp text says it.
 *
 * The server works out what was paid and what is owed
 * (backend/src/routes/statements.ts). Here it is only put into lines, once,
 * so the three can never say different things.
 */
import { formatLempiras } from "./census.ts";
import type { IncomeType } from "./income.ts";
import { incomeTitle } from "./income.ts";
import { monthList, monthName } from "./payments.ts";
import { whatsappNumber } from "./phone.ts";
import { formatDate } from "./time.ts";

export const BOARD_NAME = "Junta de Agua de Zoilabe";

export interface Statement {
  today: string;
  /** The first month whose payments are listed, as its first day. */
  from: string;
  household: { id: string; code: string; ownerName: string; sectorName: string | null };
  payments: Array<{ id: string; occurredOn: string; amountCentavos: number; paperReceiptNumber: string | null; months: string[] }>;
  otherIncome: Array<{
    id: string;
    type: IncomeType;
    occurredOn: string;
    amountCentavos: number;
    paperReceiptNumber: string | null;
    /** The month a late fee covers. */
    month: string | null;
    note: string | null;
  }>;
  paidCentavos: number;
  owed: {
    months: Array<{ month: string; owedCentavos: number }>;
    lateFees: Array<{ month: string; amountCentavos: number }>;
    monthsCentavos: number;
    lateFeesCentavos: number;
    totalCentavos: number;
  };
}

/** What a statement that was handed out carries: its number, who made it and when. */
export interface StatementDocument {
  number: number;
  madeAt: string;
  madeBy: string;
}

/**
 * One line of a statement. `title` is the board's name, `heading` starts a
 * part, `row` is an entry with its amount on the right and a smaller line
 * under it, `total` a sum, `text` a sentence and `small` the fine print.
 */
export interface StatementLine {
  kind: "title" | "heading" | "row" | "total" | "text" | "small";
  text: string;
  /** An amount, at the right. */
  amount?: string;
  /** Under a row: when, and on which receipt. */
  sub?: string;
}

/** "3 de marzo de 2026" for a calendar date. */
const calendarDate = (date: string) => formatDate(`${date}T12:00:00Z`);

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

const whenAndReceipt = (entry: { occurredOn: string; paperReceiptNumber: string | null }) =>
  `${calendarDate(entry.occurredOn)}${entry.paperReceiptNumber ? ` · recibo nº ${entry.paperReceiptNumber}` : ""}`;

/** The statement, line by line, top to bottom. `document` is there once it was handed out. */
export function statementLines(statement: Statement, document: StatementDocument | null): StatementLine[] {
  const { household, owed } = statement;
  const lines: StatementLine[] = [
    { kind: "title", text: BOARD_NAME },
    { kind: "heading", text: document ? `Estado de cuenta nº ${document.number}` : "Estado de cuenta" },
    { kind: "text", text: `Vivienda ${household.code}${household.sectorName ? ` · ${household.sectorName}` : ""}` },
    { kind: "text", text: household.ownerName },
    { kind: "small", text: `Al ${calendarDate(statement.today)}` },
    { kind: "heading", text: `Pagos desde ${monthName(statement.from)}` },
  ];

  // Everything the house paid, oldest first, whatever it was for.
  const paid = [
    ...statement.payments.map((payment) => ({
      occurredOn: payment.occurredOn,
      line: {
        kind: "row" as const,
        text: `Cuota de ${monthList(payment.months)}`,
        amount: formatLempiras(payment.amountCentavos),
        sub: whenAndReceipt(payment),
      },
    })),
    ...statement.otherIncome.map((entry) => ({
      occurredOn: entry.occurredOn,
      line: {
        kind: "row" as const,
        text: entry.type === "other" && entry.note ? entry.note : incomeTitle(entry.type, entry.month),
        amount: formatLempiras(entry.amountCentavos),
        sub: whenAndReceipt(entry),
      },
    })),
  ].sort((a, b) => a.occurredOn.localeCompare(b.occurredOn));
  if (paid.length === 0) {
    lines.push({ kind: "text", text: `No hay pagos anotados desde ${monthName(statement.from)}.` });
  } else {
    lines.push(...paid.map((entry) => entry.line));
    lines.push({ kind: "total", text: "Total pagado", amount: formatLempiras(statement.paidCentavos) });
  }

  lines.push({ kind: "heading", text: "Lo que debe hoy" });
  if (owed.totalCentavos === 0) {
    lines.push({ kind: "text", text: "Está al día: no debe nada." });
  } else {
    lines.push(
      ...owed.months.map((state) => ({ kind: "row" as const, text: `Cuota de ${monthName(state.month)}`, amount: formatLempiras(state.owedCentavos) })),
      ...owed.lateFees.map((fee) => ({ kind: "row" as const, text: `Mora de ${monthName(fee.month)}`, amount: formatLempiras(fee.amountCentavos) })),
      { kind: "total", text: "Total que debe", amount: formatLempiras(owed.totalCentavos) },
    );
  }

  if (document) {
    lines.push({ kind: "small", text: `Hecho por ${document.madeBy} el ${dateAndTime(document.madeAt)} · Documento nº ${document.number}` });
  }
  return lines;
}

/** The statement as a WhatsApp message: the same lines, as plain text. */
export function statementText(statement: Statement, document: StatementDocument): string {
  const out: string[] = [];
  for (const line of statementLines(statement, document)) {
    switch (line.kind) {
      case "title":
        out.push(`*${line.text}*`);
        break;
      case "heading":
        out.push("", `*${line.text}*`);
        break;
      case "row":
        out.push(`• ${line.text}: ${line.amount}${line.sub ? ` (${line.sub})` : ""}`);
        break;
      case "total":
        out.push(`*${line.text}: ${line.amount}*`);
        break;
      case "small":
        if (line.text.startsWith("Hecho por")) out.push("");
        out.push(line.text);
        break;
      default:
        out.push(line.text);
    }
  }
  return out.join("\n");
}

/** The family's WhatsApp chat with the statement written in it, or null when there is no number to send it to. */
export function statementWhatsappLink(phone: string | null, text: string): string | null {
  const number = whatsappNumber(phone);
  return number ? `https://wa.me/${number}?text=${encodeURIComponent(text)}` : null;
}

/** "estado-de-cuenta-Z-0012-n12.png": the picture's name when it is shared or saved. */
export function statementFileName(statement: Statement, document: StatementDocument): string {
  return `estado-de-cuenta-${statement.household.code}-n${document.number}.png`;
}
