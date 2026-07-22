ALTER TABLE "sets" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "workouts" ADD COLUMN "locale" varchar(10) DEFAULT 'ru' NOT NULL;--> statement-breakpoint
ALTER TABLE "workouts" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;