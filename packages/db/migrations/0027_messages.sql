CREATE TYPE "public"."message_channel" AS ENUM('email', 'sms', 'whatsapp');--> statement-breakpoint
CREATE TYPE "public"."message_status" AS ENUM('queued', 'sent', 'delivered', 'read', 'failed', 'suppressed');--> statement-breakpoint
CREATE TABLE "message_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid DEFAULT app_current_agency() NOT NULL,
	"key" text NOT NULL,
	"channel" "message_channel" NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"provider_template_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT app_current_user()
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid DEFAULT app_current_agency() NOT NULL,
	"batch_id" uuid NOT NULL,
	"template_key" text NOT NULL,
	"channel" "message_channel" NOT NULL,
	"recipient_kind" text NOT NULL,
	"recipient_id" uuid,
	"recipient_name" text NOT NULL,
	"to_address" text NOT NULL,
	"lease_id" uuid,
	"subject" text,
	"body" text NOT NULL,
	"payload" jsonb NOT NULL,
	"attachment_document_id" uuid,
	"status" "message_status" DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_until" timestamp with time zone,
	"provider" text,
	"provider_id" text,
	"error" text,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"fallback_of" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT app_current_user(),
	CONSTRAINT "messages_recipient_kind" CHECK ("messages"."recipient_kind" IN ('tenant', 'owner', 'staff', 'applicant'))
);
--> statement-breakpoint
CREATE TABLE "provider_messages" (
	"provider" text NOT NULL,
	"provider_id" text NOT NULL,
	"agency_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_messages_pkey" PRIMARY KEY("provider","provider_id")
);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "opt_out_code" text;--> statement-breakpoint
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_lease_fk" FOREIGN KEY ("agency_id","lease_id") REFERENCES "public"."leases"("agency_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_attachment_fk" FOREIGN KEY ("agency_id","attachment_document_id") REFERENCES "public"."documents"("agency_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "messages_agency_id_id_key" ON "messages" USING btree ("agency_id","id");--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_fallback_fk" FOREIGN KEY ("agency_id","fallback_of") REFERENCES "public"."messages"("agency_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_messages" ADD CONSTRAINT "provider_messages_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "message_templates_agency_key_channel_key" ON "message_templates" USING btree ("agency_id","key","channel");--> statement-breakpoint
CREATE INDEX "messages_agency_due_idx" ON "messages" USING btree ("agency_id","next_attempt_at") WHERE "messages"."status" = 'queued';--> statement-breakpoint
CREATE INDEX "messages_agency_created_idx" ON "messages" USING btree ("agency_id","created_at");--> statement-breakpoint
CREATE INDEX "messages_agency_lease_idx" ON "messages" USING btree ("agency_id","lease_id");--> statement-breakpoint
CREATE INDEX "messages_agency_batch_idx" ON "messages" USING btree ("agency_id","batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tenants_agency_opt_out_code_key" ON "tenants" USING btree ("agency_id","opt_out_code");