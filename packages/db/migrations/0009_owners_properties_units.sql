CREATE TYPE "public"."owner_kind" AS ENUM('individual', 'company', 'trust');--> statement-breakpoint
CREATE TYPE "public"."property_type" AS ENUM('house', 'apartment_block', 'complex', 'commercial', 'mixed_use', 'other');--> statement-breakpoint
CREATE TYPE "public"."unit_status" AS ENUM('vacant', 'occupied', 'notice_given', 'under_maintenance');--> statement-breakpoint
CREATE TABLE "agent_portfolios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid DEFAULT app_current_agency() NOT NULL,
	"user_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT app_current_user()
);
--> statement-breakpoint
CREATE TABLE "owners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid DEFAULT app_current_agency() NOT NULL,
	"kind" "owner_kind" DEFAULT 'individual' NOT NULL,
	"name" text NOT NULL,
	"id_or_reg_no_enc" text,
	"id_or_reg_no_last4" text,
	"id_or_reg_no_blind_index" text,
	"email" text,
	"phone" text,
	"postal_address" text,
	"bank_name" text,
	"bank_branch_code" text,
	"bank_account_holder" text,
	"bank_account_no_enc" text,
	"bank_account_no_last4" text,
	"commission_bps" integer DEFAULT 0 NOT NULL,
	"vat_registered" boolean DEFAULT false NOT NULL,
	"vat_number" text,
	"notes" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT app_current_user(),
	CONSTRAINT "owners_agency_id_id_key" UNIQUE("agency_id","id")
);
--> statement-breakpoint
CREATE TABLE "properties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid DEFAULT app_current_agency() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" "property_type" DEFAULT 'house' NOT NULL,
	"address_line1" text NOT NULL,
	"address_line2" text,
	"suburb" text,
	"city" text NOT NULL,
	"province" text,
	"postal_code" text,
	"notes" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT app_current_user(),
	CONSTRAINT "properties_agency_id_id_key" UNIQUE("agency_id","id")
);
--> statement-breakpoint
CREATE TABLE "units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid DEFAULT app_current_agency() NOT NULL,
	"property_id" uuid NOT NULL,
	"label" text NOT NULL,
	"bedrooms" integer,
	"bathrooms" integer,
	"status" "unit_status" DEFAULT 'vacant' NOT NULL,
	"notes" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT app_current_user(),
	CONSTRAINT "units_agency_id_id_key" UNIQUE("agency_id","id")
);
--> statement-breakpoint
ALTER TABLE "agent_portfolios" ADD CONSTRAINT "agent_portfolios_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_portfolios" ADD CONSTRAINT "agent_portfolios_user_fk" FOREIGN KEY ("agency_id","user_id") REFERENCES "public"."users"("agency_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_portfolios" ADD CONSTRAINT "agent_portfolios_property_fk" FOREIGN KEY ("agency_id","property_id") REFERENCES "public"."properties"("agency_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owners" ADD CONSTRAINT "owners_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_owner_fk" FOREIGN KEY ("agency_id","owner_id") REFERENCES "public"."owners"("agency_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_property_fk" FOREIGN KEY ("agency_id","property_id") REFERENCES "public"."properties"("agency_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_portfolios_agency_user_property_key" ON "agent_portfolios" USING btree ("agency_id","user_id","property_id");--> statement-breakpoint
CREATE INDEX "agent_portfolios_agency_property_idx" ON "agent_portfolios" USING btree ("agency_id","property_id");--> statement-breakpoint
CREATE INDEX "owners_agency_name_idx" ON "owners" USING btree ("agency_id","name");--> statement-breakpoint
CREATE INDEX "owners_agency_id_index_idx" ON "owners" USING btree ("agency_id","id_or_reg_no_blind_index");--> statement-breakpoint
CREATE INDEX "properties_agency_owner_idx" ON "properties" USING btree ("agency_id","owner_id");--> statement-breakpoint
CREATE INDEX "properties_agency_name_idx" ON "properties" USING btree ("agency_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "units_agency_property_label_key" ON "units" USING btree ("agency_id","property_id","label");--> statement-breakpoint
CREATE INDEX "units_agency_status_idx" ON "units" USING btree ("agency_id","status");