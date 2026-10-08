-- portal_users: agency-scoped for the app; the auth role reads them to load sessions
CALL app_scope_to_agency('portal_users');
--> statement-breakpoint
GRANT SELECT, INSERT ON portal_users TO awdrent_app;
--> statement-breakpoint
GRANT UPDATE (name, email, active, last_login_at, updated_at) ON portal_users TO awdrent_app;
--> statement-breakpoint
CREATE POLICY portal_users_auth_read ON portal_users FOR SELECT TO awdrent_auth USING (true);
--> statement-breakpoint
GRANT SELECT ON portal_users TO awdrent_auth;
--> statement-breakpoint
-- Sessions and one-time codes: auth role only
ALTER TABLE portal_sessions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE portal_sessions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY auth_only ON portal_sessions FOR ALL TO awdrent_auth USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE portal_verifications ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE portal_verifications FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY auth_only ON portal_verifications FOR ALL TO awdrent_auth USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON portal_sessions, portal_verifications TO awdrent_auth;
--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON portal_sessions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON portal_verifications FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
-- The tenant acting in the portal, set by withAgency() from the verified portal session
CREATE FUNCTION app_current_portal_user() RETURNS uuid
LANGUAGE sql STABLE PARALLEL SAFE
AS $$ SELECT NULLIF(current_setting('app.portal_user_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION audit_log_stamp() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.user_id := app_current_user();
  NEW.support_session_id := app_current_support_session();
  NEW.portal_user_id := app_current_portal_user();
  NEW.created_at := now();
  RETURN NEW;
END
$$;
--> statement-breakpoint
-- Agency admins keep the payment details tenants see up to date (D77)
GRANT UPDATE (trust_account_holder, trust_branch_code) ON agencies TO awdrent_app;
