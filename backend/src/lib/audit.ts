/**
 * The history log (Module 4): who did what, when, to which record.
 *
 * Three things protect it, from the outside in:
 *
 *  1. The database refuses any UPDATE or DELETE on `audit_log`
 *     (src/db/guards.ts). A bug in the app cannot rewrite history.
 *  2. Each entry stores the hash of the entry before it, and its own hash
 *     covers that plus everything it says. Someone who opens the database
 *     file with other tools and edits or removes an entry breaks the chain
 *     from that point on, and the nightly `verifyChain` reports it in
 *     Configuración.
 *  3. Every nightly backup carries the log, kept permanently.
 *
 * Entries are written in the same transaction as the change they describe, so
 * a change that rolls back takes its entry with it — a log that records things
 * that did not happen is worse than none. Transactions run one at a time
 * (`inTransaction`), so two entries can never chain to the same predecessor.
 */
import { createHash } from "node:crypto";

import { asc, desc, gt } from "drizzle-orm";

import type { DbOrTx, Tx } from "../db/client.js";
import { inTransaction } from "../db/client.js";
import { auditLog } from "../db/schema.js";

/** The `prev_hash` of the very first entry. */
export const GENESIS_HASH = "0".repeat(64);

export type AuditArea = (typeof auditLog.$inferInsert)["area"];

/** Who acted. Copied into the entry, so the log still reads right after a rename. */
export interface Actor {
  userId: string | null;
  guestId?: string | null;
  name: string;
  /** The role's display name at that moment, e.g. "Tesorero/a". */
  role: string;
  /** The phone or browser it came from, as its user agent describes it. */
  device?: string | null;
}

/** For entries the system writes itself: the first administrator, the nightly check. */
export const SYSTEM_ACTOR: Actor = { userId: null, name: "Sistema", role: "Sistema" };

export interface AuditEntry {
  area: AuditArea;
  /** A stable code for filtering, e.g. "user.created", "security.pin_failed". */
  action: string;
  /** The entry as the Historial reads it, without the date: "Ana (Presidente) creó la cuenta de…". */
  summary: string;
  entityType?: string | null;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
}

/** What the hash covers: every column except `id` and the hashes themselves. */
type HashedFields = {
  occurredAt: Date;
  actorUserId: string | null;
  actorGuestId: string | null;
  actorName: string;
  actorRole: string;
  area: string;
  action: string;
  summary: string;
  entityType: string | null;
  entityId: string | null;
  before: unknown;
  after: unknown;
  reason: string | null;
  device: string | null;
};

/**
 * JSON with object keys sorted at every level.
 *
 * The hash is taken over a form that does not depend on the order keys were
 * written in, so what is hashed at write time and what is read back at check
 * time come out byte for byte the same, whatever stored them in between.
 */
export function canonicalJson(value: unknown): string {
  if (value === undefined || value === null) {
    return "null";
  }
  if (value instanceof Date) {
    return JSON.stringify(value.toISOString());
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function entryHash(prevHash: string, fields: HashedFields): string {
  return createHash("sha256").update(prevHash).update("\n").update(canonicalJson(fields)).digest("hex");
}

/**
 * Append one entry to the history log. Takes a transaction handle, never the
 * plain database: the entry must commit or roll back with the change.
 */
export function recordAudit(tx: Tx, actor: Actor, entry: AuditEntry): void {
  const last = tx
    .select({ hash: auditLog.hash })
    .from(auditLog)
    .orderBy(desc(auditLog.id))
    .limit(1)
    .get();

  const prevHash = last?.hash ?? GENESIS_HASH;

  const fields: HashedFields = {
    occurredAt: new Date(),
    actorUserId: actor.userId,
    actorGuestId: actor.guestId ?? null,
    actorName: actor.name,
    actorRole: actor.role,
    area: entry.area,
    action: entry.action,
    summary: entry.summary,
    entityType: entry.entityType ?? null,
    entityId: entry.entityId ?? null,
    // Through JSON once, so what is hashed is exactly what the column will hold
    // (no `undefined`, Dates as strings).
    before: entry.before === undefined ? null : JSON.parse(JSON.stringify(entry.before)),
    after: entry.after === undefined ? null : JSON.parse(JSON.stringify(entry.after)),
    reason: entry.reason ?? null,
    device: actor.device ? actor.device.slice(0, 300) : null,
  };

  tx.insert(auditLog)
    .values({
      ...fields,
      area: entry.area,
      prevHash,
      hash: entryHash(prevHash, fields),
    })
    .run();
}

/** Write one entry in a transaction of its own, for events that change nothing else. */
export function recordAuditAlone(db: DbOrTx, actor: Actor, entry: AuditEntry): void {
  inTransaction(db, (tx) => recordAudit(tx, actor, entry));
}

export interface ChainCheck {
  ok: boolean;
  checked: number;
  /** The first entry whose hash or link does not match, when `ok` is false. */
  brokenAtId: number | null;
}

/**
 * Walk the whole log in order and recompute every hash.
 *
 * A changed entry no longer matches its own hash; a removed one leaves the
 * next entry pointing at a predecessor that is not there; an inserted one
 * breaks the link of the entry after it.
 */
export function verifyChain(db: DbOrTx, batchSize = 1000): ChainCheck {
  let prevHash = GENESIS_HASH;
  let lastId = 0;
  let checked = 0;

  for (;;) {
    const rows = db
      .select()
      .from(auditLog)
      .where(gt(auditLog.id, lastId))
      .orderBy(asc(auditLog.id))
      .limit(batchSize)
      .all();

    if (rows.length === 0) {
      return { ok: true, checked, brokenAtId: null };
    }

    for (const row of rows) {
      const expected = entryHash(prevHash, {
        occurredAt: row.occurredAt,
        actorUserId: row.actorUserId,
        actorGuestId: row.actorGuestId,
        actorName: row.actorName,
        actorRole: row.actorRole,
        area: row.area,
        action: row.action,
        summary: row.summary,
        entityType: row.entityType,
        entityId: row.entityId,
        before: row.before,
        after: row.after,
        reason: row.reason,
        device: row.device,
      });

      if (row.prevHash !== prevHash || row.hash !== expected) {
        return { ok: false, checked, brokenAtId: row.id };
      }

      prevHash = row.hash;
      lastId = row.id;
      checked += 1;
    }
  }
}
