CALL app_scope_to_agency('application_checklists');
--> statement-breakpoint
CALL app_scope_to_agency('applications');
--> statement-breakpoint
CALL app_scope_to_agency('application_files');
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON application_checklists TO awdrent_app;
--> statement-breakpoint
GRANT UPDATE (items, updated_at) ON application_checklists TO awdrent_app;
--> statement-breakpoint
-- The unit, checklist and proposed terms are fixed once invited; details and progress move on
GRANT SELECT, INSERT ON applications TO awdrent_app;
--> statement-breakpoint
GRANT UPDATE (status, token_hash, expires_at, consent_at, full_name, email, phone, id_kind, id_number_enc, id_number_last4,
  id_number_blind_index, employer, current_address, submitted_at, reminded_at, decided_at, decided_by, decline_reason,
  tenant_id, lease_id, purged_at, updated_at) ON applications TO awdrent_app;
--> statement-breakpoint
CREATE FUNCTION applications_approved_final() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'approved' THEN
    RAISE EXCEPTION 'application % is approved and final', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER applications_approved_final BEFORE UPDATE ON applications FOR EACH ROW EXECUTE FUNCTION applications_approved_final();
--> statement-breakpoint
GRANT SELECT, INSERT ON application_files TO awdrent_app;
--> statement-breakpoint
GRANT UPDATE (status, reject_reason, reviewed_at, reviewed_by, updated_at) ON application_files TO awdrent_app;
--> statement-breakpoint
-- Applicants' files move to the new tenant on approval (D110), once
GRANT UPDATE (application_id, tenant_id) ON documents TO awdrent_app;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION documents_subject_fixed() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.lease_id IS DISTINCT FROM OLD.lease_id OR NEW.inbound_email_id IS DISTINCT FROM OLD.inbound_email_id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.application_id IS DISTINCT FROM OLD.application_id THEN
    IF NOT (
      -- An emailed POP to its lease (D87)
      (OLD.inbound_email_id IS NOT NULL AND OLD.lease_id IS NULL AND NEW.inbound_email_id IS NULL AND NEW.lease_id IS NOT NULL
        AND NEW.tenant_id IS NOT DISTINCT FROM OLD.tenant_id AND NEW.application_id IS NOT DISTINCT FROM OLD.application_id)
      OR
      -- An applicant's file to the new tenant (D110)
      (OLD.application_id IS NOT NULL AND OLD.tenant_id IS NULL AND NEW.application_id IS NULL AND NEW.tenant_id IS NOT NULL
        AND NEW.lease_id IS NOT DISTINCT FROM OLD.lease_id AND NEW.inbound_email_id IS NOT DISTINCT FROM OLD.inbound_email_id)
    ) THEN
      RAISE EXCEPTION 'document % cannot be moved', OLD.id USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
GRANT UPDATE (application_link_days, application_retention_days) ON agencies TO awdrent_app;
