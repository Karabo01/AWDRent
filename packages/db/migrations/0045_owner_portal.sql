ALTER TABLE "portal_users" ALTER COLUMN "tenant_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "owners" ADD COLUMN "portal_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "portal_users" ADD COLUMN "owner_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "portal_users_agency_owner_key" ON "portal_users" USING btree ("agency_id","owner_id");--> statement-breakpoint
ALTER TABLE "portal_users" ADD CONSTRAINT "portal_users_owner_fk" FOREIGN KEY ("agency_id","owner_id") REFERENCES "public"."owners"("agency_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_users" ADD CONSTRAINT "portal_users_one_party" CHECK (num_nonnulls("portal_users"."tenant_id", "portal_users"."owner_id") = 1);--> statement-breakpoint
GRANT UPDATE (portal_enabled) ON owners TO awdrent_app;
