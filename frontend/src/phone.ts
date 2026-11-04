/**
 * Phone numbers on the screens. Saved and sent in one form, "+50499998888"; a
 * person types the country and the number apart. Matches backend/src/lib/phone.ts
 * (a test checks the two lists), because a phone with no signal has to check a
 * number by itself.
 */

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
] as const;

export interface PhoneEntry {
  code: string;
  number: string;
}

const HONDURAS = "504";

/** A phone field before anything is typed: Honduras, the usual one. */
export const EMPTY_PHONE: PhoneEntry = { code: HONDURAS, number: "" };

function countryOf(code: string) {
  return PHONE_COUNTRIES.find((country) => country.code === code) ?? PHONE_COUNTRIES[0];
}

/** "8 números", "7 u 8 números": what a number of this country looks like. */
export function phoneHint(code: string): string {
  return `${countryOf(code).digits.join(" u ")} números`;
}

/** What was typed, as digits only and no longer than this country allows. */
export function typedNumber(code: string, typed: string): string {
  const longest = Math.max(...countryOf(code).digits);
  const digits = typed.replace(/\D/g, "");
  // Pasted from a contact, "+504 9999-8888" brings the code along.
  const number = digits.length > longest && digits.startsWith(code) ? digits.slice(code.length) : digits;
  return number.slice(0, longest);
}

/** Why this number cannot be saved, in plain words, or null when it can. */
export function phoneProblem({ code, number }: PhoneEntry): string | null {
  const country = countryOf(code);
  return (country.digits as readonly number[]).includes(number.length)
    ? null
    : `Un teléfono de ${country.name} tiene ${phoneHint(code)}. Revise e intente de nuevo.`;
}

/** The form it is saved and sent in. */
export function wholePhone({ code, number }: PhoneEntry): string {
  return `+${code}${number}`;
}

/** A saved phone taken apart, for correcting it. A masked one, or none, starts empty. */
export function phoneEntry(phone: string | null): PhoneEntry {
  const country = PHONE_COUNTRIES.find(({ code }) => phone?.startsWith(`+${code}`));
  return country ? { code: country.code, number: phone!.slice(country.code.length + 1) } : EMPTY_PHONE;
}

/** "9999-8888", "555-123-4567": how each length is read aloud. */
function grouped(number: string): string {
  switch (number.length) {
    case 7:
      return `${number.slice(0, 3)}-${number.slice(3)}`;
    case 8:
      return `${number.slice(0, 4)}-${number.slice(4)}`;
    case 9:
    case 10:
      return `${number.slice(0, 3)}-${number.slice(3, 6)}-${number.slice(6)}`;
    default:
      return number;
  }
}

/** "+504 9999-8888". A masked number stays as the server sent it. */
export function formatPhone(phone: string): string {
  const { code, number } = phoneEntry(phone);
  return number ? `+${code} ${grouped(number)}` : phone;
}

/**
 * The number as wa.me wants it, digits only, or "" if there is none to use. A
 * saved entry from before country codes can still hold 8 digits: those are Honduran.
 */
export function whatsappNumber(phone: string | null): string {
  if (phone && /^\+\d+$/.test(phone)) {
    return phone.slice(1);
  }
  return phone && /^\d{8}$/.test(phone) ? `${HONDURAS}${phone}` : "";
}
