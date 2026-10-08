CREATE TABLE "scheduled_notices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid DEFAULT app_current_agency() NOT NULL,
	"lease_id" uuid NOT NULL,
	"notice_key" text NOT NULL,
	"sent_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "leases" ADD COLUMN "reminders_paused_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "leases" ADD COLUMN "reminders_paused_until" date;--> statement-breakpoint
ALTER TABLE "leases" ADD COLUMN "reminders_pause_reason" text;--> statement-breakpoint
ALTER TABLE "leases" ADD COLUMN "reminders_paused_by" uuid;--> statement-breakpoint
ALTER TABLE "scheduled_notices" ADD CONSTRAINT "scheduled_notices_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_notices" ADD CONSTRAINT "scheduled_notices_lease_fk" FOREIGN KEY ("agency_id","lease_id") REFERENCES "public"."leases"("agency_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "scheduled_notices_agency_lease_key" ON "scheduled_notices" USING btree ("agency_id","lease_id","notice_key");