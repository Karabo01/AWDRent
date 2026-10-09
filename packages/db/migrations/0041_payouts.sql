CREATE TYPE "public"."payout_batch_status" AS ENUM('created', 'paid');--> statement-breakpoint
CREATE TABLE "payout_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid DEFAULT app_current_agency() NOT NULL,
	"run_id" uuid NOT NULL,
	"status" "payout_batch_status" DEFAULT 'created' NOT NULL,
	"total_cents" integer NOT NULL,
	"paid_at" timestamp with time zone,
	"paid_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT app_current_user(),
	CONSTRAINT "payout_batches_paid" CHECK (("payout_batches"."status" = 'paid') = ("payout_batches"."paid_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "payout_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid DEFAULT app_current_agency() NOT NULL,
	"batch_id" uuid NOT NULL,
	"statement_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"bank_name" text NOT NULL,
	"branch_code" text NOT NULL,
	"account_holder" text NOT NULL,
	"account_no_enc" text NOT NULL,
	"account_no_last4" text NOT NULL,
	"reference" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payout_items_amount_positive" CHECK ("payout_items"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "payout_batches_agency_id_id_key" ON "payout_batches" USING btree ("agency_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "payout_items_agency_statement_key" ON "payout_items" USING btree ("agency_id","statement_id");--> statement-breakpoint
ALTER TABLE "payout_batches" ADD CONSTRAINT "payout_batches_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_batches" ADD CONSTRAINT "payout_batches_run_fk" FOREIGN KEY ("agency_id","run_id") REFERENCES "public"."statement_runs"("agency_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_items" ADD CONSTRAINT "payout_items_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_items" ADD CONSTRAINT "payout_items_batch_fk" FOREIGN KEY ("agency_id","batch_id") REFERENCES "public"."payout_batches"("agency_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_items" ADD CONSTRAINT "payout_items_statement_fk" FOREIGN KEY ("agency_id","statement_id") REFERENCES "public"."owner_statements"("agency_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_items" ADD CONSTRAINT "payout_items_owner_fk" FOREIGN KEY ("agency_id","owner_id") REFERENCES "public"."owners"("agency_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payout_batches_agency_run_idx" ON "payout_batches" USING btree ("agency_id","run_id");--> statement-breakpoint
CREATE INDEX "payout_items_agency_batch_idx" ON "payout_items" USING btree ("agency_id","batch_id");