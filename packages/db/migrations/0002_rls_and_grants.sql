-- Row-level security and grants for the tables in 0001.
--
-- Roles (created by docker/postgres/init/01-roles.sh):
--   awdrent_owner     owns everything; runs migrations. FORCE RLS applies to it too.
--   awdrent_app       web app + worker. Sees only app_current_agency().
--   awdrent_auth      Better Auth (staff + platform instances). Login tables only.
--   awdrent_platform  platform console. Agencies and platform tables only.
--
-- Nothing is granted to PUBLIC. A table with no grant for a role is invisible to it.

-- ─── agencies ────────────────────────────────────────────────────────
-- Not FORCEd: agency_public_by_subdomain() below runs as the owner and must
-- read it before any agency is known. Every other role goes through policies.
ALTER TABLE agencies ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY agencies_app_own ON agencies FOR ALL TO awdrent_app
  USING (id = app_current_agency()) WITH CHECK (id = app_current_agency());
--> statement-breakpoint
GRANT SELECT ON agencies TO awdrent_app;
--> statement-breakpoint
-- Agency admins edit their own settings and branding. Plan, limits, status,
-- subdomain and EFT prefix are platform-only.
GRANT UPDATE (name, logo_key, brand_colour, trust_bank_name, trust_account_no_enc, trust_account_no_last4,
  sms_sender_name, quiet_hours_start, quiet_hours_end, updated_at) ON agencies TO awdrent_app;
--> statement-breakpoint
CREATE POLICY agencies_platform_all ON agencies FOR ALL TO awdrent_platform USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON agencies TO awdrent_platform;
--> statement-breakpoint
-- Login checks that the user's agency is active and matches the host.
CREATE POLICY agencies_auth_read ON agencies FOR SELECT TO awdrent_auth USING (true);
--> statement-breakpoint
GRANT SELECT (id, subdomain, status) ON agencies TO awdrent_auth;
--> statement-breakpoint

-- Public branding lookup for a host, before anyone is logged in.
-- Returns no bank details.
CREATE FUNCTION agency_public_by_subdomain(p_subdomain text)
RETURNS TABLE (id uuid, name text, subdomain text, logo_key text, brand_colour text, status agency_status)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT a.id, a.name, a.subdomain, a.logo_key, a.brand_colour, a.status
  FROM agencies a WHERE a.subdomain = lower(p_subdomain)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION agency_public_by_subdomain(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION agency_public_by_subdomain(text) TO awdrent_app;
--> statement-breakpoint

-- ─── users (agency-scoped) ───────────────────────────────────────────
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE users FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY agency_isolation ON users FOR ALL TO awdrent_app, awdrent_owner
  USING (agency_id = app_current_agency()) WITH CHECK (agency_id = app_current_agency());
--> statement-breakpoint
-- No DELETE: staff are deactivated, so audit history keeps its user.
GRANT SELECT, INSERT ON users TO awdrent_app;
--> statement-breakpoint
GRANT UPDATE (name, phone, role, active, updated_at) ON users TO awdrent_app;
--> statement-breakpoint
-- Better Auth looks users up by email across agencies, and records logins/2FA.
CREATE POLICY users_auth ON users FOR ALL TO awdrent_auth USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT ON users TO awdrent_auth;
--> statement-breakpoint
GRANT UPDATE (email_verified, two_factor_enabled, last_login_at, updated_at) ON users TO awdrent_auth;
--> statement-breakpoint

-- ─── staff auth tables: auth role only ───────────────────────────────
-- RLS is on with a policy only for awdrent_auth, so a stray grant to the app
-- role later would still expose nothing.
ALTER TABLE auth_sessions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE auth_sessions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY auth_only ON auth_sessions FOR ALL TO awdrent_auth USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE auth_accounts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE auth_accounts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY auth_only ON auth_accounts FOR ALL TO awdrent_auth USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE auth_verifications ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE auth_verifications FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY auth_only ON auth_verifications FOR ALL TO awdrent_auth USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE auth_two_factors ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE auth_two_factors FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY auth_only ON auth_two_factors FOR ALL TO awdrent_auth USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON auth_sessions, auth_accounts, auth_verifications, auth_two_factors TO awdrent_auth;
--> statement-breakpoint

-- ─── platform auth tables: auth role (+ platform reads admins) ────────
ALTER TABLE platform_admins ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE platform_admins FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY platform_admins_auth ON platform_admins FOR ALL TO awdrent_auth USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY platform_admins_platform_read ON platform_admins FOR SELECT TO awdrent_platform USING (true);
--> statement-breakpoint
GRANT SELECT ON platform_admins TO awdrent_auth, awdrent_platform;
--> statement-breakpoint
GRANT UPDATE (email_verified, two_factor_enabled, last_login_at, updated_at) ON platform_admins TO awdrent_auth;
--> statement-breakpoint
ALTER TABLE platform_sessions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE platform_sessions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY auth_only ON platform_sessions FOR ALL TO awdrent_auth USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE platform_accounts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE platform_accounts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY auth_only ON platform_accounts FOR ALL TO awdrent_auth USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE platform_verifications ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE platform_verifications FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY auth_only ON platform_verifications FOR ALL TO awdrent_auth USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE platform_two_factors ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE platform_two_factors FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY auth_only ON platform_two_factors FOR ALL TO awdrent_auth USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON platform_sessions, platform_accounts, platform_verifications, platform_two_factors TO awdrent_auth;
--> statement-breakpoint

-- ─── support sessions and platform audit: platform role only ─────────
ALTER TABLE support_sessions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE support_sessions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY platform_only ON support_sessions FOR ALL TO awdrent_platform USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT, INSERT ON support_sessions TO awdrent_platform;
--> statement-breakpoint
-- Only ending a session or confirming write access; the rest is fixed at creation.
GRANT UPDATE (write_access, write_confirmed_at, ended_at, updated_at) ON support_sessions TO awdrent_platform;
--> statement-breakpoint
ALTER TABLE platform_audit_log ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE platform_audit_log FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY platform_only ON platform_audit_log FOR ALL TO awdrent_platform USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT, INSERT ON platform_audit_log TO awdrent_platform;
--> statement-breakpoint
CREATE TRIGGER platform_audit_log_append_only BEFORE UPDATE OR DELETE ON platform_audit_log
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER platform_audit_log_no_truncate BEFORE TRUNCATE ON platform_audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint

-- ─── updated_at triggers ─────────────────────────────────────────────
CREATE TRIGGER set_updated_at BEFORE UPDATE ON agencies FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON platform_admins FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON support_sessions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
