const HONDURAS = "America/Tegucigalpa";

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
