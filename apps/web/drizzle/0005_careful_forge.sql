CREATE TABLE "guardian_holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"thread_id" text NOT NULL,
	"token" text NOT NULL,
	"trusted_contact_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"summary" jsonb NOT NULL,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guardian_holds_thread_id_unique" UNIQUE("thread_id"),
	CONSTRAINT "guardian_holds_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "guardian_holds" ADD CONSTRAINT "guardian_holds_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guardian_holds" ADD CONSTRAINT "guardian_holds_trusted_contact_id_trusted_contacts_id_fk" FOREIGN KEY ("trusted_contact_id") REFERENCES "public"."trusted_contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "guardian_holds_user_idx" ON "guardian_holds" USING btree ("user_id","created_at");