ALTER TYPE "public"."voice_status" ADD VALUE 'processing' BEFORE 'confirmed';--> statement-breakpoint
ALTER TABLE "voice_entries" ADD COLUMN "mime_type" varchar(255);--> statement-breakpoint
ALTER TABLE "voice_entries" ADD COLUMN "audio_format" varchar(16);--> statement-breakpoint
ALTER TABLE "voice_entries" ADD COLUMN "size_bytes" integer;--> statement-breakpoint
ALTER TABLE "voice_entries" ADD COLUMN "consent_version" varchar(32);--> statement-breakpoint
ALTER TABLE "voice_entries" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "voice_entries" ADD COLUMN "next_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "voice_entries" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "voice_entries" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
UPDATE "voice_entries"
SET
	"mime_type" = 'application/octet-stream',
	"audio_format" = 'webm',
	"size_bytes" = 0,
	"consent_version" = 'legacy-unknown',
	"status" = 'failed',
	"last_error" = 'Legacy entry predates explicit voice consent; delete it and record again';--> statement-breakpoint
ALTER TABLE "voice_entries" ALTER COLUMN "mime_type" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "voice_entries" ALTER COLUMN "audio_format" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "voice_entries" ALTER COLUMN "size_bytes" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "voice_entries" ALTER COLUMN "consent_version" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "voice_pending_retry_idx" ON "voice_entries" USING btree ("status","next_attempt_at");
