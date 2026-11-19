/**
 * Otro ingreso: what its screens show and check before anything is sent.
 *
 * The server decides (backend/src/routes/income.ts) and checks everything
 * again. This copy only lets the treasurer see a problem on the screen where
 * it can be fixed, and fills in the amount Configuración sets for a late
 * fee, a reconnection or a connection.
 */
import { formatLempiras } from "./census.ts";
import type { PaymentMethod } from "./payments.ts";
import { monthName } from "./payments.ts";

export type IncomeType = "late_fee" | "reconnection" | "connection" | "donation" | "other";

/** The words on each choice, the village's own. */
export const INCOME_TYPES: Record<IncomeType, string> = {
  late_fee: "Mora",
  reconnection: "Reconexión",
  connection: "Conexión",
  donation: "Donación",
  other: "Otro ingreso",
};

/** A late fee and a reconnection are always for a house; the others may be from someone outside the census. */
export function needsHouse(type: IncomeType): boolean {
  return type === "late_fee" || type === "reconnection";
}

export type IncomeStep = "type" | "house" | "month" | "amount" | "receipt" | "payer" | "review";

/**
 * The screens an entry asks, in order: what it is only when Cobrar has not
 * already asked, the house only when it is not chosen yet, the month only
 * for a late fee, then the amount, the paper receipt, who paid and
 * "¿Está correcto?".
 */
export function incomeSteps(answers: { askType: boolean; houseChosen: boolean; type: IncomeType | null }): IncomeStep[] {
  return [
    ...(answers.askType ? (["type"] as const) : []),
    ...(answers.houseChosen ? [] : (["house"] as const)),
    ...(answers.type === "late_fee" ? (["month"] as const) : []),
    "amount",
    "receipt",
    "payer",
    "review",
  ];
}

/** "Paso 2 de 4": the steps that count, which leave out what it is and the review. */
export function stepCount(order: readonly IncomeStep[], step: IncomeStep | "saved"): { at: number; of: number } | null {
  const counted: IncomeStep[] = order.filter((s) => s !== "type" && s !== "review");
  const at = counted.indexOf(step as IncomeStep);
  return at < 0 ? null : { at: at + 1, of: counted.length };
}

/** One amount from Configuración and the month it starts. */
export interface Rate {
  startsOn: string;
  amountCentavos: number;
}

export interface IncomeSetup {
  today: string;
  lateFee: Rate[];
  reconnection: Rate[];
  connection: Rate[];
}

/** The amount in force on `day` ("YYYY-MM-DD" or a month's first day), or null while none is set. */
export function rateOn(rates: readonly Rate[], day: string): number | null {
  let found: number | null = null;
  for (const rate of [...rates].sort((a, b) => a.startsOn.localeCompare(b.startsOn))) {
    if (rate.startsOn <= day) {
      found = rate.amountCentavos;
    }
  }
  return found;
}

/**
 * What Configuración says this entry costs: the late fee for the month it
 * covers, or the reconnection or connection fee of the day it is paid.
 * Undefined for a kind with no amount there (a donation, other income);
 * null while Configuración has none.
 */
export function configuredAmount(setup: IncomeSetup, type: IncomeType, month: string, occurredOn: string): number | null | undefined {
  if (type === "late_fee") {
    return month ? rateOn(setup.lateFee, month) : null;
  }
  if (type === "reconnection" || type === "connection") {
    return occurredOn ? rateOn(setup[type], occurredOn) : null;
  }
  return undefined;
}

/** "la mora de octubre de 2026", "la reconexión": what an entry is, for a sentence. */
export function describeIncome(type: IncomeType, month: string | null): string {
  const named: Record<IncomeType, string> = {
    late_fee: "la mora",
    reconnection: "la reconexión",
    connection: "la conexión",
    donation: "la donación",
    other: "el ingreso",
  };
  return type === "late_fee" && month ? `${named.late_fee} de ${monthName(month)}` : named[type];
}

/** "Mora de octubre de 2026", "Donación": an entry's title on its card. */
export function incomeTitle(type: IncomeType, month: string | null): string {
  const text = describeIncome(type, month).replace(/^(la|el) /, "");
  return text === "ingreso" ? INCOME_TYPES.other : text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * The amount screen's problem, or null when it can go on: the amount, the
 * date, Configuración's amount for a late fee, reconnection or connection
 * (another one needs a reason), and what other income is for.
 */
export function amountProblem(answers: {
  type: IncomeType;
  amountCentavos: number | null;
  occurredOn: string;
  today: string;
  configured: number | null | undefined;
  amountReason: string;
  note: string;
  what: string;
}): string | null {
  const { type, amountCentavos, occurredOn, today, configured, what } = answers;
  if (amountCentavos === null || amountCentavos <= 0) {
    return "Escriba el monto que se pagó, por ejemplo 50 o 50.50.";
  }
  if (!occurredOn) {
    return "Elija la fecha del pago.";
  }
  if (occurredOn > today) {
    return "La fecha del pago no puede ser después de hoy.";
  }
  if (configured === null) {
    return `No hay monto para ${what} en Configuración → Cuotas. Pida que lo pongan.`;
  }
  if (configured === 0) {
    return `${capitalize(what)} es de L 0.00 en Configuración: no se cobra.`;
  }
  if (configured !== undefined && amountCentavos !== configured && answers.amountReason.trim().length < 5) {
    return `${capitalize(what)} es de ${formatLempiras(configured)} en Configuración. Si se cobró otro monto, escriba por qué.`;
  }
  if (type === "other" && !answers.note.trim()) {
    return "Escriba de qué es el ingreso.";
  }
  return null;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** One entry of other income, as the server reports it. */
export interface IncomeEntry {
  id: string;
  type: IncomeType;
  householdId: string | null;
  householdCode: string | null;
  occurredOn: string;
  amountCentavos: number;
  /** The month a late fee covers. */
  month: string | null;
  paymentMethod: PaymentMethod;
  bankReference: string | null;
  paperReceiptNumber: string;
  payerName: string | null;
  note: string | null;
  /** Why the amount is not Configuración's. */
  amountReason: string | null;
  recordedBy: string;
  createdAt: string;
  repeatedReceipt: boolean;
  reversed: boolean;
  reversal: { id: string; occurredOn: string; reason: string; recordedBy: string; createdAt: string } | null;
}
