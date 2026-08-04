CREATE TYPE "public"."exercise_preference_value" AS ENUM('like', 'dislike');--> statement-breakpoint
CREATE TABLE "exercise_preferences" (
	"user_id" uuid NOT NULL,
	"exercise_id" uuid NOT NULL,
	"value" "exercise_preference_value",
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exercise_preferences_user_id_exercise_id_pk" PRIMARY KEY("user_id","exercise_id")
);
--> statement-breakpoint
ALTER TABLE "exercise_preferences" ADD CONSTRAINT "exercise_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_preferences" ADD CONSTRAINT "exercise_preferences_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE cascade ON UPDATE no action;