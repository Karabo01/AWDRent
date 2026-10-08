CREATE TYPE "public"."deposit_entry_type" AS ENUM('received', 'interest', 'deduction', 'refund');--> statement-breakpoint
ALTER TYPE "public"."payment_source" ADD VALUE 'deposit';--> statement-breakpoint
ALTER TYPE "public"."payment_status" ADD VALUE 'reversed';--> statement-breakpoint
CREATE TABLE "deposit_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid DEFAULT app_current_agency() NOT NULL,
	"lease_id" uuid NOT NULL,
	"type" "deposit_entry_type" NOT NULL,
	"amount_cents" integer NOT NULL,
	"entry_date" date NOT NULL,
	"description" text NOT NULL,
	"reference" text,
	"rent_payment_id" uuid,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	"voided_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT app_current_user(),
	CONSTRAINT "deposit_entries_amount_range" CHECK ("deposit_entries"."amount_cents" > 0 and "deposit_entries"."amount_cents" <= 1000000000),
	CONSTRAINT "deposit_entries_void_reason" CHECK (("deposit_entries"."voided_at" is null) = ("deposit_entries"."void_reason" is null)),
	CONSTRAINT "deposit_entries_rent_payment_only_for_deductions" CHECK ("deposit_entries"."rent_payment_id" is null or "deposit_entries"."type" = 'deduction')
);
--> statement-breakpoint
ALTER TABLE "payments" DROP CONSTRAINT "payments_approved_fields";--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "reversed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "reversal_reason" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "reversed_by" uuid;--> statement-breakpoint
ALTER TABLE "deposit_entries" ADD CONSTRAINT "deposit_entries_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_entries" ADD CONSTRAINT "deposit_entries_lease_fk" FOREIGN KEY ("agency_id","lease_id") REFERENCES "public"."leases"("agency_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_agency_id_id_key" UNIQUE("agency_id","id");--> statement-breakpoint
ALTER TABLE "deposit_entries" ADD CONSTRAINT "deposit_entries_rent_payment_fk" FOREIGN KEY ("agency_id","rent_payment_id") REFERENCES "public"."payments"("agency_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deposit_entries_agency_lease_idx" ON "deposit_entries" USING btree ("agency_id","lease_id","entry_date");--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_reversed_fields" CHECK (("payments"."status"::text = 'reversed') = ("payments"."reversed_at" is not null and "payments"."reversal_reason" is not null));--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_approved_fields" CHECK (("payments"."status"::text in ('approved', 'reversed')) = ("payments"."approved_at" is not null));