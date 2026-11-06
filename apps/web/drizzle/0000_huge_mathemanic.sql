CREATE TYPE "public"."tx_status" AS ENUM('pending', 'sent', 'completed', 'failed', 'unclaimed', 'cancelled', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."tx_type" AS ENUM('pay', 'request', 'split');--> statement-breakpoint
CREATE TABLE "splits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"total" numeric(12, 2) NOT NULL,
	"currency" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "tx_type" NOT NULL,
	"status" "tx_status" DEFAULT 'pending' NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"currency" text NOT NULL,
	"counterparty_email" text NOT NULL,
	"counterparty_name" text,
	"note" text,
	"split_id" uuid,
	"paypal_batch_id" text,
	"paypal_item_id" text,
	"paypal_invoice_id" text,
	"paypal_invoice_url" text,
	"paypal_transaction_id" text,
	"fee" numeric(12, 2),
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" text PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"resource_id" text,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_split_id_splits_id_fk" FOREIGN KEY ("split_id") REFERENCES "public"."splits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tx_invoice_idx" ON "transactions" USING btree ("paypal_invoice_id");--> statement-breakpoint
CREATE INDEX "tx_batch_idx" ON "transactions" USING btree ("paypal_batch_id");--> statement-breakpoint
CREATE INDEX "tx_item_idx" ON "transactions" USING btree ("paypal_item_id");--> statement-breakpoint
CREATE INDEX "tx_split_idx" ON "transactions" USING btree ("split_id");