/**
 * The eighteen tables of the App Plan's data model (docs/app-plan.md, "Data
 * model"). Phase 0 uses users, roles, role_permissions, access_tokens,
 * audit_log and settings; the rest are created now so the whole schema is
 * reviewed once, and filled by the census and finance phases.
 *
 * Rules every table follows:
 *
 *  - Nothing is deleted. Every table has a trigger that refuses DELETE
 *    (src/db/guards.ts). Records carry a status, a revoked date or an end
 *    date instead.
 *  - Every row says who created it and when. `created_by` is null only for
 *    rows the system writes itself (the seed, the first administrator).
 *  - Money is whole centavos in integer columns, never a float or a decimal.
 *  - Instants are ISO-8601 text in UTC ("2026-10-23T18:04:05.123Z"), read
 *    back as a Date. Text in that one fixed form sorts by time, reads plainly
 *    when the file is opened, and moves to PostgreSQL unchanged. Calendar
 *    facts — the day a payment was received, the month it covers — are text
 *    "2026-10-23", decided in Honduras time by the app.
 *  - IDs are text UUIDs made by the app; lists the board edits (sectors,
 *    categories, fee rates) count up from 1.
 */
import { sql } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import {
  check,
  customType,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/** An instant, kept as ISO-8601 UTC text and handed to the code as a Date. */
const instant = customType<{ data: Date; driverData: string }>({
  dataType: () => "text",
  toDriver: (value) => value.toISOString(),
  fromDriver: (value) => new Date(value),
});
/** Now, in the same form `toISOString()` writes: milliseconds and a Z. */
const NOW = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;
const createdAt = () => instant("created_at").notNull().default(NOW);

/** Text UUIDs, made by the app (`newId()`). */
const uuid = (name: string) => text(name);
/** A calendar date, "2026-10-23". */
const date = (name: string) => text(name);
const boolean = (name: string) => integer(name, { mode: "boolean" });
/** Whole numbers; SQLite's integers are 64-bit, so this holds any amount of centavos. */
const bigint = (name: string) => integer(name);
const serial = (name: string) => integer(name).primaryKey({ autoIncrement: true });
/** JSON, kept as text. */
const json = <T = unknown>(name: string) => text(name, { mode: "json" }).$type<T>();

/** `column` is exactly `digits` characters, all of them 0–9. */
const onlyDigits = (column: AnySQLiteColumn, digits: number) =>
  sql`(length(${column}) = ${sql.raw(String(digits))} AND ${column} NOT GLOB '*[^0-9]*')`;

/**
 * `column` is a whole phone number: a plus, then 8 to 15 digits, code included
 * ("+50499998888"). How long each country's numbers are is checked by
 * src/lib/phone.ts, so adding a country does not mean rebuilding a table.
 */
const wholePhone = (column: AnySQLiteColumn) =>
  sql`(length(${column}) BETWEEN 9 AND 16 AND ${column} GLOB '+*' AND substr(${column}, 2) NOT GLOB '*[^0-9]*')`;

// ---------------------------------------------------------------------------
// Users and access
// ---------------------------------------------------------------------------

/** The eight board roles. `code` is what the code compares; `name` is shown. */
export const roles = sqliteTable("roles", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull(),
});

/**
 * Which permission codes each role holds — the Permisos tab edits this.
 *
 * A permission is switched off by setting `granted` to false, not by deleting
 * the row, because no row can be deleted.
 */
export const rolePermissions = sqliteTable(
  "role_permissions",
  {
    roleCode: text("role_code")
      .notNull()
      .references(() => roles.code),
    permission: text("permission").notNull(),
    granted: boolean("granted").notNull(),
    updatedAt: instant("updated_at").notNull().default(NOW),
    updatedBy: uuid("updated_by").references(() => users.id),
  },
  (table) => [primaryKey({ columns: [table.roleCode, table.permission] })],
);

export const users = sqliteTable(
  "users",
  {
    id: uuid("id").primaryKey(),
    name: text("name").notNull(),
    /** WhatsApp number with its country code: "+50499998888". */
    phone: text("phone").notNull(),
    roleCode: text("role_code")
      .notNull()
      .references(() => roles.code),
    /**
     * New accounts start "active". "invited" is an account made before
     * 9 November 2026 that never accepted its invitation link.
     */
    status: text("status", { enum: ["invited", "active", "suspended", "deactivated"] }).notNull(),
    /**
     * scrypt hash of the password the administrator set. Null for an account
     * from before 9 November 2026 (when a PIN was the way in) until an
     * administrator gives it a password; until then it cannot sign in.
     */
    passwordHash: text("password_hash"),
    lastLoginAt: instant("last_login_at"),
    createdAt: createdAt(),
    createdBy: uuid("created_by"),
  },
  (table) => [
    uniqueIndex("users_phone_unique").on(table.phone),
    check("users_phone_digits", wholePhone(table.phone)),
  ],
);

/**
 * Sign-in sessions (kind "session"), one per phone signed in.
 *
 * Rows of kind "invitation" and "device", and the columns only they use, are
 * history from before 9 November 2026, when an invitation link and a 6-digit
 * PIN were the way in. Nothing writes them now.
 *
 * Only the SHA-256 of each token is stored, so a copy of a backup cannot be
 * used to sign in.
 */
export const accessTokens = sqliteTable(
  "access_tokens",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    kind: text("kind", { enum: ["invitation", "device", "session"] }).notNull(),
    tokenHash: text("token_hash").notNull(),
    /** Before 9 November 2026: the remembered phone a session was opened on. */
    deviceId: uuid("device_id"),
    /** Before 9 November 2026: a short description of a remembered phone. */
    label: text("label"),
    expiresAt: instant("expires_at").notNull(),
    /** Before 9 November 2026: when an invitation link was used. */
    usedAt: instant("used_at"),
    /** For a session: when it was opened or last pushed forward by use. */
    lastUsedAt: instant("last_used_at"),
    /** Before 9 November 2026: when the PIN was last typed again for a sensitive action. */
    pinConfirmedAt: instant("pin_confirmed_at"),
    revokedAt: instant("revoked_at"),
    revokedBy: uuid("revoked_by").references(() => users.id),
    createdAt: createdAt(),
    createdBy: uuid("created_by").references(() => users.id),
  },
  (table) => [
    uniqueIndex("access_tokens_hash_unique").on(table.tokenHash),
    index("access_tokens_user_idx").on(table.userId, table.kind),
  ],
);

/**
 * Temporary, view-only access for someone outside the board (Module 3).
 *
 * `permissions` holds the guest permission codes the invitation grants
 * (src/lib/permissions.ts, GUEST_PERMISSIONS). History, users and settings
 * can never be among them.
 */
export const guestInvitations = sqliteTable(
  "guest_invitations",
  {
    id: uuid("id").primaryKey(),
    guestName: text("guest_name").notNull(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    permissions: json<string[]>("permissions").notNull(),
    expiresAt: instant("expires_at").notNull(),
    revokedAt: instant("revoked_at"),
    revokedBy: uuid("revoked_by").references(() => users.id),
    lastSignInAt: instant("last_sign_in_at"),
    createdAt: createdAt(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
  },
  (table) => [index("guest_invitations_email_idx").on(table.email)],
);

// ---------------------------------------------------------------------------
// Census
// ---------------------------------------------------------------------------

export const sectors = sqliteTable("sectors", {
  id: serial("id"),
  name: text("name").notNull().unique(),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
  createdBy: uuid("created_by").references(() => users.id),
});

/** One row per person. One person can own several households. */
export const people = sqliteTable(
  "people",
  {
    id: uuid("id").primaryKey(),
    fullName: text("full_name").notNull(),
    /**
     * Honduran identity number, 13 digits; null when the family did not give
     * it (owner, 19 November 2026). Many people may have none; one number
     * belongs to one person.
     */
    idNumber: text("id_number"),
    /** With its country code: "+50499998888". */
    phone: text("phone"),
    /** Why there is no phone: the family has none, or prefers not to give it. */
    phoneMissing: text("phone_missing", { enum: ["no_phone", "declined"] }),
    gender: text("gender"),
    createdAt: createdAt(),
    createdBy: uuid("created_by").references(() => users.id),
  },
  (table) => [
    uniqueIndex("people_id_number_unique").on(table.idNumber),
    check("people_id_number_digits", sql`${table.idNumber} IS NULL OR ${onlyDigits(table.idNumber, 13)}`),
    check("people_phone_digits", sql`${table.phone} IS NULL OR ${wholePhone(table.phone)}`),
    // A phone, or the reason there is none — never both, never neither.
    check("people_phone_or_reason", sql`(${table.phone} IS NULL) <> (${table.phoneMissing} IS NULL)`),
  ],
);

export const households = sqliteTable(
  "households",
  {
    id: uuid("id").primaryKey(),
    /** Z-0001, sequential, never reused. */
    code: text("code").notNull(),
    sectorId: integer("sector_id")
      .notNull()
      .references(() => sectors.id),
    /** How to find the house; null when nobody wrote it (owner, 19 November 2026). */
    references: text("references"),
    gpsLat: real("gps_lat"),
    gpsLng: real("gps_lng"),
    waterConnection: text("water_connection", {
      enum: ["connected", "not_connected", "shared"],
    }).notNull(),
    status: text("status", { enum: ["active", "inactive"] }).notNull(),
    inactiveReason: text("inactive_reason"),
    /** Paper entry mode: the date and number written on the paper form. */
    paperDate: date("paper_date"),
    paperFormNumber: text("paper_form_number"),
    /** Made on the phone, so a retry on weak signal cannot create a second record. */
    submissionId: uuid("submission_id").notNull(),
    lastVerifiedOn: date("last_verified_on"),
    createdAt: createdAt(),
    createdBy: uuid("created_by").references(() => users.id),
  },
  (table) => [
    uniqueIndex("households_code_unique").on(table.code),
    uniqueIndex("households_submission_unique").on(table.submissionId),
    check(
      "households_inactive_reason",
      sql`${table.status} = 'active' OR ${table.inactiveReason} IS NOT NULL`,
    ),
  ],
);

/**
 * A household's status and water connection over time (owner, 14 November
 * 2026): each row says that from `starts_on` on, the house is active or
 * inactive, with this connection. The state on a day is the newest row
 * entered whose `starts_on` is not after it, so an entry dated in the past
 * ("sin conexión desde marzo de 2025") takes over from its date without
 * changing what was entered before. `households.status` and
 * `households.water_connection` keep the state of today.
 *
 * Append-only, like `transactions`: a wrong entry is put right by a newer
 * one. src/lib/householdStatus.ts reads it.
 */
export const householdStatusChanges = sqliteTable(
  "household_status_changes",
  {
    id: serial("id"),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id),
    status: text("status", { enum: ["active", "inactive"] }).notNull(),
    inactiveReason: text("inactive_reason"),
    waterConnection: text("water_connection", { enum: ["connected", "not_connected", "shared"] }).notNull(),
    startsOn: date("starts_on").notNull(),
    createdAt: createdAt(),
    /** Null for the rows the migration made from households registered before the history existed. */
    createdBy: uuid("created_by").references(() => users.id),
  },
  (table) => [
    index("household_status_changes_household_idx").on(table.householdId),
    check(
      "household_status_changes_inactive_reason",
      sql`${table.status} = 'active' OR ${table.inactiveReason} IS NOT NULL`,
    ),
  ],
);

/** Who owns (or rents, or looks after) which household, and from when to when. */
export const householdOwners = sqliteTable(
  "household_owners",
  {
    id: uuid("id").primaryKey(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id),
    relation: text("relation", { enum: ["owner", "renter", "caretaker", "other"] }).notNull(),
    startsOn: date("starts_on").notNull(),
    endsOn: date("ends_on"),
    createdAt: createdAt(),
    createdBy: uuid("created_by").references(() => users.id),
  },
  (table) => [index("household_owners_household_idx").on(table.householdId)],
);

/** A monthly amount different from the base fee, with the board's reason. */
export const householdFees = sqliteTable(
  "household_fees",
  {
    id: uuid("id").primaryKey(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id),
    monthlyAmountCentavos: bigint("monthly_amount_centavos").notNull(),
    reason: text("reason").notNull(),
    startsOn: date("starts_on").notNull(),
    endsOn: date("ends_on"),
    createdAt: createdAt(),
    createdBy: uuid("created_by").references(() => users.id),
  },
  (table) => [
    index("household_fees_household_idx").on(table.householdId),
    check("household_fees_amount", sql`${table.monthlyAmountCentavos} >= 0`),
  ],
);

// ---------------------------------------------------------------------------
// Finances
// ---------------------------------------------------------------------------

/**
 * Base monthly fee, late fee (mora), reconnection fee and connection fee, each
 * from a start date.
 *
 * An amount the board did not mean, or no longer wants, is removed ("Quitar")
 * until a payment covers its month: the row stays, with when, who and why,
 * and no longer counts. Its month is then free for another amount.
 */
export const feeRates = sqliteTable(
  "fee_rates",
  {
    id: serial("id"),
    kind: text("kind", { enum: ["base_monthly", "late_fee", "reconnection", "connection"] }).notNull(),
    amountCentavos: bigint("amount_centavos").notNull(),
    startsOn: date("starts_on").notNull(),
    createdAt: createdAt(),
    createdBy: uuid("created_by").references(() => users.id),
    removedAt: instant("removed_at"),
    removedBy: uuid("removed_by").references(() => users.id),
    removedReason: text("removed_reason"),
  },
  (table) => [
    uniqueIndex("fee_rates_kind_start_unique")
      .on(table.kind, table.startsOn)
      .where(sql`${table.removedAt} IS NULL`),
    check("fee_rates_amount", sql`${table.amountCentavos} >= 0`),
    // A removed amount always says why.
    check("fee_rates_removed_reason", sql`(${table.removedAt} IS NULL) = (${table.removedReason} IS NULL)`),
  ],
);

export const categories = sqliteTable(
  "categories",
  {
    id: serial("id"),
    kind: text("kind", { enum: ["income", "expense"] }).notNull(),
    name: text("name").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    createdBy: uuid("created_by").references(() => users.id),
  },
  (table) => [uniqueIndex("categories_kind_name_unique").on(table.kind, table.name)],
);

/**
 * One row per calendar month; `month` is its first day.
 *
 * The month close (owner, 19 November 2026, src/lib/monthClose.ts): someone
 * prepares it with the cash counted, which is kept beside the cash the app
 * expected and, when they differ, why; someone else approves it ("closed")
 * or sends it back ("open" again, with who and why in `returned_*`). The
 * difference counted minus expected is the month's "Faltante" or "Sobrante
 * de caja": from a closed month on, the cash counts from what was counted.
 */
export const months = sqliteTable(
  "months",
  {
    id: serial("id"),
    month: date("month").notNull(),
    status: text("status", { enum: ["open", "prepared", "closed"] }).notNull(),
    cashCountedCentavos: bigint("cash_counted_centavos"),
    expectedCashCentavos: bigint("expected_cash_centavos"),
    cashDifferenceReason: text("cash_difference_reason"),
    preparedBy: uuid("prepared_by").references(() => users.id),
    preparedAt: instant("prepared_at"),
    approvedBy: uuid("approved_by").references(() => users.id),
    approvedAt: instant("approved_at"),
    returnedBy: uuid("returned_by").references(() => users.id),
    returnedAt: instant("returned_at"),
    returnedReason: text("returned_reason"),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("months_month_unique").on(table.month),
    check("months_first_day", sql`substr(${table.month}, 9, 2) = '01'`),
    // Separation of duties, in the database as well as in the app.
    check(
      "months_preparer_not_approver",
      sql`${table.approvedBy} IS NULL OR ${table.approvedBy} <> ${table.preparedBy}`,
    ),
  ],
);

/**
 * Every income and expense, as permanent entries.
 *
 * Append-only: rows are inserted and read, never updated or deleted. A
 * mistake is fixed with a reversal row whose `reverses_id` points at the
 * original and whose amount has the opposite sign; both stay visible.
 */
export const transactions = sqliteTable(
  "transactions",
  {
    id: uuid("id").primaryKey(),
    kind: text("kind", { enum: ["income", "expense"] }).notNull(),
    categoryId: integer("category_id")
      .notNull()
      .references(() => categories.id),
    householdId: uuid("household_id").references(() => households.id),
    monthId: integer("month_id")
      .notNull()
      .references(() => months.id),
    occurredOn: date("occurred_on").notNull(),
    /** Signed: a reversal carries the opposite sign of the entry it reverses. */
    amountCentavos: bigint("amount_centavos").notNull(),
    /** The month(s) a fee payment covers, as first-of-month dates. */
    monthsCovered: json<string[]>("months_covered"),
    paymentMethod: text("payment_method", { enum: ["cash", "transfer", "other"] }),
    bankReference: text("bank_reference"),
    /**
     * Income: the number printed on the paper receipt handed to the payer.
     * Expense: the number on the supplier's invoice or receipt, when it has one.
     */
    paperReceiptNumber: text("paper_receipt_number"),
    payerName: text("payer_name"),
    supplier: text("supplier"),
    note: text("note"),
    reversesId: uuid("reverses_id"),
    /**
     * Why this entry is not the usual one: why a reversal was made, why other
     * income is not Configuración's amount, or why an expense has no photo.
     */
    reason: text("reason"),
    /** Made on the phone, so a retry on weak signal cannot record the same payment twice. */
    submissionId: uuid("submission_id"),
    createdAt: createdAt(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
  },
  (table) => [
    index("transactions_month_idx").on(table.monthId),
    uniqueIndex("transactions_submission_unique").on(table.submissionId),
    index("transactions_household_idx").on(table.householdId),
    uniqueIndex("transactions_reverses_unique").on(table.reversesId),
    check(
      "transactions_reversal_reason",
      sql`${table.reversesId} IS NULL OR ${table.reason} IS NOT NULL`,
    ),
    check(
      "transactions_transfer_reference",
      sql`${table.paymentMethod} IS NOT 'transfer' OR ${table.bankReference} IS NOT NULL`,
    ),
  ],
);

/**
 * How a monthly fee payment was shared among the months it covers.
 *
 * The owner decided on 2026-11-06: the money fills the selected months oldest
 * first, so only the last one can be left partly paid, and a month keeps the
 * price it had when its first money arrived. Each row keeps that share and
 * that price, so neither depends on working the past out again after a fee
 * changes. Append-only, like `transactions`: a correction will be a reversal,
 * not an edit.
 */
export const paymentMonths = sqliteTable(
  "payment_months",
  {
    id: uuid("id").primaryKey(),
    transactionId: uuid("transaction_id")
      .notNull()
      .references(() => transactions.id),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id),
    /** The month this share pays for, as its first day. */
    month: date("month").notNull(),
    amountCentavos: bigint("amount_centavos").notNull(),
    /** The month's full price, fixed by the first payment that reached it. */
    priceCentavos: integer("price_centavos").notNull(),
    createdAt: createdAt(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
  },
  (table) => [
    index("payment_months_household_idx").on(table.householdId, table.month),
    index("payment_months_transaction_idx").on(table.transactionId),
    check("payment_months_first_day", sql`substr(${table.month}, 9, 2) = '01'`),
    check("payment_months_price", sql`${table.priceCentavos} >= 0`),
    check("payment_months_amount", sql`${table.amountCentavos} <> 0`),
  ],
);

/** Where each receipt photo sits in the private storage bucket. */
export const receiptFiles = sqliteTable("receipt_files", {
  id: uuid("id").primaryKey(),
  transactionId: uuid("transaction_id")
    .notNull()
    .references(() => transactions.id),
  storageKey: text("storage_key").notNull().unique(),
  contentType: text("content_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  createdAt: createdAt(),
  createdBy: uuid("created_by").references(() => users.id),
});

/**
 * Every document the app hands out (App Plan, Module 5: "every printout
 * carries … a document number"): its `id` is that number, given in order,
 * one counter for every kind. A row says what the document was and for
 * which filters, not its contents: those are worked out from the entries.
 * Append-only: a number, once given, is never changed or given again.
 */
export const documents = sqliteTable(
  "documents",
  {
    id: serial("id"),
    kind: text("kind", { enum: ["household_statement", "receipt", "month_statement", "census_list", "log_extract"] }).notNull(),
    householdId: uuid("household_id").references(() => households.id),
    /** What it was made for: a statement's first month, a month's statement's month and totals, the census list's filters, or the history log extract's year, and the day it was made. Only a household statement and a receipt have a household. */
    details: json<Record<string, unknown>>("details").notNull(),
    createdAt: createdAt(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
  },
  (table) => [index("documents_household_idx").on(table.householdId)],
);

/**
 * The opening balance (owner, 17 November 2026): the cash in the box and the
 * money in the bank on the first day of `month`, the month the app's money
 * begins. Entries dated before that month count only for what each house
 * owes, never in the money totals (src/lib/balance.ts).
 *
 * Append-only. A wrong figure is corrected by a new row that points to the
 * one it replaces and says why, until the first month is closed; the row
 * nothing replaces is the one in force. The unique index keeps them one
 * chain: a single first row, and each row replaced at most once.
 */
export const openingBalances = sqliteTable(
  "opening_balances",
  {
    id: uuid("id").primaryKey(),
    month: date("month").notNull(),
    cashCentavos: bigint("cash_centavos").notNull(),
    bankCentavos: bigint("bank_centavos").notNull(),
    replacesId: uuid("replaces_id").references((): AnySQLiteColumn => openingBalances.id),
    reason: text("reason"),
    createdAt: createdAt(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
  },
  (table) => [
    uniqueIndex("opening_balances_one_chain").on(sql`coalesce(${table.replacesId}, '')`),
    check("opening_balances_first_day", sql`substr(${table.month}, 9, 2) = '01'`),
    check("opening_balances_not_negative", sql`${table.cashCentavos} >= 0 AND ${table.bankCentavos} >= 0`),
    // A correction always says why; the first entry has nothing to correct.
    check("opening_balances_correction_reason", sql`(${table.replacesId} IS NULL) = (${table.reason} IS NULL)`),
  ],
);

// ---------------------------------------------------------------------------
// History log and configuration
// ---------------------------------------------------------------------------

/**
 * The history log (Module 4). Append-only, and each entry is chained to the
 * one before it: `hash` covers this entry's content and `prev_hash`, so
 * changing or removing any entry breaks the chain from that point on. See
 * src/lib/audit.ts for how entries are written and checked.
 *
 * Who acted is copied in (name and role at that moment) rather than only
 * pointed at, so the log still reads correctly after a rename or role change.
 */
export const auditLog = sqliteTable(
  "audit_log",
  {
    id: serial("id"),
    occurredAt: instant("occurred_at").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    actorGuestId: uuid("actor_guest_id").references(() => guestInvitations.id),
    actorName: text("actor_name").notNull(),
    actorRole: text("actor_role").notNull(),
    area: text("area", {
      enum: ["census", "finances", "users", "settings", "security", "exports"],
    }).notNull(),
    action: text("action").notNull(),
    /** The entry as a plain Spanish sentence, as the Historial shows it. */
    summary: text("summary").notNull(),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    before: json("before"),
    after: json("after"),
    reason: text("reason"),
    device: text("device"),
    prevHash: text("prev_hash").notNull(),
    hash: text("hash").notNull(),
  },
  (table) => [
    index("audit_log_occurred_idx").on(table.occurredAt),
    index("audit_log_entity_idx").on(table.entityType, table.entityId),
    index("audit_log_actor_idx").on(table.actorUserId),
  ],
);

/**
 * Configuration values, one row per version: a change inserts a new row with
 * the date it takes effect, so the value in force on any past day can always
 * be read back. The current value of a key is the newest row whose
 * `effective_from` is not in the future.
 */
export const settings = sqliteTable(
  "settings",
  {
    id: serial("id"),
    key: text("key").notNull(),
    value: json("value").notNull(),
    effectiveFrom: date("effective_from").notNull(),
    createdAt: createdAt(),
    createdBy: uuid("created_by").references(() => users.id),
  },
  (table) => [index("settings_key_idx").on(table.key, table.effectiveFrom)],
);
