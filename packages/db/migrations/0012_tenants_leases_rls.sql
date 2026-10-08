CALL app_scope_to_agency('tenants');
--> statement-breakpoint
CALL app_scope_to_agency('leases');
--> statement-breakpoint
CALL app_scope_to_agency('lease_tenants');
--> statement-breakpoint
CALL app_scope_to_agency('lease_events');
--> statement-breakpoint
CALL app_scope_to_agency('eft_sequences');
--> statement-breakpoint

GRANT SELECT, INSERT ON tenants, leases TO awdrent_app;
--> statement-breakpoint
GRANT UPDATE (full_name, id_kind, id_number_enc, id_number_last4, id_number_blind_index, email, phone, employer,
  emergency_contact_name, emergency_contact_phone, consent_at, email_opt_in, sms_opt_in, whatsapp_opt_in, notes,
  archived_at, updated_at) ON tenants TO awdrent_app;
--> statement-breakpoint
-- unit_id and eft_reference are fixed once a lease exists
GRANT UPDATE (status, start_date, end_date, rent_cents, due_day, deposit_cents, escalation_bps, escalation_date,
  notice_days, notice_given_on, terminated_on, termination_reason, notes, updated_at) ON leases TO awdrent_app;
--> statement-breakpoint
-- Co-tenants can be removed from a draft lease; enforced in code
GRANT SELECT, INSERT, DELETE ON lease_tenants TO awdrent_app;
--> statement-breakpoint
GRANT UPDATE (is_primary, updated_at) ON lease_tenants TO awdrent_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON lease_events TO awdrent_app;
--> statement-breakpoint
CREATE TRIGGER lease_events_append_only BEFORE UPDATE OR DELETE ON lease_events
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
GRANT SELECT, INSERT ON eft_sequences TO awdrent_app;
--> statement-breakpoint
GRANT UPDATE (last_value, updated_at) ON eft_sequences TO awdrent_app;
--> statement-breakpoint

-- A unit cannot have two live leases over overlapping dates. Drafts may overlap
-- (e.g. preparing the next tenant's lease while notice runs).
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE leases ADD CONSTRAINT leases_no_overlap
  EXCLUDE USING gist (agency_id WITH =, unit_id WITH =, daterange(start_date, end_date, '[]') WITH &&)
  WHERE (status IN ('active', 'notice_given'));
