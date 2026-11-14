import fp from "fastify-plugin";
import { inTransaction } from "../db/client.js";
import { SESSION_COOKIE, SESSION_IDLE_LIMIT_MS, SESSION_RENEWAL_INTERVAL_MS, getSessionUser, renewSession, } from "./session.js";
const UNAUTHENTICATED = { error: "unauthenticated", message: "Escriba su número y su contraseña para entrar." };
/** The session cookie's settings, the same when it is set at sign-in and when it is renewed. */
export function sessionCookieOptions(secure) {
    return {
        httpOnly: true,
        sameSite: "lax",
        secure,
        path: "/",
        maxAge: Math.floor(SESSION_IDLE_LIMIT_MS / 1000),
    };
}
/** The history log's "who", for the signed-in user of this request. */
export function actorOf(request) {
    const user = request.user;
    if (!user) {
        throw new Error("actorOf called on an anonymous request");
    }
    return {
        userId: user.id,
        name: user.name,
        role: user.roleName,
    };
}
const authPlugin = async (app, options) => {
    app.decorate("db", options.db);
    app.decorateRequest("user", null);
    // Resolve the session on every request, before any route handler runs. The
    // user and their permissions are read from the database, never the cookie.
    app.addHook("onRequest", async (request, reply) => {
        const token = request.cookies[SESSION_COOKIE];
        request.user = token ? getSessionUser(options.db, token) : null;
        // A phone in use stays signed in: once a day, its 90 days start again,
        // in the database and in the cookie alike.
        const user = request.user;
        if (token && user && Date.now() - user.sessionRenewedAt.getTime() > SESSION_RENEWAL_INTERVAL_MS) {
            inTransaction(options.db, (tx) => renewSession(tx, user.sessionId));
            reply.setCookie(SESSION_COOKIE, token, sessionCookieOptions(options.secureCookies));
        }
    });
    app.decorate("requireUser", async (request, reply) => {
        if (!request.user) {
            await reply.code(401).send(UNAUTHENTICATED);
        }
    });
    app.decorate("requirePermission", (permission) => {
        return async (request, reply) => {
            if (!request.user) {
                await reply.code(401).send(UNAUTHENTICATED);
                return;
            }
            // The server decides. A hidden button is a convenience; this is the rule.
            if (!request.user.permissions.has(permission)) {
                request.log.warn({ userId: request.user.id, role: request.user.roleCode, permission }, "Permission denied");
                await reply.code(403).send({
                    error: "forbidden",
                    message: "Su cargo no tiene permiso para esto.",
                });
            }
        };
    });
};
// `fastify-plugin` keeps these decorations visible to every route.
export default fp(authPlugin, { name: "zoilabe-auth" });
//# sourceMappingURL=plugin.js.map