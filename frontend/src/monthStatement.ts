/**
 * Estado financiero del mes (owner, 23 November 2026; App Plan, Module 5:
 * "Monthly financial statement"): the month's summary as a document, as the
 * screen shows it, as the picture draws it and as the WhatsApp text says it.
 *
 * The server counts everything (backend/src/routes/monthSummary.ts). Here it
 * is only put into the lines every document uses (src/statement.ts), once,
 * so the three cannot say different things, and so it looks like a house's
 * statement and a receipt.
 *
 * It carries totals, never names of the houses that owe: a document is sent
 * and forwarded, and who may be told who owes is the board's decision, not
 * this file's. Who owes is on Resumen del mes and Quién debe.
 */
import { formatLempiras } from "./census.ts";
import { monthTitle } from "./monthClose.ts";
import type { MonthSummary, SummaryEntry } from "./monthSummary.ts";
import { dayName, feeLines, moneyLines, moneyTotal, placesLine, summaryStatus } from "./monthSummary.ts";
import { monthName } from "./payments.ts";
import type { StatementDocument, StatementLine } from "./statement.ts";
import { BOARD_NAME, calendarDate, dateAndTime, linesToText } from "./statement.ts";

/** What the document says of the close: a month that is not closed may still change. */
function statusLine(summary: MonthSummary): string {
  const { words } = summaryStatus(summary);
  if (summary.status === "closed") return `${words}: las cifras ya no cambian.`;
  if (summary.month === summary.thisMonth) return `${words}: las cifras son de hoy y pueden cambiar.`;
  return `${words}: las cifras pueden cambiar.`;
}

/** "42 anotaciones", "1 anotación": the entries of a category that count in the month. */
function countOf(entries: readonly SummaryEntry[], category: string): string | undefined {
  const count = entries.filter((entry) => entry.category === category && entry.countsCentavos !== 0).length;
  return count === 0 ? undefined : count === 1 ? "1 anotación" : `${count} anotaciones`;
}

/** The month's document, line by line. `document` is there once it was handed out. */
export function monthStatementLines(summary: MonthSummary, document: StatementDocument | null): StatementLine[] {
  const { figures, entries, fee } = summary;
  const year = summary.month.slice(0, 4);
  const lines: StatementLine[] = [
    { kind: "title", text: BOARD_NAME },
    { kind: "heading", text: document ? `Estado financiero nº ${document.number}` : "Estado financiero del mes" },
    { kind: "text", text: monthTitle(summary.month) },
    { kind: "small", text: `Al ${calendarDate(summary.today)}` },
    { kind: "small", text: statusLine(summary) },
    { kind: "heading", text: "El dinero" },
  ];

  const money = moneyLines(summary);
  const [opening, came, went, left] = money;
  lines.push(
    { kind: "row", text: opening!.label, amount: opening!.amount, sub: placesLine(figures.opening) },
    { kind: "row", text: came!.label, amount: came!.amount },
    { kind: "row", text: went!.label, amount: went!.amount },
    { kind: "total", text: left!.label, amount: left!.amount, sub: placesLine(figures.expected) },
  );

  // What came in: by category, with how many entries, as the month close lists them.
  lines.push({ kind: "heading", text: "Lo que entró" });
  if (figures.incomeLines.length === 0) {
    lines.push({ kind: "text", text: "No entró dinero este mes." });
  } else {
    lines.push(
      ...figures.incomeLines.map((line) => {
        const sub = countOf(entries, line.category);
        return { kind: "row" as const, text: line.category, amount: formatLempiras(line.amountCentavos), ...(sub ? { sub } : {}) };
      }),
      { kind: "total", text: "Total que entró", amount: formatLempiras(moneyTotal(figures.income)) },
    );
  }

  // What was spent: each expense, to whom and on what, as a fiscal reads it.
  lines.push({ kind: "heading", text: "Lo que se gastó" });
  const spent = entries.filter((entry) => entry.kind === "expense" && entry.countsCentavos !== 0);
  if (spent.length === 0) {
    lines.push({ kind: "text", text: "No se gastó dinero este mes." });
  } else {
    lines.push(
      ...spent.map((entry) => ({
        kind: "row" as const,
        text: `${entry.category}: ${entry.supplier ?? "Sin nombre"}`,
        amount: formatLempiras(entry.countsCentavos),
        sub: [dayName(entry.occurredOn, year), entry.paperReceiptNumber ? `factura nº ${entry.paperReceiptNumber}` : null].filter(Boolean).join(" · "),
      })),
      { kind: "total", text: "Total que se gastó", amount: formatLempiras(moneyTotal(figures.expense)) },
    );
  }

  lines.push({ kind: "heading", text: `Cuota de ${monthName(summary.month)}` });
  lines.push(...feeLines(fee, summary.month).map((text) => ({ kind: "text" as const, text })));

  if (document) {
    lines.push({ kind: "small", text: `Hecho por ${document.madeBy} el ${dateAndTime(document.madeAt)} · Documento nº ${document.number}` });
  }
  return lines;
}

/** The document as a WhatsApp message: the same lines, as plain text. */
export function monthStatementText(summary: MonthSummary, document: StatementDocument): string {
  return linesToText(monthStatementLines(summary, document));
}

/** "estado-financiero-2026-10-n14.png": the picture's name when it is shared or saved. */
export function monthStatementFileName(summary: MonthSummary, document: StatementDocument): string {
  return `estado-financiero-${summary.month.slice(0, 7)}-n${document.number}.png`;
}
