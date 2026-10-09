CREATE TYPE "public"."commission_model" AS ENUM('first_month', 'percent');--> statement-breakpoint
CREATE TYPE "public"."statement_run_status" AS ENUM('draft', 'approved');--> statement-breakpoint
ALTER TYPE "public"."document_kind" ADD VALUE 'owner_statement' BEFORE 'other';--> statement-breakpoint
CREATE TABLE "owner_statement_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid DEFAULT app_current_agency() NOT NULL,
	"statement_id" uuid NOT NULL,
	"lease_id" uuid NOT NULL,
	"label" text NOT NULL,
	"rent_cents" integer NOT NULL,
	"commission_cents" integer NOT NULL,
	"vat_cents" integer NOT NULL,
	"commission_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "owner_statements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid DEFAULT app_current_agency() NOT NULL,
	"run_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"period" date NOT NULL,
	"opening_cents" integer NOT NULL,
	"rent_cents" integer NOT NULL,
	"commission_cents" integer NOT NULL,
	"vat_cents" integer NOT NULL,
	"payable_cents" integer NOT NULL,
	"document_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "statement_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid DEFAULT app_current_agency() NOT NULL,
	"period" date NOT NULL,
	"status" "statement_run_status" DEFAULT 'draft' NOT NULL,
	"approved_at" timestamp with time zone,
	"approved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT app_current_user(),
	CONSTRAINT "statement_runs_period_first" CHECK (extract(day from "statement_runs"."period") = 1),
	CONSTRAINT "statement_runs_approved" CHECK (("statement_runs"."status" = 'approved') = ("statement_runs"."approved_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "owners" ADD COLUMN "commission_model" "commission_model" DEFAULT 'first_month' NOT NULL;--> statement-breakpoint
ALTER TABLE "leases" ADD COLUMN "letting_fee" boolean DEFAULT true NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "owner_statements_agency_id_id_key" ON "owner_statements" USING btree ("agency_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "statement_runs_agency_id_id_key" ON "statement_runs" USING btree ("agency_id","id");--> statement-breakpoint
ALTER TABLE "owner_statement_lines" ADD CONSTRAINT "owner_statement_lines_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_statement_lines" ADD CONSTRAINT "owner_statement_lines_statement_fk" FOREIGN KEY ("agency_id","statement_id") REFERENCES "public"."owner_statements"("agency_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_statement_lines" ADD CONSTRAINT "owner_statement_lines_lease_fk" FOREIGN KEY ("agency_id","lease_id") REFERENCES "public"."leases"("agency_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_statements" ADD CONSTRAINT "owner_statements_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_statements" ADD CONSTRAINT "owner_statements_run_fk" FOREIGN KEY ("agency_id","run_id") REFERENCES "public"."statement_runs"("agency_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_statements" ADD CONSTRAINT "owner_statements_owner_fk" FOREIGN KEY ("agency_id","owner_id") REFERENCES "public"."owners"("agency_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_statements" ADD CONSTRAINT "owner_statements_document_fk" FOREIGN KEY ("agency_id","document_id") REFERENCES "public"."documents"("agency_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement_runs" ADD CONSTRAINT "statement_runs_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "owner_statement_lines_agency_statement_idx" ON "owner_statement_lines" USING btree ("agency_id","statement_id");--> statement-breakpoint
CREATE INDEX "owner_statement_lines_agency_lease_idx" ON "owner_statement_lines" USING btree ("agency_id","lease_id");--> statement-breakpoint
CREATE UNIQUE INDEX "owner_statements_agency_run_owner_key" ON "owner_statements" USING btree ("agency_id","run_id","owner_id");--> statement-breakpoint
CREATE INDEX "owner_statements_agency_owner_idx" ON "owner_statements" USING btree ("agency_id","owner_id","period");--> statement-breakpoint
CREATE UNIQUE INDEX "statement_runs_agency_period_key" ON "statement_runs" USING btree ("agency_id","period");