CREATE TYPE "public"."notification_frequency" AS ENUM('daily', 'weekdays', 'weekly');--> statement-breakpoint
CREATE TYPE "public"."notification_job_status" AS ENUM('pending', 'processing', 'sent', 'failed');--> statement-breakpoint
CREATE TABLE "notification_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" varchar(64) DEFAULT 'workout_reminder' NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"status" "notification_job_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"claimed_at" timestamp with time zone,
	"last_error" text,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"frequency" "notification_frequency" DEFAULT 'daily' NOT NULL,
	"weekday" integer DEFAULT 1 NOT NULL,
	"reminder_time" varchar(5) DEFAULT '19:00' NOT NULL,
	"quiet_start" varchar(5) DEFAULT '22:00' NOT NULL,
	"quiet_end" varchar(5) DEFAULT '08:00' NOT NULL,
	"time_zone" varchar(100) DEFAULT 'UTC' NOT NULL,
	"next_reminder_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"expiration_time" timestamp with time zone,
	"p256dh" varchar(512) NOT NULL,
	"auth" varchar(256) NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
ALTER TABLE "notification_jobs" ADD CONSTRAINT "notification_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_job_schedule_idx" ON "notification_jobs" USING btree ("user_id","kind","scheduled_for");--> statement-breakpoint
CREATE INDEX "notification_job_pending_idx" ON "notification_jobs" USING btree ("status","next_attempt_at","scheduled_for");--> statement-breakpoint
CREATE INDEX "notification_preferences_due_idx" ON "notification_preferences" USING btree ("enabled","next_reminder_at");--> statement-breakpoint
CREATE INDEX "push_subscription_user_idx" ON "push_subscriptions" USING btree ("user_id","disabled_at");