CREATE TYPE "public"."guardian_decision" AS ENUM('ALLOW', 'ASK_QUESTIONS', 'GUARDIAN_HOLD', 'PASSKEY_REQUIRED', 'BLOCK');--> statement-breakpoint
CREATE TYPE "public"."relationship" AS ENUM('friends_family', 'business');--> statement-breakpoint
CREATE TYPE "public"."tx_source" AS ENUM('voice', 'text', 'api', 'seed');--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"nickname" text NOT NULL,
	"full_name" text,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"paypal_email" text NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"country" text DEFAULT 'US' NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"relationship" "relationship" DEFAULT 'friends_family' NOT NULL,
	"sandbox_account" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guardian_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"transaction_id" uuid,
	"decision" "guardian_decision" NOT NULL,
	"risk_score" real,
	"scam_score" real,
	"voice_match" real,
	"spoof_score" real,
	"signals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"explanation" text,
	"resolution" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"paypal_invoice_id" text,
	"payer_view_url" text,
	"qr_data_url" text,
	"message" text,
	"language" text DEFAULT 'en' NOT NULL,
	"items" jsonb,
	"due_date" timestamp with time zone,
	"last_reminder_at" timestamp with time zone,
	"reminder_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_transaction_id_unique" UNIQUE("transaction_id"),
	CONSTRAINT "invoices_paypal_invoice_id_unique" UNIQUE("paypal_invoice_id")
);
--> statement-breakpoint
CREATE TABLE "split_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"split_id" uuid NOT NULL,
	"contact_id" uuid,
	"name" text,
	"email" text NOT NULL,
	"share" numeric(12, 2) NOT NULL,
	"transaction_id" uuid
);
--> statement-breakpoint
CREATE TABLE "trusted_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"relation" text NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"home_currency" text DEFAULT 'USD' NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"country" text DEFAULT 'US' NOT NULL,
	"timezone" text DEFAULT 'America/New_York' NOT NULL,
	"paypal_vault_id" text,
	"paypal_payer_email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "voice_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"embedding" real[] NOT NULL,
	"model" text NOT NULL,
	"samples" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_split_id_splits_id_fk";
--> statement-breakpoint
ALTER TABLE "splits" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "splits" ADD COLUMN "my_share" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "splits" ADD COLUMN "receipt" jsonb;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "contact_id" uuid;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "source" "tx_source" DEFAULT 'api' NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "home_amount" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "fx_rate" numeric(14, 6);--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "relationship" "relationship";--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "command" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "risk_score" real;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "decision" "guardian_decision";--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "paypal_order_id" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guardian_events" ADD CONSTRAINT "guardian_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guardian_events" ADD CONSTRAINT "guardian_events_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "split_members" ADD CONSTRAINT "split_members_split_id_splits_id_fk" FOREIGN KEY ("split_id") REFERENCES "public"."splits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "split_members" ADD CONSTRAINT "split_members_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "split_members" ADD CONSTRAINT "split_members_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trusted_contacts" ADD CONSTRAINT "trusted_contacts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_profiles" ADD CONSTRAINT "voice_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_user_nickname_uq" ON "contacts" USING btree ("user_id",lower("nickname"));--> statement-breakpoint
CREATE INDEX "contacts_user_email_idx" ON "contacts" USING btree ("user_id","paypal_email");--> statement-breakpoint
CREATE INDEX "guardian_user_created_idx" ON "guardian_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "split_members_split_idx" ON "split_members" USING btree ("split_id");--> statement-breakpoint
ALTER TABLE "splits" ADD CONSTRAINT "splits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_split_id_splits_id_fk" FOREIGN KEY ("split_id") REFERENCES "public"."splits"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tx_user_created_idx" ON "transactions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "tx_contact_idx" ON "transactions" USING btree ("contact_id");