/**
 * Passwords on the screens. The same rule as backend/src/lib/password.ts (a
 * test checks the two), so a problem is said before anything is sent.
 */

export const PASSWORD_MIN_LENGTH = 6;
export const PASSWORD_MAX_LENGTH = 100;

/** Why this password cannot be saved, in plain words, or null when it can. */
export function passwordProblem(password: string): string | null {
  if (password.trim().length < PASSWORD_MIN_LENGTH) {
    return `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} letras o números.`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return "La contraseña es demasiado larga.";
  }
  return null;
}

const CONSONANTS = "bcdfghjkmnprstvz";
const VOWELS = "aeiu";
const DIGITS = "23456789";

/**
 * A password that is easy to read aloud and type on a phone: two syllables and
 * four digits, such as "bamu4827". No o, l, 0 or 1, which look alike. Offered
 * when an account is made or its password changed; any other can be typed.
 */
export function suggestPassword(): string {
  const random = new Uint32Array(8);
  crypto.getRandomValues(random);
  const pick = (letters: string, i: number) => letters.charAt((random[i] ?? 0) % letters.length);
  return (
    pick(CONSONANTS, 0) + pick(VOWELS, 1) + pick(CONSONANTS, 2) + pick(VOWELS, 3) +
    pick(DIGITS, 4) + pick(DIGITS, 5) + pick(DIGITS, 6) + pick(DIGITS, 7)
  );
}
