CREATE TYPE "public"."bank_line_status" AS ENUM('unmatched', 'matched', 'ignored');--> statement-breakpoint
CREATE TYPE "public"."bank_date_format" AS ENUM('YMD', 'DMY', 'MDY');--> statement-breakpoint
CREATE TABLE "bank_import_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid DEFAULT app_current_agency() NOT NULL,
	"name" text NOT NULL,
	"date_column" text NOT NULL,
	"amount_column" text,
	"credit_column" text,
	"debit_column" text,
	"reference_column" text NOT NULL,
	"description_column" text,
	"date_format" "bank_date_format" DEFAULT 'YMD' NOT NULL,
	"skip_rows" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT app_current_user(),
	CONSTRAINT "bank_import_profiles_agency_id_id_key" UNIQUE("agency_id","id"),
	CONSTRAINT "bank_import_profiles_amount_columns" CHECK (("bank_import_profiles"."amount_column" is not null) <> ("bank_import_profiles"."credit_column" is not null)),
	CONSTRAINT "bank_import_profiles_skip_rows" CHECK ("bank_import_profiles"."skip_rows" between 0 and 50)
);
--> statement-breakpoint
CREATE TABLE "bank_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid DEFAULT app_current_agency() NOT NULL,
	"profile_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"file_sha256" text NOT NULL,
	"period_from" date,
	"period_to" date,
	"credit_lines" integer NOT NULL,
	"new_lines" integer NOT NULL,
	"auto_matched" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT app_current_user(),
	CONSTRAINT "bank_imports_agency_id_id_key" UNIQUE("agency_id","id")
);
--> statement-breakpoint
CREATE TABLE "bank_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid DEFAULT app_current_agency() NOT NULL,
	"import_id" uuid NOT NULL,
	"line_date" date NOT NULL,
	"amount_cents" integer NOT NULL,
	"reference" text NOT NULL,
	"description" text,
	"fingerprint" text NOT NULL,
	"status" "bank_line_status" DEFAULT 'unmatched' NOT NULL,
	"matched_lease_id" uuid,
	"auto_matched" boolean DEFAULT false NOT NULL,
	"ignored_reason" text,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_lines_agency_id_id_key" UNIQUE("agency_id","id"),
	CONSTRAINT "bank_lines_amount_positive" CHECK ("bank_lines"."amount_cents" > 0 and "bank_lines"."amount_cents" <= 1000000000),
	CONSTRAINT "bank_lines_matched_has_lease" CHECK (("bank_lines"."status" = 'matched') = ("bank_lines"."matched_lease_id" is not null)),
	CONSTRAINT "bank_lines_ignored_has_reason" CHECK (("bank_lines"."status" = 'ignored') = ("bank_lines"."ignored_reason" is not null))
);
--> statement-breakpoint
ALTER TABLE "deposit_entries" ADD COLUMN "bank_line_id" uuid;--> statement-breakpoint
ALTER TABLE "bank_import_profiles" ADD CONSTRAINT "bank_import_profiles_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_imports" ADD CONSTRAINT "bank_imports_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_imports" ADD CONSTRAINT "bank_imports_profile_fk" FOREIGN KEY ("agency_id","profile_id") REFERENCES "public"."bank_import_profiles"("agency_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_lines" ADD CONSTRAINT "bank_lines_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_lines" ADD CONSTRAINT "bank_lines_import_fk" FOREIGN KEY ("agency_id","import_id") REFERENCES "public"."bank_imports"("agency_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_lines" ADD CONSTRAINT "bank_lines_lease_fk" FOREIGN KEY ("agency_id","matched_lease_id") REFERENCES "public"."leases"("agency_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bank_imports_agency_created_idx" ON "bank_imports" USING btree ("agency_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "bank_lines_agency_fingerprint_key" ON "bank_lines" USING btree ("agency_id","fingerprint");--> statement-breakpoint
CREATE INDEX "bank_lines_agency_status_idx" ON "bank_lines" USING btree ("agency_id","status","line_date");--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_bank_line_fk" FOREIGN KEY ("agency_id","bank_line_id") REFERENCES "public"."bank_lines"("agency_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_entries" ADD CONSTRAINT "deposit_entries_bank_line_fk" FOREIGN KEY ("agency_id","bank_line_id") REFERENCES "public"."bank_lines"("agency_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payments_agency_bank_line_live_key" ON "payments" USING btree ("agency_id","bank_line_id") WHERE "payments"."status" = 'approved';--> statement-breakpoint
CREATE UNIQUE INDEX "deposit_entries_agency_bank_line_live_key" ON "deposit_entries" USING btree ("agency_id","bank_line_id") WHERE "deposit_entries"."voided_at" is null;