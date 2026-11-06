import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
const money = (name: string) => numeric(name, { precision: 12, scale: 2 });

// ---------- Enums ----------

export const txType = pgEnum("tx_type", ["pay", "request", "split"]);
export const txStatus = pgEnum("tx_status", [
  "pending", // created, waiting on PayPal (or on Guardian / confirmation)
  "sent", // invoice sent / payout submitted
  "completed", // payout item succeeded / invoice paid
  "failed",
  "unclaimed", // payout to an email with no PayPal account yet
  "cancelled",
  "refunded",
]);
/** Used for fee display/labeling in our app only; Payouts doesn't set this on PayPal's side. */
export const relationship = pgEnum("relationship", ["friends_family", "business"]);
export const guardianDecision = pgEnum("guardian_decision", [
  "ALLOW",
  "ASK_QUESTIONS",
  "GUARDIAN_HOLD",
  "PASSKEY_REQUIRED",
  "BLOCK",
]);
export const txSource = pgEnum("tx_source", ["voice", "text", "api", "seed"]);

// ---------- Users & people ----------

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  homeCurrency: text("home_currency").notNull().default("USD"),
  /** BCP-47, e.g. "en", "es", "ml". */
  language: text("language").notNull().default("en"),
  country: text("country").notNull().default("US"),
  timezone: text("timezone").notNull().default("America/New_York"),
  /** Vault v3 payment token for the linked PayPal wallet (Phase 3). */
  paypalVaultId: text("paypal_vault_id"),
  paypalPayerEmail: text("paypal_payer_email"),
  createdAt: createdAt(),
});

export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** What the user calls them by voice: "Maria", "Mom". */
    nickname: text("nickname").notNull(),
    fullName: text("full_name"),
    /** Other spoken forms / transliterations: ["Mariya", "Mari"]. */
    aliases: text("aliases").array().notNull().default(sql`'{}'::text[]`),
    paypalEmail: text("paypal_email").notNull(),
    currency: text("currency").notNull().default("USD"),
    country: text("country").notNull().default("US"),
    language: text("language").notNull().default("en"),
    relationship: relationship("relationship").notNull().default("friends_family"),
    /** A real PayPal sandbox account (money can actually land). Seed-only contacts are false. */
    sandboxAccount: boolean("sandbox_account").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("contacts_user_nickname_uq").on(t.userId, sql`lower(${t.nickname})`),
    index("contacts_user_email_idx").on(t.userId, t.paypalEmail),
  ],
);

/** Family members who approve held payments (Guardian mode). */
export const trustedContacts = pgTable("trusted_contacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  /** "daughter", "son", "spouse"... */
  relation: text("relation").notNull(),
  language: text("language").notNull().default("en"),
  createdAt: createdAt(),
});

/** Speaker embedding (ECAPA-TDNN) for the voice gate. One per user. */
export const voiceProfiles = pgTable("voice_profiles", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  embedding: real("embedding").array().notNull(),
  model: text("model").notNull(),
  samples: integer("samples").notNull(),
  enrolledAt: createdAt(),
});

// ---------- Money ----------

export const splits = pgTable("splits", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  total: money("total").notNull(),
  currency: text("currency").notNull(),
  /** The user's own share (not invoiced). */
  myShare: money("my_share"),
  /** Set when created from a receipt photo (Phase 4). */
  receipt: jsonb("receipt"),
  createdAt: createdAt(),
});

export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Nullable only so pre-Phase-2 rows survived the migration; the seed backfills them
    // and every code path sets it.
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    type: txType("type").notNull(),
    status: txStatus("status").notNull().default("pending"),
    source: txSource("source").notNull().default("api"),
    amount: money("amount").notNull(),
    currency: text("currency").notNull(),
    /** Amount in the user's home currency at the time (for totals/charts). */
    homeAmount: money("home_amount"),
    fxRate: numeric("fx_rate", { precision: 14, scale: 6 }),
    relationship: relationship("relationship"),
    counterpartyEmail: text("counterparty_email").notNull(),
    counterpartyName: text("counterparty_name"),
    note: text("note"),
    /** The raw spoken/typed command, kept for the scam classifier and audit. */
    command: text("command"),
    splitId: uuid("split_id").references(() => splits.id, { onDelete: "set null" }),
    // Guardian
    riskScore: real("risk_score"),
    decision: guardianDecision("decision"),
    // PayPal references
    paypalBatchId: text("paypal_batch_id"),
    paypalItemId: text("paypal_item_id"),
    paypalInvoiceId: text("paypal_invoice_id"),
    paypalInvoiceUrl: text("paypal_invoice_url"),
    paypalTransactionId: text("paypal_transaction_id"),
    paypalOrderId: text("paypal_order_id"),
    fee: money("fee"),
    error: text("error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("tx_user_created_idx").on(t.userId, t.createdAt),
    index("tx_contact_idx").on(t.contactId),
    index("tx_invoice_idx").on(t.paypalInvoiceId),
    index("tx_batch_idx").on(t.paypalBatchId),
    index("tx_item_idx").on(t.paypalItemId),
    index("tx_split_idx").on(t.splitId),
  ],
);

/** Presentation data for our smart invoice page (/i/[id]); money state lives on the transaction. */
export const invoices = pgTable("invoices", {
  id: uuid("id").primaryKey().defaultRandom(),
  transactionId: uuid("transaction_id")
    .notNull()
    .unique()
    .references(() => transactions.id, { onDelete: "cascade" }),
  paypalInvoiceId: text("paypal_invoice_id").unique(),
  payerViewUrl: text("payer_view_url"),
  /** data:image/png;base64,... from PayPal's generate-qr-code */
  qrDataUrl: text("qr_data_url"),
  /** AI-written friendly message in the payer's language (Phase 4/8). */
  message: text("message"),
  language: text("language").notNull().default("en"),
  items: jsonb("items").$type<{ name: string; amount: number; quantity?: number }[]>(),
  dueDate: timestamp("due_date", { withTimezone: true }),
  lastReminderAt: timestamp("last_reminder_at", { withTimezone: true }),
  reminderCount: integer("reminder_count").notNull().default(0),
  createdAt: createdAt(),
});

/** Who owes what in a split. Each member has one request transaction (and PayPal invoice). */
export const splitMembers = pgTable(
  "split_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    splitId: uuid("split_id")
      .notNull()
      .references(() => splits.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    name: text("name"),
    email: text("email").notNull(),
    share: money("share").notNull(),
    transactionId: uuid("transaction_id").references(() => transactions.id, { onDelete: "set null" }),
  },
  (t) => [index("split_members_split_idx").on(t.splitId)],
);

// ---------- Guardian ----------

/** Every Guardian decision, with the signals behind it (powers the risk panel + dashboard). */
export const guardianEvents = pgTable(
  "guardian_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    transactionId: uuid("transaction_id").references(() => transactions.id, { onDelete: "set null" }),
    decision: guardianDecision("decision").notNull(),
    riskScore: real("risk_score"),
    scamScore: real("scam_score"),
    voiceMatch: real("voice_match"),
    spoofScore: real("spoof_score"),
    /** e.g. [{ id: "gift_cards", label: "Mentions gift cards", weight: 0.4 }] */
    signals: jsonb("signals").$type<{ id: string; label: string; weight?: number }[]>().notNull().default([]),
    explanation: text("explanation"),
    /** Q&A from a Scam Interrupt, or the trusted contact's approval outcome. */
    resolution: jsonb("resolution"),
    createdAt: createdAt(),
  },
  (t) => [index("guardian_user_created_idx").on(t.userId, t.createdAt)],
);

// ---------- Webhooks ----------

/** Every verified webhook, keyed by PayPal event id so redeliveries are no-ops. */
export const webhookEvents = pgTable("webhook_events", {
  id: text("id").primaryKey(),
  eventType: text("event_type").notNull(),
  resourceId: text("resource_id"),
  payload: jsonb("payload").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type Contact = typeof contacts.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type GuardianEvent = typeof guardianEvents.$inferSelect;
