CREATE TABLE "portal_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"agency_id" uuid NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portal_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid DEFAULT app_current_agency() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portal_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agencies" ADD COLUMN "trust_account_holder" text;--> statement-breakpoint
ALTER TABLE "agencies" ADD COLUMN "trust_branch_code" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "portal_user_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "portal_users_agency_id_id_key" ON "portal_users" USING btree ("agency_id","id");--> statement-breakpoint
ALTER TABLE "portal_sessions" ADD CONSTRAINT "portal_sessions_user_fk" FOREIGN KEY ("agency_id","user_id") REFERENCES "public"."portal_users"("agency_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_users" ADD CONSTRAINT "portal_users_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_users" ADD CONSTRAINT "portal_users_tenant_fk" FOREIGN KEY ("agency_id","tenant_id") REFERENCES "public"."tenants"("agency_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "portal_sessions_token_key" ON "portal_sessions" USING btree ("token");--> statement-breakpoint
CREATE INDEX "portal_sessions_user_idx" ON "portal_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "portal_users_agency_tenant_key" ON "portal_users" USING btree ("agency_id","tenant_id");--> statement-breakpoint
CREATE INDEX "portal_verifications_identifier_idx" ON "portal_verifications" USING btree ("identifier");--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_portal_user_fk" FOREIGN KEY ("agency_id","portal_user_id") REFERENCES "public"."portal_users"("agency_id","id") ON DELETE no action ON UPDATE no action;