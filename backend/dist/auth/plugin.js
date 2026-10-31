import fp from "fastify-plugin";
import { PIN_CONFIRMATION_WINDOW_MS, SESSION_COOKIE, getSessionUser } from "./session.js";
const UNAUTHENTICATED = { error: "unauthenticated", message: "Escriba su PIN para entrar." };
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
        device: deviceOf(request),
    };
}
export function deviceOf(request) {
    const agent = request.headers["user-agent"];
    return typeof agent === "string" && agent !== "" ? agent : null;
}
const authPlugin = async (app, options) => {
    app.decorate("db", options.db);
    app.decorateRequest("user", null);
    // Resolve the session on every request, before any route handler runs. The
    // user and their permissions are read from the database, never the cookie.
    app.addHook("onRequest", async (request) => {
        const token = request.cookies[SESSION_COOKIE];
        request.user = token ? getSessionUser(options.db, token) : null;
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
    app.decorate("requireRecentPin", async (request, reply) => {
        const confirmedAt = request.user?.pinConfirmedAt;
        if (!confirmedAt || Date.now() - confirmedAt.getTime() > PIN_CONFIRMATION_WINDOW_MS) {
            await reply.code(403).send({
                error: "pin_required",
                message: "Escriba su PIN otra vez para confirmar.",
            });
        }
    });
};
// `fastify-plugin` keeps these decorations visible to every route.
export default fp(authPlugin, { name: "zoilabe-auth" });
//# sourceMappingURL=plugin.js.map