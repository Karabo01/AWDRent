CREATE TYPE "public"."document_kind" AS ENUM('title_deed', 'inspection_report', 'photo', 'id_document', 'lease_agreement', 'proof_of_address', 'payslip', 'bank_statement', 'other');--> statement-breakpoint
CREATE TYPE "public"."document_status" AS ENUM('pending_scan', 'clean', 'infected', 'scan_failed');--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid DEFAULT app_current_agency() NOT NULL,
	"owner_id" uuid,
	"property_id" uuid,
	"unit_id" uuid,
	"tenant_id" uuid,
	"lease_id" uuid,
	"kind" "document_kind" NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"file_key" text NOT NULL,
	"status" "document_status" DEFAULT 'pending_scan' NOT NULL,
	"scan_result" text,
	"scanned_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT app_current_user(),
	CONSTRAINT "documents_exactly_one_subject" CHECK (num_nonnulls("documents"."owner_id", "documents"."property_id", "documents"."unit_id", "documents"."tenant_id", "documents"."lease_id") = 1),
	CONSTRAINT "documents_size_limit" CHECK ("documents"."size_bytes" > 0 and "documents"."size_bytes" <= 10485760),
	CONSTRAINT "documents_file_key_prefix" CHECK ("documents"."file_key" like 'agencies/' || "documents"."agency_id"::text || '/%')
);
--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_owner_fk" FOREIGN KEY ("agency_id","owner_id") REFERENCES "public"."owners"("agency_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_property_fk" FOREIGN KEY ("agency_id","property_id") REFERENCES "public"."properties"("agency_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_unit_fk" FOREIGN KEY ("agency_id","unit_id") REFERENCES "public"."units"("agency_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_tenant_fk" FOREIGN KEY ("agency_id","tenant_id") REFERENCES "public"."tenants"("agency_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_lease_fk" FOREIGN KEY ("agency_id","lease_id") REFERENCES "public"."leases"("agency_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "documents_agency_owner_idx" ON "documents" USING btree ("agency_id","owner_id");--> statement-breakpoint
CREATE INDEX "documents_agency_property_idx" ON "documents" USING btree ("agency_id","property_id");--> statement-breakpoint
CREATE INDEX "documents_agency_unit_idx" ON "documents" USING btree ("agency_id","unit_id");--> statement-breakpoint
CREATE INDEX "documents_agency_tenant_idx" ON "documents" USING btree ("agency_id","tenant_id");--> statement-breakpoint
CREATE INDEX "documents_agency_lease_idx" ON "documents" USING btree ("agency_id","lease_id");--> statement-breakpoint
CREATE INDEX "documents_agency_status_idx" ON "documents" USING btree ("agency_id","status");