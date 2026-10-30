/**
 * The seventeen tables of the App Plan's data model (docs/app-plan.md, "Data
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
    /** WhatsApp number, 8 digits. */
    phone: text("phone").notNull(),
    roleCode: text("role_code")
      .notNull()
      .references(() => roles.code),
    status: text("status", { enum: ["invited", "active", "suspended", "deactivated"] }).notNull(),
    /** scrypt hash of the 6-digit PIN; null until the invitation is accepted. */
    pinHash: text("pin_hash"),
    failedPinCount: integer("failed_pin_count").notNull().default(0),
    /** Set after 5 wrong PINs; an administrator clears it after a phone call. */
    lockedAt: instant("locked_at"),
    lastLoginAt: instant("last_login_at"),
    createdAt: createdAt(),
    createdBy: uuid("created_by"),
  },
  (table) => [
    uniqueIndex("users_phone_unique").on(table.phone),
    check("users_phone_digits", onlyDigits(table.phone, 8)),
  ],
);

/**
 * Invitation links, remembered phones and sign-in sessions.
 *
 * Only the SHA-256 of each token is stored, so a copy of a backup cannot be
 * used to sign in. A session points at the device it was opened on: removing
 * the device ends its sessions.
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
    /** For a session: the device that opened it. */
    deviceId: uuid("device_id"),
    /** For a device: a short description of the phone, from its browser. */
    label: text("label"),
    expiresAt: instant("expires_at").notNull(),
    /** For an invitation: when it was used. It works once. */
    usedAt: instant("used_at"),
    lastUsedAt: instant("last_used_at"),
    /** For a session: when the PIN was last typed again for a sensitive action. */
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
    check("people_phone_digits", sql`${table.phone} IS NULL OR ${onlyDigits(table.phone, 8)}`),
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

/** Base monthly fee, late fee (mora) and reconnection fee, each from a start date. */
export const feeRates = sqliteTable(
  "fee_rates",
  {
    id: serial("id"),
    kind: text("kind", { enum: ["base_monthly", "late_fee", "reconnection"] }).notNull(),
    amountCentavos: integer("amount_centavos").notNull(),
    startsOn: date("starts_on").notNull(),
    createdAt: createdAt(),
    createdBy: uuid("created_by").references(() => users.id),
  },
  (table) => [
    uniqueIndex("fee_rates_kind_start_unique").on(table.kind, table.startsOn),
    check("fee_rates_amount", sql`${table.amountCentavos} >= 0`),
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
    createdAt: createdAt(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
  },
  (table) => [
    index("transactions_month_idx").on(table.monthId),
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
