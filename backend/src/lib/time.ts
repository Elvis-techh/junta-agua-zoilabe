/**
 * Honduras keeps UTC−6 all year, with no daylight saving since 2006. It is
 * named as an IANA zone rather than as "−6" so a change in the rules is a data
 * update in Node, not a code change here.
 */
export const HONDURAS_TIME_ZONE = "America/Tegucigalpa";

/**
 * Today's calendar date in the given zone: "2026-10-23".
 *
 * `new Date().toISOString().slice(0, 10)` reads the date in UTC, so from six
 * in the evening in Honduras it already answers with tomorrow. `Intl` is asked
 * for the parts rather than trusted to print them in ISO order.
 */
export function businessToday(timeZone: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const find = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return `${find("year")}-${find("month")}-${find("day")}`;
}

/** "12 de marzo de 2026, 3:40 p. m." — how the Historial shows an instant. */
export function formatHondurasDateTime(instant: Date, timeZone = HONDURAS_TIME_ZONE): string {
  return new Intl.DateTimeFormat("es-HN", {
    timeZone,
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(instant);
}
