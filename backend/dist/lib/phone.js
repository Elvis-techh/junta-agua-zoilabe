/**
 * Phone numbers, kept in one form everywhere: a plus, the country code and the
 * number, all digits ("+50499998888"). The countries are the owner's list of
 * 4 November 2026, Honduras first because it is the usual one.
 *
 * frontend/src/phone.ts holds the same list, because a phone with no signal
 * has to check a number by itself. A test checks the two lists match.
 */
import { z } from "zod";
/** `digits`: how long a number of that country is, without its code. */
export const PHONE_COUNTRIES = [
    { code: "504", name: "Honduras", digits: [8] },
    { code: "1", name: "Estados Unidos y Canadá", digits: [10] },
    { code: "34", name: "España", digits: [9] },
    { code: "52", name: "México", digits: [10] },
    { code: "502", name: "Guatemala", digits: [8] },
    { code: "503", name: "El Salvador", digits: [8] },
    { code: "505", name: "Nicaragua", digits: [8] },
    { code: "506", name: "Costa Rica", digits: [8] },
    // Mobiles have 8; landlines still have 7.
    { code: "507", name: "Panamá", digits: [7, 8] },
];
const HONDURAS = "504";
/**
 * The stored form of a number, or why it cannot be saved, in plain words.
 *
 * Digits alone are a Honduran number: an entry saved on a phone before country
 * codes existed still arrives that way, and it must not be refused.
 */
export function readPhone(value) {
    const full = /^\d+$/.test(value) ? `+${HONDURAS}${value}` : value;
    const country = PHONE_COUNTRIES.find(({ code }) => full.startsWith(`+${code}`));
    if (!country || !/^\+\d+$/.test(full)) {
        return { problem: "Elija el país y escriba el número." };
    }
    const length = full.length - 1 - country.code.length;
    if (!country.digits.includes(length)) {
        return { problem: `Un teléfono de ${country.name} tiene ${country.digits.join(" u ")} números. Revise e intente de nuevo.` };
    }
    return { phone: full };
}
/** A phone from a request, turned into its stored form. */
export const phoneSchema = z
    .string()
    .trim()
    .transform((value, context) => {
    const read = readPhone(value);
    if ("problem" in read) {
        context.addIssue({ code: "custom", message: read.problem });
        return z.NEVER;
    }
    return read.phone;
});
/**
 * The server masks, not the screen (App Plan, Security). Only the last two
 * digits leave it, always behind the same dots: how long a number is would
 * tell which country it belongs to.
 */
export function maskPhone(phone) {
    return phone === null ? null : `••••••${phone.slice(-2)}`;
}
/**
 * The LIKE patterns that find these digits in a stored phone. They look after
 * the country code, or "5049" would find nearly every Honduran number. The
 * whole number, code included, is found once it is too long to be anything else.
 */
export function phoneSearchPatterns(digits) {
    const inTheNumber = PHONE_COUNTRIES.map(({ code }) => `+${code}%${digits}%`);
    return digits.length > 8 ? [...inTheNumber, `+${digits}%`] : inTheNumber;
}
//# sourceMappingURL=phone.js.map