CREATE TABLE "voice_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"thread_id" text,
	"transcript" text NOT NULL,
	"status" text NOT NULL,
	"speaker_score" real,
	"speaker_match" boolean,
	"spoof_score" real,
	"spoof_suspect" boolean,
	"phrase_expected" text,
	"phrase_match" boolean,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "voice_checks" ADD CONSTRAINT "voice_checks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "voice_checks_user_idx" ON "voice_checks" USING btree ("user_id","created_at");