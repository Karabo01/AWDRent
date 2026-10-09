CALL app_scope_to_agency('statement_runs');
--> statement-breakpoint
CALL app_scope_to_agency('owner_statements');
--> statement-breakpoint
CALL app_scope_to_agency('owner_statement_lines');
--> statement-breakpoint
-- A draft run can be worked out again (deleted and recreated); an approved one is final
GRANT SELECT, INSERT, DELETE ON statement_runs, owner_statements, owner_statement_lines TO awdrent_app;
--> statement-breakpoint
GRANT UPDATE (status, approved_at, approved_by, updated_at) ON statement_runs TO awdrent_app;
--> statement-breakpoint
GRANT UPDATE (document_id, updated_at) ON owner_statements TO awdrent_app;
--> statement-breakpoint
CREATE FUNCTION statement_runs_final() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'approved' THEN
    RAISE EXCEPTION 'statement run % is approved and final', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;
--> statement-breakpoint
CREATE TRIGGER statement_runs_final BEFORE UPDATE OR DELETE ON statement_runs FOR EACH ROW EXECUTE FUNCTION statement_runs_final();
--> statement-breakpoint
-- Statements and lines of an approved run cannot be deleted; a statement's PDF may be attached once
CREATE FUNCTION owner_statements_final() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  run_status statement_run_status;
BEGIN
  SELECT r.status INTO run_status FROM statement_runs r WHERE r.agency_id = OLD.agency_id AND r.id = OLD.run_id;
  IF TG_OP = 'DELETE' AND run_status = 'approved' THEN
    RAISE EXCEPTION 'statement % belongs to an approved run', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.document_id IS NOT NULL THEN
    RAISE EXCEPTION 'statement % already has its PDF', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;
--> statement-breakpoint
CREATE TRIGGER owner_statements_final BEFORE UPDATE OR DELETE ON owner_statements FOR EACH ROW EXECUTE FUNCTION owner_statements_final();
--> statement-breakpoint
CREATE FUNCTION owner_statement_lines_final() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM owner_statements s JOIN statement_runs r ON r.agency_id = s.agency_id AND r.id = s.run_id
             WHERE s.agency_id = OLD.agency_id AND s.id = OLD.statement_id AND r.status = 'approved') THEN
    RAISE EXCEPTION 'statement line % belongs to an approved run', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END
$$;
--> statement-breakpoint
CREATE TRIGGER owner_statement_lines_final BEFORE DELETE ON owner_statement_lines FOR EACH ROW EXECUTE FUNCTION owner_statement_lines_final();
--> statement-breakpoint
GRANT UPDATE (commission_model) ON owners TO awdrent_app;
--> statement-breakpoint
GRANT UPDATE (letting_fee) ON leases TO awdrent_app;
