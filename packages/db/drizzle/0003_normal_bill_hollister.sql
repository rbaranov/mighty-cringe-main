ALTER TABLE "sets" ADD COLUMN "position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
WITH "ordered_sets" AS (
	SELECT "id", ROW_NUMBER() OVER (
		PARTITION BY "workout_id", "exercise_id"
		ORDER BY "performed_at", "id"
	) - 1 AS "next_position"
	FROM "sets"
)
UPDATE "sets"
SET "position" = "ordered_sets"."next_position"
FROM "ordered_sets"
WHERE "sets"."id" = "ordered_sets"."id";
