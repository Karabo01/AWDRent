CREATE TABLE "portal_accounts" (
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
ALTER TABLE "portal_accounts" ADD CONSTRAINT "portal_accounts_user_id_portal_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."portal_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "portal_accounts_user_idx" ON "portal_accounts" USING btree ("user_id");--> statement-breakpoint
-- Required by Better Auth, unused by the portal: auth role only
ALTER TABLE portal_accounts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE portal_accounts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY auth_only ON portal_accounts FOR ALL TO awdrent_auth USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON portal_accounts TO awdrent_auth;
