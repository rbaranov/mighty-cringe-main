CREATE TABLE "trainer_invites" (
	"id" uuid PRIMARY KEY NOT NULL,
	"trainer_id" uuid NOT NULL,
	"email" varchar(320),
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_by_user_id" uuid,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trainer_invites_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "trainer_athlete_links" ADD COLUMN "revoked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "trainer_athlete_links" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "trainer_invites" ADD CONSTRAINT "trainer_invites_trainer_id_users_id_fk" FOREIGN KEY ("trainer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trainer_invites" ADD CONSTRAINT "trainer_invites_accepted_by_user_id_users_id_fk" FOREIGN KEY ("accepted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trainer_invite_trainer_idx" ON "trainer_invites" USING btree ("trainer_id","created_at");--> statement-breakpoint
CREATE INDEX "trainer_invite_expiry_idx" ON "trainer_invites" USING btree ("expires_at");