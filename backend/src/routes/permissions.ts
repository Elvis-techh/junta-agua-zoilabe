/**
 * The Permisos tab: the role-by-permission matrix, read and edited as data.
 */
import { asc, eq, sql } from "drizzle-orm";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { actorOf } from "../auth/plugin.js";
import { inTransaction } from "../db/client.js";
import { rolePermissions, roles } from "../db/schema.js";
import { recordAudit } from "../lib/audit.js";
import { HttpError, parse } from "../lib/http.js";
import type { Permission } from "../lib/permissions.js";
import { PERMISSIONS, PERMISSION_CODES, isPermission, isRoleCode, matrixProblem } from "../lib/permissions.js";

const updateBody = z.object({
  granted: z.array(z.string()).max(PERMISSION_CODES.length),
});

export const permissionRoutes: FastifyPluginAsync = async (app) => {
  /** Editors may read too; the matrix is no secret from someone who can change it. */
  const canView = async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user;
    if (user && !user.permissions.has("permissions:view") && user.permissions.has("permissions:edit")) {
      return;
    }
    await app.requirePermission("permissions:view")(request, reply);
  };

  app.get("/permissions", { preHandler: canView }, async () => {
    const roleRows = await app.db.select().from(roles).orderBy(asc(roles.sortOrder));
    const grants = await app.db
      .select({ roleCode: rolePermissions.roleCode, permission: rolePermissions.permission })
      .from(rolePermissions)
      .where(eq(rolePermissions.granted, true));

    return {
      permissions: PERMISSION_CODES.map((code) => ({ code, label: PERMISSIONS[code] })),
      roles: roleRows.map((role) => ({
        code: role.code,
        name: role.name,
        granted: grants.filter((g) => g.roleCode === role.code).map((g) => g.permission),
      })),
    };
  });

  app.put<{ Params: { role: string } }>(
    "/permissions/:role",
    { preHandler: app.requirePermission("permissions:edit") },
    async (request) => {
      const { role } = request.params;
      if (!isRoleCode(role)) {
        throw new HttpError(404, "not_found", "Ese cargo no existe.");
      }

      const body = parse(updateBody, request.body);
      const unknown = body.granted.find((code) => !isPermission(code));
      if (unknown) {
        throw new HttpError(400, "invalid_request", `Permiso desconocido: ${unknown}`);
      }
      const granted = new Set(body.granted as Permission[]);

      const problem = matrixProblem(role, granted);
      if (problem) {
        throw new HttpError(409, "not_allowed", problem);
      }

      const actor = actorOf(request);

      return inTransaction(app.db, (tx) => {
        const current = tx
          .select({ permission: rolePermissions.permission })
          .from(rolePermissions)
          .where(sql`${rolePermissions.roleCode} = ${role} AND ${rolePermissions.granted}`)
          .all();
        const before = current.map((row) => row.permission).sort();
        const after = [...granted].sort();

        if (before.join() === after.join()) {
          return { changed: false };
        }

        tx
          .insert(rolePermissions)
          .values(
            PERMISSION_CODES.map((permission) => ({
              roleCode: role,
              permission,
              granted: granted.has(permission),
              updatedBy: actor.userId,
            })),
          )
          .onConflictDoUpdate({
            target: [rolePermissions.roleCode, rolePermissions.permission],
            set: {
              granted: sql`excluded.granted`,
              updatedAt: new Date(),
              updatedBy: sql`excluded.updated_by`,
            },
          })
          .run();

        const roleRow = tx.select({ name: roles.name }).from(roles).where(eq(roles.code, role)).get();
        recordAudit(tx, actor, {
          area: "settings",
          action: "permissions.updated",
          summary: `${actor.name} (${actor.role}) cambió los permisos del cargo ${roleRow?.name ?? role}`,
          entityType: "role",
          entityId: role,
          before: { granted: before },
          after: { granted: after },
        });

        return { changed: true };
      });
    },
  );
};
