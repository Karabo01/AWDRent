-- audit_log: agency-scoped, append-only, actor taken from the transaction.

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY agency_isolation ON audit_log FOR ALL TO awdrent_app, awdrent_owner
  USING (agency_id = app_current_agency()) WITH CHECK (agency_id = app_current_agency());
--> statement-breakpoint
GRANT SELECT, INSERT ON audit_log TO awdrent_app;
--> statement-breakpoint

-- Callers cannot choose who did it or when: the transaction context decides.
CREATE FUNCTION audit_log_stamp() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.user_id := app_current_user();
  NEW.support_session_id := app_current_support_session();
  NEW.created_at := now();
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER audit_log_stamp BEFORE INSERT ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_stamp();
--> statement-breakpoint
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
