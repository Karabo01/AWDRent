CREATE TYPE "public"."charge_type" AS ENUM('rent', 'opening_balance', 'late_fee', 'utility', 'damage', 'admin_fee', 'other');--> statement-breakpoint
CREATE TYPE "public"."payment_source" AS ENUM('bank_import', 'pop', 'manual', 'opening_balance');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "charges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid DEFAULT app_current_agency() NOT NULL,
	"lease_id" uuid NOT NULL,
	"type" charge_type NOT NULL,
	"period" date,
	"due_date" date NOT NULL,
	"amount_cents" integer NOT NULL,
	"description" text NOT NULL,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	"voided_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT app_current_user(),
	CONSTRAINT "charges_amount_range" CHECK ("charges"."amount_cents" > 0 and "charges"."amount_cents" <= 1000000000),
	CONSTRAINT "charges_rent_has_period" CHECK (("charges"."type" = 'rent') = ("charges"."period" is not null)),
	CONSTRAINT "charges_void_reason" CHECK (("charges"."voided_at" is null) = ("charges"."void_reason" is null))
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid DEFAULT app_current_agency() NOT NULL,
	"lease_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"paid_on" date NOT NULL,
	"source" "payment_source" NOT NULL,
	"status" "payment_status" DEFAULT 'pending' NOT NULL,
	"bank_line_id" uuid,
	"reference" text,
	"notes" text,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT app_current_user(),
	CONSTRAINT "payments_amount_range" CHECK ("payments"."amount_cents" > 0 and "payments"."amount_cents" <= 1000000000),
	CONSTRAINT "payments_approved_fields" CHECK (("payments"."status" = 'approved') = ("payments"."approved_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "leases" ADD COLUMN "billing_starts_on" date;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_lease_fk" FOREIGN KEY ("agency_id","lease_id") REFERENCES "public"."leases"("agency_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_lease_fk" FOREIGN KEY ("agency_id","lease_id") REFERENCES "public"."leases"("agency_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "charges_agency_lease_due_idx" ON "charges" USING btree ("agency_id","lease_id","due_date");--> statement-breakpoint
CREATE UNIQUE INDEX "charges_agency_lease_rent_period_key" ON "charges" USING btree ("agency_id","lease_id","period") WHERE "charges"."type" = 'rent' and "charges"."voided_at" is null;--> statement-breakpoint
CREATE INDEX "payments_agency_lease_paid_idx" ON "payments" USING btree ("agency_id","lease_id","paid_on");