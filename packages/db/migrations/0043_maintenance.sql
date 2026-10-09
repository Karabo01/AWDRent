CREATE TYPE "public"."maintenance_priority" AS ENUM('low', 'normal', 'urgent', 'emergency');--> statement-breakpoint
CREATE TYPE "public"."maintenance_status" AS ENUM('open', 'assigned', 'in_progress', 'completed', 'cancelled');--> statement-breakpoint
ALTER TYPE "public"."document_kind" ADD VALUE 'maintenance_photo' BEFORE 'other';--> statement-breakpoint
CREATE TABLE "contractors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid DEFAULT app_current_agency() NOT NULL,
	"name" text NOT NULL,
	"trade" text,
	"email" text,
	"phone" text,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT app_current_user()
);
--> statement-breakpoint
CREATE TABLE "maintenance_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid DEFAULT app_current_agency() NOT NULL,
	"unit_id" uuid NOT NULL,
	"lease_id" uuid,
	"tenant_id" uuid,
	"reported_via" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"priority" "maintenance_priority" DEFAULT 'normal' NOT NULL,
	"status" "maintenance_status" DEFAULT 'open' NOT NULL,
	"contractor_id" uuid,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT app_current_user()
);
--> statement-breakpoint
CREATE TABLE "maintenance_updates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid DEFAULT app_current_agency() NOT NULL,
	"request_id" uuid NOT NULL,
	"status" "maintenance_status",
	"note" text,
	"visible_to_tenant" boolean DEFAULT true NOT NULL,
	"portal_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT app_current_user()
);
--> statement-breakpoint
ALTER TABLE "documents" DROP CONSTRAINT "documents_exactly_one_subject";--> statement-breakpoint
ALTER TABLE "messages" DROP CONSTRAINT "messages_recipient_kind";--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "maintenance_request_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "contractors_agency_id_id_key" ON "contractors" USING btree ("agency_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "maintenance_requests_agency_id_id_key" ON "maintenance_requests" USING btree ("agency_id","id");--> statement-breakpoint
ALTER TABLE "contractors" ADD CONSTRAINT "contractors_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_unit_fk" FOREIGN KEY ("agency_id","unit_id") REFERENCES "public"."units"("agency_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_lease_fk" FOREIGN KEY ("agency_id","lease_id") REFERENCES "public"."leases"("agency_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_tenant_fk" FOREIGN KEY ("agency_id","tenant_id") REFERENCES "public"."tenants"("agency_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_contractor_fk" FOREIGN KEY ("agency_id","contractor_id") REFERENCES "public"."contractors"("agency_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_updates" ADD CONSTRAINT "maintenance_updates_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_updates" ADD CONSTRAINT "maintenance_updates_request_fk" FOREIGN KEY ("agency_id","request_id") REFERENCES "public"."maintenance_requests"("agency_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contractors_agency_name_idx" ON "contractors" USING btree ("agency_id","name");--> statement-breakpoint
CREATE INDEX "maintenance_requests_agency_status_idx" ON "maintenance_requests" USING btree ("agency_id","status","created_at");--> statement-breakpoint
CREATE INDEX "maintenance_requests_agency_unit_idx" ON "maintenance_requests" USING btree ("agency_id","unit_id");--> statement-breakpoint
CREATE INDEX "maintenance_updates_agency_request_idx" ON "maintenance_updates" USING btree ("agency_id","request_id");--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_maintenance_request_fk" FOREIGN KEY ("agency_id","maintenance_request_id") REFERENCES "public"."maintenance_requests"("agency_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "documents_agency_maintenance_idx" ON "documents" USING btree ("agency_id","maintenance_request_id");--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_exactly_one_subject" CHECK (num_nonnulls("documents"."owner_id", "documents"."property_id", "documents"."unit_id", "documents"."tenant_id", "documents"."lease_id", "documents"."inbound_email_id", "documents"."maintenance_request_id") = 1);--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_recipient_kind" CHECK ("messages"."recipient_kind" IN ('tenant', 'owner', 'staff', 'applicant', 'contractor'));