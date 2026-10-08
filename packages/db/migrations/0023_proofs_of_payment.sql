CREATE TYPE "public"."pop_channel" AS ENUM('staff', 'portal', 'email', 'whatsapp');--> statement-breakpoint
CREATE TYPE "public"."pop_status" AS ENUM('pending', 'approved', 'partial', 'rejected');--> statement-breakpoint
ALTER TYPE "public"."document_kind" ADD VALUE 'proof_of_payment' BEFORE 'other';--> statement-breakpoint
CREATE TABLE "proofs_of_payment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid DEFAULT app_current_agency() NOT NULL,
	"lease_id" uuid NOT NULL,
	"tenant_id" uuid,
	"document_id" uuid NOT NULL,
	"claimed_cents" integer NOT NULL,
	"claimed_paid_on" date NOT NULL,
	"reference_given" text,
	"submitted_via" "pop_channel" NOT NULL,
	"status" "pop_status" DEFAULT 'pending' NOT NULL,
	"bank_line_id" uuid,
	"approved_cents" integer,
	"reject_reason" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT app_current_user(),
	CONSTRAINT "proofs_of_payment_claimed_range" CHECK ("proofs_of_payment"."claimed_cents" > 0 and "proofs_of_payment"."claimed_cents" <= 1000000000),
	CONSTRAINT "proofs_of_payment_approved_has_line" CHECK (("proofs_of_payment"."status" in ('approved', 'partial')) = ("proofs_of_payment"."bank_line_id" is not null and "proofs_of_payment"."approved_cents" is not null)),
	CONSTRAINT "proofs_of_payment_rejected_has_reason" CHECK (("proofs_of_payment"."status" = 'rejected') = ("proofs_of_payment"."reject_reason" is not null))
);
--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_agency_id_id_key" UNIQUE("agency_id","id");
ALTER TABLE "proofs_of_payment" ADD CONSTRAINT "proofs_of_payment_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proofs_of_payment" ADD CONSTRAINT "proofs_of_payment_lease_fk" FOREIGN KEY ("agency_id","lease_id") REFERENCES "public"."leases"("agency_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proofs_of_payment" ADD CONSTRAINT "proofs_of_payment_tenant_fk" FOREIGN KEY ("agency_id","tenant_id") REFERENCES "public"."tenants"("agency_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proofs_of_payment" ADD CONSTRAINT "proofs_of_payment_document_fk" FOREIGN KEY ("agency_id","document_id") REFERENCES "public"."documents"("agency_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proofs_of_payment" ADD CONSTRAINT "proofs_of_payment_bank_line_fk" FOREIGN KEY ("agency_id","bank_line_id") REFERENCES "public"."bank_lines"("agency_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "proofs_of_payment_agency_status_idx" ON "proofs_of_payment" USING btree ("agency_id","status","created_at");--> statement-breakpoint
CREATE INDEX "proofs_of_payment_agency_lease_idx" ON "proofs_of_payment" USING btree ("agency_id","lease_id");--> statement-breakpoint
CREATE UNIQUE INDEX "proofs_of_payment_agency_bank_line_key" ON "proofs_of_payment" USING btree ("agency_id","bank_line_id") WHERE "proofs_of_payment"."bank_line_id" is not null;--> statement-breakpoint