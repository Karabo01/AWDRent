CREATE TYPE "public"."inbound_email_status" AS ENUM('new', 'converted', 'dismissed');--> statement-breakpoint
CREATE TABLE "inbound_emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid DEFAULT app_current_agency() NOT NULL,
	"message_id" text NOT NULL,
	"from_address" text NOT NULL,
	"from_name" text,
	"subject" text NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"excerpt" text NOT NULL,
	"status" "inbound_email_status" DEFAULT 'new' NOT NULL,
	"suggested_lease_id" uuid,
	"suggested_tenant_id" uuid,
	"match_reason" text,
	"suggested_cents" integer,
	"pop_id" uuid,
	"note" text,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbound_emails_resolved" CHECK (("inbound_emails"."status" = 'new') = ("inbound_emails"."resolved_at" is null)),
	CONSTRAINT "inbound_emails_dismissed_note" CHECK ("inbound_emails"."status" <> 'dismissed' or "inbound_emails"."note" is not null)
);
--> statement-breakpoint
ALTER TABLE "documents" DROP CONSTRAINT "documents_exactly_one_subject";--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "inbound_email_id" uuid;--> statement-breakpoint
ALTER TABLE "inbound_emails" ADD CONSTRAINT "inbound_emails_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_emails" ADD CONSTRAINT "inbound_emails_lease_fk" FOREIGN KEY ("agency_id","suggested_lease_id") REFERENCES "public"."leases"("agency_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_emails" ADD CONSTRAINT "inbound_emails_tenant_fk" FOREIGN KEY ("agency_id","suggested_tenant_id") REFERENCES "public"."tenants"("agency_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inbound_emails_agency_id_id_key" ON "inbound_emails" USING btree ("agency_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "inbound_emails_agency_message_key" ON "inbound_emails" USING btree ("agency_id","message_id");--> statement-breakpoint
CREATE INDEX "inbound_emails_agency_status_idx" ON "inbound_emails" USING btree ("agency_id","status","received_at");--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_inbound_email_fk" FOREIGN KEY ("agency_id","inbound_email_id") REFERENCES "public"."inbound_emails"("agency_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "documents_agency_inbound_email_idx" ON "documents" USING btree ("agency_id","inbound_email_id");--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_exactly_one_subject" CHECK (num_nonnulls("documents"."owner_id", "documents"."property_id", "documents"."unit_id", "documents"."tenant_id", "documents"."lease_id", "documents"."inbound_email_id") = 1);