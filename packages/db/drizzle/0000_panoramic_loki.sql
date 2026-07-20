CREATE TYPE "public"."exercise_scope" AS ENUM('global', 'user');--> statement-breakpoint
CREATE TYPE "public"."exercise_tag" AS ENUM('mighty', 'normal', 'cringe');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('athlete', 'trainer', 'superadmin');--> statement-breakpoint
CREATE TYPE "public"."voice_status" AS ENUM('pending', 'confirmed', 'failed');--> statement-breakpoint
CREATE TABLE "client_mutations" (
	"id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_mutations_id_user_id_pk" PRIMARY KEY("id","user_id")
);
--> statement-breakpoint
CREATE TABLE "exercises" (
	"id" uuid PRIMARY KEY NOT NULL,
	"scope" "exercise_scope" DEFAULT 'global' NOT NULL,
	"owner_id" uuid,
	"name_ru" varchar(255) NOT NULL,
	"name_en" varchar(255) NOT NULL,
	"aliases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tag" "exercise_tag" DEFAULT 'normal' NOT NULL,
	"primary_muscles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"secondary_muscles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"equipment" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"videos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "measurement_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"measured_on" timestamp with time zone NOT NULL,
	"is_self_measured" boolean DEFAULT false NOT NULL,
	"values" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workout_id" uuid NOT NULL,
	"exercise_id" uuid NOT NULL,
	"weight_kg" numeric(6, 2) NOT NULL,
	"reps" integer NOT NULL,
	"rir" integer,
	"comment" text,
	"performed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trainer_athlete_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"trainer_id" uuid NOT NULL,
	"athlete_id" uuid NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"google_subject" varchar(255),
	"email" varchar(320) NOT NULL,
	"display_name" varchar(255) NOT NULL,
	"avatar_url" text,
	"role" "role" DEFAULT 'athlete' NOT NULL,
	"locale" varchar(10) DEFAULT 'ru' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_google_subject_unique" UNIQUE("google_subject"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "voice_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workout_id" uuid,
	"user_id" uuid NOT NULL,
	"object_key" varchar(1024) NOT NULL,
	"transcript" text,
	"parsed_result" jsonb,
	"status" "voice_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workout_exercises" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workout_id" uuid NOT NULL,
	"exercise_id" uuid NOT NULL,
	"superset_group" integer,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workouts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"notes" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "client_mutations" ADD CONSTRAINT "client_mutations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercises" ADD CONSTRAINT "exercises_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurement_entries" ADD CONSTRAINT "measurement_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sets" ADD CONSTRAINT "sets_workout_id_workouts_id_fk" FOREIGN KEY ("workout_id") REFERENCES "public"."workouts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sets" ADD CONSTRAINT "sets_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trainer_athlete_links" ADD CONSTRAINT "trainer_athlete_links_trainer_id_users_id_fk" FOREIGN KEY ("trainer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trainer_athlete_links" ADD CONSTRAINT "trainer_athlete_links_athlete_id_users_id_fk" FOREIGN KEY ("athlete_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_entries" ADD CONSTRAINT "voice_entries_workout_id_workouts_id_fk" FOREIGN KEY ("workout_id") REFERENCES "public"."workouts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_entries" ADD CONSTRAINT "voice_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_exercises" ADD CONSTRAINT "workout_exercises_workout_id_workouts_id_fk" FOREIGN KEY ("workout_id") REFERENCES "public"."workouts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_exercises" ADD CONSTRAINT "workout_exercises_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workouts" ADD CONSTRAINT "workouts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "exercise_scope_owner_idx" ON "exercises" USING btree ("scope","owner_id");--> statement-breakpoint
CREATE INDEX "measurement_user_date_idx" ON "measurement_entries" USING btree ("user_id","measured_on");--> statement-breakpoint
CREATE INDEX "set_workout_exercise_idx" ON "sets" USING btree ("workout_id","exercise_id");--> statement-breakpoint
CREATE UNIQUE INDEX "one_active_trainer_per_athlete" ON "trainer_athlete_links" USING btree ("athlete_id") WHERE "trainer_athlete_links"."active" = true;--> statement-breakpoint
CREATE INDEX "trainer_athlete_trainer_idx" ON "trainer_athlete_links" USING btree ("trainer_id");--> statement-breakpoint
CREATE INDEX "voice_user_created_idx" ON "voice_entries" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "workout_exercise_position_idx" ON "workout_exercises" USING btree ("workout_id","position");--> statement-breakpoint
CREATE INDEX "workout_exercise_workout_idx" ON "workout_exercises" USING btree ("workout_id");--> statement-breakpoint
CREATE INDEX "workout_user_started_idx" ON "workouts" USING btree ("user_id","started_at");