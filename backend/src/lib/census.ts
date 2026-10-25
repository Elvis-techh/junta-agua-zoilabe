/**
 * Census rules shared by the routes (docs/app-plan.md, "Module 1: Census"):
 * how names are written, how ID numbers and phones are masked, household
 * codes, and the Spanish words for each choice.
 */

/** Words that stay lowercase inside a name: "María de los Ángeles". */
const NAME_PARTICLES = new Set(["de", "del", "la", "las", "los", "y"]);

/**
 * "  juan  PÉREZ de la cruz " → "Juan Pérez de la Cruz". The plan asks for
 * names to be capitalized automatically, so the list reads the same whoever
 * typed it. The first word is always capitalized, even a particle.
 */
export function capitalizeName(value: string): string {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word, index) => {
      const lower = word.toLocaleLowerCase("es-HN");
      if (index > 0 && NAME_PARTICLES.has(lower)) {
        return lower;
      }
      // Hyphenated surnames get both halves: "Gómez-Rivera".
      return lower
        .split("-")
        .map((part) => part.charAt(0).toLocaleUpperCase("es-HN") + part.slice(1))
        .join("-");
    })
    .join(" ");
}

/**
 * The server masks, not the screen (App Plan, Security). Without
 * `census:view_sensitive` only the last digits are sent: "•••••••••2345".
 */
export function maskDigits(value: string | null, visible: number): string | null {
  if (value === null) {
    return null;
  }
  return "•".repeat(Math.max(0, value.length - visible)) + value.slice(-visible);
}

/** "Z-0001": sequential, never reused, four digits until the ten-thousandth house. */
export function householdCode(sequence: number): string {
  return `Z-${String(sequence).padStart(4, "0")}`;
}

export const RELATIONS = {
  owner: "Dueño/a",
  renter: "Inquilino/a",
  caretaker: "Cuidador/a",
  other: "Otro",
} as const;

export const WATER_CONNECTIONS = {
  connected: "Conectada",
  not_connected: "Sin conexión",
  shared: "Compartida",
} as const;

/** Why a record was made inactive (App Plan, Module 1: "No deletion"). */
export const INACTIVE_REASONS = {
  moved_away: "Se mudó",
  duplicate: "Registro repetido",
  entered_by_mistake: "Ingresado por error",
} as const;

export type Relation = keyof typeof RELATIONS;
export type WaterConnection = keyof typeof WATER_CONNECTIONS;
export type InactiveReason = keyof typeof INACTIVE_REASONS;

export const RELATION_CODES = Object.keys(RELATIONS) as [Relation, ...Relation[]];
export const WATER_CONNECTION_CODES = Object.keys(WATER_CONNECTIONS) as [WaterConnection, ...WaterConnection[]];
export const INACTIVE_REASON_CODES = Object.keys(INACTIVE_REASONS) as [InactiveReason, ...InactiveReason[]];

/** "L 70.00" — money is whole centavos, shown as lempiras. */
export function formatLempiras(centavos: number): string {
  const sign = centavos < 0 ? "-" : "";
  const absolute = Math.abs(centavos);
  const whole = Math.floor(absolute / 100).toLocaleString("en-US");
  return `${sign}L ${whole}.${String(absolute % 100).padStart(2, "0")}`;
}
