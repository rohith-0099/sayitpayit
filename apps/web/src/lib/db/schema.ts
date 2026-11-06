import { index, jsonb, numeric, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Phase 1: just enough to record PayPal activity and webhook updates.
// Phase 2 adds users, contacts, guardian events, etc.

export const txType = pgEnum("tx_type", ["pay", "request", "split"]);
export const txStatus = pgEnum("tx_status", [
  "pending", // created, waiting on PayPal
  "sent", // invoice sent / payout submitted
  "completed", // payout item succeeded / invoice paid
  "failed",
  "unclaimed", // payout to an email with no PayPal account yet
  "cancelled",
  "refunded",
]);

export const splits = pgTable("splits", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  total: numeric("total", { precision: 12, scale: 2 }).notNull(),
  currency: text("currency").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: txType("type").notNull(),
    status: txStatus("status").notNull().default("pending"),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    currency: text("currency").notNull(),
    counterpartyEmail: text("counterparty_email").notNull(),
    counterpartyName: text("counterparty_name"),
    note: text("note"),
    splitId: uuid("split_id").references(() => splits.id),
    paypalBatchId: text("paypal_batch_id"),
    paypalItemId: text("paypal_item_id"),
    paypalInvoiceId: text("paypal_invoice_id"),
    paypalInvoiceUrl: text("paypal_invoice_url"),
    paypalTransactionId: text("paypal_transaction_id"),
    fee: numeric("fee", { precision: 12, scale: 2 }),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("tx_invoice_idx").on(t.paypalInvoiceId),
    index("tx_batch_idx").on(t.paypalBatchId),
    index("tx_item_idx").on(t.paypalItemId),
    index("tx_split_idx").on(t.splitId),
  ],
);

/** Every verified webhook, keyed by PayPal event id so redeliveries are no-ops. */
export const webhookEvents = pgTable("webhook_events", {
  id: text("id").primaryKey(),
  eventType: text("event_type").notNull(),
  resourceId: text("resource_id"),
  payload: jsonb("payload").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Transaction = typeof transactions.$inferSelect;
