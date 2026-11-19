/**
 * The most any amount field takes: L 999,999,999.99, in centavos. Nobody
 * knows how much a payment, an expense or the board's money will one day
 * be (owner, 19 November 2026). frontend/src/census.ts takes the same
 * (AMOUNT_WHOLE_DIGITS); a test fails if the two differ.
 */
export const MAX_AMOUNT_CENTAVOS = 99_999_999_999;
