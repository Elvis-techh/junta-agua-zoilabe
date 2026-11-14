/**
 * Sign-in sessions: rows of `access_tokens` with kind "session".
 *
 * How a board member stays signed in (Module 3): they type their phone number
 * and password once on a phone, and that phone stays signed in until they tap
 * "Salir", or for 90 days without use. Using the app pushes the 90 days
 * forward, at most once a day. Changing a password, suspending or
 * deactivating an account ends its sessions at once.
 *
 * Rows of kind "invitation" and "device" are history from before 9 November
 * 2026, when an invitation link and a 6-digit PIN were the way in. Nothing
 * issues them now, and none of them opens the app.
 *
 * Only the SHA-256 of each token is stored. A backup copy of the database
 * therefore holds nothing anyone could put in a cookie. A 256-bit random token
 * needs no slow hash (scrypt is for the password, which people choose).
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq, gt, inArray, isNull, ne } from "drizzle-orm";
import { accessTokens, rolePermissions, roles, users } from "../db/schema.js";
import { isPermission } from "../lib/permissions.js";
export const SESSION_COOKIE = "zoilabe_session";
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
/** A phone signs out by itself after 90 days without use. */
export const SESSION_IDLE_LIMIT_MS = 90 * DAY;
/** How often using the app pushes those 90 days forward. */
export const SESSION_RENEWAL_INTERVAL_MS = DAY;
export function newId() {
    return randomUUID();
}
export function newToken() {
    return randomBytes(32).toString("base64url");
}
export function tokenHash(token) {
    return createHash("sha256").update(token).digest("base64url");
}
/** Open a session and return its token; the database keeps only its hash. */
export function openSession(db, userId) {
    const id = newId();
    const token = newToken();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SESSION_IDLE_LIMIT_MS);
    db.insert(accessTokens)
        .values({
        id,
        userId,
        kind: "session",
        tokenHash: tokenHash(token),
        expiresAt,
        lastUsedAt: now,
    })
        .run();
    return { id, token, expiresAt };
}
/** Push a session's 90 days forward from now. */
export function renewSession(db, sessionId) {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SESSION_IDLE_LIMIT_MS);
    db.update(accessTokens)
        .set({ lastUsedAt: now, expiresAt })
        .where(and(eq(accessTokens.id, sessionId), isNull(accessTokens.revokedAt)))
        .run();
    return expiresAt;
}
/**
 * Who a session cookie belongs to, with their permissions, or null.
 *
 * Read from the database on every request, so a role change, a suspension or
 * a new password takes effect on that person's very next tap.
 */
export function getSessionUser(db, token) {
    const row = db
        .select({
        sessionId: accessTokens.id,
        sessionRenewedAt: accessTokens.lastUsedAt,
        sessionCreatedAt: accessTokens.createdAt,
        id: users.id,
        name: users.name,
        roleCode: users.roleCode,
        roleName: roles.name,
        status: users.status,
    })
        .from(accessTokens)
        .innerJoin(users, eq(users.id, accessTokens.userId))
        .innerJoin(roles, eq(roles.code, users.roleCode))
        .where(and(eq(accessTokens.tokenHash, tokenHash(token)), eq(accessTokens.kind, "session"), isNull(accessTokens.revokedAt), gt(accessTokens.expiresAt, new Date())))
        .limit(1)
        .get();
    if (!row || row.status !== "active") {
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
        sessionId: row.sessionId,
        sessionRenewedAt: row.sessionRenewedAt ?? row.sessionCreatedAt,
    };
}
/**
 * End a user's sessions now: every phone signs out on its next tap.
 * `keep` spares one session, so changing your own password does not sign you
 * out of the phone you changed it on.
 */
export function endSessions(db, where, revokedBy) {
    const conditions = [isNull(accessTokens.revokedAt)];
    if ("ids" in where) {
        conditions.push(inArray(accessTokens.id, where.ids));
    }
    else {
        conditions.push(eq(accessTokens.userId, where.userId));
        if (where.keep)
            conditions.push(ne(accessTokens.id, where.keep));
    }
    db.update(accessTokens)
        .set({ revokedAt: new Date(), revokedBy })
        .where(and(...conditions))
        .run();
}
//# sourceMappingURL=session.js.map