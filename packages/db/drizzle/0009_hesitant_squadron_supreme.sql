CREATE TYPE "public"."unit_system" AS ENUM('metric', 'imperial');--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "unit_system" "unit_system" DEFAULT 'metric' NOT NULL;