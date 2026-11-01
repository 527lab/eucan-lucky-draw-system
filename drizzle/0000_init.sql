CREATE TYPE "public"."conversation_state" AS ENUM('awaiting_photo');--> statement-breakpoint
CREATE TYPE "public"."draw_result_status" AS ENUM('won', 'void', 'unfilled');--> statement-breakpoint
CREATE TYPE "public"."draw_run_status" AS ENUM('locked', 'drawn', 'announced', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."outbound_kind" AS ENUM('winner', 'reject_notice', 'announce', 'other');--> statement-breakpoint
CREATE TYPE "public"."outbound_method" AS ENUM('push', 'multicast');--> statement-breakpoint
CREATE TYPE "public"."outbound_status" AS ENUM('pending', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."participant_status" AS ENUM('pending_registration', 'active', 'blocked', 'unfollowed');--> statement-breakpoint
CREATE TYPE "public"."submission_status" AS ENUM('pending_spot', 'pending_review', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."webhook_status" AS ENUM('received', 'processed', 'failed');--> statement-breakpoint
CREATE TABLE "admin_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_states" (
	"participant_id" uuid PRIMARY KEY NOT NULL,
	"state" "conversation_state" NOT NULL,
	"spot_id" uuid,
	"image_set_id" text,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "draw_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"draw_run_id" uuid NOT NULL,
	"prize_id" uuid NOT NULL,
	"slot" integer NOT NULL,
	"participant_id" uuid,
	"status" "draw_result_status" NOT NULL,
	"random_value" bigint,
	"replaces_result_id" uuid,
	"revealed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "draw_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" "draw_run_status" NOT NULL,
	"settings_snapshot" jsonb,
	"pool_snapshot" jsonb,
	"triggered_by" text,
	"locked_at" timestamp with time zone,
	"drawn_at" timestamp with time zone,
	"announced_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "employee_allowlist" (
	"employee_no" text PRIMARY KEY NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbound_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"participant_id" uuid,
	"kind" "outbound_kind" NOT NULL,
	"method" "outbound_method" NOT NULL,
	"retry_key" uuid NOT NULL,
	"status" "outbound_status" DEFAULT 'pending' NOT NULL,
	"line_request_id" text,
	"error" text,
	"related_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "outbound_messages_retry_key_unique" UNIQUE("retry_key")
);
--> statement-breakpoint
CREATE TABLE "participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"line_user_id" text NOT NULL,
	"employee_no" text,
	"employee_verified_at" timestamp with time zone,
	"display_name" text,
	"picture_url" text,
	"status" "participant_status" DEFAULT 'pending_registration' NOT NULL,
	"registered_at" timestamp with time zone,
	"followed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "participants_line_user_id_unique" UNIQUE("line_user_id"),
	CONSTRAINT "participants_employee_no_unique" UNIQUE("employee_no")
);
--> statement-breakpoint
CREATE TABLE "prizes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"image_url" text,
	"quantity" integer NOT NULL,
	"draw_order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prizes_quantity_positive" CHECK ("prizes"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"hint_image_url" text,
	"latitude" numeric,
	"longitude" numeric,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"counts_for_ticket" boolean DEFAULT true NOT NULL,
	"available_from" timestamp with time zone,
	"available_until" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"participant_id" uuid NOT NULL,
	"spot_id" uuid,
	"line_message_id" text NOT NULL,
	"image_set_id" text,
	"storage_key" text NOT NULL,
	"content_type" text,
	"size_bytes" integer,
	"status" "submission_status" NOT NULL,
	"reject_reason" text,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "submissions_line_message_id_unique" UNIQUE("line_message_id")
);
--> statement-breakpoint
CREATE TABLE "ticket_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"participant_id" uuid NOT NULL,
	"delta" integer NOT NULL,
	"reason" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"webhook_event_id" text PRIMARY KEY NOT NULL,
	"type" text,
	"line_user_id" text,
	"is_redelivery" boolean DEFAULT false NOT NULL,
	"status" "webhook_status" DEFAULT 'received' NOT NULL,
	"error" text,
	"payload" jsonb,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "conversation_states" ADD CONSTRAINT "conversation_states_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_states" ADD CONSTRAINT "conversation_states_spot_id_spots_id_fk" FOREIGN KEY ("spot_id") REFERENCES "public"."spots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draw_results" ADD CONSTRAINT "draw_results_draw_run_id_draw_runs_id_fk" FOREIGN KEY ("draw_run_id") REFERENCES "public"."draw_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draw_results" ADD CONSTRAINT "draw_results_prize_id_prizes_id_fk" FOREIGN KEY ("prize_id") REFERENCES "public"."prizes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draw_results" ADD CONSTRAINT "draw_results_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draw_results" ADD CONSTRAINT "draw_results_replaces_result_id_draw_results_id_fk" FOREIGN KEY ("replaces_result_id") REFERENCES "public"."draw_results"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_spot_id_spots_id_fk" FOREIGN KEY ("spot_id") REFERENCES "public"."spots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_adjustments" ADD CONSTRAINT "ticket_adjustments_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "draw_runs_single_active_idx" ON "draw_runs" USING btree ((true)) WHERE "draw_runs"."status" <> 'cancelled';--> statement-breakpoint
CREATE INDEX "submissions_participant_spot_status_idx" ON "submissions" USING btree ("participant_id","spot_id","status");