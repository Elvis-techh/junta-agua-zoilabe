import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import authPlugin from "./auth/plugin.js";
import { HttpError } from "./lib/http.js";
import { auditRoutes } from "./routes/audit.js";
import { authRoutes } from "./routes/auth.js";
import { censusRoutes } from "./routes/census.js";
import { healthRoutes } from "./routes/health.js";
import { permissionRoutes } from "./routes/permissions.js";
import { sectorRoutes } from "./routes/sectors.js";
import { userRoutes } from "./routes/users.js";
export async function buildApp(config, db) {
    const app = Fastify({
        logger: config.nodeEnv !== "test",
        trustProxy: config.trustProxy,
    });
    await app.register(cors, {
        origin: config.frontendOrigins,
        // Required for the session cookie to travel with fetch() requests.
        credentials: true,
    });
    await app.register(cookie);
    // A generous ceiling for normal use; the PIN routes are far stricter.
    await app.register(rateLimit, {
        max: config.requestsPerMinute,
        timeWindow: "1 minute",
    });
    await app.register(authPlugin, { db });
    /*
     * The last line between an error and the person's screen. Deliberate
     * refusals keep their own Spanish wording; anything unplanned is logged in
     * full and replaced by a sentence, so no database message (which names
     * tables and columns) ever reaches the browser.
     */
    app.setErrorHandler((error, request, reply) => {
        if (error instanceof HttpError) {
            return reply.code(error.statusCode).send({ ...error.details, error: error.code, message: error.message });
        }
        const status = error.statusCode ?? 500;
        if (status < 500) {
            return reply.code(status).send({ error: error.code ?? "request_error", message: error.message });
        }
        request.log.error({ err: error }, "Unhandled error");
        return reply.code(500).send({
            error: "server_error",
            message: "No se pudo completar. Intente de nuevo o avise al administrador.",
        });
    });
    await app.register(async (api) => {
        await api.register(healthRoutes);
        await api.register(authRoutes, {
            appUrl: config.appUrl,
            secureCookies: config.nodeEnv === "production",
            pinAttemptsPerMinute: config.pinAttemptsPerMinute,
        });
        await api.register(userRoutes, { appUrl: config.appUrl });
        await api.register(permissionRoutes);
        await api.register(auditRoutes);
        await api.register(censusRoutes, { timeZone: config.timeZone });
        await api.register(sectorRoutes);
    }, { prefix: "/api" });
    return app;
}
//# sourceMappingURL=app.js.map