/**
 * Invitation links, remembered phones and sessions — all rows of
 * `access_tokens`, told apart by `kind`.
 *
 * How a director stays signed in (Module 3): the invitation link is opened
 * once, on their own phone, and leaves behind a DEVICE token that remembers
 * that phone for 90 days from its last use. Typing the PIN on a remembered
 * phone opens a SESSION of a few hours. Removing a device ends its sessions.
 *
 * Only the SHA-256 of each token is stored. A backup copy of the database
 * therefore holds nothing anyone could put in a cookie. A 256-bit random token
 * needs no slow hash (scrypt is for the PIN, which people choose).
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import { accessTokens, rolePermissions, roles, users } from "../db/schema.js";
import { isPermission } from "../lib/permissions.js";
export const SESSION_COOKIE = "zoilabe_session";
export const DEVICE_COOKIE = "zoilabe_device";
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
/** An invitation link works once, within 48 hours. */
export const INVITATION_LIFETIME_MS = 48 * HOUR;
/** A remembered phone is forgotten after 90 days without use. */
export const DEVICE_IDLE_LIMIT_MS = 90 * DAY;
/** How long the app stays open after the PIN, before asking again. */
export const SESSION_LIFETIME_MS = 12 * HOUR;
/** How recent the PIN must be for a sensitive action (change a role, close a month). */
export const PIN_CONFIRMATION_WINDOW_MS = 5 * 60 * 1000;
export function newId() {
    return randomUUID();
}
export function newToken() {
    return randomBytes(32).toString("base64url");
}
export function tokenHash(token) {
    return createHash("sha256").update(token).digest("base64url");
}
/** Issue a token of the given kind and return it; the database keeps only its hash. */
export function issueToken(db, values) {
    const id = newId();
    const token = newToken();
    const expiresAt = new Date(Date.now() + values.lifetimeMs);
    db.insert(accessTokens)
        .values({
        id,
        userId: values.userId,
        kind: values.kind,
        tokenHash: tokenHash(token),
        deviceId: values.deviceId ?? null,
        label: values.label ?? null,
        expiresAt,
        createdBy: values.createdBy ?? null,
    })
        .run();
    return { id, token, expiresAt };
}
/** A live token of one kind, by its value, or null. */
export function findLiveToken(db, token, kind) {
    const row = db
        .select()
        .from(accessTokens)
        .where(and(eq(accessTokens.tokenHash, tokenHash(token)), eq(accessTokens.kind, kind), isNull(accessTokens.revokedAt), gt(accessTokens.expiresAt, new Date())))
        .limit(1)
        .get();
    return row ?? null;
}
/**
 * Who a session cookie belongs to, with their permissions, or null.
 *
 * Read from the database on every request, so a role change, a suspension, a
 * lock or a removed phone takes effect on that person's very next click.
 */
export function getSessionUser(db, token) {
    const session = findLiveToken(db, token, "session");
    if (!session?.deviceId) {
        return null;
    }
    const row = db
        .select({
        id: users.id,
        name: users.name,
        roleCode: users.roleCode,
        roleName: roles.name,
        status: users.status,
        lockedAt: users.lockedAt,
        deviceRevokedAt: accessTokens.revokedAt,
        deviceExpiresAt: accessTokens.expiresAt,
    })
        .from(users)
        .innerJoin(roles, eq(roles.code, users.roleCode))
        .innerJoin(accessTokens, eq(accessTokens.id, session.deviceId))
        .where(eq(users.id, session.userId))
        .limit(1)
        .get();
    if (!row ||
        row.status !== "active" ||
        row.lockedAt !== null ||
        row.deviceRevokedAt !== null ||
        row.deviceExpiresAt.getTime() <= Date.now()) {
        return null;
    }
    const granted = db
        .select({ permission: rolePermissions.permission })
        .from(rolePermissions)
        .where(and(eq(rolePermissions.roleCode, row.roleCode), eq(rolePermissions.granted, true)))
        .all();
    return {
        id: row.id,
        name: row.name,
        roleCode: row.roleCode,
        roleName: row.roleName,
        permissions: new Set(granted.map((g) => g.permission).filter(isPermission)),
        sessionId: session.id,
        deviceId: session.deviceId,
        pinConfirmedAt: session.pinConfirmedAt,
    };
}
/** End tokens now: every session of a device, or every device and session of a user. */
export function revokeTokens(db, where, revokedBy) {
    const conditions = [isNull(accessTokens.revokedAt)];
    if (where.ids)
        conditions.push(inArray(accessTokens.id, where.ids));
    if (where.deviceId)
        conditions.push(eq(accessTokens.deviceId, where.deviceId));
    if (where.userId)
        conditions.push(eq(accessTokens.userId, where.userId));
    if (where.kinds)
        conditions.push(inArray(accessTokens.kind, where.kinds));
    db.update(accessTokens)
        .set({ revokedAt: new Date(), revokedBy })
        .where(and(...conditions))
        .run();
}
//# sourceMappingURL=session.js.map