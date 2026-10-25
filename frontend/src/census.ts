/**
 * Census words and small rules the screens share. The server applies the
 * same rules again (backend/src/lib/census.ts); these only let the review
 * screen show what will be saved.
 */

const NAME_PARTICLES = new Set(["de", "del", "la", "las", "los", "y"]);

/** "juan PÉREZ de la cruz" → "Juan Pérez de la Cruz". Matches backend/src/lib/census.ts. */
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
      return lower
        .split("-")
        .map((part) => part.charAt(0).toLocaleUpperCase("es-HN") + part.slice(1))
        .join("-");
    })
    .join(" ");
}

/**
 * What someone types as an amount in lempiras, in whole centavos:
 * "35" → 3500, "35.5" → 3550, "L 35,50" → 3550. Null when it is not an amount.
 * Parsed as text, never through a float, so 0.1 + 0.2 never appears.
 */
export function parseLempiras(text: string): number | null {
  const cleaned = text.trim().replace(/^L\.?\s*/i, "").replace(",", ".");
  const match = /^(\d{1,5})(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) {
    return null;
  }
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

/** "L 70.00". Matches backend/src/lib/census.ts. */
export function formatLempiras(centavos: number): string {
  const sign = centavos < 0 ? "-" : "";
  const absolute = Math.abs(centavos);
  const whole = Math.floor(absolute / 100).toLocaleString("en-US");
  return `${sign}L ${whole}.${String(absolute % 100).padStart(2, "0")}`;
}

/**
 * A random UUID made on the phone, the entry's submission ID.
 * `crypto.randomUUID` exists only on https pages; `getRandomValues` works on
 * the plain http address used to test on a phone over Wi-Fi too.
 */
export function newSubmissionId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
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

export const INACTIVE_REASONS = {
  moved_away: "Se mudó",
  duplicate: "Registro repetido",
  entered_by_mistake: "Ingresado por error",
} as const;

export type Relation = keyof typeof RELATIONS;
export type WaterConnection = keyof typeof WATER_CONNECTIONS;
export type InactiveReason = keyof typeof INACTIVE_REASONS;

/** "0801-1990-12345": how an ID number is read aloud and written on the card. */
export function formatIdNumber(value: string): string {
  return /^\d{13}$/.test(value) ? `${value.slice(0, 4)}-${value.slice(4, 8)}-${value.slice(8)}` : value;
}

/** The message "Compartir por WhatsApp" prepares for the family. */
export function whatsappLink(phone: string | null, fullName: string, code: string): string {
  const text = `Hola ${fullName}. Su vivienda quedó registrada en el censo de la Junta de Agua de Zoilabe con el código ${code}. Guarde este mensaje.`;
  const to = phone && /^\d{8}$/.test(phone) ? `504${phone}` : "";
  return `https://wa.me/${to}?text=${encodeURIComponent(text)}`;
}

/** What GET /census/options answers, also kept on the phone for working without signal. */
export interface CensusOptions {
  sectors: Array<{ id: number; name: string }>;
  genders: string[];
  baseFeeCentavos: number | null;
  canSetDifferentFee: boolean;
  today: string;
}

/** The body of POST /census/households. */
export interface Registration {
  submissionId: string;
  paper?: { date: string; formNumber?: string };
  person: { fullName?: string; idNumber: string; phone?: string; gender?: string };
  addToExistingPerson: boolean;
  household: {
    sectorId: number;
    references: string;
    gps?: { lat: number; lng: number };
    waterConnection: WaterConnection;
    relation: Relation;
  };
  fee: { kind: "base" } | { kind: "different"; monthlyAmountCentavos: number; reason: string };
}

export interface HouseholdRef {
  id: string;
  code: string;
  status: "active" | "inactive";
  sectorName: string;
}

export interface HouseholdRow {
  id: string;
  code: string;
  status: "active" | "inactive";
  ownerName: string;
  sectorName: string;
  references: string;
  waterConnection: WaterConnection;
  paperFormNumber: string | null;
}

export interface HouseholdFile {
  id: string;
  code: string;
  status: "active" | "inactive";
  inactiveReason: InactiveReason | null;
  sector: { id: number; name: string };
  references: string;
  gps: { lat: number; lng: number } | null;
  waterConnection: WaterConnection;
  paperDate: string | null;
  paperFormNumber: string | null;
  lastVerifiedOn: string | null;
  registeredBy: string;
  createdAt: string;
  owner: {
    personId: string;
    fullName: string;
    idNumber: string;
    phone: string | null;
    gender: string | null;
    relation: Relation;
    startsOn: string;
  };
  fee:
    | { kind: "base"; baseFeeCentavos: number | null }
    | { kind: "different"; monthlyAmountCentavos: number; reason: string; startsOn: string };
  otherHouseholds: HouseholdRef[];
}
