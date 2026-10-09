CREATE TYPE "public"."applicant_type" AS ENUM('employed', 'self_employed', 'company');--> statement-breakpoint
CREATE TYPE "public"."application_file_status" AS ENUM('pending', 'accepted', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."application_status" AS ENUM('invited', 'in_progress', 'submitted', 'approved', 'declined', 'revoked', 'expired');--> statement-breakpoint
ALTER TYPE "public"."document_kind" ADD VALUE 'employer_letter' BEFORE 'other';--> statement-breakpoint
ALTER TYPE "public"."document_kind" ADD VALUE 'company_registration' BEFORE 'other';--> statement-breakpoint
ALTER TYPE "public"."document_kind" ADD VALUE 'proof_of_income' BEFORE 'other';--> statement-breakpoint
CREATE TABLE "application_checklists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid DEFAULT app_current_agency() NOT NULL,
	"applicant_type" "applicant_type" NOT NULL,
	"items" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT app_current_user()
);
--> statement-breakpoint
CREATE TABLE "application_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid DEFAULT app_current_agency() NOT NULL,
	"application_id" uuid NOT NULL,
	"item_key" text NOT NULL,
	"document_id" uuid NOT NULL,
	"status" "application_file_status" DEFAULT 'pending' NOT NULL,
	"reject_reason" text,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "application_files_rejected_reason" CHECK (("application_files"."status" = 'rejected') = ("application_files"."reject_reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid DEFAULT app_current_agency() NOT NULL,
	"unit_id" uuid NOT NULL,
	"applicant_type" "applicant_type" NOT NULL,
	"checklist" jsonb NOT NULL,
	"full_name" text NOT NULL,
	"email" text,
	"phone" text,
	"status" "application_status" DEFAULT 'invited' NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consent_at" timestamp with time zone,
	"id_kind" "tenant_id_kind",
	"id_number_enc" text,
	"id_number_last4" text,
	"id_number_blind_index" text,
	"employer" text,
	"current_address" text,
	"proposed_rent_cents" integer NOT NULL,
	"proposed_start" date NOT NULL,
	"submitted_at" timestamp with time zone,
	"reminded_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"decided_by" uuid,
	"decline_reason" text,
	"tenant_id" uuid,
	"lease_id" uuid,
	"purged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT app_current_user(),
	CONSTRAINT "applications_rent_positive" CHECK ("applications"."proposed_rent_cents" > 0),
	CONSTRAINT "applications_contact" CHECK ("applications"."email" is not null or "applications"."phone" is not null or "applications"."purged_at" is not null)
);
--> statement-breakpoint
ALTER TABLE "documents" DROP CONSTRAINT "documents_exactly_one_subject";--> statement-breakpoint
ALTER TABLE "agencies" ADD COLUMN "application_link_days" integer DEFAULT 14 NOT NULL;--> statement-breakpoint
ALTER TABLE "agencies" ADD COLUMN "application_retention_days" integer DEFAULT 90 NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "application_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "application_checklists_agency_type_key" ON "application_checklists" USING btree ("agency_id","applicant_type");--> statement-breakpoint
CREATE UNIQUE INDEX "application_files_agency_document_key" ON "application_files" USING btree ("agency_id","document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "applications_agency_id_id_key" ON "applications" USING btree ("agency_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "applications_agency_token_key" ON "applications" USING btree ("agency_id","token_hash");--> statement-breakpoint
ALTER TABLE "application_checklists" ADD CONSTRAINT "application_checklists_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_files" ADD CONSTRAINT "application_files_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_files" ADD CONSTRAINT "application_files_application_fk" FOREIGN KEY ("agency_id","application_id") REFERENCES "public"."applications"("agency_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_unit_fk" FOREIGN KEY ("agency_id","unit_id") REFERENCES "public"."units"("agency_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_tenant_fk" FOREIGN KEY ("agency_id","tenant_id") REFERENCES "public"."tenants"("agency_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_lease_fk" FOREIGN KEY ("agency_id","lease_id") REFERENCES "public"."leases"("agency_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "application_files_agency_application_idx" ON "application_files" USING btree ("agency_id","application_id");--> statement-breakpoint
CREATE INDEX "applications_agency_status_idx" ON "applications" USING btree ("agency_id","status","created_at");--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_application_fk" FOREIGN KEY ("agency_id","application_id") REFERENCES "public"."applications"("agency_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "documents_agency_application_idx" ON "documents" USING btree ("agency_id","application_id");--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_exactly_one_subject" CHECK (num_nonnulls("documents"."owner_id", "documents"."property_id", "documents"."unit_id", "documents"."tenant_id", "documents"."lease_id", "documents"."inbound_email_id", "documents"."maintenance_request_id", "documents"."application_id") = 1);