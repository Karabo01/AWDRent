-- Support hand-off token columns are set and consumed by the platform role.
GRANT UPDATE (entry_token_hash, entry_token_expires_at, entry_token_used_at) ON support_sessions TO awdrent_platform;
--> statement-breakpoint

-- usage_counters: the worker writes per agency; the console reads all agencies.
ALTER TABLE usage_counters ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE usage_counters FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY agency_isolation ON usage_counters FOR ALL TO awdrent_app, awdrent_owner
  USING (agency_id = app_current_agency()) WITH CHECK (agency_id = app_current_agency());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON usage_counters TO awdrent_app;
--> statement-breakpoint
CREATE POLICY platform_read ON usage_counters FOR SELECT TO awdrent_platform USING (true);
--> statement-breakpoint
GRANT SELECT ON usage_counters TO awdrent_platform;
--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON usage_counters FOR EACH ROW EXECUTE FUNCTION set_updated_at();
