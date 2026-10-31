import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
const scrypt = promisify(scryptCallback);
const SALT_BYTES = 16;
const KEY_BYTES = 64;
/**
 * The 6-digit PIN, hashed with scrypt and its own salt.
 *
 * A 6-digit PIN has only a million possibilities, so the hash alone would not
 * stop someone holding a copy of the database for long. What protects the PIN
 * is that guesses can only be made through the app: 5 wrong ones lock the
 * account, and the routes are rate-limited. The slow hash and the salt are
 * still worth having — they make a stolen copy cost hours instead of seconds,
 * and two people with the same PIN get different hashes.
 */
export async function hashPin(pin) {
    const salt = randomBytes(SALT_BYTES).toString("hex");
    const derived = (await scrypt(pin, salt, KEY_BYTES));
    return `scrypt$${salt}$${derived.toString("hex")}`;
}
/** Compare in constant time, so the response time says nothing about how close a guess was. */
export async function verifyPin(pin, storedHash) {
    const [algorithm, salt, hash] = storedHash.split("$");
    if (algorithm !== "scrypt" || !salt || !hash) {
        return false;
    }
    const expected = Buffer.from(hash, "hex");
    const actual = (await scrypt(pin, salt, expected.length));
    return expected.length === actual.length && timingSafeEqual(expected, actual);
}
/** Exactly six digits. */
export function isWellFormedPin(pin) {
    return /^[0-9]{6}$/.test(pin);
}
//# sourceMappingURL=pin.js.map