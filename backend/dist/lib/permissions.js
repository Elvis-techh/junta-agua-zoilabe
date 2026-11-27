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
];
export const ROLE_CODES = ROLES.map((role) => role.code);
export function isRoleCode(value) {
    return ROLE_CODES.includes(value);
}
export function roleName(code) {
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
};
export const PERMISSION_CODES = Object.keys(PERMISSIONS);
export function isPermission(value) {
    return value in PERMISSIONS;
}
/**
 * The permission each one needs. Without it, it does nothing: turning "Ver
 * finanzas" off turns off everything that records, closes or prints money
 * too, so "off" really means hidden and no button leads nowhere (owner, 25
 * November 2026). Followed all the way: a different fee needs registering,
 * which needs seeing the census.
 *
 * `effectivePermissions` applies it to every request, and `matrixProblem`
 * refuses to save a set that breaks it. A new permission that is no use
 * without another one gets its line here.
 */
export const REQUIRES = {
    "census:view_sensitive": "census:view",
    "census:edit": "census:view",
    "census:deactivate": "census:view",
    // The only place a different fee is set today is while registering.
    "household_fee:set": "census:edit",
    "household_fee:set_at_registration": "census:edit",
    "export:census": "census:view",
    "finance:record": "finance:view",
    "finance:reverse": "finance:view",
    "month:prepare": "finance:view",
    "month:approve": "finance:view",
    "export:finance": "finance:view",
    "export:log": "log:view",
    "permissions:edit": "permissions:view",
};
/** What a role can really do: of the permissions switched on, those whose whole chain of needed ones is on too. */
export function effectivePermissions(granted) {
    const on = new Set(granted);
    const works = (code) => {
        const needed = REQUIRES[code];
        return on.has(code) && (needed === undefined || works(needed));
    };
    return new Set([...on].filter(works));
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
export const INCOMPATIBLE = [];
/**
 * Permissions the administrator role always keeps, whatever the Permisos tab
 * says. Without them nobody could undo a bad edit: they are the way back in.
 */
export const LOCKED_FOR_ADMIN = new Set([
    "users:manage",
    "permissions:view",
    "permissions:edit",
]);
/**
 * What a guest invitation may ever grant (Module 3). The history log, users,
 * permissions and settings are never among them, and nothing that writes.
 */
export const GUEST_PERMISSIONS = new Set([
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
export const DEFAULT_MATRIX = Object.fromEntries(ROLE_CODES.map((role) => [role, new Set(PERMISSION_CODES)]));
/**
 * Why a role's new set of permissions is not allowed, or null if it is.
 * Shared by the Permisos route and its tests.
 */
export function matrixProblem(role, granted) {
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
    for (const permission of granted) {
        const needed = REQUIRES[permission];
        if (needed && !granted.has(needed)) {
            return `«${PERMISSIONS[permission]}» necesita «${PERMISSIONS[needed]}».`;
        }
    }
    return null;
}
/**
 * What changed, in words, for the history log: «quitó «Ver el historial»; dio
 * «Administrar usuarios»». The yearly extract carries only an entry's
 * sentence, so the sentence has to say it.
 */
export function describeChange(before, after) {
    const words = (codes) => codes.map((code) => `«${PERMISSIONS[code]}»`).join(", ");
    const removed = PERMISSION_CODES.filter((code) => before.has(code) && !after.has(code));
    const added = PERMISSION_CODES.filter((code) => !before.has(code) && after.has(code));
    return [removed.length ? `quitó ${words(removed)}` : "", added.length ? `dio ${words(added)}` : ""].filter(Boolean).join("; ");
}
//# sourceMappingURL=permissions.js.map