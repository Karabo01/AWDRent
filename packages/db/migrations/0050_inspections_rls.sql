CALL app_scope_to_agency('inspections');
--> statement-breakpoint
CALL app_scope_to_agency('inspection_items');
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON inspections, inspection_items TO awdrent_app;
--> statement-breakpoint
GRANT UPDATE (status, inspected_on, attendees, notes, completed_at, completed_by, report_document_id, updated_at) ON inspections TO awdrent_app;
--> statement-breakpoint
GRANT UPDATE (position, room, item, condition, notes, updated_at) ON inspection_items TO awdrent_app;
--> statement-breakpoint
-- A completed inspection is final; only its report may be attached, once
CREATE FUNCTION inspections_final() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'completed' THEN
    IF TG_OP = 'DELETE' OR OLD.report_document_id IS NOT NULL
       OR (NEW.status, NEW.inspected_on, NEW.attendees, NEW.notes, NEW.completed_at, NEW.completed_by)
          IS DISTINCT FROM (OLD.status, OLD.inspected_on, OLD.attendees, OLD.notes, OLD.completed_at, OLD.completed_by) THEN
      RAISE EXCEPTION 'inspection % is completed and final', OLD.id USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;
--> statement-breakpoint
CREATE TRIGGER inspections_final BEFORE UPDATE OR DELETE ON inspections FOR EACH ROW EXECUTE FUNCTION inspections_final();
--> statement-breakpoint
CREATE FUNCTION inspection_items_final() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent uuid := CASE WHEN TG_OP = 'INSERT' THEN NEW.inspection_id ELSE OLD.inspection_id END;
  agency uuid := CASE WHEN TG_OP = 'INSERT' THEN NEW.agency_id ELSE OLD.agency_id END;
BEGIN
  IF EXISTS (SELECT 1 FROM inspections i WHERE i.agency_id = agency AND i.id = parent AND i.status = 'completed') THEN
    RAISE EXCEPTION 'inspection % is completed and final', parent USING ERRCODE = 'check_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;
--> statement-breakpoint
CREATE TRIGGER inspection_items_final BEFORE INSERT OR UPDATE OR DELETE ON inspection_items FOR EACH ROW EXECUTE FUNCTION inspection_items_final();
