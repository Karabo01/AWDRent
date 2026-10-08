ALTER TYPE "public"."document_kind" ADD VALUE 'receipt' BEFORE 'other';--> statement-breakpoint
CREATE TABLE "receipt_sequences" (
	"agency_id" uuid PRIMARY KEY DEFAULT app_current_agency() NOT NULL,
	"last_value" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid DEFAULT app_current_agency() NOT NULL,
	"payment_id" uuid NOT NULL,
	"lease_id" uuid NOT NULL,
	"receipt_number" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"document_id" uuid NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agencies" ADD COLUMN "legal_name" text;--> statement-breakpoint
ALTER TABLE "agencies" ADD COLUMN "registration_no" text;--> statement-breakpoint
ALTER TABLE "agencies" ADD COLUMN "ffc_number" text;--> statement-breakpoint
ALTER TABLE "agencies" ADD COLUMN "vat_number" text;--> statement-breakpoint
ALTER TABLE "agencies" ADD COLUMN "physical_address" text;--> statement-breakpoint
ALTER TABLE "agencies" ADD COLUMN "contact_phone" text;--> statement-breakpoint
ALTER TABLE "agencies" ADD COLUMN "contact_email" text;--> statement-breakpoint
ALTER TABLE "receipt_sequences" ADD CONSTRAINT "receipt_sequences_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_payment_fk" FOREIGN KEY ("agency_id","payment_id") REFERENCES "public"."payments"("agency_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_lease_fk" FOREIGN KEY ("agency_id","lease_id") REFERENCES "public"."leases"("agency_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_document_fk" FOREIGN KEY ("agency_id","document_id") REFERENCES "public"."documents"("agency_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "receipts_agency_payment_key" ON "receipts" USING btree ("agency_id","payment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "receipts_agency_number_key" ON "receipts" USING btree ("agency_id","receipt_number");--> statement-breakpoint
CREATE INDEX "receipts_agency_lease_idx" ON "receipts" USING btree ("agency_id","lease_id");