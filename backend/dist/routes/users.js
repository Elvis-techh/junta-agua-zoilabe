/**
 * The Usuarios tab: staff accounts and their passwords.
 *
 * Accounts are never deleted, because history entries point to them. Their
 * lifecycle is active → suspended → deactivated, and every step is written to
 * the history log. ("invited" is an account made before 9 November 2026 that
 * never accepted its invitation link; giving it a password makes it active.)
 */
import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { actorOf } from "../auth/plugin.js";
import { endSessions, newId } from "../auth/session.js";
import { inTransaction } from "../db/client.js";
import { roles, users } from "../db/schema.js";
import { recordAudit } from "../lib/audit.js";
import { HttpError, parse } from "../lib/http.js";
import { hashPassword, passwordProblem } from "../lib/password.js";
import { ROLE_CODES, roleName } from "../lib/permissions.js";
import { phoneSchema } from "../lib/phone.js";
const nameSchema = z
    .string()
    .trim()
    .min(3, "Escriba el nombre completo.")
    .max(120, "El nombre es demasiado largo.");
const roleSchema = z.enum(ROLE_CODES, { message: "Elija un cargo de la lista." });
const reasonSchema = z.string().trim().max(500).optional();
const passwordSchema = z.string().superRefine((value, ctx) => {
    const problem = passwordProblem(value);
    if (problem)
        ctx.addIssue({ code: "custom", message: problem });
});
const createBody = z.object({ name: nameSchema, phone: phoneSchema, roleCode: roleSchema, password: passwordSchema });
const passwordBody = z.object({ password: passwordSchema });
const roleBody = z.object({ roleCode: roleSchema });
const reasonBody = z.object({ reason: reasonSchema }).default({});
const NOT_FOUND = new HttpError(404, "not_found", "No se encontró esa cuenta.");
/** A malformed id can match nothing; answer 404 before asking the database. */
function requireUuid(id, error) {
    if (!z.uuid().safeParse(id).success) {
        throw error;
    }
}
export const userRoutes = async (app) => {
    const guard = { preHandler: app.requirePermission("users:manage") };
    /** The target account, locked for the rest of the transaction. */
    const lockUser = (tx, id) => {
        requireUuid(id, NOT_FOUND);
        const user = tx.select().from(users).where(eq(users.id, id)).get();
        if (!user) {
            throw NOT_FOUND;
        }
        return user;
    };
    const notSelf = (request, id, message) => {
        if (request.user.id === id) {
            throw new HttpError(409, "not_allowed", message);
        }
    };
    // -------------------------------------------------------------------------
    app.get("/users", guard, async () => {
        const rows = await app.db
            .select({
            id: users.id,
            name: users.name,
            phone: users.phone,
            roleCode: users.roleCode,
            roleName: roles.name,
            status: users.status,
            hasPassword: sql `${users.passwordHash} IS NOT NULL`.mapWith(Boolean),
            lastLoginAt: users.lastLoginAt,
            createdAt: users.createdAt,
        })
            .from(users)
            .innerJoin(roles, eq(roles.code, users.roleCode))
            .orderBy(asc(roles.sortOrder), asc(users.name));
        return { users: rows };
    });
    app.post("/users", guard, async (request, reply) => {
        const body = parse(createBody, request.body);
        const actor = actorOf(request);
        // Slow on purpose, so it happens before the transaction starts.
        const passwordHash = await hashPassword(body.password);
        const user = inTransaction(app.db, (tx) => {
            const taken = tx.select({ id: users.id }).from(users).where(eq(users.phone, body.phone)).get();
            if (taken) {
                throw new HttpError(409, "phone_taken", "Ya hay una cuenta con ese número de WhatsApp.");
            }
            const created = {
                id: newId(),
                name: body.name,
                phone: body.phone,
                roleCode: body.roleCode,
                status: "active",
                passwordHash,
                createdBy: actor.userId,
            };
            tx.insert(users).values(created).run();
            recordAudit(tx, actor, {
                area: "users",
                action: "user.created",
                summary: `${actor.name} (${actor.role}) creó la cuenta de ${body.name} (${roleName(body.roleCode)})`,
                entityType: "user",
                entityId: created.id,
                after: { name: body.name, phone: body.phone, role: body.roleCode },
            });
            return created;
        });
        return reply.code(201).send({ user: { id: user.id, name: user.name, status: user.status } });
    });
    app.post("/users/:id/password", guard, async (request) => {
        const { password } = parse(passwordBody, request.body);
        const actor = actorOf(request);
        const isSelf = request.user.id === request.params.id;
        const passwordHash = await hashPassword(password);
        inTransaction(app.db, (tx) => {
            const user = lockUser(tx, request.params.id);
            if (user.status === "deactivated") {
                throw new HttpError(409, "not_allowed", "Esa cuenta está desactivada.");
            }
            // An account from before passwords, never signed in, becomes active.
            const status = user.status === "invited" ? "active" : user.status;
            tx.update(users).set({ passwordHash, status }).where(eq(users.id, user.id)).run();
            // Every other phone signs out: this is also what to do when a phone is
            // lost. Your own phone stays signed in when you change your own.
            endSessions(tx, { userId: user.id, keep: isSelf ? request.user.sessionId : undefined }, actor.userId);
            recordAudit(tx, actor, {
                area: "users",
                action: "user.password_changed",
                summary: isSelf
                    ? `${actor.name} (${actor.role}) cambió su propia contraseña`
                    : `${actor.name} (${actor.role}) cambió la contraseña de ${user.name}`,
                entityType: "user",
                entityId: user.id,
                ...(status !== user.status ? { before: { status: user.status }, after: { status } } : {}),
            });
        });
        return { ok: true };
    });
    app.patch("/users/:id/role", guard, async (request) => {
        const { roleCode } = parse(roleBody, request.body);
        notSelf(request, request.params.id, "Nadie puede cambiar su propio cargo.");
        const actor = actorOf(request);
        inTransaction(app.db, (tx) => {
            const user = lockUser(tx, request.params.id);
            if (user.roleCode === roleCode) {
                return;
            }
            tx.update(users).set({ roleCode }).where(eq(users.id, user.id)).run();
            recordAudit(tx, actor, {
                area: "users",
                action: "user.role_changed",
                summary: `${actor.name} (${actor.role}) cambió el cargo de ${user.name} de ${roleName(user.roleCode)} a ${roleName(roleCode)}`,
                entityType: "user",
                entityId: user.id,
                before: { role: user.roleCode },
                after: { role: roleCode },
            });
        });
        return { ok: true };
    });
    app.post("/users/:id/suspend", guard, async (request) => {
        const { reason } = parse(reasonBody, request.body ?? {});
        notSelf(request, request.params.id, "No puede suspender su propia cuenta.");
        const actor = actorOf(request);
        inTransaction(app.db, (tx) => {
            const user = lockUser(tx, request.params.id);
            if (user.status !== "active" && user.status !== "invited") {
                throw new HttpError(409, "not_allowed", "Esa cuenta no está activa.");
            }
            tx.update(users).set({ status: "suspended" }).where(eq(users.id, user.id)).run();
            // Signed out everywhere, at once.
            endSessions(tx, { userId: user.id }, actor.userId);
            recordAudit(tx, actor, {
                area: "users",
                action: "user.suspended",
                summary: `${actor.name} (${actor.role}) suspendió la cuenta de ${user.name}`,
                entityType: "user",
                entityId: user.id,
                before: { status: user.status },
                after: { status: "suspended" },
                reason: reason ?? null,
            });
        });
        return { ok: true };
    });
    app.post("/users/:id/reactivate", guard, async (request) => {
        const actor = actorOf(request);
        inTransaction(app.db, (tx) => {
            const user = lockUser(tx, request.params.id);
            if (user.status !== "suspended") {
                throw new HttpError(409, "not_allowed", "Solo se puede reactivar una cuenta suspendida.");
            }
            // Its phones were signed out when it was suspended; the same password
            // signs them in again. An account with no password stays waiting for one.
            const status = user.passwordHash ? "active" : "invited";
            tx.update(users).set({ status }).where(eq(users.id, user.id)).run();
            recordAudit(tx, actor, {
                area: "users",
                action: "user.reactivated",
                summary: `${actor.name} (${actor.role}) reactivó la cuenta de ${user.name}`,
                entityType: "user",
                entityId: user.id,
                before: { status: user.status },
                after: { status },
            });
        });
        return { ok: true };
    });
    app.post("/users/:id/deactivate", guard, async (request) => {
        const { reason } = parse(reasonBody, request.body ?? {});
        notSelf(request, request.params.id, "No puede desactivar su propia cuenta.");
        const actor = actorOf(request);
        inTransaction(app.db, (tx) => {
            const user = lockUser(tx, request.params.id);
            if (user.status === "deactivated") {
                return;
            }
            tx.update(users).set({ status: "deactivated" }).where(eq(users.id, user.id)).run();
            endSessions(tx, { userId: user.id }, actor.userId);
            recordAudit(tx, actor, {
                area: "users",
                action: "user.deactivated",
                summary: `${actor.name} (${actor.role}) desactivó la cuenta de ${user.name}`,
                entityType: "user",
                entityId: user.id,
                before: { status: user.status },
                after: { status: "deactivated" },
                reason: reason ?? null,
            });
        });
        return { ok: true };
    });
};
//# sourceMappingURL=users.js.map