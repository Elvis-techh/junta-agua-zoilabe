import { sql } from "drizzle-orm";
export const healthRoutes = async (app) => {
    app.get("/health", async (_request, reply) => {
        try {
            app.db.get(sql `SELECT 1`);
        }
        catch {
            return reply.code(503).send({ status: "database_unreachable", service: "zoilabe-api" });
        }
        return { status: "ok", service: "zoilabe-api", timestamp: new Date().toISOString() };
    });
};
//# sourceMappingURL=health.js.map