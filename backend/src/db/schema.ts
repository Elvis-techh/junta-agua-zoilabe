/**
 * The nineteen tables of the App Plan's data model (docs/app-plan.md, "Data
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
    /** Honduran identity number, 13 digits. */
    idNumber: text("id_number").notNull(),
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
    check("people_id_number_digits", onlyDigits(table.idNumber, 13)),
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
    references: text("references").notNull(),
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
    monthlyAmountCentavos: integer("monthly_amount_centavos").notNull(),
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
 * Base monthly fee, late fee (mora) and reconnection fee, each from a start date.
 *
 * An amount the board did not mean, or no longer wants, is removed ("Quitar")
 * until a payment covers its month: the row stays, with when, who and why,
 * and no longer counts. Its month is then free for another amount.
 */
export const feeRates = sqliteTable(
  "fee_rates",
  {
    id: serial("id"),
    kind: text("kind", { enum: ["base_monthly", "late_fee", "reconnection"] }).notNull(),
    amountCentavos: integer("amount_centavos").notNull(),
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

/** One row per calendar month; `month` is its first day. */
export const months = sqliteTable(
  "months",
  {
    id: serial("id"),
    month: date("month").notNull(),
    status: text("status", { enum: ["open", "prepared", "closed"] }).notNull(),
    cashCountedCentavos: bigint("cash_counted_centavos"),
    preparedBy: uuid("prepared_by").references(() => users.id),
    preparedAt: instant("prepared_at"),
    approvedBy: uuid("approved_by").references(() => users.id),
    approvedAt: instant("approved_at"),
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
    /** The number printed on the paper receipt handed to the payer. */
    paperReceiptNumber: text("paper_receipt_number"),
    payerName: text("payer_name"),
    supplier: text("supplier"),
    note: text("note"),
    reversesId: uuid("reverses_id"),
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

/**
 * "Deuda anterior": a month a house already owed when the app took over,
 * copied from the paper receipt book.
 *
 * The board decided on 7 November 2026 that the app takes over at one start
 * month (the `start_month` setting), and that before it a house owes only the
 * months the treasurer enters here. Each costs the fee in Configuración for
 * that month, or the house's different amount (12 November: even for months
 * before that amount was entered); a late fee only where the paper book shows
 * one, at the late fee in Configuración for that month. Both prices are
 * fixed when the month is entered, so nothing changes what it already counts.
 *
 * A month entered by mistake is removed ("Quitar") with a written reason,
 * until a payment covers it (13 November): the row stays, with when, who and
 * why, and no longer counts. The month is then free to be entered again.
 */
export const owedMonths = sqliteTable(
  "owed_months",
  {
    id: uuid("id").primaryKey(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id),
    /** The month owed, as its first day; always before the start month. */
    month: date("month").notNull(),
    /** What the month costs: the fee in Configuración for it, or the house's different amount. */
    priceCentavos: integer("price_centavos").notNull(),
    /** The late fee for it, when the paper book shows one; null when it does not. */
    lateFeeCentavos: integer("late_fee_centavos"),
    createdAt: createdAt(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    removedAt: instant("removed_at"),
    removedBy: uuid("removed_by").references(() => users.id),
    removedReason: text("removed_reason"),
  },
  (table) => [
    uniqueIndex("owed_months_household_month_unique")
      .on(table.householdId, table.month)
      .where(sql`${table.removedAt} IS NULL`),
    check("owed_months_first_day", sql`substr(${table.month}, 9, 2) = '01'`),
    check("owed_months_price", sql`${table.priceCentavos} > 0`),
    check("owed_months_late_fee", sql`${table.lateFeeCentavos} IS NULL OR ${table.lateFeeCentavos} >= 0`),
    // A removed month always says why.
    check("owed_months_removed_reason", sql`(${table.removedAt} IS NULL) = (${table.removedReason} IS NULL)`),
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
 *
 * The start month (`start_month`) is the exception: the owner decided on
 * 13 November 2026 that once saved it cannot be changed, so the database
 * refuses a second row for it.
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
  (table) => [
    index("settings_key_idx").on(table.key, table.effectiveFrom),
    uniqueIndex("settings_start_month_once").on(table.key).where(sql`${table.key} = 'start_month'`),
  ],
);
