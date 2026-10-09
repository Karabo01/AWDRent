CALL app_scope_to_agency('inbound_emails');
--> statement-breakpoint
-- What arrived is fixed; only the outcome is recorded
GRANT SELECT, INSERT ON inbound_emails TO awdrent_app;
--> statement-breakpoint
GRANT UPDATE (status, pop_id, note, resolved_at, resolved_by, updated_at) ON inbound_emails TO awdrent_app;
--> statement-breakpoint
-- Emailed files move from the inbox to a lease once (D87); nothing else may change what a document belongs to
GRANT UPDATE (lease_id, inbound_email_id) ON documents TO awdrent_app;
--> statement-breakpoint
CREATE FUNCTION documents_subject_fixed() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.lease_id IS DISTINCT FROM OLD.lease_id OR NEW.inbound_email_id IS DISTINCT FROM OLD.inbound_email_id THEN
    IF NOT (OLD.inbound_email_id IS NOT NULL AND OLD.lease_id IS NULL AND NEW.inbound_email_id IS NULL AND NEW.lease_id IS NOT NULL) THEN
      RAISE EXCEPTION 'document % cannot be moved', OLD.id USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER documents_subject_fixed BEFORE UPDATE ON documents FOR EACH ROW EXECUTE FUNCTION documents_subject_fixed();
--> statement-breakpoint
-- Resolved once: converted or dismissed
CREATE FUNCTION inbound_emails_resolve_once() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status <> 'new' THEN
    RAISE EXCEPTION 'inbound email % is already %', OLD.id, OLD.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER inbound_emails_resolve_once BEFORE UPDATE ON inbound_emails FOR EACH ROW EXECUTE FUNCTION inbound_emails_resolve_once();
