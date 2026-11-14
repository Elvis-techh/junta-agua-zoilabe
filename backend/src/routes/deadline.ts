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
import { monthName } from "../lib/fees.js";
import { parse } from "../lib/http.js";
import type { Deadline } from "../lib/settings.js";
import { DEADLINE_KEY, DEFAULT_DEADLINE, LATE_FEES_FROM_KEY, deadline, lateFeesFrom } from "../lib/settings.js";
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

const lateFeesBody = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-01$/, "Elija el mes desde el que se cobra la mora."),
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

  /**
   * Configuración → Mora (owner, 14 November 2026): the month from which the
   * app adds a late fee by itself to every month not paid in full by its
   * deadline (src/lib/lateFees.ts). Each change is a new row and is logged.
   */
  app.get("/settings/late-fees", guard, async () => {
    const day = today();
    const saved = app.db
      .select({ savedAt: settings.createdAt, savedBy: users.name })
      .from(settings)
      .leftJoin(users, eq(users.id, settings.createdBy))
      .where(eq(settings.key, LATE_FEES_FROM_KEY))
      .orderBy(desc(settings.id))
      .limit(1)
      .get();
    return { today: day, from: lateFeesFrom(app.db, day), saved: saved ?? null };
  });

  app.post("/settings/late-fees", guard, async (request) => {
    const body = parse(lateFeesBody, request.body);
    const actor = actorOf(request);
    const day = today();

    inTransaction(app.db, (tx) => {
      const before = lateFeesFrom(tx, day);
      if (before === body.month) {
        return;
      }
      tx.insert(settings)
        .values({ key: LATE_FEES_FROM_KEY, value: { month: body.month }, effectiveFrom: day, createdBy: actor.userId })
        .run();
      recordAudit(tx, actor, {
        area: "settings",
        action: "late_fees_from.set",
        summary:
          `${actor.name} (${actor.role}) fijó desde qué mes se cobra la mora: ${monthName(body.month)}` +
          (before ? ` (antes ${monthName(before)})` : " (antes no se cobraba sola)"),
        entityType: "setting",
        entityId: LATE_FEES_FROM_KEY,
        before: before ? { month: before } : null,
        after: { month: body.month },
      });
    });

    return { from: body.month };
  });
};
