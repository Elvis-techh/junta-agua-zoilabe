/**
 * Who may do what: the permission codes, and the board's default matrix.
 *
 * Code asks about a PERMISSION, never about a role. The live answer comes from
 * the `role_permissions` table, which the Permisos tab edits; the matrix below
 * is only what a new database is seeded with (docs/app-plan.md, "Roles and
 * permissions"): since 6 November 2026, everything for every role.
 */

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

export type RoleCode = (typeof ROLES)[number]["code"];

export const ROLE_CODES: readonly RoleCode[] = ROLES.map((role) => role.code);

export function isRoleCode(value: string): value is RoleCode {
  return (ROLE_CODES as readonly string[]).includes(value);
}

export function roleName(code: string): string {
  return ROLES.find((role) => role.code === code)?.name ?? code;
}

/** Every permission code, with the words the Permisos tab shows for it. */
export const PERMISSIONS = {
  "census:view": "Ver el censo y las fichas de vivienda",
  "census:view_sensitive": "Ver identidad y teléfono completos",
  "census:edit": "Registrar y editar el censo",
  "census:deactivate": "Desactivar un registro del censo",
  "household_fee:set": "Fijar una tarifa diferente para una vivienda",
  "household_fee:set_at_registration": "Fijar una tarifa diferente al registrar",
  "finance:view": "Ver finanzas",
  "finance:record": "Registrar pagos y gastos",
  "finance:reverse": "Corregir un registro de dinero",
  "month:prepare": "Preparar el cierre del mes",
  "month:approve": "Aprobar el cierre del mes",
  "users:manage": "Administrar usuarios",
  "guests:manage": "Crear y revocar invitaciones",
  "permissions:view": "Ver los permisos",
  "permissions:edit": "Editar los permisos",
  "settings:edit": "Cambiar la configuración",
  "log:view": "Ver el historial",
  "export:census": "Imprimir y exportar el censo",
  "export:finance": "Imprimir y exportar finanzas",
  "export:log": "Imprimir y exportar el historial",
} as const;

export type Permission = keyof typeof PERMISSIONS;

export const PERMISSION_CODES = Object.keys(PERMISSIONS) as Permission[];

export function isPermission(value: string): value is Permission {
  return value in PERMISSIONS;
}

/**
 * Permissions the administrator role always keeps, whatever the Permisos tab
 * says. Without them nobody could undo a bad edit: they are the way back in.
 */
export const LOCKED_FOR_ADMIN: ReadonlySet<Permission> = new Set<Permission>([
  "users:manage",
  "permissions:edit",
]);

/**
 * What a guest invitation may ever grant (Module 3). The history log, users,
 * permissions and settings are never among them, and nothing that writes.
 */
export const GUEST_PERMISSIONS: ReadonlySet<Permission> = new Set<Permission>([
  "census:view",
  "census:view_sensitive",
  "finance:view",
  "export:census",
  "export:finance",
]);

/**
 * What a new database starts with: every role holds every permission.
 *
 * The owner decided on 2026-11-06 that the board does not always meet in
 * full, and a task only one or two roles could do would wait for them. The
 * role stays, so every history entry says who acted and in which role, and
 * the Permisos tab can still narrow a role later.
 *
 * A month close still takes two people: the `months` table refuses an
 * approval by the person who prepared it (`months_preparer_not_approver`).
 */
const EVERYTHING: ReadonlySet<Permission> = new Set(PERMISSION_CODES);

export const DEFAULT_MATRIX: Record<RoleCode, ReadonlySet<Permission>> = {
  administrador: EVERYTHING,
  presidente: EVERYTHING,
  vicepresidente: EVERYTHING,
  secretario: EVERYTHING,
  tesorero: EVERYTHING,
  fiscal: EVERYTHING,
  primer_vocal: EVERYTHING,
  segundo_vocal: EVERYTHING,
};

/**
 * Why a role's new set of permissions is not allowed, or null if it is.
 * Shared by the Permisos route and its tests.
 */
export function matrixProblem(role: RoleCode, granted: ReadonlySet<Permission>): string | null {
  if (role === "administrador") {
    for (const permission of LOCKED_FOR_ADMIN) {
      if (!granted.has(permission)) {
        return `El Administrador siempre conserva «${PERMISSIONS[permission]}».`;
      }
    }
  }

  return null;
}
