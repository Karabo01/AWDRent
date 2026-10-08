CREATE TYPE "public"."agency_status" AS ENUM('active', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."staff_role" AS ENUM('admin', 'agent', 'accounts');--> statement-breakpoint
CREATE TABLE "agencies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"subdomain" text NOT NULL,
	"logo_key" text,
	"brand_colour" text DEFAULT '#1f4e8c' NOT NULL,
	"trust_bank_name" text,
	"trust_account_no_enc" text,
	"trust_account_no_last4" text,
	"eft_prefix" text NOT NULL,
	"sms_sender_name" text,
	"quiet_hours_start" time DEFAULT '20:00' NOT NULL,
	"quiet_hours_end" time DEFAULT '07:00' NOT NULL,
	"plan" text DEFAULT 'standard' NOT NULL,
	"included_units" integer DEFAULT 0 NOT NULL,
	"included_sms" integer DEFAULT 0 NOT NULL,
	"status" "agency_status" DEFAULT 'active' NOT NULL,
	"suspended_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "agencies_subdomain_format" CHECK ("agencies"."subdomain" ~ '^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$' AND "agencies"."subdomain" NOT IN ('admin', 'www', 'api', 'files', 'mail', 'app')),
	CONSTRAINT "agencies_eft_prefix_format" CHECK ("agencies"."eft_prefix" ~ '^[A-Z]{2,4}$'),
	CONSTRAINT "agencies_brand_colour_format" CHECK ("agencies"."brand_colour" ~ '^#[0-9a-fA-F]{6}$'),
	CONSTRAINT "agencies_trust_last4_format" CHECK ("agencies"."trust_account_no_last4" IS NULL OR "agencies"."trust_account_no_last4" ~ '^[0-9]{1,4}$')
);
--> statement-breakpoint
CREATE TABLE "platform_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_admins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"two_factor_enabled" boolean DEFAULT false NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform_admin_id" uuid,
	"action" text NOT NULL,
	"agency_id" uuid,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_two_factors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform_admin_id" uuid NOT NULL,
	"agency_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"write_access" boolean DEFAULT false NOT NULL,
	"write_confirmed_at" timestamp with time zone,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_sessions" (
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
CREATE TABLE "auth_two_factors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid DEFAULT app_current_agency() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"phone" text,
	"role" "staff_role" NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"two_factor_enabled" boolean DEFAULT false NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "users_agency_id_id_key" UNIQUE("agency_id","id")
);
--> statement-breakpoint
ALTER TABLE "platform_accounts" ADD CONSTRAINT "platform_accounts_user_id_platform_admins_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."platform_admins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_audit_log" ADD CONSTRAINT "platform_audit_log_platform_admin_id_platform_admins_id_fk" FOREIGN KEY ("platform_admin_id") REFERENCES "public"."platform_admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_audit_log" ADD CONSTRAINT "platform_audit_log_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_sessions" ADD CONSTRAINT "platform_sessions_user_id_platform_admins_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."platform_admins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_two_factors" ADD CONSTRAINT "platform_two_factors_user_id_platform_admins_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."platform_admins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_sessions" ADD CONSTRAINT "support_sessions_platform_admin_id_platform_admins_id_fk" FOREIGN KEY ("platform_admin_id") REFERENCES "public"."platform_admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_sessions" ADD CONSTRAINT "support_sessions_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_accounts" ADD CONSTRAINT "auth_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_fk" FOREIGN KEY ("agency_id","user_id") REFERENCES "public"."users"("agency_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_two_factors" ADD CONSTRAINT "auth_two_factors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agencies_subdomain_key" ON "agencies" USING btree ("subdomain");--> statement-breakpoint
CREATE INDEX "platform_accounts_user_idx" ON "platform_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_admins_email_key" ON "platform_admins" USING btree ("email");--> statement-breakpoint
CREATE INDEX "platform_audit_log_agency_idx" ON "platform_audit_log" USING btree ("agency_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_sessions_token_key" ON "platform_sessions" USING btree ("token");--> statement-breakpoint
CREATE INDEX "platform_sessions_user_idx" ON "platform_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_two_factors_user_key" ON "platform_two_factors" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "platform_verifications_identifier_idx" ON "platform_verifications" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "support_sessions_agency_idx" ON "support_sessions" USING btree ("agency_id","started_at");--> statement-breakpoint
CREATE INDEX "auth_accounts_user_idx" ON "auth_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_sessions_token_key" ON "auth_sessions" USING btree ("token");--> statement-breakpoint
CREATE INDEX "auth_sessions_user_idx" ON "auth_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_two_factors_user_key" ON "auth_two_factors" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_verifications_identifier_idx" ON "auth_verifications" USING btree ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_key" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "users_agency_role_idx" ON "users" USING btree ("agency_id","role");