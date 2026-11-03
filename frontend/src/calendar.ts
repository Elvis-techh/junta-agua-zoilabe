/**
 * The arithmetic and words of the computer's calendar (CalendarField.tsx).
 * Months are "YYYY-MM" and days "YYYY-MM-DD", the values browsers' own month
 * and date fields use, which sort as text.
 */

const MONTHS = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];
const MONTHS_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** Honduran calendars start on Sunday. */
export const WEEKDAYS = ["D", "L", "M", "M", "J", "V", "S"];

const two = (n: number) => String(n).padStart(2, "0");

/** "2026-11" → "noviembre de 2026". */
export function monthLabel(month: string): string {
  return `${MONTHS[Number(month.slice(5, 7)) - 1]} de ${month.slice(0, 4)}`;
}

/** "2026-11-03" → "3 de noviembre de 2026". */
export function dayLabel(day: string): string {
  return `${Number(day.slice(8, 10))} de ${monthLabel(day.slice(0, 7))}`;
}

/** "2026-12" and 1 → "2027-01". */
export function shiftMonth(month: string, by: number): string {
  const total = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + by;
  return `${Math.floor(total / 12)}-${two((total % 12) + 1)}`;
}

export interface CalendarLimits {
  selected: string;
  min?: string | undefined;
  max?: string | undefined;
  today: string;
}

export interface CalendarCell {
  value: string;
  label: string;
  disabled: boolean;
  selected: boolean;
  current: boolean;
}

function cell(value: string, label: string, limits: CalendarLimits): CalendarCell {
  return {
    value,
    label,
    disabled: Boolean((limits.min && value < limits.min) || (limits.max && value > limits.max)),
    selected: value === limits.selected,
    current: value === limits.today,
  };
}

/** The twelve months of a year. */
export function monthCells(year: number, limits: CalendarLimits): CalendarCell[] {
  return MONTHS_SHORT.map((label, index) => cell(`${year}-${two(index + 1)}`, label, limits));
}

/**
 * The days of a month on six rows of seven, null where the row holds another
 * month's day. Always six rows, so the panel does not jump between months.
 */
export function dayCells(month: string, limits: CalendarLimits): Array<CalendarCell | null> {
  const year = Number(month.slice(0, 4));
  const monthNumber = Number(month.slice(5, 7));
  const blanks = new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay();
  const days = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();

  const cells: Array<CalendarCell | null> = Array.from({ length: blanks }, () => null);
  for (let day = 1; day <= days; day += 1) {
    cells.push(cell(`${month}-${two(day)}`, String(day), limits));
  }
  while (cells.length < 42) {
    cells.push(null);
  }
  return cells;
}

export interface Box {
  top: number;
  left: number;
  bottom: number;
  width: number;
  height: number;
}

const MARGIN = 8;

/**
 * Where the panel goes on the screen: under its field if it fits, else over it
 * if there is more room there, and never past the edges.
 */
export function placeCalendar(
  field: Pick<Box, "top" | "left" | "bottom">,
  panel: Pick<Box, "width" | "height">,
  screen: { width: number; height: number },
): { top: number; left: number } {
  const below = field.bottom + MARGIN;
  const above = field.top - MARGIN - panel.height;
  const fitsBelow = below + panel.height <= screen.height - MARGIN;
  const top = fitsBelow || field.top - MARGIN < screen.height - field.bottom - MARGIN ? below : above;
  return {
    top: Math.max(MARGIN, Math.min(top, screen.height - MARGIN - panel.height)),
    left: Math.max(MARGIN, Math.min(field.left, screen.width - MARGIN - panel.width)),
  };
}
