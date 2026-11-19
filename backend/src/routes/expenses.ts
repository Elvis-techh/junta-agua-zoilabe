/**
 * Gasto: money out (App Plan, Module 2, "Expense"): its category, who was
 * paid (the supplier), the amount, the date, and a photo of the receipt or
 * invoice. Each is one permanent entry in `transactions`, of kind "expense",
 * with a positive amount.
 *
 * The rules (owner, 15 November 2026, where the plan did not say):
 *
 *  - The photo is asked for every time. An expense with no paper (a day's
 *    work paid by hand) is saved without one only with a written reason, and
 *    shows as "Sin foto" so it can be reviewed.
 *  - It asks how it was paid, as Cobrar does; a transfer needs its reference.
 *  - The number on the supplier's invoice or receipt is optional. The same
 *    number from the same supplier is flagged, not blocked, so an invoice
 *    typed in twice is noticed.
 *  - "Otro gasto" says what it is.
 *  - A mistake is fixed as a payment is ("Anular"): a reversal entry with the
 *    opposite amount, dated today, pointing to the original, with a reason.
 *    Only the whole entry, at any time, and a reversal is final (owner,
 *    7 November 2026). The photo stays with the original.
 *
 * Photos stay on the computer until the storage bucket is connected
 * (src/lib/receiptPhotos.ts), and are read only through this API, by someone
 * who may see finances.
 */
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";

import { and, asc, desc, eq, isNull, ne, sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { actorOf } from "../auth/plugin.js";
import { newId } from "../auth/session.js";
import type { DbOrTx } from "../db/client.js";
import { inTransaction, searchText } from "../db/client.js";
import { categories, receiptFiles, transactions, users } from "../db/schema.js";
import { recordAudit } from "../lib/audit.js";
import { formatLempiras } from "../lib/census.js";
import { openMonthFor } from "../lib/entries.js";
import { monthName } from "../lib/fees.js";
import { HttpError, parse } from "../lib/http.js";
import { MAX_AMOUNT_CENTAVOS } from "../lib/money.js";
import { PHOTO_CONTENT_TYPE, decodePhoto, discardUnusedPhoto, photoFile, savePhoto } from "../lib/receiptPhotos.js";
import { businessToday, formatCalendarDate } from "../lib/time.js";

/** The expense category that must say what it is (src/db/seeding.ts). */
export const OTHER_EXPENSE = "Otro gasto";

const day = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "Elija la fecha del gasto.");
const optionalText = (max: number, tooLong: string) =>
  z
    .string()
    .trim()
    .max(max, tooLong)
    .optional()
    .transform((value) => (value ? value : null));

const expenseBody = z.object({
  submissionId: z.uuid(),
  categoryId: z.number({ message: "Elija qué gasto es." }).int("Elija qué gasto es."),
  supplier: z
    .string({ message: "Escriba a quién se le pagó." })
    .trim()
    .min(2, "Escriba a quién se le pagó.")
    .max(120, "El nombre es demasiado largo."),
  amountCentavos: z
    .number({ message: "Escriba el monto que se pagó." })
    .int("Escriba el monto en lempiras, por ejemplo 250 o 250.50.")
    .min(1, "Escriba el monto que se pagó.")
    .max(MAX_AMOUNT_CENTAVOS, "El monto es demasiado alto."),
  occurredOn: day,
  paymentMethod: z.enum(["cash", "transfer", "other"], { message: "Elija cómo se pagó." }),
  bankReference: optionalText(60, "La referencia es demasiado larga."),
  /** The number on the supplier's invoice or receipt, when it has one. */
  invoiceNumber: optionalText(30, "El número de la factura es demasiado largo."),
  note: optionalText(300, "La nota es demasiado larga."),
  /** The photo of the receipt or invoice: a JPEG, in base64. */
  photo: z.string().optional(),
  /** Why there is no photo. */
  noPhotoReason: optionalText(300, "El motivo es demasiado largo."),
  confirmRepeatedInvoice: z.boolean().optional(),
});

const reverseBody = z.object({
  reason: z
    .string({ message: "Escriba por qué se anula." })
    .trim()
    .min(5, "Escriba por qué se anula.")
    .max(300, "El motivo es demasiado largo."),
});

type Params = { id: string };

const NO_ENTRY = new HttpError(404, "not_found", "No se encontró ese gasto.");
const NO_PHOTO = new HttpError(404, "not_found", "No se encontró la foto de ese gasto.");

/** How many entries the list shows: the latest. */
const LIST_LIMIT = 30;

/**
 * Another expense, not reversed, with this invoice number from this
 * supplier: the latest, or null. The supplier's name is compared as the
 * census search compares names and with its spaces evened out, so
 * "Ferretería El Puente" and "ferreteria  el puente" are the same shop.
 */
function sameInvoice(tx: DbOrTx, entry: { number: string; supplier: string; exceptId?: string }) {
  const name = (supplier: string | null) => searchText(supplier ?? "").replace(/\s+/g, " ").trim();
  const supplier = name(entry.supplier);
  return (
    tx
      .select({
        id: transactions.id,
        supplier: transactions.supplier,
        occurredOn: transactions.occurredOn,
        amountCentavos: transactions.amountCentavos,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.kind, "expense"),
          eq(transactions.paperReceiptNumber, entry.number),
          isNull(transactions.reversesId),
          sql`NOT EXISTS (SELECT 1 FROM transactions r WHERE r.reverses_id = ${transactions.id})`,
          entry.exceptId ? ne(transactions.id, entry.exceptId) : undefined,
        ),
      )
      .orderBy(desc(transactions.createdAt))
      .all()
      .find((other) => name(other.supplier) === supplier) ?? null
  );
}

/** Expenses, newest first: one by id, or the latest. Reversals are not listed. */
function entriesOf(tx: DbOrTx, where: { id: string } | { latest: true }) {
  const rows = tx
    .select({
      id: transactions.id,
      categoryId: transactions.categoryId,
      category: categories.name,
      supplier: transactions.supplier,
      occurredOn: transactions.occurredOn,
      amountCentavos: transactions.amountCentavos,
      paymentMethod: transactions.paymentMethod,
      bankReference: transactions.bankReference,
      invoiceNumber: transactions.paperReceiptNumber,
      note: transactions.note,
      noPhotoReason: transactions.reason,
      recordedBy: users.name,
      createdAt: transactions.createdAt,
      photoId: receiptFiles.id,
    })
    .from(transactions)
    .innerJoin(users, eq(users.id, transactions.createdBy))
    .innerJoin(categories, eq(categories.id, transactions.categoryId))
    .leftJoin(receiptFiles, eq(receiptFiles.transactionId, transactions.id))
    .where(
      and(
        eq(transactions.kind, "expense"),
        isNull(transactions.reversesId),
        "id" in where ? eq(transactions.id, where.id) : undefined,
      ),
    )
    .orderBy(desc(transactions.occurredOn), desc(transactions.createdAt))
    .limit("id" in where ? 1 : LIST_LIMIT)
    .all();

  return rows.map(({ photoId, ...row }) => {
    const reversal = reversalOf(tx, row.id);
    return {
      ...row,
      hasPhoto: photoId !== null,
      repeatedInvoice:
        row.invoiceNumber !== null &&
        reversal === null &&
        sameInvoice(tx, { number: row.invoiceNumber, supplier: row.supplier ?? "", exceptId: row.id }) !== null,
      reversed: reversal !== null,
      reversal,
    };
  });
}

/** The entry that reversed this one, if one did: when, by whom and why. */
function reversalOf(tx: DbOrTx, id: string) {
  return (
    tx
      .select({
        id: transactions.id,
        occurredOn: transactions.occurredOn,
        reason: transactions.reason,
        recordedBy: users.name,
        createdAt: transactions.createdAt,
      })
      .from(transactions)
      .innerJoin(users, eq(users.id, transactions.createdBy))
      .where(eq(transactions.reversesId, id))
      .get() ?? null
  );
}

export const expenseRoutes: FastifyPluginAsync<{ timeZone: string; receiptsPath: string }> = async (app, options) => {
  const view = { preHandler: app.requirePermission("finance:view") };
  const record = { preHandler: app.requirePermission("finance:record") };
  const reverse = { preHandler: app.requirePermission("finance:reverse") };
  const today = () => businessToday(options.timeZone);

  /** What the screen needs before it asks anything: today, and the expense categories in use. */
  app.get("/finance/expenses/setup", record, async () => {
    const list = app.db
      .select({ id: categories.id, name: categories.name })
      .from(categories)
      .where(and(eq(categories.kind, "expense"), eq(categories.active, true)))
      .orderBy(asc(categories.id))
      .all();
    return { today: today(), categories: list.map((category) => ({ ...category, saysWhat: category.name === OTHER_EXPENSE })) };
  });

  /** The latest expenses, newest first. */
  app.get("/finance/expenses", view, async () => ({ entries: entriesOf(app.db, { latest: true }) }));

  /** Registrar un gasto. */
  app.post("/finance/expenses", record, async (request, reply) => {
    const body = parse(expenseBody, request.body);
    const actor = actorOf(request);
    const day = today();

    if (body.paymentMethod === "transfer" && !body.bankReference) {
      throw new HttpError(400, "invalid_request", "Escriba el número de referencia de la transferencia.");
    }
    if (body.occurredOn > day) {
      throw new HttpError(400, "invalid_request", "La fecha del gasto no puede ser después de hoy.");
    }
    if (!body.photo && (!body.noPhotoReason || body.noPhotoReason.length < 5)) {
      throw new HttpError(
        400,
        "photo_required",
        "Tome la foto del recibo o la factura. Si no hay, toque «No hay recibo» y escriba por qué.",
      );
    }

    // Slow work before the transaction: the photo is on the disk first, and
    // taken away again if its expense is not saved after all.
    const photoBytes = body.photo ? decodePhoto(body.photo) : null;
    const photoId = photoBytes ? newId() : null;
    const storageKey = photoBytes ? await savePhoto(options.receiptsPath, photoId!, photoBytes) : null;

    let result: { created: boolean; entry: ReturnType<typeof entriesOf>[number] };
    try {
      result = inTransaction(app.db, (tx) => {
        // A retry of an expense that already arrived gets that expense back, not a second one.
        const earlier = tx
          .select({ id: transactions.id })
          .from(transactions)
          .where(eq(transactions.submissionId, body.submissionId))
          .get();
        if (earlier) {
          const [entry] = entriesOf(tx, { id: earlier.id });
          if (!entry) {
            throw new HttpError(409, "submission_reused", "No se pudo completar. Intente de nuevo.");
          }
          return { created: false, entry };
        }

        const category = tx
          .select({ id: categories.id, name: categories.name })
          .from(categories)
          .where(and(eq(categories.id, body.categoryId), eq(categories.kind, "expense"), eq(categories.active, true)))
          .get();
        if (!category) {
          throw new HttpError(400, "invalid_request", "Elija qué gasto es.");
        }
        if (category.name === OTHER_EXPENSE && !body.note) {
          throw new HttpError(400, "invalid_request", "Escriba de qué es el gasto.");
        }

        const repeated = body.invoiceNumber ? sameInvoice(tx, { number: body.invoiceNumber, supplier: body.supplier }) : null;
        // Flagged, not blocked: two suppliers' books, or one that starts again, can share a number.
        if (repeated && !body.confirmRepeatedInvoice) {
          throw new HttpError(
            409,
            "invoice_repeated",
            `La factura nº ${body.invoiceNumber} de ${repeated.supplier} ya se registró el ` +
              `${formatCalendarDate(repeated.occurredOn)} (${formatLempiras(repeated.amountCentavos)}).`,
          );
        }

        const id = newId();
        const noPhotoReason = storageKey ? null : body.noPhotoReason;
        tx.insert(transactions)
          .values({
            id,
            kind: "expense",
            categoryId: category.id,
            monthId: openMonthFor(
              tx,
              body.occurredOn,
              (first) =>
                `El mes de ${monthName(first)} ya está cerrado. Registre el gasto con la fecha de hoy y escriba en la nota de qué fecha es.`,
            ),
            occurredOn: body.occurredOn,
            amountCentavos: body.amountCentavos,
            paymentMethod: body.paymentMethod,
            bankReference: body.paymentMethod === "transfer" ? body.bankReference : null,
            paperReceiptNumber: body.invoiceNumber,
            supplier: body.supplier,
            note: body.note,
            reason: noPhotoReason,
            submissionId: body.submissionId,
            createdBy: actor.userId!,
          })
          .run();
        if (storageKey) {
          tx.insert(receiptFiles)
            .values({
              id: photoId!,
              transactionId: id,
              storageKey,
              contentType: PHOTO_CONTENT_TYPE,
              sizeBytes: photoBytes!.length,
              createdBy: actor.userId!,
            })
            .run();
        }

        recordAudit(tx, actor, {
          area: "finances",
          action: "expense.recorded",
          summary:
            `${actor.name} (${actor.role}) registró un gasto de ${category.name}: ${formatLempiras(body.amountCentavos)} a ${body.supplier}` +
            (body.invoiceNumber ? `, factura nº ${body.invoiceNumber}` : "") +
            (storageKey ? "" : " (sin foto)") +
            (repeated ? " (número de factura repetido)" : ""),
          entityType: "transaction",
          entityId: id,
          after: {
            category: category.name,
            supplier: body.supplier,
            amountCentavos: body.amountCentavos,
            occurredOn: body.occurredOn,
            paymentMethod: body.paymentMethod,
            invoiceNumber: body.invoiceNumber,
            hasPhoto: storageKey !== null,
            repeatedInvoice: Boolean(repeated),
          },
          reason: noPhotoReason,
        });
        return { created: true, entry: entriesOf(tx, { id })[0]! };
      });
    } catch (error) {
      if (storageKey) {
        await discardUnusedPhoto(options.receiptsPath, storageKey);
      }
      throw error;
    }
    if (storageKey && !result.created) {
      await discardUnusedPhoto(options.receiptsPath, storageKey);
    }

    return reply.code(result.created ? 201 : 200).send({ entry: result.entry });
  });

  /** The photo of an expense's receipt or invoice. Never kept by the phone: it is asked for each time. */
  app.get<{ Params: Params }>("/finance/expenses/:id/photo", view, async (request, reply) => {
    if (!z.uuid().safeParse(request.params.id).success) {
      throw NO_PHOTO;
    }
    const file = app.db
      .select({ storageKey: receiptFiles.storageKey, contentType: receiptFiles.contentType })
      .from(receiptFiles)
      .innerJoin(transactions, eq(transactions.id, receiptFiles.transactionId))
      .where(and(eq(receiptFiles.transactionId, request.params.id), eq(transactions.kind, "expense")))
      .get();
    if (!file) {
      throw NO_PHOTO;
    }
    const path = photoFile(options.receiptsPath, file.storageKey);
    const found = await stat(path).catch(() => null);
    if (!found) {
      request.log.error({ storageKey: file.storageKey }, "A receipt photo is missing from the receipts folder");
      throw NO_PHOTO;
    }
    return reply
      .header("content-type", file.contentType)
      .header("content-length", found.size)
      .header("cache-control", "private, no-store")
      .header("x-content-type-options", "nosniff")
      .send(createReadStream(path));
  });

  /** Anular: a reversal entry for the whole expense, with its reason. */
  app.post<{ Params: Params }>("/finance/expenses/:id/reverse", reverse, async (request) => {
    if (!z.uuid().safeParse(request.params.id).success) {
      throw NO_ENTRY;
    }
    const body = parse(reverseBody, request.body);
    const actor = actorOf(request);
    const day = today();

    return inTransaction(app.db, (tx) => {
      // Only an expense, never a reversal: a reversal is final.
      const [entry] = entriesOf(tx, { id: request.params.id });
      if (!entry) {
        throw NO_ENTRY;
      }
      if (entry.reversal) {
        throw new HttpError(
          409,
          "already_reversed",
          `Este gasto ya se anuló el ${formatCalendarDate(entry.reversal.occurredOn)} (${entry.reversal.recordedBy}).`,
        );
      }
      const original = tx.select().from(transactions).where(eq(transactions.id, entry.id)).get()!;

      const id = newId();
      tx.insert(transactions)
        .values({
          id,
          kind: original.kind,
          categoryId: original.categoryId,
          monthId: openMonthFor(tx, day, (first) => `El mes de ${monthName(first)} ya está cerrado.`),
          occurredOn: day,
          amountCentavos: -original.amountCentavos,
          // Kept so the reversal can be found beside its invoice.
          paperReceiptNumber: original.paperReceiptNumber,
          supplier: original.supplier,
          reversesId: original.id,
          reason: body.reason,
          createdBy: actor.userId!,
        })
        .run();

      recordAudit(tx, actor, {
        area: "finances",
        action: "expense.reversed",
        summary:
          `${actor.name} (${actor.role}) anuló el gasto de ${entry.category}: ${formatLempiras(original.amountCentavos)} a ${original.supplier}` +
          ` del ${formatCalendarDate(original.occurredOn)}` +
          (original.paperReceiptNumber ? `, factura nº ${original.paperReceiptNumber}` : ""),
        entityType: "transaction",
        entityId: original.id,
        before: {
          category: entry.category,
          supplier: original.supplier,
          amountCentavos: original.amountCentavos,
          occurredOn: original.occurredOn,
          invoiceNumber: original.paperReceiptNumber,
        },
        after: { reversalId: id, amountCentavos: -original.amountCentavos, occurredOn: day },
        reason: body.reason,
      });

      return { entry: entriesOf(tx, { id: original.id })[0]! };
    });
  });
};
