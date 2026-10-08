CREATE TYPE "public"."trainer_access" AS ENUM('read', 'manage');--> statement-breakpoint
CREATE TABLE "trainer_audit_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_id" uuid NOT NULL,
	"athlete_id" uuid NOT NULL,
	"link_id" uuid NOT NULL,
	"operation" text NOT NULL,
	"details" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trainer_athlete_links" ADD COLUMN "access" "trainer_access" DEFAULT 'read' NOT NULL;--> statement-breakpoint
ALTER TABLE "trainer_athlete_links" ADD COLUMN "access_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "trainer_audit_events" ADD CONSTRAINT "trainer_audit_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trainer_audit_events" ADD CONSTRAINT "trainer_audit_events_athlete_id_users_id_fk" FOREIGN KEY ("athlete_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trainer_audit_athlete_created_idx" ON "trainer_audit_events" USING btree ("athlete_id","created_at");