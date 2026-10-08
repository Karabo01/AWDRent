CREATE TYPE "public"."lease_event_type" AS ENUM('created', 'activated', 'amended', 'renewed', 'escalated', 'notice_given', 'terminated', 'ended');--> statement-breakpoint
CREATE TYPE "public"."lease_status" AS ENUM('draft', 'active', 'notice_given', 'ended', 'terminated');--> statement-breakpoint
CREATE TYPE "public"."tenant_id_kind" AS ENUM('sa_id', 'passport');--> statement-breakpoint
CREATE TABLE "eft_sequences" (
	"agency_id" uuid PRIMARY KEY DEFAULT app_current_agency() NOT NULL,
	"last_value" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lease_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid DEFAULT app_current_agency() NOT NULL,
	"lease_id" uuid NOT NULL,
	"type" "lease_event_type" NOT NULL,
	"effective_date" date NOT NULL,
	"note" text,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT app_current_user()
);
--> statement-breakpoint
CREATE TABLE "lease_tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid DEFAULT app_current_agency() NOT NULL,
	"lease_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT app_current_user()
);
--> statement-breakpoint
CREATE TABLE "leases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid DEFAULT app_current_agency() NOT NULL,
	"unit_id" uuid NOT NULL,
	"eft_reference" text NOT NULL,
	"status" "lease_status" DEFAULT 'draft' NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"rent_cents" integer NOT NULL,
	"due_day" integer DEFAULT 1 NOT NULL,
	"deposit_cents" integer DEFAULT 0 NOT NULL,
	"escalation_bps" integer,
	"escalation_date" date,
	"notice_days" integer DEFAULT 30 NOT NULL,
	"notice_given_on" date,
	"terminated_on" date,
	"termination_reason" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT app_current_user(),
	CONSTRAINT "leases_agency_id_id_key" UNIQUE("agency_id","id"),
	CONSTRAINT "leases_rent_positive" CHECK ("leases"."rent_cents" > 0),
	CONSTRAINT "leases_deposit_non_negative" CHECK ("leases"."deposit_cents" >= 0),
	CONSTRAINT "leases_due_day_range" CHECK ("leases"."due_day" between 1 and 31),
	CONSTRAINT "leases_notice_days_range" CHECK ("leases"."notice_days" between 0 and 365),
	CONSTRAINT "leases_escalation_range" CHECK ("leases"."escalation_bps" is null or "leases"."escalation_bps" between 0 and 10000),
	CONSTRAINT "leases_dates_order" CHECK ("leases"."end_date" is null or "leases"."end_date" >= "leases"."start_date"),
	CONSTRAINT "leases_eft_reference_format" CHECK ("leases"."eft_reference" ~ '^[A-Z0-9][A-Z0-9-]{2,19}$')
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid DEFAULT app_current_agency() NOT NULL,
	"full_name" text NOT NULL,
	"id_kind" "tenant_id_kind" DEFAULT 'sa_id' NOT NULL,
	"id_number_enc" text,
	"id_number_last4" text,
	"id_number_blind_index" text,
	"email" text,
	"phone" text,
	"employer" text,
	"emergency_contact_name" text,
	"emergency_contact_phone" text,
	"consent_at" timestamp with time zone,
	"email_opt_in" boolean DEFAULT true NOT NULL,
	"sms_opt_in" boolean DEFAULT false NOT NULL,
	"whatsapp_opt_in" boolean DEFAULT false NOT NULL,
	"notes" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT app_current_user(),
	CONSTRAINT "tenants_agency_id_id_key" UNIQUE("agency_id","id")
);
--> statement-breakpoint
ALTER TABLE "eft_sequences" ADD CONSTRAINT "eft_sequences_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lease_events" ADD CONSTRAINT "lease_events_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lease_events" ADD CONSTRAINT "lease_events_lease_fk" FOREIGN KEY ("agency_id","lease_id") REFERENCES "public"."leases"("agency_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lease_tenants" ADD CONSTRAINT "lease_tenants_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lease_tenants" ADD CONSTRAINT "lease_tenants_lease_fk" FOREIGN KEY ("agency_id","lease_id") REFERENCES "public"."leases"("agency_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lease_tenants" ADD CONSTRAINT "lease_tenants_tenant_fk" FOREIGN KEY ("agency_id","tenant_id") REFERENCES "public"."tenants"("agency_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leases" ADD CONSTRAINT "leases_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leases" ADD CONSTRAINT "leases_unit_fk" FOREIGN KEY ("agency_id","unit_id") REFERENCES "public"."units"("agency_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lease_events_agency_lease_idx" ON "lease_events" USING btree ("agency_id","lease_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "lease_tenants_agency_lease_tenant_key" ON "lease_tenants" USING btree ("agency_id","lease_id","tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lease_tenants_agency_one_primary_key" ON "lease_tenants" USING btree ("agency_id","lease_id") WHERE "lease_tenants"."is_primary";--> statement-breakpoint
CREATE INDEX "lease_tenants_agency_tenant_idx" ON "lease_tenants" USING btree ("agency_id","tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "leases_agency_eft_reference_key" ON "leases" USING btree ("agency_id","eft_reference");--> statement-breakpoint
CREATE INDEX "leases_agency_unit_idx" ON "leases" USING btree ("agency_id","unit_id");--> statement-breakpoint
CREATE INDEX "leases_agency_status_idx" ON "leases" USING btree ("agency_id","status");--> statement-breakpoint
CREATE INDEX "tenants_agency_name_idx" ON "tenants" USING btree ("agency_id","full_name");--> statement-breakpoint
CREATE INDEX "tenants_agency_id_index_idx" ON "tenants" USING btree ("agency_id","id_number_blind_index");