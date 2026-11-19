/**
 * Registrar familia: is this name close to one already in the census?
 *
 * The ID number is optional (owner, 19 November 2026), so a family registered
 * twice without one would be two people. The registrar is warned about names
 * that look alike and decides, so a wrong match costs one tap and a missed
 * one costs a double entry.
 *
 * Accents, capital letters, "de", "del", "la" and a one-letter typo in a long
 * word do not matter. Two names are alike when the first names match and the
 * last word of the shorter name is also in the longer one:
 *
 *   "Juan Pérez" ~ "Juan Carlos Pérez López"      (a second name and surname are added)
 *   "María Rodríguez" ~ "Maria Rodrigues"         (accent and typo)
 *   "José Luis Pérez" !~ "José Luis Martínez"     (a different surname)
 *   "Carlos Pérez Díaz" !~ "Luis Pérez Díaz"      (brothers are not the same person)
 *
 * It does not know a name written surname-first.
 */
import { searchText } from "../db/client.js";

/** Words that do not tell two names apart: "María de los Ángeles". */
const PARTICLES = new Set(["de", "del", "la", "las", "los", "y"]);

/** The words of a name as they are compared: no accents, no capitals, no particles. */
export function nameWords(name: string): string[] {
  return searchText(name)
    .split(/[^a-z]+/)
    .filter((word) => word && !PARTICLES.has(word));
}

/** The same word, or, in a word of five letters or more, one letter different. */
function sameWord(a: string, b: string): boolean {
  if (a === b) {
    return true;
  }
  if (a.length < 5 || b.length < 5 || Math.abs(a.length - b.length) > 1) {
    return false;
  }
  // One letter changed, added or missing.
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  let at = 0;
  while (at < short.length && short[at] === long[at]) {
    at += 1;
  }
  return short.slice(short.length === long.length ? at + 1 : at) === long.slice(at + 1);
}

/** Whether two names look like the same family's. Two words each at least. */
export function isSimilarName(a: string, b: string): boolean {
  const x = nameWords(a);
  const y = nameWords(b);
  if (x.length < 2 || y.length < 2 || !sameWord(x[0]!, y[0]!)) {
    return false;
  }
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  const inside = (list: string[], word: string) => list.slice(1).some((other) => sameWord(other, word));
  return inside(long, short[short.length - 1]!) || (short.length === long.length && inside(short, long[long.length - 1]!));
}
