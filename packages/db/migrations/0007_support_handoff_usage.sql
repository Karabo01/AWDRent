CREATE TABLE "usage_counters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid DEFAULT app_current_agency() NOT NULL,
	"month" date NOT NULL,
	"active_units" integer DEFAULT 0 NOT NULL,
	"sms_sent" integer DEFAULT 0 NOT NULL,
	"emails_sent" integer DEFAULT 0 NOT NULL,
	"whatsapp_sent" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "support_sessions" ADD COLUMN "entry_token_hash" text;--> statement-breakpoint
ALTER TABLE "support_sessions" ADD COLUMN "entry_token_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "support_sessions" ADD COLUMN "entry_token_used_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "usage_counters" ADD CONSTRAINT "usage_counters_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "usage_counters_agency_month_key" ON "usage_counters" USING btree ("agency_id","month");