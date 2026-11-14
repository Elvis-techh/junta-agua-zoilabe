/**
 * Signing in (Module 3, "How a board member signs in").
 *
 *  1. An administrator creates the account with a password and gives it to
 *     the person.
 *  2. The person types their WhatsApp number and that password once on their
 *     phone. The phone stays signed in until "Salir", or for 90 days without
 *     use.
 *
 * Wrong passwords are held back by a per-minute limit on this route alone;
 * no account locks, so nobody has to call the administrator to get back in.
 *
 * Signing in leaves no entry in Historial (owner's decision of 9 November
 * 2026): the account keeps only its last sign-in, replaced each time, as
 * Lindero does. A wrong password goes to the server's own log, which the
 * droplet clears over time, so nobody outside can fill Historial, whose
 * entries are never deleted.
 */
import { eq } from "drizzle-orm";
import { z } from "zod";
import { sessionCookieOptions } from "../auth/plugin.js";
import { SESSION_COOKIE, endSessions, openSession } from "../auth/session.js";
import { inTransaction } from "../db/client.js";
import { users } from "../db/schema.js";
import { HttpError, parse } from "../lib/http.js";
import { NO_ACCOUNT_HASH, PASSWORD_MAX_LENGTH, verifyPassword } from "../lib/password.js";
import { phoneSchema } from "../lib/phone.js";
const loginBody = z.object({
    phone: phoneSchema,
    password: z.string().min(1, "Escriba su contraseña.").max(PASSWORD_MAX_LENGTH),
});
const WRONG = new HttpError(401, "wrong_password", "El número o la contraseña no coinciden. Revise los dos.");
export function publicUser(user) {
    return {
        id: user.id,
        name: user.name,
        roleCode: user.roleCode,
        roleName: user.roleName,
        permissions: [...user.permissions].sort(),
    };
}
export const authRoutes = async (app, options) => {
    app.post("/auth/login", 
    // The one route worth attacking with a script, so it gets its own tight
    // limit instead of the generous one every other route has.
    { config: { rateLimit: { max: options.loginAttemptsPerMinute, timeWindow: "1 minute" } } }, async (request, reply) => {
        const body = parse(loginBody, request.body);
        const user = app.db
            .select({ id: users.id, status: users.status, passwordHash: users.passwordHash })
            .from(users)
            .where(eq(users.phone, body.phone))
            .get();
        // Always run a comparison, even for a number with no account, so the
        // time taken does not tell which numbers have one.
        const matches = await verifyPassword(body.password, user?.passwordHash ?? NO_ACCOUNT_HASH);
        if (!user) {
            request.log.warn("Sign-in with a number that has no account");
            throw WRONG;
        }
        if (!matches || !user.passwordHash) {
            request.log.warn({ userId: user.id }, "Wrong password");
            throw WRONG;
        }
        // Told only after the password is right, so a stranger typing numbers
        // learns nothing about which accounts exist or are suspended.
        if (user.status !== "active") {
            throw new HttpError(403, "account_inactive", "Su cuenta no está activa. Hable con el administrador.");
        }
        const session = inTransaction(app.db, (tx) => {
            // Replaced each time: Usuarios shows "Último ingreso", and nothing more is kept.
            tx.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id)).run();
            return openSession(tx, user.id);
        });
        reply.setCookie(SESSION_COOKIE, session.token, sessionCookieOptions(options.secureCookies));
        return { ok: true };
    });
    app.get("/auth/me", async (request, reply) => {
        if (request.user) {
            return { user: publicUser(request.user) };
        }
        return reply.code(401).send({
            error: "unauthenticated",
            message: "Escriba su número y su contraseña para entrar.",
        });
    });
    app.post("/auth/logout", { preHandler: app.requireUser }, async (request, reply) => {
        inTransaction(app.db, (tx) => endSessions(tx, { ids: [request.user.sessionId] }, request.user.id));
        reply.clearCookie(SESSION_COOKIE, { path: "/" });
        return { ok: true };
    });
};
//# sourceMappingURL=auth.js.map