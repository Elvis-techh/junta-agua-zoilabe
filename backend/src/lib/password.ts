import { randomBytes, randomInt, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

const SALT_BYTES = 16;
const KEY_BYTES = 64;

/** Short enough for an older board member to remember; the per-minute limit on sign-in does the rest. */
export const PASSWORD_MIN_LENGTH = 6;
export const PASSWORD_MAX_LENGTH = 100;

/**
 * The password, hashed with scrypt and its own salt, as Lindero does.
 *
 * scrypt is slow on purpose, so someone holding a copy of the database cannot
 * try guesses quickly, and two people with the same password get different
 * hashes. Guesses through the app itself are held back by the per-minute
 * limit on `POST /auth/login`.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES).toString("hex");
  const derived = (await scrypt(password, salt, KEY_BYTES)) as Buffer;
  return `scrypt$${salt}$${derived.toString("hex")}`;
}

/** Compare in constant time, so the response time says nothing about how close a guess was. */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [algorithm, salt, hash] = storedHash.split("$");

  if (algorithm !== "scrypt" || !salt || !hash) {
    return false;
  }

  const expected = Buffer.from(hash, "hex");
  const actual = (await scrypt(password, salt, expected.length)) as Buffer;

  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/**
 * Hashed when nobody matches the phone typed, so "no such phone" takes as long
 * as "wrong password" and the answer's timing does not tell which numbers have
 * an account.
 */
export const NO_ACCOUNT_HASH = `scrypt$${"00".repeat(SALT_BYTES)}$${"00".repeat(KEY_BYTES)}`;

/** The same rule in `frontend/src/password.ts`. */
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
 * four digits, such as "bamu4827". No o, l, 0 or 1, which look alike.
 */
export function suggestPassword(): string {
  const pick = (letters: string) => letters.charAt(randomInt(letters.length));
  return pick(CONSONANTS) + pick(VOWELS) + pick(CONSONANTS) + pick(VOWELS) + pick(DIGITS) + pick(DIGITS) + pick(DIGITS) + pick(DIGITS);
}
