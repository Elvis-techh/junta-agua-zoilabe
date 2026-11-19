/**
 * Cobrar: after the house, "¿Qué está pagando?". The monthly fee goes to
 * the months screen; anything else goes to Otro ingreso for that house,
 * with what it is already answered (owner, 19 November 2026).
 */
import type { IncomeType } from "./income.ts";
import { INCOME_TYPES } from "./income.ts";

export type CollectKind = "fee" | IncomeType;

/** The choices, in the order they show: the monthly fee first, the usual case. */
export const COLLECT_KINDS: ReadonlyArray<{ kind: CollectKind; label: string }> = [
  { kind: "fee", label: "Cuota mensual" },
  ...(Object.keys(INCOME_TYPES) as IncomeType[]).map((kind) => ({ kind, label: INCOME_TYPES[kind] })),
];

/** Otro ingreso opened from Cobrar: what it is, and that "Atrás" goes back to Cobrar. */
export interface IncomePreset {
  incomeType: IncomeType;
  fromCollect: true;
}

/** Where a choice goes, and what it is opened with. */
export function collectTarget(
  kind: CollectKind,
  householdId: string,
): { route: `/finanzas/cobrar/${string}` } | { route: `/finanzas/ingreso/${string}`; preset: IncomePreset } {
  return kind === "fee"
    ? { route: `/finanzas/cobrar/${householdId}` }
    : { route: `/finanzas/ingreso/${householdId}`, preset: { incomeType: kind, fromCollect: true } };
}

/** The census in the order someone scrolls it: by name, the way Spanish sorts (Ángel with Andrés). */
export function byOwnerName<T extends { ownerName: string; code: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => a.ownerName.localeCompare(b.ownerName, "es", { sensitivity: "base" }) || a.code.localeCompare(b.code));
}
