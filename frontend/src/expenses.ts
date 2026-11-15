/**
 * Gasto: what its screens show and check before anything is sent.
 *
 * The server decides (backend/src/routes/expenses.ts) and checks everything
 * again. This copy only lets the treasurer see a problem on the screen where
 * it can be fixed.
 */
import type { PaymentMethod } from "./payments.ts";

/** An expense category, as Configuración has it. `saysWhat`: "Otro gasto", which must say what it is. */
export interface ExpenseCategory {
  id: number;
  name: string;
  saysWhat: boolean;
}

export interface ExpenseSetup {
  today: string;
  categories: ExpenseCategory[];
}

/** The "who and how much" screen's problem, or null when it can go on. */
export function amountProblem(answers: {
  supplier: string;
  amountCentavos: number | null;
  occurredOn: string;
  today: string;
  saysWhat: boolean;
  note: string;
}): string | null {
  if (answers.supplier.trim().length < 2) {
    return "Escriba a quién se le pagó.";
  }
  if (answers.amountCentavos === null || answers.amountCentavos <= 0) {
    return "Escriba el monto que se pagó, por ejemplo 250 o 250.50.";
  }
  if (!answers.occurredOn) {
    return "Elija la fecha del gasto.";
  }
  if (answers.occurredOn > answers.today) {
    return "La fecha del gasto no puede ser después de hoy.";
  }
  if (answers.saysWhat && !answers.note.trim()) {
    return "Escriba de qué es el gasto.";
  }
  return null;
}

/** The "how it was paid" screen's problem, or null. */
export function paidProblem(answers: { method: PaymentMethod | null; bankReference: string }): string | null {
  if (!answers.method) {
    return "Elija cómo se pagó.";
  }
  if (answers.method === "transfer" && !answers.bankReference.trim()) {
    return "Escriba el número de referencia de la transferencia.";
  }
  return null;
}

/**
 * The photo screen's problem, or null: a photo, or "No hay recibo" with why
 * (owner, 15 November 2026).
 */
export function photoProblem(answers: { hasPhoto: boolean; noReceipt: boolean; noPhotoReason: string }): string | null {
  if (answers.hasPhoto) {
    return null;
  }
  if (!answers.noReceipt) {
    return "Tome la foto del recibo o la factura. Si no hay, toque «No hay recibo».";
  }
  if (answers.noPhotoReason.trim().length < 5) {
    return "Escriba por qué no hay recibo.";
  }
  return null;
}

/** One expense, as the server reports it. */
export interface ExpenseEntry {
  id: string;
  categoryId: number;
  category: string;
  supplier: string;
  occurredOn: string;
  amountCentavos: number;
  paymentMethod: PaymentMethod;
  bankReference: string | null;
  /** The number on the supplier's invoice or receipt, when it has one. */
  invoiceNumber: string | null;
  note: string | null;
  /** Why it has no photo. */
  noPhotoReason: string | null;
  hasPhoto: boolean;
  recordedBy: string;
  createdAt: string;
  repeatedInvoice: boolean;
  reversed: boolean;
  reversal: { id: string; occurredOn: string; reason: string; recordedBy: string; createdAt: string } | null;
}

/** Where the phone asks for an expense's photo. Only someone who may see finances gets it. */
export function photoAddress(id: string): string {
  return `/api/finance/expenses/${id}/photo`;
}
