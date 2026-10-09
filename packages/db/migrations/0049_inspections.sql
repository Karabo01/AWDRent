CREATE TYPE "public"."inspection_kind" AS ENUM('ingoing', 'outgoing');--> statement-breakpoint
CREATE TYPE "public"."inspection_status" AS ENUM('draft', 'completed');--> statement-breakpoint
CREATE TYPE "public"."item_condition" AS ENUM('good', 'fair', 'poor', 'damaged', 'missing', 'not_applicable');--> statement-breakpoint
ALTER TYPE "public"."document_kind" ADD VALUE 'inspection_photo' BEFORE 'other';--> statement-breakpoint
CREATE TABLE "inspection_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid DEFAULT app_current_agency() NOT NULL,
	"inspection_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"room" text NOT NULL,
	"item" text NOT NULL,
	"condition" "item_condition",
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inspections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid DEFAULT app_current_agency() NOT NULL,
	"lease_id" uuid NOT NULL,
	"kind" "inspection_kind" NOT NULL,
	"status" "inspection_status" DEFAULT 'draft' NOT NULL,
	"inspected_on" date NOT NULL,
	"attendees" text,
	"notes" text,
	"completed_at" timestamp with time zone,
	"completed_by" uuid,
	"report_document_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT app_current_user(),
	CONSTRAINT "inspections_completed" CHECK (("inspections"."status" = 'completed') = ("inspections"."completed_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "documents" DROP CONSTRAINT "documents_exactly_one_subject";--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "inspection_item_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "inspection_items_agency_id_id_key" ON "inspection_items" USING btree ("agency_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "inspections_agency_id_id_key" ON "inspections" USING btree ("agency_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "inspections_agency_lease_kind_key" ON "inspections" USING btree ("agency_id","lease_id","kind");--> statement-breakpoint
ALTER TABLE "inspection_items" ADD CONSTRAINT "inspection_items_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_items" ADD CONSTRAINT "inspection_items_inspection_fk" FOREIGN KEY ("agency_id","inspection_id") REFERENCES "public"."inspections"("agency_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_lease_fk" FOREIGN KEY ("agency_id","lease_id") REFERENCES "public"."leases"("agency_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inspection_items_agency_inspection_idx" ON "inspection_items" USING btree ("agency_id","inspection_id","position");--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_inspection_item_fk" FOREIGN KEY ("agency_id","inspection_item_id") REFERENCES "public"."inspection_items"("agency_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "documents_agency_inspection_item_idx" ON "documents" USING btree ("agency_id","inspection_item_id");--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_exactly_one_subject" CHECK (num_nonnulls("documents"."owner_id", "documents"."property_id", "documents"."unit_id", "documents"."tenant_id", "documents"."lease_id", "documents"."inbound_email_id", "documents"."maintenance_request_id", "documents"."application_id", "documents"."inspection_item_id") = 1);