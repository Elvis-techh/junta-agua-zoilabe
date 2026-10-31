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
 * Pairs no single role may hold together: the person who records money, or
 * prepares the close, cannot also approve it. The Permisos tab refuses an edit
 * that would join them, and the `months` table refuses an approval by the
 * person who prepared it.
 */
export const INCOMPATIBLE = [
    ["finance:record", "month:approve"],
    ["month:prepare", "month:approve"],
];
/**
 * Permissions the administrator role always keeps, whatever the Permisos tab
 * says. Without them nobody could undo a bad edit: they are the way back in.
 */
export const LOCKED_FOR_ADMIN = new Set([
    "users:manage",
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
const BOARD_VIEW = ["census:view", "census:view_sensitive", "finance:view"];
const PRESIDENT = [
    "census:view",
    "census:view_sensitive",
    "census:edit",
    "census:deactivate",
    "household_fee:set",
    "finance:view",
    "month:approve",
    "users:manage",
    "guests:manage",
    "permissions:view",
    "settings:edit",
    "log:view",
    "export:census",
    "export:finance",
    "export:log",
];
/**
 * The App Plan's matrix, row by row.
 *
 * One reading to confirm with the board: the plan gives the administrator
 * "Print and export: All" but also says the administrator "cannot see or touch
 * money records". The second rule wins here, so the administrator exports the
 * census and the history log but not finances. The Permisos tab can change it.
 */
export const DEFAULT_MATRIX = {
    administrador: new Set([
        "census:view",
        "census:view_sensitive",
        "census:edit",
        "census:deactivate",
        "users:manage",
        "guests:manage",
        "permissions:view",
        "permissions:edit",
        "settings:edit",
        "log:view",
        "export:census",
        "export:log",
    ]),
    presidente: new Set(PRESIDENT),
    // Acts when the president is away, with every permission the president has.
    vicepresidente: new Set(PRESIDENT),
    secretario: new Set([
        "census:view",
        "census:view_sensitive",
        "census:edit",
        "census:deactivate",
        "household_fee:set_at_registration",
        "export:census",
    ]),
    tesorero: new Set([
        "census:view",
        "census:view_sensitive",
        "household_fee:set",
        "finance:view",
        "finance:record",
        "finance:reverse",
        "month:prepare",
        "export:finance",
    ]),
    fiscal: new Set([
        ...BOARD_VIEW,
        "log:view",
        "export:census",
        "export:finance",
        "export:log",
    ]),
    primer_vocal: new Set([...BOARD_VIEW, "export:census", "export:finance"]),
    segundo_vocal: new Set([...BOARD_VIEW, "export:census", "export:finance"]),
};
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
    return null;
}
//# sourceMappingURL=permissions.js.map