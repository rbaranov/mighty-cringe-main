ALTER TABLE "trainer_athlete_links" ALTER COLUMN "access" SET DEFAULT 'manage';--> statement-breakpoint
-- Upgrade existing active links without changing their IDs or reviving revoked links.
UPDATE "trainer_athlete_links" SET "access" = 'manage' WHERE "active" = true AND "access" = 'read';
--> statement-breakpoint
ALTER TABLE "trainer_athlete_links" ADD CONSTRAINT "active_trainer_link_has_manage_access" CHECK (NOT "trainer_athlete_links"."active" OR "trainer_athlete_links"."access" = 'manage');
