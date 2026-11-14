/**
 * Configuración → Plazo de pago (owner, 13 November 2026): the day of each
 * month by which its fee is paid, and the grace days after it. A month not
 * paid in full counts as owed ("Debe el mes de …") once both are over.
 *
 * A change is a new row in `settings`, never an edit, and is logged; the
 * newest applies to every month.
 */
import { desc, eq } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { actorOf } from "../auth/plugin.js";
import { inTransaction } from "../db/client.js";
import { settings, users } from "../db/schema.js";
import { recordAudit } from "../lib/audit.js";
import { parse } from "../lib/http.js";
import type { Deadline } from "../lib/settings.js";
import { DEADLINE_KEY, DEFAULT_DEADLINE, deadline } from "../lib/settings.js";
import { businessToday } from "../lib/time.js";

const deadlineBody = z.object({
  dueDay: z
    .number({ message: "Escriba el día del mes en que se paga." })
    .int("Escriba el día del mes en que se paga.")
    .min(1, "El día va del 1 al 31.")
    .max(31, "El día va del 1 al 31."),
  graceDays: z
    .number({ message: "Escriba los días de gracia, o 0." })
    .int("Escriba los días de gracia, o 0.")
    .min(0, "Los días de gracia no pueden ser negativos.")
    .max(60, "Son demasiados días de gracia."),
});

/** "el día 25, con 5 días de gracia" — how the history log says it. */
export function deadlineWords(rule: Deadline): string {
  const day = rule.dueDay >= 31 ? "el último día del mes" : `el día ${rule.dueDay}`;
  const grace = rule.graceDays === 0 ? "sin días de gracia" : rule.graceDays === 1 ? "con 1 día de gracia" : `con ${rule.graceDays} días de gracia`;
  return `${day}, ${grace}`;
}

export const deadlineRoutes: FastifyPluginAsync<{ timeZone: string }> = async (app, options) => {
  const guard = { preHandler: app.requirePermission("settings:edit") };
  const today = () => businessToday(options.timeZone);

  app.get("/settings/deadline", guard, async () => {
    const day = today();
    const saved = app.db
      .select({ savedAt: settings.createdAt, savedBy: users.name })
      .from(settings)
      .leftJoin(users, eq(users.id, settings.createdBy))
      .where(eq(settings.key, DEADLINE_KEY))
      .orderBy(desc(settings.id))
      .limit(1)
      .get();
    return { today: day, deadline: deadline(app.db, day), saved: saved ?? null };
  });

  app.post("/settings/deadline", guard, async (request) => {
    const body = parse(deadlineBody, request.body);
    const actor = actorOf(request);
    const day = today();

    inTransaction(app.db, (tx) => {
      const before = deadline(tx, day);
      if (before.dueDay === body.dueDay && before.graceDays === body.graceDays) {
        return;
      }
      tx.insert(settings).values({ key: DEADLINE_KEY, value: body, effectiveFrom: day, createdBy: actor.userId }).run();
      recordAudit(tx, actor, {
        area: "settings",
        action: "deadline.set",
        summary: `${actor.name} (${actor.role}) fijó el plazo de pago: ${deadlineWords(body)} (antes ${deadlineWords(before)})`,
        entityType: "setting",
        entityId: DEADLINE_KEY,
        before,
        after: body,
      });
    });

    return { deadline: body, default: DEFAULT_DEADLINE };
  });
};
