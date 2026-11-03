const HONDURAS = "America/Tegucigalpa";

/** Today's date in Honduras, as "YYYY-MM-DD", whatever the device's own time zone. */
export function todayInHonduras(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: HONDURAS, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** "12 de marzo, 3:40 p. m." — every instant is shown in Honduras time. */
export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("es-HN", {
    timeZone: HONDURAS,
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

/** "12 de marzo de 2026" */
export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("es-HN", {
    timeZone: HONDURAS,
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(iso));
}
