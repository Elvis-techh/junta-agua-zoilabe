/** The eight board roles, in the board's order. Matches backend/src/lib/permissions.ts. */
export const ROLES = [
  { code: "administrador", name: "Administrador" },
  { code: "presidente", name: "Presidente" },
  { code: "vicepresidente", name: "Vicepresidente/a" },
  { code: "secretario", name: "Secretario/a" },
  { code: "tesorero", name: "Tesorero/a" },
  { code: "fiscal", name: "Fiscal" },
  { code: "primer_vocal", name: "Primer vocal" },
  { code: "segundo_vocal", name: "Segundo vocal" },
] as const;

export function roleName(code: string): string {
  return ROLES.find((role) => role.code === code)?.name ?? code;
}
