/**
 * Recibo digital: one money-in entry as a receipt, as the screen shows it,
 * as the picture draws it and as the WhatsApp text says it.
 *
 * The server works out what the receipt is for (backend/src/routes/receipts.ts).
 * Here it is put into the same lines a statement uses (src/statement.ts), so
 * the screen, the picture and the text cannot disagree, and both documents
 * look alike.
 */
import { formatLempiras } from "./census.ts";
import type { IncomeType } from "./income.ts";
import { incomeTitle } from "./income.ts";
import type { PaymentMethod } from "./payments.ts";
import { PAYMENT_METHODS, monthList } from "./payments.ts";
import type { StatementDocument, StatementLine } from "./statement.ts";
import { BOARD_NAME, linesToText } from "./statement.ts";
import { formatDate } from "./time.ts";

/** What a receipt is for: a monthly fee and its months, or another income and its month. */
export type Concept =
  | { kind: "monthly"; months: string[] }
  | { kind: "other"; type: IncomeType; month: string | null; note: string | null };

export interface Receipt {
  today: string;
  transactionId: string;
  household: { code: string; ownerName: string; sectorName: string } | null;
  payerName: string | null;
  occurredOn: string;
  amountCentavos: number;
  paymentMethod: PaymentMethod;
  bankReference: string | null;
  paperReceiptNumber: string | null;
  concept: Concept;
}

/** "3 de marzo de 2026" for a calendar date. */
const calendarDate = (date: string) => formatDate(`${date}T12:00:00Z`);

/** What the receipt is for, in a few words: "Cuota de octubre de 2026", "Mora de mayo de 2026", a note or "Donación". */
export function conceptTitle(concept: Concept): string {
  if (concept.kind === "monthly") {
    return `Cuota de ${monthList(concept.months)}`;
  }
  return concept.type === "other" && concept.note ? concept.note : incomeTitle(concept.type, concept.month);
}

/** The receipt, line by line. `document` is there once it was handed out. */
export function receiptLines(receipt: Receipt, document: StatementDocument | null): StatementLine[] {
  const method =
    PAYMENT_METHODS[receipt.paymentMethod] + (receipt.paymentMethod === "transfer" && receipt.bankReference ? `, referencia ${receipt.bankReference}` : "");
  const sub = [
    calendarDate(receipt.occurredOn),
    method,
    receipt.paperReceiptNumber ? `recibo de papel nº ${receipt.paperReceiptNumber}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const lines: StatementLine[] = [
    { kind: "title", text: BOARD_NAME },
    { kind: "heading", text: document ? `Recibo nº ${document.number}` : "Recibo" },
  ];
  if (receipt.household) {
    lines.push({ kind: "text", text: `Vivienda ${receipt.household.code}${receipt.household.sectorName ? ` · ${receipt.household.sectorName}` : ""}` });
  }
  lines.push(
    { kind: "text", text: `Recibí de ${receipt.payerName ?? receipt.household?.ownerName ?? ""}` },
    { kind: "total", text: conceptTitle(receipt.concept), amount: formatLempiras(receipt.amountCentavos), sub },
  );
  if (document) {
    lines.push({ kind: "small", text: `Hecho por ${document.madeBy} · Documento nº ${document.number}` });
  }
  return lines;
}

/** The receipt as a WhatsApp message: the same lines, as plain text. */
export function receiptText(receipt: Receipt, document: StatementDocument): string {
  return linesToText(receiptLines(receipt, document));
}

/** "recibo-Z-0012-n13.png": the picture's name when it is shared or saved. */
export function receiptFileName(receipt: Receipt, document: StatementDocument): string {
  return `recibo-${receipt.household?.code ?? "ingreso"}-n${document.number}.png`;
}
