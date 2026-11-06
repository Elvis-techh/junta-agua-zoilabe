/**
 * Who may do what: the permission codes, and the board's default matrix.
 *
 * Code asks about a PERMISSION, never about a role. The live answer comes from
 * the `role_permissions` table, which the Permisos tab edits; the matrix below
 * is only what a new database is seeded with (docs/app-plan.md, "Roles and
 * permissions").
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
 * Pairs no single role may hold together. Empty since 6 November 2026: the
 * board gave every role every permission, because it does not always meet in
 * full and a task only one or two people could do would wait for them. The
 * month close still takes two different people, but that is about the
 * PERSON, not the role: the `months` table refuses an approval by whoever
 * prepared it (`months_preparer_not_approver`), and the close routes will
 * check it too. Kept, so the Permisos tab can be given a rule again.
 */
export const INCOMPATIBLE: ReadonlyArray<readonly [Permission, Permission]> = [];

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
 * Every role holds every permission (board decision, 6 November 2026). Roles
 * stay, so the history log still shows who did what as which officer, and
 * the Permisos tab can still take a permission away from a role.
 *
 * A database made before that day is brought up to it once, by
 * `grantEveryPermissionOnce` (src/db/seeding.ts).
 */
export const DEFAULT_MATRIX = Object.fromEntries(
  ROLE_CODES.map((role) => [role, new Set<Permission>(PERMISSION_CODES)]),
) as unknown as Record<RoleCode, ReadonlySet<Permission>>;

/**
 * Why a role's new set of permissions is not allowed, or null if it is.
 * Shared by the Permisos route and its tests.
 */
export function matrixProblem(role: RoleCode, granted: ReadonlySet<Permission>): string | null {
  for (const [first, second] of INCOMPATIBLE) {
    if (granted.has(first) && granted.has(second)) {
      return `Un mismo cargo no puede «${PERMISSIONS[first]}» y «${PERMISSIONS[second]}».`;
    }
  }

  if (role === "administrador") {
    for (const permission of LOCKED_FOR_ADMIN) {
      if (!granted.has(permission)) {
        return `El Administrador siempre conserva «${PERMISSIONS[permission]}».`;
      }
    }
  }

  return null;
}
