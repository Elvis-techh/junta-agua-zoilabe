/**
 * A report as a file for Excel. Every CSV the app saves goes through here, so
 * none of them can lose its accents or run something a person typed.
 */

/**
 * One cell of the file. Every cell is quoted, so commas and line breaks stay
 * inside it. One that starts like a formula ("=…", "+…", "-…", "@…") gets an
 * apostrophe first, so a spreadsheet shows it as text and never runs it.
 */
function csvCell(text: string): string {
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

/**
 * The rows as the text of a file. It starts with the mark that tells Excel the
 * accents are UTF-8, and ends its lines as Windows does.
 */
export function csvFile(rows: readonly (readonly string[])[]): string {
  return `﻿${rows.map((cells) => cells.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
