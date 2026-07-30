CREATE TYPE "public"."workout_completion_reason" AS ENUM('manual', 'automatic');--> statement-breakpoint
ALTER TABLE "workouts" ADD COLUMN "duration_seconds" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "workouts" ADD COLUMN "active_segment_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workouts" ADD COLUMN "last_activity_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workouts" ADD COLUMN "completion_reason" "workout_completion_reason";--> statement-breakpoint
UPDATE "workouts" AS "workout"
SET
  "duration_seconds" = CASE
    WHEN "workout"."ended_at" IS NULL THEN 0
    ELSE GREATEST(
      0,
      FLOOR(EXTRACT(EPOCH FROM ("workout"."ended_at" - "workout"."started_at")))::integer
    )
  END,
  "active_segment_started_at" = CASE
    WHEN "workout"."ended_at" IS NULL THEN "workout"."started_at"
    ELSE NULL
  END,
  "last_activity_at" = GREATEST(
    "workout"."started_at",
    "workout"."updated_at",
    COALESCE("workout"."ended_at", "workout"."started_at"),
    COALESCE(
      (
        SELECT MAX(GREATEST("set"."performed_at", "set"."updated_at"))
        FROM "sets" AS "set"
        WHERE "set"."workout_id" = "workout"."id"
      ),
      "workout"."started_at"
    )
  );--> statement-breakpoint
ALTER TABLE "workouts" ALTER COLUMN "last_activity_at" SET NOT NULL;
