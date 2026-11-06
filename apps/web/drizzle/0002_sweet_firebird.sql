ALTER TABLE "transactions" ADD COLUMN "paypal_capture_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "paypal_customer_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "paypal_linked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "paypal_pending_setup_token" text;